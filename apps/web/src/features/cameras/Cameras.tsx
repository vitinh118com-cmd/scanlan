import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { RequireAgent } from '../../components/AgentGate';
import { Camera, Play, Square } from 'lucide-react';
import { Badge, Banner, Card, Confidence, DataTable, Empty, PageHeader, ProgressBar, fmtTime, confLabel, type Col } from '../../components/ui';
import { DeviceAvatar } from '../../components/icons';
import { agent, AgentError, type AgentCamera } from '../../infrastructure/agent/client';
import { db, uid } from '../../infrastructure/db/db';
import { exportCsv } from '../../infrastructure/export/export';
import { parseCidr } from '../../core/domain/cidr';
import type { CameraRec } from '../../core/domain/types';

const COLS: Col<AgentCamera>[] = [
  { key: 'ip', header: 'IP', render: (c) => <span className="row tight nowrap"><DeviceAvatar kind={/nvr|dvr/i.test(c.hostname ?? '') ? 'nvr' : 'camera'} /><span className="mono">{c.ipAddress}</span></span>, sort: (a, b) => a.ipAddress.localeCompare(b.ipAddress, undefined, { numeric: true }), text: (c) => c.ipAddress },
  { key: 'v', header: 'Hãng', render: (c) => c.vendor ?? '—', text: (c) => c.vendor ?? '' },
  { key: 'h', header: 'Hostname / mô tả', render: (c) => c.hostname ?? '—', text: (c) => c.hostname ?? '' },
  { key: 'mac', header: 'MAC', render: (c) => <span className="mono">{c.macAddress ?? '—'}</span> },
  { key: 'p', header: 'Bằng chứng giao thức', render: (c) => <span className="row tight">{c.protocols.map((p) => <span key={p} className="chip">{p.toUpperCase()}</span>)}</span>, text: (c) => c.protocols.join(' ') },
  { key: 'sp', header: 'Cổng dịch vụ', render: (c) => c.servicePorts.join(', ') || '—' },
  { key: 'c', header: 'Độ tin cậy', render: (c) => <Confidence level={c.confidence} />, sort: (a, b) => a.confidence.localeCompare(b.confidence) },
];

export default function Cameras() {
  return (<>
    <PageHeader title="Camera Discovery" sub="Dò camera/NVR bằng SADP, SSDP, mDNS và cổng đặc trưng." />
    <Banner kind="info">Hachihi <b>không đăng nhập</b> camera, <b>không thử mật khẩu mặc định</b>, không xem/lưu stream và không lưu thông tin xác thực. ONVIF WS-Discovery chưa được hỗ trợ trong phiên bản này.</Banner>
    <RequireAgent capability="camera.discovery" feature="Camera Discovery"><Body /></RequireAgent>
  </>);
}

