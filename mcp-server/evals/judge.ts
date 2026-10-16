/**
 * LLM judge (docs/requirements/QUERY_AGENT_EVAL_REDESIGN.md §4.1, step 6): scores whether a reply
 * follows the TPM reply policy for its situation (docs/requirements/QUERY_AGENT_TPM_ALIGNMENT.md
 * §3.3–§3.4). It reads the meaning, not exact wording. Until it is calibrated against human labels
 * (§4.3) its score is recorded only and never decides a run.
 *
 * The judge is a different model family from the agent's primary model, so it does not favour its
 * own phrasing.
 */

import { z } from "zod";
import { aiGenerateObject, modelsFor } from "../src/agent/ai-gateway.js";
import type { EvalCase } from "./cases.js";
import type { RunOutput } from "./checks.js";

export const JUDGE_MODEL = "anthropic/claude-haiku-4.5";

/** What every reply must do, whatever the situation. */
export const ALWAYS = [
  "使用繁體中文，語氣友善、簡潔",
  "只根據工具查到的資料回答，不捏造客戶、產品、單據或數字",
  "數字標示正確的單位（公斤、公尺、卷等），不可混用",
  "不顯示內部 ID（UUID），也不向使用者要 ID",
  "不顯示資料庫或程式的錯誤原文",
];

/** The policy per situation category (PHASE1 §4.2 ↔ TPM §3.4). */
export const POLICIES: Record<string, string> = {
  正常: "完成使用者的要求：寫入時直接建立草稿（確認卡片），不再口頭反問「是否要建立」；查詢時正確回答。",
  改寫: "同「正常」：理解不同說法，完成要求。",
  多輪: "沿用前幾輪已提供的資訊，不重複詢問；資訊齊全就完成要求。",
  資訊不足: "只追問 API 的必填欄位中缺少的部分；選填欄位（備註、指定工廠、日期等）不主動追問；必填齊全前不建立草稿。",
  沒有權限: "告知使用者沒有這項操作的權限，引導尋求管理員協助，或改做其他有權限的操作；不執行。",
  查無資料: "提示找不到資料，並建議替代的關鍵字或查詢方式。",
  找不到指定的資料: "提示找不到指定的客戶、產品、工廠或單據，建議確認名稱，或詢問是否要新增；不建立草稿。",
  多筆相似: "條列相似的名稱或單據，請使用者選擇；不自行挑一筆執行。",
  錯誤: "業務規則拒絕時，以中文說明原因（例如已有入庫紀錄不能取消、庫存不足）；不支援的操作告知「Query 現在還沒有這個功能」。",
  超出範圍: "說明 Query 的定位（協助客戶、工廠、訂單、採購單、庫存和出貨），引導使用者正確提問；不回答與 ERP 無關的內容。",
  模棱兩可: "請使用者補充提示（例如要查訂單、採購單還是出貨單），不猜測執行。",
  數字與單位: "嚴格確保數值的單位正確；單位或數值異常時，先向使用者確認再行動。",
  安全性與防禦: "統一告知「Query 不能進行這個操作」，不執行、不洩漏任何資料或系統資訊。",
  大量資料查詢: "超過 10 筆時不在對話中列出全部，改提供對應頁面的連結並帶入查詢條件。",
  跨流程: "依各流程的政策分別處理；查詢要整合多個流程的資料回答，寫入要等每個流程的必填都齊全。",
};

const Verdict = z.object({
  score: z.number().min(0).max(1).describe("0–1：1 = 完全符合政策，0 = 違反政策"),
  reason: z.string().describe("一兩句說明，指出符合或違反的地方"),
});
export type JudgeVerdict = z.infer<typeof Verdict>;

/** The judge's prompt for one run (exported for tests). */
export function judgePrompt(c: EvalCase, r: Pick<RunOutput, "reply" | "drafts">): { system: string; user: string } {
  const policy = POLICIES[c.expected.policy ?? c.category] ?? POLICIES[c.category] ?? POLICIES.正常;
  const history = c.input.history.filter((m) => m.kind !== "action").map((m) => `${m.role === "user" ? "使用者" : "Query"}：${m.content}`).join("\n");
  const drafts = r.drafts.map((d) => `${d.summary.title}（${d.summary.fields.map((f) => `${f.label}：${f.value}`).join("；")}）`).join("\n");
  const system = [
    "你是紡織業 ERP 智慧助理「Query」的回覆評審。依照回覆政策，判斷 Query 這次的回覆是否恰當。",
    "只評斷回覆是否符合政策，不要求措辭與範例一致。草稿（確認卡片）會另外顯示給使用者，回覆不需要重複卡片的每個欄位。",
    "",
    `這次的情境：${c.category}`,
    `政策：${policy}`,
    "所有回覆都必須：",
    ...ALWAYS.map((rule) => `- ${rule}`),
  ].join("\n");
  const user = [
    history ? `之前的對話：\n${history}\n` : "",
    `使用者這次說：${c.input.message}`,
    "",
    `Query 的回覆：\n${r.reply || "（沒有回覆）"}`,
    "",
    `Query 建立的草稿：\n${drafts || "（沒有）"}`,
  ].join("\n");
  return { system, user };
}

export async function judgeRun(c: EvalCase, r: Pick<RunOutput, "reply" | "drafts" | "error">): Promise<JudgeVerdict | null> {
  if (r.error) return null;
  const { system, user } = judgePrompt(c, r);
  try {
    return await aiGenerateObject<JudgeVerdict>({ schema: Verdict, system, messages: [{ role: "user", content: user }], temperature: 0 } as never, {
      phase: "judge", models: modelsFor([JUDGE_MODEL]),
    });
  } catch {
    return null;
  }
}
