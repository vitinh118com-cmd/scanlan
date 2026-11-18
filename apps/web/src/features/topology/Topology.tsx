import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Background, BackgroundVariant, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Link } from 'react-router-dom';
import { Download, Maximize, RotateCcw, Save, Waypoints, ZoomIn, ZoomOut, Info } from 'lucide-react';
import { useNetwork } from '../../app/context';
import { recToAgent, useNetData } from '../../app/data';
import { Badge, Banner, Card, Empty, PageHeader, SearchBox, SkeletonRows, sevColor } from '../../components/ui';
import { KIND, KIND_ORDER, kindOf, type DevKind } from '../../components/icons';
import { useThemeKey } from '../../components/Chart';
import { DeviceDetail, hostOf } from '../devices/DeviceTable';
import { Drawer } from '../../components/ui';
import { db } from '../../infrastructure/db/db';
import { downloadText } from '../../infrastructure/db/backup';
import type { DeviceRec } from '../../core/domain/types';

const NW = 176; const NH = 60; const GX = 16; const GY = 16; const PAD = 16; const HEAD = 34; const MAXW = 1500;
interface DevData extends Record<string, unknown> { device: DeviceRec; kind: DevKind; sev?: string; match?: boolean; dim?: boolean }
interface GrpData extends Record<string, unknown> { label: string; count: number; online: number; w: number; h: number }
type DevNode = Node<DevData, 'dev'>; type GrpNode = Node<GrpData, 'grp'>;

const GROUPS: { id: string; label: string; kinds: DevKind[] }[] = [
  { id: 'srv', label: 'Máy chủ & lưu trữ', kinds: ['server', 'nas'] }, { id: 'cam', label: 'Camera & NVR', kinds: ['camera', 'nvr'] },
  { id: 'pc', label: 'Máy tính', kinds: ['workstation'] }, { id: 'phone', label: 'Điện thoại', kinds: ['phone'] },
  { id: 'prn', label: 'Máy in', kinds: ['printer'] }, { id: 'iot', label: 'IoT & chưa rõ', kinds: ['iot', 'other'] },
];
const ipNum = (s: string) => s.split('.').reduce((a, p) => a * 256 + Number(p), 0);
const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

