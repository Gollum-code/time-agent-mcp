/**
 * cron_mock —— 模拟「现在到点了吗」（给定时决策用）。
 *
 * 不启动真实定时器；只计算 now 是否命中 cron、下一次/上一次触发时刻及倒计时。
 */
import { z } from "zod";
import { evaluateCron } from "../util/cron.js";
import { isValidTimezone, parseToUtcMs, snapshotNow } from "../util/time.js";

export const cronMockSchema = {
  schedule: z
    .string()
    .describe(
      "cron 表达式（分 时 日 月 周，如 0 18 * * *）或 @daily/@hourly 宏，或 every 30 minutes 这类自然语法"
    ),
  timezone: z.string().optional().describe("按此时区评估 cron；缺省用系统时区"),
  now: z.string().optional().describe("可选：以该时刻（ISO 8601）为“现在”进行评估"),
};

export async function cronMock(args: { schedule: string; timezone?: string; now?: string }) {
  if (args.timezone && !isValidTimezone(args.timezone)) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: `无效时区: ${args.timezone}` }) }],
      isError: true,
    };
  }

  let nowMs = Date.now();
  if (args.now !== undefined) {
    const parsed = parseToUtcMs(args.now, args.timezone);
    if (parsed === null) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: `无法解析 now 时刻: ${args.now}` }) }],
        isError: true,
      };
    }
    nowMs = parsed;
  }

  let result;
  try {
    result = evaluateCron(args.schedule, args.timezone, nowMs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: `cron 解析失败: ${message}` }) }],
      isError: true,
    };
  }

  const { schedule, timing } = result;
  const now = snapshotNow(args.timezone);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            ok: true,
            schedule: args.schedule,
            parsed: schedule.expr,
            description: timing.humanSummary,
            timezone: now.timezone,
            now_iso: now.iso,
            unix_now: nowMs,
            matches_now: timing.matchesNow,
            next_run: timing.nextRun === null ? null : new Date(timing.nextRun).toISOString(),
            time_until_next_human: timing.timeUntilNext?.human ?? null,
            time_until_next_compact: timing.timeUntilNext?.compact ?? null,
            last_run: timing.lastRun === null ? null : new Date(timing.lastRun).toISOString(),
            since_last_human: timing.sinceLast?.human ?? null,
            verdict: timing.matchesNow
              ? "已到点"
              : timing.nextRun === null
                ? "未来 5 年内不会触发"
                : `未到点，${timing.timeUntilNext!.human}后触发`,
          },
          null,
          2
        ),
      },
    ],
  };
}