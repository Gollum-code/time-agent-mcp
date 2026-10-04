# time-agent-mcp — 给没有时间感的 LLM 装一个时钟

> 你开一个 DeepSeek 窗口，说几句话，过几天再问「现在几点了」。
> 它回答的是**第一次对话的时间**。不是它笨——是**没人给它喂时间**。

本地部署（Ollama）/ 第三方中转 / 自建模型的 API 不会像官方那样在 system prompt 里注入当前时间，
于是模型靠**训练数据里的记忆**猜时间——这就是「时间幻觉」。

这个 MCP Server 给任何 LLM / Agent 框架装一个真正的时钟，并且**不只是知道几点**：
它还知道**任务跑了多久**、**距离截止还剩多久**、**东京 vs 纽约是几点**。

## Features

- ✅ **current_time** —— 现在几点/几号/周几/时区（含 UTC 偏移与 ISO 8601）
- ✅ **duration_elapsed** —— 任务从何时开始、已过去多久（时间流逝感知，真正的差异化）
- ✅ **time_until** —— 距离截止/提醒时刻还剩多久
- ✅ **timezone_convert** —— 任意 IANA 时区换算
- ✅ **session_ping** —— 会话心跳：感知「对话过了多久」
- ✅ **cron_mock** —— 模拟「现在到点了吗」，给定时决策（支持 cron / @宏 / every 30 minutes）
- ✅ **agent_clock** —— 会话级计时器：开始 / 暂停 / 恢复 / 重置 / 查询
- ✅ 零外部运行时依赖（时间源 = 系统时钟，时区 = IANA 内置库）
- ✅ TypeScript + Python 双版本，npm / pip 即装即用
- ✅ 支持 Ollama / LangChain / Claude Desktop / 任何 MCP 客户端

## 快速开始

### 1. 直接跑（无需安装）

```bash
# TypeScript 版（stdio，MCP 客户端默认接入）
npm run dev          # 开发模式（tsx）
npm run build && node dist/server.js

# TypeScript 版（Streamable HTTP，适合容器/远程）
node dist/server.js --http --port 8787

# Python 版
cd python && python -m time_agent_mcp
```

### 2. 安装到 MCP 客户端

**Claude Desktop**（`claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "time-agent": {
      "command": "node",
      "args": ["D:/project/time-agent-mcp/dist/server.js"]
    }
  }
}
```

**Python 版**：

```json
{
  "mcpServers": {
    "time-agent": {
      "command": "python",
      "args": ["-m", "time_agent_mcp"],
      "cwd": "D:/project/time-agent-mcp/python"
    }
  }
}
```

## 工具说明

| 工具 | 作用 | 关键参数 |
|---|---|---|
| `current_time` | 当前时间/日期/星期/时区 | `timezone`(可选，IANA) |
| `duration_elapsed` | 任务起始时刻 + 已流逝时长 | `session_id` `task_id` `started_at` `reset` |
| `time_until` | 距离目标时刻的倒计时 | `target` `timezone` `from`(TS)/`from_`(Python) |
| `timezone_convert` | 时区换算 | `to_timezone` `from_timezone` `time` |
| `session_ping` | 会话心跳，感知对话间隔 | `session_id` |
| `cron_mock` | 模拟「到点了吗」的定时决策 | `schedule` `timezone` `now` |
| `agent_clock` | 会话级计时器 | `session_id` `clock_id` `action` |

### 示例

```bash
# 现在几点了（上海）
current_time { timezone: "Asia/Shanghai" }

# 任务跑了多久：第一次调用自动开始计时
duration_elapsed { task_id: "scrape-catalog" }   # elapsed: 0
# ...10 分钟后再次调用
duration_elapsed { task_id: "scrape-catalog" }   # elapsed: 10 分 3 秒

# 距离截稿还剩多久
time_until { target: "2026-10-05T18:00:00", timezone: "Asia/Shanghai" }

# 东京 vs 纽约
timezone_convert { time: "2026-10-01T12:00:00", from_timezone: "Asia/Tokyo", to_timezone: "America/New_York" }

# 对话过了多久
session_ping { session_id: "deepseek-chat-01" }

# 每天 18:00 到点了吗（定时决策）
cron_mock { schedule: "0 18 * * *", timezone: "Asia/Shanghai" }
# 或自然语法
cron_mock { schedule: "every 30 minutes" }

# 会话级计时器：跑批任务计时
agent_clock { clock_id: "batch", action: "start" }
agent_clock { clock_id: "batch", action: "status" }   # 查询
agent_clock { clock_id: "batch", action: "pause" }    # 暂停
agent_clock { clock_id: "batch", action: "resume" }   # 恢复
agent_clock { clock_id: "batch", action: "reset" }    # 清零
```

## 为什么需要它

| 场景 | 官方 API（已注入时间） | 本地部署/中转/自建（未注入） |
|---|---|---|
| 「现在几点？」 | 正确 | **幻觉**（背的是训练数据里的时间） |
| 「任务跑了 10 分钟没？」 | 不知道 | **不知道**（没人在对话里报时间） |
| 「还剩几分钟截止？」 | 不知道 | **不知道** |

现有 MCP 方案只解决「现在几点」。**time-agent-mcp 差异化在时间流逝感知**：
`duration_elapsed` / `session_ping` 让 Agent 对自己跑了多久、等了多久有真实感知。

## 状态存储

默认**内存 Map**；设置环境变量 `TIME_AGENT_STORE_FILE` 可启用 JSON 文件持久化，
重启后仍记得任务起始时刻。TypeScript 与 Python 版本共用同一文件格式。

- `TIME_AGENT_MAX_SESSIONS`（默认 1000）：超过上限按最近活动时间（LRU）淘汰最旧会话，
  防止无限膨胀。
- 返回结果同时含 `content`（文本 JSON）与 `structuredContent`（结构化对象），
  支持 MCP 的模型层直接消费对象。

## 运行模式

| 模式 | 启动方式 | 场景 |
|---|---|---|
| stdio | `node dist/server.js` | Claude Desktop / Cline 等桌面客户端 |
| HTTP | `node dist/server.js --http --port 8787` | 容器 / 远程 / 集群部署 |

## 安装与开发

```bash
npm install          # 安装依赖 + 构建
npm test             # 运行测试（TS）
cd python && pip install -e ".[test]" && python -m pytest ../tests_py
```

## Roadmap

- [x] M1：TS 版 5 个核心工具 + 示例 + 测试
- [x] M2：Python 版 + 测试（双版本行为对齐）+ cron_mock + agent_clock
- [x] M3：npm / PyPI 发布
- [x] 0.3.0：性能优化（cron 跳跃式扫描）、时区往返校验（拒非法日期/DST 空洞）、structuredContent、存储 LRU、HTTP transport、CI
- [ ] 演示 GIF + 各平台推广

## 生态

与 [mcp-doctor](https://github.com/)（MCP Server 健康检查）同一生态系列：
一个让 Agent 感知时间，一个让 MCP Server 更可靠。

## License

MIT
