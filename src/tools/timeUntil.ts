/**
 * time_until —— 距离指定时刻（截止时间/提醒时刻）还剩多久。
 */
import { z } from "zod";
import { decomposeDuration, isValidTimezone, parseToUtcMs, snapshotNow } from "../util/time.js";

export const timeUntilSchema = {
  target: z.string().describe("目标时刻，ISO 8601（如 2026-10-01T15:30:00 或 2026-10-01 15:30:00）"),
  timezone: z.string().optional().describe("target 不带偏移时按此时区解释为墙钟时间；缺省用系统时区"),
  from: z.string().optional().describe("从哪个时刻开始算（ISO 8601），缺省为当前时刻"),
};

export async function timeUntil(args: { target: string; timezone?: string; from?: string }) {
  if (args.timezone && !isValidTimezone(args.timezone)) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: `无效时区: ${args.timezone}` }) }],
      isError: true,
    };
  }

  const targetMs = parseToUtcMs(args.target, args.timezone);
  if (targetMs === null) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: `无法解析目标时刻: ${args.target}` }) }],
      isError: true,
    };
  }

  const fromMs =
    args.from !== undefined
      ? parseToUtcMs(args.from, args.timezone)
      : Date.now();
  if (fromMs === null) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: `无法解析 from 时刻: ${args.from}` }) }],
      isError: true,
    };
  }

  const remainingMs = targetMs - fromMs;
  const dur = decomposeDuration(remainingMs);
  const now = snapshotNow(args.timezone);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            ok: true,
            target: new Date(targetMs).toISOString(),
            from: new Date(fromMs).toISOString(),
            now_iso: now.iso,
            remaining_ms: remainingMs,
            state: remainingMs < 0 ? "已过" : remainingMs === 0 ? "正好现在" : "未到",
            remaining_human: dur.human,
            remaining_compact: dur.compact,
            parts: {
              days: dur.days,
              hours: dur.hours,
              minutes: dur.minutes,
              seconds: dur.secondsRemainder,
            },
          },
          null,
          2
        ),
      },
    ],
  };
}