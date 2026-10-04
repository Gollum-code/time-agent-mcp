"""会话/任务时间戳管理（Python 版）。

默认用内存 dict；设置 TIME_AGENT_STORE_FILE 环境变量后可 JSON 文件持久化。
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .clock import ClockRecord, empty_clock
from .util import decompose_duration


@dataclass
class SessionRecord:
    id: str
    started_at: int
    last_ping_at: int
    tasks: dict[str, int] = field(default_factory=dict)
    clocks: dict[str, ClockRecord] = field(default_factory=dict)


def _clock_from_file(data: dict) -> ClockRecord:
    return ClockRecord(
        state=data.get("state", "idle"),
        accumulated_ms=data.get("accumulatedMs", data.get("accumulated_ms", 0)),
        started_at=data.get("startedAt", data.get("started_at")),
        paused_at=data.get("pausedAt", data.get("paused_at")),
        updated_at=data.get("updatedAt", data.get("updated_at", 0)),
    )


def _clock_to_file(c: ClockRecord) -> dict:
    return {
        "state": c.state,
        "accumulatedMs": c.accumulated_ms,
        "startedAt": c.started_at,
        "pausedAt": c.paused_at,
        "updatedAt": c.updated_at,
    }


def _from_file(rec: dict) -> SessionRecord:
    """兼容 TS 版存储文件（camelCase 键）与自身 snake_case 键。"""
    return SessionRecord(
        id=rec["id"],
        started_at=rec.get("startedAt", rec.get("started_at", 0)),
        last_ping_at=rec.get("lastPingAt", rec.get("last_ping_at", 0)),
        tasks=rec.get("tasks", {}) or {},
        clocks={
            k: _clock_from_file(v) for k, v in (rec.get("clocks", {}) or {}).items()
        },
    )


def _to_file(rec: SessionRecord) -> dict:
    """以 TS 版同款格式（camelCase）落盘，两版可共享同一文件。"""
    return {
        "id": rec.id,
        "startedAt": rec.started_at,
        "lastPingAt": rec.last_ping_at,
        "tasks": rec.tasks,
        "clocks": {k: _clock_to_file(v) for k, v in rec.clocks.items()},
    }


def _default_store_file() -> Path:
    return Path.home() / ".time-agent-mcp" / "session.json"


class SessionStore:
    def __init__(self, file_path: str | None = None, max_sessions: int | None = None) -> None:
        self._file = Path(file_path) if file_path else Path(os.environ.get("TIME_AGENT_STORE_FILE") or _default_store_file())
        self._sessions: dict[str, SessionRecord] = {}
        self._loaded = False
        env_max = os.environ.get("TIME_AGENT_MAX_SESSIONS")
        self._max_sessions = max_sessions or (int(env_max) if env_max and env_max.isdigit() and int(env_max) > 0 else 1000)

    def _evict(self) -> None:
        """LRU 淘汰：超过 max_sessions 时按 last_ping_at 最旧优先删除。"""
        while len(self._sessions) > self._max_sessions:
            oldest_id = min(self._sessions, key=lambda k: self._sessions[k].last_ping_at)
            del self._sessions[oldest_id]

    def _load(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        try:
            if not self._file.exists():
                return
            data = json.loads(self._file.read_text("utf-8"))
            for rec in data.get("sessions", {}).values():
                self._sessions[_from_file(rec).id] = _from_file(rec)
        except (OSError, ValueError):
            pass

    def _persist(self) -> None:
        try:
            self._evict()
            self._file.parent.mkdir(parents=True, exist_ok=True)
            self._file.write_text(
                json.dumps({"sessions": {k: _to_file(v) for k, v in self._sessions.items()}}, ensure_ascii=False, indent=2),
                "utf-8",
            )
        except OSError:
            pass

    def get(self, sid: str) -> Optional[SessionRecord]:
        self._load()
        return self._sessions.get(sid)

    def _upsert(self, sid: str, now: int) -> SessionRecord:
        self._load()
        rec = self._sessions.get(sid)
        if rec is None:
            rec = SessionRecord(id=sid, started_at=now, last_ping_at=now)
            self._sessions[sid] = rec
            self._evict()
        return rec

    def ping(self, sid: str) -> SessionRecord:
        now = _now_ms()
        rec = self._upsert(sid, now)
        rec.last_ping_at = now
        self._persist()
        return rec

    def start_task(self, sid: str, task_id: str, started_at: int | None = None) -> SessionRecord:
        now = _now_ms()
        rec = self._upsert(sid, now)
        rec.tasks[task_id] = started_at if started_at is not None else now
        self._persist()
        return rec

    def get_task_start(self, sid: str, task_id: str) -> int | None:
        rec = self.get(sid)
        return rec.tasks.get(task_id) if rec else None

    def clear_task(self, sid: str, task_id: str) -> None:
        rec = self.get(sid)
        if rec and task_id in rec.tasks:
            del rec.tasks[task_id]
            self._persist()

    def get_clock(self, sid: str, clock_id: str) -> Optional[ClockRecord]:
        rec = self.get(sid)
        return rec.clocks.get(clock_id) if rec else None

    def get_or_create_clock(self, sid: str, clock_id: str, now: int) -> ClockRecord:
        self._load()
        rec = self._sessions.get(sid)
        if rec is None:
            rec = SessionRecord(id=sid, started_at=now, last_ping_at=now)
            self._sessions[sid] = rec
            self._evict()
        if clock_id not in rec.clocks:
            rec.clocks[clock_id] = empty_clock(now)
        self._persist()
        return rec.clocks[clock_id]

    def set_clock(self, sid: str, clock_id: str, record: ClockRecord) -> None:
        self._load()
        rec = self._sessions.get(sid)
        if rec is None:
            rec = SessionRecord(id=sid, started_at=_now_ms(), last_ping_at=_now_ms())
            self._sessions[sid] = rec
        rec.clocks[clock_id] = record
        self._persist()

    def clear_clock(self, sid: str, clock_id: str) -> None:
        rec = self.get(sid)
        if rec and clock_id in rec.clocks:
            del rec.clocks[clock_id]
            self._persist()


def _now_ms() -> int:
    from time import time as _time

    return int(_time() * 1000)


def build_duration_result(
    session_id: str,
    task_id: str,
    started_at: int,
    now: int,
    is_first_call: bool,
    label: str | None = None,
) -> dict:
    elapsed_ms = now - started_at
    return {
        "session_id": session_id,
        "task_id": task_id,
        "started_at": started_at,
        "started_iso": _iso(started_at),
        "now": now,
        "elapsed_ms": elapsed_ms,
        "elapsed": decompose_duration(elapsed_ms),
        "is_first_call": is_first_call,
        "label": label,
    }


def _iso(ms: int) -> str:
    from datetime import datetime, timezone as _tz

    return datetime.fromtimestamp(ms / 1000, tz=_tz.utc).isoformat(timespec="seconds")