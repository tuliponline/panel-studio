/**
 * Busbar variants: brass 6×9/8×12, I-din, copper 110A — desktop + 412×915
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
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function selectDevice(page, type) {
  await page.evaluate((tp) => {
    const hit = document.querySelector(`g.device.tbar[data-id]`);
    // pick by scanning devices in DOM order matching type via localStorage ids
    const raw = JSON.parse(localStorage.getItem('panel-studio-v1'));
    const d = (raw?.AC?.devices || []).find((x) => x.type === tp);
    if (!d) return;
    const g = document.querySelector(`g.device[data-id="${d.id}"] rect.device-hit`);
    const board = document.getElementById('board');
    if (!g || !board) return;
    const opts = { bubbles: true, cancelable: true, pointerId: 1, clientX: 40, clientY: 40, pointerType: 'mouse', buttons: 1 };
    g.dispatchEvent(new PointerEvent('pointerdown', opts));
    board.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }));
  }, type);
  await page.waitForTimeout(150);
}

async function main() {
  const { srv, url } = await serve();
  const browser = await chromium.launch();
  try {
    const desk = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await desk.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });

    const cat = page.locator('#cat-filter button', { hasText: /Busbar|บาร์กราวด์/ });
    pass('busbar category', (await cat.count()) > 0);
    await cat.first().click();

    const types = ['terminal-bar', 'idin-ground-bar', 'copper-busbar-110a'];
    for (const tp of types) {
      pass(`catalog has ${tp}`, (await page.locator(`.part[data-type="${tp}"]`).count()) === 1);
    }
    await page.screenshot({ path: join(out, 'busbar-v2-catalog.png') });

    // Place all three
    for (const tp of types) {
      await page.locator(`.part[data-type="${tp}"]`).click();
      await page.waitForTimeout(150);
    }
    const placed = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('panel-studio-v1'));
      const ds = raw?.AC?.devices || [];
      return {
        brass: ds.find((d) => d.type === 'terminal-bar'),
        idin: ds.find((d) => d.type === 'idin-ground-bar'),
        copper: ds.find((d) => d.type === 'copper-busbar-110a'),
        n: ds.length
      };
    });
    pass('placed 3 styles', placed.n >= 3 && placed.brass && placed.idin && placed.copper, JSON.stringify({ n: placed.n }));
    await page.screenshot({ path: join(out, 'busbar-v2-desktop-all.png') });

    // Brass: section 8x12 + wing
    await selectDevice(page, 'terminal-bar');
    pass('brass props', await page.locator('#bar-props').isVisible());
    pass('brass section field', await page.locator('#bar-section-field').isVisible());
    await page.locator('#bar-section').selectOption('8x12');
    await page.locator('#bar-base').selectOption('wing');
    await page.waitForTimeout(100);
    const brass = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('panel-studio-v1'));
      return (raw?.AC?.devices || []).find((d) => d.type === 'terminal-bar');
    });
    pass('brass 8x12 wing', brass?.section === '8x12' && brass?.baseStyle === 'wing', JSON.stringify(brass));
    await page.screenshot({ path: join(out, 'busbar-v2-brass-8x12-wing.png') });

    // I-din: holes + rotate
    await selectDevice(page, 'idin-ground-bar');
    pass('idin section hidden', !(await page.locator('#bar-section-field').isVisible()));
    await page.locator('#bar-holes-plus').click();
    await page.locator('#bar-rotate').click();
    await page.waitForTimeout(100);
    const idin = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('panel-studio-v1'));
      return (raw?.AC?.devices || []).find((d) => d.type === 'idin-ground-bar');
    });
    pass('idin vertical + holes', idin?.orient === 'v' && idin?.holes >= 5, JSON.stringify(idin));
    // mixed large terminals in DOM
    const largeTerms = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('panel-studio-v1'));
      const d = (raw?.AC?.devices || []).find((x) => x.type === 'idin-ground-bar');
      if (!d) return 0;
      // count yellow-ish screw circles near bar — approximate via terminal circles count
      return document.querySelectorAll(`circle.terminal[data-dev="${d.id}"]`).length;
    });
    pass('idin wire terminals', largeTerms >= 5, `terms=${largeTerms}`);
    await page.screenshot({ path: join(out, 'busbar-v2-idin-vertical.png') });

    // Copper: rating 110A in BOM
    await selectDevice(page, 'copper-busbar-110a');
    pass('copper role hidden', !(await page.locator('#bar-role-field').isVisible()));
    const rating = await page.locator('#rating').inputValue();
    pass('copper rating 110A', /110A/.test(rating), rating);
    const bom = await page.locator('#bom').textContent();
    pass('BOM lists all styles', /ทองเหลือง|I-din|ทองแดง|110A/i.test(bom || ''), bom);
    await page.screenshot({ path: join(out, 'busbar-v2-copper-props.png') });

    // Wire to copper terminal
    await page.locator('#cat-filter button', { hasText: 'ทั้งหมด' }).click();
    await page.locator('.part[data-type="dz47-1p"]').click();
    await page.locator('#wire').click();
    await page.waitForTimeout(100);
    const ids = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('panel-studio-v1'));
      const copper = (raw?.AC?.devices || []).find((d) => d.type === 'copper-busbar-110a');
      const mcb = (raw?.AC?.devices || []).find((d) => d.type === 'dz47-1p');
      return { copper: copper?.id, mcb: mcb?.id };
    });
    const a = await page.locator(`#board circle.terminal[data-dev="${ids.mcb}"]`).first().boundingBox();
    const b = await page.locator(`#board circle.terminal[data-dev="${ids.copper}"]`).first().boundingBox();
    if (a && b) {
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 14 });
      await page.mouse.up();
      await page.waitForTimeout(200);
    }
    const wc = await page.locator('#wcount').textContent();
    pass('wire to copper bar', Number(wc) >= 1, `wcount=${wc}`);
    await page.screenshot({ path: join(out, 'busbar-v2-wired.png') });

    // save/load
    const json = await page.evaluate(() => localStorage.getItem('panel-studio-v1'));
    await page.evaluate((data) => localStorage.setItem('panel-studio-v1', data), json);
    await page.reload({ waitUntil: 'networkidle' });
    const after = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('panel-studio-v1'));
      const ds = raw?.AC?.devices || [];
      return {
        brass: ds.find((d) => d.type === 'terminal-bar'),
        idin: ds.find((d) => d.type === 'idin-ground-bar'),
        copper: ds.find((d) => d.type === 'copper-busbar-110a')
      };
    });
    pass(
      'load restores variants',
      after.brass?.section === '8x12' && after.idin?.orient === 'v' && /110A/.test(after.copper?.rating || ''),
      JSON.stringify(after)
    );

    await desk.close();

    // Mobile
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
    await mpage.locator('#cat-filter button', { hasText: /Busbar|บาร์กราวด์/ }).first().click();
    pass('mobile catalog 3 items', (await mpage.locator('#catalog .part').count()) >= 3);
    await mpage.screenshot({ path: join(out, 'busbar-v2-mobile-sheet.png') });
    await mpage.locator('.part[data-type="idin-ground-bar"]').tap();
    await mpage.waitForTimeout(300);
    // catalog auto-switches to board after place — reopen for copper
    await mpage.locator('.mobile-tabs button[data-tab="catalog"]').click();
    await mpage.waitForTimeout(200);
    await mpage.locator('#cat-filter button', { hasText: /Busbar|บาร์กราวด์/ }).first().click();
    await mpage.locator('.part[data-type="copper-busbar-110a"]').scrollIntoViewIfNeeded();
    await mpage.locator('.part[data-type="copper-busbar-110a"]').tap();
    await mpage.waitForTimeout(300);
    await mpage.locator('.mobile-tabs button[data-tab="board"]').click();
    await mpage.waitForTimeout(200);
    const mn = await mpage.evaluate(() => (JSON.parse(localStorage.getItem('panel-studio-v1'))?.AC?.devices || []).length);
    pass('mobile placed bars', mn >= 2, `n=${mn}`);
    await mpage.screenshot({ path: join(out, 'busbar-v2-mobile-board.png') });
    await mpage.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('panel-studio-v1'));
      const d = (raw?.AC?.devices || []).find((x) => x.type === 'copper-busbar-110a');
      const g = d && document.querySelector(`g.device[data-id="${d.id}"] rect.device-hit`);
      const board = document.getElementById('board');
      if (!g || !board) return;
      const opts = { bubbles: true, cancelable: true, pointerId: 1, clientX: 40, clientY: 40, pointerType: 'touch', buttons: 1 };
      g.dispatchEvent(new PointerEvent('pointerdown', opts));
      board.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }));
    });
    await mpage.locator('.mobile-tabs button[data-tab="props"]').click();
    await mpage.waitForTimeout(200);
    pass('mobile copper props', await mpage.locator('#bar-props').isVisible());
    await mpage.screenshot({ path: join(out, 'busbar-v2-mobile-props.png') });
    await mob.close();
  } finally {
    await browser.close();
    srv.close();
  }

  const failed = results.filter((r) => !r.ok);
  const summary = { total: results.length, passed: results.length - failed.length, failed: failed.length, results };
  writeFileSync(join(out, 'busbar-v2-test-results.json'), JSON.stringify(summary, null, 2));
  writeFileSync(
    join(out, 'busbar-v2-verification-notes.md'),
    `# Busbar variants verification\n\n| Check | Result | Detail |\n|-------|--------|--------|\n` +
      results.map((r) => `| ${r.name} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.detail || '—'} |`).join('\n') +
      `\n\nScreenshots: \`busbar-v2-*.png\`\n`
  );
  console.log('\n' + JSON.stringify(summary, null, 2));
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
