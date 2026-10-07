/**
 * Tool Registry — 依權限與子 Agent 群組，從單一 tool 來源（src/tools/）取得 AI SDK 工具集。
 */

import { ToolName, filterByGroup, AgentGroup } from "./permissions.js";
import { getTools } from "../tools/index.js";
import { toAiSdkTools } from "../tools/adapters.js";
import type { ToolContext } from "../tools/types.js";

export function createGroupTools(ctx: ToolContext, allowedTools: ToolName[], group: AgentGroup) {
  // AI 只看得到被授權、且屬於此群組的工具
  return toAiSdkTools(getTools(filterByGroup(allowedTools, group)), ctx);
}
