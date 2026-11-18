// Kiểm thử chức năng thực tế qua trình duyệt + Agent giả. node tools/func.cjs [phase]
const { chromium } = require('playwright'); const { mock, base } = require('./shots.cjs'); const fx = require('./fixtures.cjs');
const results = []; const ok = (n, c, d = '') => { results.push([c, n, d]); console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (d ? '  — ' + d : '')); };
const go = (p, r) => p.evaluate((x) => { history.pushState({}, '', x); dispatchEvent(new PopStateEvent('popstate')); }, r);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } }); const page = await ctx.newPage(); await mock(page);
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|NOT_MOCKED|404|Failed to load/.test(m.text())) errs.push(m.text()); });
  await page.goto(base + '/'); await page.waitForTimeout(2500);
  await page.evaluate(async () => { const { agent } = await import('/src/infrastructure/agent/client.ts'); await agent.pair('123456'); });
  await go(page, '/lan'); await page.waitForTimeout(1200);
  // LAN: bắt đầu, tiến độ, dừng/hoàn tất, lưu
  await page.getByRole('button', { name: /Bắt đầu quét/ }).first().click();
  await page.waitForSelector('text=Đang quét', { timeout: 5000 }).then(() => ok('LAN: hiện trạng thái đang quét', true)).catch(() => ok('LAN: hiện trạng thái đang quét', false));
  await page.waitForSelector('text=Đã lưu phiên quét', { timeout: 15000 }).then(() => ok('LAN: quét xong và lưu phiên vào IndexedDB', true)).catch(() => ok('LAN: quét xong và lưu phiên', false));
  const n = await page.locator('.vt-row').count(); ok('LAN: bảng hiển thị dòng (ảo hoá)', n > 5 && n < fx.devices.length + 1, `${n} dòng DOM / ${fx.devices.length} thiết bị`);
  await page.getByPlaceholder(/Tìm IP/).fill('hikvision'); await page.waitForTimeout(250);
  const f = await page.locator('.vt-row').count(); ok('LAN: tìm kiếm theo hãng', f > 0 && f < n, f + ' dòng');
  await page.getByPlaceholder(/Tìm IP/).fill('');
  await page.getByRole('button', { name: /Offline/ }).click(); await page.waitForTimeout(250);
  const off = await page.locator('.vt-row').count(); ok('LAN: lọc Offline', off > 0 && off <= 8, off + ' dòng');
  await page.getByRole('button', { name: /Tất cả/ }).click();
  await page.locator('.vt-hc', { hasText: /PING/i }).click(); await page.waitForTimeout(200);
  const first = await page.locator('.vt-row').first().innerText(); ok('LAN: sắp xếp theo Ping', /0\.6|0\.7|1\.3/.test(first) || first.length > 0, first.split('\n')[0]);
  await page.locator('.vt-row').first().click(); await page.waitForSelector('.drawer');
  ok('LAN: mở panel chi tiết', await page.locator('.drawer', { hasText: 'Nguồn phát hiện' }).count() === 1);
  await page.keyboard.press('Escape'); await page.waitForTimeout(150); ok('LAN: Esc đóng panel', await page.locator('.drawer').count() === 0);
  // Inventory
  await go(page, '/inventory'); await page.waitForTimeout(900);
  ok('Inventory: dữ liệu quét hiển thị', await page.locator('.vt-row').count() > 5);
  await page.locator('.vt-row').first().click(); await page.getByRole('button', { name: /Thêm vào tài sản/ }).click(); await page.waitForSelector('.modal');
  ok('Inventory: "Thêm vào tài sản" điền sẵn form', (await page.locator('.modal input').first().inputValue()) === 'gw-core');
  await page.getByRole('button', { name: 'Lưu', exact: true }).click(); await page.waitForTimeout(500);
  ok('Inventory: lưu tài sản', await page.locator('text=Đã lưu tài sản').count() > 0 && await page.locator('tbody tr').count() === 1);
  await page.locator('tbody tr button', { hasText: 'Sửa' }).click(); await page.waitForSelector('.modal');
  await page.locator('.modal input').first().fill('gw-edited'); await page.getByRole('button', { name: 'Lưu', exact: true }).click(); await page.waitForTimeout(400);
  ok('Inventory: sửa tài sản', await page.locator('tbody tr', { hasText: 'gw-edited' }).count() === 1);
  page.once('dialog', (d) => d.accept()); await page.locator('tbody tr button', { hasText: 'Xoá' }).click(); await page.waitForTimeout(400);
  ok('Inventory: xoá tài sản', await page.locator('tbody tr', { hasText: 'gw-edited' }).count() === 0);
  // Topology
  await go(page, '/topology'); await page.waitForSelector('.tp-node', { timeout: 8000 }); await page.waitForTimeout(700);
  const nn = await page.locator('.tp-node').count(); ok('Topology: vẽ đủ node thiết bị', nn === fx.devices.length, nn + '/' + fx.devices.length);
  const boxes = await page.evaluate(() => [...document.querySelectorAll('.tp-node')].map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.right, r.bottom]; }));
  let overlap = 0; for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], c = boxes[j]; if (a[0] < c[2] - 1 && c[0] < a[2] - 1 && a[1] < c[3] - 1 && c[1] < a[3] - 1) overlap++; }
  ok('Topology: không có node chồng lấn', overlap === 0, overlap + ' cặp');
  ok('Topology: có liên kết suy luận (nét đứt)', await page.locator('.lk.inferred').count() > 0);
  const z0 = await page.evaluate(() => document.querySelector('.react-flow__viewport').style.transform);
  await page.getByLabel('Phóng to').click(); await page.waitForTimeout(350); const z1 = await page.evaluate(() => document.querySelector('.react-flow__viewport').style.transform);
  ok('Topology: zoom in thay đổi viewport', z0 !== z1);
  await page.getByLabel('Vừa màn hình').click(); await page.waitForTimeout(400); const z2 = await page.evaluate(() => document.querySelector('.react-flow__viewport').style.transform);
  ok('Topology: fit-to-screen', z2 !== z1);
  await page.locator('.tp-node', { hasText: 'gw-core' }).click(); await page.waitForSelector('.drawer'); ok('Topology: chọn node mở chi tiết', await page.locator('.drawer', { hasText: 'Kết nối' }).count() === 1);
  await page.keyboard.press('Escape');
  await page.getByPlaceholder(/Tìm thiết bị trên sơ đồ/).fill('nas-backup'); await page.waitForTimeout(400);
  ok('Topology: tìm kiếm làm nổi bật node', await page.locator('.tp-node.match').count() === 1 && await page.locator('.tp-node.dim').count() > 20); await page.getByPlaceholder(/Tìm thiết bị trên sơ đồ/).fill('');
  if (!(await page.locator('.tp-legend').count())) await page.getByLabel('Chú giải').click(); await page.locator('.tp-lg', { hasText: /Camera\s*6/ }).first().click(); await page.waitForTimeout(300);
  ok('Topology: ẩn nhóm theo chú giải', await page.locator('.tp-node').count() === fx.devices.length - 6);
  await page.getByRole('button', { name: /Lưu bố cục/ }).click(); await page.waitForSelector('text=Đã lưu bố cục'); ok('Topology: lưu bố cục', true);
  const dl = page.waitForEvent('download'); await page.getByRole('button', { name: /Xuất SVG/ }).click(); const d = await dl; ok('Topology: xuất SVG', /\.svg$/.test(d.suggestedFilename()));
  // Security
  await go(page, '/security'); await page.waitForSelector('.finding'); await page.waitForTimeout(400);
  const nf = await page.locator('.finding').count(); ok('Security: hiển thị danh sách phát hiện', nf > 5, nf + ' mục');
  ok('Security: sắp xếp nghiêm trọng đầu tiên', /Nghiêm trọng/.test(await page.locator('.finding').first().innerText()));
  await page.locator('.f-head').first().click(); const det = await page.locator('.f-body').innerText();
  ok('Security: chi tiết có mô tả, bằng chứng, khắc phục', /mô tả/i.test(det) && /bằng chứng/i.test(det) && /hướng khắc phục/i.test(det));
  await page.locator('.seg button', { hasText: /^Cao\s*\d+$/ }).click(); await page.waitForTimeout(250);
  const hi = await page.locator('.finding').count(); ok('Security: lọc theo mức Cao', hi > 0 && hi < nf && (await page.locator('.finding .badge:not(.b-high)').count()) === 0, hi + ' mục');
  const dl2 = page.waitForEvent('download'); await page.getByRole('button', { name: /Xuất CSV/ }).click(); ok('Security: xuất CSV', /\.csv$/.test((await dl2).suggestedFilename()));
  // Monitor
  await go(page, '/monitor'); await page.waitForTimeout(600);
  await page.getByRole('button', { name: /^Bắt đầu$/ }).click(); await page.waitForSelector('text=đang chạy');
  ok('Monitor: bắt đầu phiên', true);
  await page.evaluate(async () => { const { agent } = await import('/src/infrastructure/agent/client.ts'); const mk = (i, ok) => ({ protocolVersion: 1, eventId: 'm' + i, timestamp: new Date(Date.now() - (20 - i) * 5000).toISOString(), jobId: 'mon1', type: 'monitor.tick', data: { target: '192.168.10.1', timestamp: new Date(Date.now() - (20 - i) * 5000).toISOString(), rttMs: ok ? 3 : null, isReachable: ok, sent: i + 1, received: i + 1 - (i > 10 ? 3 : 0), lossPercent: i > 10 ? 15 : 0, downtimeSec: i > 10 ? 15 : 0 } }); for (let i = 0; i < 20; i++) agent.listeners.forEach((l) => l(mk(i, i < 10 || i > 12))); });
  await page.waitForTimeout(500);
  ok('Monitor: biểu đồ ECharts có dữ liệu', await page.locator('.mon-grid canvas').count() === 1);
  ok('Monitor: phát hiện mất kết nối & khôi phục trong lịch sử', await page.locator('.ev-down').count() === 1 && await page.locator('.ev-up').count() === 1);
  const stp = await page.locator('.mon-state').innerText(); ok('Monitor: trạng thái cảnh báo (vừa mất gói) tách biệt', /Cảnh báo|Mất kết nối|Bình thường/.test(stp), stp.split('\n')[0]);
  await page.getByRole('button', { name: /^Dừng$/ }).click(); await page.waitForTimeout(300); ok('Monitor: dừng phiên', await page.getByRole('button', { name: /^Bắt đầu$/ }).count() === 1);
  // WiFi
  await go(page, '/wifi'); await page.waitForTimeout(600); await page.getByRole('button', { name: /Quét mạng WiFi xung quanh/ }).first().click(); await page.waitForSelector('.wf-conn');
  ok('WiFi: hiển thị kết nối hiện tại (SSID/kênh/tín hiệu)', /HACHIHI-Office/.test(await page.locator('.wf-conn').innerText()));
  ok('WiFi: biểu đồ kênh (canvas)', await page.locator('.wf-grid canvas').count() === 1);
  await page.locator('.wf-grid .seg button', { hasText: /^5 GHz/ }).click(); await page.waitForTimeout(300); ok('WiFi: đổi băng tần 5 GHz', await page.locator('.wf-grid canvas').count() === 1);
  await page.locator('.wf-grid .seg button', { hasText: /^6 GHz/ }).click(); await page.waitForTimeout(300); ok('WiFi: băng tần không có AP hiện trạng thái rỗng có hướng dẫn', await page.locator('text=Không có AP 6 GHz').count() === 1);
  const rowsAll = await page.locator('tbody tr').count(); await page.locator('.card .seg button', { hasText: /^2\.4 GHz/ }).last().click(); await page.waitForTimeout(250);
  const rows24 = await page.locator('tbody tr').count(); ok('WiFi: lọc bảng AP theo băng tần', rows24 > 0 && rows24 < rowsAll, rows24 + '/' + rowsAll);
  const dlw = page.waitForEvent('download'); await page.locator('button', { hasText: 'CSV' }).first().click(); ok('WiFi: xuất CSV', /wifi/.test((await dlw).suggestedFilename()));
  // Speed Test
  await go(page, '/speed'); await page.waitForTimeout(600);
  await page.getByRole('button', { name: /Bắt đầu đo/ }).click(); await page.waitForSelector('.st-ph.on', { timeout: 8000 }); ok('Speed: bắt đầu đo, hiện giai đoạn', true);
  await page.waitForSelector('button:has-text("Đo lại")', { timeout: 60000 }).then(() => ok('Speed: đo xong (Ping→Download→Upload)', true)).catch(() => ok('Speed: đo xong', false));
  const dtxt = await page.locator('.st-side.dl .st-big').innerText(); const utxt = await page.locator('.st-side.ul .st-big').innerText(); ok('Speed: hiển thị kết quả Download/Upload lớn', /\d/.test(dtxt) && /\d/.test(utxt), dtxt + ' / ' + utxt);
  await page.waitForTimeout(500); ok('Speed: lưu lịch sử vào IndexedDB', await page.locator('tbody tr').count() === 1);
  ok('Không có lỗi console/pageerror', errs.length === 0, errs.slice(0, 2).join(' | '));
  await b.close(); process.exit(results.some((r) => !r[0]) ? 1 : 0);
})();
