/**
 * System prompts from Langfuse Prompt Management (docs/requirements/QUERY_AGENT_EVAL_REDESIGN.md
 * §2 E3, §5.2; QUERY_AGENT_LANGFUSE.md §2.2), read through the Langfuse SDK.
 *
 * Production reads each prompt's `production` label (QUERY_PROMPT_LABEL overrides it; `code` means
 * the in-code text, e.g. on a developer's machine while editing prompts). The SDK caches each
 * prompt for CACHE_TTL_SECONDS and refreshes it in the background; when Langfuse is not
 * configured, slow or down the in-code text is used — a reply never waits on or fails because of
 * Langfuse. The in-code constants are also what `npm run prompts -- push` uploads as a new version.
 *
 * Evals use the in-code text unless --prompt-label is given; then the label is required and a
 * failed fetch is an error, so a report never claims a prompt version it did not use.
 */

import type { QueryRun } from "./observer.js";
import { langfuseClient, langfuseConfigured, resetLangfuseClient } from "./langfuse.js";

/** Where a prompt's text came from: a Langfuse label and version, or the in-code fallback. */
export type PromptSource = { label: string; version: number } | "code";

/** The Langfuse prompt version a model call used; the gateway links its generations to it. */
export interface PromptLink {
  name: string;
  version: number;
}

export interface SystemPrompt {
  text: string;
  /** Absent for the in-code text: there is no Langfuse version to link. */
  link?: PromptLink;
}

export const PROMPT_NAMES = {
  router: "query-router",
  single: "query-agent-single",
  summary: "query-summary",
  agent: (group: string) => `query-agent-${group}`,
} as const;

const CACHE_TTL_SECONDS = 60;
/** Production never waits long for Langfuse; an eval that requires a label can. */
const FETCH_TIMEOUT_MS = 2_000;
const STRICT_FETCH_TIMEOUT_MS = 10_000;

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
  resetLangfuseClient();
}

function activeLabel(): string | null {
  if (labelOverride !== undefined) return labelOverride;
  const label = process.env.QUERY_PROMPT_LABEL || "production";
  return langfuseConfigured() && label !== "code" ? label : null;
}

/**
 * A system prompt's base text. Call it once per request (not per model attempt) and report its
 * source through the run's observer, so the trace ties the reply to the prompt version.
 */
export async function systemPrompt(name: string, fallback: string, run?: Pick<QueryRun, "observer">): Promise<SystemPrompt> {
  const label = activeLabel();
  const code = (): SystemPrompt => {
    run?.observer?.onPrompt?.(name, "code");
    return { text: fallback };
  };
  if (!label) return code();

  try {
    const prompt = await langfuseClient().prompt.get(name, {
      label,
      type: "text",
      cacheTtlSeconds: CACHE_TTL_SECONDS,
      fetchTimeoutMs: strict ? STRICT_FETCH_TIMEOUT_MS : FETCH_TIMEOUT_MS,
      maxRetries: strict ? 2 : 0,
    });
    if (typeof prompt.prompt !== "string") throw new Error("not a text prompt");
    run?.observer?.onPrompt?.(name, { label, version: prompt.version });
    return { text: prompt.prompt, link: { name, version: prompt.version } };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (strict) throw new Error(`Langfuse prompt ${name}@${label}: ${reason}`);
    console.warn(`[Prompts] ${name}@${label} 讀取失敗，使用程式內建的版本: ${reason}`);
    return code();
  }
}
