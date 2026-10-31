/**
 * Eval manifest — fingerprints what a run used (architecture, models per phase, prompts, tools,
 * cases, fixtures, git commit), so a report says exactly what changed since the baseline.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { zodSchema } from "ai";
import type { AgentMode } from "../src/agent/answer.js";
import { modelIdsFor, type ModelPolicy } from "../src/agent/ai-gateway.js";
import { ROUTABLE_GROUPS } from "../src/agent/permissions.js";
import { ROUTER_SYSTEM_PROMPT } from "../src/agent/router.js";
import { PROMPT_NAMES } from "../src/agent/prompts.js";
import { AGENT_SYSTEM_PROMPTS, FOR_SUMMARY_NOTE, SINGLE_AGENT_PROMPT } from "../src/agent/sub-agents.js";
import { SUMMARY_SYSTEM_PROMPT } from "../src/agent/summary.js";
import { getAllTools } from "../src/tools/index.js";
import type { EvalCase } from "./cases.js";
import { ARCH_PHASES, type Manifest } from "./report.js";

const hash = (value: unknown) =>
  createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex").slice(0, 8);

function git(cwd: string): Manifest["git"] {
  try {
    const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8" }).trim();
    // Only this package matters: the other session's uncommitted files don't change the agent.
    const dirty = execFileSync("git", ["status", "--porcelain", "--", "."], { cwd, encoding: "utf8" }).trim() !== "";
    return { commit, dirty };
  } catch {
    return undefined;
  }
}

/** The prompts a run used: a Langfuse label with each prompt's version and text, or the in-code text. */
export interface PromptSet {
  label: string | null;
  versions: Record<string, number>;
  texts: Record<string, string>;
}

/** The in-code prompts by Langfuse name (src/agent/prompts.ts PROMPT_NAMES). */
export function codePromptTexts(): Record<string, string> {
  return {
    [PROMPT_NAMES.router]: ROUTER_SYSTEM_PROMPT,
    ...Object.fromEntries(ROUTABLE_GROUPS.map((g) => [PROMPT_NAMES.agent(g), AGENT_SYSTEM_PROMPTS[g]])),
    [PROMPT_NAMES.single]: SINGLE_AGENT_PROMPT,
    [PROMPT_NAMES.summary]: SUMMARY_SYSTEM_PROMPT,
  };
}

export function buildManifest(arch: AgentMode, policy: ModelPolicy, cases: EvalCase[], evalsDir: string, promptSet?: PromptSet): Manifest {
  const texts = promptSet?.texts ?? codePromptTexts();
  const names = arch === "router"
    ? [PROMPT_NAMES.router, ...ROUTABLE_GROUPS.map((g) => PROMPT_NAMES.agent(g)), PROMPT_NAMES.summary]
    : [PROMPT_NAMES.single];
  // "prompt.router" etc.: the same keys as before Langfuse, so older reports still compare.
  const key = (name: string) => `prompt.${name.replace(/^query-(agent-)?/, "")}`;
  const prompts = Object.fromEntries(names.map((n) => [key(n), hash(texts[n])]));
  // The in-code note sub-agents get when the summary step writes the reply (sub-agents.ts).
  if (arch === "router") prompts["prompt.for_summary_note"] = hash(FOR_SUMMARY_NOTE);
  const tools = getAllTools().map((t) => ({
    name: t.name, description: t.description, kind: t.kind, permission: t.permission, input: zodSchema(t.input).jsonSchema,
  }));
  const fixturesDir = join(evalsDir, "fixtures");
  const fixtures = readdirSync(fixturesDir).sort().map((f) => readFileSync(join(fixturesDir, f), "utf8"));

  return {
    arch,
    models: Object.fromEntries(ARCH_PHASES[arch].map((phase) => [phase, modelIdsFor(policy, phase)])),
    hashes: { ...prompts, tools: hash(tools), cases: hash(cases), fixtures: hash(fixtures) },
    git: git(join(evalsDir, "..")),
    ...(promptSet?.label ? { prompts: { label: promptSet.label, versions: promptSet.versions } } : {}),
  };
}
