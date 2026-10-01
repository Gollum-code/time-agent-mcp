#!/usr/bin/env node
/**
 * time-agent-mcp —— 给没有时间感的 LLM 装一个时钟。
 *
 * stdio MCP Server。零外部运行时依赖（时间源=系统时钟，时区=IANA/Intl）。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { SessionStore } from "./store/session.js";
import { currentTime, currentTimeSchema } from "./tools/currentTime.js";
import { durationElapsed, durationElapsedSchema } from "./tools/durationElapsed.js";
import { timeUntil, timeUntilSchema } from "./tools/timeUntil.js";
import { timezoneConvert, timezoneConvertSchema } from "./tools/timezoneConvert.js";
import { sessionPing, sessionPingSchema } from "./tools/sessionPing.js";

const VERSION = "0.1.0";
const store = new SessionStore();

const server = new McpServer(
  { name: "time-agent-mcp", version: VERSION },
  {
    instructions:
      "本 Server 为 LLM/Agent 提供时间感知能力：当模型需要知道「现在几点」「任务跑了多久」「距离某时刻还剩多久」「多时区换算」时调用。返回结构化 JSON（含 ISO 8601 + unix 毫秒）。",
  }
);

server.tool(
  "current_time",
  "返回当前时间、日期、星期、时区与 UTC 偏移（现在几点/几号/周几/时区）。",
  currentTimeSchema,
  async (args) => currentTime(args)
);

server.tool(
  "duration_elapsed",
  "任务时长感知：记录任务起始时刻并返回「已过去多久」。首次调用自动开始计时，后续调用返回累计时长；可用 reset=true 重新计时。",
  durationElapsedSchema,
  async (args) => durationElapsed(store, args)
);

server.tool(
  "time_until",
  "倒计时：计算距离目标/截止时刻还剩多久（目标已过则返回已过时长）。",
  timeUntilSchema,
  async (args) => timeUntil(args)
);

server.tool(
  "timezone_convert",
  "多时区换算：把某一时刻从源时区换算到目标时区，返回目标时区的本地时间与偏移差。",
  timezoneConvertSchema,
  async (args) => timezoneConvert(args)
);

server.tool(
  "session_ping",
  "会话心跳：每次对话调用一次，更新时间戳并返回距上次对话间隔与本会话总时长，让模型感知对话间隔。",
  sessionPingSchema,
  async (args) => sessionPing(store, args)
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[time-agent-mcp] v${VERSION} started (stdio)\n`);
}

main().catch((err) => {
  process.stderr.write(`[time-agent-mcp] fatal: ${err?.message ?? err}\n`);
  process.exit(1);
});