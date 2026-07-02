import withSerwistInit from '@serwist/next';
import withBundleAnalyzer from '@next/bundle-analyzer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = process.env['NODE_ENV'] === 'development';
const appPlatform = process.env['NEXT_PUBLIC_APP_PLATFORM'];

if (isDev) {
  const { initOpenNextCloudflareForDev } = await import('@opennextjs/cloudflare');
  initOpenNextCloudflareForDev();
}

// Allow an embedded host (Moke) to override basePath in dev so readest's
// assets are served under a distinct prefix (e.g. /readest/) and don't
// collide with the host's own /_next/static/... assets.
const embeddedBasePath = process.env['NEXT_PUBLIC_EMBEDDED_BASE_PATH'];
const exportOutput = appPlatform !== 'web' && !isDev;
// Opt-in standalone output, set only by the Docker production build
// (Dockerfile). Every other path keeps the original behavior: Tauri `export`,
// local `build-web` (output undefined), dev, and the Cloudflare/OpenNext
// deploy — which forces standalone itself via NEXT_PRIVATE_STANDALONE.
const standaloneOutput = !exportOutput && process.env['BUILD_STANDALONE'] === 'true';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ensure Next.js uses SSG instead of SSR
  // https://nextjs.org/docs/pages/building-your-application/deploying/static-exports
  // The Docker production image opts into a self-contained `.next/standalone`
  // tree (see Dockerfile) so it can ship only the traced runtime; all other
  // web builds fall back to the default server output.
  output: exportOutput ? 'export' : standaloneOutput ? 'standalone' : undefined,
  // When building for Tauri (exportOutput), output directly into the parent
  // project's out/readest/ so a single frontendDist="../out" covers both apps.
  distDir: exportOutput ? '../../out/readest' : '.next',
  // Serve all readest pages under /readest/* when embedded in the parent app.
  // In standalone/dev mode we omit basePath to keep the original behaviour,
  // unless an embedded host overrides it via NEXT_PUBLIC_EMBEDDED_BASE_PATH.
  basePath: exportOutput ? '/readest' : (embeddedBasePath || ''),
  // Monorepo: trace from the repo root so workspace packages land in the
  // standalone tree. Only relevant to — and only set for — the Docker build.
  outputFileTracingRoot: standaloneOutput ? path.join(__dirname, '../../') : undefined,
  pageExtensions: exportOutput ? ['jsx', 'tsx'] : ['js', 'jsx', 'ts', 'tsx'],
  // Note: This feature is required to use the Next.js Image component in SSG mode.
  // See https://nextjs.org/docs/messages/export-image-api for different workarounds.
  images: {
    unoptimized: true,
  },
  devIndicators: false,
  // The Tauri static export drops server-only code: `pageExtensions` below
  // limits routes to .jsx/.tsx, so the `api/**/route.ts` handlers are excluded
  // from the export. But `next build` still type-checks (and lints) the whole
  // project, including those excluded server routes — which reference web-only
  // stubs (e.g. the native `supabase` stub has no `.rpc`). Skip the *blocking*
  // type/lint gate for the export build only; the web build and CI stay strict.
  typescript: {
    ignoreBuildErrors: exportOutput,
  },
  eslint: {
    ignoreDuringBuilds: exportOutput,
  },
  experimental: {
    turbopackFileSystemCacheForDev: true,
    turbopackFileSystemCacheForBuild: true,
    turbopackMemoryLimit: 8192, // MB — use more RAM for fewer GC pauses
  },
  // Configure assetPrefix or else the server won't properly resolve your assets.
  assetPrefix: '',
  reactStrictMode: true,
  serverExternalPackages: ['isows'],
  allowedDevOrigins: ['127.0.0.1', 'localhost', '192.168.2.120'],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      nunjucks: 'nunjucks/browser/nunjucks.js',
      // `js-mdict` is consumed as TS source via tsconfig paths from
      // `packages/js-mdict/src/`; its sources `import 'fflate'` directly.
      // Without an alias, webpack walks up from that source location and
      // can't find fflate (only installed in this app's node_modules).
      fflate: path.resolve(__dirname, 'node_modules/fflate'),
      ...(appPlatform !== 'web' ? { '@tursodatabase/database-wasm': false } : {}),
    };
    return config;
  },
  turbopack: {
    resolveAlias: {
      nunjucks: 'nunjucks/browser/nunjucks.js',
      // Turbopack rejects absolute paths in resolveAlias ("server relative
      // imports not implemented") — use a project-relative path.
      fflate: './node_modules/fflate',
      ...(appPlatform !== 'web' ? { '@tursodatabase/database-wasm': './src/utils/stub.ts' } : {}),
    },
  },
  transpilePackages: [
    'ai',
    'ai-sdk-ollama',
    '@ai-sdk/react',
    '@assistant-ui/react',
    '@assistant-ui/react-ai-sdk',
    '@assistant-ui/react-markdown',
    'streamdown',
    ...(isDev
      ? []
      : [
          'i18next-browser-languagedetector',
          'react-i18next',
          'i18next',
          '@tauri-apps',
          'highlight.js',
          'foliate-js',
          'marked',
        ]),
  ],
  async rewrites() {
    return [
      {
        source: '/reader/:ids',
        destination: '/reader?ids=:ids',
      },
      {
        source: '/o/book/:hash/annotation/:id',
        destination: '/o?book=:hash&note=:id',
      },
      {
        source: '/s/:token',
        destination: '/s?token=:token',
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/.well-known/apple-app-site-association',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/json',
          },
        ],
      },
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: isDev
              ? 'public, max-age=0, must-revalidate'
              : 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
};

const pwaDisabled = isDev || appPlatform !== 'web';

const withPWA = pwaDisabled
  ? (config) => config
  : withSerwistInit({
      swSrc: 'src/sw.ts',
      swDest: 'public/sw.js',
      cacheOnNavigation: true,
      reloadOnOnline: true,
      disable: false,
      register: true,
      scope: '/',
    });

const withAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

export default withPWA(withAnalyzer(nextConfig));
