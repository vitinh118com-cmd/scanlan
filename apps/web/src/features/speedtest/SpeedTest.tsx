import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDown, ArrowUp, Download, Gauge as GaugeIcon, Play, Server, Square, Timer, Activity, PackageX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Banner, Card, DataTable, Empty, PageHeader, fmtTime } from '../../components/ui';
import { Chart, tooltipBase } from '../../components/Chart';
import { db, uid } from '../../infrastructure/db/db';
import { exportCsv } from '../../infrastructure/export/export';
import { PROVIDERS, runSpeedTest, type SpeedProgress, type SpeedResult } from '../../infrastructure/speedtest/engine';

export default function SpeedTest() {
  const [pid, setPid] = useState(PROVIDERS[0].id);
  const [p, setP] = useState<SpeedProgress>({ phase: 'idle' }); const [res, setRes] = useState<SpeedResult>(); const [err, setErr] = useState<string>();
  const [live, setLive] = useState<number[]>([]); const ctl = useRef<AbortController>(); const lastPhase = useRef<string>('download');
  const history = useLiveQuery(() => db.speedTests.orderBy('timestamp').reverse().limit(100).toArray(), [], []);
  const running = p.phase !== 'idle' && p.phase !== 'done' && p.phase !== 'error' && p.phase !== 'cancelled';
  const provider = PROVIDERS.find((x) => x.id === pid)!;

  const run = async () => {
    setErr(undefined); setRes(undefined); setLive([]); ctl.current = new AbortController();
    try {
      const r = await runSpeedTest(provider, (x) => { setP(x); if (x.liveMbps !== undefined) setLive((l) => [...l.slice(-199), x.liveMbps!]); }, ctl.current.signal);
      setRes(r); setP({ phase: 'done' });
      await db.speedTests.add({ id: uid(), timestamp: Date.now(), serverName: r.serverName, serverProvider: r.serverProvider, idleLatencyMs: r.idleLatencyMs, jitterMs: r.jitterMs,
        downloadMbps: r.downloadMbps, uploadMbps: r.uploadMbps, loadedLatencyMs: r.loadedLatencyMs, bufferbloatGrade: r.bufferbloatGrade, testMethodVersion: r.testMethodVersion });
    } catch (e) {
      if ((e as Error).name === 'AbortError' || ctl.current?.signal.aborted) setP({ phase: 'cancelled' });
      else { setErr((e as Error).message || 'Đo thất bại'); setP({ phase: 'error' }); }
    }
  };
  const label: Record<string, string> = { idle: 'Sẵn sàng', latency: 'Đo độ trễ', download: 'Đo tải xuống', upload: 'Đo tải lên', done: 'Hoàn tất', error: 'Lỗi', cancelled: 'Đã huỷ' };
  const liveNow = p.liveMbps ?? 0;
  const gaugeVal = running ? (p.phase === 'download' || p.phase === 'upload' ? liveNow : 0) : res ? (lastPhase.current === 'upload' ? res.uploadMbps : res.downloadMbps) : 0;
  const max = niceMax(Math.max(gaugeVal, ...live, res?.downloadMbps ?? 0, res?.uploadMbps ?? 0, 100));
  const phases: { id: string; t: string }[] = [{ id: 'latency', t: 'Ping' }, { id: 'download', t: 'Download' }, { id: 'upload', t: 'Upload' }];
  const order = ['latency', 'download', 'upload', 'done']; const cur = order.indexOf(p.phase === 'done' ? 'done' : p.phase);
  if (running) lastPhase.current = p.phase;
  const dl = res?.downloadMbps ?? (p.phase === 'download' ? p.liveMbps : undefined); const ul = res?.uploadMbps ?? (p.phase === 'upload' ? p.liveMbps : undefined);

  return (<>
    <PageHeader actions={<>
      <span className="small muted"><Server size={13} style={{ verticalAlign: -2 }} /> Máy chủ đo: <b style={{ color: 'var(--text-2)' }}>{res?.serverName ?? provider.displayName}</b> ({provider.provider})</span>
      {PROVIDERS.length > 1 && <select value={pid} onChange={(e) => setPid(e.target.value)} disabled={running} aria-label="Máy chủ đo">{PROVIDERS.map((x) => <option key={x.id} value={x.id}>{x.displayName}</option>)}</select>}
      <span className="spacer" /><span className="small muted">Đo trực tiếp từ trình duyệt — không qua máy chủ của Hachihi · khoảng vài chục MB mỗi lượt · giữ tab ở phía trước</span></>} />
    {err && <Banner kind="bad">{err}<br /><span className="small">Nếu lỗi do CORS/chặn mạng, endpoint đo có thể không truy cập được từ mạng của bạn.</span></Banner>}

    <section className="card st-hero">
      <div className="st-side dl"><span className="st-lab"><ArrowDown size={16} />Download</span><b className="st-big">{dl !== undefined ? dl.toFixed(dl >= 100 ? 0 : 1) : '—'}</b><span className="st-unit">Mbps</span></div>
      <div className="st-center">
        <div className="st-phases" aria-label="Tiến trình đo">{phases.map((x) => { const i = order.indexOf(x.id); return <span key={x.id} className={`st-ph ${cur === i && running ? 'on' : cur > i ? 'done' : ''}`}>{x.t}</span>; })}</div>
        <Chart label="Đồng hồ tốc độ" height={250} deps={[gaugeVal, max, running]} build={(c) => ({
          animation: true, animationDurationUpdate: 250, series: [{ type: 'gauge', startAngle: 215, endAngle: -35, min: 0, max, splitNumber: 5, radius: '98%', center: ['50%', '58%'],
            progress: { show: true, width: 16, roundCap: true, itemStyle: { color: p.phase === 'upload' || (!running && lastPhase.current === 'upload') ? c.info : c.accent } },
            axisLine: { roundCap: true, lineStyle: { width: 16, color: [[1, c.surface3]] } }, axisTick: { show: false }, splitLine: { show: false },
            axisLabel: { distance: 26, color: c.text3, fontSize: 11, formatter: (v: number) => (v >= 1000 ? v / 1000 + 'G' : String(v)) }, pointer: { show: false }, anchor: { show: false }, title: { show: false },
            detail: { valueAnimation: true, offsetCenter: [0, '2%'], fontSize: 46, fontWeight: 650, color: c.text, fontFamily: c.font, formatter: (v: number) => (running || res ? v.toFixed(v >= 100 ? 0 : 1) : '0') },
            data: [{ value: +gaugeVal.toFixed(2) }] }],
          graphic: [{ type: 'text', left: 'center', top: '80%', style: { text: 'Mbps', fill: c.text3, fontSize: 14, fontFamily: c.font } }],
        })} />
        <div className="st-cta">{!running ? <button className="primary lg st-go" onClick={() => void run()}><Play size={17} />{res ? 'Đo lại' : 'Bắt đầu đo'}</button> : <button className="danger lg st-go" onClick={() => ctl.current?.abort()}><Square size={15} />Huỷ</button>}</div>
        <div className="small muted" style={{ textAlign: 'center', minHeight: 20 }} aria-live="polite">{label[p.phase]}{running && p.elapsedSec ? ` · ${p.elapsedSec.toFixed(0)}s` : ''}</div>
      </div>
      <div className="st-side ul"><span className="st-lab"><ArrowUp size={16} />Upload</span><b className="st-big">{ul !== undefined ? ul.toFixed(ul >= 100 ? 0 : 1) : '—'}</b><span className="st-unit">Mbps</span></div>
    </section>

    <div className="st-metrics">
      <div className="kpi"><div className="k-top"><Timer size={15} />Ping (độ trễ nghỉ)</div><div className="k-val">{res ? res.idleLatencyMs.toFixed(1) : p.latencyMs ? p.latencyMs.toFixed(1) : '—'}<small>ms</small></div></div>
      <div className="kpi"><div className="k-top"><Activity size={15} />Jitter</div><div className="k-val">{res ? res.jitterMs.toFixed(1) : '—'}<small>ms</small></div></div>
      <div className="kpi"><div className="k-top"><GaugeIcon size={15} />Độ trễ khi tải</div><div className="k-val">{res?.loadedLatencyMs ? res.loadedLatencyMs.toFixed(0) : '—'}<small>ms</small></div><div className="k-hint">{res?.bufferbloatGrade ? `Bufferbloat hạng ${res.bufferbloatGrade}` : 'Bufferbloat'}</div></div>
      <div className="kpi"><div className="k-top"><PackageX size={15} />Packet loss</div><div className="k-val">N/A</div><div className="k-hint">Trình duyệt không đo được loss — dùng <Link to="/monitor">Realtime Monitor</Link></div></div>
    </div>
    {res && <p className="small muted" style={{ margin: '-4px 0 16px' }}>{res.serverName} · phương pháp {res.testMethodVersion} · {res.durationSec.toFixed(0)} giây{res.warnings.map((w, i) => <span key={i}> · ⚠ {w}</span>)}. Kết quả là tốc độ <i>trình duyệt ↔ máy chủ đo</i>, có thể khác Ookla/nhà mạng.</p>}

    {live.length > 1 && <Card title="Tốc độ theo thời gian" sub={p.phase === 'upload' ? 'Upload' : 'Download'}>
      <Chart label="Biểu đồ tốc độ trực tiếp" height={180} deps={[live]} build={(c) => ({ animation: false, grid: { left: 48, right: 12, top: 10, bottom: 22 }, tooltip: { ...tooltipBase(c), trigger: 'axis', valueFormatter: (v: unknown) => `${Number(v).toFixed(0)} Mbps` },
        xAxis: { type: 'category', show: false, data: live.map((_, i) => i) }, yAxis: { type: 'value', axisLabel: { color: c.text3, fontSize: 11 }, splitLine: { lineStyle: { color: c.grid } } },
        series: [{ type: 'line', data: live, smooth: 0.3, showSymbol: false, lineStyle: { width: 2, color: c.accent }, areaStyle: { color: c.accent, opacity: 0.12 } }] })} /></Card>}

    <Card flush title={`Lịch sử (${history.length})`} actions={history.length ? <button className="sm" onClick={() => exportCsv('hachihi-speedtest.csv', ['Thời gian', 'Máy chủ', 'Độ trễ ms', 'Jitter ms', 'Down Mbps', 'Up Mbps', 'Loaded ms', 'Hạng'], history.map((h) => [new Date(h.timestamp).toISOString(), h.serverName, h.idleLatencyMs, h.jitterMs, h.downloadMbps, h.uploadMbps, h.loadedLatencyMs, h.bufferbloatGrade]))}><Download size={14} />CSV</button> : undefined}>
      <div style={{ padding: 16 }}>
        {history.length > 1 && <Chart label="Lịch sử tốc độ" height={200} deps={[history]} build={(c) => { const h = [...history].reverse(); return { animation: false, grid: { left: 48, right: 14, top: 28, bottom: 26 }, legend: { top: 0, right: 0, textStyle: { color: c.text2 }, icon: 'roundRect', itemHeight: 8 },
          tooltip: { ...tooltipBase(c), trigger: 'axis', valueFormatter: (v: unknown) => (v == null ? '—' : `${Number(v).toFixed(1)} Mbps`) }, xAxis: { type: 'category', data: h.map((x) => new Date(x.timestamp).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })), axisLabel: { color: c.text3, fontSize: 11 }, axisLine: { lineStyle: { color: c.border } } },
          yAxis: { type: 'value', axisLabel: { color: c.text3, fontSize: 11 }, splitLine: { lineStyle: { color: c.grid } } },
          series: [{ name: 'Download', type: 'line', smooth: 0.25, data: h.map((x) => x.downloadMbps ?? null), lineStyle: { color: c.accent, width: 2 }, itemStyle: { color: c.accent }, symbolSize: 6 }, { name: 'Upload', type: 'line', smooth: 0.25, data: h.map((x) => x.uploadMbps ?? null), lineStyle: { color: c.info, width: 2 }, itemStyle: { color: c.info }, symbolSize: 6 }] }; }} />}
        <DataTable search={false} rows={history} rowKey={(h) => h.id} cols={[{ key: 't', header: 'Thời gian', render: (h) => fmtTime(h.timestamp) }, { key: 's', header: 'Máy chủ', render: (h) => h.serverName },
          { key: 'l', header: 'Ping', render: (h) => `${h.idleLatencyMs?.toFixed(1) ?? '—'} ms` }, { key: 'j', header: 'Jitter', render: (h) => `${h.jitterMs?.toFixed(1) ?? '—'} ms` }, { key: 'd', header: '↓ Mbps', render: (h) => h.downloadMbps?.toFixed(1) ?? '—' }, { key: 'u', header: '↑ Mbps', render: (h) => h.uploadMbps?.toFixed(1) ?? '—' },
          { key: 'b', header: 'Bufferbloat', render: (h) => h.bufferbloatGrade ?? '—' }]} empty={<Empty icon={GaugeIcon} title="Chưa có lần đo">Bấm “Bắt đầu đo” để có kết quả đầu tiên.</Empty>} />
      </div>
    </Card>
  </>);
}

const niceMax = (v: number) => [100, 250, 500, 1000, 2500, 5000, 10000].find((n) => v <= n) ?? 10000;
