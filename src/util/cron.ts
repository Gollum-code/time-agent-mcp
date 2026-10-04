/**
 * 轻量 cron 解析与计算（零外部依赖）。
 *
 * 支持：
 *   - 标准 5 字段：分 时 日 月 周  （* /step a-b a-b/step a,b,c 单值）
 *   - @宏：@yearly/@monthly/@weekly/@daily/@hourly
 *   - 自然语法：every 30 minutes / every 2 hours / every day / every week / every month
 * 周日：0 和 7 均代表星期日。
 */

import { decomposeDuration, isValidTimezone, toZonedSnapshot, zoneOffsetMs } from "./time.js";

export interface CronField {
  /** 已展开的具体值（已去重升序） */
  values: number[];
  /** 是否为通配 * */
  any: boolean;
  min: number;
  max: number;
}

export interface CronSchedule {
  expr: string;
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

const DOMAINS: Record<keyof Omit<CronSchedule, "expr">, [number, number]> = {
  minute: [0, 59],
  hour: [0, 23],
  dayOfMonth: [1, 31],
  month: [1, 12],
  dayOfWeek: [0, 7],
};

const MACROS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

/** 解析单个字段 token（星号 / n / a-b / a-b 步进 / 星号步进，逗号组合）。 */
export function parseCronField(token: string, [min, max]: [number, number]): CronField {
  const values = new Set<number>();
  let any = false;

  for (const part of token.split(",")) {
    const item = part.trim();
    if (!item) continue;
    if (item === "*") {
      any = true;
      continue;
    }
    let start = min;
    let end = max;
    let step = 1;

    const stepMatch = /^(.*)\/(\d+)$/.exec(item);
    if (stepMatch) {
      const [, base, stepStr] = stepMatch;
      step = Number(stepStr);
      if (step < 1) throw new Error(`非法步长: ${stepStr}`);
      if (base === "*") {
        for (let v = min; v <= max; v += step) values.add(v);
        continue;
      }
      const range = base.includes("-") ? base.split("-").map(Number) : null;
      if (range) {
        [start, end] = range;
      } else {
        start = end = Number(base);
      }
    } else if (item.includes("-")) {
      const [s, e] = item.split("-").map(Number);
      start = s;
      end = e;
    } else {
      start = end = Number(item);
    }

    if (Number.isNaN(start) || Number.isNaN(end) || start < min || end > max) {
      throw new Error(`越界字段值: ${item}（范围 ${min}-${max}）`);
    }
    for (let v = start; v <= end; v += step) values.add(v);
  }

  if (values.size === 0 && !any) throw new Error(`空字段: ${token}`);
  return { values: [...values].sort((a, b) => a - b), any, min, max };
}

/** 把 every N <unit> 自然语法翻译成 cron 5 字段。 */
function fromEverySyntax(expr: string): string | null {
  const m = /^every\s+(\d*)\s*(minute|min|minutes|mins|hour|hours|hrs|day|days|week|weeks|month|months)?$/i.exec(expr.trim());
  if (!m) return null;
  const n = m[1] === "" || m[1] === "1" ? 1 : Number(m[1]);
  const unit = (m[2] ?? "minutes").toLowerCase();
  if (Number.isNaN(n) || n < 1) return null;
  switch (unit) {
    case "minute":
    case "min":
    case "minutes":
    case "mins":
      return `*/${n} * * * *`;
    case "hour":
    case "hours":
    case "hrs":
      return `0 */${n} * * *`;
    case "day":
    case "days":
      return `0 0 */${n} * *`;
    case "week":
    case "weeks":
      return `0 0 * * */${n}`;
    case "month":
    case "months":
      return `0 0 1 */${n} *`;
    default:
      return null;
  }
}

/** 解析 cron 表达式（或 every 自然语法/宏），失败抛错。 */
export function parseCron(expr: string): CronSchedule {
  let normalized = expr.trim();
  if (!normalized) throw new Error("空 cron 表达式");

  if (MACROS[normalized.toLowerCase()]) normalized = MACROS[normalized.toLowerCase()];
  const fromEvery = fromEverySyntax(normalized);
  if (fromEvery) normalized = fromEvery;

  const parts = normalized.split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`cron 需 5 个字段（分 时 日 月 周），收到 ${parts.length}: "${expr}"`);
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts.map((p, i) => {
    const key = Object.keys(DOMAINS)[i] as keyof typeof DOMAINS;
    return parseCronField(p, DOMAINS[key]);
  });

