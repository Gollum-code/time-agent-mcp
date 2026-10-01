/**
 * agent_clock —— 会话级计时器状态机（纯函数，便于测试）。
 *
 * 状态：idle（未开始）→ running（计时中）⇄ paused（暂停）。
 * 每次 transition 返回新记录（不可变更新）。
 */

export type ClockState = "idle" | "running" | "paused";

export type ClockAction = "start" | "pause" | "resume" | "reset" | "status";

export interface ClockRecord {
  state: ClockState;
  /** 已累计时长（不含当前 running 段的毫秒） */
  accumulatedMs: number;
  /** 当前 running 段的起始时刻（unix ms），非 running 为 null */
  startedAt: number | null;
  /** 最近一次暂停时刻（unix ms），非 paused 为 null */
  pausedAt: number | null;
  /** 最近一次变更时刻（unix ms） */
  updatedAt: number;
}

export function emptyClock(now: number): ClockRecord {
  return { state: "idle", accumulatedMs: 0, startedAt: null, pausedAt: null, updatedAt: now };
}

/** 当前有效时长 = 累计 + （若 running）当前段时长。 */
export function clockElapsed(c: ClockRecord, now: number): number {
  if (c.state === "running" && c.startedAt !== null) {
    return c.accumulatedMs + Math.max(0, now - c.startedAt);
  }
  return c.accumulatedMs;
}

/**
 * 状态迁移。status 不改状态，仅用于查询（返回原记录）。
 * 非法的重复动作（如对 running 再 start）原样返回，不报错。
 */
export function clockTransition(
  c: ClockRecord,
  action: ClockAction,
  now: number
): ClockRecord {
  switch (action) {
    case "start":
      if (c.state === "running") return c;
      return { state: "running", accumulatedMs: 0, startedAt: now, pausedAt: null, updatedAt: now };
    case "pause":
      if (c.state !== "running" || c.startedAt === null) return c;
      return {
        state: "paused",
        accumulatedMs: c.accumulatedMs + Math.max(0, now - c.startedAt),
        startedAt: null,
        pausedAt: now,
        updatedAt: now,
      };
    case "resume":
      if (c.state !== "paused") return c;
      return { state: "running", accumulatedMs: c.accumulatedMs, startedAt: now, pausedAt: null, updatedAt: now };
    case "reset":
      return emptyClock(now);
    case "status":
    default:
      return c;
  }
}