import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourceRoot = path.join(root, 'src');
const forbidden = /(?:^|[/\\])(?:library|account|auth|cloud|replica|sync|payment|upgrade|updater|send|rss|opds|integrations?|telemetry|assistant|reedy|gateway|src-tauri)(?:[/\\]|\.|$)|@tauri-apps|posthog|supabase|stripe|@aws-sdk|@ai-sdk|assistant-ui/i;
const importPattern = /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.css'];
const queue = [path.join(sourceRoot, 'main.tsx')];
const visited = new Set();
const edges = [];

while (queue.length) {
  const file = queue.shift();
  if (visited.has(file)) continue;
  visited.add(file);
  const content = fs.readFileSync(file, 'utf8');
  for (const match of content.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];
    edges.push([path.relative(root, file), specifier]);
    if (forbidden.test(specifier)) {
      throw new Error(`Forbidden import edge: ${path.relative(root, file)} -> ${specifier}`);
    }
    if (!specifier.startsWith('.')) continue;
    const base = path.resolve(path.dirname(file), specifier);
    const resolved = extensions.map((extension) => `${base}${extension}`).find(fs.existsSync);
    if (!resolved || !resolved.startsWith(sourceRoot)) {
      throw new Error(`Unresolved local import: ${path.relative(root, file)} -> ${specifier}`);
    }
    if (!resolved.endsWith('.css')) queue.push(resolved);
  }
}

console.log(JSON.stringify({ entry: 'src/main.tsx', modules: [...visited].map((file) => path.relative(root, file)).sort(), edges }, null, 2));
