"""Python 版测试：MCP 工具行为（直接调用 server 模块的 FastMCP）。"""

from __future__ import annotations

import asyncio
import json
import tempfile
from pathlib import Path

import pytest

from time_agent_mcp import server as sv


def _text(content: str) -> dict:
    return json.loads(content)


@pytest.fixture(autouse=True)
def isolated_store(tmp_path: Path):
    """每个测试用独立的 SessionStore（空文件路径 → 纯内存）。"""
    sv._store = sv.SessionStore(str(tmp_path / "session.json"))
    yield
    sv._store = None


def test_current_time():
    out = sv.current_time("Asia/Shanghai")
    data = _text(out)
    assert data["ok"] is True
    assert data["timezone"] == "Asia/Shanghai"
    assert data["offset"] == "+08:00"


def test_current_time_bad_tz():
    out = sv.current_time("Not/AZone")
    data = _text(out)
    assert data["ok"] is False


def test_duration_elapsed_flow():
    first = _text(sv.duration_elapsed(task_id="t1"))
    assert first["first_call"] is True
    assert first["elapsed_ms"] == 0
    second = _text(sv.duration_elapsed(task_id="t1"))
    assert second["first_call"] is False
    assert second["elapsed_ms"] >= 0


def test_duration_elapsed_with_started_at():
    out = _text(sv.duration_elapsed(task_id="t2", started_at="2026-10-01T00:00:00Z"))
    assert out["ok"] is True
    assert out["elapsed_ms"] > 0


def test_duration_elapsed_reset():
    sv.duration_elapsed(task_id="t3", started_at="2020-01-01T00:00:00Z")
    reset = _text(sv.duration_elapsed(task_id="t3", reset=True))
    assert reset["first_call"] is False
    assert reset["elapsed_ms"] < 1000  # reset 后接近 0


def test_time_until_future():
    out = _text(sv.time_until(target="2099-01-01T00:00:00", timezone="Asia/Shanghai"))
    assert out["ok"] is True
    assert out["state"] == "未到"
    assert out["remaining_ms"] > 0


def test_time_until_past():
    out = _text(sv.time_until(target="2020-01-01T00:00:00"))
    assert out["state"] == "已过"
    assert out["remaining_ms"] < 0


def test_time_until_bad_target():
    out = sv.time_until(target="banana")
    assert _text(out)["ok"] is False


def test_timezone_convert():
    out = _text(
        sv.timezone_convert(
            time="2026-10-01T12:00:00",
            from_timezone="Asia/Shanghai",
            to_timezone="America/New_York",
        )
    )
    assert out["ok"] is True
    assert out["converted"]["time"] == "00:00:00"
    assert out["offset_difference_hours"] == -12.0


def test_session_ping():
    first = _text(sv.session_ping("sid-1"))
    assert first["first_seen"] is True
    second = _text(sv.session_ping("sid-1"))
    assert second["first_seen"] is False
    assert second["session_age_human"] is not None


@pytest.mark.asyncio
async def test_tool_names_present():
    from time_agent_mcp.server import mcp

    tools = await mcp.list_tools()
    names = {t.name for t in tools}
    assert {
        "current_time",
        "duration_elapsed",
        "time_until",
        "timezone_convert",
        "session_ping",
    } <= names


@pytest.mark.asyncio
async def test_time_until_schema():
    """time_until 的 from 参数在 Python 版为 from_（关键字限制），语义与 TS 版一致。"""
    from time_agent_mcp.server import mcp

    tools = {t.name: t for t in await mcp.list_tools()}
    props = tools["time_until"].inputSchema["properties"]
    assert "target" in props
    assert "from_" in props