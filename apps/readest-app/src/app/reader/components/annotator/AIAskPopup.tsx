import React, { useEffect, useRef, useState } from 'react';
import { streamText } from 'ai';
import Popup from '@/components/Popup';
import { Position } from '@/utils/sel';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { getAIProvider } from '@/services/ai/providers';
import {
  AI_ASK_SYSTEM_PROMPT,
  buildAIAskMessages,
  isAIAskEnabled,
  parseAIAnswer,
} from '@/services/ai/aiAsk';

interface AIAskPopupProps {
  text: string;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  onDismiss: () => void;
}

/**
 * 「AI 提问」弹窗（Issue #16）：选中文字后让用户输入问题，再调用配置的 AI 服务
 * 流式回答。配置复用 readest 设置 → AI 面板（`settings.aiSettings` + `getAIProvider`）。
 * 用户可以不输入问题直接提问——默认让 AI 结合上下文解释选中文字。
 */
const AIAskPopup: React.FC<AIAskPopupProps> = ({
  text,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  onDismiss,
}) => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const aiSettings = settings.aiSettings;
  const enabled = isAIAskEnabled(aiSettings);

  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState(false);
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!asked || !enabled) return;
    setAnswer('');
    setError(null);
    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    let cancelled = false;

    (async () => {
      try {
        const provider = getAIProvider(aiSettings!);
        const result = streamText({
          model: provider.getModel(),
          system: AI_ASK_SYSTEM_PROMPT,
          messages: buildAIAskMessages(text, question),
          abortSignal: controller.signal,
        });
        let acc = '';
        for await (const chunk of result.textStream) {
          if (cancelled) break;
          acc += chunk;
          setAnswer(acc);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message || _('AI 请求失败，请稍后重试。'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, enabled, text, question]);

  const handleAsk = () => {
    if (!enabled || loading) return;
    setAsked(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  };

  const handleCopy = async () => {
    if (!answer) return;
    try {
      await navigator.clipboard.writeText(answer);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard 不可用时静默失败
    }
  };

  const inputClassName =
    'not-eink:bg-white/10 not-eink:text-white eink:bg-base-100 eink:text-base-content ' +
    'w-full rounded-md border border-gray-500/40 px-3 py-2 text-sm outline-none ' +
    'placeholder:text-gray-400 focus:border-gray-400';

  return (
    <Popup
      trianglePosition={trianglePosition}
      width={popupWidth}
      minHeight={popupHeight}
      maxHeight={720}
      position={position}
      className='not-eink:text-white grid h-full select-text grid-rows-[1fr,auto] bg-gray-600'
      triangleClassName='text-gray-600'
      onDismiss={onDismiss}
    >
      {!enabled ? (
        <div className='p-4 font-sans'>
          <h1 className='text-sm font-normal'>{_('AI 提问')}</h1>
          <p className='mt-2 text-sm text-amber-300'>
            {_('请先在 设置 → AI 中启用并配置 AI 服务，再使用「AI 提问」。')}
          </p>
        </div>
      ) : !asked ? (
        <div className='overflow-y-auto p-4 font-sans'>
          <h1 className='text-sm font-normal'>{_('AI 提问')}</h1>
          <p className='not-eink:text-white/80 mt-2 line-clamp-2 text-sm leading-relaxed'>{text}</p>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={_('输入你的问题（可选），或留空让 AI 解释这段文字')}
            rows={3}
            className={`mt-3 ${inputClassName}`}
          />
          <button
            type='button'
            onClick={handleAsk}
            className='mt-3 h-9 w-full rounded-md bg-gray-500 text-sm font-medium transition-colors hover:bg-gray-400 not-eink:text-white'
          >
            {_('提问')}
          </button>
        </div>
      ) : (
        <div className='overflow-y-auto px-4 pb-10 pt-4 font-sans'>
          <div className='mb-2 flex items-center justify-between'>
            <h2 className='text-sm font-normal'>{_('AI 回答')}</h2>
          </div>
          {loading && !answer ? (
            <p className='flex items-center gap-2 text-sm italic text-gray-400'>
              <span className='inline-block h-3 w-3 animate-spin rounded-full border border-gray-400 border-t-transparent' />
              {_('AI 思考中…')}
            </p>
          ) : error ? (
            <p className='text-sm text-red-400'>{error}</p>
          ) : (
            (() => {
              const { thinking, answer: cleanAnswer } = parseAIAnswer(answer);
              return (
                <div>
                  {thinking.length > 0 && (
                    <details className='mb-2 rounded-md bg-white/5 p-2'>
                      <summary className='cursor-pointer select-none text-xs opacity-70'>
                        {_('思考过程')}
                      </summary>
                      <pre className='mt-1 whitespace-pre-wrap text-xs leading-relaxed opacity-70'>
                        {thinking.join('\n')}
                      </pre>
                    </details>
                  )}
                  <p className='not-eink:text-white/90 whitespace-pre-wrap text-sm leading-relaxed'>
                    {cleanAnswer}
                  </p>
                </div>
              );
            })()
          )}
        </div>
      )}

      {answer && (
        <div className='absolute bottom-0 flex h-9 w-full items-center justify-between px-4'>
          <span className='line-clamp-1 text-xs opacity-60'>
            {aiSettings?.provider === 'ollama' ? 'Ollama' : 'AI'}
          </span>
          <button
            type='button'
            onClick={() => void handleCopy()}
            className='rounded bg-white/10 px-2 py-1 text-xs transition-colors hover:bg-white/20'
          >
            {copied ? _('已复制') : _('复制回答')}
          </button>
        </div>
      )}
    </Popup>
  );
};

export default AIAskPopup;
