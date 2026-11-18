import { useEffect, useMemo, useRef, useState } from 'react';
import { useAgent } from '../../app/context';
import { RequireAgent } from '../../components/AgentGate';
import { Activity, AlertTriangle, CheckCircle2, Download, Play, Square, WifiOff } from 'lucide-react';
import { Badge, Banner, Card, Empty, Kpi, PageHeader } from '../../components/ui';
import { Chart, tooltipBase } from '../../components/Chart';
import { agent, AgentError, type MonitorTick } from '../../infrastructure/agent/client';
import { db } from '../../infrastructure/db/db';
import { exportCsv } from '../../infrastructure/export/export';

const MAX_POINTS = 120;

export default function Monitor() {
  return <RequireAgent capability="monitor.ping" feature="Realtime Monitor"><Body /></RequireAgent>;
}

function Body() {
  const { interfaces } = useAgent();
  const gw = interfaces.find((i) => i.gateway)?.gateway ?? '';
  const [target, setTarget] = useState(gw); const [interval, setIntervalSec] = useState(5); const [keep, setKeep] = useState(false);
  const [sid, setSid] = useState<string>(); const [ticks, setTicks] = useState<MonitorTick[]>([]); const [err, setErr] = useState<string>(); const [ended, setEnded] = useState(false);
  const sidRef = useRef<string>(); const keepRef = useRef(false);
  keepRef.current = keep; sidRef.current = sid;

  useEffect(() => { if (!target && gw) setTarget(gw); }, [gw, target]);
  useEffect(() => agent.on((e) => {
    if (!sidRef.current || e.jobId !== sidRef.current) return;
    if (e.type === 'monitor.tick') {
      const t = e.data as MonitorTick;
      setTicks((p) => [...p.slice(-(MAX_POINTS - 1)), t]);
      void db.monitorSamples.add({ sessionId: e.jobId!, timestamp: Date.parse(t.timestamp) || Date.now(), target: t.target, rttMs: t.rttMs ?? undefined, isReachable: t.isReachable, errorCode: t.errorCode ?? undefined });
    } else if (e.type === 'agent.warning') { setEnded(true); setSid(undefined); }
  }), []);
  // Rời trang ⇒ dừng phiên, trừ khi người dùng đã chủ động bật “chạy nền” (có đồng ý rõ ràng).
  useEffect(() => () => { if (sidRef.current && !keepRef.current) void agent.stopMonitor(sidRef.current).catch(() => undefined); }, []);

  const start = async () => {
    setErr(undefined); setTicks([]); setEnded(false);
    try { const r = await agent.startMonitor(target.trim(), interval, keep); setSid(r.sessionId); }
    catch (e) { setErr(e instanceof AgentError ? e.message : (e as Error).message); }
  };
  const stop = async () => { if (sid) { try { await agent.stopMonitor(sid); } catch { /* */ } setSid(undefined); } };
  const last = ticks[ticks.length - 1];
  const ok = ticks.filter((t) => t.isReachable && t.rttMs != null).map((t) => t.rttMs!);
  const avg = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : undefined;
  const min = ok.length ? Math.min(...ok) : undefined; const max = ok.length ? Math.max(...ok) : undefined;
  const uptime = last ? 100 - last.lossPercent : undefined;
  const tms = (t: MonitorTick) => Date.parse(t.timestamp) || 0;
  const highRtt = avg !== undefined ? Math.max(40, avg * 3) : 40;
  // Sự kiện suy ra từ chuỗi mẫu: mất kết nối / khôi phục / độ trễ cao (cảnh báo) — không có mẫu nào = không có sự kiện.
  const events = useMemo(() => {
    const ev: { at: number; kind: 'down' | 'up' | 'slow'; text: string }[] = []; let downAt: number | undefined;
    ticks.forEach((t, i) => {
      const prev = ticks[i - 1];
      if (!t.isReachable && (!prev || prev.isReachable)) { downAt = tms(t); ev.push({ at: downAt, kind: 'down', text: 'Mất kết nối — không có phản hồi' }); }
      if (t.isReachable && prev && !prev.isReachable) { const d = downAt ? Math.round((tms(t) - downAt) / 1000) : undefined; ev.push({ at: tms(t), kind: 'up', text: `Đã khôi phục${d !== undefined ? ` sau ${d}s gián đoạn` : ''}` }); downAt = undefined; }
      if (t.isReachable && t.rttMs != null && t.rttMs > highRtt && !(prev?.rttMs != null && prev.rttMs > highRtt)) ev.push({ at: tms(t), kind: 'slow', text: `Độ trễ cao: ${t.rttMs.toFixed(1)} ms` });
    });
    return ev.reverse();
  }, [ticks, highRtt]);
  const lastDown = events.find((e) => e.kind === 'down');
  const state: 'idle' | 'ok' | 'warn' | 'down' = !last ? 'idle' : !last.isReachable ? 'down' : ticks.slice(-6).some((t) => !t.isReachable) || (last.rttMs ?? 0) > highRtt ? 'warn' : 'ok';
  const hhmmss = (n: number) => new Date(n).toLocaleTimeString('vi-VN');
  const spans = useMemo(() => { const out: [number, number][] = []; let s: number | undefined; ticks.forEach((t) => { if (!t.isReachable && s === undefined) s = tms(t); if (t.isReachable && s !== undefined) { out.push([s, tms(t)]); s = undefined; } }); if (s !== undefined && ticks.length) out.push([s, tms(ticks[ticks.length - 1])]); return out; }, [ticks]);

  return (<>
    <section className="card mon-bar">
      <div className="row" style={{ alignItems: 'flex-end', gap: 14 }}>
        <label className="f">Mục tiêu (IP/hostname)<input className="mono" value={target} onChange={(e) => setTarget(e.target.value)} disabled={!!sid} style={{ width: 220 }} /></label>
        <label className="f">Chu kỳ<select value={interval} onChange={(e) => setIntervalSec(Number(e.target.value))} disabled={!!sid}>{[1, 5, 10, 30].map((n) => <option key={n} value={n}>{n}s{n === 5 ? ' (mặc định)' : ''}</option>)}</select></label>
        {!sid ? <button className="primary" onClick={() => void start()} disabled={!target.trim()}><Play size={15} />Bắt đầu</button> : <button className="danger" onClick={() => void stop()}><Square size={14} />Dừng</button>}
        {sid && <Badge kind="ok" dot>đang chạy</Badge>}
        <span className="spacer" />
        <label className="chk small muted" style={{ maxWidth: 380 }}><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} disabled={!!sid} />Cho phép Agent tiếp tục giám sát khi tôi đóng tab (chạy nền — chỉ bật khi bạn chủ động đồng ý)</label>
      </div>
      {err && <div style={{ marginTop: 12 }}><Banner kind="bad">{err}</Banner></div>}
      {ended && <div style={{ marginTop: 12 }}><Banner>Phiên giám sát đã kết thúc.</Banner></div>}
    </section>

    <section className={`card mon-state s-${state}`}>
      <div className="ms-ic">{state === 'down' ? <WifiOff size={22} /> : state === 'warn' ? <AlertTriangle size={22} /> : state === 'ok' ? <CheckCircle2 size={22} /> : <Activity size={22} />}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <b className="ms-t">{state === 'idle' ? 'Chưa giám sát' : state === 'down' ? 'Mất kết nối' : state === 'warn' ? 'Cảnh báo' : 'Bình thường'} <span className="mono muted" style={{ fontWeight: 500, fontSize: 'var(--fs-md)' }}>{last?.target ?? target}</span></b>
        <div className="small muted">{state === 'idle' ? 'Nhập mục tiêu và bấm Bắt đầu để theo dõi RTT, mất gói và thời gian gián đoạn.' : state === 'down' ? `Không phản hồi từ ${lastDown ? hhmmss(lastDown.at) : '—'} · tổng gián đoạn ${last!.downtimeSec}s` : state === 'warn' ? `Vừa có mất gói hoặc độ trễ vượt ngưỡng ${highRtt.toFixed(0)} ms` : `Phản hồi ổn định · lần cuối ${hhmmss(tms(last!))}`}</div>
      </div>
      {lastDown && state !== 'idle' && <div className="small muted" style={{ textAlign: 'right' }}>Mất kết nối gần nhất<br /><b style={{ color: 'var(--text)' }}>{hhmmss(lastDown.at)}</b></div>}
    </section>

    <div className="grid g4" style={{ marginBottom: 16 }}>
      <Kpi label="RTT hiện tại" icon={Activity} tone={state === 'down' ? 'bad' : state === 'warn' ? 'warn' : state === 'ok' ? 'ok' : undefined} value={last?.isReachable && last.rttMs != null ? last.rttMs.toFixed(1) : last ? 'Timeout' : '—'} unit={last?.isReachable ? 'ms' : undefined} hint={min !== undefined ? `min ${min.toFixed(1)} · max ${max!.toFixed(1)} ms` : undefined} />
      <Kpi label="RTT trung bình" value={avg !== undefined ? avg.toFixed(1) : '—'} unit={avg !== undefined ? 'ms' : undefined} hint={ok.length ? `${ok.length} mẫu hợp lệ` : undefined} />
      <Kpi label="Mất gói" tone={last && last.lossPercent > 0 ? 'warn' : undefined} value={last ? last.lossPercent : '—'} unit={last ? '%' : undefined} hint={last ? `${last.received}/${last.sent} gói` : undefined} />
      <Kpi label="Uptime (phiên này)" value={uptime !== undefined ? uptime.toFixed(1) : '—'} unit={uptime !== undefined ? '%' : undefined} hint={last ? `gián đoạn ${last.downtimeSec}s` : undefined} />
    </div>

    <div className="mon-grid">
      <Card title={`Độ trễ RTT (${ticks.length} mẫu gần nhất)`} actions={ticks.length ? <button className="sm" onClick={() => exportCsv('hachihi-monitor.csv', ['Thời gian', 'Mục tiêu', 'RTT (ms)', 'Phản hồi'], ticks.map((t) => [t.timestamp, t.target, t.rttMs, t.isReachable ? 'yes' : 'no']))}><Download size={14} />CSV</button> : undefined}>
        {ticks.length ? (
          <Chart label="Biểu đồ RTT theo thời gian" height={300} deps={[ticks, avg, highRtt, spans]} build={(c) => ({
            animation: false, grid: { left: 44, right: 16, top: 16, bottom: 28 },
            tooltip: { ...tooltipBase(c), trigger: 'axis', valueFormatter: (v: unknown) => (v == null ? 'Timeout' : `${Number(v).toFixed(1)} ms`) },
            xAxis: { type: 'time', axisLine: { lineStyle: { color: c.border } }, axisLabel: { color: c.text3, fontSize: 11 }, splitLine: { show: false } },
            yAxis: { type: 'value', min: 0, axisLabel: { color: c.text3, fontSize: 11, formatter: '{value} ms' }, splitLine: { lineStyle: { color: c.grid } } },
            series: [{ type: 'line', name: 'RTT', smooth: 0.25, showSymbol: false, connectNulls: false, lineStyle: { width: 2, color: c.accent }, itemStyle: { color: c.accent },
              areaStyle: { color: c.accent, opacity: 0.1 }, data: ticks.map((t) => [tms(t), t.isReachable ? t.rttMs ?? null : null]),
              markArea: spans.length ? { silent: true, itemStyle: { color: c.bad, opacity: 0.16 }, data: spans.map(([a, b]) => [{ xAxis: a }, { xAxis: Math.max(b, a + 1000) }]) } : undefined,
              markLine: avg !== undefined ? { silent: true, symbol: 'none', lineStyle: { color: c.text3, type: 'dashed' }, label: { color: c.text3, formatter: 'TB {c} ms', fontSize: 11, position: 'insideEndTop' }, data: [{ yAxis: +avg.toFixed(1) }] } : undefined }],
          })} />
        ) : <Empty icon={Activity} title="Chưa có dữ liệu">Bấm “Bắt đầu” — biểu đồ cập nhật theo từng mẫu ping.</Empty>}
        <p className="small muted" style={{ margin: '8px 0 0' }}>Vùng đỏ = giai đoạn mất kết nối. Mẫu lưu cục bộ và tự dọn theo retention (mặc định 7 ngày) khi bạn bấm “Áp dụng retention” trong Cài đặt.</p>
      </Card>
      <Card title="Lịch sử sự kiện" sub={events.length ? `${events.length} sự kiện` : undefined} flush>
        {events.length === 0 ? <Empty icon={CheckCircle2} title="Không có sự kiện">{ticks.length ? 'Không có mất kết nối hay độ trễ bất thường trong phiên này.' : 'Sự kiện sẽ xuất hiện khi giám sát bắt đầu.'}</Empty> : (
          <ul className="ev-list">{events.map((e, i) => (
            <li key={i} className={`ev ev-${e.kind}`}><i className="ev-dot" /><div style={{ flex: 1, minWidth: 0 }}><div>{e.text}</div><div className="small muted mono">{hhmmss(e.at)}</div></div>
              <Badge kind={e.kind === 'up' ? 'ok' : e.kind === 'down' ? 'bad' : 'warn'}>{e.kind === 'up' ? 'Bình thường' : e.kind === 'down' ? 'Nghiêm trọng' : 'Cảnh báo'}</Badge></li>))}</ul>)}
      </Card>
    </div>
  </>);
}
