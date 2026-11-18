import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNetwork } from '../../app/context';
import { Download, FileSpreadsheet, FileText, Printer, ClipboardList } from 'lucide-react';
import { Banner, Card, Empty, PageHeader, Segmented, Tabs } from '../../components/ui';
import { db } from '../../infrastructure/db/db';
import { exportCsv, exportXlsx, printReport, type ReportData, type ReportSection } from '../../infrastructure/export/export';
import { sevLabel } from '../../components/ui';
import { useFindings } from '../security/Security';

const KINDS = [
  ['devices', 'Thiết bị'], ['cameras', 'Camera'], ['security', 'Phát hiện bảo mật'], ['wifi', 'WiFi'], ['speed', 'Speed test'], ['assets', 'Inventory'],
] as const;
type Kind = (typeof KINDS)[number][0];

const PRESETS: { id: string; label: string; kinds: Kind[] }[] = [
  { id: 'summary', label: 'Tổng hợp', kinds: ['devices', 'security', 'speed'] }, { id: 'devices', label: 'Thiết bị & tài sản', kinds: ['devices', 'cameras', 'assets'] },
  { id: 'security', label: 'Bảo mật', kinds: ['security'] }, { id: 'perf', label: 'Hiệu năng mạng', kinds: ['wifi', 'speed'] }, { id: 'custom', label: 'Tuỳ chọn', kinds: [] },
];
const RANGES = [{ value: '1', label: '24 giờ' }, { value: '7', label: '7 ngày' }, { value: '30', label: '30 ngày' }, { value: '0', label: 'Tất cả' }] as const;

