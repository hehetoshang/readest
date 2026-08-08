import { APICallError } from 'ai';

const RESPONSE_BODY_MAX = 300;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * 把 AI 调用错误转成可诊断的中文描述。
 *
 * Vercel AI SDK 的 `APICallError`（name === 'AI_APICallError'）是网络/响应层
 * 错误，携带 statusCode、url、responseBody 等字段——例如这次报告的
 * "Invalid JSON response"（端点返回了无法按 OpenAI 响应 schema 解析的 2xx body）。
 * 裸 `Error` 只保留 message；未知输入给默认文案。
 */
export function describeAIError(error: unknown, context?: string): string {
  const prefix = context ? `${context}: ` : '';

  if (APICallError.isInstance(error)) {
    const status = error.statusCode != null ? `HTTP ${error.statusCode}` : 'HTTP 未知状态';
    const url = error.url ? ` ${error.url}` : '';
    const body = error.responseBody
      ? ` 原始响应: ${truncate(String(error.responseBody), RESPONSE_BODY_MAX)}`
      : '';
    const detail = error.message ? ` ${error.message}` : '';
    return `${prefix}AI 调用失败 (${status}${url})${detail}${body}`;
  }

  if (error instanceof Error && error.message) {
    return `${prefix}${error.message}`;
  }

  return `${prefix}未知错误`;
}
