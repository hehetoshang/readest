export type BookResourceLoadDetail = {
  isScript: boolean;
  allow?: boolean;
};

type BookDocumentContentType = 'application/xhtml+xml' | 'text/html' | 'image/svg+xml';

export type BookContentPolicy =
  | { kind: 'document'; contentType: BookDocumentContentType }
  | { kind: 'stylesheet'; contentType: 'text/css' }
  | { kind: 'reject' }
  | { kind: 'passthrough' };

export const normalizeBookContentType = (contentType?: string | null): string =>
  (contentType ?? '').split(';', 1)[0]!.trim().toLowerCase();

/**
 * Resolve publication documents independently of their attacker-controlled manifest MIME.
 * A missing MIME without a recognizable resource name is rejected rather than passed through.
 */
export const getBookContentPolicy = (
  contentType?: string | null,
  resourceName?: string | null,
): BookContentPolicy => {
  const normalizedType = normalizeBookContentType(contentType);
  if (normalizedType === 'text/css') return { kind: 'stylesheet', contentType: 'text/css' };
  if (normalizedType === 'application/xhtml+xml' || normalizedType === 'text/html') {
    return { kind: 'document', contentType: normalizedType };
  }
  if (normalizedType === 'image/svg+xml') {
    return { kind: 'document', contentType: 'image/svg+xml' };
  }

  const resourcePath = (resourceName ?? '').split(/[?#]/, 1)[0]!.toLowerCase();
  if (/\.svg$/.test(resourcePath)) {
    return { kind: 'document', contentType: 'image/svg+xml' };
  }
  if (/\.(?:xhtml|xht)$/.test(resourcePath)) {
    return { kind: 'document', contentType: 'application/xhtml+xml' };
  }
  if (/\.html?$/.test(resourcePath)) {
    return { kind: 'document', contentType: 'text/html' };
  }

  if (!normalizedType) return { kind: 'reject' };
  if (normalizedType.startsWith('text/')) {
    return { kind: 'document', contentType: 'text/html' };
  }
  if (
    /^(?:audio|font|image|video)\//.test(normalizedType) ||
    [
      'application/octet-stream',
      'application/pdf',
      'application/smil+xml',
      'application/vnd.ms-fontobject',
      'application/vnd.ms-opentype',
      'application/x-dtbncx+xml',
      'application/x-font-opentype',
      'application/x-font-ttf',
      'application/x-font-woff',
    ].includes(normalizedType)
  ) {
    return { kind: 'passthrough' };
  }
  return { kind: 'reject' };
};

/** Scripted publication content is unsupported because it shares the reader origin. */
export const enforceBookResourcePolicy = (detail: BookResourceLoadDetail): void => {
  if (detail.isScript) detail.allow = false;
};
