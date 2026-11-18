import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import { Activity, AlertTriangle, ArrowRight, CheckCircle2, Gauge, History, Plus, Radar, Server, ShieldAlert, Wifi, WifiOff, Boxes, Cable } from 'lucide-react';
import { useAgent, useNetwork } from '../../app/context';
import { useNetData, recToAgent as _r } from '../../app/data';
import { PairBox, AgentInstallHelp } from '../../components/AgentGate';
import { Badge, Card, Empty, Kpi, SkeletonRows, Skeleton, StatusBadge, fmtAgo, fmtTime, sevColor, sevLabel } from '../../components/ui';
import { Chart, tooltipBase } from '../../components/Chart';
import { DeviceAvatar, KIND, KIND_ORDER, kindOf, type DevKind } from '../../components/icons';
import { db } from '../../infrastructure/db/db';
import { SCORE_FORMULA } from '../../core/domain/risk';
export const recToAgent = _r;

const IMPORTANT: DevKind[] = ['router', 'switch', 'ap', 'server', 'nas', 'nvr'];

function HealthGauge({ score }: { score: number | null }) {
  return (
    <Chart label={`Network Health ${score ?? 'chưa có'}`} height={190} deps={[score]} build={(c) => {
      const col = score === null ? c.border : score >= 80 ? c.ok : score >= 50 ? c.warn : c.bad;
      return {
        animation: true, animationDuration: 600,
        series: [{
          type: 'gauge', startAngle: 220, endAngle: -40, min: 0, max: 100, radius: '96%', center: ['50%', '58%'], progress: { show: true, width: 12, roundCap: true, itemStyle: { color: col } },
          axisLine: { roundCap: true, lineStyle: { width: 12, color: [[1, c.surface3]] } }, pointer: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false },
          detail: { valueAnimation: true, offsetCenter: [0, '-2%'], fontSize: 44, fontWeight: 650, fontFamily: c.font, color: c.text, formatter: () => (score === null ? '—' : String(score)) },
          title: { show: true, offsetCenter: [0, '34%'], fontSize: 12, color: c.text3, fontFamily: c.font }, data: [{ value: score ?? 0, name: score === null ? 'Chưa có dữ liệu' : score >= 80 ? 'Tốt' : score >= 50 ? 'Cần chú ý' : 'Rủi ro cao' }],
        }],
      };
    }} />
  );
}

