"""time-agent-mcp —— MCP Server 入口（Python 版，基于 mcp / FastMCP）。

运行：python -m time_agent_mcp   （或 uv run / pipx run）
"""

from __future__ import annotations

import os

from mcp.server.fastmcp import FastMCP

from . import __version__
from .store import SessionStore, build_duration_result
from .util import (
    decompose_duration,
    error_text,
    json_text,
    parse_to_utc,
    snapshot,
    valid_timezone,
)
from .util import default_timezone as _default_tz

mcp = FastMCP(
    "time-agent-mcp",
    instructions=(
        "本 Server 为 LLM/Agent 提供时间感知能力：当模型需要知道「现在几点」「任务跑了多久」"
        "「距离某时刻还剩多久」「多时区换算」时调用。返回结构化 JSON（含 ISO 8601 + unix 毫秒）。"
    ),
)

_store = SessionStore(os.environ.get("TIME_AGENT_STORE_FILE"))


def _now_ms() -> int:
    from time import time as _time

    return int(_time() * 1000)


@mcp.tool()
def current_time(timezone: str | None = None) -> str:
    """返回当前时间、日期、星期、时区与 UTC 偏移（现在几点/几号/周几/时区）。"""
    tz = timezone or _default_tz()
    if timezone and not valid_timezone(timezone):
        return error_text(f"无效时区: {timezone}")
    return json_text({"ok": True, **snapshot(_now_datetime(), tz)})


@mcp.tool()
def duration_elapsed(
    session_id: str = "default",
    task_id: str = "main",
    started_at: str | None = None,
    reset: bool = False,
    label: str | None = None,
    timezone: str | None = None,
) -> str:
    """任务时长感知：记录任务起始时刻并返回「已过去多久」。首次调用自动开始计时，后续返回累计时长；reset=true 重新计时。"""
    if timezone and not valid_timezone(timezone):
        return error_text(f"无效时区: {timezone}")
    now = _now_ms()
    started: int
    first = False
    if started_at is not None:
        parsed = parse_to_utc(started_at, timezone)
        if parsed is None:
            return error_text(f"无法解析起始时刻: {started_at}")
        started = int(parsed.timestamp() * 1000)
        _store.start_task(session_id, task_id, started)
    elif reset:
        started = now
        _store.start_task(session_id, task_id, started)
    else:
        existing = _store.get_task_start(session_id, task_id)
        if existing is None:
            started = now
            _store.start_task(session_id, task_id, started)
            first = True
        else:
            started = existing

    r = build_duration_result(session_id, task_id, started, now, first, label)
    return json_text(
        {
            "ok": True,
            "session_id": r["session_id"],
            "task_id": r["task_id"],
            "label": r["label"],
            "first_call": r["is_first_call"],
            "started_at": r["started_iso"],
            "now_iso": snapshot(_now_datetime(), timezone or _default_tz())["iso"],
            "unix_now": r["now"],
            "elapsed_ms": r["elapsed_ms"],
            "elapsed_human": r["elapsed"]["human"],
            "elapsed_compact": r["elapsed"]["compact"],
            "parts": {
                "days": r["elapsed"]["days"],
                "hours": r["elapsed"]["hours"],
                "minutes": r["elapsed"]["minutes"],
                "seconds": r["elapsed"]["seconds_remainder"],
            },
        }
    )


