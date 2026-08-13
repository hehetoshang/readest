import { useEffect, useRef, useState } from 'react';
import { TalebookHostAdapter, type ReaderBootstrap } from './host';
import { openEpub } from './epub';
import { ReaderView } from './ReaderView';

type RelocateDetail = { fraction?: number; tocItem?: { label?: string } };

export function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ReaderView | null>(null);
  const [bootstrap, setBootstrap] = useState<ReaderBootstrap | null>(null);
  const [status, setStatus] = useState('Loading book…');
  const [progress, setProgress] = useState('');

  useEffect(() => {
    let cancelled = false;
    let view: ReaderView | null = null;
    const start = async () => {
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
        });
        mountRef.current?.append(view.element);
        await view.open(await openEpub(config.resource.url));
        document.title = config.book.title;
        setStatus('');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Unable to open book');
      }
    };
    void start();
    return () => {
      cancelled = true;
      view?.close();
      view?.element.remove();
      viewRef.current = null;
    };
  }, []);

  return (
    <main className='shell'>
      <header className='toolbar'>
        <a className='button' href={bootstrap?.navigation.back ?? '/'}>
          Back to book
        </a>
        <div className='book-title'>{bootstrap?.book.title ?? 'Readest'}</div>
        <div className='actions'>
          <button
            type='button'
            onClick={() => void viewRef.current?.previous()}
            aria-label='Previous page'
          >
            ←
          </button>
          <span className='progress'>{progress}</span>
          <button type='button' onClick={() => void viewRef.current?.next()} aria-label='Next page'>
            →
          </button>
        </div>
      </header>
      {status ? (
        <section className='status' role='status'>
          {status}
        </section>
      ) : null}
      <div ref={mountRef} className='reader-mount' />
      {bootstrap ? (
        <a className='fallback' href={bootstrap.navigation.fallback}>
          Open with Candle
        </a>
      ) : null}
    </main>
  );
}
