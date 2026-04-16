/**
 * AI Gateway — Provider-Agnostic 層
 *
 * 底層統一指向 OpenRouter，可隨時換成任何相容 provider。
 * 模型優先級：主模型失敗自動降級，不影響上層業務邏輯。
 */

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, generateObject } from "ai";
import type { LanguageModelV1 } from "@ai-sdk/provider";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
});

// 模型優先級清單（由上往下降級）
const MODEL_PRIORITY = [
  "google/gemini-2.5-flash-lite",       // 主力：快、便宜
  "google/gemini-2.0-flash",            // 降級 1：同家族
  "anthropic/claude-haiku-4-5-20251001", // 降級 2：不同 provider
] as const;

function getModel(modelId: string): LanguageModelV1 {
  return openrouter(modelId) as unknown as LanguageModelV1;
}

type GenerateTextOptions = Omit<Parameters<typeof generateText>[0], "model">;
type GenerateObjectOptions<T> = Omit<Parameters<typeof generateObject>[0], "model">;

/**
 * 帶自動 fallback 的 generateText
 * 主模型掛掉會自動嘗試下一個，對上層完全透明
 */
export async function aiGenerateText(options: GenerateTextOptions) {
  let lastError: Error | null = null;

  for (const modelId of MODEL_PRIORITY) {
    try {
      const result = await generateText({
        ...options,
        model: getModel(modelId),
      });
      if (modelId !== MODEL_PRIORITY[0]) {
        console.warn(`[AI Gateway] 使用降級模型: ${modelId}`);
      }
      return result;
    } catch (err: any) {
      lastError = err;
      console.warn(`[AI Gateway] ${modelId} 失敗: ${err.message}`);
    }
  }

  throw lastError ?? new Error("All AI models failed");
}

/**
 * 帶自動 fallback 的 generateObject（結構化輸出）
 */
export async function aiGenerateObject<T>(
  options: GenerateObjectOptions<T>
): Promise<T> {
  let lastError: Error | null = null;

  for (const modelId of MODEL_PRIORITY) {
    try {
      const result = await generateObject({
        ...(options as any),
        model: getModel(modelId),
      });
      return (result as any).object as T;
    } catch (err: any) {
      lastError = err;
      console.warn(`[AI Gateway] generateObject ${modelId} 失敗: ${err.message}`);
    }
  }

  throw lastError ?? new Error("All AI models failed");
}
