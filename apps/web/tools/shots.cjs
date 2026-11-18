// Chụp ảnh màn hình với Agent giả. node tools/shots.cjs --label before|after [--base URL] [--only a,b] [--speed]
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const fx = require('./fixtures.cjs');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? true : process.argv[i + 1]); };
const label = arg('label', 'after'); const base = arg('base', 'http://127.0.0.1:5173'); const only = arg('only', '') ? String(arg('only')).split(',') : null;
const CONFIGS = [
  { id: '1920-dark', w: 1920, h: 1080, dpr: 1, scheme: 'dark', theme: 'dark' },
  { id: '1920-light', w: 1920, h: 1080, dpr: 1, scheme: 'light', theme: 'light' },
  { id: '1366-dark', w: 1366, h: 768, dpr: 1, scheme: 'dark', theme: 'dark' },
  { id: '1366-dpr125-light', w: 1093, h: 614, dpr: 1.25, scheme: 'light', theme: 'light' }, // 1366x768 @125% => viewport CSS 1093x614
];
const PAGES = [['overview', '/'], ['lan', '/lan'], ['topology', '/topology'], ['cameras', '/cameras'], ['inventory', '/inventory'], ['security', '/security'], ['wan', '/wan'], ['history', '/history'], ['monitor', '/monitor'], ['wifi', '/wifi'], ['speed', '/speed'], ['tools', '/tools'], ['reports', '/reports'], ['settings', '/settings']];
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-allow-private-network': 'true' };
const json = (body, status = 200) => ({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function mock(page) {
  let progress = 0; const total = 254;
  await page.route('http://127.0.0.1:47800/**', async (r) => {
    const req = r.request(); const u = new URL(req.url()); const p = u.pathname.replace('/api/v1', '');
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    if (p === '/health') return r.fulfill(json({ agentVersion: '1.0.0', protocolVersion: 1, status: 'ok', paired: true, platform: 'windows', capabilities: ['lan.scan', 'camera.discovery', 'wifi.snapshot', 'monitor.ping', 'network.interfaces', 'wan.check', 'tls.inspect', 'wol'] }));
    if (p === '/pair') return r.fulfill(json({ token: 'tok', expiresInSec: 3600 }));
    if (p === '/network/interfaces') return r.fulfill(json(fx.interfaces));
    if (p === '/scans' && req.method() === 'POST') { progress = 0; return r.fulfill(json({ scanId: 'scan1', status: 'running' }, 202)); }
    if (p.startsWith('/scans/scan1/cancel')) return r.fulfill({ status: 204, headers: cors });
    if (p.startsWith('/scans/scan1')) {
      const since = Number(u.searchParams.get('since') || 0); progress = Math.min(total, progress + 70);
      const upto = Math.floor((progress / total) * fx.devices.length); const done = progress >= total;
      return r.fulfill(json({ scanId: 'scan1', status: done ? 'completed' : 'running', processed: progress, total, devicesFound: upto, startedAt: new Date().toISOString(), completedAt: done ? new Date().toISOString() : undefined, cidr: '192.168.10.0/24', profile: 'normal', skippedSubnets: [], devices: fx.devices.slice(since, upto), nextIndex: upto }));
    }
    if (p === '/discovery/cameras') return r.fulfill(json({ jobId: 'cam1', status: 'running' }, 202));
    if (p.startsWith('/discovery/cameras/')) return r.fulfill(json({ jobId: 'cam1', status: 'completed', cameras: fx.cameras }));
    if (p.startsWith('/wifi/')) return r.fulfill(json(fx.wifi));
    if (p === '/monitor/sessions') return r.fulfill(json({ sessionId: 'mon1' }, 202));
    if (p.startsWith('/monitor/sessions/')) return r.fulfill({ status: 204, headers: cors });
    return r.fulfill(json({ code: 'NOT_MOCKED', message: p }, 404));
  });
  await page.route('https://speed.cloudflare.com/**', async (r) => {
    const u = r.request().url(); const h = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'timing-allow-origin': '*' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: h });
    if (u.includes('/meta')) return r.fulfill({ status: 200, headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ colo: 'SGN', city: 'Ho Chi Minh City', country: 'VN', asOrganization: 'VNPT', clientIp: '203.0.113.9' }) });
    const m = /bytes=(\d+)/.exec(u); const n = m ? Math.min(Number(m[1]), 2_000_000) : 0;
    await new Promise((s) => setTimeout(s, 25));
    return r.fulfill({ status: 200, headers: h, body: Buffer.alloc(n) });
  });
}

