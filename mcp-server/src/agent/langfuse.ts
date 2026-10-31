/**
 * Langfuse: the shared SDK client and OpenTelemetry tracing for production and evals
 * (docs/requirements/QUERY_AGENT_LANGFUSE.md §2.1).
 *
 * Every /query is one trace (traceQuery): the model calls inside it are recorded by the AI SDK's
 * telemetry (ai-gateway.ts) and linked to the prompt version that produced them. In production the
 * spans are de-identified (maskText) and tail-sampled: a request's spans wait until it ends, then
 * a failed or degraded request is always sent and the rest at SAMPLE_RATE, decided by trace id.
 * Without Langfuse keys nothing is started and every function here is a no-op.
 */

import { randomBytes } from "node:crypto";
import { TraceFlags, SpanStatusCode, type Context } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseClient } from "@langfuse/client";
import { createTraceId, propagateAttributes, startActiveObservation } from "@langfuse/tracing";

/** Share of healthy production requests sent to Langfuse (decision E11). */
export const PRODUCTION_SAMPLE_RATE = 0.05;
/** A request whose root span never ends (e.g. the process is killed) is dropped after this. */
const PENDING_TTL_MS = 10 * 60_000;
const DECIDED_CAP = 5_000;

export function langfuseConfigured(): boolean {
  return !!(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY && process.env.LANGFUSE_BASE_URL);
}

let client: LangfuseClient | null = null;

/** The SDK client (prompts, datasets, scores). Callers check langfuseConfigured() first. */
export function langfuseClient(): LangfuseClient {
  client ??= new LangfuseClient();
  return client;
}

/** Tests: drop the client and its prompt cache. */
export function resetLangfuseClient(): void {
  client = null;
}

// ---------- De-identification (decision E8) ----------

// Taiwan landline, mobile and fax numbers, with or without +886, separators or brackets. Order and
// product numbers (preceded by a letter or "-") and dates are not matched.
const PHONE_RE = /(?<![\w-])(?:\+886[-\s]?|\(0\d{1,2}\)\s?|0)\d{1,4}[-\s]?\d{3,4}[-\s]?\d{3,4}(?![\w-])/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// Tool results reach the spans as JSON text (also JSON inside JSON, hence the optional backslashes).
const FIELD_RE = /(\\*"(contact_person|address)\\*"\s*:\s*\\*")((?:(?!\\*").)*)(\\*")/g;
const FIELD_LABELS: Record<string, string> = { contact_person: "[聯絡人]", address: "[地址]" };

/** Sensitive values → their label. */
export type KnownValues = Map<string, string>;

/**
 * Contact people and addresses in tool results. The model repeats them in its replies, where no
 * field name marks them, so they are masked wherever they appear in the request's trace.
 */
export function sensitiveValues(text: string, into: KnownValues = new Map()): KnownValues {
  for (const m of text.matchAll(FIELD_RE)) if (m[3].length >= 2) into.set(m[3], FIELD_LABELS[m[2]]);
  return into;
}

/**
 * Replaces phone numbers, e-mail addresses, contact people and addresses (as fields, and the
 * `known` values anywhere); keeps everything else.
 */
export function maskText(text: string, known?: KnownValues): string {
  let masked = text.replace(FIELD_RE, (_m, open: string, field: string, _value: string, close: string) => `${open}${FIELD_LABELS[field]}${close}`);
  // Longest first, so a value inside a longer one does not split it.
  for (const [value, label] of [...(known ?? [])].sort((a, b) => b[0].length - a[0].length)) masked = masked.split(value).join(label);
  return masked.replace(EMAIL_RE, "[Email]").replace(PHONE_RE, "[電話]");
}

function stringAttributes(span: ReadableSpan): string[] {
  return Object.values(span.attributes).flatMap((v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []));
}

function collectKnown(spans: ReadableSpan[]): KnownValues {
  const known: KnownValues = new Map();
  for (const span of spans) for (const text of stringAttributes(span)) sensitiveValues(text, known);
  return known;
}

function maskSpan(span: ReadableSpan, known: KnownValues): void {
  const attributes = span.attributes as Record<string, unknown>;
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value === "string") attributes[key] = maskText(value, known);
    else if (Array.isArray(value)) attributes[key] = value.map((v) => (typeof v === "string" ? maskText(v, known) : v));
  }
}

// ---------- Tail sampling ----------

/** Deterministic in the trace id, so a backfill can tell whether a trace was sent. */
export function inSample(traceId: string, rate: number): boolean {
  return parseInt(traceId.slice(0, 8), 16) / 0x1_0000_0000 < rate;
}

interface PendingTrace {
  rootSpanId: string;
  spans: ReadableSpan[];
  keep: boolean;
  at: number;
}

interface Decision {
  send: boolean;
  known: KnownValues;
}

/**
 * Holds the spans of each registered request until its root span ends, then forwards all or none,
 * masked with every contact person and address found anywhere in the request. Spans of
 * unregistered traces (eval items, the feedback backfill) pass straight through.
 */
export class TailSamplingProcessor implements SpanProcessor {
  private readonly pending = new Map<string, PendingTrace>();
  private readonly decided = new Map<string, Decision>();

  constructor(
    private readonly inner: SpanProcessor,
    private readonly rate: number,
    private readonly mask: boolean
  ) {}

  register(traceId: string, rootSpanId: string): void {
    this.pending.set(traceId, { rootSpanId, spans: [], keep: false, at: Date.now() });
  }

