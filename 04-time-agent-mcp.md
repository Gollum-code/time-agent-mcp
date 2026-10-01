# time-agent-mcp — Agent 时间感知 MCP Server · 开源引流方案

> 定位：给"没有时间感"的 LLM / Agent 装一个真正的时钟。
> 开源免费 · 踩 MCP 热点 · 与 mcp-doctor 同生态系列 · 引流工具，非收费产品

---

## 一、核心痛点（README 开头素材）

> 场景：你开一个 DeepSeek 窗口，说几句话，过几天再问"现在几点了"。
> 它回答的是**第一次对话的时间**。不是它笨——是**没人给它喂时间**。

| 时间概念 | 现状 |
|---|---|
| 训练数据截止时间 | 模型背得滚瓜烂熟，但那是过去 |
| 推理时的时间 | **官方 API 在 system prompt 注入**；本地部署（Ollama）/第三方中转/自建模型**没有注入** → 幻觉 |

**关键缺口**：现有方案只解决"模型知道现在几点"，几乎没人解决 **"模型知道过了多久"**——Agent 跑一个 10 分钟任务，对时间流逝完全无感。这才是真正的空白。

---

## 二、定位

一个 MCP Server，为任何 LLM / Agent 框架提供**时间感知能力**：

```
能力1：current_time     —— 现在几点、几号、周几、时区
能力2：duration_elapsed —— 任务从何时开始、已过去多久
能力3：schedule_hint     —— 距离某个时刻/截止时间还剩多久
能力4：timezone_aware    —— 多时区换算（用户在东京，队友在纽约）
```

面向：本地模型用户（Ollama）、自建 LLM API、LangChain/AutoGen/自研 Agent 框架、以及所有被"时间幻觉"坑过的开发者。

---

## 三、功能清单

| 模块 | 功能 | MVP必做 |
|---|---|---|
| current_time | 返回当前时间/日期/星期/时区 | ✅ |
| duration_elapsed | 记录任务开始时间戳，返回已流逝时长 | ✅ |
| time_until | 距离指定时刻的剩余时间 | ✅ |
| timezone_convert | 任意时区换算 | ✅ |
| session_ping | 每次对话更新时间戳（感知"对话过了多久"） | ✅ |
| cron_mock | 模拟"现在到点了吗"（给定时决策用） | M2 |
| agent_clock | 给 Agent 的会话级计时器（开始/暂停/重置） | M2 |

---

## 四、技术方案

| 层 | 选型 | 说明 |
|---|---|---|
| MCP 协议 | 官方 `@modelcontextprotocol/sdk` | 官方标准，支持 stdio + HTTP |
| 语言 | TypeScript（Node）+ Python 双版本 | 覆盖两大生态 |
| 时间源 | 系统时间 + IANA 时区库（Intl / zoneinfo） | 零外部依赖 |
| 会话状态 | 本地 SQLite / 内存 Map | 记录任务开始时间戳 |
| 分发 | npm + PyPI 双发布 | 安装即用 |

### 架构
```
LLM / Agent 框架 (Ollama / LangChain / Claude Desktop)
   │  MCP 协议
   ▼
time-agent-mcp
   ├─ tools/current_time      → 系统时钟
   ├─ tools/duration_elapsed  → 会话时间戳 → 差值
   ├─ tools/time_until        → 目标时刻 → 倒计时
   ├─ tools/timezone_convert  → IANA 时区库
   └─ store/session.db        → 任务起始记录
```

---

## 五、目录结构

```
time-agent-mcp/
├─ src/
│  ├─ server.ts          # MCP server 入口
│  ├─ tools/
│  │  ├─ currentTime.ts
│  │  ├─ durationElapsed.ts
│  │  ├─ timeUntil.ts
│  │  └─ timezoneConvert.ts
│  ├─ store/
│  │  └─ session.ts      # 会话时间戳管理
│  └─ util/
│      └─ time.ts        # 时间/时区工具
├─ python/
│  └─ time_agent_mcp/    # Python 版（mcp 库）
├─ examples/
│  ├─ ollama.md          # Ollama 接入示例
│  └─ langchain.md       # LangChain 接入示例
├─ tests/
├─ README.md
├─ package.json
└─ pyproject.toml
```

---

## 六、README 卖点（拿 star 关键）

```
标题：# time-agent-mcp — 给没有时间感的 LLM 装一个时钟

开头演示图/一句话：
「你问 DeepSeek 现在几点，它答第一次对话的时间。这个 MCP Server
  让任何本地模型 / Agent 拥有真正的时间感知。」

Features（一行一个，全部可演示）：
✅ current_time —— 现在几点/几号/周几/时区
✅ duration_elapsed —— Agent 任务跑了多久，一清二楚
✅ time_until —— 距离截止/提醒时刻还有多久
✅ timezone_convert —— 多时区换算
✅ 零外部依赖，npm / pip 即装即用
✅ 支持 Ollama / LangChain / Claude Desktop / 任何 MCP 客户端

演示 GIF：
「开一个本地模型 → 问时间 → 答幻觉 → 接上本工具 → 再问 → 准确」
```

---

## 七、推广话术（发帖标题）

| 平台 | 标题 |
|---|---|
| GitHub | `time-agent-mcp: 给没有时间感的 LLM 装一个时钟` |
| r/LocalLLaMA | `Your local model doesn't know what time it is. This MCP server fixes it.` |
| 掘金/知乎 | 《DeepSeek 为什么答错"现在几点"？原因不是它笨》 |
| V2EX | 给本地部署的模型装个表——time-agent-mcp |
| Hacker News | `Show HN: time-agent-mcp — a clock for LLMs that don't know time` |

**核心传播钩子**：所有人都会心一笑的"DeepSeek 时间幻觉"现象 → 直击痛点 → 演示效果直观。

---

## 八、Roadmap

| 阶段 | 时间 | 交付 |
|---|---|---|
| M1 | 1 周 | TS 版 4 个核心 tool + Ollama 接入示例 + README |
| M2 | 1 周 | Python 版 + LangChain 示例 + 测试 |
| M3 | 1 周 | 打包发布 npm/pypi + 演示 GIF + 各平台发帖 |
| 合计 | **3 周上线** | |

---

## 九、开源引流联动

与 mcp-doctor（15 号方案）同一生态，形成系列：

```
time-agent-mcp  → 解决"模型没时间感"
mcp-doctor      → 解决"MCP server 没人测试"
共同话题：MCP 生态 + 中文开发者
→ GitHub 系列账号 → 品牌沉淀
→ 长期：可能被 MCP 生态/Agent 框架厂商关注 → 机会
```

---

## 十、成本与风险

| 项目 | 说明 |
|---|---|
| 成本 | ¥0（全开源依赖） |
| 风险1 | 官方 API 已注入时间，普通用户感知不强 → **瞄准本地部署/中转/自建人群** |
| 风险2 | MCP Time 类已有人做过基础版 → **差异化在 duration_elapsed / agent_clock（时间流逝感知）** |
| 风险3 | star 不等于钱 → **明确目的：引流 + 品牌，非直接变现** |

---

## 十一、为什么做这个

- 踩中 MCP 生态热点（类比 mcp-doctor，蓝海）
- 痛点真实（DeepSeek 时间幻觉，人人见过）
- 演示效果直观（GIF 对比，传播性强）
- 成本 ¥0，3 周可上线
- **角色定位**：开源引流项目，为长期品牌铺路，不是收费产品
