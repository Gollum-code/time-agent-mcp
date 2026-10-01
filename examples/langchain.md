# 接入 LangChain

LangChain（Python / TypeScript）通过 `load_mcp_adapters` 或 MCP tool adapter 使用
time-agent-mcp。这是把时间感知注入通用 Agent 的最干净方式。

## Python / LangChain

```python
from langchain_mcp_adapters.tools import load_mcp_tools
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

server_params = StdioServerParameters(
    command="python",
    args=["-m", "time_agent_mcp"],
    cwd="F:/project/time-agent-mcp/python"
)

async with stdio_client(server_params) as (read, write):
    async with ClientSession(read, write) as session:
        await session.initialize()

        # 载入 time-agent-mcp 的 5 个工具
        tools = await load_mcp_tools(session)

        # 一个本地模型（如 Ollama 或中转 OpenAI 兼容端点）
        model = ChatOpenAI(
            base_url="http://localhost:11434/v1",   # Ollama
            model="qwen2.5",
            api_key="ollama",
        )

        agent = create_react_agent(model, tools)
        result = await agent.ainvoke({
            "messages": [{
                "role": "user",
                "content": "用 current_time 查一下现在几点了，然后用 duration_elapsed "
                           "开始计时一个叫 build 的任务。"
            }]
        })
        print(result["messages"][-1].content)
```

需要：`pip install langchain-mcp-adapters langgraph langchain-openai mcp`

> 注意：`pyproject.toml` 里 `[project.scripts]` 提供了 `time-agent-mcp` 命令，
> 也可以 `command="time-agent-mcp"`，省去 `cwd`。

## TypeScript / LangChain.js

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { mcpTool } from "@langchain/mcp-adapters";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/server.js"],
});

const client = new Client({ name: "langchain-demo", version: "0.1.0" });
await client.connect(transport);

const tools = [];
for (const t of (await client.listTools()).tools) {
  tools.push(await mcpTool(client, { name: t.name, transport }));
}

const agent = createReactAgent({
  llm: new ChatOpenAI({
    model: "qwen2.5",
    configuration: { baseURL: "http://localhost:11434/v1" },
    apiKey: "ollama",
  }),
  tools,
});
```

## 推荐 Agent 用法

1. **会话开头**：调用 `session_ping` / `current_time`，让模型建立时间基线。
2. **长任务中**：穿插 `duration_elapsed`，模型能主动汇报「已跑 42 分」，超时会预警。
3. **截止类任务**：`time_until` 让模型在临期提醒。