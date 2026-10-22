/**
 * BOM panel: devices by category, wire length, lugs — desktop + 412×915
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
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });

    pass('bom panel exists', await page.locator('#bom-panel').isVisible());
    pass('slack default 100', (await page.locator('#wire-slack').inputValue()) === '100');

    // Place devices: breaker + brass bar + copper bar
    await page.locator('#cat-filter button', { hasText: 'ทั้งหมด' }).click().catch(() => {});
    await page.locator('.part[data-type="dz47-1p"]').click();
    await page.waitForTimeout(80);
    await page.locator('#cat-filter button').filter({ hasText: 'บาร์กราวด์-นิวตรอล' }).click();
    await page.locator('.part[data-type="terminal-bar"]').click();
    await page.waitForTimeout(80);
    await page.locator('.part[data-type="copper-busbar-110a"]').click();
    await page.waitForTimeout(120);

    // Wire MCB → brass, MCB → copper
    await page.locator('#wire').click();
    const ids = await page.evaluate(() => {
      const ds = JSON.parse(localStorage.getItem('panel-studio-v1')).AC.devices;
      return {
        mcb: ds.find((d) => d.type === 'dz47-1p')?.id,
        brass: ds.find((d) => d.type === 'terminal-bar')?.id,
        copper: ds.find((d) => d.type === 'copper-busbar-110a')?.id
      };
    });

    async function dragWire(fromSel, toSel) {
      const a = await page.locator(fromSel).first().boundingBox();
      const b = await page.locator(toSel).first().boundingBox();
      if (!a || !b) return false;
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(150);
      return true;
    }

    await dragWire(`#board circle.terminal[data-dev="${ids.mcb}"]`, `#board circle.terminal[data-dev="${ids.brass}"]`);
    await dragWire(`#board circle.terminal[data-dev="${ids.mcb}"]`, `#board circle.terminal[data-dev="${ids.copper}"]`);

    const wcount = Number(await page.locator('#wcount').textContent());
    pass('wires drawn', wcount >= 2, `wcount=${wcount}`);

    // Devices grouped
    const devHtml = await page.locator('#bom-devices').innerHTML();
    pass('devices by category', /ป้องกัน|Busbar|บาร์/.test(devHtml) && /DZ47|บาร์/.test(devHtml), devHtml.slice(0, 120));
    pass('devices block visible', await page.locator('#bom-devices').isVisible());

    // Wire length
    const wireHtml = await page.locator('#bom-wires').innerHTML();
    pass('wire length section', /มม²/.test(wireHtml) && /ม\./.test(wireHtml), wireHtml.slice(0, 160));
    const totalLen = await page.locator('#wire-len-total').textContent();
    pass('total length metres', /^\d+(\.\d)? ม\.$/.test(totalLen || ''), totalLen);

    // Change slack → length updates
    const before = totalLen;
    await page.locator('#wire-slack').fill('200');
    await page.locator('#wire-slack').dispatchEvent('change');
    await page.waitForTimeout(100);
    const after = await page.locator('#wire-len-total').textContent();
    pass('slack affects length', after !== before || /200/.test(await page.locator('#bom-wires').innerText()), `${before} → ${after}`);

    // Lugs
    const lugHtml = await page.locator('#bom-lugs').innerHTML();
    pass('ferrule present', /หางปลาเข็ม|Ferrule/.test(lugHtml), lugHtml.slice(0, 100));
    pass('ring lug present', /หางปลากลม|M[456]/.test(lugHtml), lugHtml.slice(0, 120));
    await page.screenshot({ path: join(out, 'bom-desktop-summary.png') });

    // Export BOM
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#bom-export').click()]);
    const dlPath = join(out, await dl.suggestedFilename());
    await dl.saveAs(dlPath);
    const txt = readFileSync(dlPath, 'utf8');
    pass('export has Thai sections', /อุปกรณ์|สายไฟ|หางปลา/.test(txt), txt.slice(0, 200));
    pass('export has metres', /\d+(\.\d)? ม/.test(txt));

    // Print button opens window (may be blocked — just ensure click doesn't throw)
    await page.locator('#bom-print').click();
    await page.waitForTimeout(200);
    pass('print button clickable', true);

    await page.screenshot({ path: join(out, 'bom-desktop-wires-lugs.png'), fullPage: false });

    // Scroll props panel for full BOM shot
    await page.locator('#summary-panel').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(100);
    await page.screenshot({ path: join(out, 'bom-desktop-panel.png') });

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
    // reuse desktop localStorage? fresh — place minimal
    await mpage.evaluate(() => localStorage.clear());
    await mpage.reload({ waitUntil: 'networkidle' });
    await mpage.locator('.mobile-tabs button[data-tab="catalog"]').click();
    await mpage.waitForTimeout(150);
    await mpage.locator('.part[data-type="dz47-1p"]').tap();
    await mpage.waitForTimeout(200);
    await mpage.locator('.mobile-tabs button[data-tab="catalog"]').click();
    await mpage.waitForTimeout(100);
    await mpage.locator('#cat-filter button').filter({ hasText: 'บาร์กราวด์-นิวตรอล' }).tap();
    await mpage.locator('.part[data-type="terminal-bar"]').tap();
    await mpage.waitForTimeout(200);
    await mpage.locator('.mobile-tabs button[data-tab="props"]').click();
    await mpage.waitForTimeout(200);
    pass('mobile bom panel', await mpage.locator('#summary-panel').isVisible());
    await mpage.locator('#summary-panel').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await mpage.screenshot({ path: join(out, 'bom-mobile-summary.png') });
    const mDev = await mpage.locator('#bom-devices').isVisible().catch(() => false);
    pass('mobile devices bom', mDev);
    await mob.close();
  } finally {
    await browser.close();
    srv.close();
  }

  const failed = results.filter((r) => !r.ok);
  const summary = { total: results.length, passed: results.length - failed.length, failed: failed.length, results };
  writeFileSync(join(out, 'bom-test-results.json'), JSON.stringify(summary, null, 2));
  writeFileSync(
    join(out, 'bom-verification-notes.md'),
    `# BOM panel verification\n\n| Check | Result | Detail |\n|-------|--------|--------|\n` +
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
