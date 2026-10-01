"""会话/任务时间戳管理（Python 版）。

默认用内存 dict；设置 TIME_AGENT_STORE_FILE 环境变量后可 JSON 文件持久化。
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .util import decompose_duration


@dataclass
class SessionRecord:
    id: str
    started_at: int
    last_ping_at: int
    tasks: dict[str, int] = field(default_factory=dict)


def _from_file(rec: dict) -> SessionRecord:
    """兼容 TS 版存储文件（camelCase 键）与自身 snake_case 键。"""
    return SessionRecord(
        id=rec["id"],
        started_at=rec.get("startedAt", rec.get("started_at", 0)),
        last_ping_at=rec.get("lastPingAt", rec.get("last_ping_at", 0)),
        tasks=rec.get("tasks", {}),
    )


def _to_file(rec: SessionRecord) -> dict:
    """以 TS 版同款格式（camelCase）落盘，两版可共享同一文件。"""
    return {"id": rec.id, "startedAt": rec.started_at, "lastPingAt": rec.last_ping_at, "tasks": rec.tasks}


def _default_store_file() -> Path:
    return Path.home() / ".time-agent-mcp" / "session.json"


class SessionStore:
    def __init__(self, file_path: str | None = None) -> None:
        self._file = Path(file_path) if file_path else Path(os.environ.get("TIME_AGENT_STORE_FILE") or _default_store_file())
        self._sessions: dict[str, SessionRecord] = {}
        self._loaded = False

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