/**
 * timezone_convert —— 任意时区换算（用户在东京，队友在纽约）。
 */
import { z } from "zod";
import { err, ok } from "../util/result.js";
import { isValidTimezone, parseToUtcMs, toZonedSnapshot } from "../util/time.js";

export const timezoneConvertSchema = {
  to_timezone: z.string().describe("目标 IANA 时区，如 America/New_York、Asia/Tokyo"),
  from_timezone: z.string().optional().describe("源 IANA 时区；缺省用系统时区"),
  time: z.string().optional().describe("要换算的时刻（ISO 8601），缺省为当前时刻"),
};

export async function timezoneConvert(args: {
  to_timezone: string;
  from_timezone?: string;
  time?: string;
}) {
  const fromTz = args.from_timezone ?? undefined;
  if (!isValidTimezone(args.to_timezone)) {
    return err(`无效时区: ${args.to_timezone}`);
  }
  if (fromTz && !isValidTimezone(fromTz)) {
    return err(`无效时区: ${fromTz}`);
  }

  const ms =
    args.time !== undefined
      ? parseToUtcMs(args.time, fromTz)
      : Date.now();
  if (ms === null) {
    return err(`无法解析时刻: ${args.time}`);
  }

  const date = new Date(ms);
  const srcTz = fromTz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const from = toZonedSnapshot(date, srcTz);
  const to = toZonedSnapshot(date, args.to_timezone);

  return ok({
    ok: true,
    time_iso_utc: date.toISOString(),
    from_timezone: srcTz,
    from_offset: from.offset,
    to_timezone: args.to_timezone,
    to_offset: to.offset,
    offset_difference_hours: (to.offsetMs - from.offsetMs) / 3600e3,
    converted: {
      iso: to.iso,
      date: to.date,
      time: to.time,
      weekday: to.weekday,
    },
    note: `${srcTz} 的时刻 ${from.time} 等于 ${args.to_timezone} 的 ${to.date} ${to.time}`,
  });
}