async function prep(page, id) {
  const click = async (re) => { const b = page.getByRole('button', { name: re }).first(); if (await b.count()) { await b.click().catch(() => {}); return true; } return false; };
  if (id === 'lan') { await click(/Bắt đầu quét|Start/i); await page.waitForTimeout(1800); }
  if (id === 'cameras') { await click(/Quét camera|Bắt đầu|Tìm/i); await page.waitForTimeout(1500); }
  if (id === 'wifi') { await click(/Quét mạng WiFi|Quét/i); await page.waitForTimeout(1200); }
  if (id === 'monitor') {
    await click(/Bắt đầu/i); await page.waitForTimeout(500);
    await page.evaluate(async () => {
      const { agent } = await import('/src/infrastructure/agent/client.ts');
      let t = Date.now() - 70 * 5000; let lost = 0;
      for (let i = 0; i < 70; i++) {
        const ok = !(i > 38 && i < 43); if (!ok) lost++;
        const e = { protocolVersion: 1, eventId: 'e' + i, timestamp: new Date(t).toISOString(), jobId: 'mon1', type: 'monitor.tick', data: { target: '192.168.10.1', timestamp: new Date(t).toISOString(), rttMs: ok ? 2 + Math.abs(Math.sin(i / 5)) * 6 + (i % 11 === 0 ? 14 : 0) : null, isReachable: ok, sent: i + 1, received: i + 1 - lost, lossPercent: +(lost / (i + 1) * 100).toFixed(1), downtimeSec: lost * 5 } };
        agent.listeners.forEach((l) => l(e)); t += 5000;
      }
    });
    await page.waitForTimeout(500);
  }
  if (id === 'speed' && arg('speed', false)) { await click(/Bắt đầu|Chạy|Đo/i); await page.waitForTimeout(9000); }
}

if (require.main !== module) { module.exports = { mock, CONFIGS, base }; } else (async () => {
  const outDir = path.join('screenshots', label); fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch(); const issues = [];
  for (const c of CONFIGS) {
    const ctx = await browser.newContext({ viewport: { width: c.w, height: c.h }, deviceScaleFactor: c.dpr, colorScheme: c.scheme });
    await ctx.addInitScript((t) => { try { localStorage.setItem('hachihi.theme', JSON.stringify(t)); } catch {} }, c.theme);
    const page = await ctx.newPage(); await mock(page);
    const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !/NOT_MOCKED|404|Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await page.goto(base + '/'); await page.waitForTimeout(2500);
    await page.evaluate(async () => { const { agent } = await import('/src/infrastructure/agent/client.ts'); await agent.pair('123456'); });
    // quét LAN thật (qua Agent giả) để dữ liệu được lưu vào IndexedDB như khi dùng thật
    await page.evaluate(() => { history.pushState({}, '', '/lan'); dispatchEvent(new PopStateEvent('popstate')); }); await page.waitForTimeout(1500);
    const sb = page.getByRole('button', { name: /Bắt đầu quét/i }).first(); await sb.waitFor({ timeout: 10000 }); await sb.click();
    await page.waitForFunction(() => /hoàn tất|completed|Đã lưu/i.test(document.body.innerText), null, { timeout: 15000 }).catch(() => { console.log('WAIT-TIMEOUT'); });
    await page.waitForTimeout(800);
    if (process.env.DBG) { await page.screenshot({ path: '/tmp/dbg.png' }); console.log((await page.evaluate(() => document.body.innerText)).slice(0, 900)); }
    for (const [id, route] of PAGES) {
      if (only && !only.includes(id)) continue;
      await page.evaluate((r) => { history.pushState({}, '', r); dispatchEvent(new PopStateEvent('popstate')); }, route);
      await page.waitForTimeout(900); await prep(page, id);
      const file = path.join(outDir, `${id}__${c.id}.png`);
      await page.screenshot({ path: file, fullPage: false });
      const ov = await page.evaluate(() => ({ x: document.documentElement.scrollWidth - innerWidth }));
      if (ov.x > 1) issues.push(`${id} @${c.id}: tràn ngang ${ov.x}px`);
    }
    errs.forEach((e) => issues.push(`${c.id}: console ${e.slice(0, 160)}`));
    await ctx.close();
  }
  await browser.close();
  console.log(issues.length ? 'VẤN ĐỀ:\n' + [...new Set(issues)].join('\n') : 'OK không tràn ngang / lỗi console');
})();
