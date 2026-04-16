import { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ToolName, TOOL_GROUPS } from "./permissions.js";
import { runSubAgent, ConversationMessage } from "./sub-agents.js";
import { aiGenerateObject } from "./ai-gateway.js";

const ROUTER_SYSTEM_PROMPT = `你是 Query ERP 助理的路由器，負責分析使用者意圖並決定調用哪個子 Agent。

可用的子 Agent：
- commercial：負責客戶管理、訂單管理、產品查詢
- supply_chain：負責庫存管理、採購單、出貨記錄、工廠資訊

判斷規則：
- 客戶、訂單、產品相關 → commercial
- 庫存、採購單、出貨、工廠相關 → supply_chain
- 涉及多個領域 → 同時包含兩個

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
  allowedTools: ToolName[],
  supabase: SupabaseClient,
  history: ConversationMessage[] = []
): Promise<string> {
  const availableGroups = (["commercial", "supply_chain"] as const).filter(
    (group) => TOOL_GROUPS[group].some((tool) => allowedTools.includes(tool))
  );

  if (availableGroups.length === 0) {
    return "很抱歉，你目前沒有任何操作權限。請聯繫系統管理員。";
  }

  // Router：結構化輸出，直接得到 JSON 物件，不需要解析字串
  let decision: RouterDecision;
  try {
    decision = await aiGenerateObject<RouterDecision>({
      schema: routerSchema,
      system: ROUTER_SYSTEM_PROMPT,
      messages: [{ role: "user" as const, content: message }],
    } as any);
  } catch {
    // 分類失敗時 fallback：用第一個可用群組
    decision = {
      agents: [availableGroups[0]],
      tasks: { [availableGroups[0]]: message },
    };
  }

  // 過濾掉用戶沒有權限的 agent
  const authorizedAgents = decision.agents.filter((a) =>
    availableGroups.includes(a)
  );

  if (authorizedAgents.length === 0) {
    return "你沒有執行此操作所需的權限。";
  }

  // 並行呼叫子 Agent
  const results = await Promise.all(
    authorizedAgents.map((agent) =>
      runSubAgent(
        agent,
        decision.tasks?.[agent] ?? message,
        allowedTools,
        supabase,
        history
      )
    )
  );

  if (results.length === 1) return results[0];

  // 多 Agent 合併結果
  return results
    .map((result, i) => {
      const label = authorizedAgents[i] === "commercial" ? "📋 商務管理" : "📦 供應鏈";
      return `**${label}**\n${result}`;
    })
    .join("\n\n---\n\n");
}
