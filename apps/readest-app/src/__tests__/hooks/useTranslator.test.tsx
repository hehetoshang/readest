import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Dependency mocks (must be set up before importing the hook) ---

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ token: null }),
}));

const mockSettings = {
  settings: {
    aiSettings: {
      enabled: true,
      provider: 'ai-gateway' as const,
      aiGatewayApiKey: 'test-key',
      aiGatewayModel: 'gpt-4o-mini',
      spoilerProtection: false,
      maxContextChunks: 4,
      indexingMode: 'on-demand' as const,
    },
  },
};

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => mockSettings,
}));

const mockModel = { id: 'test-model' };

vi.mock('@/services/ai/providers', () => ({
  getAIProvider: () => ({ getModel: () => mockModel }),
}));

const mockStreamText = vi.fn();

vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
}));

// jsdom has no IndexedDB; use a trivial in-memory cache so the cache layer
// doesn't spam "IndexedDB not supported" and keep tests hermetic.
vi.mock('@/services/translators/cache', () => {
  const memory = new Map<string, string>();
  return {
    getFromCache: vi.fn(
      async (text: string, source: string, target: string, provider: string) =>
        memory.get(`${provider}:${source}:${target}:${text}`) ?? null,
    ),
    storeInCache: vi.fn(
      async (
        text: string,
        translation: string,
        source: string,
        target: string,
        provider: string,
      ) => {
        memory.set(`${provider}:${source}:${target}:${text}`, translation);
      },
    ),
    clearCache: vi.fn(async () => {
      memory.clear();
      return 0;
    }),
  };
});

import { useTranslator } from '@/hooks/useTranslator';
import { clearCache } from '@/services/translators/cache';
import type { UseTranslatorOptions } from '@/services/translators';

const asyncIterableFromChunks = (chunks: string[]) => {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: async () => {
          if (i < chunks.length) return { done: false, value: chunks[i++]! };
          return { done: true, value: undefined };
        },
      };
    },
  };
};

describe('useTranslator', () => {
  beforeEach(() => {
    mockStreamText.mockReset();
  });

  afterEach(async () => {
    cleanup();
    vi.clearAllMocks();
    await clearCache();
  });

  it('translates via the AI provider when provider is "ai"', async () => {
    mockStreamText.mockImplementation(() => ({
      textStream: asyncIterableFromChunks(['你好']),
    }));

    const { result } = renderHook(() =>
      useTranslator({ provider: 'ai', targetLang: 'zh' } as unknown as UseTranslatorOptions),
    );

    let translated: string[] | undefined;
    await act(async () => {
      translated = await result.current.translate(['hello']);
    });

    expect(translated?.[0]).toBe('你好');
    expect(mockStreamText).toHaveBeenCalledTimes(1);
    const args = mockStreamText.mock.calls[0]![0] as { system: string; model: unknown };
    expect(args.system).toContain('翻译成');
    expect(args.model).toBe(mockModel);
  });

  it('routes provider "ai" through the AI stream and returns the answer stripped of <think> blocks', async () => {
    mockStreamText.mockImplementation(() => ({
      textStream: asyncIterableFromChunks(['<think>思考</think>Hallo']),
    }));

    const { result } = renderHook(() =>
      useTranslator({ provider: 'ai', targetLang: 'zh' } as unknown as UseTranslatorOptions),
    );

    let translated: string[] | undefined;
    await act(async () => {
      translated = await result.current.translate(['hello']);
    });

    expect(translated?.[0]).toBe('Hallo');
  });

  it('falls back to the first available third-party translator when AI is disabled', async () => {
    mockSettings.settings.aiSettings.enabled = false;

    // The first available translator is azure (deepl is removed and yandex is
    // disabled). Mock the Edge translatetext endpoint so the fallback path
    // produces a real translation.
    const mockFetch = vi.fn((url: string) => {
      if (url.includes('edge.microsoft.com/translate/translatetext')) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ translations: [{ text: '你好' }] }],
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => [['你好', 'hello', null, null, 10]],
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() =>
      useTranslator({ provider: 'ai', targetLang: 'zh' } as unknown as UseTranslatorOptions),
    );

    let translated: string[] | undefined;
    await act(async () => {
      translated = await result.current.translate(['hello']);
    });

    // With AI disabled, useTranslator falls back to the first available
    // third-party translator instead of throwing, so a real fetch happens.
    expect(translated?.[0]).toBe('你好');
    expect(mockFetch).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
