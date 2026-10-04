/**
 * Streamable HTTP transport（无状态模式）。
 *
 * 用于容器 / 远程部署场景（配合 --http 启动）。
 * 无状态模式：每个请求新建一个 McpServer + transport，无需维护 MCP 会话 ID；
 * 跨请求的时间状态由共享的 store（内存/文件）承担。
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

/**
 * 启动一个 Streamable HTTP MCP server（无状态）。
 * POST /mcp 处理 JSON-RPC；支持 initialize / tools/*。
 */
export async function createNodeStreamableHTTPServerTransport(
  serverFactory: () => McpServer,
  port: number,
  host = "127.0.0.1"
): Promise<void> {
  const httpServer = createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }
    if (req.url !== "/mcp") {
      res.writeHead(404).end("Not Found");
      return;
    }

    try {
      const body = await readBody(req);
      // 无状态：每次请求新建 server + transport（McpServer 一次只能连一个 transport）
      const server = serverFactory();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
        enableJsonResponse: true, // 直接 JSON 响应（无需 SSE 流）
      });
      res.on("close", () => {
        void server.close().catch(() => {});
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json", ...corsHeaders() });
      }
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: String(err) }, id: null }));
    }
  });

  await new Promise<void>((resolve) => httpServer.listen(port, host, resolve));
  process.stderr.write(`[time-agent-mcp] Streamable HTTP listening on http://${host}:${port}/mcp\n`);
}

/** 读取并解析 JSON 请求体（Node 端 handleRequest 需要 req.body）。 */
async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,mcp-session-id,last-event-id",
  };
}