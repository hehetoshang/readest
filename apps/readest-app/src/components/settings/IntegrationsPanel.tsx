import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MdChevronRight } from 'react-icons/md';
import {
  RiBookOpenLine,
  RiRssLine,
  RiBookReadLine,
  RiBook3Line,
  RiDiscordLine,
  RiSendPlaneLine,
} from 'react-icons/ri';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { useSettingsStore } from '@/store/settingsStore';
import { useCustomOPDSStore } from '@/store/customOPDSStore';
import { useFileSyncStore } from '@/store/fileSyncStore';
import { CatalogManager } from '@/app/opds/components/CatalogManager';
import { saveSysSettings } from '@/helpers/settings';
import { navigateToLogin } from '@/utils/nav';
import KOSyncForm from './integrations/KOSyncForm';
import ReadwiseForm from './integrations/ReadwiseForm';
import HardcoverForm from './integrations/HardcoverForm';
import TalebookForm from './integrations/TalebookForm';
import SendToReadestForm from './integrations/SendToReadestForm';
import WebDAVForm from './integrations/WebDAVForm';
import SubPageHeader from './SubPageHeader';
import { SectionTitle, SettingLabel, Tips } from './primitives';

// Moke embedded reader: third-party cloud sync (Google Drive / OneDrive /
// S3 / Readest Cloud) is disabled. The forms, cloud-sync provider helpers and
// quota stats are commented out rather than imported, so the disabled provider
// chain never enters the build graph.
// import { useQuotaStats } from '@/hooks/useQuotaStats';
// import { isCloudSyncAllowed } from '@/utils/access';
// import { isWebAppPlatform } from '@/services/environment';
// import { getGoogleWebClientId } from '@/services/sync/providers/gdrive/buildGoogleDriveProvider';
// import { getMicrosoftClientId } from '@/services/sync/providers/onedrive/buildOneDriveProvider';
// import { navigateToProfile } from '@/utils/nav';
// import GoogleDriveForm from './integrations/GoogleDriveForm';
// import OneDriveForm from './integrations/OneDriveForm';
// import S3Form from './integrations/S3Form';
// import { persistCloudProviderEnabled } from './integrations/cloudSync';
// import {
//   canToggleCloudProvider,
//   getReadestCloudRowStatus,
//   getThirdPartyRowStatus,
// } from './integrations/cloudSyncStatus';
// import {
//   getCloudSyncProviders,
//   isReadestCloudEnabled,
//   resolveCloudSyncGate,
//   settingsKeyForBackend,
//   type CloudSyncProviderKind,
// } from '@/services/sync/cloudSyncProvider';
// import type { FileSyncBackendKind } from '@/services/sync/file/providerRegistry';
// import { canBackendRun } from '@/services/sync/file/runLibrarySync';
// import { BoxedList, NavigationRow } from './primitives';

type SubPage =
  | 'kosync'
  | 'webdav'
  // Moke embedded reader: third-party cloud sync sub-pages are disabled.
  // | 'gdrive'
  // | 's3'
  // | 'onedrive'
  // | 'readest-cloud'
  | 'readwise'
  | 'hardcover'
  | 'talebook'
  | 'opds'
  | 'send'
  | null;

/**
 * Integrations panel — single point of discovery for external service config:
 * KOReader Sync, Readwise, Hardcover, and OPDS Catalogs.
 *
 * Pattern: boxed list of NavigationRows. Each row pushes the panel into an
 * inline sub-page (with breadcrumb back-navigation matching the Dictionaries
 * pattern) — no nested modals.
 *
 * TODO(design-system): Once we extract BoxedList / NavigationRow primitives,
 * this panel and CustomDictionaries should both consume them instead of
 * inlining the chassis.
 */
