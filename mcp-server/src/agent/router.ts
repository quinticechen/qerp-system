import { z } from "zod";
import { ToolName, TOOL_GROUPS, GROUP_LABELS, ROUTABLE_GROUPS, type RoutableGroup } from "./permissions.js";
import { runSubAgent, ConversationMessage } from "./sub-agents.js";
import { aiGenerateObject } from "./ai-gateway.js";
import type { QueryRun } from "./observer.js";
import { redactIds } from "./output-guard.js";
import { findNames, nameNote } from "./name-hints.js";
import { PROMPT_NAMES, systemPrompt } from "./prompts.js";
import type { ToolContext } from "../tools/types.js";

export const ROUTER_SYSTEM_PROMPT = `你是 Query ERP 助理的路由器，負責分析使用者意圖並決定調用哪個子 Agent。

可用的子 Agent：
- commercial：客戶管理（查詢、建立、修改、停用客戶）、銷售訂單（查詢、建立、修改、取消）
- supply_chain：採購單（查詢、建立、修改、取消）、到貨入庫與進貨單
- warehouse：庫存查詢、低庫存警示、布卷、出貨單（查詢、建立、修改、取消）
- catalog：產品與顏色的主檔（查詢規格、建立、修改、停用）
- facilities：工廠與貨架的主檔（查詢、建立、修改、停用）

判斷規則：
- 依使用者要做的事選擇負責的子 Agent；只是需要查詢其他領域的資料（例如建訂單時找產品、出貨時找訂單）不需要另外加 agent，負責的子 Agent 自己查得到
- 同時要求兩件不同領域的事（例如開訂單並下採購單）→ 同時包含兩個
- 若對話歷史正在進行「新增/建立/修改」操作（例如：新增訂單、建立客戶），當前訊息一定是該流程的延續，沿用相同的 agent，不要新增其他 agent

特別注意：
- 「新增訂單」「建立訂單」「下訂單」屬於 commercial，不是 supply_chain
- 「向工廠下單」「採購」屬於 supply_chain；「入庫」「到貨」屬於 supply_chain；「出貨」「庫存」「還有沒有貨」「訂單出貨了沒、還差多少」屬於 warehouse
- 訂單上的「指定工廠」仍只屬於 commercial；只有使用者要向工廠下採購單時才加上 supply_chain
- 採購單的「關聯訂單」只屬於 supply_chain（建立採購單時訂單狀態會自動更新），不要另外交給 commercial
- 工廠的查詢、新增、修改、停用（例如「不要合作了」）屬於 facilities；貨架的新增、修改、停用屬於 facilities，貨架上放了哪些布卷屬於 warehouse
- 名稱是客戶還是工廠，依下方「訊息中提到的名稱」判斷；不確定時不要當成客戶
- 一件事只交給一個子 Agent，不要讓兩個子 Agent 做同一件事：建立、修改、停用工廠（例如「建一個代工廠」）只交給 facilities；布卷改放別的貨架、改品級、改重量只交給 warehouse（這是修改布卷，不是修改貨架）
- 入庫流程進行中的後續訊息（例如補充重量、貨架）只交給 supply_chain
- 若對話歷史中包含「請提供客戶名稱」或「請問您要為哪位客戶建立訂單」，則當前訊息是客戶選擇回應，只路由到 commercial
- 單一字元或短名稱（如 "c"、"Chen"）在訂單建立流程中代表客戶名稱輸入，只路由到 commercial

tasks 的描述要具體，包含使用者原始請求的關鍵資訊（如名稱、數量、條件等）。`;

const routerSchema = z.object({
  agents: z.array(z.enum(ROUTABLE_GROUPS)).min(1),
  tasks: z.object(Object.fromEntries(ROUTABLE_GROUPS.map((g) => [g, z.string().optional()])) as Record<RoutableGroup, z.ZodOptional<z.ZodString>>),
});

type RouterDecision = z.infer<typeof routerSchema>;

/**
 * What a sub-agent is asked. The router's rewritten task alone lost details the user gave (F1:
 * the factory of an order, a customer from the history), so the sub-agent gets the user's own
 * message, and its part of it when several agents share the message.
 */
export function subAgentMessage(message: string, task: string | undefined, agentCount: number): string {
  if (agentCount === 1 || !task) return message;
  return `${message}\n\n（這則訊息由多個助理分工處理，你只負責：${task}）`;
}

/**
 * Router Agent — 用 generateObject 做結構化意圖分類，比解析 JSON 字串可靠
 */
export async function routeQuery(
  message: string,
  ctx: ToolContext,
  allowedTools: ToolName[],
  history: ConversationMessage[] = [],
  run: QueryRun = {}
): Promise<string> {
  const { observer } = run;
  const availableGroups = ROUTABLE_GROUPS.filter(
    (group) => TOOL_GROUPS[group].some((tool) => allowedTools.includes(tool))
  );

  if (availableGroups.length === 0) {
    return "很抱歉，你目前沒有任何操作權限。請聯繫系統管理員。";
  }

  const names = nameNote(await findNames(ctx, message));
  // Read outside the try below: a prompt an eval requires must fail the run, not route to a fallback.
  const routerPrompt = await systemPrompt(PROMPT_NAMES.router, ROUTER_SYSTEM_PROMPT, run);

  // Router：結構化輸出，直接得到 JSON 物件，不需要解析字串
  let decision: RouterDecision;
  try {
    // Include recent history (last 6 turns) so the router can detect ongoing flows
    const recentHistory = history.slice(-6).map(
      (m) => ({ role: m.role as "user" | "assistant", content: m.content })
    );
    decision = await aiGenerateObject<RouterDecision>({
      schema: routerSchema,
      system: routerPrompt + names,
      messages: [
        ...recentHistory,
        { role: "user" as const, content: message },
      ],
    } as any, { ...run, phase: "router" });
    observer?.onRoute?.(decision, false);
  } catch {
    // 分類失敗時 fallback：用第一個可用群組
    decision = {
      agents: [availableGroups[0]],
      tasks: { [availableGroups[0]]: message },
    };
    observer?.onRoute?.(decision, true);
  }

  // 過濾掉用戶沒有權限的 agent
  const authorizedAgents = decision.agents.filter((a) =>
    availableGroups.includes(a)
  );

  if (authorizedAgents.length === 0) {
    return "你沒有執行此操作所需的權限。";
  }

  // 並行呼叫子 Agent — allSettled so one failing agent doesn't discard the other's answer
  const settled = await Promise.allSettled(
    authorizedAgents.map((agent) =>
      runSubAgent(
        agent,
        subAgentMessage(message, decision.tasks?.[agent], authorizedAgents.length),
        allowedTools,
        ctx,
        history,
        run,
        names
      )
    )
  );

  if (settled.every((s) => s.status === "rejected")) {
    throw (settled[0] as PromiseRejectedResult).reason;
  }

  const results = settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    console.error(`[Router] ${authorizedAgents[i]} 子 Agent 失敗:`, s.reason);
    return "⚠️ 這部分處理時發生錯誤，請稍後再試或換個方式描述。";
  });

  if (results.length === 1) return redactIds(results[0]);

  // 多 Agent 合併結果
  return redactIds(results
    .map((result, i) => {
      return `**${GROUP_LABELS[authorizedAgents[i]]}**\n${result}`;
    })
    .join("\n\n---\n\n"));
}
