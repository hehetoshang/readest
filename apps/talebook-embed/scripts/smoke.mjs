import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { chromium, firefox, webkit } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const epub = path.resolve(root, '../readest-app/src/__tests__/fixtures/data/sample-alice.epub');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/api/book/1/reader-bootstrap') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({
      err: 'ok', schema: 'talebook.reader.bootstrap.v1', engine: 'readest',
      book: { id: 1, title: 'TB-38 smoke EPUB', format: 'epub', revision: 'smoke-v1' },
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
const browserType = { chromium, firefox, webkit }[process.env.BROWSER ?? 'chromium'];
if (!browserType) throw new Error(`Unsupported browser: ${process.env.BROWSER}`);
const browser = await browserType.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  const readerUrl = `${origin}/static/readest/talebook-embed/index.html?book=1`;
  await page.goto(readerUrl);
  try {
    await page.locator('foliate-paginator').waitFor({ state: 'attached', timeout: 15_000 });
  } catch (error) {
    throw new Error(JSON.stringify({ body: await page.locator('body').innerText(), errors }), { cause: error });
  }

  await page.getByRole('button', { name: 'Next page' }).click();
  await page.getByRole('button', { name: 'Contents' }).click();
  const tocCount = await page.locator('.toc-list button').count();
  if (tocCount < 1) throw new Error('EPUB table of contents was not rendered');
  await page.locator('.panel-header button').click();

  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByPlaceholder('Search book text').fill('Alice');
  await page.locator('.search-panel form').getByRole('button', { name: 'Search' }).click();
  await page.locator('.search-panel ol li').first().waitFor({ timeout: 15_000 });
  const searchCount = await page.locator('.search-panel ol li').count();
  await page.locator('.panel-header button').click();

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Reading mode').selectOption('scrolled');
  await page.getByLabel('Theme').selectOption('dark');
  await page.getByLabel('Interface language').selectOption('zh-CN');
  const storedSettings = await page.evaluate(() => localStorage.getItem('readest.talebook-embed.settings.v1'));
  await page.reload();
  await page.locator('foliate-paginator[flow="scrolled"]').waitFor({ timeout: 15_000 });
  const restoredLanguage = await page.locator('html').getAttribute('lang');
  const restoredTheme = await page.locator('html').getAttribute('data-theme');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByLabel('阅读模式').waitFor();
  if ((process.env.BROWSER ?? 'chromium') === 'chromium') {
    await page.screenshot({ path: path.join(root, 'talebook-embed-smoke.png') });
  }
  await page.locator('.panel-header button').click();

  const hash = new URL(page.url()).hash;
  const position = await page.evaluate(() => localStorage.getItem('readest.talebook-embed.position.v1.1'));
  const back = await page.getByRole('link', { name: '返回书籍页' }).getAttribute('href');
  const fallback = await page.getByRole('link', { name: '改用 Candle' }).getAttribute('href');
  if (
    back !== '/book/1' || fallback !== '/read/1?reader=candle' || !storedSettings || !position ||
    !hash.startsWith('#loc=epubcfi') || restoredLanguage !== 'zh-CN' || restoredTheme !== 'dark' || errors.length
  ) {
    throw new Error(JSON.stringify({ back, fallback, hash, storedSettings, position, restoredLanguage, restoredTheme, errors }));
  }
  console.log(JSON.stringify({ browser: process.env.BROWSER ?? 'chromium', title: await page.title(), renderer: 'foliate-view/paginator', tocCount, searchCount, flow: 'scrolled', mobileSettings: true, restoredLanguage, restoredTheme, deepLink: hash.slice(0, 32), back, fallback, errors }, null, 2));
} finally {
  await browser.close();
  server.close();
}
