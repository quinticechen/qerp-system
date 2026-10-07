/**
 * Agent 架構選擇（docs/QUERY_AGENT_PHASE0.md D6／P0-7）
 *
 * - router：Router 分類意圖、改寫 task，再交給 commercial／supply_chain 子 Agent
 * - single：一個 Agent 持有全部被授權的工具，直接處理使用者的原始訊息
 *
 * 由 QUERY_AGENT_MODE 環境變數選擇；不論哪種架構，回覆都經過輸出防護。
 */

import { routeQuery } from "./router.js";
import { runSingleAgent, type ConversationMessage } from "./sub-agents.js";
import { redactIds } from "./output-guard.js";
import type { QueryRun } from "./observer.js";
import type { ToolName } from "./permissions.js";
import type { ToolContext } from "../tools/types.js";

export type AgentMode = "router" | "single";

export function configuredAgentMode(): AgentMode {
  return process.env.QUERY_AGENT_MODE === "single" ? "single" : "router";
}

export async function answerQuery(
  message: string,
  ctx: ToolContext,
  allowedTools: ToolName[],
  history: ConversationMessage[],
  run: QueryRun,
  mode: AgentMode = configuredAgentMode()
): Promise<string> {
  const reply = mode === "single"
    ? await runSingleAgent(message, allowedTools, ctx, history, run)
    : await routeQuery(message, ctx, allowedTools, history, run);
  return redactIds(reply);
}
