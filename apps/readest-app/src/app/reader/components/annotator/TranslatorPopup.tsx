import React, { useEffect, useState } from 'react';
import { streamText } from 'ai';
import Popup from '@/components/Popup';
import { Position } from '@/utils/sel';
import { useAuth } from '@/context/AuthContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useTranslator } from '@/hooks/useTranslator';
import { TRANSLATOR_LANGS } from '@/services/constants';
import {
  UseTranslatorOptions,
  getTranslatorDisplayLabel,
  getTranslators,
  isTranslatorAvailable,
} from '@/services/translators';
import { getAIProvider } from '@/services/ai/providers';
import { AI_PROVIDER_ID, isAIAskEnabled, parseAIAnswer } from '@/services/ai/aiAsk';
import Select from '@/components/Select';

const notSupportedLangs = [''];

const generateTranslatorLangs = () => {
  return Object.fromEntries(
    Object.entries(TRANSLATOR_LANGS).filter(([code]) => !notSupportedLangs.includes(code)),
  );
};

const translatorLangs = generateTranslatorLangs();

interface TranslatorPopupProps {
  text: string;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  onDismiss?: () => void;
}

interface TranslatorType {
  name: string;
  label: string;
  disabled: boolean;
}

const TranslatorPopup: React.FC<TranslatorPopupProps> = ({
  text,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  onDismiss,
}) => {
  const _ = useTranslation();
  const { token } = useAuth();
  const { settings, setSettings } = useSettingsStore();
  const [providers, setProviders] = useState<TranslatorType[]>([]);
  const [sourceLang, setSourceLang] = useState('AUTO');
  const [targetLang, setTargetLang] = useState(settings.globalReadSettings.translateTargetLang);
  const [provider, setProvider] = useState(settings.globalReadSettings.translationProvider);
  const [translation, setTranslation] = useState<string | null>(null);
  const [aiThinking, setAiThinking] = useState('');
  const [detectedSourceLang, setDetectedSourceLang] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { translate, translators } = useTranslator({
    // AI 翻译不经过第三方翻译 API，useTranslator 只用它的 providers 列表和
    // 非 AI 分支；传 undefined 让 useTranslator 保持默认 provider，避免
    // provider='ai' 时它内部 fallback 导致 translate 引用变化、重复触发请求。
    provider: provider === AI_PROVIDER_ID ? undefined : provider,
    sourceLang,
    targetLang,
  } as UseTranslatorOptions);

  const handleSourceLangChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSourceLang(event.target.value);
  };

  const handleTargetLangChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    settings.globalReadSettings.translateTargetLang = event.target.value;
    setSettings(settings);
    setTargetLang(event.target.value);
  };

  const handleProviderChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const requestedProvider = event.target.value;
    settings.globalReadSettings.translationProvider = requestedProvider;
    setSettings(settings);
    setProvider(requestedProvider);
    if (requestedProvider === AI_PROVIDER_ID) return;
    const availableTranslators = getTranslators().filter((t) => isTranslatorAvailable(t, !!token));
    const selectedTranslator =
      availableTranslators.find((t) => t.name === requestedProvider) || availableTranslators[0]!;
    if (selectedTranslator) {
      settings.globalReadSettings.translationProvider = selectedTranslator.name;
      setSettings(settings);
      setProvider(selectedTranslator.name);
    }
  };

  useEffect(() => {
    const availableProviders = translators.map((t) => ({
      name: t.name,
      label: getTranslatorDisplayLabel(t, !!token, _),
      disabled: !!t.disabled,
    }));
    const aiEnabled = isAIAskEnabled(settings.aiSettings);
    setProviders([
      ...availableProviders,
      { name: AI_PROVIDER_ID, label: _('AI 翻译'), disabled: !aiEnabled },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translators, settings.aiSettings]);

  useEffect(() => {
    setLoading(true);
    const fetchTranslation = async () => {
      setError(null);
      setTranslation(null);
      setAiThinking('');

      try {
        const input = text.replaceAll('\n', '').trim();

        // AI 翻译：走用户配置的 AI 服务，而不是第三方翻译 API。
        if (provider === AI_PROVIDER_ID) {
          const aiSettings = settings.aiSettings;
          if (!isAIAskEnabled(aiSettings)) {
            throw new Error('AI not configured');
          }
          const targetLangName = translatorLangs[targetLang] || targetLang || '中文';
          const aiProvider = getAIProvider(aiSettings);
          const result = streamText({
            model: aiProvider.getModel(),
            system: `请将以下文字翻译成${targetLangName}，只输出译文，不要附加任何说明、解释或引号：`,
            messages: [{ role: 'user', content: input }],
          });
          let acc = '';
          for await (const chunk of result.textStream) {
            acc += chunk;
            // 分离 <think>…</think> 思考过程，只把译文写入翻译区。
            const { thinking, answer } = parseAIAnswer(acc);
            setAiThinking(thinking.join('\n'));
            setTranslation(answer);
          }
          return;
        }

        const result = await translate([input]);
        const translatedText = result[0];
        const detectedSource = null;

        if (!translatedText) {
          throw new Error('No translation found');
        }

        setTranslation(translatedText);
        if (sourceLang === 'AUTO' && detectedSource) {
          setDetectedSourceLang(detectedSource);
        }
      } catch (err) {
        console.error(err);
        if (!token) {
          setError(_('Unable to fetch the translation. Please log in first and try again.'));
        } else {
          setError(_('Unable to fetch the translation. Try again later.'));
        }
      } finally {
        setLoading(false);
      }
    };

    fetchTranslation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, token, sourceLang, targetLang, provider, translate]);

  return (
    <div>
      <Popup
        trianglePosition={trianglePosition}
        width={popupWidth}
        minHeight={popupHeight}
        maxHeight={720}
        position={position}
        className='grid h-full select-text grid-rows-[1fr,auto,1fr,auto]'
        onDismiss={onDismiss}
      >
        <div className='overflow-y-auto p-4 font-sans'>
          <div className='mb-2 flex items-center justify-between'>
            <h1 className='text-sm font-medium'>{_('Original Text')}</h1>
            <Select
              value={sourceLang}
              onChange={handleSourceLangChange}
              options={[
                { value: 'AUTO', label: _('Auto Detect') },
                ...Object.entries(translatorLangs)
                  .sort((a, b) => a[1].localeCompare(b[1]))
                  .map(([code, name]) => {
                    const label =
                      detectedSourceLang && sourceLang === 'AUTO' && code === 'AUTO'
                        ? `${translatorLangs[detectedSourceLang] || detectedSourceLang} ` +
                          _('(detected)')
                        : name;
                    return { value: code, label };
                  }),
              ]}
            />
          </div>
          <p className='text-base'>{text}</p>
        </div>

        <div className='mx-4 flex-shrink-0 border-t border-base-content/20'></div>

        <div className='overflow-y-auto p-4 font-sans'>
          <div className='mb-2 flex items-center justify-between'>
            <h2 className='text-sm font-medium'>{_('Translated Text')}</h2>
            <Select
              value={targetLang}
              onChange={handleTargetLangChange}
              options={[
                { value: '', label: _('System Language') },
                ...Object.entries(translatorLangs)
                  .sort((a, b) => a[1].localeCompare(b[1]))
                  .map(([code, name]) => ({ value: code, label: name })),
              ]}
            />
          </div>
          {aiThinking && (
            <details className='mb-2 rounded-md bg-white/5 p-2'>
              <summary className='cursor-pointer select-none text-xs opacity-70'>
                {_('思考过程')}
              </summary>
              <pre className='mt-1 whitespace-pre-wrap text-xs leading-relaxed opacity-70'>
                {aiThinking}
              </pre>
            </details>
          )}
          {loading ? (
            <p className='text-base-content/80 italic'>{_('Loading...')}</p>
          ) : (
            <div>
              {error ? (
                <p className='text-base text-red-600'>{error}</p>
              ) : (
                <p className='text-base'>{translation || _('No translation available.')}</p>
              )}
            </div>
          )}
        </div>
        {/* No top border or tinted fill: the footer reads as part of the popup
            surface, so its provider select can sit flush on the same color. */}
        <div className='flex shrink-0 items-center justify-between gap-2 rounded-b-lg px-4 py-2'>
          <div className='line-clamp-1 min-w-0 text-xs text-base-content/60'>
            {provider &&
              !loading &&
              !error &&
              _('Translated by {{provider}}.', {
                provider: providers.find((p) => p.name === provider)?.label,
              })}
          </div>
          {/* 覆盖 Select 的 max-w-[60%] 上限：翻译服务下拉按内容动态伸缩，不固定宽度 */}
          <Select
            className='!max-w-full shrink-0'
            value={provider}
            onChange={handleProviderChange}
            options={providers.map(({ name: value, label, disabled }) => ({
              value,
              label,
              disabled,
            }))}
          />
        </div>
      </Popup>
    </div>
  );
};

export default TranslatorPopup;
