import { SupabaseClient } from "@supabase/supabase-js";
import { ToolName, AgentGroup, filterByGroup } from "./permissions.js";
import { createGroupTools } from "./tool-registry.js";
import { aiGenerateText } from "./ai-gateway.js";
import type { CoreMessage } from "ai";

const AGENT_SYSTEM_PROMPTS: Record<AgentGroup, string> = {
  commercial: `你是 Query 的商務管理子 Agent，專精於客戶關係、訂單處理和產品管理。

職責：
- 協助查詢、建立、管理客戶資料
- 處理銷售訂單的查詢、建立、狀態更新
- 查詢產品目錄和規格

回覆原則：
- 用繁體中文回答
- 數據以清晰的條列或表格格式呈現
- 操作成功後說明下一步可以做什麼
- 若資料是空的，友善告知並建議替代查詢方式`,

  supply_chain: `你是 Query 的供應鏈管理子 Agent，專精於庫存管理、採購、出貨和工廠協調。

職責：
- 查詢庫存數量和各等級（A/B/C/D 級、瑕疵品）分布
- 提供庫存不足警示和補貨建議
- 管理採購單查詢
- 追蹤出貨記錄和卷號
- 查詢合作工廠資訊

回覆原則：
- 用繁體中文回答
- 庫存數字要清楚標示單位（卷、公尺等）
- 有低庫存警示時主動提醒
- 採購單和出貨單資訊要包含狀態和日期`,

  admin: `你是系統管理子 Agent，目前此功能尚未開放。`,
};

export type ConversationMessage = { role: "user" | "assistant"; content: string };

/**
 * 執行單一子 Agent：Vercel AI SDK generateText + maxSteps 自動處理 agentic loop
 */
export async function runSubAgent(
  group: AgentGroup,
  task: string,
  allowedTools: ToolName[],
  supabase: SupabaseClient,
  history: ConversationMessage[] = []
): Promise<string> {
  const groupTools = filterByGroup(allowedTools, group);

  if (groupTools.length === 0) {
    return `你沒有 ${group === "commercial" ? "商務管理" : "供應鏈"} 相關功能的操作權限。`;
  }

  const tools = createGroupTools(supabase, allowedTools, group);
  const messages: CoreMessage[] = [
    ...history.map((m) => ({ role: m.role, content: m.content } as CoreMessage)),
    { role: "user" as const, content: task },
  ];

  const result = await aiGenerateText({
    system: AGENT_SYSTEM_PROMPTS[group],
    messages,
    tools,
    maxSteps: 10, // Vercel AI SDK 自動處理 tool call loop
  } as any);

  return (result as any).text ?? "已完成操作。";
}
