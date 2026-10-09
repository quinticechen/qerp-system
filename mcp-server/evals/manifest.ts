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
import { ROUTER_SYSTEM_PROMPT } from "../src/agent/router.js";
import { AGENT_SYSTEM_PROMPTS, SINGLE_AGENT_PROMPT } from "../src/agent/sub-agents.js";
import { getAllTools } from "../src/tools/index.js";
import { ARCH_PHASES, type EvalCase, type Manifest } from "./report.js";

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

export function buildManifest(arch: AgentMode, policy: ModelPolicy, cases: EvalCase[], evalsDir: string): Manifest {
  const prompts: Record<string, string> = arch === "router"
    ? { "prompt.router": hash(ROUTER_SYSTEM_PROMPT), "prompt.commercial": hash(AGENT_SYSTEM_PROMPTS.commercial), "prompt.supply_chain": hash(AGENT_SYSTEM_PROMPTS.supply_chain) }
    : { "prompt.single": hash(SINGLE_AGENT_PROMPT) };
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
  };
}
