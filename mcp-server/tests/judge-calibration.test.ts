/**
 * Judge calibration helpers (evals/judge-calibration.ts): which runs go to the annotation queue and
 * how agreement is counted. No network.
 * Run: bun run test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { agreement, JUDGE_PROMPT, pickRuns } from "../evals/judge-calibration.js";
import type { EvalReport } from "../evals/report.js";

const result = (caseId: string, run: number, pass: boolean, error?: string) => ({ caseId, run, pass, ...(error ? { error } : {}) });

test("runs to label are spread over categories, mix passing and failing, one per case first", () => {
  const report = {
    cases: [
      { id: "a1", category: "正常" }, { id: "a2", category: "正常" }, { id: "a3", category: "正常" },
      { id: "b1", category: "沒有權限" },
    ],
    results: [
      result("a1", 1, true), result("a1", 2, false), result("a2", 1, true), result("a3", 1, false),
      result("b1", 1, true), result("b1", 2, true, "timeout"),
    ],
  } as unknown as Pick<EvalReport, "cases" | "results">;
  const picked = pickRuns(report, 3);
  assert.deepEqual(picked, [{ caseId: "a3", run: 1 }, { caseId: "b1", run: 1 }, { caseId: "a1", run: 1 }]);
  assert.ok(!pickRuns(report).some((p) => p.caseId === "b1" && p.run === 2), "failed runs (errors) are not labelled");
});

test("agreement is counted overall and per category", () => {
  const { overall, byCategory } = agreement([
    { category: "正常", match: true }, { category: "正常", match: false }, { category: "錯誤", match: true }, { category: "錯誤", match: true },
  ]);
  assert.equal(overall, 0.75);
  assert.deepEqual(byCategory, { 正常: { rate: 0.5, n: 2 }, 錯誤: { rate: 1, n: 2 } });
});

test("the judge prompt has the variables a Langfuse evaluator maps", () => {
  assert.match(JUDGE_PROMPT, /\{\{input\}\}/);
  assert.match(JUDGE_PROMPT, /\{\{output\}\}/);
});
