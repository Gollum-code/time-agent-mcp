/**
 * MCP 工具返回结果构造。
 *
 * 每个结果同时提供：
 *  - content:           文本 JSON 字符串（旧客户端/调试场景）
 *  - structuredContent: 结构化对象（MCP 原生，模型可直接消费，避免 JSON-in-JSON）
 */

export interface ToolOk {
  content: [{ type: "text"; text: string }];
  structuredContent: Record<string, unknown>;
  [k: string]: unknown;
}

export interface ToolErr {
  content: [{ type: "text"; text: string }];
  isError: true;
  structuredContent?: Record<string, unknown>;
  [k: string]: unknown;
}

export function ok(data: Record<string, unknown>): ToolOk {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

export function err(message: string): ToolErr {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }, null, 2) }],
    isError: true,
    structuredContent: { ok: false, error: message },
  };
}