@mcp.tool()
def time_until(target: str, timezone: str | None = None, from_: str | None = None) -> str:
    """倒计时：计算距离目标/截止时刻还剩多久（目标已过则返回已过时长）。

    注：Python 关键字限制，参数名为 from_（TS 版为 from），语义一致。
    """
    if timezone and not valid_timezone(timezone):
        return error_text(f"无效时区: {timezone}")
    target_dt = parse_to_utc(target, timezone)
    if target_dt is None:
        return error_text(f"无法解析目标时刻: {target}")
    from_dt = parse_to_utc(from_, timezone) if from_ else _now_datetime()
    if from_dt is None:
        return error_text(f"无法解析 from 时刻: {from_}")

    remaining_ms = int(target_dt.timestamp() * 1000) - int(from_dt.timestamp() * 1000)
    dur = decompose_duration(remaining_ms)
    return json_text(
        {
            "ok": True,
            "target": target_dt.isoformat(timespec="seconds"),
            "from": from_dt.isoformat(timespec="seconds"),
            "now_iso": snapshot(_now_datetime(), timezone or _default_tz())["iso"],
            "remaining_ms": remaining_ms,
            "state": "已过" if remaining_ms < 0 else "正好现在" if remaining_ms == 0 else "未到",
            "remaining_human": dur["human"],
            "remaining_compact": dur["compact"],
            "parts": {
                "days": dur["days"],
                "hours": dur["hours"],
                "minutes": dur["minutes"],
                "seconds": dur["seconds_remainder"],
            },
        }
    )


@mcp.tool()
def timezone_convert(
    to_timezone: str, from_timezone: str | None = None, time: str | None = None
) -> str:
    """多时区换算：把某一时刻从源时区换算到目标时区，返回目标时区本地时间与偏移差。"""
    if not valid_timezone(to_timezone):
        return error_text(f"无效时区: {to_timezone}")
    if from_timezone and not valid_timezone(from_timezone):
        return error_text(f"无效时区: {from_timezone}")
    dt = parse_to_utc(time, from_timezone) if time else _now_datetime()
    if dt is None:
        return error_text(f"无法解析时刻: {time}")

    src_tz = from_timezone or _default_tz()
    src = snapshot(dt, src_tz)
    dst = snapshot(dt, to_timezone)
    offset_diff_h = (dst["offset_seconds"] - src["offset_seconds"]) / 3600.0
    return json_text(
        {
            "ok": True,
            "time_iso_utc": dt.isoformat(timespec="seconds"),
            "from_timezone": src_tz,
            "from_offset": src["offset"],
            "to_timezone": to_timezone,
            "to_offset": dst["offset"],
            "offset_difference_hours": offset_diff_h,
            "converted": {"iso": dst["iso"], "date": dst["date"], "time": dst["time"], "weekday": dst["weekday"]},
            "note": f"{src_tz} 的时刻 {src['time']} 等于 {to_timezone} 的 {dst['date']} {dst['time']}",
        }
    )


@mcp.tool()
def session_ping(session_id: str = "default", timezone: str | None = None) -> str:
    """会话心跳：每次对话调用一次，更新时间戳并返回距上次对话间隔与本会话总时长。"""
    if timezone and not valid_timezone(timezone):
        return error_text(f"无效时区: {timezone}")
    before = _store.get(session_id)
    rec = _store.ping(session_id)
    now = _now_ms()
    age = decompose_duration(now - rec.started_at)
    gap = decompose_duration(0 if before is None else now - before.last_ping_at)
    return json_text(
        {
            "ok": True,
            "session_id": rec.id,
            "first_seen": before is None,
            "started_at": _iso_utc(rec.started_at),
            "last_ping_at": _iso_utc(rec.last_ping_at),
            "now_iso": snapshot(_now_datetime(), timezone or _default_tz())["iso"],
            "unix_now": now,
            "session_age_human": age["human"],
            "session_age_compact": age["compact"],
            "since_last_ping_human": gap["human"],
            "since_last_ping_compact": gap["compact"],
            "hint": (
                "新会话已建立：从现在起，模型可以感知后续对话间隔了。"
                if before is None
                else "距上次对话已超过 1 分钟，请留意时间流逝。" if now - before.last_ping_at > 60_000
                else "对话仍连续进行中。"
            ),
        }
    )


def _now_datetime():
    from datetime import datetime, timezone as _tz

    return datetime.now(_tz.utc)


def _iso_utc(ms: int) -> str:
    from datetime import datetime, timezone as _tz

    return datetime.fromtimestamp(ms / 1000, tz=_tz.utc).isoformat(timespec="seconds")


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()