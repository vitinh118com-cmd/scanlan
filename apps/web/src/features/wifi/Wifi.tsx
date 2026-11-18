import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { RequireAgent } from '../../components/AgentGate';
import { Download, Radar, Wifi as WifiIcon, ScanLine } from 'lucide-react';
import { Badge, Banner, Card, DataTable, Empty, Kpi, PageHeader, Segmented, fmtTime } from '../../components/ui';
import { Chart, tooltipBase } from '../../components/Chart';
import { agent, AgentError, type WifiAp, type WifiIface } from '../../infrastructure/agent/client';
import { db, uid } from '../../infrastructure/db/db';
import { exportCsv } from '../../infrastructure/export/export';

type Snap = { capturedAt: string; interfaces: WifiIface[] };

/** Gợi ý kênh 2.4 GHz: các kênh không chồng lấn là 1/6/11; chọn kênh có ít AP chồng lấn nhất. Chỉ là gợi ý. */
function advise(aps: WifiAp[]) {
  const ghz24 = aps.filter((a) => a.band.startsWith('2.4'));
  const score = (ch: number) => ghz24.reduce((s, a) => s + (Math.abs(a.channel - ch) < 5 ? Math.max(1, 100 + a.rssiDbm) * (5 - Math.abs(a.channel - ch)) : 0), 0);
  return [1, 6, 11].map((c) => ({ channel: c, load: Math.round(score(c)) })).sort((a, b) => a.load - b.load);
}

export default function Wifi() {
  return <RequireAgent capability="wifi.snapshot" feature="WiFi Analyzer"><Body /></RequireAgent>;
}

const BANDS = ['2.4', '5', '6'] as const;
const bandOf = (a: WifiAp) => (a.band.startsWith('2.4') ? '2.4' : a.band.startsWith('6') ? '6' : '5');
const sigLevel = (dbm: number) => (dbm >= -55 ? 4 : dbm >= -67 ? 3 : dbm >= -75 ? 2 : 1);
const sigText = (dbm: number) => (dbm >= -55 ? 'Rất tốt' : dbm >= -67 ? 'Tốt' : dbm >= -75 ? 'Trung bình' : 'Yếu');
export function SignalBars({ dbm }: { dbm: number }) {
  const n = sigLevel(dbm);
  return <span className={`sigbars s${n}`} title={`${dbm} dBm — ${sigText(dbm)}`}><i /><i /><i /><i /></span>;
}

