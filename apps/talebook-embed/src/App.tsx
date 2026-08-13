import { useCallback, useEffect, useRef, useState } from 'react';
import { TALEBOOK_EMBED_CAPABILITIES } from './capabilities';
import { EpubResourceError, openEpub } from './epub';
import { ReaderHostError, TalebookHostAdapter, type ReaderBootstrap } from './host';
import { hashForPosition, loadPosition, positionFromHash, savePosition } from './position';
import { ReaderView, type RelocateDetail, type SearchResult, type TocItem } from './ReaderView';
import { loadReaderSettings, saveReaderSettings, type ReaderSettings } from './settings';

type Panel = 'toc' | 'search' | 'settings' | null;

const COPY = {
  en: {
    back: 'Back to book',
    candle: 'Open with Candle',
    retry: 'Retry',
    previous: 'Previous page',
    next: 'Next page',
    toc: 'Contents',
    search: 'Search',
    settings: 'Settings',
    close: 'Close panel',
    loading: 'Loading book…',
    searching: 'Searching…',
    noResults: 'No matches found.',
    query: 'Search book text',
    fontSize: 'Font size',
    fontWeight: 'Font weight',
    fontFamily: 'Font family',
    serif: 'Serif',
    sans: 'Sans serif',
    paragraph: 'Paragraph spacing',
    lineHeight: 'Line height',
    margin: 'Page margin',
    columns: 'Columns',
    flow: 'Reading mode',
    paginated: 'Paginated',
    scrolled: 'Scrolled',
    theme: 'Theme',
    light: 'Light',
    sepia: 'Sepia',
    dark: 'Dark',
    language: 'Interface language',
  },
  'zh-CN': {
    back: '返回书籍页',
    candle: '改用 Candle',
    retry: '重试',
    previous: '上一页',
    next: '下一页',
    toc: '目录',
    search: '搜索',
    settings: '设置',
    close: '关闭面板',
    loading: '正在加载书籍…',
    searching: '正在搜索…',
    noResults: '没有找到匹配内容。',
    query: '搜索书中正文',
    fontSize: '字号',
    fontWeight: '字重',
    fontFamily: '字体族',
    serif: '衬线',
    sans: '无衬线',
    paragraph: '段落间距',
    lineHeight: '行距',
    margin: '页边距',
    columns: '栏数',
    flow: '阅读模式',
    paginated: '分页',
    scrolled: '滚动',
    theme: '主题',
    light: '明亮',
    sepia: '纸张',
    dark: '暗色',
    language: '界面语言',
  },
} as const;

const ERROR_COPY: Record<string, Record<ReaderSettings['uiLanguage'], string>> = {
  'login-required': {
    en: 'Please sign in before opening this book.',
    'zh-CN': '请先登录后再打开这本书。',
  },
  'activation-required': {
    en: 'Activate your account before reading online.',
    'zh-CN': '请先激活账号后再在线阅读。',
  },
  'permission-denied': {
    en: 'You no longer have permission to read this book.',
    'zh-CN': '你当前没有这本书的阅读权限。',
  },
  'book-not-found': { en: 'This book no longer exists.', 'zh-CN': '这本书不存在或已被删除。' },
  'format-unsupported': {
    en: 'This book does not have a supported EPUB file.',
    'zh-CN': '这本书暂时没有可用的 EPUB 格式。',
  },
  'conversion-pending': {
    en: 'EPUB conversion is still running. Try again shortly.',
    'zh-CN': 'EPUB 仍在转换中，请稍后重试。',
  },
  'resource-changed': {
    en: 'The EPUB changed while it was loading. Reload the latest copy.',
    'zh-CN': 'EPUB 在加载期间发生变化，请重新加载最新版本。',
  },
  'resource-failed': {
    en: 'The EPUB resource could not be loaded.',
    'zh-CN': 'EPUB 资源加载失败。',
  },
  'bootstrap-unavailable': {
    en: 'Reader configuration could not be loaded.',
    'zh-CN': '无法加载阅读器配置。',
  },
  'invalid-bootstrap': { en: 'The reader configuration is invalid.', 'zh-CN': '阅读器配置无效。' },
  'render-failed': { en: 'The EPUB could not be rendered.', 'zh-CN': 'EPUB 渲染失败。' },
};

const flattenToc = (items: TocItem[], depth = 0): Array<TocItem & { depth: number }> =>
  items.flatMap((item) => [{ ...item, depth }, ...flattenToc(item.subitems ?? [], depth + 1)]);

const excerptText = (result: SearchResult) =>
  `${result.excerpt.pre ?? ''}${result.excerpt.match ?? ''}${result.excerpt.post ?? ''}`;

