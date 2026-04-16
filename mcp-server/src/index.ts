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

const PORT = parseInt(process.env.PORT || "3100", 10);

function extractJwt(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}

const httpServer = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (req.url !== "/mcp") {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  const jwt = extractJwt(req.headers.authorization);
  if (!jwt) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing or invalid Authorization header" }));
    return;
  }

  // 每個 request 建立獨立的 Supabase client（帶使用者 JWT）
  const supabase = createUserClient(jwt);

  // 每個 request 建立獨立的 McpServer（stateless）
  const server = new McpServer({ name: "weave-flow-erp", version: "1.0.0" });
  registerCustomerTools(server, supabase);
  registerOrderTools(server, supabase);
  registerProductTools(server, supabase);
  registerInventoryTools(server, supabase);
  registerPurchaseOrderTools(server, supabase);
  registerShippingTools(server, supabase);
  registerFactoryTools(server, supabase);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
  });

  await server.connect(transport);

  // 讀取 request body
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());

  await transport.handleRequest(req, res, body);
});

httpServer.listen(PORT, () => {
  console.log(`Weave Flow ERP MCP Server running on http://localhost:${PORT}/mcp`);
});
