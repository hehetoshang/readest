import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const forbiddenModule =
  /(?:^|[/\\])(?:library|account|auth|cloud|replica|sync|payment|upgrade|updater|send|rss|opds|integrations?|telemetry|assistant|reedy|gateway|src-tauri)(?:[/\\]|\.|$)|@tauri-apps|posthog|supabase|stripe|@aws-sdk|@ai-sdk|assistant-ui/i;

export default defineConfig({
  base: '/static/readest/talebook-embed/',
  plugins: [
    react(),
    {
      name: 'talebook-embed-epub-only-view',
      enforce: 'pre',
      transform(code, id) {
        if (!/[\\/]foliate-js[\\/]view\.js$/.test(id)) return null;
        const start = code.indexOf('export const makeBook = async file => {');
        const end = code.indexOf('\nclass CursorAutohider', start);
        if (start < 0 || end < 0) throw new Error('Unable to isolate foliate-js EPUB view');
        const epubOnly =
          "export const makeBook = async () => { throw new UnsupportedTypeError('Talebook embed accepts initialized EPUB books only') }\n";
        const epubView = `${code.slice(0, start)}${epubOnly}${code.slice(end + 1)}`.replace(
          "const { TTS } = await import('./tts.js')",
          "throw new Error('Disabled embed capability')",
        );
        return { code: epubView, map: null };
      },
    },
    {
      name: 'talebook-embed-forbidden-imports',
      enforce: 'pre',
      resolveId(source, importer) {
        if (forbiddenModule.test(source)) {
          throw new Error(
            `Forbidden talebook-embed import: ${source} from ${importer ?? '<entry>'}`,
          );
        }
        return null;
      },
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    manifest: true,
    sourcemap: false,
    target: 'es2022',
  },
});
