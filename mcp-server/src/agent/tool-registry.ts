/**
 * Tool Registry — 依權限從單一 tool 來源（src/tools/）取得 AI SDK 工具集。
 */

import { ToolName, filterByGroup, AgentGroup } from "./permissions.js";
import { getTools } from "../tools/index.js";
import { toAiSdkTools, type AiToolHooks } from "../tools/adapters.js";
import type { ToolContext } from "../tools/types.js";

/** AI SDK tools for exactly these (already permitted) tool names. */
export function createAgentTools(ctx: ToolContext, toolNames: readonly ToolName[], hooks: AiToolHooks) {
  return toAiSdkTools(getTools(toolNames), ctx, hooks);
}

export function createGroupTools(ctx: ToolContext, allowedTools: ToolName[], group: AgentGroup, hooks: AiToolHooks) {
  // AI 只看得到被授權、且屬於此群組的工具
  return createAgentTools(ctx, filterByGroup(allowedTools, group), hooks);
}
