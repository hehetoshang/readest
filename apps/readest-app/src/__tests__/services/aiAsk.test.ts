import { describe, expect, test } from 'vitest';
import {
  AI_ASK_SYSTEM_PROMPT,
  buildAIAskMessages,
  isAIAskEnabled,
  parseAIAnswer,
} from '@/services/ai/aiAsk';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import type { AISettings } from '@/services/ai/types';

const base = (overrides: Partial<AISettings>): AISettings => ({
  ...DEFAULT_AI_SETTINGS,
  ...overrides,
});

describe('aiAsk helpers', () => {
  test('AI_ASK_SYSTEM_PROMPT is a non-empty Chinese instruction', () => {
    expect(AI_ASK_SYSTEM_PROMPT).toBeTypeOf('string');
    expect(AI_ASK_SYSTEM_PROMPT.length).toBeGreaterThan(20);
  });

  test('buildAIAskMessages without a question asks the model to explain the text', () => {
    const msg = buildAIAskMessages('hello world')[0]!;
    expect(msg.role).toBe('user');
    expect(msg.content).toContain('hello world');
  });

  test('buildAIAskMessages with a question includes both the text and the question', () => {
    const msg = buildAIAskMessages('hello world', '这是什么语言？')[0]!;
    expect(msg.role).toBe('user');
    expect(msg.content).toContain('hello world');
    expect(msg.content).toContain('这是什么语言？');
  });

  test('buildAIAskMessages trims a blank question to the default explain request', () => {
    const msg = buildAIAskMessages('hello world', '   ')[0]!;
    expect(msg.content).not.toContain('用户的问题');
    expect(msg.content).toContain('hello world');
  });

  test('isAIAskEnabled returns false when undefined or disabled', () => {
    expect(isAIAskEnabled(undefined)).toBe(false);
    expect(isAIAskEnabled(base({ enabled: false }))).toBe(false);
  });

  test('isAIAskEnabled allows ollama without a key', () => {
    expect(isAIAskEnabled(base({ enabled: true, provider: 'ollama' }))).toBe(true);
  });

  test('isAIAskEnabled requires an api key for openrouter', () => {
    expect(
      isAIAskEnabled(base({ enabled: true, provider: 'openrouter', openrouterApiKey: '' })),
    ).toBe(false);
    expect(
      isAIAskEnabled(base({ enabled: true, provider: 'openrouter', openrouterApiKey: 'sk-123' })),
    ).toBe(true);
  });

  test('isAIAskEnabled requires an api key for ai-gateway', () => {
    expect(
      isAIAskEnabled(base({ enabled: true, provider: 'ai-gateway', aiGatewayApiKey: '' })),
    ).toBe(false);
    expect(
      isAIAskEnabled(base({ enabled: true, provider: 'ai-gateway', aiGatewayApiKey: 'x' })),
    ).toBe(true);
  });

  test('parseAIAnswer passes through plain answers untouched', () => {
    expect(parseAIAnswer('你好，世界。')).toEqual({ thinking: [], answer: '你好，世界。' });
  });

  test('parseAIAnswer separates a closed think block from the answer', () => {
    expect(parseAIAnswer('<think>让我想想</think>最终答案是 42。')).toEqual({
      thinking: ['让我想想'],
      answer: '最终答案是 42。',
    });
  });

  test('parseAIAnswer handles multiple think blocks', () => {
    expect(parseAIAnswer('<think>第一段</think>正文<think>第二段</think>')).toEqual({
      thinking: ['第一段', '第二段'],
      answer: '正文',
    });
  });

  test('parseAIAnswer captures an unterminated think block (streaming mid-cut)', () => {
    expect(parseAIAnswer('<think>还在思考中')).toEqual({
      thinking: ['还在思考中'],
      answer: '',
    });
  });
});
