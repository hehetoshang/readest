import { describe, expect, test, vi } from 'vitest';

import { runIosOAuth } from '@/services/sync/providers/oauth/oauthIos';
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

describe('runIosOAuth in Moke', () => {
  test('stays disabled while Readest account and cloud sync are removed', () => {
    const fetchFn = vi.fn() as unknown as FetchFn;

    expect(() => runIosOAuth(CONFIG, fetchFn)).toThrow('runIosOAuth is disabled in Moke');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