export default function Reports() {
  const { current } = useNetwork(); const { findings, devices, score } = useFindings();
  const [preset, setPreset] = useState('summary'); const [custom, setCustom] = useState<Set<Kind>>(new Set(['devices', 'security']));
  const [range, setRange] = useState<'1' | '7' | '30' | '0'>('0'); const [label, setLabel] = useState(''); const [active, setActive] = useState<string>();
  const sel = new Set<Kind>(preset === 'custom' ? custom : PRESETS.find((p) => p.id === preset)!.kinds);
  const cams = useLiveQuery(() => db.cameras.toArray(), [], []); const wifi = useLiveQuery(() => db.wifiSnapshots.orderBy('capturedAt').reverse().limit(200).toArray(), [], []);
  const speed = useLiveQuery(() => db.speedTests.orderBy('timestamp').reverse().limit(200).toArray(), [], []); const assets = useLiveQuery(() => db.assets.toArray(), [], []);
  const dt = (t?: number) => (t ? new Date(t).toLocaleString('vi-VN') : '');
  const cutoff = range === '0' ? 0 : Date.now() - Number(range) * 86400000;
  const inRange = (t?: number) => cutoff === 0 || (t ?? 0) >= cutoff;

  const build = (): ReportData => {
    const s: ReportSection[] = [];
    const dv = devices.filter((d) => inRange(d.lastSeenAt)); const cm = cams.filter((c) => inRange(c.discoveredAt)); const wf = wifi.filter((w) => inRange(w.capturedAt)).slice(0, 30); const sp = speed.filter((x) => inRange(x.timestamp)).slice(0, 30);
    if (sel.has('devices')) s.push({ heading: 'Thiết bị', note: 'Loại thiết bị, hãng và OS là suy đoán dựa trên MAC/cổng/hostname.', columns: ['IP', 'MAC', 'Hostname', 'Hãng', 'Loại', 'Trạng thái', 'Cổng mở'],
      rows: dv.map((d) => [d.ipAddress, d.macAddress, d.hostname, d.vendor, d.deviceType, d.status, d.openPorts.map((p) => p.port).join(' ')]) });
    if (sel.has('cameras')) s.push({ heading: 'Camera / NVR', note: 'Không đăng nhập hay xem stream; chỉ dựa trên bằng chứng giao thức.', columns: ['IP', 'Hãng', 'Hostname', 'Giao thức', 'Cổng', 'Tin cậy'], rows: cm.map((c) => [c.ipAddress, c.vendor, c.hostname, c.protocols.join(' '), c.servicePorts.join(' '), c.confidence]) });
    if (sel.has('security')) s.push({ heading: `Phát hiện bảo mật (điểm ${score ?? 'n/a'}/100)`, note: 'Đánh giá dựa trên luật (rule-based) trên dữ liệu quét hiện có (không lọc theo thời gian). Cổng mở là tiếp xúc, không đồng nghĩa lỗ hổng.', columns: ['Mức độ', 'IP', 'Phát hiện', 'Tin cậy', 'Bằng chứng', 'Khuyến nghị'],
      rows: findings.map((f) => [sevLabel[f.severity], f.ip, f.title, f.confidence, f.evidence.join(' | '), f.recommendation]) });
    if (sel.has('wifi')) s.push({ heading: 'WiFi snapshot', columns: ['Thời gian', 'SSID', 'RSSI dBm', 'Băng tần', 'Kênh', 'Link Mbps'], rows: wf.map((w) => [dt(w.capturedAt), w.ssid, w.rssiDbm, w.band, w.channel, `${w.rxMbps ?? ''}/${w.txMbps ?? ''}`]) });
    if (sel.has('speed')) s.push({ heading: 'Speed test', columns: ['Thời gian', 'Máy chủ', 'Độ trễ ms', 'Down Mbps', 'Up Mbps', 'Bufferbloat'], rows: sp.map((x) => [dt(x.timestamp), x.serverName, x.idleLatencyMs?.toFixed(1), x.downloadMbps?.toFixed(1), x.uploadMbps?.toFixed(1), x.bufferbloatGrade]) });
    if (sel.has('assets')) s.push({ heading: 'Device Inventory', columns: ['Tên', 'Loại', 'IP', 'MAC', 'Chủ sở hữu', 'Vị trí'], rows: assets.map((a) => [a.assetName, a.assetType, a.ipAddress, a.macAddress, a.owner, a.location]) });
    const span = RANGES.find((r) => r.value === range)!.label;
    return { title: 'Báo cáo mạng', subtitle: `${label ? label + ' · ' : ''}${current ? 'Mạng ' + current.label : 'Không có dữ liệu mạng'} · Phạm vi: ${span}`, generatedAt: new Date().toLocaleString('vi-VN'), sections: s };
  };
  const toggle = (k: Kind) => { setPreset('custom'); setCustom((p) => { const base = preset === 'custom' ? p : new Set(sel); const n = new Set(base); if (n.has(k)) n.delete(k); else n.add(k); return n; }); };
  const preview = build(); const empty = preview.sections.length === 0;
  const stamp = new Date().toISOString().slice(0, 10);
  const cur = preview.sections.find((x) => x.heading === active) ?? preview.sections[0];
  const total = preview.sections.reduce((n, x) => n + x.rows.length, 0);

  return (<>
    <PageHeader actions={<><span className="small muted">Báo cáo được tạo ngay trên máy bạn — Hachihi không tự tải lên đâu.</span><span className="spacer" />
      <button disabled={empty} onClick={() => cur && exportCsv(`hachihi-${cur.heading.split(' (')[0].toLowerCase().replace(/\s+/g, '-')}-${stamp}.csv`, cur.columns, cur.rows)}><Download size={15} />CSV{cur ? ' (mục đang xem)' : ''}</button>
      <button disabled={empty} onClick={() => void exportXlsx(`hachihi-report-${stamp}.xlsx`, build())}><FileSpreadsheet size={15} />Excel</button>
      <button className="primary" disabled={empty} onClick={() => printReport(build())}><Printer size={15} />In / Lưu PDF</button></>} />
    <div className="rp-grid">
      <aside className="card rp-opts">
        <div className="card-b col" style={{ gap: 18 }}>
          <div><div className="section-t">Loại báo cáo</div><div className="col" style={{ gap: 4 }}>{PRESETS.map((p) => <button key={p.id} className={`rp-preset ghost ${preset === p.id ? 'on' : ''}`} onClick={() => setPreset(p.id)} aria-pressed={preset === p.id}>{p.label}</button>)}</div></div>
          <div><div className="section-t">Nội dung</div><div className="col" style={{ gap: 8 }}>{KINDS.map(([k, l]) => <label key={k} className="chk"><input type="checkbox" checked={sel.has(k)} onChange={() => toggle(k)} />{l}</label>)}</div></div>
          <div><div className="section-t">Khoảng thời gian</div><Segmented label="Khoảng thời gian" value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r.value, label: r.label }))} />
            <p className="small muted" style={{ margin: '8px 0 0' }}>Áp dụng cho thiết bị (lần thấy cuối), camera, WiFi và Speed Test. Phát hiện bảo mật luôn tính trên dữ liệu hiện có.</p></div>
          <label className="f">Nhãn mạng / ghi chú (hiện trong tiêu đề)<input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} /></label>
          <p className="small muted" style={{ margin: 0 }}>PDF: chọn “Lưu thành PDF” trong hộp thoại in — hỗ trợ tiếng Việt. Dữ liệu có thể chứa IP/MAC/SSID nhạy cảm; hãy chia sẻ cẩn thận.</p>
        </div>
      </aside>
      <section className="rp-preview">
        <div className="row" style={{ marginBottom: 10 }}><b>Xem trước</b><span className="small muted">{preview.sections.length} mục · {total} dòng</span></div>
        {empty ? <Card><Empty icon={ClipboardList} title="Chưa chọn nội dung">Chọn một loại báo cáo hoặc tích ít nhất một mục ở bên trái để xem trước.</Empty></Card> : (
          <div className="paper">
            <header className="paper-h"><div><h2>{preview.title}</h2><div className="small muted">{preview.subtitle}</div></div><div className="small muted" style={{ textAlign: 'right' }}>HACHIHI Network Tool<br />{preview.generatedAt}</div></header>
            <Tabs value={cur!.heading} onChange={setActive} tabs={preview.sections.map((x) => ({ value: x.heading, label: <>{x.heading.split(' (')[0]} <span className="muted">{x.rows.length}</span></> }))} />
            {cur && <><h3>{cur.heading}</h3>{cur.note && <p className="small muted">{cur.note}</p>}
              {cur.rows.length === 0 ? <Empty icon={FileText} title="Không có dữ liệu trong phạm vi này">Thử mở rộng khoảng thời gian.</Empty> : (<>
                <div className="tablewrap"><table><thead><tr>{cur.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{cur.rows.slice(0, 12).map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{v == null ? '' : String(v)}</td>)}</tr>)}</tbody></table></div>
                {cur.rows.length > 12 && <p className="small muted" style={{ marginTop: 8 }}>… và {cur.rows.length - 12} dòng nữa trong file xuất.</p>}</>)}</>}
          </div>)}
      </section>
    </div>
    <Banner kind="info">Bản xem trước hiển thị tối đa 12 dòng mỗi mục; file PDF / Excel / CSV chứa đầy đủ dữ liệu.</Banner>
  </>);
}
void Banner;
