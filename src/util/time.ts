/**
 * 时间 / 时区工具（零外部依赖，基于 Intl + System clock）
 *
 * 以「系统时钟」为时间源，以 IANA 时区（如 Asia/Shanghai）为换算基准。
 * 所有输出统一使用 ISO 8601 + unix 毫秒，方便 LLM 解析。
 */

export interface ZonedSnapshot {
  iso: string;
  unix: number;
  /** 年月日 */
  date: string;
  /** 星期几（中文，如 "星期二"） */
  weekday: string;
  /** HH:mm:ss */
  time: string;
  /** 24 小时制小时 */
  hour: number;
  /** 0-59 */
  minute: number;
  /** 0-59 */
  second: number;
  /** IANA 时区名，如 Asia/Shanghai */
  timezone: string;
  /** 与 UTC 的偏移，如 +08:00 */
  offset: string;
  /** 与 UTC 的偏移毫秒 */
  offsetMs: number;
  /** 此刻是 DST 夏令时吗 */
  isDst: boolean;
}

const WEEKDAYS_ZH = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

/**
 * 校验 IANA 时区名是否合法（通过 Intl 能否实例化判断）。
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * 计算指定时刻在指定时区的 UTC 偏移（毫秒）。
 * 返回 offset = zonedWallTime - utcTime，例如上海为 +8 小时。
 */
export function zoneOffsetMs(timezone: string, date: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  const wall = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
  // 墙钟差扣除毫秒残余（Intl 格式化到秒，date 含毫秒）；
  // 真实 IANA 偏移永远是整分钟，四舍五入到分钟即精确
  return Math.round((wall - date.getTime()) / 60_000) * 60_000;
}

/** 把毫秒偏移格式化为 ISO 偏移字符串，如 8 * 3600e3 → "+08:00"。 */
export function formatOffset(offsetMs: number): string {
  const sign = offsetMs < 0 ? "-" : "+";
  const abs = Math.abs(offsetMs);
  const h = String(Math.floor(abs / 3600e3)).padStart(2, "0");
  const m = String(Math.floor((abs % 3600e3) / 60e3)).padStart(2, "0");
  return `${sign}${h}:${m}`;
}

/**
 * 将 Date + IANA 时区渲染为结构化时间快照。
 */
export function toZonedSnapshot(date: Date, timezone: string): ZonedSnapshot {
  const offsetMs = zoneOffsetMs(timezone, date);
  const iso = `${date.toISOString().slice(0, 19)}${formatOffset(offsetMs)}`;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(date);

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = Number(get("hour")) % 24;
  const weekdayIndex = new Date(
    Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day")))
  ).getUTCDay();

  // 判断 DST：同一时区在一年中不同时刻偏移不同 ⇒ 下个月此时偏移若不同则为夏令时
  const nextMonth = new Date(date.getTime() + 30 * 24 * 3600e3);
  const isDst = zoneOffsetMs(timezone, nextMonth) !== offsetMs;

  return {
    iso,
    unix: date.getTime(),
    date: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: WEEKDAYS_ZH[weekdayIndex],
    time: `${String(hour).padStart(2, "0")}:${get("minute")}:${get("second")}`,
    hour,
    minute: Number(get("minute")),
    second: Number(get("second")),
    timezone,
    offset: formatOffset(offsetMs),
    offsetMs,
    isDst,
  };
}

/**
 * 把「带时区语义的字符串」解析为 UTC 毫秒。
 * 支持：
 *   - 带偏移/带 Z 的 ISO 8601（"2026-10-01T14:30:00+08:00"）
 *   - 不带偏移的 ISO（"2026-10-01T14:30:00" 或 "2026-10-01 14:30:00"）——
 *     配合 timezone（未给则按系统时区）解释为本地墙钟时间
 *
 * 解析失败返回 null。带往返校验：
 *   - 非法日历日期（如 2026-02-30）→ null
 *   - DST 春季空洞的墙钟时刻（如 NY 2026-03-08 02:30）→ null
 *   - DST 秋季重复的墙钟时刻 → 解析为第一次出现（较前的 UTC）
 */
