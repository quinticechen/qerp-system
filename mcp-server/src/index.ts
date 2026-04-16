import http from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createUserClient } from "./supabase.js";
import { registerCustomerTools } from "./tools/customers.js";
import { registerOrderTools } from "./tools/orders.js";
import { registerProductTools } from "./tools/products.js";
import { registerInventoryTools } from "./tools/inventory.js";
import { registerPurchaseOrderTools } from "./tools/purchase-orders.js";
import { registerShippingTools } from "./tools/shipping.js";
import { registerFactoryTools } from "./tools/factories.js";
import { handleQuery } from "./agent/query-handler.js";

const PORT = parseInt(process.env.PORT || "3100", 10);

function extractJwt(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  return raw ? JSON.parse(raw) : {};
}

const httpServer = http.createServer(async (req, res) => {
  // ── Health check ──────────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // ── Auth：所有 /mcp 和 /query 都需要 JWT ──────────────────────────────────
  if (req.url === "/mcp" || req.url === "/query") {
    const jwt = extractJwt(req.headers.authorization);
    if (!jwt) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing or invalid Authorization header" }));
      return;
    }

    const supabase = createUserClient(jwt);

    // ── POST /query — AI Agent Query 入口 ────────────────────────────────────
    if (req.url === "/query" && req.method === "POST") {
      try {
        const body = await readBody(req);
        if (!body.message) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "message is required" }));
          return;
        }
        const result = await handleQuery(supabase, {
          message: body.message,
          history: body.history ?? [],
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err: any) {
        const status = err.message?.includes("Invalid or expired JWT") ? 401 : 500;
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── POST /mcp — MCP Protocol 入口（供其他 AI client 使用） ───────────────
    if (req.url === "/mcp") {
      const server = new McpServer({ name: "weave-flow-erp", version: "1.0.0" });
      registerCustomerTools(server, supabase);
      registerOrderTools(server, supabase);
      registerProductTools(server, supabase);
      registerInventoryTools(server, supabase);
      registerPurchaseOrderTools(server, supabase);
      registerShippingTools(server, supabase);
      registerFactoryTools(server, supabase);

      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);

      const body = await readBody(req);
      await transport.handleRequest(req, res, body);
      return;
    }
  }

  res.writeHead(404);
  res.end("Not Found");
});

httpServer.listen(PORT, () => {
  console.log(`Weave Flow ERP MCP Server running on http://localhost:${PORT}`);
  console.log(`  MCP Protocol: POST /mcp`);
  console.log(`  AI Query:     POST /query`);
});
