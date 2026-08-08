import type { AISettings } from './types';

/** 翻译弹窗/设置里的「AI 翻译」来源 id：走用户配置的 AI 服务，而非第三方翻译 API。 */
export const AI_PROVIDER_ID = 'ai';

/**
 * 「AI 提问」功能（Issue #16）的纯逻辑助手。
 *
 * 选中词句后向用户配置的 AI 服务提问：本文件只负责系统提示词、用户消息构造
 * 与「是否已配置可用」的判断，与 DOM / 渲染无关，便于 Node 单测。实际的流式
 * 请求由 `AIAskPopup` 通过 `getAIProvider` + Vercel AI SDK `streamText` 完成。
 */

/** 系统提示词：要求模型结合上下文、用中文简洁解释选中的文字。 */
export const AI_ASK_SYSTEM_PROMPT = `你是一位阅读助手。请用简洁的中文解释用户选中的文字：
- 如果是生词或短语，给出释义和例句；
- 如果是句子或段落，解释其含义、背景或表达手法；
- 尽量结合上下文理解，控制在 200 字以内，不要泛泛而谈。`;

/**
 * 构造「AI 提问」的用户消息：附带选中的文字，并支持用户自定义问题。
 * - 有 question 时：把选中文字和用户的问题一起发给模型；
 * - 无 question 时：默认让模型结合上下文解释选中文字。
 */
export function buildAIAskMessages(
  text: string,
  question?: string,
): Array<{ role: 'user'; content: string }> {
  const q = question?.trim();
  const content = q
    ? `用户选中了以下文字：\n「${text}」\n\n用户的问题：\n${q}`
    : `请结合上下文解释以下选中的文字，用中文简洁回答：\n「${text}」`;
  return [{ role: 'user', content }];
}

/**
 * 判断 AI 提问是否可用：已启用，且当前 provider 的必要密钥已配置。
 * - ollama（本地）不需要密钥；
 * - ai-gateway / openrouter 需要对应 API key。
 */
export function isAIAskEnabled(aiSettings?: AISettings): boolean {
  if (!aiSettings?.enabled) return false;
  switch (aiSettings.provider) {
    case 'ollama':
      return true;
    case 'ai-gateway':
      return !!aiSettings.aiGatewayApiKey;
    case 'openrouter':
      return !!aiSettings.openrouterApiKey;
    default:
      return false;
  }
}

/** 解析 AI 回答：把 `<think>…</think>` 思考块与正式回答分开。 */
export interface ParsedAIAnswer {
  /** 思考过程块（可能因流式中断而不完整）。 */
  thinking: string[];
  /** 正式回答（不含 think 块）。 */
  answer: string;
}

export function parseAIAnswer(text: string): ParsedAIAnswer {
  const thinking: string[] = [];
  let answer = text;
  const closedRe = /<think>([\s\S]*?)<\/think>/g;
  let match: RegExpExecArray | null;
  while ((match = closedRe.exec(text)) !== null) {
    thinking.push(match[1] ?? '');
    answer = answer.replace(match[0], '');
  }
  // 流式输出中 `<think>` 可能尚未闭合：把尾部未闭合的思考内容也归入 thinking。
  const openIdx = answer.lastIndexOf('<think>');
  if (openIdx !== -1) {
    thinking.push(answer.slice(openIdx + '<think>'.length));
    answer = answer.slice(0, openIdx);
  }
  return { thinking, answer };
}
