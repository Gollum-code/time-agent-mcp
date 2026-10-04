#!/usr/bin/env node
/**
 * time-agent-mcp —— 给没有时间感的 LLM 装一个时钟。
 *
 * 启动方式：
 *   node dist/server.js                  → stdio（MCP 客户端默认接入）
 *   node dist/server.js --http --port 8787 → Streamable HTTP（容器/远程部署）
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer, VERSION } from "./app.js";
import { createNodeStreamableHTTPServerTransport } from "./http.js";

async function main() {
  const argv = process.argv.slice(2);
  const useHttp = argv.includes("--http") || process.env.TIME_AGENT_HTTP === "1";
  const portArg = argv.indexOf("--port");
  const port =
    portArg !== -1 && argv[portArg + 1]
      ? Number(argv[portArg + 1])
      : Number(process.env.TIME_AGENT_PORT ?? 8787);

  if (!useHttp) {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write(`[time-agent-mcp] v${VERSION} started (stdio)\n`);
    return;
  }

  await createNodeStreamableHTTPServerTransport(createServer, port);
}

main().catch((err) => {
  process.stderr.write(`[time-agent-mcp] fatal: ${err?.message ?? err}\n`);
  process.exit(1);
});