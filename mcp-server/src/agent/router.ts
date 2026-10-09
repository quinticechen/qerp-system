import { z } from "zod";
import { ToolName, TOOL_GROUPS } from "./permissions.js";
import { runSubAgent, ConversationMessage } from "./sub-agents.js";
import { aiGenerateObject } from "./ai-gateway.js";
import type { QueryRun } from "./observer.js";
import { redactIds } from "./output-guard.js";
import type { ToolContext } from "../tools/types.js";

export const ROUTER_SYSTEM_PROMPT = `你是 Query ERP 助理的路由器，負責分析使用者意圖並決定調用哪個子 Agent。

可用的子 Agent：
- commercial：負責客戶管理、訂單管理、產品查詢
- supply_chain：負責庫存管理、採購單、出貨記錄、工廠資訊

判斷規則：
- 客戶、訂單、產品相關 → 僅 commercial
- 庫存、採購單、出貨、工廠相關 → 僅 supply_chain
- 同時涉及兩個領域 → 同時包含兩個
- 若對話歷史正在進行「新增/建立」操作（例如：新增訂單、建立客戶），當前訊息一定是該流程的延續，沿用相同的 agent，不要新增其他 agent

特別注意：
- 「新增訂單」「建立訂單」「下訂單」屬於 commercial，不是 supply_chain
- 若對話歷史中包含「請提供客戶名稱」或「請問您要為哪位客戶建立訂單」，則當前訊息是客戶選擇回應，只路由到 commercial
- 單一字元或短名稱（如 "c"、"Chen"）在訂單建立流程中代表客戶名稱輸入，只路由到 commercial

tasks 的描述要具體，包含使用者原始請求的關鍵資訊（如名稱、條件等）。`;

const routerSchema = z.object({
  agents: z.array(z.enum(["commercial", "supply_chain"])).min(1),
  tasks: z.object({
    commercial: z.string().optional(),
    supply_chain: z.string().optional(),
  }),
});

type RouterDecision = z.infer<typeof routerSchema>;

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
  const availableGroups = (["commercial", "supply_chain"] as const).filter(
    (group) => TOOL_GROUPS[group].some((tool) => allowedTools.includes(tool))
  );

  if (availableGroups.length === 0) {
    return "很抱歉，你目前沒有任何操作權限。請聯繫系統管理員。";
  }

  // Router：結構化輸出，直接得到 JSON 物件，不需要解析字串
  let decision: RouterDecision;
  try {
    // Include recent history (last 6 turns) so the router can detect ongoing flows
    const recentHistory = history.slice(-6).map(
      (m) => ({ role: m.role as "user" | "assistant", content: m.content })
    );
    decision = await aiGenerateObject<RouterDecision>({
      schema: routerSchema,
      system: ROUTER_SYSTEM_PROMPT,
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
        decision.tasks?.[agent] ?? message,
        allowedTools,
        ctx,
        history,
        run
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
      const label = authorizedAgents[i] === "commercial" ? "📋 商務管理" : "📦 供應鏈";
      return `**${label}**\n${result}`;
    })
    .join("\n\n---\n\n"));
}
