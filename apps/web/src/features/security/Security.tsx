import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { useNetwork } from '../../app/context';
import { ChevronDown, ShieldCheck, Download, Search, ListChecks, AlertTriangle } from 'lucide-react';
import { Badge, Banner, Card, Confidence, Empty, PageHeader, SearchBox, SkeletonRows, sevColor, sevLabel } from '../../components/ui';
import { db } from '../../infrastructure/db/db';
import { exportCsv } from '../../infrastructure/export/export';
import { analyzeRisk, riskScore, RISK_RULESET_VERSION, SCORE_FORMULA } from '../../core/domain/risk';
import { identityKey } from '../../core/domain/identity';
import type { DeviceRec, Finding, Severity } from '../../core/domain/types';
import { recToAgent } from '../../app/data';

export function useFindings() {
  const { current } = useNetwork();
  const devices = useLiveQuery(() => (current ? db.devices.where('networkId').equals(current.id).toArray() : []), [current?.id], [] as DeviceRec[]);
  const baseline = useLiveQuery(() => (current ? db.baselines.where('networkId').equals(current.id).toArray() : []), [current?.id], []);
  const assets = useLiveQuery(() => db.assets.toArray(), [], []);
  const findings = useMemo(() => analyzeRisk(devices.map(recToAgent), {
    identityKeyOf: identityKey, baselineKeys: new Set(baseline.map((b) => b.deviceIdentityKey)),
    inventoryIps: new Set(assets.map((a) => a.ipAddress).filter((x): x is string => !!x)),
    inventoryMacs: new Set(assets.map((a) => a.macAddress?.toUpperCase()).filter((x): x is string => !!x)),
  }), [devices, baseline, assets]);
  return { findings, devices, current, score: devices.length ? riskScore(findings) : null };
}

const SEVS: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const WEIGHT: Record<Severity, number> = { critical: 20, high: 12, medium: 4, low: 1, info: 0 };

function grade(score: number) {
  return score >= 90 ? { t: 'Tốt', c: 'var(--ok)' } : score >= 70 ? { t: 'Khá', c: 'var(--ok)' } : score >= 50 ? { t: 'Cần cải thiện', c: 'var(--warn)' } : { t: 'Rủi ro cao', c: 'var(--bad)' };
}
function ScoreRing({ score }: { score: number }) {
  const r = 54; const C = 2 * Math.PI * r; const g = grade(score);
  return (
    <div className="sc-ring" role="img" aria-label={`Điểm an toàn ${score} trên 100`}>
      <svg viewBox="0 0 140 140" width="148" height="148"><circle cx="70" cy="70" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="11" />
        <circle cx="70" cy="70" r={r} fill="none" stroke={g.c} strokeWidth="11" strokeLinecap="round" strokeDasharray={`${(score / 100) * C} ${C}`} transform="rotate(-90 70 70)" style={{ transition: 'stroke-dasharray .6s var(--ease)' }} /></svg>
      <div className="sc-n"><b>{score}</b><span>/100</span></div>
    </div>
  );
}

