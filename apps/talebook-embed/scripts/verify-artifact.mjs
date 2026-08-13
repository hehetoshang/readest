import { brotliCompressSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { TALEBOOK_EMBED_CAPABILITIES } from '../src/capabilities.ts';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const files = fs.readdirSync(dist, { recursive: true }).filter((name) => fs.statSync(path.join(dist, name)).isFile()).sort();
const allowed = /^(?:index\.html|\.vite\/manifest\.json|assets\/[A-Za-z0-9_.-]+\.(?:js|css))$/;
const forbiddenText = /(?:https?:\/\/[^\s"']*readest\.com|supabase\.co|js\.stripe\.com|app\.posthog\.com|@tauri-apps|\/api\/(?:auth|sync|send)(?:\/|["']))/i;
const forbiddenSource = /(?:^|[/\\])(?:library|account|auth|cloud|replica|sync|payment|upgrade|updater|send|rss|opds|integrations?|telemetry|assistant|reedy|gateway|src-tauri)(?:[/\\]|\.|$)|@tauri-apps|posthog|supabase|stripe|@aws-sdk|@ai-sdk|assistant-ui/i;
const badRoute = files.find((name) => !allowed.test(name));
if (badRoute) throw new Error(`Unexpected talebook-embed artifact: ${badRoute}`);

const measured = files.map((name) => {
  const data = fs.readFileSync(path.join(dist, name));
  if (/\.(?:js|css|html|json)$/.test(name) && forbiddenText.test(data.toString('utf8'))) {
    throw new Error(`Forbidden endpoint or module marker in artifact: ${name}`);
  }
  return {
    file: name,
    sha256: createHash('sha256').update(data).digest('hex'),
    raw: data.byteLength,
    gzip: gzipSync(data).byteLength,
    brotli: brotliCompressSync(data).byteLength,
  };
});
const totals = measured.reduce((sum, file) => ({
  raw: sum.raw + file.raw,
  gzip: sum.gzip + file.gzip,
  brotli: sum.brotli + file.brotli,
}), { raw: 0, gzip: 0, brotli: 0 });
const readestCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve(root, '../..'), encoding: 'utf8' }).trim();
const report = { schema: 'readest.talebook-embed.baseline.v1', readestCommit, capabilities: TALEBOOK_EMBED_CAPABILITIES, totals, files: measured };
fs.writeFileSync(path.join(dist, 'build-baseline.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
