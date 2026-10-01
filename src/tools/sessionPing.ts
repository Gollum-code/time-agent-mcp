/**
 * session_ping —— 每次对话更新时间戳，让模型感知「对话过了多久」。
 */
import { z } from "zod";
import { SessionStore } from "../store/session.js";
import { decomposeDuration, isValidTimezone, snapshotNow } from "../util/time.js";

export const sessionPingSchema = {
  session_id: z
    .string()
    .optional()
    .describe("会话 id，缺省为 default；同一客户端可固定一个 id 以累计会话时长"),
  timezone: z.string().optional().describe("返回时间所用的 IANA 时区，缺省系统时区"),
};

export async function sessionPing(
  store: SessionStore,
  args: { session_id?: string; timezone?: string }
) {
  const sessionId = args.session_id ?? "default";
  if (args.timezone && !isValidTimezone(args.timezone)) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: `无效时区: ${args.timezone}` }) }],
      isError: true,
    };
  }

  const before = store.get(sessionId);
  const rec = store.ping(sessionId);
  const now = Date.now();
  const sessionAgeMs = now - rec.startedAt;
  const sinceLastPingMs = before ? now - before.lastPingAt : 0;
  const age = decomposeDuration(sessionAgeMs);
  const gap = decomposeDuration(sinceLastPingMs);
  const nowSnapshot = snapshotNow(args.timezone);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            ok: true,
            session_id: rec.id,
            first_seen: before === null,
            started_at: new Date(rec.startedAt).toISOString(),
            last_ping_at: new Date(rec.lastPingAt).toISOString(),
            now_iso: nowSnapshot.iso,
            unix_now: now,
            session_age_human: age.human,
            session_age_compact: age.compact,
            since_last_ping_human: gap.human,
            since_last_ping_compact: gap.compact,
            hint:
              before === null
                ? "新会话已建立：从现在起，模型可以感知后续对话间隔了。"
                : sinceLastPingMs > 60_000
                  ? "距上次对话已超过 1 分钟，请留意时间流逝。"
                  : "对话仍连续进行中。",
          },
          null,
          2
        ),
      },
    ],
  };
}