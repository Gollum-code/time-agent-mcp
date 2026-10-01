"""Python 版单元测试：时间/时区工具。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from time_agent_mcp.util import (
    decompose_duration,
    format_offset,
    parse_to_utc,
    snapshot,
    valid_timezone,
)


def test_decompose_duration():
    d = decompose_duration((1 * 86400 + 2 * 3600 + 3 * 60 + 4) * 1000)
    assert d["days"] == 1
    assert d["hours"] == 2
    assert d["minutes"] == 3
    assert d["seconds_remainder"] == 4
    assert d["human"] == "1 天 2 小时 3 分 4 秒"
    assert d["compact"] == "1d 02:03:04"


def test_decompose_duration_negative():
    d = decompose_duration(-65_000)
    assert d["human"] == "已过 1 分 5 秒"


def test_decompose_duration_zero():
    d = decompose_duration(0)
    assert d["human"] == "0 秒"
    assert d["compact"] == "00:00:00"


def test_valid_timezone():
    assert valid_timezone("Asia/Shanghai")
    assert valid_timezone("America/New_York")
    assert not valid_timezone("Mars/Olympus")


def test_parse_to_utc_with_offset():
    dt = parse_to_utc("2026-10-01T12:00:00+08:00")
    assert dt is not None
    assert dt.hour == 4  # 12:00 +08:00 == 04:00 UTC


def test_parse_to_utc_naive_in_zone():
    dt = parse_to_utc("2026-10-01 12:00:00", "Asia/Shanghai")
    assert dt is not None
    assert dt == datetime(2026, 10, 1, 4, 0, 0, tzinfo=timezone.utc)


def test_parse_to_utc_bad():
    assert parse_to_utc("not-a-time") is None
    assert parse_to_utc("") is None


def test_format_offset():
    assert format_offset(timedelta(hours=8)) == "+08:00"
    assert format_offset(timedelta(hours=-5, minutes=-30)) == "-05:30"
    assert format_offset(timedelta(0)) == "+00:00"


def test_snapshot_fields():
    dt = datetime(2026, 10, 1, 4, 0, 0, tzinfo=timezone.utc)
    snap = snapshot(dt, "Asia/Shanghai")
    assert snap["date"] == "2026-10-01"
    assert snap["time"] == "12:00:00"
    assert snap["weekday"] == "星期四"
    assert snap["offset"] == "+08:00"