import { useState, useCallback, useEffect } from 'react';
import { streamText } from 'ai';
import { useAuth } from '@/context/AuthContext';
import {
  ErrorCodes,
  getTranslator,
  getTranslators,
  isTranslatorAvailable,
  TranslationProvider,
  TranslatorName,
} from '@/services/translators';
import { getFromCache, storeInCache, UseTranslatorOptions } from '@/services/translators';
import { polish, preprocess } from '@/services/translators';
import { eventDispatcher } from '@/utils/event';
import { getLocale } from '@/utils/misc';
import { useTranslation } from './useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { AI_PROVIDER_ID, isAIAskEnabled, parseAIAnswer } from '@/services/ai/aiAsk';
import { getAIProvider } from '@/services/ai/providers';
import { TRANSLATOR_LANGS } from '@/services/constants';

export function useTranslator({
  // DeepL 需要登录/订阅，已从可用服务中移除；默认回退到免鉴权的 Azure。
  provider = 'azure',
  sourceLang = 'AUTO',
  targetLang = 'EN',
  enablePolishing = true,
  enablePreprocessing = true,
}: UseTranslatorOptions = {}) {
  const _ = useTranslation();
  const { token } = useAuth();
  const { settings } = useSettingsStore();
  const [loading, setLoading] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>(provider);
  const [translator, setTransltor] = useState<TranslationProvider | undefined>(() =>
    provider === AI_PROVIDER_ID ? undefined : getTranslator(provider),
  );
  const [translators] = useState(() => getTranslators());

  useEffect(() => {
    setLoading(false);
  }, [provider, sourceLang, targetLang]);

  useEffect(() => {
    // The AI provider isn't a `TranslationProvider`; keep it as the selected
    // provider so the translate path below can route to `translateWithAI`.
    if (provider === AI_PROVIDER_ID) {
      setTransltor(undefined);
      setSelectedProvider(AI_PROVIDER_ID);
      return;
    }
    const availableTranslators = getTranslators().filter((t) => isTranslatorAvailable(t, !!token));
    const selectedTranslator =
      availableTranslators.find((t) => t.name === provider) || availableTranslators[0]!;
    const selectedProviderName = selectedTranslator.name as TranslatorName;
    setTransltor(getTranslator(selectedProviderName));
    setSelectedProvider(selectedProviderName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  /**
   * AI translation path: streams each text through the user-configured AI
   * service (same channel as the selection TranslatorPopup), returning one
   * translation per input. Mirrors TranslatorPopup's AI branch but collects
   * the full answer instead of rendering progressively.
   */
  const translateWithAI = useCallback(
    async (texts: string[], targetLanguage: string): Promise<string[]> => {
      const aiSettings = settings?.aiSettings;
      if (!isAIAskEnabled(aiSettings)) {
        throw new Error('AI not configured');
      }
      const targetLangName = TRANSLATOR_LANGS[targetLanguage] || targetLanguage || '中文';
      const aiProvider = getAIProvider(aiSettings!);
      const system = `请将以下文字翻译成${targetLangName}，只输出译文，不要附加任何说明、解释或引号：`;
      return Promise.all(
        texts.map(async (text) => {
          const result = streamText({
            model: aiProvider.getModel(),
            system,
            messages: [{ role: 'user', content: text }],
          });
          let acc = '';
          for await (const chunk of result.textStream) {
            acc += chunk;
          }
          const { answer } = parseAIAnswer(acc);
          return answer;
        }),
      );
    },
    [settings],
  );

  const translate = useCallback(
    async (
      input: string[],
      options?: { source?: string; target?: string; useCache?: boolean },
    ): Promise<string[]> => {
      const sourceLanguage = options?.source || sourceLang;
      const targetLanguage = options?.target || targetLang || getLocale();
      const useCache = options?.useCache ?? false;
      const textsToTranslate = enablePreprocessing ? preprocess(input) : input;

      if (textsToTranslate.length === 0 || textsToTranslate.every((t) => !t?.trim())) {
        return textsToTranslate;
      }

      const textsNeedingTranslation: string[] = [];
      const indicesNeedingTranslation: number[] = [];

      await Promise.all(
        textsToTranslate.map(async (text, index) => {
          if (!text?.trim()) return;

          const cachedTranslation = await getFromCache(
            text,
            sourceLanguage,
            targetLanguage,
            selectedProvider,
          );
          if (cachedTranslation) return;

          textsNeedingTranslation.push(text);
          indicesNeedingTranslation.push(index);
        }),
      );

      if (textsNeedingTranslation.length === 0) {
        const results = await Promise.all(
          textsToTranslate.map((text) =>
            getFromCache(text, sourceLanguage, targetLanguage, selectedProvider).then(
              (cached) => cached || text,
            ),
          ),
        );

        return enablePolishing ? polish(results, targetLanguage) : results;
      }

      setLoading(true);

      try {
        let translatedTexts: string[];
        if (selectedProvider === AI_PROVIDER_ID) {
          if (isAIAskEnabled(settings?.aiSettings)) {
            translatedTexts = await translateWithAI(textsNeedingTranslation, targetLanguage);
          } else {
            // AI 未配置/不可用：回退到第一个可用第三方翻译，保证即时翻译仍有输出
            // （与 deepl 无 token 时自动回退到 azure/google 的行为一致）。
            const fallbackTranslator = translators.find((t) => isTranslatorAvailable(t, !!token));
            if (!fallbackTranslator) {
              throw new Error('AI not configured');
            }
            translatedTexts = await fallbackTranslator.translate(
              textsNeedingTranslation,
              sourceLanguage,
              targetLanguage,
              token,
              useCache,
            );
          }
        } else {
          const translator = translators.find((t) => t.name === selectedProvider);
          if (!translator) {
            throw new Error(`No translator found for provider: ${selectedProvider}`);
          }
          translatedTexts = await translator.translate(
            textsNeedingTranslation,
            sourceLanguage,
            targetLanguage,
            token,
            useCache,
          );
        }

        await Promise.all(
          textsNeedingTranslation.map(async (text, index) => {
            return storeInCache(
              text,
              translatedTexts[index] || '',
              sourceLanguage,
              targetLanguage,
              selectedProvider,
            );
          }),
        );

        const results = [...textsToTranslate];
        indicesNeedingTranslation.forEach((originalIndex, translationIndex) => {
          results[originalIndex] = translatedTexts[translationIndex] || '';
        });

        await Promise.all(
          results.map(async (_, index) => {
            if (!indicesNeedingTranslation.includes(index)) {
              const originalText = textsToTranslate[index];
              if (!originalText?.trim()) return;

              const cachedTranslation = await getFromCache(
                originalText,
                sourceLanguage,
                targetLanguage,
                selectedProvider,
              );

              if (cachedTranslation) {
                results[index] = cachedTranslation;
              }
            }
          }),
        );

        setLoading(false);
        return enablePolishing ? polish(results, targetLanguage) : results;
      } catch (err) {
        if (err instanceof Error && err.message.includes(ErrorCodes.DAILY_QUOTA_EXCEEDED)) {
          eventDispatcher.dispatch('toast', {
            timeout: 5000,
            message: _(
              'Daily translation quota reached. Upgrade your plan to continue using AI translations.',
            ),
            type: 'error',
          });
          setSelectedProvider('azure');
        }
        setLoading(false);
        throw err instanceof Error ? err : new Error(String(err));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedProvider, sourceLang, targetLang, translator, token, translateWithAI],
  );

  return {
    translate,
    translator,
    translators,
    loading,
  };
}
