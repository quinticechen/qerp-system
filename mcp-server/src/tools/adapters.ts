/**
 * Adapters from the single tool source to each protocol (docs/QUERY_AGENT_PHASE0.md §4.1).
 */

import { tool, type Tool } from "ai";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RegisteredTool, ToolContext } from "./types.js";

/** Vercel AI SDK tools for /query. */
export function toAiSdkTools(defs: readonly RegisteredTool[], ctx: ToolContext): Record<string, Tool> {
  const entries = defs.map((def) => [
    def.name,
    tool({
      description: def.description,
      parameters: def.input,
      // The model sees the bare data or the error text, not the ToolResult wrapper: the
      // wrapper alone changed gemini-2.5-flash-lite's behaviour (e.g. leaking UUIDs) in evals.
      execute: async (args) => {
        const result = await def.run(ctx, args);
        return result.ok ? result.data : result.error;
      },
    }),
  ] as const);

  // Gemini (via OpenRouter) sometimes calls `default_api.<tool>` instead of the registered name,
  // so each tool is registered under that alias too.
  // Known issue F4: Anthropic rejects "." in tool names, which breaks the Haiku fallback —
  // replaced with tool-call repair in P0-6.
  const aliased = entries.map(([name, t]) => [`default_api.${name}`, t] as const);

  return Object.fromEntries([...entries, ...aliased]);
}

/** MCP tools for /mcp (endpoint disabled until P0-3 adds permission filtering). */
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
