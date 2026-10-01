"""M2 功能测试：cron 解析/计算 + agent_clock 状态机（Python 版）。"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from time_agent_mcp.clock import clock_elapsed, clock_transition, empty_clock
from time_agent_mcp.cron import (
    cron_match,
    describe_schedule,
    evaluate_cron,
    last_fire_time,
    next_fire_time,
    parse_cron,
)

SH = "Asia/Shanghai"
UTC = timezone.utc


def _at(iso: str) -> int:
    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)


def _at_dt(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def test_parse_standard():
    s = parse_cron("0 18 * * *")
    assert not s.minute.any
    assert s.minute.values == {0}
    assert s.hour.values == {18}
    assert s.day_of_month.any


def test_parse_step_and_range():
    s = parse_cron("*/15 9-17 * * *")
    assert s.minute.values == {0, 15, 30, 45}
    assert s.hour.values == set(range(9, 18))


def test_parse_macros():
    assert parse_cron("@daily").minute.values == {0}
    assert parse_cron("@hourly").minute.values == {0}
    assert len(parse_cron("@hourly").minute.values) == 1


def test_parse_every():
    assert parse_cron("every 30 minutes").minute.values == {0, 30}
    assert parse_cron("every 2 hours").hour.values == set(range(0, 24, 2))
    assert parse_cron("every day").hour.values == {0}


def test_parse_invalid():
    with pytest.raises(ValueError):
        parse_cron("0 18 * *")
    with pytest.raises(ValueError):
        parse_cron("bad")
    with pytest.raises(ValueError):
        parse_cron("0 99 * * *")
    with pytest.raises(ValueError):
        parse_cron("")


def test_cron_match_fixed():
    s = parse_cron("0 18 * * *")
    assert cron_match(s, _at_dt("2026-10-01T10:00:00Z"), SH) is True
    assert cron_match(s, _at_dt("2026-10-01T09:59:00Z"), SH) is False


def test_cron_match_monday():
    # 2026-10-05 是周一
    s = parse_cron("0 9 * * 1")
    assert cron_match(s, _at_dt("2026-10-05T01:00:00Z"), SH) is True
    assert cron_match(s, _at_dt("2026-10-06T01:00:00Z"), SH) is False


def test_cron_match_sunday():
    # 上海周日 00:00 = UTC 2026-10-03T16:00
    s = parse_cron("0 0 * * 0")
    assert cron_match(s, _at_dt("2026-10-03T16:00:00Z"), SH) is True
    assert cron_match(s, _at_dt("2026-10-04T16:00:00Z"), SH) is False


def test_next_fire():
    s = parse_cron("0 18 * * *")
    assert next_fire_time(s, _at("2026-10-01T04:00:00Z"), SH) == _at("2026-10-01T10:00:00Z")


def test_next_fire_quarter():
    s = parse_cron("*/15 * * * *")
    assert next_fire_time(s, _at("2026-10-01T10:03:00Z"), SH) == _at("2026-10-01T10:15:00Z")


def test_last_fire():
    s = parse_cron("0 18 * * *")
    assert last_fire_time(s, _at("2026-10-01T10:00:00Z"), SH) == _at("2026-10-01T10:00:00Z")
    assert last_fire_time(s, _at("2026-10-01T10:00:01Z"), SH) == _at("2026-10-01T10:00:00Z")


def test_describe():
    assert describe_schedule(parse_cron("0 18 * * *")) == "每天 18:00"
    assert describe_schedule(parse_cron("* * * * *")) == "每分钟"
    assert describe_schedule(parse_cron("0 9 * * 1")) == "每周 周一 09:00"


def test_evaluate_integration():
    r = evaluate_cron("0 18 * * *", SH, _at("2026-10-01T04:00:00Z"))
    assert r["matches_now"] is False
    assert r["next_run"] == _at("2026-10-01T10:00:00Z")
    assert r["time_until_next_ms"] == 6 * 3600 * 1000
    assert r["human_summary"] == "每天 18:00"


def test_evaluate_match():
    r = evaluate_cron("0 18 * * *", SH, _at("2026-10-01T10:00:00Z"))
    assert r["matches_now"] is True


def test_clock_state_machine():
    c0 = empty_clock(1000)
    c1 = clock_transition(c0, "start", 1000)
    assert c1.state == "running"
    c2 = clock_transition(c1, "pause", 5000)
    assert c2.state == "paused"
    assert c2.accumulated_ms == 4000
    c3 = clock_transition(c2, "resume", 7000)
    assert c3.state == "running"
    assert c3.accumulated_ms == 4000
    c4 = clock_transition(c3, "pause", 9000)
    assert c4.accumulated_ms == 6000
    assert clock_elapsed(c4, 9000) == 6000


def test_clock_idempotent():
    c1 = clock_transition(empty_clock(0), "start", 0)
    assert clock_transition(c1, "start", 100).state == "running"
    p = clock_transition(c1, "pause", 100)
    assert clock_transition(p, "resume", 200).state == "running"
    assert clock_transition(p, "pause", 200).state == "paused"


def test_clock_reset():
    c = empty_clock(0)
    c = clock_transition(c, "start", 0)
    c = clock_transition(c, "pause", 10000)
    c = clock_transition(c, "reset", 10000)
    assert c.state == "idle"
    assert c.accumulated_ms == 0


def test_clock_elapsed_running():
    c = clock_transition(empty_clock(0), "start", 0)
    assert clock_elapsed(c, 5000) == 5000