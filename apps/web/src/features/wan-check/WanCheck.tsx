import { useState } from 'react';
import { useAgent } from '../../app/context';
import { Globe, Lock, Network as NetIcon, ShieldAlert } from 'lucide-react';
import { Badge, Banner, Card, DataTable, PageHeader } from '../../components/ui';
import { dohLookup } from '../../infrastructure/dns/doh';
import { agent, AgentError } from '../../infrastructure/agent/client';
import { SERVICE_NAMES } from '../../core/constants/ports';
import { validateIp } from '../../core/domain/cidr';

type Wan = Awaited<ReturnType<typeof agent.wan>>;
const DEFAULT_PORTS = '80,443,22,21,25,3389,8080,8443';

/** Chặn sớm ở UI: Agent mới là nơi thực thi chính sách thật (resolve + kiểm tra IP trước khi kết nối). */
function cleanTarget(s: string): string | null {
  const t = s.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
  return /^[A-Za-z0-9.-]{1,253}$/.test(t) ? t : null;
}

export default function WanCheck() {
  const { status, has } = useAgent();
  const [target, setTarget] = useState(''); const [authorized, setAuthorized] = useState(false); const [ports, setPorts] = useState(DEFAULT_PORTS);
  const [dns, setDns] = useState<string>(); const [https, setHttps] = useState<string>(); const [tls, setTls] = useState<Record<string, unknown>>(); const [wan, setWan] = useState<Wan>();
  const [busy, setBusy] = useState(''); const [err, setErr] = useState<string>();
  const t = cleanTarget(target);
  const agentOk = status === 'connected';

  const guard = async (name: string, fn: () => Promise<void>) => {
    setBusy(name); setErr(undefined);
    try { await fn(); } catch (e) { setErr(e instanceof AgentError ? `${e.message} (${e.code})` : (e as Error).message); } finally { setBusy(''); }
  };
  const doDns = () => guard('dns', async () => {
    if (!t) throw new Error('Tên miền không hợp lệ.');
    const [a, aaaa] = await Promise.all([dohLookup(t, 'A'), dohLookup(t, 'AAAA')]);
    const all = [...a.answers, ...aaaa.answers].filter((x) => x.type === 1 || x.type === 28).map((x) => x.data);
    setDns(all.length ? `${all.join(', ')} (qua ${a.provider}, ${a.ms} ms)` : 'Không có bản ghi A/AAAA.');
  });
  const doHttps = () => guard('https', async () => {
    if (!t) throw new Error('Tên miền không hợp lệ.');
    const t0 = performance.now(); const c = new AbortController(); const to = setTimeout(() => c.abort(), 8000);
    try { await fetch(`https://${t}/`, { mode: 'no-cors', cache: 'no-store', signal: c.signal }); setHttps(`HTTPS truy cập được (${Math.round(performance.now() - t0)} ms). Trình duyệt không cho đọc header/nội dung do CORS.`); }
    catch { setHttps('Không kết nối HTTPS được (host không phản hồi, chứng chỉ lỗi hoặc bị chặn). Dùng “Kiểm tra TLS” qua Agent để biết chi tiết.'); }
    finally { clearTimeout(to); }
  });
  const doTls = () => guard('tls', async () => { if (!t) throw new Error('Mục tiêu không hợp lệ.'); setTls(await agent.tls(t, 443, authorized)); });
  const doWan = () => guard('wan', async () => {
    if (!t) throw new Error('Mục tiêu không hợp lệ.');
    const list = ports.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 65536);
    setWan(await agent.wan(t, list, authorized));
  });
  const isIpLiteral = !!t && validateIp(t) !== null;

  return (<>
    <PageHeader title="Public Target Check" sub="Kiểm tra host/domain public do bạn sở hữu hoặc được ủy quyền. Chạy cục bộ — Hachihi không có máy chủ quét hộ." />
    <Banner kind="warn"><b>Chỉ kiểm tra mục tiêu bạn sở hữu hoặc có văn bản ủy quyền.</b> Quét hệ thống của bên thứ ba có thể vi phạm pháp luật. Công cụ không hỗ trợ stealth scan, khai thác hay dò mật khẩu; chặn loopback/private/link-local/metadata; giới hạn 20 cổng; có nhật ký audit cục bộ.</Banner>
    <Card title="Mục tiêu" icon={Globe}>
      <div className="row"><input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="example.com hoặc 203.0.113.10" aria-label="Mục tiêu" style={{ minWidth: 280 }} className="mono" />
        {target && !t && <span style={{ color: 'var(--bad)' }}>Giá trị không hợp lệ</span>}</div>
      <label className="chk" style={{ marginTop: 8 }}><input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />Tôi xác nhận sở hữu hoặc được ủy quyền kiểm tra mục tiêu này</label>
    </Card>
    {err && <Banner kind="bad">{err}</Banner>}
    <div className="grid g2">
      <Card title="1 · DNS (trình duyệt, DNS-over-HTTPS)" icon={NetIcon}><button onClick={() => void doDns()} disabled={!t || isIpLiteral || !!busy}>{busy === 'dns' ? 'Đang tra…' : 'Phân giải DNS'}</button>{dns && <p>{dns}</p>}</Card>
      <Card title="2 · HTTPS reachability (trình duyệt)" icon={Lock}><button onClick={() => void doHttps()} disabled={!t || !!busy}>{busy === 'https' ? 'Đang kiểm tra…' : 'Kiểm tra HTTPS'}</button>{https && <p>{https}</p>}</Card>
    </div>
    <Card title="3 · TLS & cổng TCP (qua Agent)" icon={ShieldAlert}>
      {!agentOk || !has('wan.check') ? <p className="muted">Cần Agent đã ghép cặp để kiểm tra chứng chỉ TLS và cổng TCP thật.</p> : (<>
        <div className="row"><button onClick={() => void doTls()} disabled={!t || !authorized || !!busy}>{busy === 'tls' ? 'Đang kiểm tra…' : 'Kiểm tra chứng chỉ TLS (443)'}</button>
          <input value={ports} onChange={(e) => setPorts(e.target.value)} className="mono" aria-label="Danh sách cổng" style={{ width: 260 }} />
          <button onClick={() => void doWan()} disabled={!t || !authorized || !!busy}>{busy === 'wan' ? 'Đang kiểm tra…' : 'Kiểm tra cổng TCP'}</button></div>
        {!authorized && <p className="small muted">Cần tick xác nhận ủy quyền ở trên.</p>}
        {tls && (tls.success ? (<dl className="kv" style={{ marginTop: 10 }}><dt>Subject</dt><dd>{String(tls.subject)}</dd><dt>Issuer</dt><dd>{String(tls.issuer)}</dd>
          <dt>Hiệu lực</dt><dd>{new Date(String(tls.validFrom)).toLocaleDateString('vi-VN')} → {new Date(String(tls.validTo)).toLocaleDateString('vi-VN')} <Badge kind={Number(tls.daysRemaining) < 14 ? 'bad' : Number(tls.daysRemaining) < 30 ? 'warn' : 'ok'}>còn {String(tls.daysRemaining)} ngày</Badge></dd>
          <dt>TLS</dt><dd>{String(tls.tlsVersion)}{tls.selfSigned ? ' · tự ký' : ''}</dd><dt>SHA-256</dt><dd className="mono small">{String(tls.sha256)}</dd></dl>) : <Banner kind="warn">Không bắt tay TLS được: {String(tls.error)}</Banner>)}
        {wan && (<div style={{ marginTop: 10 }}><p className="small muted">Phân giải: {wan.resolved.join(', ')} · kết nối tới {wan.connectedTo}</p>
          <DataTable search={false} rows={wan.results} rowKey={(r) => String(r.port)} cols={[
            { key: 'p', header: 'Cổng', render: (r) => r.port, sort: (a, b) => a.port - b.port },
            { key: 's', header: 'Dịch vụ', render: (r) => r.service || SERVICE_NAMES[r.port] || '—' },
            { key: 'st', header: 'Trạng thái', render: (r) => <Badge dot kind={/open/i.test(r.state) ? 'warn' : 'mute'}>{r.state}</Badge> },
            { key: 'l', header: 'Độ trễ', render: (r) => (r.latencyMs ? `${r.latencyMs.toFixed(0)} ms` : '—') }, { key: 'b', header: 'Banner', render: (r) => r.banner ?? '' }]} /></div>)}
      </>)}
    </Card>
  </>);
}
