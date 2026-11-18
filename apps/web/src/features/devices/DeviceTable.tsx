import { useMemo, useState, type ReactNode } from 'react';
import { Search as SearchIcon } from 'lucide-react';
import { Badge, Confidence, Drawer, Empty, SearchBox, Segmented, StatusBadge, VTable, sevLabel, type VCol } from '../../components/ui';
import { DeviceAvatar, KIND, KIND_ORDER, kindOf, type DevKind } from '../../components/icons';
import { SERVICE_NAMES } from '../../core/constants/ports';
import type { AgentDevice, Finding } from '../../core/domain/types';

export const SOURCE_INFO: Record<string, string> = {
  ARP: 'Có trong bảng ARP của máy quét → thiết bị thực sự ở cùng mạng L2; cung cấp MAC.',
  ICMP: 'Phản hồi ping (ICMP echo) → thiết bị đang online; cho độ trễ.',
  TCP: 'Kết nối TCP tới cổng phổ biến thành công → xác nhận dịch vụ đang mở.',
  NBNS: 'Trả lời NetBIOS Name Service → tên máy Windows.',
  mDNS: 'Quảng bá Bonjour/mDNS → tên và dịch vụ (Apple, máy in, NAS…).',
  SSDP: 'Phản hồi UPnP/SSDP → mô tả thiết bị (router, TV, NAS…).',
  SNMP: 'Trả lời SNMP → mô tả hệ thống do chính thiết bị khai báo.',
  SADP: 'Giao thức SADP của Hikvision → xác định camera/NVR chắc chắn hơn.',
  ONVIF: 'Phản hồi ONVIF WS-Discovery → camera/NVR.',
};

export const hostOf = (d: AgentDevice) => d.hostname || d.vendor || d.ipAddress;
const ipNum = (s: string) => s.split('.').reduce((a, p) => a * 256 + Number(p), 0);

type SortK = 'dev' | 'mac' | 'vendor' | 'type' | 'st' | 'ping' | 'ports';
const CMP: Record<SortK, (a: AgentDevice, b: AgentDevice) => number> = {
  dev: (a, b) => ipNum(a.ipAddress) - ipNum(b.ipAddress), mac: (a, b) => (a.macAddress ?? '').localeCompare(b.macAddress ?? ''), vendor: (a, b) => (a.vendor ?? '~').localeCompare(b.vendor ?? '~'),
  type: (a, b) => a.deviceType.localeCompare(b.deviceType), st: (a, b) => a.status.localeCompare(b.status), ping: (a, b) => (a.pingMs ?? 1e9) - (b.pingMs ?? 1e9), ports: (a, b) => a.openPorts.length - b.openPorts.length,
};

