export type ReaderSettings = Readonly<{
  fontSize: number;
  fontWeight: 400 | 500 | 600;
  fontFamily: 'serif' | 'sans-serif';
  paragraphSpacing: number;
  lineHeight: number;
  margin: number;
  columns: 1 | 2;
  flow: 'paginated' | 'scrolled';
  theme: 'light' | 'sepia' | 'dark';
  uiLanguage: 'en' | 'zh-CN';
}>;

export const DEFAULT_READER_SETTINGS: ReaderSettings = Object.freeze({
  fontSize: 18,
  fontWeight: 400,
  fontFamily: 'serif',
  paragraphSpacing: 0.75,
  lineHeight: 1.6,
  margin: 32,
  columns: 2,
  flow: 'paginated',
  theme: 'light',
  uiLanguage: 'en',
});

const KEY = 'readest.talebook-embed.settings.v1';

const oneOf = <T extends string | number>(value: unknown, allowed: readonly T[], fallback: T) =>
  allowed.includes(value as T) ? (value as T) : fallback;

export const sanitizeReaderSettings = (value: unknown): ReaderSettings => {
  const input = value && typeof value === 'object' ? (value as Partial<ReaderSettings>) : {};
  return {
    fontSize: oneOf(input.fontSize, [14, 16, 18, 20, 22, 24], DEFAULT_READER_SETTINGS.fontSize),
    fontWeight: oneOf(input.fontWeight, [400, 500, 600], DEFAULT_READER_SETTINGS.fontWeight),
    fontFamily: oneOf(
      input.fontFamily,
      ['serif', 'sans-serif'],
      DEFAULT_READER_SETTINGS.fontFamily,
    ),
    paragraphSpacing: oneOf(
      input.paragraphSpacing,
      [0, 0.5, 0.75, 1, 1.5],
      DEFAULT_READER_SETTINGS.paragraphSpacing,
    ),
    lineHeight: oneOf(
      input.lineHeight,
      [1.3, 1.45, 1.6, 1.8, 2],
      DEFAULT_READER_SETTINGS.lineHeight,
    ),
    margin: oneOf(input.margin, [16, 24, 32, 48, 64], DEFAULT_READER_SETTINGS.margin),
    columns: oneOf(input.columns, [1, 2], DEFAULT_READER_SETTINGS.columns),
    flow: oneOf(input.flow, ['paginated', 'scrolled'], DEFAULT_READER_SETTINGS.flow),
    theme: oneOf(input.theme, ['light', 'sepia', 'dark'], DEFAULT_READER_SETTINGS.theme),
    uiLanguage: oneOf(input.uiLanguage, ['en', 'zh-CN'], DEFAULT_READER_SETTINGS.uiLanguage),
  };
};

export const loadReaderSettings = (
  storage: Pick<Storage, 'getItem'> = localStorage,
): ReaderSettings => {
  try {
    const value = storage.getItem(KEY);
    return value ? sanitizeReaderSettings(JSON.parse(value)) : DEFAULT_READER_SETTINGS;
  } catch {
    return DEFAULT_READER_SETTINGS;
  }
};

export const saveReaderSettings = (
  settings: ReaderSettings,
  storage: Pick<Storage, 'setItem'> = localStorage,
) => storage.setItem(KEY, JSON.stringify(sanitizeReaderSettings(settings)));

const PALETTES = {
  light: { background: '#fffdf8', foreground: '#241f1a', accent: '#8a4b24' },
  sepia: { background: '#f3e6cb', foreground: '#382d20', accent: '#7a4929' },
  dark: { background: '#17191d', foreground: '#e8e5df', accent: '#d5a278' },
} as const;

export const readerStyles = (settings: ReaderSettings) => {
  const colors = PALETTES[settings.theme];
  return `
    :root { color-scheme: ${settings.theme === 'dark' ? 'dark' : 'light'}; }
    html, body {
      color: ${colors.foreground} !important;
      background: ${colors.background} !important;
      font-family: ${settings.fontFamily} !important;
      font-size: ${settings.fontSize}px !important;
      font-weight: ${settings.fontWeight} !important;
      line-height: ${settings.lineHeight} !important;
    }
    p { margin-block: ${settings.paragraphSpacing}em !important; }
    a { color: ${colors.accent} !important; }
    img, svg { max-inline-size: 100%; }
  `;
};

export const themeColors = (theme: ReaderSettings['theme']) => PALETTES[theme];
