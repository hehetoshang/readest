import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import {
  TalebookAnnotationClient,
  TalebookSyncError,
  mergeTalebookSyncResult,
  resolveTalebookBookId,
  syncTalebookBookNotes,
} from '@/services/talebook';
import { debounce } from '@/utils/debounce';
import { eventDispatcher } from '@/utils/event';

const TALEBOOK_SYNC_DEBOUNCE_MS = 4000;

export const useTalebookSync = (bookKey: string) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const bookHash = bookKey.split('-')[0]!;
  const bookData = useBookDataStore((state) => state.booksData[bookHash]);
  const updateBooknotes = useBookDataStore((state) => state.updateBooknotes);
  const saveConfig = useBookDataStore((state) => state.saveConfig);
  const talebookSettings = useSettingsStore((state) => state.settings.talebook);
  const syncingRef = useRef(false);
  const lastAppliedNotesRef = useRef<unknown>(null);

  const runSync = useCallback(
    async (manual: boolean) => {
      if (syncingRef.current) return;
      const { settings, setSettings, saveSettings } = useSettingsStore.getState();
      const talebook = settings.talebook;
      const latest = useBookDataStore.getState().booksData[bookHash];
      const book = latest?.book;
      const config = latest?.config;
      if (
        !talebook?.enabled ||
        !talebook.serverUrl ||
        !talebook.username ||
        !talebook.accessToken ||
        !talebook.connectionId ||
        !book ||
        !config
      ) {
        return;
      }
      const bookId = resolveTalebookBookId(book, talebook);
      if (!bookId) {
        if (manual) {
          eventDispatcher.dispatch('toast', {
            type: 'error',
            message: _('Set the Talebook book ID in Integrations before syncing.'),
          });
        }
        return;
      }

      syncingRef.current = true;
      try {
        const notesAtStart = (config.booknotes ?? []).map((note) => ({
          ...note,
          source: note.source ? { ...note.source } : undefined,
        }));
        const client = new TalebookAnnotationClient(talebook);
        const result = await syncTalebookBookNotes(client, bookId, notesAtStart, talebook);
        const liveConfig = useBookDataStore.getState().booksData[bookHash]?.config;
        const reconciledNotes = mergeTalebookSyncResult(
          notesAtStart,
          liveConfig?.booknotes ?? [],
          result.booknotes,
        );
        const updatedConfig = updateBooknotes(bookKey, reconciledNotes);
        if (updatedConfig) {
          lastAppliedNotesRef.current = updatedConfig.booknotes;
          const liveSettings = useSettingsStore.getState().settings;
          await saveConfig(envConfig, bookKey, updatedConfig, liveSettings);
        }

        const syncedAt = Date.now();
        const liveSettings = useSettingsStore.getState().settings;
        const nextSettings = {
          ...liveSettings,
          talebook: { ...liveSettings.talebook, lastSyncedAt: syncedAt },
        };
        setSettings(nextSettings);
        await saveSettings(envConfig, nextSettings);

        if (manual || result.failures.length > 0) {
          eventDispatcher.dispatch('toast', {
            type: result.failures.length > 0 ? 'warning' : 'success',
            message:
              result.failures.length > 0
                ? _(
                    'Talebook sync partially completed: {{count}} item failed and can be retried.',
                    {
                      count: result.failures.length,
                    },
                  )
                : _('Talebook annotations synced'),
          });
        }
      } catch (error) {
        const kind = error instanceof TalebookSyncError ? error.kind : 'unknown';
        const messages = {
          authentication: _('Talebook login expired. Reconnect in Integrations.'),
          permission: _('This Talebook book is unavailable or you do not have access.'),
          incompatible: _('Talebook annotation API is not compatible with this Readest version.'),
          offline: _('Talebook is offline. Sync will retry when the book changes.'),
          rate_limit: _('Talebook is busy. Please retry shortly.'),
          server: _('Talebook sync failed on the server. Please retry.'),
          unknown: _('Talebook annotation sync failed.'),
        } as const;
        if (manual) {
          eventDispatcher.dispatch('toast', { type: 'error', message: messages[kind] });
        } else {
          console.warn('[Talebook] annotation sync failed:', error);
        }
      } finally {
        syncingRef.current = false;
      }
    },
    [_, bookHash, bookKey, envConfig, saveConfig, updateBooknotes],
  );

  const debouncedSync = useMemo(
    () => debounce(() => void runSync(false), TALEBOOK_SYNC_DEBOUNCE_MS),
    [runSync],
  );

  useEffect(() => () => debouncedSync.cancel(), [debouncedSync]);

  useEffect(() => {
    const notes = bookData?.config?.booknotes;
    if (!talebookSettings?.enabled || !talebookSettings.autoSync || !bookData?.book || !notes) {
      return;
    }
    if (notes === lastAppliedNotesRef.current) {
      lastAppliedNotesRef.current = null;
      return;
    }
    debouncedSync();
  }, [bookData?.book, bookData?.config?.booknotes, debouncedSync, talebookSettings]);

  useEffect(() => {
    const handleManualSync = (event: CustomEvent<{ bookKey?: string }>) => {
      if (event.detail?.bookKey && event.detail.bookKey !== bookKey) return;
      void runSync(true);
    };
    eventDispatcher.on('talebook-sync', handleManualSync);
    return () => eventDispatcher.off('talebook-sync', handleManualSync);
  }, [bookKey, runSync]);

  return { syncNow: () => runSync(true) };
};