function Body() {
  const [cidr, setCidr] = useState(''); const [useCidr, setUseCidr] = useState(false); const [authorized, setAuthorized] = useState(false);
  const [job, setJob] = useState<string>(); const [status, setStatus] = useState('idle'); const [cams, setCams] = useState<AgentCamera[]>([]); const [err, setErr] = useState<string>();
  const t = useRef<number>();
  const saved = useLiveQuery(() => db.cameras.orderBy('discoveredAt').reverse().toArray(), [], [] as CameraRec[]);
  const running = status === 'running';

  useEffect(() => () => clearTimeout(t.current), []);
  const poll = async (id: string) => {
    try {
      const r = await agent.cameraStatus(id); setStatus(r.status); setCams(r.cameras);
      if (r.status === 'running') t.current = window.setTimeout(() => void poll(id), 1000);
      else if (r.cameras.length) await db.cameras.bulkPut(r.cameras.map<CameraRec>((c) => ({ id: `cam:${c.macAddress ?? c.ipAddress}`, ipAddress: c.ipAddress, macAddress: c.macAddress, vendor: c.vendor, hostname: c.hostname, protocols: c.protocols, servicePorts: c.servicePorts, confidence: c.confidence, discoveredAt: Date.now() })));
    } catch (e) { setErr((e as Error).message); setStatus('failed'); }
  };
  const start = async () => {
    setErr(undefined); setCams([]);
    try {
      const r = await agent.startCameras({ cidr: useCidr ? cidr.trim() : undefined, confirmedAuthorized: authorized, confirmLarge: false });
      setJob(r.jobId); setStatus('running'); void poll(r.jobId);
    } catch (e) { setErr(e instanceof AgentError ? e.message : (e as Error).message); }
  };
  const cancel = async () => { if (job) { try { await agent.cancelCameras(job); } catch { /* */ } } };
  void uid;
  const info = parseCidr(cidr);

  return (<>
    <Card title="Cấu hình dò" icon={Camera}>
      <label className="chk"><input type="checkbox" checked={useCidr} onChange={(e) => setUseCidr(e.target.checked)} disabled={running} />Dò thêm các cổng đặc trưng (554, 8000, 8899, 37777) trong một dải CIDR</label>
      {useCidr && <div className="row" style={{ marginTop: 8 }}>
        <input className="mono" placeholder="192.168.1.0/24" value={cidr} onChange={(e) => setCidr(e.target.value)} disabled={running} aria-label="CIDR" />
        <label className="chk"><input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />Tôi có quyền kiểm tra dải này (bắt buộc nếu không thuộc subnet của máy)</label>
        {cidr && !info && <span style={{ color: 'var(--bad)' }}>CIDR không hợp lệ</span>}</div>}
      <div className="row" style={{ marginTop: 10 }}>
        {!running ? <button className="primary" onClick={() => void start()} disabled={useCidr && !info}><Play size={15} />Bắt đầu dò</button> : <button className="danger" onClick={() => void cancel()}><Square size={14} />Dừng</button>}
        <span className="muted small">{running ? 'Đang dò camera…' : status === 'completed' ? `Hoàn tất · ${cams.length} thiết bị` : status === 'idle' ? 'Sẵn sàng' : status}</span>
      </div>
      {running && <div style={{ marginTop: 12 }}><ProgressBar value={0} max={1} indeterminate /></div>}
      {err && <Banner kind="bad">{err}</Banner>}
    </Card>
    <Card title={`Kết quả phiên này (${cams.length})`} actions={cams.length ? <button onClick={() => exportCsv('hachihi-cameras.csv', ['IP', 'Hãng', 'Hostname', 'MAC', 'Giao thức', 'Cổng', 'Tin cậy'], cams.map((c) => [c.ipAddress, c.vendor, c.hostname, c.macAddress, c.protocols.join(' '), c.servicePorts.join(' '), c.confidence]))}>CSV</button> : undefined}>
      <DataTable rows={cams} cols={COLS} rowKey={(c) => c.ipAddress} empty={<Empty icon={Camera} title={running ? 'Đang dò…' : 'Chưa có kết quả'}>{running ? 'Đang lắng nghe phản hồi SADP/SSDP/mDNS.' : 'Bấm “Bắt đầu dò” để tìm camera và NVR trong mạng.'}</Empty>} />
    </Card>
    <Card title={`Camera đã lưu (${saved.length})`}>
      <DataTable rows={saved} cols={[
        { key: 'ip', header: 'IP', render: (c: CameraRec) => <span className="mono">{c.ipAddress}</span>, text: (c) => c.ipAddress },
        { key: 'v', header: 'Hãng', render: (c) => c.vendor ?? '—', text: (c) => c.vendor ?? '' },
        { key: 'pr', header: 'Giao thức', render: (c) => c.protocols.join(', ') },
        { key: 'cf', header: 'Tin cậy', render: (c) => <Confidence level={c.confidence} /> },
        { key: 'd', header: 'Phát hiện', render: (c) => fmtTime(c.discoveredAt) },
      ]} rowKey={(c) => c.id} empty={<Empty icon={Camera}>Chưa lưu camera nào. Kết quả dò sẽ tự lưu vào máy bạn.</Empty>} />
    </Card>
  </>);
}
