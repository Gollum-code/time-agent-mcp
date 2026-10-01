/**
 * 会话 / 任务时间戳管理。
 *
 * 默认使用内存 Map（零外部依赖）；若设置了环境变量 TIME_AGENT_STORE_FILE，
 * 则附加 JSON 文件持久化（进程重启后仍记得任务起始时刻）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { decomposeDuration } from "../util/time.js";

export interface SessionRecord {
  /** 会话 id */
  id: string;
  /** 会话首次建立时刻（unix ms） */
  startedAt: number;
  /** 最近一次 session_ping 时刻（unix ms） */
  lastPingAt: number;
  /** 任务起始时间戳表：taskId -> 起始时刻 */
  tasks: Record<string, number>;
}

export interface StoreFile {
  sessions: Record<string, SessionRecord>;
}

interface SessionLike {
  id: string;
  startedAt: number;
  lastPingAt: number;
  tasks: Record<string, number>;
}

const DEFAULT_STORE_FILE = () =>
  join(homedir(), ".time-agent-mcp", "session.json");

export class SessionStore {
  private sessions = new Map<string, SessionRecord>();
  private readonly filePath?: string;
  private loaded = false;

  constructor(filePath?: string) {
    this.filePath = filePath ?? process.env.TIME_AGENT_STORE_FILE ?? DEFAULT_STORE_FILE();
  }

  /** 惰性加载：仅当需要读旧会话时读盘一次。 */
  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (!existsSync(this.filePath!)) return;
      const parsed = JSON.parse(readFileSync(this.filePath!, "utf8")) as StoreFile;
      if (parsed && typeof parsed === "object") {
        for (const rec of Object.values(parsed.sessions ?? {})) {
          this.sessions.set(rec.id, rec);
        }
      }
    } catch {
      // 文件损坏直接忽略，不阻断服务
    }
  }

  /** 持久化（仅当配置了文件存储；写入失败不抛出）。 */
  private persist(): void {
    if (!this.filePath) return;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const out: StoreFile = { sessions: Object.fromEntries(this.sessions) };
      writeFileSync(this.filePath, JSON.stringify(out, null, 2), "utf8");
    } catch {
      // 写盘失败不致命：内存态仍可用
    }
  }

  private upsert(id: string): SessionRecord {
    this.load();
    let rec = this.sessions.get(id);
    if (!rec) {
      rec = { id, startedAt: Date.now(), lastPingAt: Date.now(), tasks: {} };
      this.sessions.set(id, rec);
    }
    return rec;
  }

  /** 取会话（不存在返回 null，不创建）。 */
  get(id: string): SessionRecord | null {
    this.load();
    return this.sessions.get(id) ?? null;
  }

  /** 记录/刷新一次会话心跳，返回会话记录。 */
  ping(id: string): SessionRecord {
    const rec = this.upsert(id);
    rec.lastPingAt = Date.now();
    this.persist();
    return { ...rec };
  }

  /** 注册一个任务起始时刻。label 用于返回给 LLM 说明性文本。 */
  startTask(id: string, taskId: string, startedAt = Date.now()): SessionRecord {
    const rec = this.upsert(id);
    rec.tasks[taskId] = startedAt;
    this.persist();
    return { ...rec };
  }

  /** 查询任务起始时刻（未开始返回 null）。 */
  getTaskStart(id: string, taskId: string): number | null {
    const rec = this.get(id);
    return rec?.tasks[taskId] ?? null;
  }

  /** 删除一个任务记录（比如 reset 后不保留）。 */
  clearTask(id: string, taskId: string): void {
    const rec = this.get(id);
    if (rec) {
      delete rec.tasks[taskId];
      this.persist();
    }
  }

  /** 全部会话数（诊断用）。 */
  size(): number {
    this.load();
    return this.sessions.size;
  }
}

export interface DurationResult {
  sessionId: string;
  taskId: string;
  startedAt: number;
  startedIso: string;
  now: number;
  elapsedMs: number;
  elapsed: ReturnType<typeof decomposeDuration>;
  isFirstCall: boolean;
  label?: string;
}

/** 帮助构造一致的「任务时长」返回结构。 */
export function buildDurationResult(
  sessionId: string,
  taskId: string,
  startedAt: number,
  now: number,
  isFirstCall: boolean,
  label?: string
): DurationResult {
  return {
    sessionId,
    taskId,
    startedAt,
    startedIso: new Date(startedAt).toISOString(),
    now,
    elapsedMs: now - startedAt,
    elapsed: decomposeDuration(now - startedAt),
    isFirstCall,
    label,
  };
}