export function parseToUtcMs(value: string, timezone?: string): number | null {
  const raw = value.trim();
  if (!raw) return null;

  // ── 提取各组件（YYYY-MM-DD[ T]HH:MM[:SS[.fff]][+HH:MM|Z]）──
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i.exec(raw);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = m[4] === undefined ? 0 : Number(m[4]);
  const minute = m[5] === undefined ? 0 : Number(m[5]);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  const offsetStr = m[7];

  // 本地判合法性（避免 Date.parse 把 2/30 滚动成 3/2）
  if (!isValidCalendarDateTime(year, month, day, hour, minute, second)) return null;

  if (offsetStr) {
    // 显式偏移：直接解析并做往返校验
    const ms = Date.parse(raw);
    if (Number.isNaN(ms)) return null;
    // 该时刻在偏移时区下的墙钟应等于输入组件（否则是非法日期被滚动）
    return roundTripCheckOffset(ms, offsetStr, { year, month, day, hour, minute, second }) ? ms : null;
  }

  // 不含偏移 → 按目标时区解释为墙钟，不动点迭代找真实 UTC，再往返校验
  const targetTz = timezone && isValidTimezone(timezone) ? timezone : defaultTimezone();
  const wall = Date.UTC(year, month - 1, day, hour, minute, second); // 先假定为 UTC
  let utc = wall;
  for (let i = 0; i < 6; i++) {
    const off = zoneOffsetMs(targetTz, new Date(utc));
    const next = wall - off;
    if (next === utc) break;
    utc = next;
  }
  // 不动点迭代收敛 → 该墙钟存在；不收敛（交替震荡）→ DST 空洞，两值往返都不符则拒绝
  if (roundTripCheckZone(utc, targetTz, { year, month, day, hour, minute, second })) {
    return utc;
  }
  // 秋季重复：尝试候选偏移的另一侧（第二个出现）
  const offHere = zoneOffsetMs(targetTz, new Date(utc));
  const alt = wall - offHere - Math.sign(offHere - zoneOffsetMs(targetTz, new Date(wall))) * 3600e3;
  if (roundTripCheckZone(alt, targetTz, { year, month, day, hour, minute, second })) {
    return alt;
  }
  return null; // 该墙钟时刻在目标时区不存在（DST 空洞或非法日期）
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** 公历日期合法性（含闰年 2/29）。 */
function isValidCalendarDateTime(year: number, month: number, day: number, hour: number, minute: number, second: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInGregorianMonth(year, month)) return false;
  if (hour > 23 || minute > 59 || second > 60) return false;
  if (year < 1000 || year > 9999) return false;
  return true;
}

function daysInGregorianMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** 校验显式偏移 ISO 的墙钟是否与输入一致（防 2/30 → 3/2 滚动）。 */
function roundTripCheckOffset(ms: number, offsetStr: string, p: WallParts): boolean {
  let sign = 1;
  let s = offsetStr.toUpperCase();
  if (s === "Z") s = "+00:00";
  if (s.startsWith("-")) sign = -1;
  const digits = s.replace(/[^0-9]/g, "");
  const offMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
  const shifted = new Date(ms + offMin * 60_000);
  return (
    shifted.getUTCFullYear() === p.year &&
    shifted.getUTCMonth() === p.month - 1 &&
    shifted.getUTCDate() === p.day &&
    shifted.getUTCHours() === p.hour &&
    shifted.getUTCMinutes() === p.minute &&
    shifted.getUTCSeconds() === p.second
  );
}

/** 校验某 UTC 时刻在目标时区的墙钟是否与输入一致（DST 空洞返回不一致）。 */
function roundTripCheckZone(utcMs: number, timezone: string, p: WallParts): boolean {
  const z = toZonedSnapshot(new Date(utcMs), timezone);
  return (
    z.date === `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}` &&
    z.time === `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}:${String(p.second).padStart(2, "0")}`
  );
}

/** 按系统默认时区（不带 timeZone 的 Intl 行为）取当前快照。 */
export function snapshotNow(timezone?: string): ZonedSnapshot {
  const tz = timezone && isValidTimezone(timezone) ? timezone : defaultTimezone();
  return toZonedSnapshot(new Date(), tz);
}

export function defaultTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export interface DurationParts {
  /** 总共多少毫秒 */
  ms: number;
  /** 总秒数（含小数） */
  seconds: number;
  days: number;
  hours: number;
  minutes: number;
  secondsRemainder: number;
  /** 超过 24 小时并入天，纯「HH:MM:SS」式可读串 */
  compact: string;
  /** 中文人类可读，如 "1 天 2 小时 3 分 4 秒" */
  human: string;
}

/**
 * 把毫秒时长拆解为人类可读结构。
 */
export function decomposeDuration(ms: number): DurationParts {
  const sign = ms < 0 ? -1 : 1;
  const abs = Math.abs(Math.trunc(ms));
  const days = Math.floor(abs / 86_400e3);
  const hours = Math.floor((abs % 86_400e3) / 3600e3);
  const minutes = Math.floor((abs % 3600e3) / 60e3);
  const secondsRemainder = Math.floor((abs % 60e3) / 1e3);

  const unit = (n: number, label: string) => (n > 0 ? `${n} ${label}` : "");
  const parts: string[] = [
    unit(days, "天"),
    unit(hours, "小时"),
    unit(minutes, "分"),
    unit(secondsRemainder, "秒"),
  ].filter(Boolean);
  const human = parts.length ? parts.join(" ") : "0 秒";

  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secondsRemainder).padStart(2, "0");
  const compact = days > 0 ? `${days}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;

  return {
    ms,
    seconds: ms / 1e3,
    days,
    hours,
    minutes,
    secondsRemainder,
    compact: sign < 0 ? `-${compact}` : compact,
    human: sign < 0 ? `已过 ${human}` : human,
  };
}