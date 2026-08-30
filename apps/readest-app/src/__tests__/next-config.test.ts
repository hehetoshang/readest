import { describe, expect, test } from 'vitest';
import nextConfig from '../../next.config.mjs';
import packageJson from '../../package.json';

describe('Moke reader build', () => {
  test('uses webpack so production tree shaking keeps the startup bundle small', () => {
    expect(packageJson.scripts['build:moke-reader']).toContain('next build --webpack');
  });

  test('configures webpack aliases with the compiler build context', () => {
    const applyWebpackConfig = nextConfig.webpack as unknown as (
      config: { resolve: { alias: Record<string, unknown> } },
      context: { isServer: boolean },
    ) => unknown;
    const config = { resolve: { alias: {} } };

    expect(() => applyWebpackConfig(config, { isServer: false })).not.toThrow();
  });
});

describe('Next.js static asset headers', () => {
  test('keeps bundled workers cross-origin isolated', async () => {
    const rules = ((await nextConfig.headers?.()) ?? []) as Array<{
      source: string;
      headers: Array<{ key: string; value: string }>;
    }>;
    const staticRule = rules.find((rule) => rule.source === '/_next/static/:path*');

    expect(staticRule?.headers).toContainEqual({
      key: 'Cross-Origin-Embedder-Policy',
      value: 'require-corp',
    });
  });
});
