export type ReaderCapabilities = Readonly<{
  readerCore: boolean;
  localSettings: boolean;
  library: boolean;
  account: boolean;
  auth: boolean;
  cloud: boolean;
  sync: boolean;
  payment: boolean;
  upgrade: boolean;
  updater: boolean;
  send: boolean;
  rss: boolean;
  opds: boolean;
  integrations: boolean;
  telemetry: boolean;
  aiAssistant: boolean;
  reedy: boolean;
  readestGateway: boolean;
  tauri: boolean;
}>;

const denyAll = (): ReaderCapabilities => ({
  readerCore: false,
  localSettings: false,
  library: false,
  account: false,
  auth: false,
  cloud: false,
  sync: false,
  payment: false,
  upgrade: false,
  updater: false,
  send: false,
  rss: false,
  opds: false,
  integrations: false,
  telemetry: false,
  aiAssistant: false,
  reedy: false,
  readestGateway: false,
  tauri: false,
});

export const TALEBOOK_EMBED_CAPABILITIES: ReaderCapabilities = Object.freeze({
  ...denyAll(),
  readerCore: true,
  localSettings: true,
});