/** Bố cục phân tầng, xác định (không ngẫu nhiên) và không chồng lấn: Gateway ở đỉnh → hạ tầng (switch/AP) → các nhóm thiết bị (khung chứa lưới node). */
export function layout(devices: DeviceRec[], gateway: string | undefined, sevByIp: Map<string, string>) {
  const items = devices.map((d) => ({ d, k: kindOf(d, gateway) }));
  const root = items.find((x) => x.d.ipAddress === gateway) ?? items.find((x) => x.k === 'router');
  const rest = items.filter((x) => x !== root).sort((a, b) => ipNum(a.d.ipAddress) - ipNum(b.d.ipAddress));
  const nodes: (DevNode | GrpNode)[] = []; const edges: Edge[] = [];
  const dev = (x: { d: DeviceRec; k: DevKind }, pos: { x: number; y: number }, parentId?: string): DevNode => ({
    id: x.d.id, type: 'dev', position: pos, ...(parentId ? { parentId, extent: 'parent' as const } : {}), data: { device: x.d, kind: x.k, sev: sevByIp.get(x.d.ipAddress) }, width: NW, height: NH,
  });
  const link = (s: string, t: string, off: boolean): Edge => ({ id: `${s}->${t}`, source: s, target: t, type: 'smoothstep', className: `lk inferred${off ? ' off' : ''}`, data: { inferred: true } });
  const infra = rest.filter((x) => x.k === 'switch' || x.k === 'ap');
  const infraW = infra.length * (NW + GX) - GX;
  const grouped = GROUPS.map((g) => ({ g, list: rest.filter((x) => g.kinds.includes(x.k)) })).filter((x) => x.list.length);
  // đóng gói các khung nhóm theo hàng
  const boxes = grouped.map(({ g, list }) => {
    const cols = Math.max(1, Math.min(list.length <= 4 ? list.length : list.length <= 12 ? 3 : 4, 4)); const rows = Math.ceil(list.length / cols);
    return { g, list, cols, w: cols * NW + (cols - 1) * GX + PAD * 2, h: HEAD + rows * NH + (rows - 1) * GY + PAD };
  }).sort((a, b) => b.list.length - a.list.length);
  const placed: { b: (typeof boxes)[number]; x: number; y: number }[] = []; let x = 0; let y = 0; let rowH = 0; let totalW = 0;
  for (const b of boxes) { if (x > 0 && x + b.w > MAXW) { x = 0; y += rowH + 28; rowH = 0; } placed.push({ b, x, y }); x += b.w + 28; rowH = Math.max(rowH, b.h); totalW = Math.max(totalW, x - 28); }
  const width = Math.max(totalW, infraW, NW);
  const cx = width / 2;
  const rootId = root?.d.id;
  if (root) nodes.push(dev(root, { x: cx - NW / 2, y: 0 }));
  const infraY = root ? 140 : 0; let gy = infra.length ? infraY + NH + 70 : root ? 140 : 0;
  infra.forEach((x2, i) => { nodes.push(dev(x2, { x: cx - infraW / 2 + i * (NW + GX), y: infraY })); if (rootId) edges.push(link(rootId, x2.d.id, x2.d.status === 'offline')); });
  if (!infra.length && root) gy = 140;
  placed.forEach(({ b, x: bx, y: by }) => {
    const gid = 'grp-' + b.g.id; const on = b.list.filter((q) => q.d.status === 'online').length;
    nodes.push({ id: gid, type: 'grp', position: { x: bx, y: gy + by }, data: { label: b.g.label, count: b.list.length, online: on, w: b.w, h: b.h }, width: b.w, height: b.h, zIndex: -1, selectable: false } as GrpNode);
    b.list.forEach((q, i) => nodes.push(dev(q, { x: PAD + (i % b.cols) * (NW + GX), y: HEAD + Math.floor(i / b.cols) * (NH + GY) }, gid)));
    if (rootId) edges.push({ ...link(rootId, gid, on === 0), id: `${rootId}->${gid}` });
  });
  return { nodes, edges, root, width, height: gy + (placed.length ? Math.max(...placed.map((p) => p.y + p.b.h)) : 0) };
}

const DevNodeView = memo(function DevNodeView({ data, selected }: NodeProps<DevNode>) {
  const { device: d, kind, sev, match, dim } = data; const I = KIND[kind].icon; const off = d.status === 'offline';
  return (
    <div className={`tp-node k-${kind} ${off ? 'off' : ''} ${selected ? 'sel' : ''} ${match ? 'match' : ''} ${dim ? 'dim' : ''}`} title={`${hostOf(recToAgent(d))} · ${d.ipAddress}`}>
      <Handle type="target" position={Position.Top} className="tp-h" isConnectable={false} /><Handle type="source" position={Position.Bottom} className="tp-h" isConnectable={false} />
      <span className={`avatar k-${kind}`}><I size={18} strokeWidth={1.8} /></span>
      <div className="tp-txt"><b className="ellipsis">{d.hostname ?? d.vendor ?? 'Không rõ tên'}</b><span className="mono ellipsis">{d.ipAddress}</span></div>
      <i className={`tp-dot ${off ? 'off' : 'on'}`} />
      {sev && SEV_RANK[sev] >= 3 && <i className="tp-sev" style={{ background: sevColor[sev] }} title={`Rủi ro: ${sev}`} />}
    </div>
  );
});
const GrpNodeView = memo(function GrpNodeView({ data }: NodeProps<GrpNode>) {
  return (
    <div className="tp-grp" style={{ width: data.w, height: data.h }}>
      <Handle type="target" position={Position.Top} className="tp-h" isConnectable={false} />
      <div className="tp-grp-h"><b>{data.label}</b><span className="chip">{data.count}</span><span className="small muted">{data.online} online</span></div>
    </div>
  );
});
const nodeTypes = { dev: DevNodeView, grp: GrpNodeView };

