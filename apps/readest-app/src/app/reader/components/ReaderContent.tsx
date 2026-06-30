'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { Book } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useGamepad } from '@/hooks/useGamepad';
import { useTranslation } from '@/hooks/useTranslation';
import { SystemSettings } from '@/types/settings';
import { parseOpenWithFiles } from '@/helpers/openWith';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { UnlistenFn } from '@tauri-apps/api/event';
import { tauriHandleClose, tauriHandleOnCloseWindow } from '@/utils/window';
import { isTauriAppPlatform } from '@/services/environment';
import { uniqueId } from '@/utils/misc';
import { partialMD5 } from '@/utils/md5';
import { throttle } from '@/utils/throttle';
import { eventDispatcher } from '@/utils/event';
import {
  closeReaderWindowOrGoToLibrary,
  ensureMainLibraryWindow,
  navigateToLibrary,
} from '@/utils/nav';
import { clearDiscordPresence } from '@/utils/discord';
import { BOOK_IDS_SEPARATOR } from '@/services/constants';
import { BookDetailModal } from '@/components/metadata';
import ShareBookDialog from '@/app/library/components/ShareBookDialog';
import { useAuth } from '@/context/AuthContext';

import useBooksManager from '../hooks/useBooksManager';
import useBookShortcuts from '../hooks/useBookShortcuts';
import Spinner from '@/components/Spinner';
import SideBar from './sidebar/SideBar';
import Notebook from './notebook/Notebook';
import BooksGrid from './BooksGrid';
import SettingsDialog from '@/components/settings/SettingsDialog';

