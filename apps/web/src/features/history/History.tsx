import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { useNetwork } from '../../app/context';
import { CheckCircle2, GitCompare, History as HistoryIcon, Plus, Minus, ShieldCheck, Trash2 } from 'lucide-react';
import { Badge, Banner, Card, DataTable, Empty, Kpi, PageHeader, fmtAgo, fmtTime } from '../../components/ui';
import { db, uid } from '../../infrastructure/db/db';
import { compareDevices, type DiffDevice } from '../../core/domain/diff';
import type { ObservationRec, ScanSessionRec, DeviceRec } from '../../core/domain/types';

async function snapshot(sessionId: string): Promise<DiffDevice[]> {
  const obs: ObservationRec[] = await db.deviceObservations.where('scanSessionId').equals(sessionId).toArray();
  const devs = await db.devices.bulkGet(obs.map((o) => o.deviceId));
  return obs.map((o, i) => { const d = devs[i] as DeviceRec | undefined; return { identityKey: d?.identityKey ?? `ip:${o.ipAddress}`, ipAddress: o.ipAddress, macAddress: o.macAddress, hostname: d?.hostname, vendor: d?.vendor, deviceType: d?.deviceType }; });
}

export default function History() {
  const { current } = useNetwork();
  const sessions = useLiveQuery(() => (current ? db.scanSessions.where('networkId').equals(current.id).reverse().sortBy('startedAt') : []), [current?.id], [] as ScanSessionRec[]);
  const baseline = useLiveQuery(() => (current ? db.baselines.where('networkId').equals(current.id).toArray() : []), [current?.id], []);
  const [a, setA] = useState<string>(''); const [b, setB] = useState<string>(''); const [diff, setDiff] = useState<ReturnType<typeof compareDevices>>(); const [msg, setMsg] = useState<string>();
  const latest = sessions[0];
  const bKeys = useMemo(() => new Set(baseline.map((x) => x.deviceIdentityKey)), [baseline]);

  const compare = async () => { const [x, y] = await Promise.all([snapshot(a), snapshot(b)]); setDiff(compareDevices(x, y)); };
  const approve = async () => {
    if (!current || !latest) return;
    const now = Date.now(); const snap = await snapshot(latest.id);
    await db.baselines.where('networkId').equals(current.id).delete(); // baseline thay thế, không gộp
    await db.baselines.bulkAdd(snap.map((d) => ({ id: uid(), networkId: current.id, deviceIdentityKey: d.identityKey, approvedAt: now, approvedLabel: `${d.ipAddress}${d.hostname ? ' ' + d.hostname : ''}` })));
    setMsg(`Đã duyệt ${snap.length} thiết bị vào baseline.`);
  };
  const del = async (id: string) => { if (!confirm('Xoá phiên quét này khỏi lịch sử?')) return; await db.deviceObservations.where('scanSessionId').equals(id).delete(); await db.scanSessions.delete(id); };
  const vsBaseline = useLiveQuery(async () => {
    if (!latest || bKeys.size === 0) return undefined;
    const snap = await snapshot(latest.id);
    return { newDevs: snap.filter((d) => !bKeys.has(d.identityKey)), missing: baseline.filter((x) => !snap.some((d) => d.identityKey === x.deviceIdentityKey)) };
  }, [latest?.id, bKeys, baseline]);

  if (!current) return (<><PageHeader title="History & Compare" /><Card><Empty icon={HistoryIcon} title="Chưa có phiên quét" action={<Link to="/lan"><button className="primary">Mở LAN Scanner</button></Link>}>Chạy một lần quét để lưu lịch sử, so sánh các phiên và tạo baseline thiết bị.</Empty></Card></>);
  return (<>
    <PageHeader title="History & Compare" sub={`Mạng: ${current.label}. Dữ liệu từ các mạng khác nhau không bị gộp.`} actions={<>
      <button className="primary" onClick={() => void approve()} disabled={!latest}><ShieldCheck size={15} />Duyệt lần quét mới nhất làm Baseline</button>
      <button onClick={() => { if (confirm('Xoá baseline của mạng này?')) void db.baselines.where('networkId').equals(current.id).delete(); }} disabled={!baseline.length}>Xoá baseline</button></>} />
    {msg && <Banner kind="ok">{msg}</Banner>}
    <div className="grid g4" style={{ marginBottom: 16 }}>
      <Kpi icon={HistoryIcon} label="Phiên quét đã lưu" value={sessions.length} hint={latest ? `Gần nhất: ${fmtAgo(latest.startedAt)}` : 'Chưa có'} />
      <Kpi icon={ShieldCheck} tone={baseline.length ? 'ok' : undefined} label="Baseline" value={baseline.length} unit="thiết bị" hint={baseline[0] ? `Duyệt ${fmtAgo(baseline[0].approvedAt)}` : 'Chưa duyệt'} />
      <Kpi icon={Plus} tone={vsBaseline?.newDevs.length ? 'warn' : undefined} label="Mới so với baseline" value={vsBaseline ? vsBaseline.newDevs.length : '—'} hint="Có thể là thiết bị lạ" />
      <Kpi icon={Minus} tone={vsBaseline?.missing.length ? 'warn' : undefined} label="Vắng so với baseline" value={vsBaseline ? vsBaseline.missing.length : '—'} hint="Không thấy ở lần quét mới nhất" />
    </div>
    <Card title={`Baseline (${baseline.length} thiết bị${baseline[0] ? ', duyệt ' + fmtTime(baseline[0].approvedAt) : ''})`}>
      {vsBaseline ? (<div className="grid g2">
        <div><h3>Thiết bị mới so với baseline ({vsBaseline.newDevs.length})</h3>{vsBaseline.newDevs.length ? <ul>{vsBaseline.newDevs.map((d) => <li key={d.identityKey}><span className="mono">{d.ipAddress}</span> {d.hostname ?? ''} {d.vendor ?? ''}</li>)}</ul> : <p className="muted">Không có.</p>}</div>
        <div><h3>Thiết bị vắng mặt ({vsBaseline.missing.length})</h3>{vsBaseline.missing.length ? <ul>{vsBaseline.missing.map((d) => <li key={d.id}>{d.approvedLabel}</li>)}</ul> : <p className="muted">Không có.</p>}</div></div>)
        : <Empty icon={ShieldCheck} title="Chưa có baseline">Duyệt lần quét hiện tại làm baseline để phát hiện thiết bị lạ ở các lần quét sau.</Empty>}
    </Card>
    <Card title="So sánh hai phiên quét" icon={GitCompare}>
      <div className="row"><label className="f">Trước<select value={a} onChange={(e) => setA(e.target.value)}><option value="">—</option>{sessions.map((s) => <option key={s.id} value={s.id}>{fmtTime(s.startedAt)} ({s.devicesFound})</option>)}</select></label>
        <label className="f">Sau<select value={b} onChange={(e) => setB(e.target.value)}><option value="">—</option>{sessions.map((s) => <option key={s.id} value={s.id}>{fmtTime(s.startedAt)} ({s.devicesFound})</option>)}</select></label>
        <button onClick={() => void compare()} disabled={!a || !b || a === b} style={{ alignSelf: 'flex-end' }}>So sánh</button></div>
      {diff && (<div className="grid g2" style={{ marginTop: 12 }}>
        <div><h3>Mới ({diff.added.length})</h3>{diff.added.map((d) => <div key={d.identityKey}><Badge kind="ok"><Plus size={11} /></Badge> <span className="mono">{d.ipAddress}</span> {d.hostname ?? ''}</div>)}</div>
        <div><h3>Mất ({diff.removed.length})</h3>{diff.removed.map((d) => <div key={d.identityKey}><Badge kind="bad"><Minus size={11} /></Badge> <span className="mono">{d.ipAddress}</span> {d.hostname ?? ''}</div>)}</div>
        <div><h3>Đổi IP ({diff.ipChanged.length})</h3>{diff.ipChanged.map((x) => <div key={x.after.identityKey}><span className="mono">{x.before.ipAddress} → {x.after.ipAddress}</span> {x.after.macAddress}</div>)}</div>
        <div><h3>Đổi MAC ({diff.macChanged.length})</h3>{diff.macChanged.map((x) => <div key={x.after.identityKey}><span className="mono">{x.after.ipAddress}: {x.before.macAddress} → {x.after.macAddress}</span></div>)}</div></div>)}
    </Card>
    <Card title={`Lịch sử quét (${sessions.length})`} icon={HistoryIcon}>
      <DataTable search={false} rows={sessions} rowKey={(s) => s.id} cols={[
        { key: 't', header: 'Thời gian', render: (s) => fmtTime(s.startedAt) }, { key: 'c', header: 'CIDR', render: (s) => <span className="mono">{s.cidr}</span> },
        { key: 'p', header: 'Profile', render: (s) => s.profile }, { key: 'd', header: 'Thiết bị', render: (s) => s.devicesFound },
        { key: 's', header: 'Trạng thái', render: (s) => <Badge dot kind={s.status === 'completed' ? 'ok' : 'warn'}>{s.status === 'completed' ? 'Hoàn tất' : s.status}</Badge> },
        { key: 'a', header: '', render: (s) => <button className="ghost sm icon" aria-label="Xoá phiên" title="Xoá phiên" onClick={() => void del(s.id)}><Trash2 size={15} /></button> }]} empty="Chưa có lịch sử." />
    </Card>
  </>);
}