  return { expr, minute, hour, dayOfMonth, month, dayOfWeek };
}

/** 日期在某时区的墙钟字段（用于 cron 匹配）。 */
export function zonedCronFields(date: Date, timezone: string) {
  const s = toZonedSnapshot(date, timezone);
  const [y, mo, d] = s.date.split("-").map(Number);
  const [h, mi] = s.time.split(":").map(Number);
  const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return { year: y, month: mo, day: d, hour: h, minute: mi, weekday };
}

const fieldMatch = (field: CronField, value: number) =>
  field.any || field.values.includes(value);

/** 指定时刻是否命中 cron（dow 与 dom 同时受限时满足其一即可，符合 Vixie cron 语义）。 */
export function cronMatch(schedule: CronSchedule, date: Date, timezone: string): boolean {
  const f = zonedCronFields(date, timezone);
  const dowOk = fieldMatch(schedule.dayOfWeek, f.weekday);
  const domOk = fieldMatch(schedule.dayOfMonth, f.day);

  let dayOk: boolean;
  const domAny = schedule.dayOfMonth.any;
  const dowAny = schedule.dayOfWeek.any;
  if (domAny && dowAny) dayOk = true;
  else if (domAny) dayOk = dowOk;
  else if (dowAny) dayOk = domOk;
  else dayOk = domOk || dowOk;

  return (
    fieldMatch(schedule.minute, f.minute) &&
    fieldMatch(schedule.hour, f.hour) &&
    dayOk &&
    fieldMatch(schedule.month, f.month)
  );
}

/**
 * 计算下一个触发时刻（unix ms）。from 为起始（不含）时刻。
 * 找不到（5 年窗口内）返回 null。
 */
export function nextFireTime(
  schedule: CronSchedule,
  fromMs: number,
  timezone = defaultCronTz()
): number | null {
  return scanFireTime(schedule, fromMs, timezone, 1);
}

/** 计算上一个触发时刻（unix ms）。找不到返回 null。 */
export function lastFireTime(
  schedule: CronSchedule,
  fromMs: number,
  timezone = defaultCronTz()
): number | null {
  return scanFireTime(schedule, fromMs, timezone, -1);
}

const MAX_SCAN_DAYS = 5 * 366 + 5;

/** 把「某时区墙钟 (y,mo,d,h,mi)」转换为其真实 UTC 毫秒。
 *  - 普通情形：墙钟 − 偏移 = UTC
 *  - DST 秋季重复：该墙钟有两个 UTC，取第一个（较早）出现
 *  - DST 春季跳过（墙钟不存在）：返回 null
 */
function wallToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  timezone: string
): number | null {
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  // 三个猜测偏移可覆盖两侧的 DST 边界
  const candidates = [wall - 3600e3, wall, wall + 3600e3].map((t) =>
    zoneOffsetMs(timezone, new Date(t))
  );
  for (const off of [...new Set(candidates)]) {
    const utc = wall - off;
    const f = zonedCronFields(new Date(utc), timezone);
    if (f.year === y && f.month === mo && f.day === d && f.hour === h && f.minute === mi) {
      return utc;
    }
  }
  return null; // DST 跳变（该墙钟不存在）
}

