/**
 * Prompt versions in Langfuse (docs/requirements/QUERY_AGENT_EVAL_REDESIGN.md §5.2). The in-code
 * prompts (router.ts, sub-agents.ts) are edited as usual; this moves them through Langfuse:
 *
 *   bun run prompts -- status                 # in-code text vs the latest, candidate and production versions
 *   bun run prompts -- push                   # changed prompts → a new version labelled `candidate`
 *   bun run prompts -- push --production      # first upload only: label the new versions `production` too
 *   bun run prompts -- promote                # the `candidate` versions → `production` (after the eval passes)
 *
 * Flow: push → bun run eval -- --prompt-label candidate → promote. Production reads `production`
 * within a minute (src/agent/prompts.ts cache).
 */

import { fetchPrompt } from "../src/agent/prompts.js";
import { langfuseApi, langfuseConfigured } from "./cases.js";
import { codePromptTexts } from "./manifest.js";

async function version(name: string, label: string): Promise<{ text: string; version: number } | null> {
  try {
    return await fetchPrompt(name, label);
  } catch {
    return null;
  }
}

async function setLabels(name: string, v: number, labels: string[]): Promise<void> {
  const res = await langfuseApi("PATCH", `/api/public/v2/prompts/${encodeURIComponent(name)}/versions/${v}`, { newLabels: labels });
  if (res.status === 404) throw new Error(`找不到 ${name} v${v}，無法設定標籤`);
}

async function main() {
  if (!langfuseConfigured()) throw new Error("需要 LANGFUSE_PUBLIC_KEY、LANGFUSE_SECRET_KEY、LANGFUSE_BASE_URL（mcp-server/.env）");
  const [command, ...flags] = process.argv.slice(2);
  const prompts = codePromptTexts();

  if (command === "status") {
    for (const [name, text] of Object.entries(prompts)) {
      const [latest, candidate, production] = await Promise.all(["latest", "candidate", "production"].map((l) => version(name, l)));
      const tag = (v: { text: string; version: number } | null) => (v ? `v${v.version}${v.text === text ? "（與程式相同）" : ""}` : "—");
      console.log(`${name}：latest ${tag(latest)}｜candidate ${tag(candidate)}｜production ${tag(production)}`);
    }
    return;
  }

  if (command === "push") {
    const labels = flags.includes("--production") ? ["candidate", "production"] : ["candidate"];
    for (const [name, text] of Object.entries(prompts)) {
      const latest = await version(name, "latest");
      if (latest?.text === text) {
        // Unchanged: point candidate at the existing version so `--prompt-label candidate` tests it.
        await setLabels(name, latest.version, labels);
        console.log(`= ${name} v${latest.version}（沒有變更）→ ${labels.join("、")}`);
        continue;
      }
      const res = await langfuseApi<{ version: number }>("POST", "/api/public/v2/prompts", {
        name, type: "text", prompt: text, labels, commitMessage: "bun run prompts -- push",
      });
      console.log(`+ ${name} v${res.data?.version} → ${labels.join("、")}`);
    }
    return;
  }

  if (command === "promote") {
    for (const name of Object.keys(prompts)) {
      const candidate = await version(name, "candidate");
      if (!candidate) { console.log(`- ${name}：沒有 candidate`); continue; }
      await setLabels(name, candidate.version, ["production"]);
      console.log(`✓ ${name} v${candidate.version} → production`);
    }
    return;
  }

  throw new Error("用法：bun run prompts -- status | push [--production] | promote");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
