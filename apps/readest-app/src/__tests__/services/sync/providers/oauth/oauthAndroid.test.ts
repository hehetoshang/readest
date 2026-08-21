import { describe, expect, test, vi } from 'vitest';

import { runAndroidOAuth } from '@/services/sync/providers/oauth/oauthAndroid';
import type { FetchFn } from '@/services/sync/providers/oauth/tokenEndpoint';
import type { OAuthClientConfig } from '@/services/sync/providers/oauth/oauthFlow';

const CONFIG: OAuthClientConfig = {
  clientId: 'cid.apps.googleusercontent.com',
  scope: 'drive.file',
  authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  redirectUri: 'com.googleusercontent.apps.cid:/oauthredirect',
  redirectScheme: 'com.googleusercontent.apps.cid',
};

describe('runAndroidOAuth in Moke', () => {
  test('stays disabled while Readest account and cloud sync are removed', () => {
    const fetchFn = vi.fn() as unknown as FetchFn;

    expect(() => runAndroidOAuth(CONFIG, fetchFn)).toThrow('runAndroidOAuth is disabled in Moke');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