export function DeviceDetail({ d, gateway, findings, extra }: { d: AgentDevice; gateway?: string; findings?: Finding[]; extra?: ReactNode }) {
  const k = kindOf(d, gateway);
  const mine = (findings ?? []).filter((f) => f.ip === d.ipAddress);
  return (<>
    <div className="row nowrap" style={{ marginBottom: 14 }}>
      <DeviceAvatar kind={k} size="lg" off={d.status === 'offline'} />
      <div style={{ minWidth: 0 }}><b style={{ fontSize: 'var(--fs-lg)' }}>{hostOf(d)}</b><div className="row tight"><StatusBadge status={d.status} /><span className="small muted">{KIND[k].label}</span></div></div>
    </div>
    <dl className="kv">
      <dt>Địa chỉ IP</dt><dd className="mono">{d.ipAddress}{gateway === d.ipAddress && <> <Badge kind="accent">Gateway</Badge></>}</dd>
      <dt>MAC</dt><dd className="mono">{d.macAddress ?? '—'}{d.macRandomized && <> <Badge kind="mute">ngẫu nhiên</Badge></>}</dd>
      <dt>Hostname</dt><dd>{d.hostname ?? '—'}</dd>
      <dt>Hãng</dt><dd>{d.vendor ?? '—'}</dd>
      <dt>Loại (suy đoán)</dt><dd>{d.deviceType}<div><Confidence level={d.classificationConfidence} /></div></dd>
      <dt>OS (suy đoán)</dt><dd>{d.osGuess ?? '—'}</dd>
      <dt>Độ trễ</dt><dd className="mono">{d.pingMs != null ? `${d.pingMs} ms` : '—'}</dd>
      {d.httpTitle && <><dt>HTTP title</dt><dd>{d.httpTitle}</dd></>}
      {d.note && <><dt>Ghi chú</dt><dd>{d.note}</dd></>}
    </dl>
    {d.macRandomized && <p className="small muted" style={{ marginTop: 10 }}>MAC “ngẫu nhiên” (locally administered) thường là điện thoại/laptop bật Private Address — không phải định danh bền vững.</p>}
    <div className="section-t">Nguồn phát hiện</div>
    <div className="col" style={{ gap: 8 }}>
      {d.source.length === 0 && <span className="muted small">Không có thông tin.</span>}
      {d.source.map((s) => <div key={s} className="row nowrap" style={{ alignItems: 'flex-start' }}><span className="chip">{s}</span><span className="small muted">{SOURCE_INFO[s] ?? 'Nguồn dữ liệu do Agent báo cáo.'}</span></div>)}
    </div>
    <div className="section-t">Cổng mở ({d.openPorts.length})</div>
    {d.openPorts.length === 0 ? <span className="muted small">Không phát hiện cổng mở trong danh sách quét.</span> : (
      <div className="tablewrap"><table><thead><tr><th>Cổng</th><th>Giao thức</th><th>Dịch vụ</th></tr></thead><tbody>{d.openPorts.map((p) => <tr key={p.port}><td className="mono">{p.port}</td><td>{p.protocol}</td><td>{SERVICE_NAMES[p.port] ?? p.service}</td></tr>)}</tbody></table></div>
    )}
    {mine.length > 0 && (<>
      <div className="section-t">Cảnh báo bảo mật ({mine.length})</div>
      <div className="col" style={{ gap: 8 }}>{mine.map((f) => <div key={f.id} className="row nowrap" style={{ alignItems: 'flex-start' }}><Badge kind={f.severity}>{sevLabel[f.severity]}</Badge><span>{f.title}</span></div>)}</div>
    </>)}
    {extra}
  </>);
}

