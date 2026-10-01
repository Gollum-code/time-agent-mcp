/**
 * M2 功能测试：cron_mock 解析/计算 + agent_clock 状态机。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseCron,
  cronMatch,
  nextFireTime,
  lastFireTime,
  evaluateCron,
  describeSchedule,
} from "../dist/util/cron.js";
import {
  emptyClock,
  clockElapsed,
  clockTransition,
} from "../dist/util/clock.js";

const at = (iso) => new Date(iso).getTime();
const atDate = (iso) => new Date(iso);
const SH = "Asia/Shanghai";

test("parseCron: 标准 5 字段", () => {
  const s = parseCron("0 18 * * *");
  assert.equal(s.minute.any, false);
  assert.deepEqual(s.minute.values, [0]);
  assert.deepEqual(s.hour.values, [18]);
  assert.equal(s.dayOfMonth.any, true);
});

test("parseCron: 步进与范围", () => {
  const s = parseCron("*/15 9-17 * * *");
  assert.deepEqual(s.minute.values, [0, 15, 30, 45]);
  assert.deepEqual(s.hour.values, [9, 10, 11, 12, 13, 14, 15, 16, 17]);
});

test("parseCron: 宏展开", () => {
  assert.equal(parseCron("@daily").minute.values[0], 0);
  assert.equal(parseCron("@hourly").minute.values[0], 0);
  assert.equal(parseCron("@hourly").minute.values.length, 1);
});

test("parseCron: every 自然语法", () => {
  assert.deepEqual(parseCron("every 30 minutes").minute.values, [0, 30]);
  assert.deepEqual(parseCron("every 2 hours").hour.values, [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]);
  assert.deepEqual(parseCron("every day").hour.values, [0]);
});

test("parseCron: 非法输入抛错", () => {
  assert.throws(() => parseCron("0 18 * *"));
  assert.throws(() => parseCron("bad"));
  assert.throws(() => parseCron("0 99 * * *"));
  assert.throws(() => parseCron(""));
});

test("cronMatch: 固定时刻命中", () => {
  const s = parseCron("0 18 * * *");
  assert.equal(cronMatch(s, atDate("2026-10-01T10:00:00Z"), SH), true); // 上海 18:00
  assert.equal(cronMatch(s, atDate("2026-10-01T09:59:00Z"), SH), false);
});

test("cronMatch: 每周一 09:00", () => {
  // 2026-10-05 是周一
  const s = parseCron("0 9 * * 1");
  assert.equal(cronMatch(s, atDate("2026-10-05T01:00:00Z"), SH), true);
  assert.equal(cronMatch(s, atDate("2026-10-06T01:00:00Z"), SH), false);
});

test("cronMatch: 周日 0/7 归一化", () => {
  // 2026-10-04 是周日；上海周日 00:00 = UTC 2026-10-03T16:00
  const s = parseCron("0 0 * * 0");
  assert.equal(cronMatch(s, atDate("2026-10-03T16:00:00Z"), SH), true);
  assert.equal(cronMatch(s, atDate("2026-10-04T16:00:00Z"), SH), false); // 上海已是周一
});

test("nextFireTime: 固定 18:00 上海", () => {
  const s = parseCron("0 18 * * *");
  // 从 上海 10-01 12:00（UTC 04:00）出发 → 下一个触发 UTC 10-01 10:00
  assert.equal(nextFireTime(s, at("2026-10-01T04:00:00Z"), SH), at("2026-10-01T10:00:00Z"));
});

test("nextFireTime: 每 15 分钟", () => {
  const s = parseCron("*/15 * * * *");
  assert.equal(nextFireTime(s, at("2026-10-01T10:03:00Z"), SH), at("2026-10-01T10:15:00Z"));
});

test("lastFireTime: 上一个触发", () => {
  const s = parseCron("0 18 * * *");
  assert.equal(lastFireTime(s, at("2026-10-01T10:00:00Z"), SH), at("2026-10-01T10:00:00Z"));
  assert.equal(lastFireTime(s, at("2026-10-01T10:00:01Z"), SH), at("2026-10-01T10:00:00Z"));
});

test("describeSchedule", () => {
  assert.equal(describeSchedule(parseCron("0 18 * * *")), "每天 18:00");
  assert.equal(describeSchedule(parseCron("* * * * *")), "每分钟");
  assert.equal(describeSchedule(parseCron("0 9 * * 1")), "每周 周一 09:00");
});

test("evaluateCron: 整合判定", () => {
  const r = evaluateCron("0 18 * * *", SH, at("2026-10-01T04:00:00Z"));
  assert.equal(r.timing.matchesNow, false);
  assert.equal(r.timing.nextRun, at("2026-10-01T10:00:00Z"));
  assert.equal(r.timing.timeUntilNextMs, 6 * 3600e3);
  assert.equal(r.timing.humanSummary, "每天 18:00");
});

test("evaluateCron: 命中时刻", () => {
  const r = evaluateCron("0 18 * * *", SH, at("2026-10-01T10:00:00Z"));
  assert.equal(r.timing.matchesNow, true);
});

test("clockTransition: start→pause→resume 累计正确", () => {
  const c0 = emptyClock(1_000);
  const c1 = clockTransition(c0, "start", 1_000);       // 开始
  assert.equal(c1.state, "running");
  const c2 = clockTransition(c1, "pause", 5_000);        // 跑 4s 后暂停
  assert.equal(c2.state, "paused");
  assert.equal(c2.accumulatedMs, 4_000);
  const c3 = clockTransition(c2, "resume", 7_000);       // 恢复
  assert.equal(c3.state, "running");
  assert.equal(c3.accumulatedMs, 4_000);
  const c4 = clockTransition(c3, "pause", 9_000);        // 再跑 2s
  assert.equal(c4.accumulatedMs, 6_000);
  assert.equal(clockElapsed(c4, 9_000), 6_000);
});

test("clockTransition: 重复动作幂等", () => {
  const c1 = clockTransition(emptyClock(0), "start", 0);
  assert.equal(clockTransition(c1, "start", 100).state, "running");
  const p = clockTransition(c1, "pause", 100);
  assert.equal(clockTransition(p, "resume", 200).state, "running");
  assert.equal(clockTransition(p, "pause", 200).state, "paused");
});

test("clockTransition: reset 清零", () => {
  let c = emptyClock(0);
  c = clockTransition(c, "start", 0);
  c = clockTransition(c, "pause", 10_000);
  c = clockTransition(c, "reset", 10_000);
  assert.equal(c.state, "idle");
  assert.equal(c.accumulatedMs, 0);
});

test("clockElapsed: running 含当前段", () => {
  const c = clockTransition(emptyClock(0), "start", 0);
  assert.equal(clockElapsed(c, 5_000), 5_000);
});