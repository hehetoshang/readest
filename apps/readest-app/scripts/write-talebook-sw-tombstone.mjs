import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const outputPath = fileURLToPath(new URL('../../../out/readest/sw.js', import.meta.url));
const tombstone = `// Remove the root-scoped service worker shipped by older Talebook embeds.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.filter((name) => name.startsWith('serwist-')).map((name) => caches.delete(name)));
    await self.registration.unregister();
    const windows = await clients.matchAll({ type: 'window' });
    await Promise.all(windows.map((client) => client.navigate(client.url)));
  })());
});
`;

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, tombstone, 'utf8');