/** Bảng thiết bị dùng chung cho LAN Scanner và Device Inventory: lọc theo loại/trạng thái, tìm kiếm, sắp xếp, panel chi tiết. */
export function DeviceTable({ devices, gateway, findings, empty, drawerExtra, drawerFooter, footer, tall }: { tall?: boolean; devices: AgentDevice[]; gateway?: string; findings?: Finding[]; empty?: ReactNode; drawerExtra?: (d: AgentDevice) => ReactNode; drawerFooter?: (d: AgentDevice) => ReactNode; footer?: ReactNode }) {
  const [q, setQ] = useState(''); const [status, setStatus] = useState<'all' | 'online' | 'offline'>('all'); const [kind, setKind] = useState<DevKind | 'all'>('all');
  const [sort, setSort] = useState<{ k: string; dir: number } | null>({ k: 'dev', dir: 1 }); const [sel, setSel] = useState<string | null>(null);
  const withKind = useMemo(() => devices.map((d) => ({ d, k: kindOf(d, gateway) })), [devices, gateway]);
  const kinds = useMemo(() => KIND_ORDER.filter((k) => withKind.some((x) => x.k === k)), [withKind]);
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    let r = withKind.filter((x) => (status === 'all' || x.d.status === status) && (kind === 'all' || x.k === kind));
    if (n) r = r.filter(({ d }) => [d.ipAddress, d.macAddress, d.hostname, d.vendor, d.deviceType, d.osGuess, d.httpTitle, d.source.join(' '), d.openPorts.map((p) => p.port + ' ' + p.service).join(' ')].some((v) => (v ?? '').toLowerCase().includes(n)));
    if (sort) { const c = CMP[sort.k as SortK]; r = [...r].sort((a, b) => c(a.d, b.d) * sort.dir); }
    return r.map((x) => x.d);
  }, [withKind, q, status, kind, sort]);
  const on = devices.filter((d) => d.status === 'online').length;
  const kindMap = useMemo(() => new Map(withKind.map((x) => [x.d.ipAddress, x.k])), [withKind]);
  const selected = sel ? devices.find((d) => d.ipAddress === sel) : undefined;

  const cols: VCol<AgentDevice>[] = [
    { key: 'dev', header: 'Thiết bị', width: 'minmax(220px,2.2fr)', sort: CMP.dev, render: (d) => (
      <div className="row nowrap" style={{ gap: 10 }}><DeviceAvatar kind={kindMap.get(d.ipAddress) ?? 'other'} off={d.status === 'offline'} />
        <div className="ellipsis"><b className="ellipsis" style={{ display: 'block', fontWeight: 550 }}>{d.hostname ?? <span className="muted">{d.vendor ?? 'Không rõ tên'}</span>}</b><span className="mono small muted">{d.ipAddress}</span></div></div>) },
    { key: 'mac', header: 'MAC', width: 'minmax(150px,1.2fr)', sort: CMP.mac, hideBelow: 900, render: (d) => <span className="mono small">{d.macAddress ?? '—'}{d.macRandomized && <> <Badge kind="mute">rand</Badge></>}</span> },
    { key: 'vendor', header: 'Hãng', width: 'minmax(100px,1fr)', sort: CMP.vendor, hideBelow: 1100, render: (d) => d.vendor ?? <span className="muted">—</span> },
    { key: 'type', header: 'Loại · tin cậy', width: 'minmax(170px,1.6fr)', sort: CMP.type, render: (d) => <div className="ellipsis">{KIND[kindMap.get(d.ipAddress) ?? 'other'].label}<div><Confidence level={d.classificationConfidence} /></div></div> },
    { key: 'st', header: 'Trạng thái', width: '104px', sort: CMP.st, render: (d) => <StatusBadge status={d.status} /> },
    { key: 'ping', header: 'Ping', width: '76px', sort: CMP.ping, hideBelow: 760, render: (d) => <span className="mono small">{d.pingMs != null ? `${d.pingMs} ms` : '—'}</span> },
    { key: 'ports', header: 'Cổng', width: 'minmax(120px,1.3fr)', sort: CMP.ports, hideBelow: 1000, render: (d) => <span className="small">{d.openPorts.length ? d.openPorts.slice(0, 3).map((p) => p.port).join(', ') + (d.openPorts.length > 3 ? ` +${d.openPorts.length - 3}` : '') : <span className="muted">—</span>}</span> },
    { key: 'src', header: 'Nguồn', width: 'minmax(130px,1.2fr)', hideBelow: 1200, render: (d) => <span className="row tight nowrap">{d.source.slice(0, 3).map((s) => <span key={s} className="chip">{s}</span>)}{d.source.length > 3 && <span className="small muted">+{d.source.length - 3}</span>}</span> },
  ];
  return (<>
    <div className="row" style={{ marginBottom: 12 }}>
      <SearchBox value={q} onChange={setQ} placeholder="Tìm IP, MAC, hostname, hãng, cổng…" width={300} />
      <Segmented label="Trạng thái" value={status} onChange={setStatus} options={[{ value: 'all', label: 'Tất cả', count: devices.length }, { value: 'online', label: 'Online', count: on }, { value: 'offline', label: 'Offline', count: devices.length - on }]} />
      <select value={kind} onChange={(e) => setKind(e.target.value as DevKind | 'all')} aria-label="Lọc theo loại thiết bị"><option value="all">Mọi loại thiết bị</option>{kinds.map((k) => <option key={k} value={k}>{KIND[k].label}</option>)}</select>
      <span className="spacer" /><span className="small muted">{rows.length}/{devices.length} thiết bị</span>
    </div>
    <div className={`table-fill ${tall ? "tall" : ""}`}>
      <VTable rows={rows} cols={cols} rowKey={(d) => d.ipAddress} selectedKey={sel} onRow={(d) => setSel(d.ipAddress === sel ? null : d.ipAddress)}
        sort={sort} onSort={(k) => setSort((s) => (s?.k === k ? { k, dir: s.dir * -1 } : { k, dir: 1 }))} footer={footer}
        empty={devices.length === 0 ? (empty ?? <Empty icon={SearchIcon} title="Chưa có thiết bị" />) : <Empty icon={SearchIcon} title="Không có thiết bị khớp bộ lọc"><button className="sm" onClick={() => { setQ(''); setStatus('all'); setKind('all'); }}>Xoá bộ lọc</button></Empty>} />
    </div>
    <Drawer open={!!selected} modal={false} onClose={() => setSel(null)} title={selected ? hostOf(selected) : ''} subtitle={selected?.ipAddress} footer={selected && drawerFooter?.(selected)}>
      {selected && <DeviceDetail d={selected} gateway={gateway} findings={findings} extra={drawerExtra?.(selected)} />}
    </Drawer>
  </>);
}
