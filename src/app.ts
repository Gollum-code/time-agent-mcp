/**
 * MCP Server 定义：注册全部时间感知工具。
 *
 * createServer() 为工厂函数：HTTP 无状态模式下每个请求需要一个独立实例
 * （McpServer 一次只能连接一个 transport），stdio 模式则全局单例即可。
 * 共享的 store 让跨请求/跨连接的会话时间状态保持连续。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { SessionStore } from "./store/session.js";
import { currentTime, currentTimeSchema } from "./tools/currentTime.js";
import { durationElapsed, durationElapsedSchema } from "./tools/durationElapsed.js";
import { timeUntil, timeUntilSchema } from "./tools/timeUntil.js";
import { timezoneConvert, timezoneConvertSchema } from "./tools/timezoneConvert.js";
import { sessionPing, sessionPingSchema } from "./tools/sessionPing.js";
import { cronMock, cronMockSchema } from "./tools/cronMock.js";
import { agentClock, agentClockSchema } from "./tools/agentClock.js";

export const VERSION = "0.3.0";

/** 全局共享 store（跨 server 实例保持会话状态）。 */
export const store = new SessionStore();

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "time-agent-mcp", version: VERSION },
    {
      instructions:
        "本 Server 为 LLM/Agent 提供时间感知能力：当模型需要知道「现在几点」「任务跑了多久」「距离某时刻还剩多久」「多时区换算」「到点了吗」时调用。返回结构化 JSON（含 ISO 8601 + unix 毫秒）。",
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

  server.tool(
    "cron_mock",
    "定时决策：判断「现在到点了吗」（cron / @宏 / every 30 minutes），返回是否命中、下次与上次触发时刻及倒计时。不启动真实定时器。",
    cronMockSchema,
    async (args) => cronMock(args)
  );

  server.tool(
    "agent_clock",
    "会话级计时器：start 开始 / pause 暂停 / resume 恢复 / reset 清零 / status 查询，返回累计计时与中文可读时长。",
    agentClockSchema,
    async (args) => agentClock(store, args)
  );

  return server;
}