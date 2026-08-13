import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const forbiddenModule =
  /(?:^|[/\\])(?:library|account|auth|cloud|replica|sync|payment|upgrade|updater|send|rss|opds|integrations?|telemetry|assistant|reedy|gateway|src-tauri)(?:[/\\]|\.|$)|@tauri-apps|posthog|supabase|stripe|@aws-sdk|@ai-sdk|assistant-ui/i;

export default defineConfig({
  base: '/static/readest/talebook-embed/',
  plugins: [
    react(),
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
