import { useEffect, useMemo, useState } from 'react';
import { useAgent } from '../../app/context';
import { RequireAgent } from '../../components/AgentGate';
import { Play, Square, Radar, ChevronDown, Download } from 'lucide-react';
import { Badge, Banner, Card, Empty, PageHeader, ProgressBar } from '../../components/ui';
import { DeviceTable } from '../devices/DeviceTable';
import { useNetData } from '../../app/data';
import { AgentError, type AgentInterface } from '../../infrastructure/agent/client';
import { exportCsv, exportJson, exportXlsx } from '../../infrastructure/export/export';
import { parseCidr } from '../../core/domain/cidr';
import { cancelScan, isScanActive, startScan, useScanState } from './scanStore';

const PROFILES = {
  fast: 'Fast — dò nhanh, ít cổng', normal: 'Normal — dò + tên máy + cổng phổ biến', deep: 'Deep — thêm mDNS/SSDP/NetBIOS, nhiều cổng hơn',
} as const;
const STATUS_VI: Record<string, { t: string; k: string }> = {
  idle: { t: 'Sẵn sàng', k: 'mute' }, queued: { t: 'Đang chờ', k: 'accent' }, running: { t: 'Đang quét', k: 'accent' }, cancelling: { t: 'Đang dừng', k: 'warn' },
  completed: { t: 'Hoàn tất', k: 'ok' }, cancelled: { t: 'Đã dừng', k: 'warn' }, failed: { t: 'Thất bại', k: 'bad' },
};

export default function LanScanner() {
  return <RequireAgent capability="lan.scan" feature="LAN Scanner"><Body /></RequireAgent>;
}

function useTick(on: boolean) { const [, f] = useState(0); useEffect(() => { if (!on) return; const t = setInterval(() => f((n) => n + 1), 1000); return () => clearInterval(t); }, [on]); }

