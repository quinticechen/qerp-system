import { ToolName, AgentGroup, TOOL_GROUPS, filterByGroup } from "./permissions.js";
import type { Draft, ToolContext } from "../tools/types.js";
import { createAgentTools } from "./tool-registry.js";
import { aiGenerateText } from "./ai-gateway.js";
import { entityNote } from "./memory.js";
import type { CoreMessage } from "ai";
import { type QueryRun, normalizeToolName } from "./observer.js";

export const AGENT_SYSTEM_PROMPTS: Record<AgentGroup, string> = {
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
6. 建立或修改資料的工具只會產生「待確認草稿」，使用者在確認卡片上確認後才會寫入；備註等選填欄位不要事先詢問，直接建立草稿

輸出格式規則：
- 絕對不要在回覆中顯示任何 UUID 或 ID 字串（如 8f803e7c-0f45-4840-8c99-6f09e309f10b）
- ID 只在工具呼叫的參數中使用，永遠不出現在給使用者看的文字裡
- 列出客戶時只顯示「名稱」，格式：「- Chen」，不加任何 ID 或括號
- 若工具回傳錯誤（以「失敗：」開頭的訊息），直接將完整錯誤原文告訴使用者，不要改寫或隱藏

回覆原則：
- 用繁體中文回答
- 數據以清晰的條列或表格格式呈現
- 建立草稿後，請使用者在下方的確認卡片確認內容
- 若資料是空的，友善告知並建議替代查詢方式`,

  supply_chain: `你是 Query 的供應鏈管理子 Agent，專精於庫存管理、採購、出貨和工廠協調。

職責：
- 查詢庫存數量和各等級（A/B/C/D 級、瑕疵品）分布
- 提供庫存不足警示和補貨建議
- 查詢、建立採購單
- 追蹤出貨記錄和卷號
- 查詢合作工廠資訊

查詢「最新」資料時的規則：
- 使用者問「最新的採購單」、「最近的出貨」等，直接呼叫對應的 list 工具、不加額外篩選條件——結果預設已依建立時間新到舊排序，取第一筆回答即可
- 不要反問使用者要用什麼條件篩選；只有在使用者主動提到工廠、狀態等條件時才加上對應參數

建立採購單的標準流程：
1. 使用者提到工廠名稱時，先呼叫 list_factories 以該名稱搜尋，取得 factory_id
2. 使用者提到產品名稱或顏色時，先呼叫 list_products 搜尋，取得 product_id
3. 若搜尋到多筆相似結果，用條列方式列出「名稱」讓使用者確認，不要顯示 ID
4. 收集齊工廠、至少一項品項（產品、數量、單價）後，在內部使用對應 ID 呼叫 create_purchase_order
5. 絕對不要要求使用者提供 UUID 或任何 ID——使用者只需告訴你名稱，你負責查詢
6. 建立或修改資料的工具只會產生「待確認草稿」，使用者在確認卡片上確認後才會寫入；備註等選填欄位不要事先詢問，直接建立草稿

輸出格式規則：
- 絕對不要在回覆中顯示任何 UUID 或 ID 字串
- ID 只在工具呼叫的參數中使用，永遠不出現在給使用者看的文字裡
- 若工具回傳錯誤（以「失敗：」開頭的訊息），直接將完整錯誤原文告訴使用者，不要改寫或隱藏

回覆原則：
- 用繁體中文回答
- 庫存數字要清楚標示單位（卷、公尺等）
- 有低庫存警示時主動提醒
- 採購單和出貨單資訊要包含狀態和日期
- 建立草稿後，請使用者在下方的確認卡片確認內容`,

  admin: `你是系統管理子 Agent，目前此功能尚未開放。`,
};

/**
 * 單一 Agent（P0-7 比較用）：一個 Agent 持有使用者被授權的全部工具，直接處理原始訊息，不經 Router
 * 改寫。內容合併自上方兩個子 Agent 的 prompt。
 */
export const SINGLE_AGENT_PROMPT = `你是 Query，紡織業 ERP 的智慧助理，負責客戶、訂單、產品、庫存、採購、出貨與工廠的查詢與操作。

查詢「最新」資料時的規則：
- 使用者問「最新的採購單」、「最近的出貨」等，直接呼叫對應的 list 工具、不加額外篩選條件——結果預設已依建立時間新到舊排序，取第一筆回答即可
- 不要反問使用者要用什麼條件篩選；只有在使用者主動提到工廠、狀態等條件時才加上對應參數

建立訂單的標準流程：
1. 使用者提到客戶名稱時，先呼叫 list_customers 以該名稱搜尋，取得 customer_id
2. 若搜尋到多筆相似客戶，用條列方式列出「名稱」讓使用者確認，不要顯示 ID
3. 若找不到該客戶，詢問使用者「找不到此客戶，是否要新增？」並收集必要資料後呼叫 create_customer，再繼續建立訂單
4. 確認客戶後，在內部使用 customer_id 呼叫 create_order 建立訂單

建立採購單的標準流程：
1. 使用者提到工廠名稱時，先呼叫 list_factories 以該名稱搜尋，取得 factory_id
2. 使用者提到產品名稱或顏色時，先呼叫 list_products 搜尋，取得 product_id
3. 若搜尋到多筆相似結果，用條列方式列出「名稱」讓使用者確認，不要顯示 ID
4. 收集齊工廠、至少一項品項（產品、數量、單價）後，在內部使用對應 ID 呼叫 create_purchase_order

共同規則：
- 絕對不要要求使用者提供 UUID 或任何 ID——使用者只需告訴你名稱，你負責查詢
- 建立或修改資料的工具只會產生「待確認草稿」，使用者在確認卡片上確認後才會寫入；備註等選填欄位不要事先詢問，直接建立草稿

輸出格式規則：
- 絕對不要在回覆中顯示任何 UUID 或 ID 字串
- ID 只在工具呼叫的參數中使用，永遠不出現在給使用者看的文字裡
- 列出客戶時只顯示「名稱」，格式：「- Chen」，不加任何 ID 或括號
- 若工具回傳錯誤（以「失敗：」開頭的訊息），直接將完整錯誤原文告訴使用者，不要改寫或隱藏

回覆原則：
- 用繁體中文回答
- 數據以清晰的條列或表格格式呈現
- 庫存數字要清楚標示單位（卷、公尺等）；有低庫存警示時主動提醒
- 採購單和出貨單資訊要包含狀態和日期
- 建立草稿後，請使用者在下方的確認卡片確認內容
- 若資料是空的，友善告知並建議替代查詢方式`;

export type ConversationMessage = { role: "user" | "assistant"; content: string };

/** Wording that tells the user a confirmation card is waiting. */
const CLAIMS_DRAFT = /確認卡片|已建立.{0,20}草稿|草稿已建立/;

/**
 * Tells the model which tools in its scope this account lacks, so a workflow step in the prompt
 * that needs one is answered with "no permission" instead of a call to a tool the model doesn't
 * have (F3) or a question that implies it can proceed (F5). Empty for full access, so those
 * prompts stay byte-identical (tool and prompt wording is fragile — F7).
 */
function permissionNote(scope: readonly ToolName[], available: readonly ToolName[]): string {
  const missing = scope.filter((t) => !available.includes(t));
  if (!missing.length) return "";
  return `

權限限制：
- 本帳號無法使用的工具：${missing.join("、")}
- 上方流程若需要這些工具，不要呼叫它們，直接告訴使用者目前帳號沒有這項操作的權限`;
}

interface AgentSpec {
  /** Observer / trace label: the group, or "all" for the single agent. */
  label: string;
  system: string;
  tools: ToolName[];
}

/** One agent: Vercel AI SDK generateText + maxSteps handles the tool loop. */
async function runAgent(spec: AgentSpec, task: string, ctx: ToolContext, history: ConversationMessage[], run: QueryRun): Promise<string> {
  const { observer } = run;
  // Writes become drafts. A failed attempt's drafts are discarded, so a fallback re-run doesn't
  // leave duplicate confirmation cards.
  let drafts: Draft[] = [];
  const tools = createAgentTools(ctx, spec.tools, { onDraft: (d) => drafts.push(d) });
  const messages: CoreMessage[] = [
    ...history.map((m) => ({ role: m.role, content: m.content } as CoreMessage)),
    { role: "user" as const, content: task },
  ];

  const result = await aiGenerateText({
    system: spec.system + entityNote(run.entities ?? []),
    messages,
    tools,
    maxSteps: 10, // Vercel AI SDK 自動處理 tool call loop
    onStepFinish: observer?.onStep
      ? (step: any) =>
          observer.onStep!(spec.label, {
            toolCalls: (step.toolCalls ?? []).map((c: any) => ({ toolName: normalizeToolName(c.toolName), args: c.args })),
            toolResults: (step.toolResults ?? []).map((r: any) => ({ toolName: normalizeToolName(r.toolName), result: r.result })),
            promptTokens: step.usage?.promptTokens ?? 0,
            completionTokens: step.usage?.completionTokens ?? 0,
          })
      : undefined,
  } as any, {
    ...run,
    phase: `agent:${spec.label}`,
    onAttemptFailed: () => { drafts = []; },
    // A reply that points to a confirmation card when none was drafted would mislead the user.
    validate: (text) => (drafts.length === 0 && CLAIMS_DRAFT.test(text) ? "回覆提到確認卡片，但沒有建立任何草稿" : null),
    // Some models stop silently after drafting; the card is what matters.
    emptyReply: () => (drafts.length ? "已建立草稿，請在下方的確認卡片確認內容。" : null),
  });

  run.drafts?.push(...drafts);
  return result.text;
}

/** 執行單一子 Agent（Router 架構） */
export async function runSubAgent(
  group: AgentGroup,
  task: string,
  allowedTools: ToolName[],
  ctx: ToolContext,
  history: ConversationMessage[] = [],
  run: QueryRun = {}
): Promise<string> {
  const groupTools = filterByGroup(allowedTools, group);
  if (groupTools.length === 0) {
    return `你沒有 ${group === "commercial" ? "商務管理" : "供應鏈"} 相關功能的操作權限。`;
  }
  return runAgent(
    { label: group, system: AGENT_SYSTEM_PROMPTS[group] + permissionNote(TOOL_GROUPS[group], groupTools), tools: groupTools },
    task, ctx, history, run
  );
}

/** 單一 Agent：全部被授權的工具，處理使用者的原始訊息 */
export async function runSingleAgent(
  message: string,
  allowedTools: ToolName[],
  ctx: ToolContext,
  history: ConversationMessage[] = [],
  run: QueryRun = {}
): Promise<string> {
  if (allowedTools.length === 0) return "很抱歉，你目前沒有任何操作權限。請聯繫系統管理員。";
  const scope = [...new Set([...TOOL_GROUPS.commercial, ...TOOL_GROUPS.supply_chain])];
  return runAgent(
    { label: "all", system: SINGLE_AGENT_PROMPT + permissionNote(scope, allowedTools), tools: allowedTools },
    message, ctx, history, run
  );
}
