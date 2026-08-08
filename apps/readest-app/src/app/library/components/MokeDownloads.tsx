'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PiBooks, PiFile } from 'react-icons/pi';
import { useRouter } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { platform } from '@tauri-apps/plugin-os';

import Spinner from '@/components/Spinner';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { formatTitle } from '@/utils/book';
import { tryNativeParseEpub } from '@/utils/tauriEpubBridge';

interface MokeDownloadedBook {
  id: string;
  bookId: string;
  title: string;
  fileName: string;
  filePath: string;
}

interface ParsedMokeBookMetadata {
  title: string;
  coverUrl?: string;
}

const MokeDownloads = ({ searchQuery }: { searchQuery: string }) => {
  const _ = useTranslation();
  const router = useRouter();
  const { settings } = useSettingsStore();
  const [books, setBooks] = useState<MokeDownloadedBook[]>([]);
  const [bookMetadata, setBookMetadata] = useState<Record<string, ParsedMokeBookMetadata>>({});
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const loadBooks = useCallback(async () => {
    setLoading(true);
    try {
      setBooks(await invoke<MokeDownloadedBook[]>('moke_list_downloaded_books'));
    } catch (error) {
      console.error('Failed to load Moke downloaded books:', error);
      setBooks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBooks();
  }, [loadBooks]);

  useEffect(() => {
    let cancelled = false;
    const coverUrls: string[] = [];

    void Promise.all(
      books.map(async (book) => {
        const parsed = await tryNativeParseEpub(book.filePath);
        if (!parsed) return [book.id, null] as const;

        const cover = await parsed.bookDoc.getCover();
        const coverUrl = cover ? URL.createObjectURL(cover) : undefined;
        if (coverUrl) coverUrls.push(coverUrl);
        return [book.id, { title: formatTitle(parsed.bookDoc.metadata.title), coverUrl }] as const;
      }),
    )
      .then((results) => {
        if (cancelled) return;
        const metadata: Record<string, ParsedMokeBookMetadata> = {};
        for (const [id, meta] of results) {
          if (meta) metadata[id] = meta;
        }
        setBookMetadata(metadata);
      })
      .catch((error) => console.warn('Failed to read Moke book metadata:', error));

    return () => {
      cancelled = true;
      coverUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [books]);

  const visibleBooks = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    return query
      ? books.filter((book) =>
          (bookMetadata[book.id]?.title || book.title).toLocaleLowerCase().includes(query),
        )
      : books;
  }, [bookMetadata, books, searchQuery]);

  const openBook = async (book: MokeDownloadedBook) => {
    setOpeningId(book.id);
    try {
      const mokeBookId = book.id.startsWith('legacy:') ? undefined : book.bookId || undefined;

      // `open_reader` creates a separate window and is intentionally only
      // compiled for desktop. Mobile and OHOS have a single WebView, so opening
      // a Moke download must navigate that WebView to the bundled reader instead.
      // Moke exposes `moke_runtime_platform` because plugin-os reports OHOS as
      // `linux` (target_os == linux), which would otherwise fall through to the
      // desktop `open_reader` path.
      let currentPlatform: string;
      try {
        currentPlatform = await invoke<string>('moke_runtime_platform');
      } catch {
        currentPlatform = await platform();
      }
      if (
        currentPlatform === 'android' ||
        currentPlatform === 'ios' ||
        currentPlatform === 'ohos'
      ) {
        const params = new URLSearchParams({
          file: book.filePath,
          moke: '1',
          mokeEink: settings.globalViewSettings?.isEink ? '1' : '0',
        });
        if (mokeBookId) params.set('mokeBookId', mokeBookId);
        if (typeof window.__MOKE_SERVER_URL === 'string') {
          params.set('mokeServerUrl', window.__MOKE_SERVER_URL);
        }

        // App Router navigation does not rerun the root launch script, which
        // normally seeds these values from the URL on a full page load.
        window.__MOKE_EMBEDDED = true;
        window.__MOKE_EINK = settings.globalViewSettings?.isEink ?? false;
        window.__MOKE_BOOK_ID = mokeBookId ?? null;
        window.__MOKE_RESTORE_PROGRESS = null;
        router.push(`/reader?${params.toString()}`);
        return;
      }

      await invoke('open_reader', {
        filePath: book.filePath,
        eink: settings.globalViewSettings?.isEink ?? false,
        mokeBookId,
      });
    } catch (error) {
      console.error('Failed to open Moke downloaded book:', error);
    } finally {
      setOpeningId(null);
    }
  };

  if (loading) {
    return (
      <div className='flex flex-grow items-center justify-center'>
        <Spinner loading />
      </div>
    );
  }

  if (visibleBooks.length === 0) {
    return (
      <div className='hero flex-grow items-center justify-center text-center'>
        <div className='flex max-w-md flex-col items-center'>
          <PiBooks aria-hidden className='text-base-content/60 mb-6 size-16' />
          <h1 className='text-2xl font-semibold'>{_('No Moke downloads')}</h1>
          <p className='text-base-content/70 mt-3'>
            {searchQuery
              ? _('No downloaded books match your search.')
              : _('Download books in Moke to read them here.')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div aria-label={_('Moke Downloads')} className='min-h-0 flex-grow overflow-y-auto py-2'>
      <div
        className={
          'bookshelf-items grid gap-x-4 px-4 sm:gap-x-0 sm:px-2 ' +
          'grid-cols-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-12'
        }
        style={
          settings.libraryAutoColumns
            ? undefined
            : { gridTemplateColumns: `repeat(${settings.libraryColumns}, minmax(0, 1fr))` }
        }
      >
        {visibleBooks.map((book) => {
          const metadata = bookMetadata[book.id];
          return (
            <button
              key={book.id}
              type='button'
              onClick={() => void openBook(book)}
              disabled={openingId === book.id}
              className='group mx-0 my-2 flex h-full flex-col text-left disabled:opacity-60 sm:mx-4 sm:my-4'
            >
              <span className='bookitem-main bg-base-300/45 hover:bg-base-300/70 flex aspect-[28/41] w-full items-center justify-center overflow-hidden rounded'>
                {metadata?.coverUrl ? (
                  <img src={metadata.coverUrl} alt='' className='h-full w-full object-cover' />
                ) : (
                  <PiFile aria-hidden className='text-base-content/60 size-10' />
                )}
              </span>
              <span className='min-w-0 pt-2'>
                <span className='block truncate text-xs font-semibold'>
                  {metadata?.title || book.title}
                </span>
                <span className='text-base-content/60 mt-1 block truncate text-[0.6em]'>
                  {book.fileName.split('.').pop()?.toUpperCase() || _('Book')}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default MokeDownloads;
