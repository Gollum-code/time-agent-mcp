// Smoke test: spawn the built server, speak minimal MCP JSON-RPC over stdio.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const proc = spawn(process.execPath, ["dist/server.js"], { stdio: ["pipe", "pipe", "inherit"] });
const rl = createInterface({ input: proc.stdout });

let id = 0;
const pending = new Map();

rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: msgId, method, params }) + "\n");
    setTimeout(() => {
      if (pending.has(msgId)) {
        pending.delete(msgId);
        reject(new Error(`timeout: ${method}`));
      }
    }, 10000);
  });
}

const init = await send("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0.0.1" },
});
console.log("initialize:", init.result.serverInfo);
await send("notifications/initialized", {});

const tools = await send("tools/list", {});
const names = tools.result.tools.map((t) => t.name).sort();
console.log("tools:", names.join(", "));

for (const name of ["current_time", "session_ping"]) {
  const res = await send("tools/call", { name, arguments: {} });
  const text = res.result.content[0]?.text ?? "";
  console.log(`call ${name}:`, text.split("\n")[0]);
}

const d1 = await send("tools/call", { name: "duration_elapsed", arguments: { task_id: "smoke" } });
console.log("duration_elapsed #1:", JSON.parse(d1.result.content[0].text).elapsed_human);
const d2 = await send("tools/call", { name: "duration_elapsed", arguments: { task_id: "smoke" } });
console.log("duration_elapsed #2:", JSON.parse(d2.result.content[0].text).elapsed_human);

const tu = await send("tools/call", {
  name: "time_until",
  arguments: { target: "2099-01-01T00:00:00", timezone: "Asia/Shanghai" },
});
console.log("time_until:", JSON.parse(tu.result.content[0].text).remaining_human);

const tc = await send("tools/call", {
  name: "timezone_convert",
  arguments: { time: "2026-10-01T12:00:00", from_timezone: "Asia/Shanghai", to_timezone: "America/New_York" },
});
console.log("timezone_convert:", JSON.parse(tc.result.content[0].text).note);

const cm = await send("tools/call", {
  name: "cron_mock",
  arguments: { schedule: "0 18 * * *", timezone: "Asia/Shanghai", now: "2026-10-01T04:00:00Z" },
});
const cmText = JSON.parse(cm.result.content[0].text);
console.log("cron_mock:", cmText.description, "| next:", cmText.next_run, "| until:", cmText.time_until_next_human);

const ac1 = await send("tools/call", { name: "agent_clock", arguments: { clock_id: "smoke", action: "start" } });
const ac2 = await send("tools/call", { name: "agent_clock", arguments: { clock_id: "smoke", action: "status" } });
console.log("agent_clock start:", JSON.parse(ac1.result.content[0].text).state_label);
console.log("agent_clock status:", JSON.parse(ac2.result.content[0].text).elapsed_human);

proc.kill();
process.exit(0);