const IntegrationsPanel: React.FC = () => {
  const _ = useTranslation();
  const router = useRouter();
  const { envConfig, appService } = useEnv();
  const { user } = useAuth();
  const { settings, requestedSubPage, setRequestedSubPage } = useSettingsStore();
  const opdsCatalogs = useCustomOPDSStore((s) => s.catalogs);
  const opdsCount = opdsCatalogs.filter((c) => !c.deletedAt).length;
  // Surface a library-wide WebDAV sync that's mid-flight in the row's
  // status line. Keeps the user from feeling like the run was lost
  // when they back out of the WebDAV sub-page or close the dialog.
  const isWebDAVSyncing = useFileSyncStore((s) => s.byKind.webdav?.isSyncing ?? false);

  const [subPage, setSubPage] = useState<SubPage>(null);

  // Android Back / Esc: when any integrations sub-page (KOSync, WebDAV,
  // Readwise, Hardcover, OPDS, Send-to-Readest) is open, intercept and
  // step back to the integrations list instead of letting <Dialog>'s
  // listener close the whole Settings dialog. The hook registers its
  // sync `native-key-down` listener *after* <Dialog>'s, and
  // `dispatchSync` walks listeners LIFO — so this one claims Back first
  // when enabled and `return true` consumes the event. When subPage is
  // null the hook is disabled and Back falls through to close the dialog
  // as before.
  useKeyDownActions({
    enabled: subPage !== null,
    onCancel: () => setSubPage(null),
  });

  const toggleDiscordPresence = () => {
    const discordRichPresenceEnabled = !settings.discordRichPresenceEnabled;
    saveSysSettings(envConfig, 'discordRichPresenceEnabled', discordRichPresenceEnabled);
    if (discordRichPresenceEnabled && !user) {
      navigateToLogin(router);
    }
  };

  // Deep-link consumption: when a caller (e.g. OPDS browser close handler)
  // sets `requestedSubPage` in the store before opening the dialog, drill
  // straight into that sub-page on mount and clear the request so it doesn't
  // stick to the next open. Recognised values match the SubPage union.
  useEffect(() => {
    if (!requestedSubPage) return;
    if (
      requestedSubPage === 'kosync' ||
      requestedSubPage === 'webdav' ||
      requestedSubPage === 'readwise' ||
      requestedSubPage === 'hardcover' ||
      requestedSubPage === 'talebook' ||
      requestedSubPage === 'opds' ||
      requestedSubPage === 'send'
    ) {
      setSubPage(requestedSubPage);
    }
    setRequestedSubPage(null);
  }, [requestedSubPage, setRequestedSubPage]);

  // Sub-page wrapper matches the list-view's `my-4 w-full` so the
  // SubPageHeader's "Integrations" label lands at the exact same Y position
  // as the list-view's h2 — clicking a row reads as a navigation morph
  // rather than a layout shift.
  if (subPage === 'kosync')
    return (
      <div className='my-4 w-full'>
        <KOSyncForm onBack={() => setSubPage(null)} />
      </div>
    );
  if (subPage === 'webdav')
    return (
      <div className='my-4 w-full'>
        <SubPageHeader
          parentLabel={_('Integrations')}
          currentLabel={_('WebDAV')}
          description={_(
            'Sync your library, reading progress, and highlights with a WebDAV server.',
          )}
          onBack={() => setSubPage(null)}
        />
        <WebDAVForm />
        {settings.webdav?.enabled && (
          <div className='mt-5'>
            <Tips>
              <li>
                {_('{{provider}} keeps a full copy of your books, progress, and annotations.', {
                  provider: _('WebDAV'),
                })}
              </li>
              <li>
                {_(
                  'App settings, reading statistics, and dictionaries still sync through your Readest account while signed in.',
                )}
              </li>
            </Tips>
          </div>
        )}
      </div>
    );
  if (subPage === 'readwise')
    return (
      <div className='my-4 w-full'>
        <ReadwiseForm onBack={() => setSubPage(null)} />
      </div>
    );
  if (subPage === 'hardcover')
    return (
      <div className='my-4 w-full'>
        <HardcoverForm onBack={() => setSubPage(null)} />
      </div>
    );
  if (subPage === 'talebook')
    return (
      <div className='my-4 w-full'>
        <TalebookForm onBack={() => setSubPage(null)} />
      </div>
    );
  if (subPage === 'opds')
    return (
      <div className='my-4 w-full'>
        <SubPageHeader
          parentLabel={_('Integrations')}
          currentLabel={_('OPDS Catalogs')}
          description={_('Browse and download books from online catalogs.')}
          onBack={() => setSubPage(null)}
        />
        <CatalogManager inSubPage />
      </div>
    );
  if (subPage === 'send')
    return (
      <div className='my-4 w-full'>
        <SendToReadestForm onBack={() => setSubPage(null)} />
      </div>
    );

  const koSyncStatus = settings.kosync?.enabled
    ? settings.kosync.username
      ? _('Connected as {{user}}', { user: settings.kosync.username })
      : _('Connected')
    : _('Not connected');

  const readwiseStatus = settings.readwise?.enabled ? _('Connected') : _('Not connected');
  const hardcoverStatus = settings.hardcover?.enabled ? _('Connected') : _('Not connected');
  const talebookStatus = settings.talebook?.enabled ? _('Connected') : _('Not connected');

  const webdavStatus = settings.webdav?.enabled
    ? isWebDAVSyncing
      ? _('Syncing')
      : _('Connected')
    : _('Not connected');

  const opdsStatus =
    opdsCount > 0 ? _('{{count}} catalog', { count: opdsCount }) : _('No catalogs');

  return (
    <div className='my-4 w-full space-y-6'>
      <div className='w-full px-4'>
        <h2 className='mb-1.5 text-lg font-semibold tracking-tight'>{_('Integrations')}</h2>
        <p className='text-base-content/70 text-sm leading-relaxed'>
          {_('Connect Readest to external services for sync, highlights, and catalogs.')}
        </p>
      </div>

      <div className='w-full' data-setting-id='settings.integrations.sync'>
        <SectionTitle className='mb-2'>{_('Reading Sync')}</SectionTitle>
        <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
          <div className='divide-base-200 divide-y'>
            <IntegrationRow
              icon={RiBookOpenLine}
              title={_('KOReader')}
              status={koSyncStatus}
              onClick={() => setSubPage('kosync')}
            />
            <IntegrationRow
              icon={RiBookReadLine}
              title={_('Readwise')}
              status={readwiseStatus}
              onClick={() => setSubPage('readwise')}
            />
            <IntegrationRow
              icon={RiBook3Line}
              title={_('Hardcover')}
              status={hardcoverStatus}
              onClick={() => setSubPage('hardcover')}
            />
            <IntegrationRow
              icon={RiBookOpenLine}
              title={_('Talebook')}
              status={talebookStatus}
              onClick={() => setSubPage('talebook')}
            />
          </div>
        </div>
      </div>

      <div className='w-full' data-setting-id='settings.integrations.cloudSync'>
        <SectionTitle className='mb-2'>{_('Cloud Sync')}</SectionTitle>
        <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
          <div className='divide-base-200 divide-y'>
            <IntegrationRow
              icon={RiSendPlaneLine}
              title={_('WebDAV')}
              status={webdavStatus}
              onClick={() => setSubPage('webdav')}
            />
          </div>
        </div>
      </div>

      <div className='w-full' data-setting-id='settings.integrations.catalogs'>
        <SectionTitle className='mb-2'>{_('Content Sources')}</SectionTitle>
        <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
          <div className='divide-base-200 divide-y'>
            <IntegrationRow
              icon={RiRssLine}
              title={_('OPDS Catalogs')}
              status={opdsStatus}
              onClick={() => setSubPage('opds')}
            />
            <IntegrationRow
              icon={RiSendPlaneLine}
              title={_('Send to Readest')}
              status={_('Email books to your library')}
              onClick={() => setSubPage('send')}
            />
          </div>
        </div>
      </div>

      {appService?.isDesktopApp && (
        <div className='w-full' data-setting-id='settings.integrations.discord'>
          <SectionTitle className='mb-2'>{_('Discord')}</SectionTitle>
          <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
            <div className='divide-base-200 divide-y'>
              <IntegrationToggleRow
                icon={RiDiscordLine}
                title={_('Show on Discord')}
                description={_("Display what I'm reading on Discord")}
                checked={settings.discordRichPresenceEnabled}
                onChange={toggleDiscordPresence}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface IntegrationRowProps {
  icon: React.ElementType;
  title: string;
  status: string;
  onClick: () => void;
}

const IntegrationRow: React.FC<IntegrationRowProps> = ({ icon: Icon, title, status, onClick }) => {
  return (
    <button
      type='button'
      onClick={onClick}
      className={clsx(
        'group flex w-full items-center gap-3 px-4 py-3 text-left',
        'transition-colors duration-150',
        'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset',
      )}
    >
      <span
        className={clsx(
          'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full',
          'bg-base-200 text-base-content/70',
          'transition-colors duration-150',
          'group-hover:bg-base-300/70',
        )}
      >
        <Icon className='h-5 w-5' />
      </span>
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <SettingLabel>{title}</SettingLabel>
        <span className='text-base-content/65 truncate text-[0.85em]'>{status}</span>
      </div>
      <MdChevronRight className='text-base-content/50 h-5 w-5 flex-shrink-0' />
    </button>
  );
};

interface IntegrationToggleRowProps {
  icon: React.ElementType;
  title: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}

/**
 * Sibling of IntegrationRow for settings that are a simple on/off toggle
 * (no sub-page). Keeps the same circular-badge chassis so toggle and
 * navigation rows read as one consistent list.
 */
const IntegrationToggleRow: React.FC<IntegrationToggleRowProps> = ({
  icon: Icon,
  title,
  description,
  checked,
  onChange,
}) => {
  return (
    <label className='flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left'>
      <span
        className={clsx(
          'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full',
          'bg-base-200 text-base-content/70',
        )}
      >
        <Icon className='h-5 w-5' />
      </span>
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <SettingLabel>{title}</SettingLabel>
        <span className='text-base-content/65 truncate text-[0.85em]'>{description}</span>
      </div>
      <input
        type='checkbox'
        className='toggle flex-shrink-0'
        checked={checked}
        onChange={onChange}
      />
    </label>
  );
};

export default IntegrationsPanel;
