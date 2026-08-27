const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CROSS_ORIGIN_SAFE_HEADERS = new Set([
  'accept',
  'accept-encoding',
  'accept-language',
  'cache-control',
  'if-modified-since',
  'if-none-match',
  'range',
  'user-agent',
]);

export const MAX_SECURE_REDIRECTS = 5;

export interface InvalidCertificatePolicy {
  serverUrl?: string;
  allowInvalidCertificate?: boolean;
}

export const normalizeHttpOrigin = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // OPDS supports legacy credentials in the URL; URL.origin deliberately
    // excludes them while retaining the server identity used for scoping.
    return url.origin;
  } catch {
    return null;
  }
};

export const isCleartextHttpUrl = (value: string): boolean =>
  normalizeHttpOrigin(value)?.startsWith('http://') ?? false;

/** Invalid-certificate grants match only the configured HTTPS server origin. */
export const allowsInvalidCertificate = (
  requestUrl: string,
  policy: InvalidCertificatePolicy = {},
): boolean => {
  if (!policy.allowInvalidCertificate) return false;
  const requestOrigin = normalizeHttpOrigin(requestUrl);
  const approvedOrigin = policy.serverUrl ? normalizeHttpOrigin(policy.serverUrl) : null;
  return (
    !!requestOrigin && requestOrigin.startsWith('https://') && requestOrigin === approvedOrigin
  );
};

export const nativeDangerFor = (
  requestUrl: string,
  policy: InvalidCertificatePolicy = {},
): { acceptInvalidCerts: boolean; acceptInvalidHostnames: false } => ({
  acceptInvalidCerts: allowsInvalidCertificate(requestUrl, policy),
  // A self-signed certificate grant never authorizes the wrong hostname.
  acceptInvalidHostnames: false,
});

export interface SecureRedirectRequest {
  url: string;
  options: RequestInit;
}

const stripCrossOriginHeaders = (headers: Headers): Headers => {
  const safe = new Headers();
  headers.forEach((value, name) => {
    if (CROSS_ORIGIN_SAFE_HEADERS.has(name.toLowerCase())) safe.set(name, value);
  });
  return safe;
};

/** Build a redirect hop without forwarding credentials or certificate grants. */
export const buildSecureRedirectRequest = (
  currentUrl: string,
  status: number,
  location: string | null,
  options: RequestInit = {},
): SecureRedirectRequest | null => {
  if (!REDIRECT_STATUSES.has(status) || !location) return null;
  const current = new URL(currentUrl);
  const target = new URL(location, current);
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error('redirect.protocol_blocked');
  }
  if (target.username || target.password) throw new Error('redirect.credentials_blocked');
  if (current.protocol === 'https:' && target.protocol === 'http:') {
    throw new Error('redirect.downgrade_blocked');
  }

  const method = (options.method || 'GET').toUpperCase();
  const nextMethod =
    status === 303 && method !== 'HEAD'
      ? 'GET'
      : (status === 301 || status === 302) && method === 'POST'
        ? 'GET'
        : method;
  const crossOrigin = current.origin !== target.origin;
  if (crossOrigin && nextMethod !== 'GET' && nextMethod !== 'HEAD' && options.body != null) {
    throw new Error('redirect.cross_origin_body_blocked');
  }

  let headers = new Headers(options.headers);
  if (crossOrigin) headers = stripCrossOriginHeaders(headers);
  if (nextMethod === 'GET' || nextMethod === 'HEAD') {
    headers.delete('content-length');
    headers.delete('content-type');
  }

  return {
    url: target.toString(),
    options: {
      ...options,
      method: nextMethod,
      headers,
      body: nextMethod === 'GET' || nextMethod === 'HEAD' ? undefined : options.body,
    },
  };
};
