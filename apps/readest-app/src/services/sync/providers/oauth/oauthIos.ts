/**
 * iOS wiring of the OAuth authorization-code + PKCE flow: an
 * `ASWebAuthenticationSession` + reverse-DNS custom-scheme redirect.
 *
 * Like Android, iOS can't use a loopback redirect, so we use the reverse-DNS
 * scheme the iOS-type Google client issues —
 * `com.googleusercontent.apps.<id>:/oauthredirect` — registered in
 * `Info-ios.plist` `CFBundleURLTypes` so the OS routes the redirect back.
 *
 * Consent opens in an `ASWebAuthenticationSession` via Readest's native bridge
 * command `auth_with_safari` (the same one the Supabase login uses). That session
 * intercepts the redirect by its `callbackURLScheme` — so unlike the desktop
 * deep-link runner, no app-wide URL listener is needed: the native command opens
 * consent AND resolves with the redirect URL in one round trip. The callback
 * scheme is the bare reverse-DNS scheme derived from the client id (no path),
 * which is exactly what `ASWebAuthenticationSession` matches on.
 *
 * The iOS-type client has NO secret — Google validates the redirect by
 * string-matching the client-id-derived scheme, and PKCE is the real client
 * authentication. This holds only while App Check (iOS attestation) is off.
 *
 * Adapted from ratatabananana-bit/Readest-google-drive-mod-patcher (AGPL-3.0),
 * used with the author's explicit permission.
 */
// Moke embedded reader: this iOS OAuth flow is disabled along with the
// cloud-sync feature set. The native auth helper import was removed with the
// account system, and the flow helpers are unused now that the body is stubbed.
// import { authWithSafari } from '@/app/auth/utils/nativeAuth';
// import { createPkcePair } from './pkce';
// import { runOAuthFlow } from './oauthFlow';
// import { exchangeCode } from './tokenEndpoint';
import type { OAuthClientConfig } from './oauthFlow';
import type { FetchFn, TokenSet } from './tokenEndpoint';

/**
 * Moke embedded reader: the iOS `ASWebAuthenticationSession` OAuth flow is
 * disabled along with the rest of the cloud-sync feature set (its native auth
 * helper was removed with the account system). The export is kept so the
 * (also-disabled) OneDrive/Drive connectors still type-check; it throws if ever
 * invoked.
 */
export const runIosOAuth = (_config: OAuthClientConfig, _fetchFn: FetchFn): Promise<TokenSet> => {
  throw new Error('runIosOAuth is disabled in Moke (cloud sync removed)');
};