function Canvas() {
  const { current } = useNetwork(); const { findings } = useNetData();
  const theme = useThemeKey(); const rf = useReactFlow();
  const devices = useLiveQuery(() => (current ? db.devices.where('networkId').equals(current.id).toArray() : []), [current?.id]);
  const saved = useLiveQuery(() => (current ? db.topologyLayouts.get(current.id) : undefined), [current?.id]);
  const sevByIp = useMemo(() => { const m = new Map<string, string>(); findings.forEach((f) => { if ((SEV_RANK[f.severity] ?? 0) > (SEV_RANK[m.get(f.ip) ?? 'info'] ?? 0)) m.set(f.ip, f.severity); }); return m; }, [findings]);
  const base = useMemo(() => layout(devices ?? [], current?.gateway, sevByIp), [devices, current?.gateway, sevByIp]);
  const [nodes, setNodes, onNodesChange] = useNodesState<DevNode | GrpNode>([]); const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [sel, setSel] = useState<string | null>(null); const [q, setQ] = useState(''); const [hide, setHide] = useState<Set<DevKind>>(new Set()); const [msg, setMsg] = useState<string>(); const [legend, setLegend] = useState(() => window.innerWidth >= 1500 && window.innerHeight >= 900);
  const lookup = useMemo(() => new Map((devices ?? []).map((d) => [d.id, d])), [devices]);
  const selected = sel ? lookup.get(sel) : undefined;

  useEffect(() => {
    const needle = q.trim().toLowerCase();
    setNodes(base.nodes.map((n) => {
      const pos = saved?.positions[n.id] ? { position: saved.positions[n.id] } : {};
      if (n.type !== 'dev') return { ...n, ...pos };
      const d = (n as DevNode).data; const m = needle && [d.device.ipAddress, d.device.hostname, d.device.vendor, d.device.macAddress, d.device.deviceType].some((v) => (v ?? '').toLowerCase().includes(needle));
      return { ...n, ...pos, hidden: hide.has(d.kind), data: { ...d, match: !!m, dim: !!needle && !m } } as DevNode;
    }));
    setEdges(base.edges);
  }, [base, saved, q, hide, setNodes, setEdges]);
  useEffect(() => { const t = setTimeout(() => rf.fitView({ padding: 0.12, duration: 250, maxZoom: 1.1 }), 60); return () => clearTimeout(t); }, [base.nodes.length, rf]);

  const kinds = useMemo(() => KIND_ORDER.map((k) => ({ k, n: (devices ?? []).filter((d) => kindOf(d, current?.gateway) === k).length })).filter((x) => x.n), [devices, current?.gateway]);
  const online = (devices ?? []).filter((d) => d.status === 'online').length;
  const persist = useCallback(async () => {
    if (!current) return;
    await db.topologyLayouts.put({ networkId: current.id, positions: Object.fromEntries(nodes.map((n) => [n.id, n.position])), updatedAt: Date.now() }); setMsg('Đã lưu bố cục.'); setTimeout(() => setMsg(undefined), 2500);
  }, [current, nodes]);
  const reset = async () => { if (current) { await db.topologyLayouts.delete(current.id); setNodes(base.nodes); setTimeout(() => rf.fitView({ padding: 0.12, duration: 250 }), 50); } };

  useEffect(() => { // tìm kiếm: nếu chỉ có 1 kết quả thì căn giữa vào đó
    const hit = nodes.filter((n) => n.type === 'dev' && (n as DevNode).data.match); if (q && hit.length === 1) rf.fitView({ nodes: [{ id: hit[0].id }], duration: 300, maxZoom: 1.3, padding: 1.4 });
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportSvg = () => {
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
    const abs = (n: Node): { x: number; y: number } => { const p = n.parentId ? nodes.find((z) => z.id === n.parentId) : undefined; return p ? { x: p.position.x + n.position.x, y: p.position.y + n.position.y } : n.position; };
    const vis = nodes.filter((n) => !n.hidden); const pos = new Map(vis.map((n) => [n.id, abs(n)]));
    const minX = Math.min(...[...pos.values()].map((p) => p.x)) - 24; const minY = Math.min(...[...pos.values()].map((p) => p.y)) - 24;
    const maxX = Math.max(...vis.map((n) => pos.get(n.id)!.x + (n.width ?? NW))) + 24; const maxY = Math.max(...vis.map((n) => pos.get(n.id)!.y + (n.height ?? NH))) + 40;
    const w = maxX - minX; const h = maxY - minY; const X = (v: number) => v - minX; const Y = (v: number) => v - minY;
    const grp = vis.filter((n) => n.type === 'grp').map((n) => { const p = pos.get(n.id)!; const g = n.data as GrpData; return `<rect x="${X(p.x)}" y="${Y(p.y)}" width="${g.w}" height="${g.h}" rx="12" fill="#f1f5f9" stroke="#cbd5e1"/><text x="${X(p.x) + 14}" y="${Y(p.y) + 22}" font-size="13" font-weight="600" font-family="sans-serif" fill="#0f172a">${esc(g.label)} (${g.count})</text>`; }).join('');
    const lines = edges.filter((e) => pos.has(e.source) && pos.has(e.target)).map((e) => { const a = pos.get(e.source)!; const b = pos.get(e.target)!; const sw = nodes.find((z) => z.id === e.source)?.width ?? NW; return `<path d="M${X(a.x + sw / 2)},${Y(a.y + NH)} C${X(a.x + sw / 2)},${Y(a.y + NH + 50)} ${X(b.x + (nodes.find((z) => z.id === e.target)?.width ?? NW) / 2)},${Y(b.y - 50)} ${X(b.x + (nodes.find((z) => z.id === e.target)?.width ?? NW) / 2)},${Y(b.y)}" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="6 5"/>`; }).join('');
    const boxes = vis.filter((n) => n.type === 'dev').map((n) => { const p = pos.get(n.id)!; const d = (n.data as DevData).device; const off = d.status === 'offline'; return `<g opacity="${off ? .55 : 1}"><rect x="${X(p.x)}" y="${Y(p.y)}" width="${NW}" height="${NH}" rx="10" fill="#fff" stroke="${off ? '#94a3b8' : '#0891b2'}"/><circle cx="${X(p.x) + NW - 12}" cy="${Y(p.y) + 12}" r="4" fill="${off ? '#94a3b8' : '#059669'}"/><text x="${X(p.x) + 12}" y="${Y(p.y) + 26}" font-size="12.5" font-weight="600" font-family="sans-serif" fill="#0f172a">${esc((d.hostname ?? d.vendor ?? 'Không rõ').slice(0, 20))}</text><text x="${X(p.x) + 12}" y="${Y(p.y) + 44}" font-size="11" font-family="monospace" fill="#64748b">${esc(d.ipAddress)} · ${esc(KIND[(n.data as DevData).kind].label.slice(0, 14))}</text></g>`; }).join('');
    downloadText('hachihi-topology.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#f8fafc"/>${grp}${lines}${boxes}<text x="12" y="${h - 12}" font-size="11" fill="#64748b" font-family="sans-serif">Logical topology (suy luận) — đường nét đứt = cùng subnet qua gateway, không phải cáp vật lý</text></svg>`, 'image/svg+xml');
  };

  return (<>
    <PageHeader actions={<>
      <SearchBox value={q} onChange={setQ} placeholder="Tìm thiết bị trên sơ đồ…" width={260} />
      <span className="small muted">{online}/{devices?.length ?? 0} online</span><span className="spacer" />
      {msg && <span className="small" style={{ color: 'var(--ok)' }}>{msg}</span>}
      <button onClick={() => void persist()}><Save size={15} />Lưu bố cục</button><button onClick={() => void reset()}><RotateCcw size={15} />Đặt lại</button><button onClick={exportSvg}><Download size={15} />Xuất SVG</button></>} />
    <div className="tp-wrap">
      <ReactFlow<DevNode | GrpNode, Edge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onNodeClick={(_, n) => n.type === 'dev' && setSel(n.id)} onPaneClick={() => setSel(null)} colorMode={theme === 'light' ? 'light' : 'dark'}
        fitView fitViewOptions={{ padding: 0.12, maxZoom: 1.1 }} minZoom={0.15} maxZoom={2} nodesConnectable={false} proOptions={{ hideAttribution: true }}>
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="var(--grid-line)" />
        <MiniMap pannable zoomable ariaLabel="Bản đồ thu nhỏ" nodeColor={(n) => (n.type === 'grp' ? 'transparent' : (n as DevNode).data.device.status === 'online' ? 'var(--accent)' : 'var(--text-3)')} maskColor="rgba(0,0,0,.25)" nodeStrokeWidth={0} />
      </ReactFlow>
      <div className="tp-tools" role="toolbar" aria-label="Điều khiển sơ đồ">
        <button className="icon sm" aria-label="Phóng to" onClick={() => rf.zoomIn({ duration: 150 })}><ZoomIn size={16} /></button>
        <button className="icon sm" aria-label="Thu nhỏ" onClick={() => rf.zoomOut({ duration: 150 })}><ZoomOut size={16} /></button>
        <button className="icon sm" aria-label="Vừa màn hình" onClick={() => rf.fitView({ padding: 0.12, duration: 250, maxZoom: 1.1 })}><Maximize size={16} /></button>
        <button className={`icon sm ${legend ? 'primary' : ''}`} aria-label="Chú giải" aria-pressed={legend} title="Chú giải" onClick={() => setLegend((v) => !v)}><Info size={16} /></button>
      </div>
      {legend && <div className="tp-legend">
        <div className="section-t" style={{ margin: '0 0 6px' }}>Chú giải</div>
        {kinds.map(({ k, n }) => { const I = KIND[k].icon; const off = hide.has(k); return (
          <button key={k} className={`tp-lg ghost sm ${off ? 'is-off' : ''}`} aria-pressed={!off} title={off ? 'Hiện lại nhóm này' : 'Ẩn nhóm này'} onClick={() => setHide((h) => { const s = new Set(h); if (s.has(k)) s.delete(k); else s.add(k); return s; })}>
            <span className={`avatar k-${k}`} style={{ width: 22, height: 22, borderRadius: 6 }}><I size={13} /></span><span>{KIND[k].label}</span><span className="muted">{n}</span></button>); })}
        <div className="tp-lg-sep" />
        <div className="tp-lg-row"><i className="tp-dot on" />Online<i className="tp-dot off" style={{ marginLeft: 10 }} />Offline</div>
        <div className="tp-lg-row"><svg width="34" height="8"><line x1="0" y1="4" x2="34" y2="4" stroke="var(--text-3)" strokeWidth="1.6" strokeDasharray="5 4" /></svg>Suy luận (cùng subnet)</div>
        <div className="tp-lg-row"><svg width="34" height="8"><line x1="0" y1="4" x2="34" y2="4" stroke="var(--accent)" strokeWidth="2.2" /></svg>Đã xác minh (SNMP/LLDP) <span className="muted">· 0</span></div>
        <div className="tp-lg-row"><i className="tp-sev" style={{ position: 'static', background: 'var(--bad)' }} />Có cảnh báo cao/nghiêm trọng</div>
      </div>}
    </div>
    <Drawer open={!!selected} modal={false} onClose={() => setSel(null)} title={selected ? hostOf(recToAgent(selected)) : ''} subtitle={selected?.ipAddress}>
      {selected && <DeviceDetail d={recToAgent(selected)} gateway={current?.gateway} findings={findings} extra={<><div className="section-t">Kết nối</div><p className="small muted" style={{ margin: 0 }}>Suy luận: thiết bị cùng subnet {current?.subnetCidr}, đi ra ngoài qua gateway {current?.gateway ?? '—'}. Chưa có bằng chứng SNMP/LLDP/CDP về cổng switch hoặc uplink.</p></>} />}
    </Drawer>
  </>);
}

export default function Topology() {
  const { current } = useNetwork(); const { devices, loading } = useNetData();
  return (<>
    <Banner kind="info"><b>Sơ đồ logic (suy luận).</b> Đường nét đứt chỉ biểu thị “cùng subnet, đi qua gateway”. Hachihi không suy diễn cổng switch hay quan hệ uplink khi chưa có bằng chứng SNMP/LLDP/CDP; khi có, liên kết sẽ được vẽ nét liền.</Banner>
    {loading ? <SkeletonRows n={3} h={160} /> : !current || devices.length === 0
      ? <Card><Empty icon={Waypoints} title="Chưa có thiết bị để vẽ sơ đồ" action={<Link to="/lan"><button className="primary">Mở LAN Scanner</button></Link>}>Chạy LAN Scanner — sơ đồ được dựng tự động từ kết quả quét.</Empty></Card>
      : <ReactFlowProvider><Canvas /></ReactFlowProvider>}
  </>);
}
void Badge;
