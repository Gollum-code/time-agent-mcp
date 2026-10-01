"""时间/时区工具（Python 版）。

时间源：系统时钟；时区：IANA（zoneinfo，Python 3.9+ 内置，零外部依赖）。
所有返回统一使用 ISO 8601 + unix 秒，与 TS 版对齐。
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

WEEKDAYS_ZH = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]


def default_timezone() -> str:
    """尽力返回系统 IANA 时区名（Linux/macOS 直接可取；Windows 回退到 TZ 或 UTC）。"""
    try:
        tz = datetime.now().astimezone().tzinfo
        key = getattr(tz, "key", None)
        if key:
            return key
    except Exception:
        pass
    env = os.environ.get("TZ")
    if env and valid_timezone(env):
        return env
    return "UTC"


def valid_timezone(tz: str) -> bool:
    try:
        ZoneInfo(tz)
        return True
    except ZoneInfoNotFoundError:
        return False


def zone_offset(tz: str, dt: datetime) -> timedelta:
    """指定时刻在该时区的 UTC 偏移。"""
    return dt.astimezone(ZoneInfo(tz)).utcoffset() or timedelta(0)


def format_offset(offset: timedelta) -> str:
    total = int(offset.total_seconds())
    sign = "-" if total < 0 else "+"
    total = abs(total)
    h, m = divmod(total // 60, 60)
    return f"{sign}{h:02d}:{m:02d}"


def snapshot(dt: datetime, tz: str) -> dict:
    """把 datetime + IANA 时区渲染为结构化时间快照。"""
    local = dt.astimezone(ZoneInfo(tz))
    offset = local.utcoffset() or timedelta(0)
    iso = local.strftime("%Y-%m-%dT%H:%M:%S") + format_offset(offset)
    return {
        "iso": iso,
        "unix": int(dt.timestamp() * 1000),
        "date": local.strftime("%Y-%m-%d"),
        "weekday": WEEKDAYS_ZH[local.weekday()],
        "time": local.strftime("%H:%M:%S"),
        "hour": local.hour,
        "minute": local.minute,
        "second": local.second,
        "timezone": tz,
        "offset": format_offset(offset),
        "offset_seconds": int(offset.total_seconds()),
        "is_dst": bool(local.dst()),
    }


def parse_to_utc(value: str, tz: str | None = None) -> datetime | None:
    """解析带/不带偏移的 ISO 8601 字符串为 aware datetime (UTC)。

    - 带偏移（+08:00 / Z）：直接解析。
    - 不带偏移：按 tz（缺省系统时区）解释为墙钟时间。
    """
    raw = value.strip()
    if not raw:
        return None

    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        if "+" in raw[10:] or "-" in raw[10:]:
            parsed = datetime.fromisoformat(raw)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
    except ValueError:
        return None

    # 无偏移 → 按目标时区解释墙钟时间
    target = tz if tz and valid_timezone(tz) else default_timezone()
    normalized = raw.replace(" ", "T") if " " in raw else raw
    try:
        naive = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    zoned = naive.replace(tzinfo=ZoneInfo(target))
    return zoned.astimezone(timezone.utc)


def decompose_duration(ms: int) -> dict:
    """毫秒时长 → 结构化可读结果（与 TS 版一致）。"""
    sign = -1 if ms < 0 else 1
    total_s = abs(int(ms)) // 1000
    days, rem = divmod(total_s, 86400)
    hours, rem = divmod(rem, 3600)
    minutes, seconds = divmod(rem, 60)

    parts: list[str] = []
    for n, label in ((days, "天"), (hours, "小时"), (minutes, "分"), (seconds, "秒")):
        if n:
            parts.append(f"{n} {label}")
    human = " ".join(parts) if parts else "0 秒"
    compact = f"{days}d {hours:02d}:{minutes:02d}:{seconds:02d}" if days else f"{hours:02d}:{minutes:02d}:{seconds:02d}"

    if sign < 0:
        human, compact = f"已过 {human}", f"-{compact}"
    return {
        "ms": ms,
        "seconds": ms / 1000.0,
        "days": days,
        "hours": hours,
        "minutes": minutes,
        "seconds_remainder": seconds,
        "compact": compact,
        "human": human,
    }


def json_text(obj: dict, pretty: bool = True) -> str:
    """序列化为 JSON 字符串（FastMCP 会自动包装成 TextContent）。"""
    return json.dumps(obj, ensure_ascii=False, indent=2 if pretty else None)


def error_text(msg: str) -> str:
    return json.dumps({"ok": False, "error": msg}, ensure_ascii=False)