export function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ReaderView | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [bootstrap, setBootstrap] = useState<ReaderBootstrap | null>(null);
  const [settings, setSettings] = useState(loadReaderSettings);
  const [status, setStatus] = useState<string>('loading');
  const [progress, setProgress] = useState('');
  const [panel, setPanel] = useState<Panel>(null);
  const [toc, setToc] = useState<Array<TocItem & { depth: number }>>([]);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const copy = COPY[settings.uiLanguage];

  useEffect(() => {
    document.documentElement.lang = settings.uiLanguage;
    document.documentElement.dataset.theme = settings.theme;
    saveReaderSettings(settings);
    viewRef.current?.applySettings(settings);
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    let view: ReaderView | null = null;
    const start = async () => {
      setStatus('loading');
      setBootstrap(null);
      setToc([]);
      setResults([]);
      try {
        const host = new TalebookHostAdapter();
        const config = await host.bootstrap();
        if (cancelled) return;
        setBootstrap(config);
        view = new ReaderView();
        viewRef.current = view;
        view.element.className = 'reader-view';
        view.addEventListener('relocate', (event) => {
          const detail = (event as CustomEvent<RelocateDetail>).detail;
          const fraction = Math.round((detail.fraction ?? 0) * 100);
          const section = detail.tocItem?.label;
          setProgress(section ? `${section} · ${fraction}%` : `${fraction}%`);
          if (detail.cfi && TALEBOOK_EMBED_CAPABILITIES.localPosition) {
            savePosition(config.book.id, config.book.revision, detail.cfi);
            history.replaceState(null, '', hashForPosition(detail.cfi));
          }
        });
        mountRef.current?.append(view.element);
        const stored = positionFromHash() ?? loadPosition(config.book.id, config.book.revision);
        await view.open(await openEpub(config.resource.url), settings, stored);
        setToc(flattenToc(view.toc));
        document.title = config.book.title;
        setStatus('');
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ReaderHostError) setStatus(error.code);
        else if (error instanceof EpubResourceError) setStatus(error.code);
        else setStatus('render-failed');
      }
    };
    void start();
    return () => {
      cancelled = true;
      view?.close();
      view?.element.remove();
      viewRef.current = null;
    };
  }, [attempt]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)
        return;
      if (event.key === 'ArrowLeft' && TALEBOOK_EMBED_CAPABILITIES.navigation)
        void viewRef.current?.previous();
      if (event.key === 'ArrowRight' && TALEBOOK_EMBED_CAPABILITIES.navigation)
        void viewRef.current?.next();
      if (event.key === 'Escape') setPanel(null);
      if (event.key === '/' && TALEBOOK_EMBED_CAPABILITIES.textSearch) {
        event.preventDefault();
        setPanel('search');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const search = useCallback(async () => {
    if (!TALEBOOK_EMBED_CAPABILITIES.textSearch || !viewRef.current) return;
    setSearching(true);
    try {
      setResults(await viewRef.current.search(query));
    } finally {
      setSearching(false);
    }
  }, [query]);

  const update = <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));

  return (
    <main className='shell'>
      <header className='toolbar'>
        <a
          className='button back'
          href={
            bootstrap?.navigation.back ??
            `/book/${new URLSearchParams(location.search).get('book') ?? ''}`
          }
        >
          {copy.back}
        </a>
        <div className='book-title'>{bootstrap?.book.title ?? 'Readest'}</div>
        <div className='actions'>
          {TALEBOOK_EMBED_CAPABILITIES.tableOfContents ? (
            <button type='button' onClick={() => setPanel(panel === 'toc' ? null : 'toc')}>
              {copy.toc}
            </button>
          ) : null}
          {TALEBOOK_EMBED_CAPABILITIES.textSearch ? (
            <button type='button' onClick={() => setPanel(panel === 'search' ? null : 'search')}>
              {copy.search}
            </button>
          ) : null}
          {TALEBOOK_EMBED_CAPABILITIES.localSettings ? (
            <button
              type='button'
              onClick={() => setPanel(panel === 'settings' ? null : 'settings')}
            >
              {copy.settings}
            </button>
          ) : null}
          <button
            type='button'
            onClick={() => void viewRef.current?.previous()}
            aria-label={copy.previous}
          >
            ←
          </button>
          <span className='progress'>{progress}</span>
          <button type='button' onClick={() => void viewRef.current?.next()} aria-label={copy.next}>
            →
          </button>
        </div>
      </header>

      {panel ? (
        <aside
          className='panel'
          aria-label={panel === 'toc' ? copy.toc : panel === 'search' ? copy.search : copy.settings}
        >
          <div className='panel-header'>
            <strong>
              {panel === 'toc' ? copy.toc : panel === 'search' ? copy.search : copy.settings}
            </strong>
            <button type='button' onClick={() => setPanel(null)} aria-label={copy.close}>
              ×
            </button>
          </div>
          {panel === 'toc' ? (
            <nav className='toc-list'>
              {toc.map((item, index) =>
                item.href ? (
                  <button
                    type='button'
                    key={`${item.href}-${index}`}
                    style={{ paddingInlineStart: `${0.75 + item.depth * 1.1}rem` }}
                    onClick={() => {
                      void viewRef.current?.goTo(item.href!);
                      setPanel(null);
                    }}
                  >
                    {item.label || item.href}
                  </button>
                ) : null,
              )}
            </nav>
          ) : null}
          {panel === 'search' ? (
            <div className='search-panel'>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void search();
                }}
              >
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={copy.query}
                  autoFocus
                />
                <button type='submit'>{copy.search}</button>
              </form>
              <div aria-live='polite'>
                {searching ? copy.searching : !results.length && query ? copy.noResults : null}
              </div>
              <ol>
                {results.map((result, index) => (
                  <li key={`${result.cfi}-${index}`}>
                    <button
                      type='button'
                      onClick={() => {
                        void viewRef.current?.goTo(result.cfi);
                        setPanel(null);
                      }}
                    >
                      <strong>{result.label}</strong>
                      <span>{excerptText(result)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          {panel === 'settings' ? (
            <div className='settings-grid'>
              <label>
                {copy.fontSize}
                <select
                  value={settings.fontSize}
                  onChange={(e) =>
                    update('fontSize', Number(e.target.value) as ReaderSettings['fontSize'])
                  }
                >
                  {[14, 16, 18, 20, 22, 24].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                {copy.fontWeight}
                <select
                  value={settings.fontWeight}
                  onChange={(e) =>
                    update('fontWeight', Number(e.target.value) as ReaderSettings['fontWeight'])
                  }
                >
                  {[400, 500, 600].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                {copy.fontFamily}
                <select
                  value={settings.fontFamily}
                  onChange={(e) =>
                    update('fontFamily', e.target.value as ReaderSettings['fontFamily'])
                  }
                >
                  <option value='serif'>{copy.serif}</option>
                  <option value='sans-serif'>{copy.sans}</option>
                </select>
              </label>
              <label>
                {copy.paragraph}
                <select
                  value={settings.paragraphSpacing}
                  onChange={(e) =>
                    update(
                      'paragraphSpacing',
                      Number(e.target.value) as ReaderSettings['paragraphSpacing'],
                    )
                  }
                >
                  {[0, 0.5, 0.75, 1, 1.5].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                {copy.lineHeight}
                <select
                  value={settings.lineHeight}
                  onChange={(e) =>
                    update('lineHeight', Number(e.target.value) as ReaderSettings['lineHeight'])
                  }
                >
                  {[1.3, 1.45, 1.6, 1.8, 2].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                {copy.margin}
                <select
                  value={settings.margin}
                  onChange={(e) =>
                    update('margin', Number(e.target.value) as ReaderSettings['margin'])
                  }
                >
                  {[16, 24, 32, 48, 64].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                {copy.columns}
                <select
                  value={settings.columns}
                  onChange={(e) => update('columns', Number(e.target.value) as 1 | 2)}
                >
                  <option value='1'>1</option>
                  <option value='2'>2</option>
                </select>
              </label>
              <label>
                {copy.flow}
                <select
                  value={settings.flow}
                  onChange={(e) => update('flow', e.target.value as ReaderSettings['flow'])}
                >
                  <option value='paginated'>{copy.paginated}</option>
                  <option value='scrolled'>{copy.scrolled}</option>
                </select>
              </label>
              <label>
                {copy.theme}
                <select
                  value={settings.theme}
                  onChange={(e) => update('theme', e.target.value as ReaderSettings['theme'])}
                >
                  <option value='light'>{copy.light}</option>
                  <option value='sepia'>{copy.sepia}</option>
                  <option value='dark'>{copy.dark}</option>
                </select>
              </label>
              <label>
                {copy.language}
                <select
                  value={settings.uiLanguage}
                  onChange={(e) =>
                    update('uiLanguage', e.target.value as ReaderSettings['uiLanguage'])
                  }
                >
                  <option value='en'>English</option>
                  <option value='zh-CN'>简体中文</option>
                </select>
              </label>
            </div>
          ) : null}
        </aside>
      ) : null}

      {status ? (
        <section className='status' role='alert'>
          <p>
            {status === 'loading'
              ? copy.loading
              : (ERROR_COPY[status]?.[settings.uiLanguage] ??
                ERROR_COPY['render-failed'][settings.uiLanguage])}
          </p>
          {status !== 'loading' ? (
            <div className='recovery'>
              <button type='button' onClick={() => setAttempt((value) => value + 1)}>
                {copy.retry}
              </button>
              <a className='button' href={bootstrap?.navigation.back ?? '/'}>
                {copy.back}
              </a>
              <a
                className='button'
                href={
                  bootstrap?.navigation.fallback ??
                  `/read/${new URLSearchParams(location.search).get('book') ?? ''}?reader=candle`
                }
              >
                {copy.candle}
              </a>
            </div>
          ) : null}
        </section>
      ) : null}
      <div ref={mountRef} className='reader-mount' />
      {bootstrap ? (
        <a className='fallback' href={bootstrap.navigation.fallback}>
          {copy.candle}
        </a>
      ) : null}
    </main>
  );
}
