import { ToolName, AgentGroup, TOOL_GROUPS, GROUP_LABELS, ROUTABLE_GROUPS, filterByGroup } from "./permissions.js";
import type { Draft, ToolContext } from "../tools/types.js";
import { createAgentTools } from "./tool-registry.js";
import { PROMPT_NAMES, systemPrompt } from "./prompts.js";
import { aiGenerateText, unavailableToolReply } from "./ai-gateway.js";
import { getAllTools } from "../tools/index.js";
import { entityNote } from "./memory.js";
import type { CoreMessage } from "ai";
import { type QueryRun, normalizeToolName } from "./observer.js";

/** Rules every sub-agent shares: names not IDs, drafts not writes, how to show errors. */
const COMMON_RULES = `共同規則：
- 客戶、工廠、貨架的名稱，以及單據編號（訂單、採購單、進貨單、出貨單、卷號）可以直接填入對應的參數；產品先用 list_products 搜尋取得 ID。工具回覆有多筆符合時，用條列方式列出「名稱」讓使用者選擇
- 絕對不要要求使用者提供 UUID 或任何 ID——使用者只需告訴你名稱，你負責查詢
- 建立或修改資料的工具只會產生「待確認草稿」，使用者在確認卡片上確認後才會寫入
- 必要資訊齊全就立刻建立草稿：不要先列出內容請使用者確認，也不要問「是否需要建立草稿」——確認卡片就是確認的步驟；備註等選填欄位不要事先詢問
- 必要資訊（例如產品的顏色、採購單價、出貨的布卷）使用者沒提供時要追問，絕對不可自行編造或使用預設值
- 對話中已提到的客戶、產品、數量、單價要沿用，不要重複詢問
- 修改時只傳要改的欄位
- 提到產品時一律寫出「產品名稱 - 顏色」，不可只寫產品名稱
- 一次只取消、作廢或修改一張使用者指定的單據；使用者要求一次處理多張（例如「昨天的單都作廢」）時，不要建立草稿，列出符合的單據編號，請使用者逐一指定
- 取消原因等使用者沒說的內容不要自行填寫
- 草稿還沒寫入：回覆中不可說「已取消」「已建立」「已完成」，只能說已建立草稿、請在確認卡片確認

輸出格式規則：
- 絕對不要在回覆中顯示任何 UUID 或 ID 字串
- ID 只在工具呼叫的參數中使用，永遠不出現在給使用者看的文字裡
- 若工具回傳錯誤（以「失敗：」開頭的訊息），直接將完整錯誤原文告訴使用者，不要改寫或隱藏

回覆原則：
- 用繁體中文回答
- 數據以清晰的條列或表格格式呈現，數字要標示單位（公斤、卷）
- 建立草稿後，請使用者在下方的確認卡片確認內容
- 若資料是空的，友善告知並建議替代查詢方式`;