const ReaderContent: React.FC<{ ids?: string; settings: SystemSettings }> = ({ ids, settings }) => {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { envConfig, appService } = useEnv();
  const { bookKeys, dismissBook, getNextBookKey } = useBooksManager();
  const { sideBarBookKey, setSideBarBookKey } = useSidebarStore();
  const { saveSettings } = useSettingsStore();
  const { getConfig, getBookData, saveConfig } = useBookDataStore();
  const { getView, setBookKeys, getViewSettings } = useReaderStore();
  const { initViewState, getViewState, clearViewState } = useReaderStore();
  const { isSettingsDialogOpen, settingsDialogBookKey } = useSettingsStore();
  const [showDetailsBook, setShowDetailsBook] = useState<Book | null>(null);
  const [shareDialogState, setShareDialogState] = useState<{
    book: Book;
    cfi: string | null;
  } | null>(null);
  const { user } = useAuth();
  const isInitiating = useRef(false);
  const [loading, setLoading] = useState(false);
  const [errorLoading, setErrorLoading] = useState(false);

  useBookShortcuts({ sideBarBookKey, bookKeys });
  useGamepad();

  useEffect(() => {
    if (isInitiating.current) return;
    isInitiating.current = true;

    const pathname = window.location.pathname;
    const bookIds = ids || searchParams?.get('ids') || pathname.split('/reader/')[1] || '';
    const initialIds = bookIds.split(BOOK_IDS_SEPARATOR).filter(Boolean);

    // No ids provided — check if the window was opened with a file path
    // (set by open_reader_window via window.OPEN_WITH_FILES initialization script).
    // Dispatching is deferred to a separate effect that waits for appService.
    if (initialIds.length === 0 && window.OPEN_WITH_FILES?.length) {
      return;
    }

    const initialBookKeys = initialIds.map((id) => `${id}-${uniqueId()}`);
    setBookKeys(initialBookKeys);
    const uniqueIds = new Set<string>();
    console.log('Initialize books', initialBookKeys);
    initialBookKeys.forEach((key, index) => {
      const id = key.split('-')[0]!;
      const isPrimary = !uniqueIds.has(id);
      uniqueIds.add(id);
      if (!getViewState(key)) {
        initViewState(envConfig, id, key, isPrimary).catch((error) => {
          console.log('Error initializing book', key, error);
          setErrorLoading(true);
          eventDispatcher.dispatch('toast', {
            message: _('Unable to open book'),
            callback: async () => {
              const service = await envConfig.getAppService();
              await closeReaderWindowOrGoToLibrary(service, router);
            },
            timeout: 2000,
            type: 'error',
          });
        });
        if (index === 0) setSideBarBookKey(key);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the reader window is opened with a file path via open_reader_window
  // (Rust sets window.OPEN_WITH_FILES before React boots), load the file as a
  // transient book directly in THIS window.
  //
  // We can't reuse the usual app-incoming-url → useOpenWithBooks path: that
  // hook early-returns for any /reader pathname (it assumes a reader is already
  // active), and even its openTransient branch finishes with navigateToReader,
  // which is a no-op here — App Router won't remount ReaderContent on a same
  // /reader push, and the init effect above has empty deps. So we import the
  // file transiently (no library write) and seed bookKeys/initViewState
  // ourselves, mirroring both openTransient and the init effect.
  useEffect(() => {
    if (!appService) return;
    if (!window.OPEN_WITH_FILES?.length) return;
    const files = window.OPEN_WITH_FILES;
    window.OPEN_WITH_FILES = null;

    const failToOpen = () => {
      setErrorLoading(true);
      eventDispatcher.dispatch('toast', {
        message: _('Unable to open book'),
        callback: async () => {
          const service = await envConfig.getAppService();
          await closeReaderWindowOrGoToLibrary(service, router);
        },
        timeout: 2000,
        type: 'error',
      });
    };

    const openTransientFiles = async () => {
      // Load the real library from disk before building any transient entry, so
      // initViewState's getBookByHash can resolve the book and an empty-store
      // save can't wipe library.json (same rationale as useOpenWithBooks).
      const { setLibrary, getBookByHash, libraryLoaded } = useLibraryStore.getState();
      let library = useLibraryStore.getState().library;
      if (!libraryLoaded) {
        library = await appService.loadLibraryBooks();
        setLibrary(library);
      }

      const bookIds: string[] = [];
      let libraryMutated = false;
      for (const file of files) {
        try {
          // Hash-precheck: if the file is already a managed (non-deleted)
          // library book, route to it without importBook — transient import
          // would otherwise rewrite that entry's filePath/createdAt.
          let existingHash: string | undefined;
          try {
            const fileobj = await appService.openFile(file, 'None');
            try {
              existingHash = await partialMD5(fileobj);
            } finally {
              const closable = fileobj as File & { close?: () => Promise<void> };
              if (closable.close) await closable.close();
            }
          } catch (e) {
            console.warn('Pre-hash failed, falling back to transient import:', file, e);
          }

          if (existingHash) {
            const existing = getBookByHash(existingHash);
            if (existing && !existing.deletedAt) {
              bookIds.push(existing.hash);
              continue;
            }
          }

          const book = await appService.importBook(file, library, { transient: true });
          if (book) {
            bookIds.push(book.hash);
            libraryMutated = true;
          }
        } catch (e) {
          console.warn('Failed to open file in reader window:', file, e);
        }
      }

      if (bookIds.length === 0) {
        failToOpen();
        return;
      }
      if (libraryMutated) setLibrary(library);

      const newBookKeys = bookIds
        .filter((id) => !!getBookByHash(id))
        .map((id) => `${id}-${uniqueId()}`);
      if (newBookKeys.length === 0) {
        failToOpen();
        return;
      }
      setBookKeys(newBookKeys);
      const uniqueIds = new Set<string>();
      newBookKeys.forEach((key, index) => {
        const id = key.split('-')[0]!;
        const isPrimary = !uniqueIds.has(id);
        uniqueIds.add(id);
        if (!getViewState(key)) {
          initViewState(envConfig, id, key, isPrimary).catch((error) => {
            console.log('Error initializing book', key, error);
            failToOpen();
          });
          if (index === 0) setSideBarBookKey(key);
        }
      });
    };

    openTransientFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService]);

  useEffect(() => {
    const handleShowBookDetails = (event: CustomEvent) => {
      setShowDetailsBook(event.detail as Book);
      return true;
    };
    eventDispatcher.onSync('show-book-details', handleShowBookDetails);

    return () => {
      eventDispatcher.offSync('show-book-details', handleShowBookDetails);
    };
  }, []);

  useEffect(() => {
    const handleShareIntent = (event: CustomEvent) => {
      const detail = event.detail as { book: Book; cfi?: string | null } | undefined;
      if (!detail?.book) return;
      if (!user) {
        eventDispatcher.dispatch('toast', {
          type: 'info',
          message: _('Sign in to share books'),
          timeout: 2500,
        });
        return;
      }
      setShareDialogState({
        book: detail.book,
        cfi: detail.cfi ?? null,
      });
    };
    eventDispatcher.on('show-share-dialog', handleShareIntent);
    return () => {
      eventDispatcher.off('show-share-dialog', handleShareIntent);
    };
  }, [user, _]);

  useEffect(() => {
    if (bookKeys && bookKeys.length > 0) {
      const settings = useSettingsStore.getState().settings;
      const lastOpenBooks = bookKeys.map((key) => key.split('-')[0]!);
      if (settings.lastOpenBooks?.toString() !== lastOpenBooks.toString()) {
        settings.lastOpenBooks = lastOpenBooks;
        saveSettings(envConfig, settings);
      }
    }

    let unlistenOnCloseWindow: Promise<UnlistenFn>;
    if (isTauriAppPlatform()) {
      unlistenOnCloseWindow = tauriHandleOnCloseWindow(handleCloseBooks);
    }
    window.addEventListener('beforeunload', handleCloseBooks);
    eventDispatcher.on('beforereload', handleCloseBooks);
    eventDispatcher.on('close-reader', handleCloseBooks);
    eventDispatcher.on('quit-app', handleCloseBooks);
    return () => {
      window.removeEventListener('beforeunload', handleCloseBooks);
      eventDispatcher.off('beforereload', handleCloseBooks);
      eventDispatcher.off('close-reader', handleCloseBooks);
      eventDispatcher.off('quit-app', handleCloseBooks);
      unlistenOnCloseWindow?.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKeys]);

  const saveBookConfig = async (bookKey: string) => {
    const config = getConfig(bookKey);
    const { book } = getBookData(bookKey) || {};
    const { isPrimary } = getViewState(bookKey) || {};
    if (isPrimary && book && config) {
      const settings = useSettingsStore.getState().settings;
      eventDispatcher.dispatch('sync-book-progress', { bookKey });
      eventDispatcher.dispatch('flush-kosync', { bookKey });
      await saveConfig(envConfig, bookKey, config, settings);
    }
  };

  const saveConfigAndCloseBook = async (bookKey: string) => {
    console.log('Closing book', bookKey);

    const viewState = getViewState(bookKey);
    if (viewState?.isPrimary && appService?.isDesktopApp) {
      await clearDiscordPresence(appService);
    }

    try {
      getView(bookKey)?.close();
      getView(bookKey)?.remove();
    } catch {
      console.info('Error closing book', bookKey);
    }
    eventDispatcher.dispatch('tts-stop', { bookKey });
    await saveBookConfig(bookKey);
    clearViewState(bookKey);
  };

  const navigateBackToLibrary = () => {
    navigateToLibrary(router, '', undefined, true);
  };

  const saveSettingsAndGoToLibrary = () => {
    saveSettings(envConfig, settings);
    navigateBackToLibrary();
  };

  const handleCloseBooks = throttle(async () => {
    const settings = useSettingsStore.getState().settings;
    await Promise.all(bookKeys.map(async (key) => await saveConfigAndCloseBook(key)));
    await saveSettings(envConfig, settings);
  }, 200);

  const handleCloseBooksToLibrary = async () => {
    handleCloseBooks();
    if (isTauriAppPlatform()) {
      const currentWindow = getCurrentWindow();
      if (currentWindow.label === 'main') {
        navigateBackToLibrary();
      } else {
        if (appService) {
          await ensureMainLibraryWindow(appService);
        }
        currentWindow.close();
      }
    } else {
      navigateBackToLibrary();
    }
  };

  const handleCloseBook = async (bookKey: string) => {
    saveConfigAndCloseBook(bookKey);
    if (sideBarBookKey === bookKey) {
      setSideBarBookKey(getNextBookKey(sideBarBookKey));
    }
    dismissBook(bookKey);
    if (bookKeys.filter((key) => key !== bookKey).length == 0) {
      const openWithFiles = (await parseOpenWithFiles(appService)) || [];
      if (appService?.hasWindow) {
        if (openWithFiles.length > 0) {
          tauriHandleOnCloseWindow(handleCloseBooks);
          return await tauriHandleClose();
        }
        const currentWindow = getCurrentWindow();
        if (currentWindow.label.startsWith('reader')) {
          return await currentWindow.close();
        }
      }
      saveSettingsAndGoToLibrary();
    }
  };

  if (!bookKeys || bookKeys.length === 0) return null;
  const bookData = getBookData(bookKeys[0]!);
  const viewSettings = getViewSettings(bookKeys[0]!);
  if (!bookData || !bookData.book || !bookData.bookDoc || !viewSettings) {
    setTimeout(() => setLoading(true), 200);
    return (
      loading &&
      !errorLoading && (
        <div className='hero hero-content full-height'>
          <Spinner loading={true} />
        </div>
      )
    );
  }

  return (
    <div className='reader-content full-height flex'>
      <SideBar />
      <BooksGrid
        bookKeys={bookKeys}
        onCloseBook={handleCloseBook}
        onGoToLibrary={handleCloseBooksToLibrary}
      />
      {isSettingsDialogOpen && <SettingsDialog bookKey={settingsDialogBookKey} />}
      <Notebook />
      {showDetailsBook && (
        <BookDetailModal
          isOpen={!!showDetailsBook}
          book={showDetailsBook}
          onClose={() => setShowDetailsBook(null)}
        />
      )}
      <ShareBookDialog
        isOpen={!!shareDialogState}
        book={shareDialogState?.book ?? null}
        cfi={shareDialogState?.cfi ?? null}
        onClose={() => setShareDialogState(null)}
      />
    </div>
  );
};

export default ReaderContent;
