/**
 * System prompts from Langfuse Prompt Management (docs/requirements/QUERY_AGENT_EVAL_REDESIGN.md
 * §2 E3, §5.2).
 *
 * Production reads each prompt's `production` label (QUERY_PROMPT_LABEL overrides it; `code` means
 * the in-code text, e.g. on a developer's machine while editing prompts), cached for
 * CACHE_TTL_MS, and falls back to the in-code text when Langfuse is not configured, slow or down —
 * a reply never waits on or fails because of Langfuse. The in-code constants are also what
 * `npm run prompts -- push` uploads as a new version.
 *
 * Evals use the in-code text unless --prompt-label is given; then the label is required and a
 * failed fetch is an error, so a report never claims a prompt version it did not use.
 */

import type { QueryRun } from "./observer.js";

/** Where a prompt's text came from: a Langfuse label and version, or the in-code fallback. */
export type PromptSource = { label: string; version: number } | "code";

export const PROMPT_NAMES = {
  router: "query-router",
  single: "query-agent-single",
  agent: (group: string) => `query-agent-${group}`,
} as const;

const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 2_000;

interface Fetched {
  text: string;
  version: number;
  at: number;
}

const cache = new Map<string, Fetched>();
/** undefined = the production default; null = always the in-code text. */
let labelOverride: string | null | undefined;
let strict = false;

/**
 * Evals: use the in-code prompts (null) or require a Langfuse label; undefined restores the
 * production default. Clears the cache.
 */
export function setPromptLabel(label: string | null | undefined): void {
  labelOverride = label;
  strict = typeof label === "string";
  cache.clear();
}

function langfuseConfigured(): boolean {
  return !!(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY && process.env.LANGFUSE_BASE_URL);
}

function activeLabel(): string | null {
  if (labelOverride !== undefined) return labelOverride;
  const label = process.env.QUERY_PROMPT_LABEL || "production";
  return langfuseConfigured() && label !== "code" ? label : null;
}

export async function fetchPrompt(name: string, label: string): Promise<{ text: string; version: number }> {
  const auth = Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString("base64");
  const url = `${process.env.LANGFUSE_BASE_URL!.replace(/\/$/, "")}/api/public/v2/prompts/${encodeURIComponent(name)}?label=${encodeURIComponent(label)}`;
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Langfuse prompt ${name}@${label}: HTTP ${res.status}`);
  const body = (await res.json()) as { prompt?: unknown; version?: number; type?: string };
  if (body.type !== "text" || typeof body.prompt !== "string" || typeof body.version !== "number") {
    throw new Error(`Langfuse prompt ${name}@${label} is not a text prompt`);
  }
  return { text: body.prompt, version: body.version };
}

/**
 * A system prompt's base text. Call it once per request (not per model attempt) and report its
 * source through the run's observer, so the trace ties the reply to the prompt version.
 */
export async function systemPrompt(name: string, fallback: string, run?: Pick<QueryRun, "observer">): Promise<string> {
  const label = activeLabel();
  const use = (text: string, source: PromptSource) => {
    run?.observer?.onPrompt?.(name, source);
    return text;
  };
  if (!label) return use(fallback, "code");

  const key = `${name}@${label}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return use(cached.text, { label, version: cached.version });
  try {
    const fetched = await fetchPrompt(name, label);
    cache.set(key, { ...fetched, at: Date.now() });
    return use(fetched.text, { label, version: fetched.version });
  } catch (err) {
    if (strict) throw err;
    console.warn(`[Prompts] ${key} 讀取失敗，使用${cached ? "快取" : "程式內建"}的版本: ${err instanceof Error ? err.message : String(err)}`);
    return cached ? use(cached.text, { label, version: cached.version }) : use(fallback, "code");
  }
}
