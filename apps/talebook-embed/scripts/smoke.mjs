import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const epub = path.resolve(root, '../readest-app/src/__tests__/fixtures/data/sample-alice.epub');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/api/book/1/reader-bootstrap') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({
      err: 'ok', schema: 'talebook.reader.bootstrap.v1', engine: 'readest',
      book: { id: 1, title: 'TB-36 smoke EPUB', format: 'epub', revision: 'smoke' },
      resource: { kind: 'authorized-epub-url', url: '/read/resource/1.epub', mime: 'application/epub+zip', range: true },
      navigation: { back: '/book/1', fallback: '/read/1?reader=candle' }, capabilities: {},
    }));
    return;
  }
  if (url.pathname === '/read/resource/1.epub') {
    response.setHeader('Content-Type', 'application/epub+zip');
    response.setHeader('Content-Length', statSync(epub).size);
    createReadStream(epub).pipe(response);
    return;
  }
  const relative = url.pathname.replace(/^\/static\/readest\/talebook-embed\/?/, '') || 'index.html';
  const file = path.join(root, 'dist', relative);
  try {
    response.setHeader('Content-Type', mime[path.extname(file)] ?? 'application/octet-stream');
    response.end(readFileSync(file));
  } catch {
    response.statusCode = 404;
    response.end();
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/static/readest/talebook-embed/index.html?book=1`);
  try {
    await page.locator('foliate-paginator').waitFor({ state: 'attached', timeout: 15_000 });
  } catch (error) {
    throw new Error(JSON.stringify({ body: await page.locator('body').innerText(), errors }), { cause: error });
  }
  await page.getByRole('button', { name: 'Next page' }).click();
  const back = await page.getByRole('link', { name: 'Back to book' }).getAttribute('href');
  const fallback = await page.getByRole('link', { name: 'Open with Candle' }).getAttribute('href');
  if (back !== '/book/1' || fallback !== '/read/1?reader=candle' || errors.length) {
    throw new Error(JSON.stringify({ back, fallback, errors }));
  }
  console.log(JSON.stringify({ title: await page.title(), renderer: 'foliate-paginator', back, fallback, errors }, null, 2));
} finally {
  await browser.close();
  server.close();
}