export default function Security() {
  const { findings, devices, score } = useFindings();
  const [sev, setSev] = useState<Severity | 'all'>('all'); const [open, setOpen] = useState<string>(); const [q, setQ] = useState('');
  const count = (s: Severity) => findings.filter((f) => f.severity === s).length;
  const shown = findings.filter((f) => (sev === 'all' || f.severity === sev) && (!q.trim() || [f.title, f.host, f.ip, f.explanation, f.evidence.join(' ')].some((v) => v.toLowerCase().includes(q.trim().toLowerCase()))));
  const hosts = useMemo(() => {
    const m = new Map<string, { host: string; ip: string; w: number; n: number; top: Severity }>();
    findings.forEach((f) => { const e = m.get(f.ip) ?? { host: f.host, ip: f.ip, w: 0, n: 0, top: f.severity }; e.w += WEIGHT[f.severity]; e.n++; if (SEVS.indexOf(f.severity) < SEVS.indexOf(e.top)) e.top = f.severity; m.set(f.ip, e); });
    return [...m.values()].sort((a, b) => b.w - a.w).slice(0, 5);
  }, [findings]);
  const exportBtn = findings.length ? <button onClick={() => exportCsv('hachihi-security.csv', ['Mức độ', 'IP', 'Tiêu đề', 'Cổng', 'Độ tin cậy', 'Bằng chứng', 'Khuyến nghị', 'Lưu ý dương tính giả'], findings.map((f) => [f.severity, f.ip, f.title, f.port, f.confidence, f.evidence.join(' | '), f.recommendation, f.falsePositiveNote]))}><Download size={15} />Xuất CSV</button> : undefined;

  if (devices.length === 0) return (<>
    <Card><Empty icon={ShieldCheck} title="Chưa có dữ liệu để đánh giá" action={<Link to="/lan"><button className="primary">Mở LAN Scanner</button></Link>}>Security Audit phân tích kết quả quét LAN đã lưu. Hãy quét mạng trước.</Empty></Card>
  </>);
  const g = grade(score ?? 0); const total = findings.length || 1;
  return (<>
    <PageHeader actions={<><span className="small muted">Bộ luật {RISK_RULESET_VERSION} · rule-based, không thử mật khẩu hay khai thác</span><span className="spacer" />{exportBtn}</>} />
    <div className="sec-top">
      <section className="card sec-score">
        <ScoreRing score={score ?? 0} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="small muted">Điểm an toàn mạng</div>
          <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 650, color: g.c }}>{g.t}</div>
          <p className="small muted" style={{ margin: '6px 0 0' }}>{findings.length === 0 ? 'Không phát hiện rủi ro theo bộ luật hiện có trên dữ liệu đã quét.' : `${findings.length} phát hiện trên ${new Set(findings.map((f) => f.ip)).size} thiết bị (trong ${devices.length} thiết bị đã quét).`}</p>
          <details className="small" style={{ marginTop: 8 }}><summary>Cách tính điểm</summary><p className="muted" style={{ margin: '6px 0 0' }}>{SCORE_FORMULA}</p><p className="muted">Điểm 100 nghĩa là <i>không phát hiện rủi ro theo bộ luật hiện có</i> — không phải bảo đảm an toàn tuyệt đối.</p></details>
        </div>
      </section>
      <section className="card sec-sev">
        <div className="card-h"><h2>Phân bố mức độ</h2></div>
        <div className="card-b">
          <div className="sev-bar" role="img" aria-label="Tỷ lệ phát hiện theo mức độ">{SEVS.filter((s) => count(s)).map((s) => <i key={s} style={{ flex: count(s) / total, background: sevColor[s] }} title={`${sevLabel[s]}: ${count(s)}`} />)}{findings.length === 0 && <i style={{ flex: 1, background: 'var(--ok)' }} />}</div>
          <div className="sev-grid">{SEVS.slice(0, 4).map((s) => (
            <button key={s} className={`sev-tile ghost ${sev === s ? 'on' : ''}`} onClick={() => setSev(sev === s ? 'all' : s)} aria-pressed={sev === s}>
              <i style={{ background: sevColor[s] }} /><span>{sevLabel[s]}</span><b>{count(s)}</b></button>))}</div>
        </div>
      </section>
      <section className="card sec-hosts">
        <div className="card-h"><h2>Thiết bị cần ưu tiên</h2></div>
        <div className="card-b" style={{ paddingTop: 8 }}>
          {hosts.length === 0 ? <div className="small muted">Không có thiết bị nào có phát hiện.</div> : hosts.map((h, i) => (
            <div key={h.ip} className="host-row"><span className="rank">{i + 1}</span><div className="ellipsis" style={{ flex: 1 }}><b style={{ fontWeight: 550 }}>{h.host}</b><div className="mono small muted">{h.ip}</div></div><Badge kind={h.top}>{h.n} · {sevLabel[h.top]}</Badge></div>))}
        </div>
      </section>
    </div>

    <div className="row" style={{ margin: '4px 0 12px' }}>
      <div className="seg" role="group" aria-label="Lọc mức độ">
        <button className={sev === 'all' ? 'on' : ''} onClick={() => setSev('all')}>Tất cả<span className="n">{findings.length}</span></button>
        {SEVS.filter((s) => s !== 'info' || count(s)).map((s) => <button key={s} className={sev === s ? 'on' : ''} onClick={() => setSev(s)}>{sevLabel[s]}<span className="n">{count(s)}</span></button>)}
      </div>
      <SearchBox value={q} onChange={setQ} placeholder="Tìm trong phát hiện…" width={240} /><span className="spacer" />
      <span className="small muted">Sắp xếp theo mức ưu tiên (nghiêm trọng → thấp)</span>
    </div>
    {shown.length === 0 ? <Card><Empty icon={findings.length ? Search : ShieldCheck} title={findings.length ? 'Không có phát hiện khớp bộ lọc' : 'Không phát hiện rủi ro'}>{findings.length ? 'Thử đổi mức độ hoặc từ khoá.' : 'Mạng đã quét không vi phạm luật nào trong bộ luật hiện có.'}</Empty></Card>
      : <div className="col" style={{ gap: 8 }}>{shown.map((f, i) => <FindingRow key={f.id} f={f} n={i + 1} open={open === f.id} toggle={() => setOpen(open === f.id ? undefined : f.id)} />)}</div>}
    <p className="small muted" style={{ marginTop: 16 }}>Cổng mở trong LAN là <b>mức độ tiếp xúc (exposure)</b>, không đồng nghĩa với lỗ hổng đã bị khai thác. Mỗi phát hiện có độ tin cậy và ghi chú dương tính giả.</p>
  </>);
}

function FindingRow({ f, n, open, toggle }: { f: Finding; n: number; open: boolean; toggle: () => void }) {
  return (<section className={`finding ${open ? 'open' : ''}`} style={{ ['--sev' as string]: sevColor[f.severity] }}>
    <div className="f-head" onClick={toggle} role="button" tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle())} aria-expanded={open}>
      <span className="f-n">#{n}</span><Badge kind={f.severity}>{sevLabel[f.severity]}</Badge>
      <div style={{ minWidth: 0, flex: 1 }}><b className="f-title">{f.title}</b><div className="mono small muted ellipsis">{f.host}{f.host !== f.ip ? ` · ${f.ip}` : ''}{f.port ? `:${f.port}` : ''}</div></div>
      <span className="hide-sm"><Confidence level={f.confidence} /></span><ChevronDown size={16} style={{ color: 'var(--text-3)', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform var(--t-fast)' }} />
    </div>
    {open && (<div className="f-body">
      <div><div className="section-t">Mô tả</div><p style={{ margin: 0 }}>{f.explanation}</p>
        <div className="section-t">Bằng chứng</div><ul className="f-ev">{f.evidence.map((e, i) => <li key={i} className="mono">{e}</li>)}</ul></div>
      <div><div className="section-t">Hướng khắc phục</div><div className="f-fix"><ListChecks size={16} /><span>{f.recommendation}</span></div>
        <div className="section-t">Có thể là dương tính giả</div><p className="small muted" style={{ margin: 0 }}><AlertTriangle size={13} style={{ verticalAlign: -2, marginRight: 4 }} />{f.falsePositiveNote}</p></div>
    </div>)}
  </section>);
}
void Banner; void SkeletonRows; void Card;
