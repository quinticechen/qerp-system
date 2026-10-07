/**
 * Adapters from the single tool source to each protocol (docs/QUERY_AGENT_PHASE0.md §4.1).
 */

import { tool, type Tool } from "ai";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Draft, RegisteredTool, ToolContext } from "./types.js";

export interface AiToolHooks {
  /**
   * Receives every write the model asks for. Write tools never execute in the agent loop: they
   * become drafts the user confirms on a card (docs/QUERY_AGENT_PHASE0.md §4.3).
   */
  onDraft(draft: Draft): void;
}

/** What the model is told after asking for a write. */
function draftReply(draft: Draft): string {
  const details = draft.summary.fields.map((f) => `${f.label}：${f.value}`).join("；");
  return `已建立待確認的草稿（${draft.summary.title}）：${details}。使用者在確認卡片上按「確認」後才會寫入。`;
}

/** Vercel AI SDK tools for /query. */
export function toAiSdkTools(defs: readonly RegisteredTool[], ctx: ToolContext, hooks: AiToolHooks): Record<string, Tool> {
  return Object.fromEntries(defs.map((def) => [
    def.name,
    tool({
      description: def.description,
      parameters: def.input,
      // The model sees the bare data or the error text, not the ToolResult wrapper: the
      // wrapper alone changed gemini-2.5-flash-lite's behaviour (e.g. leaking UUIDs) in evals.
      execute: async (args) => {
        if (def.kind === "write") {
          const drafted = await def.draft!(ctx, args);
          if (!drafted.ok) return drafted.error;
          hooks.onDraft(drafted.draft);
          return draftReply(drafted.draft);
        }
        const result = await def.run(ctx, args);
        return result.ok ? result.data : result.error;
      },
    }),
  ]));
}

/** MCP tools for /mcp — callers pass only the tools the user's permissions allow. */
export function registerMcpTools(server: McpServer, defs: readonly RegisteredTool[], ctx: ToolContext): void {
  for (const def of defs) {
    server.registerTool(
      def.name,
      {
        description: def.description,
        inputSchema: def.input.shape,
        annotations: { readOnlyHint: def.kind === "read" },
      },
      async (args: unknown) => {
        const result = await def.run(ctx, args);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result.ok ? result.data : result.error) }],
          isError: !result.ok,
        };
      }
    );
  }
}
