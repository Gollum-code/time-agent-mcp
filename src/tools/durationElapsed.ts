/**
 * duration_elapsed —— 任务从何时开始、已过去多久。
 *
 * 语义：第一次对 (sessionId, taskId) 调用时记录起始时刻并返回 0；
 * 之后每次调用返回「现在 - 起始时刻」。reset=true 重新计时。
 */
import { z } from "zod";
import { buildDurationResult, SessionStore } from "../store/session.js";
import { err, ok } from "../util/result.js";
import { isValidTimezone, parseToUtcMs, snapshotNow } from "../util/time.js";

export const durationElapsedSchema = {
  session_id: z
    .string()
    .optional()
    .describe("会话 id，缺省为 default（同一 MCP 连接内默认使用一个会话）"),
  task_id: z
    .string()
    .optional()
    .describe("任务 id，用于区分同一会话下的多个任务，缺省为 main"),
  started_at: z
    .string()
    .optional()
    .describe("可选：手动指定任务的起始时刻（ISO 8601 字符串）。不给则首次调用自动记录为当前时刻"),
  reset: z
    .boolean()
    .optional()
    .describe("重置该任务的起始时刻为当前（或 started_at），作为新一轮计时开始"),
  label: z
    .string()
    .optional()
    .describe("可选任务描述，原样返回给调用方"),
  timezone: z.string().optional().describe("结果显示所用 IANA 时区，缺省系统时区"),
};

export async function durationElapsed(
  store: SessionStore,
  args: {
    session_id?: string;
    task_id?: string;
    started_at?: string;
    reset?: boolean;
    label?: string;
    timezone?: string;
  }
) {
  const sessionId = args.session_id ?? "default";
  const taskId = args.task_id ?? "main";
  const nowTs = Date.now();

  const tz = args.timezone;
  if (tz && !isValidTimezone(tz)) {
    return err(`无效时区: ${tz}`);
  }

  let startedMs: number;
  let isFirstCall = false;

  if (args.started_at !== undefined) {
    const parsed = parseToUtcMs(args.started_at, args.timezone);
    if (parsed === null) {
      return err(`无法解析起始时刻: ${args.started_at}`);
    }
    startedMs = parsed;
    store.startTask(sessionId, taskId, startedMs);
  } else if (args.reset) {
    startedMs = nowTs;
    store.startTask(sessionId, taskId, startedMs);
  } else {
    const existing = store.getTaskStart(sessionId, taskId);
    if (existing === null) {
      startedMs = nowTs;
      store.startTask(sessionId, taskId, startedMs);
      isFirstCall = true;
    } else {
      startedMs = existing;
    }
  }

  const result = buildDurationResult(sessionId, taskId, startedMs, nowTs, isFirstCall, args.label);
  const now = snapshotNow(tz);
  return ok({
    ok: true,
    session_id: result.sessionId,
    task_id: result.taskId,
    label: result.label,
    first_call: result.isFirstCall,
    started_at: result.startedIso,
    now_iso: now.iso,
    unix_now: result.now,
    elapsed_ms: result.elapsedMs,
    elapsed_human: result.elapsed.human,
    elapsed_compact: result.elapsed.compact,
    parts: {
      days: result.elapsed.days,
      hours: result.elapsed.hours,
      minutes: result.elapsed.minutes,
      seconds: result.elapsed.secondsRemainder,
    },
  });
}