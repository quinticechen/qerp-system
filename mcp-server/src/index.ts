import http from "http";
import { createUserClient } from "./supabase.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { handleQuery } from "./agent/query-handler.js";
import { authGuard, AccessError } from "./agent/auth-guard.js";
import { getTools } from "./tools/index.js";
import { registerMcpTools } from "./tools/adapters.js";

const PORT = parseInt(process.env.PORT || "3100", 10);

// Origins allowed to call this server from a browser
const ALLOWED_ORIGINS = new Set([
  "http://localhost:8080",
  "http://localhost:5174",
  "http://localhost:3000",
  "https://qerp.qwizai.com",
]);

function setCorsHeaders(req: http.IncomingMessage, res: http.ServerResponse) {
  const origin = req.headers.origin ?? "";
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : "";
  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", allowed);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Organization-Id");
  res.setHeader("Access-Control-Max-Age", "86400");
}

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

function sendError(res: http.ServerResponse, err: unknown) {
  const status = err instanceof AccessError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: message }));
}

const httpServer = http.createServer(async (req, res) => {
  setCorsHeaders(req, res);

  // ── CORS preflight ────────────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

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
          organizationId: body.organization_id,
          history: body.history ?? [],
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err: unknown) {
        sendError(res, err);
      }
      return;
    }

    // ── POST /mcp — MCP Protocol 入口（供其他 AI client 使用） ───────────────
    // 組織以 X-Organization-Id header 指定；與 /query 相同的權限過濾。
    if (req.url === "/mcp") {
      try {
        const access = await authGuard(supabase, req.headers["x-organization-id"]);
        const server = new McpServer({ name: "weave-flow-erp", version: "1.0.0" });
        registerMcpTools(server, getTools(access.allowedTools), {
          supabase,
          userId: access.userId,
          organizationId: access.organizationId,
        });

        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        await server.connect(transport);

        const body = await readBody(req);
        await transport.handleRequest(req, res, body);
      } catch (err: unknown) {
        if (!res.headersSent) sendError(res, err);
      }
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
