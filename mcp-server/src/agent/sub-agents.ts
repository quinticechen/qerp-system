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

建立訂單的標準流程：
1. 使用者提到客戶名稱時，先呼叫 list_customers 以該名稱搜尋，取得 customer_id
2. 若搜尋到多筆相似客戶，用條列方式列出「名稱」讓使用者確認，不要顯示 ID
3. 若找不到該客戶，詢問使用者「找不到此客戶，是否要新增？」並收集必要資料後呼叫 create_customer，再繼續建立訂單
4. 確認客戶後，在內部使用 customer_id 呼叫 create_order 建立訂單
5. 絕對不要要求使用者提供 UUID 或任何 ID——使用者只需告訴你名稱，你負責查詢

輸出格式規則：
- 絕對不要在回覆中顯示任何 UUID 或 ID 字串（如 8f803e7c-0f45-4840-8c99-6f09e309f10b）
- ID 只在工具呼叫的參數中使用，永遠不出現在給使用者看的文字裡
- 列出客戶時只顯示「名稱」，格式：「- Chen」，不加任何 ID 或括號
- 若工具回傳錯誤（以「失敗：」開頭的訊息），直接將完整錯誤原文告訴使用者，不要改寫或隱藏

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
