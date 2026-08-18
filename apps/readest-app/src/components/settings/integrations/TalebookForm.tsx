import clsx from 'clsx';
import React, { useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { TalebookAnnotationClient, TalebookSyncError } from '@/services/talebook';
import type { TalebookSettings } from '@/types/settings';
import { uniqueId } from '@/utils/misc';
import { eventDispatcher } from '@/utils/event';
import { Toggle } from '@/components/primitives/toggle';
import SubPageHeader from '../SubPageHeader';
import { SectionTitle, SettingLabel, Tips } from '../primitives';

interface TalebookFormProps {
  onBack: () => void;
}

const TalebookForm: React.FC<TalebookFormProps> = ({ onBack }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, settingsDialogBookKey } = useSettingsStore();
  const current = settings.talebook;
  const bookHash = settingsDialogBookKey.split('-')[0] || '';
  const currentBook = useBookDataStore((state) =>
    bookHash ? state.booksData[bookHash]?.book : undefined,
  );
  const [serverUrl, setServerUrl] = useState(current?.serverUrl ?? '');
  const [username, setUsername] = useState(current?.username ?? '');
  const [accessToken, setAccessToken] = useState('');
  const [bookId, setBookId] = useState(
    bookHash && current?.bookIds?.[bookHash] ? String(current.bookIds[bookHash]) : '',
  );
  const [isConnecting, setIsConnecting] = useState(false);

  const isConfigured = !!current?.accessToken;

  const parsedBookId = (): number | null => {
    if (!bookId.trim()) return null;
    const value = Number(bookId);
    return Number.isInteger(value) && value > 0 ? value : null;
  };

  const persist = async (update: (talebook: TalebookSettings) => TalebookSettings) => {
    const store = useSettingsStore.getState();
    const next = { ...store.settings, talebook: update(store.settings.talebook) };
    store.setSettings(next);
    await store.saveSettings(envConfig, next);
  };

  const handleConnect = async () => {
    setIsConnecting(true);
    const connectionId = current?.connectionId || `readest-${Date.now()}-${uniqueId()}`;
    const candidate = {
      enabled: true,
      serverUrl: serverUrl.trim(),
      username: username.trim(),
      accessToken,
      connectionId,
      autoSync: current?.autoSync ?? true,
      privateByDefault: current?.privateByDefault ?? true,
      lastSyncedAt: current?.lastSyncedAt ?? 0,
      bookIds: {
        ...(current?.bookIds ?? {}),
        ...(bookHash && parsedBookId() ? { [bookHash]: parsedBookId()! } : {}),
      },
    };
    try {
      new URL(candidate.serverUrl);
      const client = new TalebookAnnotationClient(candidate);
      await client.validateConnection();
      await persist((latest) => ({
        ...candidate,
        bookIds: { ...latest.bookIds, ...candidate.bookIds },
      }));
      eventDispatcher.dispatch('toast', {
        type: 'success',
        message: _('Connected to Talebook annotation API v2'),
      });
    } catch (error) {
      const message =
        error instanceof TalebookSyncError && error.kind === 'authentication'
          ? _('Invalid Talebook username, password, or app token')
          : error instanceof TalebookSyncError && error.kind === 'incompatible'
            ? _('Talebook annotation API v2 is required')
            : _('Unable to connect to Talebook. Check the server URL and network.');
      eventDispatcher.dispatch('toast', { type: 'error', message });
    } finally {
      setIsConnecting(false);
      setAccessToken('');
    }
  };

  const handleDisconnect = async () => {
    await persist((latest) => ({
      ...latest,
      enabled: false,
      accessToken: '',
      lastSyncedAt: 0,
    }));
    eventDispatcher.dispatch('toast', { type: 'info', message: _('Disconnected from Talebook') });
  };

  const toggle = async (field: 'enabled' | 'autoSync' | 'privateByDefault') => {
    await persist((latest) => ({ ...latest, [field]: !latest[field] }));
  };

  const saveBookMapping = async () => {
    const value = parsedBookId();
    if (!bookHash || !value) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Enter a valid Talebook numeric book ID.'),
      });
      return;
    }
    await persist((latest) => ({
      ...latest,
      bookIds: { ...latest.bookIds, [bookHash]: value },
    }));
    eventDispatcher.dispatch('toast', { type: 'success', message: _('Talebook book ID saved') });
  };

  const syncNow = () => {
    if (!settingsDialogBookKey) return;
    eventDispatcher.dispatch('talebook-sync', { bookKey: settingsDialogBookKey });
  };

  const lastSyncedLabel = current?.lastSyncedAt
    ? new Date(current.lastSyncedAt).toLocaleString()
    : _('Never');

  return (
    <div className='w-full'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('Talebook')}
        description={
          isConfigured
            ? _('Connected to Talebook. Last synced {{time}}.', { time: lastSyncedLabel })
            : _('Sync highlights, notes, and bookmarks with a Talebook server.')
        }
        onBack={onBack}
      />

      {isConfigured ? (
        <div className='space-y-5'>
          <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
            <div className='divide-base-200 divide-y'>
              <label className='flex min-h-14 items-center justify-between px-4'>
                <SettingLabel>{_('Sync Enabled')}</SettingLabel>
                <Toggle checked={current.enabled} onChange={() => void toggle('enabled')} />
              </label>
              <label className='flex min-h-14 items-center justify-between px-4'>
                <SettingLabel>{_('Auto Sync')}</SettingLabel>
                <Toggle checked={current.autoSync} onChange={() => void toggle('autoSync')} />
              </label>
              <label className='flex min-h-14 items-center justify-between px-4'>
                <SettingLabel>{_('New notes are private')}</SettingLabel>
                <Toggle
                  checked={current.privateByDefault}
                  onChange={() => void toggle('privateByDefault')}
                />
              </label>
            </div>
          </div>

          {currentBook && (
            <div className='space-y-1.5'>
              <SectionTitle as='label' htmlFor='talebook-book-id' className='block'>
                {_('Talebook book ID for {{title}}', { title: currentBook.title })}
              </SectionTitle>
              <div className='flex gap-2'>
                <input
                  id='talebook-book-id'
                  inputMode='numeric'
                  className='input input-bordered eink-bordered h-11 min-w-0 flex-1 text-sm focus:outline-none'
                  value={bookId}
                  onChange={(event) => setBookId(event.target.value)}
                />
                <button type='button' className='btn eink-bordered h-11' onClick={saveBookMapping}>
                  {_('Save')}
                </button>
              </div>
            </div>
          )}

          <Tips>
            <li>
              {_(
                'Talebook remains authoritative; remote deletion is never mirrored automatically.',
              )}
            </li>
            <li>
              {_(
                'Notes without a CFI remain available under their chapter with limited navigation.',
              )}
            </li>
          </Tips>

          <div className='flex justify-between gap-3'>
            <button
              type='button'
              onClick={handleDisconnect}
              className='eink-bordered text-error hover:bg-error/10 h-10 rounded-lg px-4 text-sm font-medium'
            >
              {_('Disconnect')}
            </button>
            {settingsDialogBookKey && (
              <button type='button' onClick={syncNow} className='btn btn-contrast h-10 min-h-10'>
                {_('Sync now')}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className='space-y-5'>
          <div className='space-y-1.5'>
            <SectionTitle as='label' htmlFor='talebook-server-url' className='block'>
              {_('Server URL')}
            </SectionTitle>
            <input
              id='talebook-server-url'
              type='url'
              placeholder='https://books.example.com'
              className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <SectionTitle as='label' htmlFor='talebook-username' className='block'>
              {_('Username')}
            </SectionTitle>
            <input
              id='talebook-username'
              autoComplete='username'
              className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <SectionTitle as='label' htmlFor='talebook-token' className='block'>
              {_('Password or app token')}
            </SectionTitle>
            <input
              id='talebook-token'
              type='password'
              autoComplete='current-password'
              className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
              value={accessToken}
              onChange={(event) => setAccessToken(event.target.value)}
            />
          </div>
          {currentBook && (
            <div className='space-y-1.5'>
              <SectionTitle as='label' htmlFor='talebook-book-id-connect' className='block'>
                {_('Talebook book ID for {{title}}', { title: currentBook.title })}
              </SectionTitle>
              <input
                id='talebook-book-id-connect'
                inputMode='numeric'
                className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
                value={bookId}
                onChange={(event) => setBookId(event.target.value)}
              />
            </div>
          )}
          <div className='flex justify-end'>
            <button
              type='button'
              onClick={handleConnect}
              disabled={isConnecting || !serverUrl || !username || !accessToken}
              className={clsx('btn btn-primary h-10 min-h-10', isConnecting && 'opacity-60')}
            >
              {isConnecting ? (
                <span className='loading loading-spinner loading-sm' />
              ) : (
                _('Connect')
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TalebookForm;
