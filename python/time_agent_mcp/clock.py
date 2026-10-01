"""agent_clock —— 会话级计时器状态机（纯函数，便于测试）。

状态：idle（未开始）→ running（计时中）⇄ paused（暂停）。
"""

from __future__ import annotations

from dataclasses import dataclass

State = str  # "idle" | "running" | "paused"
Action = str  # "start" | "pause" | "resume" | "reset" | "status"


@dataclass(frozen=True)
class ClockRecord:
    state: State
    accumulated_ms: int
    started_at: int | None
    paused_at: int | None
    updated_at: int


def empty_clock(now: int) -> ClockRecord:
    return ClockRecord("idle", 0, None, None, now)


def clock_elapsed(c: ClockRecord, now: int) -> int:
    if c.state == "running" and c.started_at is not None:
        return c.accumulated_ms + max(0, now - c.started_at)
    return c.accumulated_ms


def clock_transition(c: ClockRecord, action: Action, now: int) -> ClockRecord:
    if action == "start":
        if c.state == "running":
            return c
        return ClockRecord("running", 0, now, None, now)
    if action == "pause":
        if c.state != "running" or c.started_at is None:
            return c
        return ClockRecord(
            "paused",
            c.accumulated_ms + max(0, now - c.started_at),
            None,
            now,
            now,
        )
    if action == "resume":
        if c.state != "paused":
            return c
        return ClockRecord("running", c.accumulated_ms, now, None, now)
    if action == "reset":
        return empty_clock(now)
    # status = 查询，不改状态
    return c