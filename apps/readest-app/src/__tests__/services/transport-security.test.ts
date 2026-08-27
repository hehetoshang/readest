import { describe, expect, it } from 'vitest';
import {
  allowsInvalidCertificate,
  buildSecureRedirectRequest,
  isCleartextHttpUrl,
  nativeDangerFor,
} from '@/services/transportSecurity';

describe('transportSecurity', () => {
  it('defaults to strict certificate and hostname verification', () => {
    expect(nativeDangerFor('https://books.example.com/feed')).toEqual({
      acceptInvalidCerts: false,
      acceptInvalidHostnames: false,
    });
  });

  it('allows an invalid certificate only on the explicitly approved origin', () => {
    const policy = {
      serverUrl: 'https://books.example.com/opds',
      allowInvalidCertificate: true,
    };
    expect(allowsInvalidCertificate('https://books.example.com/feed', policy)).toBe(true);
    expect(allowsInvalidCertificate('https://books.example.com:8443/feed', policy)).toBe(false);
    expect(allowsInvalidCertificate('https://cdn.example.com/book.epub', policy)).toBe(false);
    expect(nativeDangerFor('https://books.example.com/feed', policy)).toEqual({
      acceptInvalidCerts: true,
      acceptInvalidHostnames: false,
    });
  });

  it('identifies cleartext HTTP connections', () => {
    expect(isCleartextHttpUrl('http://192.168.1.5:8080/opds')).toBe(true);
    expect(isCleartextHttpUrl('https://books.example.com/opds')).toBe(false);
  });

  it('strips credentials and custom headers on cross-origin redirects', () => {
    const next = buildSecureRedirectRequest(
      'https://books.example.com/feed',
      302,
      'https://login.example.net/feed',
      {
        headers: {
          Authorization: 'Basic secret',
          Cookie: 'session=secret',
          'X-Api-Key': 'secret',
          Accept: 'application/atom+xml',
        },
      },
    );
    const headers = new Headers(next?.options.headers);
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('x-api-key')).toBeNull();
    expect(headers.get('accept')).toBe('application/atom+xml');
  });

  it('rejects hostname-independent HTTPS downgrade and body replay', () => {
    expect(() =>
      buildSecureRedirectRequest(
        'https://books.example.com/feed',
        302,
        'http://books.example.com/feed',
      ),
    ).toThrow('redirect.downgrade_blocked');

    expect(() =>
      buildSecureRedirectRequest(
        'https://books.example.com/login',
        307,
        'https://other.example.com/login',
        { method: 'POST', body: 'password=secret' },
      ),
    ).toThrow('redirect.cross_origin_body_blocked');
  });
});
