export type ReaderCapabilities = Readonly<{
  readerCore: boolean;
  navigation: boolean;
  tableOfContents: boolean;
  textSearch: boolean;
  localPosition: boolean;
  localSettings: boolean;
  layoutSettings: boolean;
  appearanceSettings: boolean;
  languageSettings: boolean;
  customFonts: boolean;
  backgroundImages: boolean;
  annotations: boolean;
  serverProgress: boolean;
  pdf: boolean;
  dictionaries: boolean;
  translation: boolean;
  tts: boolean;
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
  navigation: false,
  tableOfContents: false,
  textSearch: false,
  localPosition: false,
  localSettings: false,
  layoutSettings: false,
  appearanceSettings: false,
  languageSettings: false,
  customFonts: false,
  backgroundImages: false,
  annotations: false,
  serverProgress: false,
  pdf: false,
  dictionaries: false,
  translation: false,
  tts: false,
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
  navigation: true,
  tableOfContents: true,
  textSearch: true,
  localPosition: true,
  localSettings: true,
  layoutSettings: true,
  appearanceSettings: true,
  languageSettings: true,
});