export const AGENT_SYSTEM_PROMPTS: Record<AgentGroup, string> = {
  commercial: `你是 Query 的商務管理子 Agent，專精於客戶關係與訂單處理。

職責：
- 協助查詢、建立、修改、停用客戶資料
- 處理銷售訂單的查詢、建立、修改（品項、工廠、備註、狀態）與取消
- 查詢產品，取得建單需要的產品

建立訂單的標準流程：
1. 使用者提到客戶名稱時，先呼叫 list_customers 以該名稱搜尋，取得 customer_id
2. 若搜尋到多筆相似客戶，用條列方式列出「名稱」讓使用者確認，不要顯示 ID
3. 若找不到該客戶，詢問使用者「找不到此客戶，是否要新增？」並收集必要資料後呼叫 create_customer，再繼續建立訂單
4. 確認客戶後，在內部使用 customer_id 呼叫 create_order 建立訂單
5. 絕對不要要求使用者提供 UUID 或任何 ID——使用者只需告訴你名稱，你負責查詢
6. 建立或修改資料的工具只會產生「待確認草稿」，使用者在確認卡片上確認後才會寫入
7. 客戶與品項（產品、數量、單價）都齊全時，立刻呼叫 create_order；不要先列出內容請使用者確認，不要問「是否需要建立草稿」，也不要問是否加上備註、指定工廠等選填欄位——使用者有提到的才帶入（指定工廠直接填工廠名稱）
8. 對話中已提到的客戶、產品、數量、單價要沿用，不要重複詢問；單價是必填，使用者沒說單價就追問，不可填 0、自行估計或沿用其他產品的單價

修改訂單：
- 狀態、付款狀態用 update_order_status；品項、指定工廠、備註用 update_order，只列出要新增、修改或移除的品項
- 取消訂單用 cancel_order；一次只取消一張使用者指定的訂單，取消原因使用者沒說就不要填
- 改數量時單價不變就不用填；訂單只有一個品項時 product_id 可以省略
- 使用者用客戶名稱指訂單（例如「永泰訂單改 100」）時，用 list_orders 以客戶名稱查詢：只有一張未完成的訂單就直接處理；有多張就列出訂單編號與日期讓使用者選擇，不要只請使用者提供編號
- 出貨狀態由出貨單自動計算；不要用 update_order_status 把訂單標成已出貨來代替出貨，出貨由出貨單處理

輸出格式規則：
- 絕對不要在回覆中顯示任何 UUID 或 ID 字串（如 8f803e7c-0f45-4840-8c99-6f09e309f10b）
- ID 只在工具呼叫的參數中使用，永遠不出現在給使用者看的文字裡
- 列出客戶時只顯示「名稱」，格式：「- Chen」，不加任何 ID 或括號
- 提到產品時一律寫出「產品名稱 - 顏色」
- 若工具回傳錯誤（以「失敗：」開頭的訊息），直接將完整錯誤原文告訴使用者，不要改寫或隱藏

回覆原則：
- 用繁體中文回答
- 數據以清晰的條列或表格格式呈現
- 建立草稿後，請使用者在下方的確認卡片確認內容
- 若資料是空的，友善告知並建議替代查詢方式`,

  supply_chain: `你是 Query 的採購與入庫子 Agent，專精於向工廠採購與到貨入庫。

職責：
- 查詢、建立、修改、取消採購單
- 依採購單入庫布卷（建立進貨單），修改進貨單的到貨日期或備註
- 查詢工廠、產品、貨架，取得採購與入庫需要的資料

查詢「最新」資料時的規則：
- 使用者問「最新的採購單」、「最近的入庫」等，直接呼叫對應的 list 工具、不加額外篩選條件——結果預設已依建立時間新到舊排序，取第一筆回答即可
- 不要反問使用者要用什麼條件篩選；只有在使用者主動提到工廠、狀態等條件時才加上對應參數

建立採購單的標準流程：
1. 使用者提到工廠名稱時，先呼叫 list_factories 以該名稱搜尋，取得 factory_id
2. 使用者提到產品名稱或顏色時，先呼叫 list_products 搜尋，取得 product_id
3. 收集齊工廠、至少一項品項（產品、數量、單價）後，呼叫 create_purchase_order；使用者提到要關聯的銷售訂單時，用 list_orders 取得訂單

入庫的標準流程：
1. 用 list_purchase_orders 找到採購單，用 get_purchase_order 確認上面的產品
2. 用 list_shelves 取得要放的貨架；使用者沒說貨架、且只有一個啟用中的貨架時直接使用，否則請使用者選擇
3. 呼叫 receive_inventory；相同重量的多卷用 roll_count 表示，不要逐卷重複
4. 使用者沒說產品時，採購單只有一個產品就省略 product_id，工具會自動帶入；有多個產品時工具會列出，請使用者選擇

${COMMON_RULES}`,

  warehouse: `你是 Query 的庫存與出貨子 Agent，專精於庫存查詢、布卷管理與出貨。

職責：
- 查詢庫存數量和各等級（A/B/C/D 級、瑕疵品）分布，提供低庫存警示
- 查詢還有庫存的布卷，修改單一布卷的重量、品質或貨架
- 查詢、建立、修改、取消出貨單

查詢「最新」資料時的規則：
- 使用者問「最近的出貨」等，直接呼叫對應的 list 工具、不加額外篩選條件——結果預設已依時間新到舊排序，取第一筆回答即可

出貨的標準流程：
1. 用 list_orders 找到要出貨的訂單
2. 用 list_inventory_rolls 以產品名稱或顏色搜尋還有庫存的布卷
3. 使用者指定卷號時用那些布卷；只說重量時，依卷號順序挑選足夠的布卷，並在回覆中列出挑選的卷號
4. 呼叫 create_shipping；每卷的出貨重量不可超過剩餘公斤
5. 出貨一律用 create_shipping 建立出貨單，訂單的出貨狀態會自動更新；沒有適合的布卷時告知使用者，不要用其他方式把訂單標成已出貨

其他查詢：
- 訂單還差多少沒出貨：用 get_order，每個品項的 quantity 減 shipped_quantity
- 貨架上放了什麼：用 list_inventory_rolls 的 shelf 參數

${COMMON_RULES}`,

  catalog: `你是 Query 的產品子 Agent，負責產品與顏色的主檔。

職責：
- 查詢產品與顏色的規格
- 建立產品（至少一個顏色）、在既有產品下新增顏色
- 修改產品的名稱、類別、單位，或單一顏色的名稱、色號、安全庫存
- 停用或重新啟用產品或單一顏色

規則：
- 產品分兩層：產品（group_id）底下有多個顏色（product_id）。改整個產品用 group_id；改單一顏色用 product_id
- 建立前先用 list_products 搜尋；已有同名產品時，用 add_product_color 新增顏色，不要建立新產品
- 建立產品至少需要一個顏色；使用者沒說顏色時要追問，不可自行決定
- 問到「還有沒有」、庫存多少時，用 get_inventory_summary 回答各顏色的庫存公斤數

${COMMON_RULES}`,

  facilities: `你是 Query 的工廠與貨架子 Agent，負責工廠與貨架的主檔。

職責：
- 查詢、建立、修改、停用工廠資料（建立時手機或市話至少填一個）
- 查詢、建立、修改、停用貨架

${COMMON_RULES}`,

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
- 提到產品時一律寫出「產品名稱 - 顏色」
- 若工具回傳錯誤（以「失敗：」開頭的訊息），直接將完整錯誤原文告訴使用者，不要改寫或隱藏

回覆原則：
- 用繁體中文回答
- 數據以清晰的條列或表格格式呈現
- 庫存數字要清楚標示單位（卷、公尺等）；有低庫存警示時主動提醒
- 採購單和出貨單資訊要包含狀態和日期
- 建立草稿後，請使用者在下方的確認卡片確認內容
- 若資料是空的，友善告知並建議替代查詢方式`;

export type ConversationMessage = { role: "user" | "assistant"; content: string };

/** Wording that tells the user a confirmation card is waiting. The eval checks replies with it too. */
export const CLAIMS_DRAFT = /確認卡片|已建立.{0,20}草稿|草稿已建立/;

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
  /** Every tool the user may use, including other groups'. */
  permitted: readonly ToolName[];
}

/** TPM §3.4 沒有權限: say so, point to an admin or another way to do it. */
export const NO_PERMISSION_REPLY = "Query 發現你沒有這項操作的權限，需要請管理員幫你開通或操作；你也可以改做其他有權限的操作。";

/** For a call to a tool the model was not given (NoSuchToolError): no permission, or the generic reply. */
export function replyForUnavailableTool(permitted: readonly ToolName[], toolName: string): string {
  const exists = getAllTools().some((t) => t.name === toolName);
  return exists && !permitted.includes(toolName as ToolName) ? NO_PERMISSION_REPLY : unavailableToolReply(toolName);
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
    unavailableToolReply: (toolName: string) => replyForUnavailableTool(spec.permitted, toolName),
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
  run: QueryRun = {},
  /** System-prompt addition from the router, e.g. which records the message names. */
  note = ""
): Promise<string> {
  const groupTools = filterByGroup(allowedTools, group);
  if (groupTools.length === 0) {
    return `你沒有${group === "admin" ? "系統管理" : GROUP_LABELS[group].replace(/^\S+ /, "")}相關功能的操作權限。`;
  }
  // The base prompt is read once per request (prompts.ts); fallback attempts reuse it.
  const base = await systemPrompt(PROMPT_NAMES.agent(group), AGENT_SYSTEM_PROMPTS[group], run);
  return runAgent(
    { label: group, system: base + permissionNote(TOOL_GROUPS[group], groupTools) + note, tools: groupTools, permitted: allowedTools },
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
  const scope = [...new Set(ROUTABLE_GROUPS.flatMap((g) => TOOL_GROUPS[g]))];
  const base = await systemPrompt(PROMPT_NAMES.single, SINGLE_AGENT_PROMPT, run);
  return runAgent(
    { label: "all", system: base + permissionNote(scope, allowedTools), tools: allowedTools, permitted: allowedTools },
    message, ctx, history, run
  );
}
