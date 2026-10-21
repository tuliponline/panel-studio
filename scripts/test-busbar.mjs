/**
 * Terminal busbar verification — desktop + 412×915
 */
import { chromium, devices } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
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

async function main() {
  const { srv, url } = await serve();
  const browser = await chromium.launch();
  try {
    // —— Desktop ——
    const desk = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await desk.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });

    // Catalog category exists
    const catBtn = page.locator('#cat-filter button', { hasText: /Busbar|บาร์กราวด์/ });
    pass('catalog category Busbar', (await catBtn.count()) > 0);
    await catBtn.first().click();
    const part = page.locator('.part[data-type="terminal-bar"]');
    pass('catalog item terminal-bar', (await part.count()) === 1);
    await page.screenshot({ path: join(out, 'busbar-catalog.png'), fullPage: false });

    // Click to place
    await part.click();
    await page.waitForTimeout(200);
    const barCount = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('panel-studio-v1'));
      return (raw?.AC?.devices || []).filter((d) => d.type === 'terminal-bar').length;
    });
    pass('place bar on plate', barCount >= 1, `count=${barCount}`);
    await page.screenshot({ path: join(out, 'busbar-desktop-placed.png') });

    // Selected → bar props
    const barProps = page.locator('#bar-props');
    pass('bar props visible', await barProps.isVisible());
    const holes = await page.locator('#bar-holes').inputValue();
    pass('default 8 holes', holes === '8', `holes=${holes}`);

    // Increase holes
    await page.locator('#bar-holes-plus').click();
    await page.locator('#bar-holes-plus').click();
    const holes10 = await page.locator('#bar-holes').inputValue();
    pass('holes +/- to 10', holes10 === '10', `holes=${holes10}`);

    // Role PE → green
    await page.locator('#bar-role').selectOption('PE');
    await page.waitForTimeout(100);
    const role = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('panel-studio-v1'));
      const d = (raw?.AC?.devices || []).find((x) => x.type === 'terminal-bar');
      return d && { role: d.role, rating: d.rating, label: d.label };
    });
    pass('role PE', role?.role === 'PE', JSON.stringify(role));

    // Rotate vertical
    await page.locator('#bar-rotate').click();
    await page.waitForTimeout(100);
    const orient = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('panel-studio-v1'));
      const d = (raw?.AC?.devices || []).find((x) => x.type === 'terminal-bar');
      return d?.orient;
    });
    pass('rotate to vertical', orient === 'v', `orient=${orient}`);
    await page.screenshot({ path: join(out, 'busbar-desktop-vertical-pe.png') });

    // Back to horizontal N, 8 holes
    await page.locator('#bar-rotate').click();
    await page.locator('#bar-role').selectOption('N');
    await page.locator('#bar-presets button', { hasText: '8' }).click();
    await page.waitForTimeout(100);

    // Wire tool: connect MCB port → bar high port (index 7)
    await page.locator('#cat-filter button', { hasText: 'ทั้งหมด' }).click();
    const mcb = page.locator('.part[data-type="dz47-1p"], .part[data-type="MCB"], .part[data-type="mcb-1p"]').first();
    if ((await mcb.count()) > 0) await mcb.click();
    await page.locator('#wire').click();
    await page.waitForTimeout(150);

    const wireOk = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('panel-studio-v1'));
      const ac = raw.AC;
      const bar = ac.devices.find((d) => d.type === 'terminal-bar');
      const other = ac.devices.find((d) => d.type !== 'terminal-bar');
      if (!bar || !other) return { ok: false, reason: 'missing devices' };
      return { ok: true, barId: bar.id, otherId: other.id, holes: bar.holes };
    });
    pass('devices ready for wire', !!wireOk.ok, JSON.stringify(wireOk));

    const otherTerm = page.locator(`#board circle.terminal[data-dev="${wireOk.otherId}"]`).first();
    const barTerm = page.locator(`#board circle.terminal[data-dev="${wireOk.barId}"][data-port="7"]`);
    const a = await otherTerm.boundingBox();
    const b = await barTerm.boundingBox();
    if (a && b) {
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 16 });
      await page.mouse.up();
      await page.waitForTimeout(250);
    }
    const wcount = await page.locator('#wcount').textContent();
    pass('wire to bar terminal', Number(wcount) >= 1, `wcount=${wcount}`);
    await page.screenshot({ path: join(out, 'busbar-desktop-wired.png') });

    // Shrink holes with connected high port → confirm dialog
    await page.locator('#move').click();
    // Select via device-hit handler (avoids wire/terminal overlays stealing the click)
    await page.evaluate(() => {
      const hit = document.querySelector('g.device.tbar rect.device-hit');
      const board = document.getElementById('board');
      if (!hit || !board) return;
      const opts = { bubbles: true, cancelable: true, pointerId: 1, clientX: 40, clientY: 40, pointerType: 'mouse', buttons: 1 };
      hit.dispatchEvent(new PointerEvent('pointerdown', opts));
      board.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }));
    });
    await page.waitForTimeout(200);
    let dialogSeen = false;
    page.once('dialog', async (d) => {
      dialogSeen = true;
      pass('warn on remove connected hole', /สาย/.test(d.message()), d.message());
      await d.dismiss();
    });
    const propsVisible = await page.locator('#bar-props').isVisible();
    if (propsVisible) {
      await page.locator('#bar-presets button[title="4 จุด"]').click();
      await page.waitForTimeout(400);
      if (!dialogSeen) pass('warn on remove connected hole', false, 'no dialog');
    } else {
      pass('warn on remove connected hole', false, 'bar props not selected');
    }

    // Undo/redo buttons enabled after edits
    const undoEnabled = await page.locator('#undo').isEnabled();
    pass('undo available', undoEnabled);

    // BOM mentions bar
    const bom = await page.locator('#bom').textContent();
    pass('BOM lists terminal bar', /บาร์|Terminal/i.test(bom || ''), bom);

    // Save/load roundtrip
    const json = await page.evaluate(() => localStorage.getItem('panel-studio-v1'));
    const parsed = JSON.parse(json);
    pass('save has terminal-bar fields', !!(parsed.AC.devices.find((d) => d.type === 'terminal-bar')?.holes), JSON.stringify(parsed.AC.devices.find((d) => d.type === 'terminal-bar')));
    await page.evaluate((data) => localStorage.setItem('panel-studio-v1', data), json);
    await page.reload({ waitUntil: 'networkidle' });
    const after = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('panel-studio-v1'));
      return (raw?.AC?.devices || []).find((d) => d.type === 'terminal-bar');
    });
    pass('load restores bar', !!(after && after.holes && after.role), JSON.stringify(after));
    await page.screenshot({ path: join(out, 'busbar-desktop-reloaded.png') });

    await desk.close();

    // —— Mobile 412×915 ——
    const mob = await browser.newContext({
      ...devices['iPhone 12 Pro'],
      viewport: { width: 412, height: 915 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true
    });
    const mpage = await mob.newPage();
    await mpage.goto(url, { waitUntil: 'networkidle' });
    await mpage.evaluate(() => localStorage.clear());
    await mpage.reload({ waitUntil: 'networkidle' });

    // Open catalog tab / sheet
    await mpage.locator('.mobile-tabs button[data-tab="catalog"]').click();
    await mpage.waitForTimeout(200);
    await mpage.locator('#cat-filter button', { hasText: /Busbar|บาร์กราวด์/ }).first().click();
    await mpage.screenshot({ path: join(out, 'busbar-mobile-sheet.png') });
    const mpart = mpage.locator('.part[data-type="terminal-bar"]');
    pass('mobile catalog shows bar', (await mpart.count()) === 1);

    // Short tap adds (addDevice keeps selection; catalog handler switches to board)
    await mpart.tap();
    await mpage.waitForTimeout(400);
    const mBars = await mpage.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('panel-studio-v1'));
      return (raw?.AC?.devices || []).filter((d) => d.type === 'terminal-bar').length;
    });
    pass('mobile tap places bar', mBars >= 1, `count=${mBars}`);
    await mpage.locator('.mobile-tabs button[data-tab="board"]').click();
    await mpage.waitForTimeout(200);
    await mpage.screenshot({ path: join(out, 'busbar-mobile-board.png') });

    // Select bar then open details tab
    await mpage.evaluate(() => {
      const hit = document.querySelector('g.device.tbar rect.device-hit');
      const board = document.getElementById('board');
      if (!hit || !board) return;
      const opts = { bubbles: true, cancelable: true, pointerId: 1, clientX: 40, clientY: 40, pointerType: 'touch', buttons: 1 };
      hit.dispatchEvent(new PointerEvent('pointerdown', opts));
      board.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }));
    });
    await mpage.waitForTimeout(150);
    await mpage.locator('.mobile-tabs button[data-tab="props"]').click();
    await mpage.waitForTimeout(250);
    const mProps = await mpage.locator('#bar-props').isVisible().catch(() => false);
    pass('mobile props bar panel', mProps);
    await mpage.screenshot({ path: join(out, 'busbar-mobile-props.png') });

    await mob.close();
  } finally {
    await browser.close();
    srv.close();
  }

  const failed = results.filter((r) => !r.ok);
  const summary = { total: results.length, passed: results.length - failed.length, failed: failed.length, results };
  const { writeFileSync } = await import('fs');
  writeFileSync(join(out, 'busbar-test-results.json'), JSON.stringify(summary, null, 2));
  writeFileSync(
    join(out, 'busbar-verification-notes.md'),
    `# Terminal busbar verification\n\nBranch: \`cursor/real-scale-responsive-panel-b61f\`\n\n| Check | Result | Detail |\n|-------|--------|--------|\n` +
      results.map((r) => `| ${r.name} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.detail || '—'} |`).join('\n') +
      `\n\nDesktop + mobile (412×915) screenshots under \`/opt/cursor/artifacts/busbar-*.png\`.\n`
  );
  console.log('\n' + JSON.stringify(summary, null, 2));
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
