/**
 * Android wiring of the OAuth authorization-code + PKCE flow: a Chrome Custom Tab
 * + reverse-DNS custom-scheme redirect.
 *
 * Android can't use a loopback redirect (the system browser can't hand a
 * `http://127.0.0.1` back to the app). Instead we use the reverse-DNS scheme an
 * iOS-type Google client issues — `com.googleusercontent.apps.<id>:/oauthredirect`
 * — registered as a BROWSABLE deep-link intent-filter so the OS routes the
 * redirect back to the app.
 *
 * Consent opens in a CHROME CUSTOM TAB via Readest's native bridge command
 * `auth_with_custom_tab` (the same one the Supabase login uses), NOT an external
 * browser: a separate browser app backgrounds the single Tauri Activity and the
 * OS can destroy it under memory pressure, tearing down the in-flight promise +
 * redirect listener (observed on-device: first attempt fails, second succeeds). A
 * Custom Tab renders inside the host task and keeps the process at foreground
 * importance; the redirect resolves through a native field that survives a WebView
 * reload. The native command opens consent AND resolves with the redirect URL in
 * one round trip, recognising it by the reverse-DNS scheme parsed from the auth
 * URL's `redirect_uri`.
 *
 * The iOS-type client has NO secret and needs NO Android SHA-1 — Google validates
 * the redirect by string-matching the client-id-derived scheme, and PKCE is the
 * real client authentication. This holds only while App Check (iOS attestation)
 * is off — an Android device can't produce an iOS attestation, so enabling it
 * would break every user; keep it off.
 *
 * Adapted from ratatabananana-bit/Readest-google-drive-mod-patcher (AGPL-3.0),
 * used with the author's explicit permission.
 */
// Moke embedded reader: this Android OAuth flow is disabled along with the
// cloud-sync feature set. The native auth helper import was removed with the
// account system, and the flow helpers are unused now that the body is stubbed.
// import { authWithCustomTab } from '@/app/auth/utils/nativeAuth';
// import { createPkcePair } from './pkce';
// import { runOAuthFlow } from './oauthFlow';
// import { exchangeCode } from './tokenEndpoint';
import type { OAuthClientConfig } from './oauthFlow';
import type { FetchFn, TokenSet } from './tokenEndpoint';

/**
 * Moke embedded reader: the Android Custom-Tab OAuth flow is disabled along
 * with the rest of the cloud-sync feature set (its native auth helper was
 * removed with the account system). The export is kept so the (also-disabled)
 * OneDrive/Drive connectors still type-check; it throws if ever invoked.
 */
export const runAndroidOAuth = (_config: OAuthClientConfig, _fetchFn: FetchFn): Promise<TokenSet> => {
  throw new Error('runAndroidOAuth is disabled in Moke (cloud sync removed)');
};
