# 接入 Ollama 本地模型

Ollama 本地部署的模型**不会**被官方注入当前时间——这是时间幻觉的重灾区。
接入 time-agent-mcp 后，本地模型立刻拥有真正的时间感知。

## 方式一：Ollama + MCP（Claude Desktop / Cline 等 MCP 客户端）

先构建并确认服务器可运行：

```bash
cd time-agent-mcp
npm run build
node dist/server.js          # 启动后保持 stdio 等待
```

在 MCP 客户端里注册（以 Claude Desktop 为例，`claude_desktop_config.json`）：

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

然后让 Ollama 驱动的模型调用即可。例如在对话里：

```
你是一个有时间感的助手。请先用 current_time 工具查询当前时间，
再回答"现在几点了"。
```

## 方式二：直接调用工具逻辑（无 MCP 客户端，纯 HTTP 中转）

很多自建 Agent 走 OpenAI 兼容 API + 工具调用。time-agent-mcp 本质是几个纯函数，
也可以在 Agent 侧自己维护：

```js
// 伪代码：Agent 主循环里注入时间上下文
const now = await fetch("http://localhost:8787/current_time"); // 或任何时间源
systemPrompt += `\n当前时间：${now.iso}（${now.weekday}）`;
```

## 演示场景（幻觉 vs 真实）

| 提问 | 无 time-agent-mcp | 接入后 |
|---|---|---|
| 现在几点了？ | 回答第一次对话的时间 | `current_time` → 准确 |
| 这个爬虫任务跑了多久？ | 不知道 | `duration_elapsed` → 已跑 X 分 X 秒 |
| 距离 18:00 截止还剩多久？ | 瞎猜 | `time_until` → 剩余 X 分 X 秒 |

## 验证

```bash
node scripts/smoke.mjs
```

能看到 5 个工具均返回 `ok: true` 即接入成功。
