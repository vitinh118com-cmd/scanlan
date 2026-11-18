import { useEffect, useMemo, useState } from 'react';
import { Banner, Card, DataTable, PageHeader, Tabs } from '../../components/ui';
import { parseCidr, rangeToCidrs, splitCidr, validateIp, ipInCidr } from '../../core/domain/cidr';
import { SERVICE_NAMES } from '../../core/constants/ports';
import { dohLookup, DNS_STATUS, RECORD_TYPES, type DnsResult } from '../../infrastructure/dns/doh';
import { lookupVendor, ouiVersion } from '../../infrastructure/oui/oui';

const TABS = ['CIDR', 'Dải IP → CIDR', 'OUI / MAC', 'Cổng & dịch vụ', 'DNS', 'IP public', 'Kiểm tra HTTPS'] as const;
type Tab = (typeof TABS)[number];

export default function Tools() {
  const [tab, setTab] = useState<Tab>('CIDR');
  return (<>
    <PageHeader title="Network Tools" sub="Công cụ chạy ngay trong trình duyệt, không cần Agent. Công cụ gọi dịch vụ bên ngoài sẽ ghi rõ." />
    <Tabs value={tab} onChange={setTab} tabs={TABS.map((t) => ({ value: t, label: t }))} />
    {tab === 'CIDR' && <CidrTool />}{tab === 'Dải IP → CIDR' && <RangeTool />}{tab === 'OUI / MAC' && <OuiTool />}
    {tab === 'Cổng & dịch vụ' && <PortsTool />}{tab === 'DNS' && <DnsTool />}{tab === 'IP public' && <PublicIpTool />}{tab === 'Kiểm tra HTTPS' && <HttpTool />}
  </>);
}

function CidrTool() {
  const [v, setV] = useState('192.168.1.0/24'); const [split, setSplit] = useState(26); const [test, setTest] = useState('');
  const i = parseCidr(v); const parts = i && split > i.prefix && split <= 32 && 2 ** (split - i.prefix) <= 256 ? splitCidr(i.cidr, split) : null;
  const rows: [string, string | number][] = i ? [['CIDR chuẩn hoá', i.cidr], ['Network', i.network], ['Broadcast', i.broadcast], ['Netmask', i.netmask], ['Wildcard', i.wildcard], ['Host đầu', i.firstHost], ['Host cuối', i.lastHost],
    ['Tổng địa chỉ', i.totalAddresses.toLocaleString('vi-VN')], ['Host khả dụng', i.usableHosts.toLocaleString('vi-VN')], ['Lớp', i.ipClass], ['Dải private (RFC 1918)', i.isPrivate ? 'Có' : 'Không']] : [];
  return (<Card title="Máy tính subnet / CIDR">
    <div className="row"><input className="mono" value={v} onChange={(e) => setV(e.target.value)} aria-label="CIDR" placeholder="10.0.0.0/22" /></div>
    {!i ? <p style={{ color: 'var(--bad)' }}>Nhập CIDR IPv4 hợp lệ, ví dụ 192.168.1.0/24.</p> : (<>
      <dl className="kv" style={{ marginTop: 10 }}>{rows.map(([k, x]) => [<dt key={k}>{k}</dt>, <dd key={k + 'v'} className="mono">{x}</dd>])}</dl>
      <p className="small muted">/31 (RFC 3021) và /32 dùng toàn bộ địa chỉ; các prefix còn lại trừ network và broadcast.</p>
      <div className="row"><label className="f">Chia nhỏ thành /<input type="number" min={i.prefix + 1} max={32} value={split} onChange={(e) => setSplit(Number(e.target.value))} style={{ width: 80 }} /></label>
        <label className="f">Kiểm tra IP thuộc dải?<input className="mono" value={test} onChange={(e) => setTest(e.target.value)} placeholder="192.168.1.77" /></label>
        {test && validateIp(test) === 'ipv4' && <b style={{ color: ipInCidr(test, i.cidr) ? 'var(--ok)' : 'var(--bad)' }}>{ipInCidr(test, i.cidr) ? 'Thuộc dải' : 'Không thuộc dải'}</b>}</div>
      {parts && <details open style={{ marginTop: 8 }}><summary>{parts.length} subnet con</summary><pre className="log">{parts.join('\n')}</pre></details>}
    </>)}
  </Card>);
}