/** 时区墙钟的「日字段」是否命中（月/日/周），并返回当月有效天（用于 29→30/31 clamp）。 */
function monthDayMatches(schedule: CronSchedule, y: number, mo: number, d: number): boolean {
  const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  const dowOk = fieldMatch(schedule.dayOfWeek, weekday);
  const domOk = fieldMatch(schedule.dayOfMonth, d);
  const domAny = schedule.dayOfMonth.any;
  const dowAny = schedule.dayOfWeek.any;
  if (domAny && dowAny) return true;
  if (domAny) return dowOk;
  if (dowAny) return domOk;
  return domOk || dowOk;
}

/** 把 [min,max] 展开为升序值数组（用于通配字段）。 */
function expand(field: CronField): number[] {
  if (!field.any) return field.values;
  const out: number[] = [];
  for (let v = field.min; v <= field.max; v++) out.push(v);
  return out;
}

/** y,mo 所在月的天数（公历）。 */
function daysInMonth(y: number, mo: number): number {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** 墙钟日推进 ±1 天（跨月/跨年/回退到上月末日）。 */
function advanceDay(y: number, mo: number, d: number, dir: 1 | -1): { y: number; mo: number; d: number } {
  if (dir === 1) {
    if (d < daysInMonth(y, mo)) return { y, mo, d: d + 1 };
    if (mo === 12) return { y: y + 1, mo: 1, d: 1 };
    return { y, mo: mo + 1, d: 1 };
  }
  if (d > 1) return { y, mo, d: d - 1 };
  if (mo === 1) {
    return { y: y - 1, mo: 12, d: daysInMonth(y - 1, 12) };
  }
  return { y, mo: mo - 1, d: daysInMonth(y, mo - 1) };
}

/** 跳到最近的命中月（在候选月集合里选离当前月最近的）。 */
function jumpToMonth(y: number, mo: number, months: number[], dir: 1 | -1): { y: number; mo: number; d: number } {
  if (dir === 1) {
    for (const m of months) if (m > mo) return { y, mo: m, d: 1 };
    return { y: y + 1, mo: months[0], d: 1 };
  }
  for (let i = months.length - 1; i >= 0; i--) if (months[i] < mo) return { y, mo: months[i], d: daysInMonth(y, months[i]) };
  return { y: y - 1, mo: months[months.length - 1], d: daysInMonth(y - 1, months[months.length - 1]) };
}

/**
 * 跳跃式扫描触发时刻：按「月 → 日 → 时:分」分层推进，而非逐分钟暴力。
 * - dir=1（next）：结果严格晚于 fromMs
 * - dir=-1（last）：结果为最近一次不晚于 fromMs 的触发（含 from 所在分钟）
 */
function scanFireTime(
  schedule: CronSchedule,
  fromMs: number,
  timezone: string,
  dir: 1 | -1
): number | null {
  // 预先生成每天可能的「时:分」候选槽（目标时区墙钟的分钟集合）
  const slots: number[] = [];
  for (const h of expand(schedule.hour)) {
    for (const mi of expand(schedule.minute)) slots.push(h * 60 + mi);
  }
  slots.sort((a, b) => a - b);
  if (slots.length === 0) return null;

  const ff = zonedCronFields(new Date(fromMs), timezone);
  const fromMinuteOfDay = ff.hour * 60 + ff.minute;

  // 月字段受限时的候选月（升序）；通配则 null 表示任意
  const monthValues: number[] | null = schedule.month.any
    ? null
    : [...schedule.month.values].sort((a, b) => a - b);

  let y = ff.year;
  let mo = ff.month;
  let d = ff.day;
  let firstDay = true;

  for (let dayIdx = 0; dayIdx < MAX_SCAN_DAYS; dayIdx++) {
    const monthMatched = monthValues === null || monthValues.includes(mo);
    if (monthMatched && monthDayMatches(schedule, y, mo, d)) {
      const ordered = dir === 1 ? slots : [...slots].reverse();
      for (const mod of ordered) {
        if (firstDay) {
          if (dir === 1 && mod <= fromMinuteOfDay) continue;
          if (dir === -1 && mod > fromMinuteOfDay) continue;
        }
        const utc = wallToUtc(y, mo, d, Math.floor(mod / 60), mod % 60, timezone);
        if (utc !== null && (dir === 1 ? utc > fromMs : utc <= fromMs)) return utc;
      }
    }
    firstDay = false;

    // 月度受限且当前月不命中 → 直接跳到最近的命中月；否则逐日推进
    if (!monthMatched && monthValues !== null) {
      const j = jumpToMonth(y, mo, monthValues, dir);
      y = j.y; mo = j.mo; d = j.d;
    } else {
      const a = advanceDay(y, mo, d, dir);
      y = a.y; mo = a.mo; d = a.d;
    }
  }
  return null;
}

function defaultCronTz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** 人类可读描述（尽力，覆盖常见形态）。 */
export function describeSchedule(schedule: CronSchedule): string {
  const { minute, hour, dayOfMonth, month, dayOfWeek } = schedule;
  const fixedH = !hour.any && hour.values.length === 1 && hour.values[0] < 24;
  const fixedM = !minute.any && minute.values.length === 1;
  const hh = String(hour.values[0] ?? 0).padStart(2, "0");
  const mm = String(minute.values[0] ?? 0).padStart(2, "0");

  if (fixedH && fixedM) {
    const when = `${hh}:${mm}`;
    if (!dayOfMonth.any && !month.any && dayOfWeek.any) {
      const dom = dayOfMonth.values.join("/");
      return month.any ? `每月 ${dom} 日 ${when}` : `每年 ${month.values.join("/")} 月 ${dom} 日 ${when}`;
    }
    if (!dayOfWeek.any && dayOfMonth.any && month.any) {
      const days = dayOfWeek.values.map((v) => WEEKDAY_NAMES[v === 7 ? 0 : v]).join("、");
      return `每周 ${days} ${when}`;
    }
    if (dayOfMonth.any && dayOfWeek.any && month.any) return `每天 ${when}`;
  }
  if (minute.any && hour.any && dayOfMonth.any && month.any && dayOfWeek.any) return "每分钟";
  if (!minute.any && hour.any && dayOfMonth.any && month.any && dayOfWeek.any) {
    return `每小时的 ${minute.values.join("、")} 分`;
  }
  return schedule.expr;
}

const WEEKDAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export interface FireTiming {
  matchesNow: boolean;
  lastRun: number | null;
  nextRun: number | null;
  timeUntilNextMs: number | null;
  timeUntilNext: ReturnType<typeof decomposeDuration> | null;
  sinceLastMs: number | null;
  sinceLast: ReturnType<typeof decomposeDuration> | null;
  humanSummary: string;
}

/** cron_mock 一次完整的「到点了吗」判定。 */
export function evaluateCron(
  expr: string,
  timezone: string | undefined,
  nowMs: number
): { schedule: CronSchedule; timing: FireTiming } {
  const tz = timezone && isValidTimezone(timezone) ? timezone : defaultCronTz();
  const schedule = parseCron(expr);
  const now = new Date(nowMs);
  const nextRun = nextFireTime(schedule, nowMs, tz);
  const lastRun = lastFireTime(schedule, nowMs, tz);
  const matchesNow = cronMatch(schedule, now, tz);
  return {
    schedule,
    timing: {
      matchesNow,
      lastRun,
      nextRun,
      timeUntilNextMs: nextRun === null ? null : nextRun - nowMs,
      timeUntilNext: nextRun === null ? null : decomposeDuration(nextRun - nowMs),
      sinceLastMs: lastRun === null ? null : nowMs - lastRun,
      sinceLast: lastRun === null ? null : decomposeDuration(nowMs - lastRun),
      humanSummary: describeSchedule(schedule),
    },
  };
}