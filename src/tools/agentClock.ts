/**
 * agent_clock —— 给 Agent 的会话级计时器（开始/暂停/重置/查询）。
 */
import { z } from "zod";
import { SessionStore } from "../store/session.js";
import { ClockAction, clockElapsed, clockTransition } from "../util/clock.js";
import { decomposeDuration, isValidTimezone, snapshotNow } from "../util/time.js";

export const agentClockSchema = {
  session_id: z.string().optional().describe("会话 id，缺省 default"),
  clock_id: z.string().optional().describe("计时器 id，缺省 main；同一会话下可建多个计时器"),
  action: z
    .enum(["start", "pause", "resume", "reset", "status"])
    .describe("操作：start 开始/重开；pause 暂停；resume 恢复；reset 清零；status 仅查询"),
  timezone: z.string().optional().describe("返回时间所用 IANA 时区，缺省系统时区"),
};

const ACTION_LABEL: Record<ClockAction, string> = {
  start: "开始",
  pause: "暂停",
  resume: "恢复",
  reset: "重置",
  status: "查询",
};

export async function agentClock(
  store: SessionStore,
  args: { session_id?: string; clock_id?: string; action?: ClockAction; timezone?: string }
) {
  const sessionId = args.session_id ?? "default";
  const clockId = args.clock_id ?? "main";
  const action: ClockAction = args.action ?? "status";

  if (args.timezone && !isValidTimezone(args.timezone)) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: `无效时区: ${args.timezone}` }) }],
      isError: true,
    };
  }

  const now = Date.now();
  const prev = store.getOrCreateClock(sessionId, clockId, now);
  const next = clockTransition(prev, action, now);
  store.setClock(sessionId, clockId, next);

  const elapsedMs = clockElapsed(next, now);
  const elapsed = decomposeDuration(elapsedMs);
  const runningSegmentMs = next.state === "running" && next.startedAt !== null ? now - next.startedAt : 0;
  const nowSnapshot = snapshotNow(args.timezone);

  const stateName: Record<string, string> = {
    idle: "未开始",
    running: "计时中",
    paused: "已暂停",
  };

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            ok: true,
            session_id: sessionId,
            clock_id: clockId,
            action,
            action_label: ACTION_LABEL[action],
            state: next.state,
            state_label: stateName[next.state],
            elapsed_ms: elapsedMs,
            elapsed_human: elapsed.human,
            elapsed_compact: elapsed.compact,
            parts: {
              days: elapsed.days,
              hours: elapsed.hours,
              minutes: elapsed.minutes,
              seconds: elapsed.secondsRemainder,
            },
            accumulated_ms: next.accumulatedMs,
            running_segment_ms: runningSegmentMs,
            started_at: next.startedAt === null ? null : new Date(next.startedAt).toISOString(),
            paused_at: next.pausedAt === null ? null : new Date(next.pausedAt).toISOString(),
            updated_at: new Date(next.updatedAt).toISOString(),
            now_iso: nowSnapshot.iso,
            unix_now: now,
          },
          null,
          2
        ),
      },
    ],
  };
}