function RangeTool() {
  const [a, setA] = useState('192.168.1.10'); const [b, setB] = useState('192.168.1.200'); const r = rangeToCidrs(a, b);
  return (<Card title="Dải IP → danh sách CIDR tối thiểu">
    <div className="row"><input className="mono" value={a} onChange={(e) => setA(e.target.value)} aria-label="IP đầu" /><span>→</span><input className="mono" value={b} onChange={(e) => setB(e.target.value)} aria-label="IP cuối" /></div>
    {r ? <pre className="log">{r.join('\n')}</pre> : <p style={{ color: 'var(--bad)' }}>Dải không hợp lệ (IP đầu phải ≤ IP cuối).</p>}
  </Card>);
}

function OuiTool() {
  const [v, setV] = useState(''); const [res, setRes] = useState<Awaited<ReturnType<typeof lookupVendor>>>(); const [err, setErr] = useState<string>(); const [ver, setVer] = useState<string>();
  useEffect(() => { ouiVersion().then((x) => setVer(`${x.entries.toLocaleString('vi-VN')} mã (${x.version})`)).catch(() => undefined); }, []);
  const go = async () => { setErr(undefined); try { setRes(await lookupVendor(v)); } catch (e) { setErr((e as Error).message); } };
  return (<Card title="Tra cứu hãng sản xuất theo MAC (OUI)">
    <div className="row"><input className="mono" value={v} onChange={(e) => setV(e.target.value)} placeholder="AA:BB:CC:DD:EE:FF" aria-label="MAC" onKeyDown={(e) => e.key === 'Enter' && void go()} /><button className="primary" onClick={() => void go()}>Tra cứu</button></div>
    {err && <Banner kind="bad">{err}</Banner>}{res === null && <p style={{ color: 'var(--bad)' }}>Cần ít nhất 6 ký tự hex.</p>}
    {res && <p><b>{res.vendor ?? 'Không tìm thấy trong dataset'}</b> {res.kind && <span className="small muted">({res.kind})</span>}{res.randomized && <><br /><span className="small" style={{ color: 'var(--warn)' }}>MAC ngẫu nhiên / locally administered — thường là điện thoại bật “địa chỉ WiFi riêng tư”; không tra được hãng thật.</span></>}</p>}
    <p className="small muted">Dataset IEEE (MA-L/MA-M/MA-S) chạy cục bộ, không gửi MAC đi đâu. {ver}</p>
  </Card>);
}

function PortsTool() {
  const [all, setAll] = useState<Record<string, string>>(); const [err, setErr] = useState<string>();
  useEffect(() => { fetch('/data/ports.json').then((r) => r.json()).then(setAll).catch((e) => setErr(String(e))); }, []);
  const rows = useMemo(() => Object.entries(all ?? {}).map(([p, s]) => ({ port: Number(p), svc: s, note: SERVICE_NAMES[Number(p)] ?? '' })), [all]);
  return (<Card title="Tra cứu cổng & dịch vụ (IANA)">
    {err && <Banner kind="bad">Không tải được dataset cổng.</Banner>}
    <DataTable rows={rows} rowKey={(r) => String(r.port)} cols={[{ key: 'p', header: 'Cổng', render: (r) => <span className="mono">{r.port}</span>, sort: (a, b) => a.port - b.port, text: (r) => String(r.port) },
      { key: 's', header: 'Dịch vụ (IANA)', render: (r) => r.svc, text: (r) => r.svc }, { key: 'n', header: 'Ghi chú Hachihi', render: (r) => r.note, text: (r) => r.note }]} />
    <p className="small muted">Chỉ để tra cứu — không thực hiện quét. Mục “ghi chú” lấy từ danh sách dịch vụ của bản WinForms.</p>
  </Card>);
}

