"""轻量 cron 解析与计算（Python 版，零外部依赖，与 TS 版行为对齐）。

支持：
  - 标准 5 字段：分 时 日 月 周  （星号 / 步进 / 范围 / 范围带步进 / 逗号组合 / 单值）
  - @宏：@yearly/@monthly/@weekly/@daily/@hourly
  - 自然语法：every 30 minutes / every 2 hours / every day / every week / every month
  - 周日：cron 里 0 和 7 均代表星期日
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .util import decompose_duration, default_timezone, snapshot, valid_timezone

DOMAINS: dict[str, tuple[int, int]] = {
    "minute": (0, 59),
    "hour": (0, 23),
    "day_of_month": (1, 31),
    "month": (1, 12),
    "day_of_week": (0, 7),
}

MACROS: dict[str, str] = {
    "@yearly": "0 0 1 1 *",
    "@annually": "0 0 1 1 *",
    "@monthly": "0 0 1 * *",
    "@weekly": "0 0 * * 0",
    "@daily": "0 0 * * *",
    "@midnight": "0 0 * * *",
    "@hourly": "0 * * * *",
}

WEEKDAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]

_SCAN_WINDOW_MINUTES = 5 * 366 * 24 * 60


@dataclass
class CronField:
    """展开后的字段值集合。"""

    values: set[int] = field(default_factory=set)
    any: bool = False


@dataclass
class CronSchedule:
    expr: str
    minute: CronField
    hour: CronField
    day_of_month: CronField
    month: CronField
    day_of_week: CronField


def _parse_token(token: str, lo: int, hi: int) -> CronField:
    values: set[int] = set()
    any_flag = False

    for part in token.split(","):
        item = part.strip()
        if not item:
            continue
        if item == "*":
            any_flag = True
            continue

        step = 1
        start, end = lo, hi
        if "/" in item:
            base, step_str = item.split("/", 1)
            step = int(step_str)
            if step < 1:
                raise ValueError(f"非法步长: {step_str}")
            if base == "*":
                for v in range(lo, hi + 1, step):
                    values.add(v)
                continue
            if "-" in base:
                s, e = base.split("-")
                start, end = int(s), int(e)
            else:
                start = end = int(base)
        elif "-" in item:
            s, e = item.split("-")
            start, end = int(s), int(e)
        else:
            start = end = int(item)

        if start < lo or end > hi:
            raise ValueError(f"越界字段值: {item}（范围 {lo}-{hi}）")
        for v in range(start, end + 1, step):
            values.add(v)

    if not values and not any_flag:
        raise ValueError(f"空字段: {token}")
    return CronField(values=values, any=any_flag)


def _every_to_cron(expr: str) -> str | None:
    m = re.match(
        r"every\s+(\d*)\s*(minute|min|minutes|mins|hour|hours|hrs|day|days|week|weeks|month|months)?",
        expr.strip(),
        re.I,
    )
    if not m:
        return None
    n = int(m.group(1)) if m.group(1) else 1
    unit = (m.group(2) or "minutes").lower()
    if n < 1:
        return None
    mapping = {
        "minute": f"*/{n} * * * *",
        "min": f"*/{n} * * * *",
        "minutes": f"*/{n} * * * *",
        "mins": f"*/{n} * * * *",
        "hour": f"0 */{n} * * *",
        "hours": f"0 */{n} * * *",
        "hrs": f"0 */{n} * * *",
        "day": f"0 0 */{n} * *",
        "days": f"0 0 */{n} * *",
        "week": f"0 0 * * */{n}",
        "weeks": f"0 0 * * */{n}",
        "month": f"0 0 1 */{n} *",
        "months": f"0 0 1 */{n} *",
    }
    return mapping.get(unit)


def parse_cron(expr: str) -> CronSchedule:
    normalized = expr.strip()
    if not normalized:
        raise ValueError("空 cron 表达式")

    low = normalized.lower()
    if low in MACROS:
        normalized = MACROS[low]
    every = _every_to_cron(normalized)
    if every:
        normalized = every

    parts = normalized.split()
    if len(parts) != 5:
        raise ValueError(f'cron 需 5 个字段（分 时 日 月 周），收到 {len(parts)}: "{expr}"')

    keys = list(DOMAINS.keys())
    parsed = [_parse_token(p, *DOMAINS[keys[i]]) for i, p in enumerate(parts)]
    return CronSchedule(
        expr=expr,
        minute=parsed[0],
        hour=parsed[1],
        day_of_month=parsed[2],
        month=parsed[3],
        day_of_week=parsed[4],
    )


def _zoned_fields(dt: datetime, timezone: str) -> dict:
    snap = snapshot(dt, timezone)
    y, mo, d = (int(x) for x in snap["date"].split("-"))
    h, mi, _s = (int(x) for x in snap["time"].split(":"))
    py_weekday = datetime(y, mo, d).weekday()  # 0=周一 .. 6=周日
    cron_weekday = (py_weekday + 1) % 7  # 转为 cron：0/7=周日, 1=周一 .. 6=周六
    return {"year": y, "month": mo, "day": d, "hour": h, "minute": mi, "weekday": cron_weekday}


def _match(field: CronField, value: int) -> bool:
    return field.any or value in field.values


def cron_match(schedule: CronSchedule, dt: datetime, timezone: str) -> bool:
    f = _zoned_fields(dt, timezone)
    dow_ok = _match(schedule.day_of_week, f["weekday"])
    dom_ok = _match(schedule.day_of_month, f["day"])

    dom_any = schedule.day_of_month.any
    dow_any = schedule.day_of_week.any
    if dom_any and dow_any:
        day_ok = True
    elif dom_any:
        day_ok = dow_ok
    elif dow_any:
        day_ok = dom_ok
    else:
        day_ok = dom_ok or dow_ok

    return (
        _match(schedule.minute, f["minute"])
        and _match(schedule.hour, f["hour"])
        and day_ok
        and _match(schedule.month, f["month"])
    )


def _scan(schedule: CronSchedule, from_ms: int, tz: str, direction: int) -> int | None:
    """direction=1 从 from 下一分钟起（next）；direction=-1 从 from 所在分钟起（last，含该分钟）。"""
    base_minute = (from_ms // 60_000) + (1 if direction == 1 else 0)
    for _ in range(_SCAN_WINDOW_MINUTES):
        current_ms = base_minute * 60_000
        dt = datetime.fromtimestamp(current_ms / 1000, tz=ZoneInfo("UTC"))
        if cron_match(schedule, dt, tz):
            return current_ms
        base_minute += direction
    return None


def next_fire_time(schedule: CronSchedule, from_ms: int, tz: str) -> int | None:
    return _scan(schedule, from_ms, tz, 1)


def last_fire_time(schedule: CronSchedule, from_ms: int, tz: str) -> int | None:
    return _scan(schedule, from_ms, tz, -1)


def describe_schedule(schedule: CronSchedule) -> str:
    fixed_h = not schedule.hour.any and len(schedule.hour.values) == 1
    fixed_m = not schedule.minute.any and len(schedule.minute.values) == 1
    _val = lambda f: min(f.values) if f.values else 0
    hh = f"{_val(schedule.hour):02d}"
    mm = f"{_val(schedule.minute):02d}"

    if fixed_h and fixed_m:
        when = f"{hh}:{mm}"
        if not schedule.day_of_month.any and schedule.day_of_week.any:
            dom = ",".join(str(v) for v in sorted(schedule.day_of_month.values))
            if schedule.month.any:
                return f"每月 {dom} 日 {when}"
            months = ",".join(str(v) for v in sorted(schedule.month.values))
            return f"每年 {months} 月 {dom} 日 {when}"
        if not schedule.day_of_week.any and schedule.day_of_month.any and schedule.month.any:
            days = "、".join(WEEKDAY_NAMES[0 if v == 7 else v] for v in sorted(schedule.day_of_week.values))
            return f"每周 {days} {when}"
        if schedule.day_of_month.any and schedule.day_of_week.any and schedule.month.any:
            return f"每天 {when}"
    if schedule.minute.any and schedule.hour.any and schedule.day_of_month.any and schedule.month.any and schedule.day_of_week.any:
        return "每分钟"
    if not schedule.minute.any and schedule.hour.any and schedule.day_of_month.any and schedule.month.any and schedule.day_of_week.any:
        return f"每小时的 {','.join(str(v) for v in sorted(schedule.minute.values))} 分"
    return schedule.expr


def _resolve_tz(timezone: str | None) -> str:
    if timezone and valid_timezone(timezone):
        return timezone
    return default_timezone()


def evaluate_cron(expr: str, timezone: str | None, now_ms: int) -> dict:
    tz = _resolve_tz(timezone)
    schedule = parse_cron(expr)
    now_dt = datetime.fromtimestamp(now_ms / 1000, tz=ZoneInfo("UTC"))
    next_run = next_fire_time(schedule, now_ms, tz)
    last_run = last_fire_time(schedule, now_ms, tz)
    matches_now = cron_match(schedule, now_dt, tz)
    return {
        "schedule": schedule,
        "matches_now": matches_now,
        "last_run": last_run,
        "next_run": next_run,
        "time_until_next_ms": None if next_run is None else next_run - now_ms,
        "time_until_next": None if next_run is None else decompose_duration(next_run - now_ms),
        "since_last_ms": None if last_run is None else now_ms - last_run,
        "since_last": None if last_run is None else decompose_duration(now_ms - last_run),
        "human_summary": describe_schedule(schedule),
    }