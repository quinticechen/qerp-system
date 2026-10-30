/**
 * Summary — one reply from the results of several sub-agents
 * (docs/requirements/QUERY_AGENT_EVAL_REDESIGN.md §8, decisions A1–A3).
 *
 * Runs only when the router gave the message to two or more sub-agents; a single sub-agent still
 * answers the user itself. The summary has no tools: it reasons over what the sub-agents found and
 * drafted, and can neither create nor change drafts.
 */

import { aiGenerateText } from "./ai-gateway.js";
import { GROUP_LABELS } from "./permissions.js";
import { PROMPT_NAMES, systemPrompt } from "./prompts.js";
import { CLAIMS_DRAFT, type ConversationMessage, type SubAgentResult } from "./sub-agents.js";
import type { QueryRun } from "./observer.js";

export const SUMMARY_SYSTEM_PROMPT = `你是 Query ERP 助理的回覆彙整者。使用者的一則訊息由多個助理分工處理，你會看到使用者的訊息、最近的對話，以及每個助理的結果：負責的部分、查到的事實、缺少的必填欄位、建立的草稿與工具回傳的錯誤。請根據這些結果，寫一則給使用者的回覆。

規則：
- 只根據助理的結果回答，不可補上結果裡沒有的資料；需要跨流程判斷時（例如庫存夠不夠出貨、採購量夠不夠訂單），用結果中的數字推理並說明依據
- 整合成一則回覆：不要依助理分段，不要提到「助理」「分工」「彙整」
- 有建立草稿時，簡短說明草稿內容，請使用者在下方的確認卡片確認；沒有建立任何草稿時，絕對不可提到確認卡片，也不可說已建立
- 草稿還沒寫入：不可說「已建立」「已完成」「已取消」單據
- 有缺少的必填欄位時，一次問清楚；選填欄位不要追問
- 工具回傳錯誤時，以中文說明原因（業務規則的拒絕照原因說明）；有一部分沒有完成時，說明是哪一部分
- 絕對不要顯示任何 UUID 或 ID
- 用繁體中文；數字標示單位（公斤、公尺、卷）；資料以條列或表格清楚呈現`;

/** A sub-agent that failed outright (every model failed, a tool threw). */
export interface FailedSubAgent {
  group: SubAgentResult["group"];
  task: string;
  failed: true;
}

const label = (group: SubAgentResult["group"]) => (GROUP_LABELS as Record<string, string>)[group] ?? group;

const describe = (r: SubAgentResult | FailedSubAgent) =>
  "failed" in r
    ? { 負責: label(r.group), 任務: r.task, 結果: "這部分處理失敗，沒有結果" }
    : {
        負責: label(r.group),
        任務: r.task,
        回報: r.report,
        建立的草稿: r.drafts.length ? r.drafts.map((d) => `${d.title}：${d.fields.map((f) => `${f.label} ${f.value}`).join("；")}`) : "無",
        工具錯誤: r.toolErrors.length ? r.toolErrors : "無",
      };

/** The user-facing reply for a message several sub-agents handled. */
export async function summarize(
  message: string,
  history: ConversationMessage[],
  results: (SubAgentResult | FailedSubAgent)[],
  run: QueryRun = {}
): Promise<string> {
  const base = await systemPrompt(PROMPT_NAMES.summary, SUMMARY_SYSTEM_PROMPT, run);
  const drafted = results.some((r) => !("failed" in r) && r.drafts.length > 0);
  const content = `使用者的訊息：${message}\n\n各助理的結果：\n${JSON.stringify(results.map(describe), null, 2)}`;
  try {
    const result = await aiGenerateText({
      system: base.text,
      messages: [...history.slice(-6).map((m) => ({ role: m.role, content: m.content })), { role: "user" as const, content }],
    } as never, {
      ...run,
      phase: "summary",
      prompt: base.link,
      validate: (text) => (!drafted && CLAIMS_DRAFT.test(text) ? "回覆提到確認卡片，但沒有建立任何草稿" : null),
    });
    return result.text;
  } catch (err) {
    // The drafts exist already; keep them and fall back to the reports rather than fail the request.
    console.error("[Summary] 彙整失敗，改用各助理的回報:", err);
    return fallbackReply(results);
  }
}

/** Each sub-agent's report under its label — what the user saw before the summary step. */
export function fallbackReply(results: (SubAgentResult | FailedSubAgent)[]): string {
  return results
    .map((r) => `**${label(r.group)}**\n${"failed" in r ? "⚠️ 這部分處理時發生錯誤，請稍後再試或換個方式描述。" : r.report}`)
    .join("\n\n---\n\n");
}
