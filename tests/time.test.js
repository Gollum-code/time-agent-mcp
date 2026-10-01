/**
 * TS 版单元测试：时间/时区工具 + 会话存储。
 * 运行：npm test（= npm run build && node --test tests/*.test.js）
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decomposeDuration,
  formatOffset,
  isValidTimezone,
  parseToUtcMs,
  toZonedSnapshot,
} from "../dist/util/time.js";
import { SessionStore } from "../dist/store/session.js";

const at = (iso) => new Date(iso);

test("isValidTimezone: 接受 IANA 名，拒垃圾", () => {
  assert.equal(isValidTimezone("Asia/Shanghai"), true);
  assert.equal(isValidTimezone("America/New_York"), true);
  assert.equal(isValidTimezone("Mars/Olympus"), false);
});

test("formatOffset", () => {
  assert.equal(formatOffset(0), "+00:00");
  assert.equal(formatOffset(8 * 3600e3), "+08:00");
  assert.equal(formatOffset(-5.5 * 3600e3), "-05:30");
});

test("parseToUtcMs: 带偏移 ISO", () => {
  assert.equal(parseToUtcMs("2026-10-01T12:00:00+08:00"), Date.UTC(2026, 9, 1, 4, 0, 0));
});

test("parseToUtcMs: 不带偏移按目标时区解释墙钟", () => {
  assert.equal(
    parseToUtcMs("2026-10-01 12:00:00", "Asia/Shanghai"),
    Date.UTC(2026, 9, 1, 4, 0, 0)
  );
});

test("parseToUtcMs: 垃圾输入返回 null", () => {
  assert.equal(parseToUtcMs("not-a-time"), null);
  assert.equal(parseToUtcMs(""), null);
});

test("toZonedSnapshot: 字段正确", () => {
  const snap = toZonedSnapshot(at("2026-10-01T04:00:00Z"), "Asia/Shanghai");
  assert.equal(snap.date, "2026-10-01");
  assert.equal(snap.time, "12:00:00");
  assert.equal(snap.weekday, "星期四");
  assert.equal(snap.offset, "+08:00");
  assert.equal(snap.offsetMs, 8 * 3600e3);
});

test("toZonedSnapshot: 纽约夏令时偏移 -04:00", () => {
  const snap = toZonedSnapshot(at("2026-07-01T12:00:00Z"), "America/New_York");
  assert.equal(snap.offset, "-04:00");
  assert.equal(snap.time, "08:00:00");
});

test("decomposeDuration: 拆解正确", () => {
  const d = decomposeDuration((1 * 86400 + 2 * 3600 + 3 * 60 + 4) * 1000);
  assert.equal(d.days, 1);
  assert.equal(d.hours, 2);
  assert.equal(d.minutes, 3);
  assert.equal(d.secondsRemainder, 4);
  assert.equal(d.human, "1 天 2 小时 3 分 4 秒");
  assert.equal(d.compact, "1d 02:03:04");
});

test("decomposeDuration: 负数为已过", () => {
  const d = decomposeDuration(-65_000);
  assert.equal(d.human, "已过 1 分 5 秒");
});

test("decomposeDuration: 0", () => {
  const d = decomposeDuration(0);
  assert.equal(d.human, "0 秒");
  assert.equal(d.compact, "00:00:00");
});

test("SessionStore: 首次 startTask 后能取回", () => {
  const store = new SessionStore(""); // 空路径 → 不持久化
  store.startTask("s1", "t1", 1000);
  assert.equal(store.getTaskStart("s1", "t1"), 1000);
});

test("SessionStore: ping 更新 lastPingAt 且可查会话", () => {
  const store = new SessionStore("");
  const rec = store.ping("s2");
  assert.equal(rec.id, "s2");
  assert.ok(store.get("s2"));
  assert.equal(store.getTaskStart("s2", "nope"), null);
});

test("SessionStore: clearTask 删除任务", () => {
  const store = new SessionStore("");
  store.startTask("s3", "t3", 123);
  store.clearTask("s3", "t3");
  assert.equal(store.getTaskStart("s3", "t3"), null);
});