function Body() {
  const [snap, setSnap] = useState<Snap>(); const [err, setErr] = useState<string>(); const [busy, setBusy] = useState(false); const [band, setBand] = useState<'2.4' | '5' | '6' | 'all'>('all'); const [saveBssid, setSaveBssid] = useState(false);
  const [chBand, setChBand] = useState<'2.4' | '5' | '6'>('2.4');
  const history = useLiveQuery(() => db.wifiSnapshots.orderBy('capturedAt').reverse().limit(50).toArray(), [], []);
  const run = async (survey: boolean) => {
    setBusy(true); setErr(undefined);
    try {
      const s = survey ? await agent.wifiSurvey() : await agent.wifiSnapshot(); setSnap(s);
      for (const i of s.interfaces) if (i.connection) await db.wifiSnapshots.add({ id: uid(), capturedAt: Date.parse(s.capturedAt) || Date.now(), interfaceLabel: i.name, ssid: i.connection.ssid, bssid: saveBssid ? i.connection.bssid : undefined,
        rssiDbm: i.connection.rssiDbm, signalQuality: i.connection.signalQuality, band: i.connection.band, channel: i.connection.channel, phyType: i.connection.phy, rxMbps: i.connection.rxMbps, txMbps: i.connection.txMbps, apCount: i.nearbyAps.length });
    } catch (e) { setErr(e instanceof AgentError ? e.message : (e as Error).message); } finally { setBusy(false); }
  };
  const aps = useMemo(() => (snap?.interfaces ?? []).flatMap((i) => i.nearbyAps), [snap]);
  const counts = useMemo(() => Object.fromEntries(BANDS.map((b) => [b, aps.filter((a) => bandOf(a) === b).length])) as Record<(typeof BANDS)[number], number>, [aps]);
  useEffect(() => { if (aps.length) setChBand((cur) => (counts[cur] ? cur : BANDS.find((b) => counts[b]) ?? cur)); }, [aps]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = aps.filter((a) => band === 'all' || bandOf(a) === band);
  const chAps = aps.filter((a) => bandOf(a) === chBand);
  const rec = advise(aps);
  const busiest = useMemo(() => { const m = new Map<number, number>(); chAps.forEach((a) => m.set(a.channel, (m.get(a.channel) ?? 0) + 1)); return [...m].sort((a, b) => b[1] - a[1])[0]; }, [chAps]);

  return (<>
    <PageHeader actions={<>
      <button className="primary" onClick={() => void run(true)} disabled={busy}><Radar size={15} className={busy ? 'spin' : ''} />Quét mạng WiFi xung quanh</button>
      <button onClick={() => void run(false)} disabled={busy}><ScanLine size={15} />Chụp trạng thái</button>
      <label className="chk small muted"><input type="checkbox" checked={saveBssid} onChange={(e) => setSaveBssid(e.target.checked)} />Lưu BSSID vào lịch sử (mặc định tắt)</label>
      <span className="spacer" /><span className="small muted">Không bao giờ đọc hay hiển thị mật khẩu WiFi.</span></>} />
    {err && <Banner kind="bad">{err}</Banner>}
    {!snap && !busy && <Card><Empty icon={WifiIcon} title="Chưa có dữ liệu WiFi" action={<button className="primary" onClick={() => void run(true)}><Radar size={15} />Quét ngay</button>}>Quét để xem các mạng WiFi xung quanh, kênh đang bị nhiễu và chất lượng kết nối hiện tại (qua Native WLAN API của Windows).</Empty></Card>}
    {snap && snap.interfaces.length === 0 && <Banner kind="warn">Không tìm thấy card WiFi.</Banner>}
    {snap?.interfaces.map((i) => (i.connection ? (
      <section key={i.name} className="card wf-conn">
        <div className="wf-id"><span className="avatar lg k-ap"><WifiIcon size={22} /></span><div style={{ minWidth: 0 }}><div className="small muted">Đang kết nối · {i.name}</div><b className="wf-ssid ellipsis">{i.connection.ssid}</b>
          <div className="mono small muted">{i.connection.bssid}</div></div></div>
        <div className="wf-kpis">
          <div><span>Tín hiệu</span><b>{i.connection.rssiDbm ?? '—'}<small> dBm</small></b><div className="row tight">{i.connection.rssiDbm != null && <SignalBars dbm={i.connection.rssiDbm} />}<span className="small muted">{i.connection.rssiDbm != null ? sigText(i.connection.rssiDbm) : `${i.connection.signalQuality}%`}</span></div></div>
          <div><span>Băng tần / Kênh</span><b>{i.connection.band ?? '?'}<small> · ch {i.connection.channel ?? '?'}</small></b><div className="small muted">{i.connection.phy} {i.connection.security}</div></div>
          <div><span>Tốc độ liên kết</span><b>{i.connection.rxMbps}<small> ↓ / {i.connection.txMbps} ↑ Mbps</small></b><div className="small muted">chất lượng {i.connection.signalQuality}%</div></div>
          <div><span>AP xung quanh</span><b>{i.nearbyAps.length}</b><div className="small muted">{counts['2.4']} · 2.4G / {counts['5']} · 5G / {counts['6']} · 6G</div></div>
        </div>
      </section>) : <Banner key={i.name} kind="info">Card {i.name} không kết nối WiFi.</Banner>))}

    {aps.length > 0 && (<>
      <div className="wf-grid">
        <Card title="Biểu đồ kênh" sub="Mỗi AP là một dải 20 MHz; chồng lấn = nhiễu đồng kênh" actions={<Segmented label="Băng tần" value={chBand} onChange={setChBand} options={BANDS.map((b) => ({ value: b, label: b === '6' ? '6 GHz' : b + ' GHz', count: counts[b] }))} />}>
          {chAps.length === 0 ? <Empty icon={WifiIcon} title={`Không có AP ${chBand} GHz`}>Card WiFi hoặc khu vực này không thấy mạng ở băng tần đó.</Empty> : (
            <Chart label={`Biểu đồ kênh WiFi ${chBand} GHz`} height={340} deps={[chAps, chBand]} build={(c) => {
              const chans = chAps.map((a) => a.channel); const lo = Math.min(...chans) - 4; const hi = Math.max(...chans) + 4;
              const min = chBand === '2.4' ? 0 : lo; const max = chBand === '2.4' ? 15 : hi; const floor = -100;
              return {
                animation: false, grid: { left: 50, right: 20, top: 20, bottom: 36 },
                tooltip: { ...tooltipBase(c), trigger: 'item', formatter: (p: { seriesName: string; data: { ap?: WifiAp } }) => { const a = p.data?.ap; return a ? `<b>${a.ssid || '(ẩn)'}</b><br/>Kênh ${a.channel} · ${a.rssiDbm} dBm<br/><span style="opacity:.7">${a.bssid}</span>` : p.seriesName; } },
                xAxis: { type: 'value', min, max, interval: chBand === '2.4' ? 1 : chBand === '5' ? 8 : 8, axisLabel: { color: c.text3, fontSize: 11 }, axisLine: { lineStyle: { color: c.border } }, splitLine: { lineStyle: { color: c.grid } }, name: 'Kênh', nameLocation: 'middle', nameGap: 24, nameTextStyle: { color: c.text3 } },
                yAxis: { type: 'value', min: floor, max: -30, interval: 10, axisLabel: { color: c.text3, fontSize: 11, formatter: '{value}' }, splitLine: { lineStyle: { color: c.grid } }, name: 'dBm', nameTextStyle: { color: c.text3 } },
                series: chAps.map((a) => {
                  const w = 2; const col = a.connected ? c.accent : c.text2; const pts = [[a.channel - w - 0.5, floor], [a.channel - w + 0.5, a.rssiDbm], [a.channel + w - 0.5, a.rssiDbm], [a.channel + w + 0.5, floor]].map((p) => ({ value: p, ap: a }));
                  return { type: 'line', name: a.ssid || a.bssid, data: pts, showSymbol: false, smooth: 0.35, z: a.connected ? 3 : 2, lineStyle: { width: a.connected ? 2.4 : 1.4, color: col }, areaStyle: { color: col, opacity: a.connected ? 0.22 : 0.09, origin: 'start' },
                    emphasis: { focus: 'series', lineStyle: { width: 2.6 } }, markPoint: undefined,
                    label: { show: true, formatter: () => '', position: 'top' }, endLabel: undefined };
                }).concat(chAps.map((a) => ({ type: 'scatter', name: (a.ssid || a.bssid) + '·label', data: [{ value: [a.channel, a.rssiDbm], ap: a }], symbolSize: 0, z: 4,
                  label: { show: true, position: 'top', formatter: () => a.ssid || '(ẩn)', color: a.connected ? c.accent : c.text2, fontSize: 11, fontWeight: a.connected ? 600 : 400 } })) as never[]),
              };
            }} />)}
        </Card>
        <div className="col" style={{ gap: 'var(--s-4)' }}>
          <Card title="Nhận xét kênh" icon={WifiIcon}>
            {chAps.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Không có dữ liệu.</p> : <>
              <div className="wf-stat"><span>Số AP trong băng tần</span><b>{chAps.length}</b></div>
              {busiest && <div className="wf-stat"><span>Kênh đông nhất</span><b>ch {busiest[0]} <small>({busiest[1]} AP)</small></b></div>}
              <div className="wf-stat"><span>Tín hiệu mạnh nhất</span><b>{Math.max(...chAps.map((a) => a.rssiDbm))} <small>dBm</small></b></div></>}
          </Card>
          <Card title="Gợi ý kênh 2.4 GHz"><ol style={{ margin: 0, paddingLeft: 18 }}>{rec.map((r, i) => <li key={r.channel} style={{ margin: '4px 0' }}>Kênh {r.channel} — mức chồng lấn {r.load}{i === 0 ? <> <Badge kind="ok">ít nhất</Badge></> : ''}</li>)}</ol>
            <p className="small muted" style={{ margin: '8px 0 0' }}>Chỉ là gợi ý dựa trên các AP quét được; phụ thuộc driver/card WiFi và thời điểm quét, không thay thế máy phân tích phổ chuyên dụng.</p></Card>
        </div>
      </div>
      <Card flush title={`Access Point (${shown.length})`} actions={<div className="row noprint"><Segmented label="Lọc băng tần" value={band} onChange={setBand} options={[{ value: 'all', label: 'Tất cả', count: aps.length }, ...BANDS.filter((b) => counts[b]).map((b) => ({ value: b, label: b + ' GHz', count: counts[b] }))]} />
        <button className="sm" onClick={() => exportCsv('hachihi-wifi.csv', ['SSID', 'BSSID', 'RSSI', 'Chất lượng', 'Băng tần', 'Kênh', 'PHY', 'Bảo mật'], shown.map((a) => [a.ssid, a.bssid, a.rssiDbm, a.signalQuality, a.band, a.channel, a.phy, a.security]))}><Download size={14} />CSV</button></div>}>
        <div style={{ padding: 16 }}><DataTable rows={shown} rowKey={(a) => a.bssid + a.ssid} cols={[
          { key: 's', header: 'SSID', render: (a) => <span className="row tight nowrap"><b style={{ fontWeight: 550 }}>{a.ssid || <i className="muted">(ẩn)</i>}</b>{a.connected && <Badge kind="ok" dot>đang kết nối</Badge>}</span>, text: (a) => a.ssid, sort: (a, b) => a.ssid.localeCompare(b.ssid) },
          { key: 'b', header: 'BSSID', render: (a) => <span className="mono small">{a.bssid}</span>, text: (a) => a.bssid },
          { key: 'r', header: 'Tín hiệu', render: (a) => <span className="row tight nowrap"><SignalBars dbm={a.rssiDbm} /><span className="mono small">{a.rssiDbm} dBm</span></span>, sort: (a, b) => a.rssiDbm - b.rssiDbm },
          { key: 'q', header: 'Chất lượng', render: (a) => `${a.signalQuality}%`, sort: (a, b) => a.signalQuality - b.signalQuality },
          { key: 'bd', header: 'Băng tần', render: (a) => <Badge kind="accent">{a.band}</Badge>, text: (a) => a.band },
          { key: 'c', header: 'Kênh', render: (a) => a.channel, sort: (a, b) => a.channel - b.channel }, { key: 'p', header: 'PHY', render: (a) => a.phy }, { key: 'sec', header: 'Bảo mật', render: (a) => a.security, text: (a) => a.security }]} /></div>
      </Card></>)}
    <Card flush title={`Lịch sử snapshot (${history.length})`}><div style={{ padding: 16 }}>
      <DataTable search={false} rows={history} rowKey={(h) => h.id} cols={[{ key: 't', header: 'Thời gian', render: (h) => fmtTime(h.capturedAt) }, { key: 's', header: 'SSID', render: (h) => h.ssid ?? '—' },
        { key: 'r', header: 'RSSI', render: (h) => (h.rssiDbm != null ? `${h.rssiDbm} dBm` : '—') }, { key: 'c', header: 'Kênh', render: (h) => `${h.band ?? ''} ${h.channel ?? ''}` }, { key: 'l', header: 'Link', render: (h) => `${h.rxMbps ?? '?'}/${h.txMbps ?? '?'} Mbps` }]} empty="Chưa có snapshot." /></div>
    </Card>
  </>);
}
void Kpi;
