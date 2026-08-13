const key = (bookId: number) => `readest.talebook-embed.position.v1.${bookId}`;

const validCfi = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 2048 && /^epubcfi\([^\r\n]+\)$/.test(value);

export const savePosition = (
  bookId: number,
  revision: string,
  cfi: string,
  storage: Pick<Storage, 'setItem'> = localStorage,
) => {
  if (validCfi(cfi)) storage.setItem(key(bookId), JSON.stringify({ revision, cfi }));
};

export const loadPosition = (
  bookId: number,
  revision: string,
  storage: Pick<Storage, 'getItem'> = localStorage,
) => {
  try {
    const value = storage.getItem(key(bookId));
    if (!value) return null;
    const parsed = JSON.parse(value) as { revision?: unknown; cfi?: unknown };
    return parsed.revision === revision && validCfi(parsed.cfi) ? parsed.cfi : null;
  } catch {
    return null;
  }
};

export const positionFromHash = (hash = window.location.hash) => {
  try {
    const value = new URLSearchParams(hash.replace(/^#/, '')).get('loc');
    return validCfi(value) ? value : null;
  } catch {
    return null;
  }
};

export const hashForPosition = (cfi: string) =>
  validCfi(cfi) ? `#${new URLSearchParams({ loc: cfi }).toString()}` : '';