export default function Overview() {
  const { status, health, interfaces, error } = useAgent();
  const { current } = useNetwork();
  const nav = useNavigate();
  const { loading, devices, findings, score, online, newDevices, baseline } = useNetData();
  const sessions = useLiveQuery(async () => (current ? (await db.scanSessions.where('networkId').equals(current.id).sortBy('startedAt')).reverse().slice(0, 6) : []), [current?.id]);
  const speeds = useLiveQuery(() => db.speedTests.orderBy('timestamp').reverse().limit(3).toArray(), []);
  const speed = speeds?.[0];
  const wired = interfaces.find((i) => i.status === 'up' && i.ipv4 && i.gateway) ?? interfaces.find((i) => i.status === 'up' && i.ipv4);
  const gw = current?.gateway ?? wired?.gateway;

  const sev = useMemo(() => ({ critical: findings.filter((f) => f.severity === 'critical').length, high: findings.filter((f) => f.severity === 'high').length, medium: findings.filter((f) => f.severity === 'medium').length, low: findings.filter((f) => f.severity === 'low').length }), [findings]);
  const warnIps = useMemo(() => new Set(findings.filter((f) => f.severity !== 'info' && f.severity !== 'low').map((f) => f.ip)), [findings]);
  const byIp = useMemo(() => { const m = new Map<string, number>(); findings.forEach((f) => m.set(f.ip, Math.max(m.get(f.ip) ?? 0, ['info', 'low', 'medium', 'high', 'critical'].indexOf(f.severity)))); return m; }, [findings]);
  const offline = devices.length - online;

  const comp = useMemo(() => {
    const m = new Map<DevKind, { on: number; off: number }>();
    devices.forEach((d) => { const k = kindOf(d, gw); const v = m.get(k) ?? { on: 0, off: 0 }; if (d.status === 'online') v.on++; else v.off++; m.set(k, v); });
    return KIND_ORDER.filter((k) => m.has(k)).map((k) => ({ k, ...m.get(k)! }));
  }, [devices, gw]);

  const important = useMemo(() => devices.map((d) => ({ d, k: kindOf(d, gw) })).filter((x) => IMPORTANT.includes(x.k)).sort((a, b) => IMPORTANT.indexOf(a.k) - IMPORTANT.indexOf(b.k) || a.d.ipAddress.localeCompare(b.d.ipAddress, undefined, { numeric: true })).slice(0, 8), [devices, gw]);

  const activity = useMemo(() => {
    const a: { t: number; icon: JSX.Element; title: string; sub: string; to: string }[] = [];
    (sessions ?? []).forEach((s) => a.push({ t: s.startedAt, icon: <Radar size={15} />, title: `Quét LAN ${s.cidr}`, sub: `${s.devicesFound} thiết bị · ${s.status === 'completed' ? 'hoàn tất' : s.status}`, to: '/history' }));
    (speeds ?? []).forEach((s) => a.push({ t: s.timestamp, icon: <Gauge size={15} />, title: 'Speed Test', sub: `↓ ${s.downloadMbps?.toFixed(0) ?? '—'} / ↑ ${s.uploadMbps?.toFixed(0) ?? '—'} Mbps · ${s.serverName}`, to: '/speed' }));
    return a.sort((x, y) => y.t - x.t).slice(0, 7);
  }, [sessions, speeds]);

  const connected = status === 'connected';
  const topFindings = findings.filter((f) => f.severity === 'critical' || f.severity === 'high').slice(0, 3);

  if (loading) return <div className="col"><div className="grid g4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={96} r={12} />)}</div><Skeleton h={300} r={12} /></div>;

  return (<>
    {status === 'unpaired' && <PairBox />}
    {(status === 'not-installed' || status === 'error') && devices.length === 0 && <AgentInstallHelp error={error} />}

    {devices.length === 0 ? (
      <Card>
        <Empty icon={Radar} title="Chưa có dữ liệu mạng" action={<>
          <button className="primary" onClick={() => nav('/lan')} disabled={!connected}><Radar size={15} />Quét LAN đầu tiên</button>
          <button onClick={() => nav('/speed')}><Gauge size={15} />Chạy Speed Test</button>
        </>}>
          {connected ? 'Agent đã sẵn sàng. Chạy quét LAN để Overview hiển thị thiết bị, điểm sức khoẻ mạng và cảnh báo bảo mật.' : 'Cài và ghép cặp Hachihi Agent để quét LAN, sau đó dữ liệu sẽ xuất hiện tại đây. Speed Test và Network Tools dùng được ngay không cần Agent.'}
        </Empty>
      </Card>
    ) : (<>
      {/* Hàng 1: sức khoẻ mạng (điểm nhấn) + chỉ số thiết bị */}
      <div className="ov-top">
        <Card className="ov-health" title="Network Health" icon={ShieldAlert} sub={current?.subnetCidr} actions={<Link to="/security" className="small">Security Audit <ArrowRight size={12} style={{ verticalAlign: -1 }} /></Link>}>
          <div className="ov-health-b">
            <HealthGauge score={score} />
            <div className="ov-sev">
              {(['critical', 'high', 'medium', 'low'] as const).map((s) => (
                <div key={s} className="ov-sev-r"><i style={{ background: sevColor[s] }} /><span>{sevLabel[s]}</span><b>{sev[s]}</b></div>
              ))}
              <div className="small muted" style={{ marginTop: 6 }} title={SCORE_FORMULA}>Điểm theo bộ luật rule-based, không dùng AI.</div>
            </div>
          </div>
        </Card>
        <div className="ov-kpis">
          <Kpi icon={Boxes} label="Tổng thiết bị" value={devices.length} hint={current ? `Cập nhật ${fmtAgo(Math.max(...devices.map((d) => d.lastSeenAt)))}` : undefined} tone="accent" />
          <Kpi icon={Wifi} label="Online" value={online} unit={`/ ${devices.length}`} tone="ok" hint={`${Math.round((online / devices.length) * 100)}% đang hoạt động`} />
          <Kpi icon={WifiOff} label="Offline" value={offline} tone={offline ? 'warn' : undefined} hint={offline ? 'Thiết bị không phản hồi' : 'Không có thiết bị mất kết nối'} />
          <Kpi icon={Plus} label="Thiết bị mới" value={baseline.length ? newDevices : '—'} tone={newDevices ? 'warn' : undefined} hint={baseline.length ? 'Chưa có trong baseline' : 'Chưa tạo baseline'} />
          <Kpi icon={AlertTriangle} label="Có cảnh báo" value={warnIps.size} tone={sev.critical ? 'bad' : warnIps.size ? 'warn' : 'ok'} hint={`${sev.critical} nghiêm trọng · ${sev.high} cao`} />
          <Kpi icon={Gauge} label="Speed Test gần nhất" value={speed ? (speed.downloadMbps?.toFixed(0) ?? '—') : '—'} unit={speed ? 'Mbps ↓' : undefined} hint={speed ? `↑ ${speed.uploadMbps?.toFixed(0) ?? '—'} Mbps · ${fmtAgo(speed.timestamp)}` : 'Chưa đo'} />
        </div>
      </div>

      {topFindings.length > 0 && (
        <div className="ov-alerts">
          {topFindings.map((f) => (
            <Link key={f.id} to="/security" className="ov-alert" style={{ ['--c' as string]: sevColor[f.severity] }}>
              <ShieldAlert size={16} /><div className="ellipsis"><b>{f.title}</b><span className="muted"> · {f.host || f.ip}{f.port ? `:${f.port}` : ''}</span></div><Badge kind={f.severity === 'critical' ? 'critical' : 'high'}>{sevLabel[f.severity]}</Badge>
            </Link>
          ))}
        </div>
      )}

      <div className="ov-mid">
        <Card title="Thiết bị theo loại" icon={Boxes} sub="Online / Offline" className="ov-comp">
          <Chart label="Số thiết bị theo loại" height={Math.max(200, comp.length * 27 + 34)} deps={[comp]} build={(c) => ({
            animation: false, grid: { left: 110, right: 24, top: 6, bottom: 22 },
            tooltip: { ...tooltipBase(c), trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: c.grid } } },
            xAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: c.grid } }, axisLabel: { color: c.text3, fontFamily: c.font } },
            yAxis: { type: 'category', inverse: true, data: comp.map((x) => KIND[x.k].label), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: c.text2, fontFamily: c.font, fontSize: 12 } },
            series: [
              { name: 'Online', type: 'bar', stack: 's', barWidth: 14, itemStyle: { color: c.ok, borderRadius: [4, 0, 0, 4] }, data: comp.map((x) => x.on) },
              { name: 'Offline', type: 'bar', stack: 's', barWidth: 14, itemStyle: { color: c.text3, opacity: .55, borderRadius: [0, 4, 4, 0] }, data: comp.map((x) => x.off) },
            ],
          })} />
        </Card>

        <Card title="Agent & mạng" icon={Cable} className="ov-agent">
          <div className="col" style={{ gap: 10 }}>
            <div className="ov-ag-h"><span className={`status ${connected ? 'on' : 'bad'}`}><i className="dot" />{connected ? 'Windows Agent đã kết nối' : 'Agent chưa kết nối'}</span>{health && <span className="chip">v{health.agentVersion}</span>}</div>
            <dl className="kv">
              <dt>Card mạng</dt><dd>{wired ? `${wired.name} · ${wired.ipv4}` : '—'}</dd>
              <dt>Subnet</dt><dd className="mono">{current?.subnetCidr ?? wired?.subnetCidr ?? '—'}</dd>
              <dt>Gateway</dt><dd className="mono">{gw ?? '—'}</dd>
              <dt>DNS</dt><dd className="mono">{wired?.dnsServers.join(', ') || '—'}</dd>
              <dt>Lần quét cuối</dt><dd>{fmtTime(sessions?.[0]?.startedAt)}</dd>
              <dt>Card đang dùng</dt><dd>{interfaces.filter((i) => i.status === 'up').map((i) => i.name).join(', ') || '—'}</dd>
              <dt>Speed Test</dt><dd>{speed ? `↓ ${speed.downloadMbps?.toFixed(0) ?? '—'} / ↑ ${speed.uploadMbps?.toFixed(0) ?? '—'} Mbps · ${speed.serverName}` : 'Chưa đo'}</dd>
              <dt>Realtime</dt><dd>{connected ? <Badge kind="ok" dot>WebSocket + polling</Badge> : <Badge kind="mute">Không có</Badge>}</dd>
            </dl>
            {!connected && <div className="small muted">Một số tính năng (LAN Scanner, WiFi, Monitor) cần Agent.</div>}
          </div>
        </Card>
      </div>

      <div className="ov-bot">
        <Card title="Thiết bị quan trọng" icon={Server} sub="Gateway, switch, AP, server, NAS, NVR" flush actions={<Link to="/inventory" className="small">Tất cả <ArrowRight size={12} style={{ verticalAlign: -1 }} /></Link>}>
          {important.length === 0 ? <Empty>Chưa nhận diện thiết bị hạ tầng nào.</Empty> : (
            <div className="ov-list">
              {important.map(({ d, k }) => {
                const risk = byIp.get(d.ipAddress);
                return (
                  <div key={d.id} className="ov-li" onClick={() => nav('/inventory?ip=' + d.ipAddress)}>
                    <DeviceAvatar kind={k} off={d.status === 'offline'} />
                    <div className="ellipsis" style={{ flex: 1 }}><b>{d.hostname || d.ipAddress}</b><div className="small muted ellipsis">{KIND[k].label} · <span className="mono">{d.ipAddress}</span>{d.vendor ? ` · ${d.vendor}` : ''}</div></div>
                    {risk !== undefined && risk >= 2 && <Badge kind={risk >= 4 ? 'critical' : risk === 3 ? 'high' : 'medium'}>{sevLabel[['info', 'low', 'medium', 'high', 'critical'][risk]]}</Badge>}
                    <span className="small muted mono" style={{ width: 52, textAlign: 'right' }}>{d.pingMs != null ? `${d.pingMs} ms` : ''}</span>
                    <StatusBadge status={d.status} />
                  </div>
                );
              })}
            </div>
          )}
        </Card>
        <Card title="Hoạt động gần đây" icon={History} flush actions={<Link to="/history" className="small">Lịch sử <ArrowRight size={12} style={{ verticalAlign: -1 }} /></Link>}>
          {activity.length === 0 ? <Empty>Chưa có hoạt động.</Empty> : (
            <div className="ov-list">
              {activity.map((a, i) => (
                <Link key={i} to={a.to} className="ov-li plain"><span className="ov-ic">{a.icon}</span><div className="ellipsis" style={{ flex: 1 }}><b>{a.title}</b><div className="small muted ellipsis">{a.sub}</div></div><span className="small muted">{fmtAgo(a.t)}</span></Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>)}
    {devices.length > 0 && !loading && sessions === undefined && <SkeletonRows />}
    {devices.length > 0 && <div className="small muted" style={{ marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}><CheckCircle2 size={13} />Dữ liệu nằm trên máy bạn — Hachihi không có máy chủ lưu trữ dữ liệu mạng.</div>}
    {false && <Activity />}
  </>);
}