  /** Forget a dropped trace, so spans sent for it later (the thumbs-down backfill) go out. */
  allow(traceId: string): void {
    this.decided.delete(traceId);
    this.pending.delete(traceId);
  }

  /** Always send this request (it failed, fell back to another model, or the user flagged it). */
  keep(traceId: string): void {
    const entry = this.pending.get(traceId);
    if (entry) entry.keep = true;
  }

  onStart(span: Span, parentContext: Context): void {
    this.inner.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    const { traceId, spanId } = span.spanContext();
    const decision = this.decided.get(traceId);
    if (decision) {
      if (decision.send) this.forward(span, decision.known);
      return;
    }
    const entry = this.pending.get(traceId);
    if (!entry) {
      this.forward(span, this.mask ? collectKnown([span]) : new Map());
      return;
    }
    entry.spans.push(span);
    if (span.status.code === SpanStatusCode.ERROR) entry.keep = true;
    if (spanId !== entry.rootSpanId) return;

    const send = entry.keep || inSample(traceId, this.rate);
    const known = send && this.mask ? collectKnown(entry.spans) : new Map<string, string>();
    this.pending.delete(traceId);
    this.decided.set(traceId, { send, known });
    if (this.decided.size > DECIDED_CAP) this.decided.delete(this.decided.keys().next().value!);
    if (send) for (const s of entry.spans) this.forward(s, known);
    this.dropStale();
  }

  private forward(span: ReadableSpan, known: KnownValues): void {
    if (this.mask) maskSpan(span, known);
    this.inner.onEnd(span);
  }

  private dropStale(): void {
    const cutoff = Date.now() - PENDING_TTL_MS;
    for (const [traceId, entry] of this.pending) if (entry.at < cutoff) this.pending.delete(traceId);
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
}

// ---------- Setup ----------

export interface TracingOptions {
  /** Langfuse environment: "production", "development"; experiments set their own. */
  environment: string;
  /** Share of healthy requests sent; 1 sends every request. */
  sampleRate: number;
  /** De-identify span contents (real data). */
  mask: boolean;
  /** Tests: receives the spans instead of Langfuse (no keys needed). */
  processor?: SpanProcessor;
}

let sdk: NodeSDK | null = null;
let sampler: TailSamplingProcessor | null = null;

/** Starts tracing once; false when Langfuse is not configured. */
export function startTracing(options: TracingOptions): boolean {
  if (sdk) return true;
  if (!options.processor && !langfuseConfigured()) return false;
  sampler = new TailSamplingProcessor(
    options.processor ?? new LangfuseSpanProcessor({ environment: options.environment, release: process.env.K_REVISION }),
    options.sampleRate,
    options.mask
  );
  sdk = new NodeSDK({ spanProcessors: [sampler] });
  sdk.start();
  return true;
}

export function tracingEnabled(): boolean {
  return sdk !== null;
}

/** Lets spans of a trace that sampling dropped through again (feedback.ts backfill). */
export function allowTrace(traceId: string): void {
  sampler?.allow(traceId);
}

/** Sends everything buffered (evals before exiting; the feedback backfill). */
export async function flushTracing(): Promise<void> {
  await sampler?.forceFlush();
}

export async function shutdownTracing(): Promise<void> {
  await sdk?.shutdown();
  sdk = null;
  sampler = null;
}

/** The Langfuse trace id of a query_traces row — the same for the trace, its scores and a backfill. */
export function langfuseTraceId(queryTraceId: string): Promise<string> {
  return createTraceId(queryTraceId);
}

export interface QueryTraceInfo {
  /** query_traces.id */
  id: string;
  userId: string;
  sessionId: string | null;
  organizationId: string;
  input: string;
}

export interface QueryTraceEnd {
  output: string;
  /** Always send: the request failed or fell back. */
  degraded: boolean;
  error?: unknown;
  metadata?: Record<string, unknown>;
}

export interface QueryTraceHandle {
  end(result: QueryTraceEnd): void;
}

const NOOP_HANDLE: QueryTraceHandle = { end() {} };

/**
 * Runs one /query as a Langfuse trace whose id derives from query_traces.id. The root span ends
 * when fn returns; call handle.end() before that with the reply.
 */
export async function traceQuery<T>(info: QueryTraceInfo, fn: (handle: QueryTraceHandle) => Promise<T>): Promise<T> {
  if (!tracingEnabled()) return fn(NOOP_HANDLE);
  const traceId = await langfuseTraceId(info.id);
  return startActiveObservation(
    "query",
    async (root) => {
      sampler?.register(traceId, root.id);
      root.update({ input: info.input, metadata: { query_trace_id: info.id, organization_id: info.organizationId } });
      const handle: QueryTraceHandle = {
        end({ output, degraded, error, metadata }) {
          if (degraded || error) sampler?.keep(traceId);
          root.update({
            output,
            ...(error ? { level: "ERROR" as const, statusMessage: String(error instanceof Error ? error.message : error).slice(0, 500) }
              : degraded ? { level: "WARNING" as const } : {}),
            ...(metadata ? { metadata } : {}),
          });
        },
      };
      try {
        return await propagateAttributes(
          { userId: info.userId, ...(info.sessionId ? { sessionId: info.sessionId } : {}), traceName: "query" },
          () => fn(handle)
        );
      } catch (err) {
        handle.end({ output: "", degraded: true, error: err });
        throw err;
      }
    },
    { asType: "agent", parentSpanContext: { traceId, spanId: randomBytes(8).toString("hex"), traceFlags: TraceFlags.SAMPLED } }
  );
}