function Body() {
  const { interfaces } = useAgent();
  const { findings } = useNetData();
  const usable = useMemo(() => interfaces.filter((i) => i.status === 'up' && i.subnetCidr), [interfaces]);
  const [ifId, setIfId] = useState<string>(''); const [cidr, setCidr] = useState('');
  const [profile, setProfile] = useState<keyof typeof PROFILES>('normal');
  const [arp, setArp] = useState(true); const [host, setHost] = useState(true); const [ports, setPorts] = useState(true);
  const [authorized, setAuthorized] = useState(false); const [large, setLarge] = useState(false); const [adv, setAdv] = useState(false);
  const [err, setErr] = useState<{ code?: string; msg: string }>();
  const st = useScanState(); const active = isScanActive(); useTick(active);

  useEffect(() => { if (!ifId && usable[0]) { setIfId(usable[0].interfaceId); setCidr(usable[0].subnetCidr!); } }, [usable, ifId]);
  const iface: AgentInterface | undefined = usable.find((i) => i.interfaceId === ifId);
  const info = parseCidr(cidr);
  const cidrErr = cidr && !info ? 'CIDR không hợp lệ' : info && info.prefix < 16 ? 'Không quét dải lớn hơn /16' : undefined;

  const start = async () => {
    setErr(undefined);
    try { await startScan({ cidr: cidr.trim(), profile, includeArpCache: arp, includeHostname: host, includeCommonPorts: ports, confirmedAuthorized: authorized, confirmLarge: large }, iface); }
    catch (e) { setErr({ code: e instanceof AgentError ? e.code : undefined, msg: (e as Error).message }); }
  };
  const needAuth = err?.code === 'AUTHORIZATION_REQUIRED'; const needLarge = err?.code === 'LARGE_SCAN_CONFIRMATION_REQUIRED';
  const rows = st.devices;
  const exportCols = ['IP', 'MAC', 'Hostname', 'Hãng', 'Loại', 'OS (suy đoán)', 'Trạng thái', 'Ping (ms)', 'Cổng mở', 'HTTP title'];
  const exportRows = rows.map((d) => [d.ipAddress, d.macAddress, d.hostname, d.vendor, d.deviceType, d.osGuess, d.status, d.pingMs, d.openPorts.map((p) => p.port).join(' '), d.httpTitle]);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const pct = st.total ? Math.min(100, Math.round((st.processed / st.total) * 100)) : 0;
  const online = rows.filter((d) => d.status === 'online').length;
  const elapsed = st.startedAt ? Math.round((Date.now() - st.startedAt) / 1000) : 0;
  const sv = STATUS_VI[st.status] ?? STATUS_VI.idle;
  const fmtDur = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}p ${s % 60}s` : `${s}s`);

  return (<>
    <section className="card scan-hero">
      <div className="scan-form">
        <label className="f">Card mạng
          <select value={ifId} onChange={(e) => { setIfId(e.target.value); const n = usable.find((i) => i.interfaceId === e.target.value); if (n?.subnetCidr) setCidr(n.subnetCidr); }} disabled={active} style={{ height: 40 }}>
            {usable.length === 0 && <option value="">(không có card mạng đang hoạt động)</option>}
            {usable.map((i) => <option key={i.interfaceId} value={i.interfaceId}>{i.name} — {i.ipv4}{i.isWifi ? ' (WiFi)' : ''}</option>)}
          </select></label>
        <label className="f">Subnet (CIDR)<input value={cidr} onChange={(e) => setCidr(e.target.value)} className="mono" disabled={active} aria-invalid={!!cidrErr} style={{ height: 40 }} /></label>
        <label className="f">Profile
          <select value={profile} onChange={(e) => setProfile(e.target.value as keyof typeof PROFILES)} disabled={active} style={{ height: 40 }}>
            {Object.entries(PROFILES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <div className="scan-cta">
          {!active ? <button className="primary lg" onClick={() => void start()} disabled={!cidr || !!cidrErr}><Play size={16} />Bắt đầu quét</button>
            : <button className="danger lg" onClick={() => void cancelScan()} disabled={st.status === 'cancelling'}><Square size={15} />{st.status === 'cancelling' ? 'Đang dừng…' : 'Dừng quét'}</button>}
        </div>
      </div>
      <div className="row scan-meta">
        {iface && <span className="small muted">Gateway <b className="mono" style={{ color: 'var(--text-2)' }}>{iface.gateway ?? '—'}</b></span>}
        {info && !cidrErr && <span className="small muted">{info.totalAddresses.toLocaleString('vi-VN')} địa chỉ · {info.usableHosts.toLocaleString('vi-VN')} host khả dụng{info.usableHosts > 1024 ? ' — dải lớn, cần xác nhận' : ''}</span>}
        {cidrErr && <span className="small" style={{ color: 'var(--bad)' }}>{cidrErr}</span>}
        <span className="spacer" />
        <button className="ghost sm" onClick={() => setAdv((a) => !a)} aria-expanded={adv}>Tuỳ chọn quét<ChevronDown size={14} style={{ transform: adv ? 'rotate(180deg)' : undefined, transition: 'transform var(--t-fast)' }} /></button>
      </div>
      {adv && <div className="row scan-opts">
        <label className="chk"><input type="checkbox" checked={arp} onChange={(e) => setArp(e.target.checked)} disabled={active} />Gồm ARP cache</label>
        <label className="chk"><input type="checkbox" checked={host} onChange={(e) => setHost(e.target.checked)} disabled={active} />Tra hostname</label>
        <label className="chk"><input type="checkbox" checked={ports} onChange={(e) => setPorts(e.target.checked)} disabled={active} />Dò cổng phổ biến</label>
      </div>}
      {(needAuth || authorized) && <label className="chk" style={{ marginTop: 10 }}><input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />Tôi xác nhận có quyền kiểm tra dải mạng này</label>}
      {(needLarge || large) && <label className="chk" style={{ marginTop: 6 }}><input type="checkbox" checked={large} onChange={(e) => setLarge(e.target.checked)} />Tôi hiểu đây là quét dải lớn (&gt; 1024 địa chỉ) và có thể mất nhiều thời gian</label>}
      {err && <div style={{ marginTop: 12 }}><Banner kind={needAuth || needLarge ? 'warn' : 'bad'}>{err.msg}</Banner></div>}
      <p className="small muted" style={{ margin: '12px 0 0' }}>Chỉ quét subnet của máy hoặc dải private do bạn xác nhận — không bao giờ quét Internet. Kết quả chỉ lưu trên trình duyệt này.</p>
    </section>

    {st.status !== 'idle' && (
      <section className="card scan-progress">
        <div className="sp-top">
          <div className="sp-pct">{pct}<small>%</small></div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="row" style={{ marginBottom: 8 }}><Badge kind={sv.k} dot>{sv.t}</Badge><span className="small muted">{st.cidr}</span></div>
            <ProgressBar value={st.processed} max={st.total} thick tone={st.status === 'failed' ? 'bad' : st.status === 'completed' ? 'ok' : undefined} indeterminate={active && !st.total} />
          </div>
          <dl className="sp-stats">
            <div><dt>Đã dò</dt><dd>{st.processed}<small>/{st.total || '?'}</small></dd></div>
            <div><dt>Thiết bị</dt><dd>{rows.length}</dd></div>
            <div><dt>Online</dt><dd style={{ color: 'var(--ok)' }}>{online}</dd></div>
            <div><dt>Thời gian</dt><dd>{fmtDur(elapsed)}</dd></div>
          </dl>
        </div>
        {st.skipped.length > 0 && <div style={{ marginTop: 12 }}><Banner kind="warn">Bỏ qua dải không phản hồi gateway: {st.skipped.join(', ')}</Banner></div>}
        {st.status === 'failed' && <div style={{ marginTop: 12 }}><Banner kind="bad">Quét thất bại{st.error ? ` (${st.error})` : ''}.</Banner></div>}
        {st.savedSessionId && <div style={{ marginTop: 12, marginBottom: -16 }}><Banner kind="ok">Đã lưu phiên quét vào lịch sử trên trình duyệt này.</Banner></div>}
      </section>
    )}

    <Card flush title={<>Thiết bị phát hiện <Badge kind="accent">{rows.length}</Badge></>} className="table-card">
      <div style={{ padding: 16 }}>
        <DeviceTable devices={rows} gateway={iface?.gateway} findings={findings} tall
          empty={<Empty icon={Radar} title="Chưa có kết quả quét" action={!active ? <button className="primary" onClick={() => void start()} disabled={!cidr || !!cidrErr}><Play size={15} />Bắt đầu quét</button> : undefined}>Chọn card mạng và subnet, rồi bắt đầu quét. Thiết bị sẽ hiện dần trong bảng khi được phát hiện.</Empty>}
          footer={<div className="row nowrap"><span className="small muted ellipsis">Loại, hãng và OS là <b>suy đoán</b>; cột “tin cậy” cho biết mức chắc chắn. Chọn một dòng để xem nguồn phát hiện.</span><span className="spacer" />
            {rows.length > 0 && !active && <span className="row tight noprint nowrap"><Download size={14} style={{ color: 'var(--text-3)' }} />
              <button className="sm" onClick={() => exportCsv(`hachihi-lan-${stamp}.csv`, exportCols, exportRows)}>CSV</button>
              <button className="sm" onClick={() => void exportXlsx(`hachihi-lan-${stamp}.xlsx`, { title: 'LAN', generatedAt: '', sections: [{ heading: 'Devices', columns: exportCols, rows: exportRows }] })}>XLSX</button>
              <button className="sm" onClick={() => exportJson(`hachihi-lan-${stamp}.json`, rows)}>JSON</button></span>}</div>} />
      </div>
    </Card>
  </>);
}