function DnsTool() {
  const [n, setN] = useState('example.com'); const [t, setT] = useState<string>('A'); const [r, setR] = useState<DnsResult>(); const [err, setErr] = useState<string>(); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); setErr(undefined); setR(undefined); try { setR(await dohLookup(n, t)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  return (<Card title="Tra cứu DNS (DNS-over-HTTPS)">
    <Banner>Tên miền bạn nhập được gửi tới resolver công cộng (Cloudflare, dự phòng Google) qua HTTPS.</Banner>
    <div className="row"><input value={n} onChange={(e) => setN(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void go()} aria-label="Tên miền" />
      <select value={t} onChange={(e) => setT(e.target.value)}>{RECORD_TYPES.map((x) => <option key={x}>{x}</option>)}</select><button className="primary" onClick={() => void go()} disabled={busy}>{busy ? 'Đang tra…' : 'Tra cứu'}</button></div>
    {err && <Banner kind="bad">{err}</Banner>}
    {r && (<><p className="small muted">{r.provider} · {r.ms} ms · {DNS_STATUS[r.status] ?? r.status}</p>
      <DataTable search={false} rows={r.answers} rowKey={(a) => a.name + a.type + a.data} cols={[{ key: 'n', header: 'Tên', render: (a) => a.name }, { key: 't', header: 'Loại', render: (a) => a.type }, { key: 'ttl', header: 'TTL', render: (a) => a.TTL }, { key: 'd', header: 'Dữ liệu', render: (a) => <span className="mono">{a.data}</span> }]} empty="Không có bản ghi." /></>)}
  </Card>);
}

function PublicIpTool() {
  const [ip, setIp] = useState<string>(); const [err, setErr] = useState<string>();
  const go = async () => { setErr(undefined); try { const j = await (await fetch('https://api.ipify.org?format=json', { cache: 'no-store' })).json(); setIp(String(j.ip)); } catch { setErr('Không lấy được IP public (dịch vụ bị chặn hoặc offline).'); } };
  return (<Card title="IP public của bạn"><Banner>Chỉ chạy khi bạn bấm nút. Yêu cầu được gửi tới api.ipify.org (bên thứ ba) và dịch vụ đó sẽ thấy IP public của bạn.</Banner>
    <button className="primary" onClick={() => void go()}>Lấy IP public</button>{ip && <p className="mono" style={{ fontSize: 20 }}>{ip}</p>}{err && <Banner kind="bad">{err}</Banner>}</Card>);
}

function HttpTool() {
  const [u, setU] = useState('https://example.com'); const [r, setR] = useState<string>(); const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setR(undefined); let url: URL;
    try { url = new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u); } catch { setR('URL không hợp lệ.'); setBusy(false); return; }
    const c = new AbortController(); const to = setTimeout(() => c.abort(), 8000); const t0 = performance.now();
    try { await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: c.signal }); setR(`Kết nối được tới ${url.host} sau ${Math.round(performance.now() - t0)} ms. Do CORS, trình duyệt không cho đọc mã trạng thái/header — chỉ biết máy chủ có phản hồi.`); }
    catch { setR(`Không kết nối được tới ${url.host} (không phản hồi, lỗi TLS hoặc bị chặn).`); } finally { clearTimeout(to); setBusy(false); }
  };
  return (<Card title="Kiểm tra truy cập HTTP(S) từ trình duyệt"><div className="row"><input value={u} onChange={(e) => setU(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void go()} aria-label="URL" style={{ minWidth: 280 }} />
    <button className="primary" onClick={() => void go()} disabled={busy}>{busy ? 'Đang kiểm tra…' : 'Kiểm tra'}</button></div>{r && <p>{r}</p>}</Card>);
}
