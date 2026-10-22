/**
 * Named designs: save / my designs / new / export-import — desktop + 412×915
 */
import { chromium, devices } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const root = join(fileURLToPath(import.meta.url), '..', '..', 'dist');
const out = '/opt/cursor/artifacts';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serve() {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      let p = join(root, (req.url || '/').split('?')[0].replace(/^\//, '') || 'index.html');
      if (!existsSync(p)) {
        res.writeHead(404);
        res.end('missing');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'text/plain' });
      res.end(readFileSync(p));
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}/` }));
  });
}

const results = [];
function pass(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  const { srv, url } = await serve();
  const browser = await chromium.launch();
  try {
    const desk = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await desk.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.reload({ waitUntil: 'networkidle' });

    pass('design badge visible', await page.locator('#design-badge').isVisible());
    pass('default name', (await page.locator('#design-name').textContent()) === 'แบบใหม่');

    // Place a device so draft is dirty after edit
    await page.locator('#cat-filter button', { hasText: 'ทั้งหมด' }).click().catch(() => {});
    await page.locator('.part[data-type="dz47-1p"]').click();
    await page.waitForTimeout(150);
    pass('dirty after edit', await page.locator('#design-badge').evaluate((el) => el.classList.contains('dirty')));
    await page.screenshot({ path: join(out, 'designs-desktop-dirty.png') });

    // Save with name via prompt
    page.once('dialog', async (d) => {
      pass('save prompts name', d.type() === 'prompt', d.message());
      await d.accept('ตู้บ้าน A');
    });
    await page.locator('#save').click();
    await page.waitForTimeout(200);
    pass('name after save', (await page.locator('#design-name').textContent()) === 'ตู้บ้าน A');
    pass('clean after save', !(await page.locator('#design-badge').evaluate((el) => el.classList.contains('dirty'))));

    const lib = await page.evaluate(() => JSON.parse(localStorage.getItem('panel-studio-designs-v1')));
    pass('library has design', lib?.designs?.length >= 1 && lib.designs[0].name === 'ตู้บ้าน A', JSON.stringify(lib?.designs?.[0]?.name));

    // Edit → dirty again
    await page.locator('.part[data-type="terminal-bar"]').click();
    await page.waitForTimeout(100);
    pass('dirty after second edit', await page.locator('#design-badge').evaluate((el) => el.classList.contains('dirty')));

    // Save again (same name)
    page.once('dialog', async (d) => {
      await d.accept('ตู้บ้าน A');
    });
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(200);
    pass('ctrl+s save', !(await page.locator('#design-badge').evaluate((el) => el.classList.contains('dirty'))));

    // My designs modal
    await page.locator('#designs-open').click();
    await page.waitForTimeout(150);
    pass('modal open', await page.locator('#designs-modal').evaluate((el) => el.classList.contains('show')));
    pass('list shows design', (await page.locator('.design-item').count()) >= 1);
    await page.screenshot({ path: join(out, 'designs-desktop-modal.png') });

    // Duplicate
    page.once('dialog', async (d) => {
      await d.accept('ตู้บ้าน A (สำเนา)');
    });
    await page.locator('.design-item .actions button', { hasText: 'สำเนา' }).first().click();
    await page.waitForTimeout(150);
    pass('duplicate', (await page.locator('.design-item').count()) >= 2);

    // Rename
    page.once('dialog', async (d) => {
      await d.accept('ตู้สำนักงาน');
    });
    await page.locator('.design-item .actions button', { hasText: 'ชื่อ' }).first().click();
    await page.waitForTimeout(100);
    const names = await page.locator('.design-item strong').allTextContents();
    pass('rename', names.some((n) => n.includes('ตู้สำนักงาน')), names.join(', '));

    // New design
    await page.locator('#designs-close').click();
    page.once('dialog', async (d) => {
      // may ask discard if dirty — currently clean
      if (d.type() === 'confirm') await d.accept();
      else await d.dismiss();
    });
    await page.locator('#design-new').click();
    await page.waitForTimeout(150);
    pass('new design name', (await page.locator('#design-name').textContent()) === 'แบบใหม่');
    const count = await page.locator('#count').textContent();
    pass('new design empty', count === '0', `count=${count}`);

    // Open from list
    await page.locator('#designs-open').click();
    await page.waitForTimeout(100);
    await page.locator('.design-item .actions button', { hasText: 'เปิด' }).first().click();
    await page.waitForTimeout(200);
    pass('open design', Number(await page.locator('#count').textContent()) >= 1);
    await page.screenshot({ path: join(out, 'designs-desktop-opened.png') });

    // Export JSON
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#export-json').click()
    ]);
    const dlPath = join(out, await download.suggestedFilename());
    await download.saveAs(dlPath);
    const exported = JSON.parse(readFileSync(dlPath, 'utf8'));
    pass('export wrapper', exported.format === 'panel-studio-design' && !!exported.data, exported.name);

    // Delete with confirm
    await page.locator('#designs-open').click();
    await page.waitForTimeout(100);
    const before = await page.locator('.design-item').count();
    page.once('dialog', async (d) => {
      pass('delete confirm', d.type() === 'confirm', d.message());
      await d.accept();
    });
    await page.locator('.design-item .actions button', { hasText: 'ลบ' }).first().click();
    await page.waitForTimeout(150);
    pass('deleted', (await page.locator('.design-item').count()) === before - 1, `${before}→`);

    // Import exported file
    await page.locator('#designs-close').click().catch(() => {});
    await page.locator('#design-new').click();
    await page.waitForTimeout(100);
    await page.locator('#file').setInputFiles(dlPath);
    await page.waitForTimeout(250);
    pass('import restores', Number(await page.locator('#count').textContent()) >= 1);
    pass('import name', /ตู้|แบบ/.test((await page.locator('#design-name').textContent()) || ''), await page.locator('#design-name').textContent());
    await page.screenshot({ path: join(out, 'designs-desktop-imported.png') });

    await desk.close();

    // Mobile 412×915
    const mob = await browser.newContext({
      ...devices['iPhone 12 Pro'],
      viewport: { width: 412, height: 915 },
      isMobile: true,
      hasTouch: true
    });
    const mpage = await mob.newPage();
    await mpage.goto(url, { waitUntil: 'networkidle' });
    await mpage.evaluate(() => localStorage.clear());
    await mpage.reload({ waitUntil: 'networkidle' });

    await mpage.locator('.mobile-tabs button[data-tab="catalog"]').click();
    await mpage.waitForTimeout(200);
    pass('mobile sheet designs section', await mpage.locator('#designs-sheet-section').isVisible());
    await mpage.screenshot({ path: join(out, 'designs-mobile-sheet.png') });

    await mpage.locator('.part[data-type="dz47-1p"]').tap();
    await mpage.waitForTimeout(250);
    await mpage.locator('.mobile-tabs button[data-tab="catalog"]').click();
    await mpage.waitForTimeout(150);
    mpage.once('dialog', async (d) => {
      await d.accept('มือถือ 1');
    });
    await mpage.locator('#save-sheet').tap();
    await mpage.waitForTimeout(200);
    pass('mobile save', (await mpage.locator('#design-name').textContent()) === 'มือถือ 1');

    await mpage.locator('#designs-open-sheet').tap();
    await mpage.waitForTimeout(200);
    pass('mobile modal', await mpage.locator('#designs-modal').evaluate((el) => el.classList.contains('show')));
    await mpage.screenshot({ path: join(out, 'designs-mobile-modal.png') });
    await mpage.locator('#designs-close').tap();
    await mob.close();
  } finally {
    await browser.close();
    srv.close();
  }

  const failed = results.filter((r) => !r.ok);
  const summary = { total: results.length, passed: results.length - failed.length, failed: failed.length, results };
  writeFileSync(join(out, 'designs-test-results.json'), JSON.stringify(summary, null, 2));
  writeFileSync(
    join(out, 'designs-verification-notes.md'),
    `# Named designs verification\n\n| Check | Result | Detail |\n|-------|--------|--------|\n` +
      results.map((r) => `| ${r.name} | ${r.ok ? 'PASS' : 'FAIL'} | ${(r.detail || '—').replace(/\|/g, '/')} |`).join('\n') +
      `\n`
  );
  console.log('\n' + JSON.stringify(summary, null, 2));
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
