import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, Bell, Camera, FileText, Gauge, Globe, History, LayoutDashboard, ListChecks, Menu, Monitor as MonitorIcon, Moon, Network, PanelLeftClose, PanelLeftOpen,
  Radar, Settings as SettingsIcon, ShieldAlert, Sun, Waypoints, Wifi, Wrench, ShieldCheck, Boxes, AlertTriangle, PlugZap, type LucideIcon,
} from 'lucide-react';
import { useAgent, useNetwork, useTheme } from './context';
import { useNetData } from './data';
import { lsGet, lsSet } from '../infrastructure/db/db';
import Overview from '../features/overview/Overview';
import { Skeleton } from '../components/ui';

// Trang nặng được tải theo nhu cầu (spec §14.3): topology (React Flow), báo cáo, công cụ (OUI).
const LanScanner = lazy(() => import('../features/lan-scanner/LanScanner'));
const Topology = lazy(() => import('../features/topology/Topology'));
const Cameras = lazy(() => import('../features/cameras/Cameras'));
const Inventory = lazy(() => import('../features/inventory/Inventory'));
const Security = lazy(() => import('../features/security/Security'));
const WanCheck = lazy(() => import('../features/wan-check/WanCheck'));
const HistoryPage = lazy(() => import('../features/history/History'));
const MonitorPage = lazy(() => import('../features/monitor/Monitor'));
const Wifi_ = lazy(() => import('../features/wifi/Wifi'));
const SpeedTest = lazy(() => import('../features/speedtest/SpeedTest'));
const Tools = lazy(() => import('../features/tools/Tools'));
const Reports = lazy(() => import('../features/reports/Reports'));
const Settings = lazy(() => import('../features/settings/Settings'));

interface NavItem { to: string; icon: LucideIcon; label: string; title: string; desc: string; needsAgent?: boolean }
const GROUPS: { title: string; items: NavItem[] }[] = [
  { title: 'Overview', items: [{ to: '/', icon: LayoutDashboard, label: 'Overview', title: 'Overview', desc: 'Tình trạng mạng, thiết bị và bảo mật trong một màn hình' }] },
  { title: 'Network Discovery', items: [
    { to: '/lan', icon: Radar, label: 'LAN Scanner', title: 'LAN Scanner', desc: 'Quét thiết bị trong mạng nội bộ qua Hachihi Agent', needsAgent: true },
    { to: '/topology', icon: Waypoints, label: 'Network Topology', title: 'Network Topology', desc: 'Sơ đồ logic mạng dựng từ dữ liệu quét' },
    { to: '/cameras', icon: Camera, label: 'Camera Discovery', title: 'Camera Discovery', desc: 'Tìm camera/NVR bằng SADP, ONVIF, RTSP', needsAgent: true },
    { to: '/inventory', icon: Boxes, label: 'Device Inventory', title: 'Device Inventory', desc: 'Danh mục thiết bị và tài sản đã phát hiện' },
  ] },
  { title: 'Security', items: [
    { to: '/security', icon: ShieldAlert, label: 'Security Audit', title: 'Security Audit', desc: 'Đánh giá rủi ro theo bộ luật, kèm bằng chứng và hướng khắc phục' },
    { to: '/wan', icon: Globe, label: 'WAN Scanner', title: 'WAN Scanner', desc: 'Kiểm tra cổng của mục tiêu công khai mà bạn được phép kiểm tra' },
  ] },
  { title: 'Monitoring', items: [
    { to: '/monitor', icon: Activity, label: 'Realtime Monitor', title: 'Realtime Monitor', desc: 'Ping định kỳ, đo RTT, mất gói và thời gian gián đoạn', needsAgent: true },
    { to: '/wifi', icon: Wifi, label: 'WiFi Analyzer', title: 'WiFi Analyzer', desc: 'Kênh, tín hiệu và mức nhiễu của các mạng WiFi xung quanh', needsAgent: true },
    { to: '/speed', icon: Gauge, label: 'Speed Test', title: 'Speed Test', desc: 'Đo tốc độ Download/Upload, độ trễ và jitter' },
  ] },
  { title: 'Data & Tools', items: [
    { to: '/history', icon: History, label: 'History & Compare', title: 'History & Compare', desc: 'Lịch sử quét, so sánh phiên và baseline thiết bị' },
    { to: '/tools', icon: Wrench, label: 'Network Tools', title: 'Network Tools', desc: 'Công cụ tra cứu và tính toán mạng chạy ngay trên trình duyệt' },
    { to: '/reports', icon: FileText, label: 'Reports', title: 'Reports', desc: 'Xem trước và xuất báo cáo PDF / Excel / CSV' },
  ] },
  { title: 'System', items: [{ to: '/settings', icon: SettingsIcon, label: 'Settings', title: 'Settings', desc: 'Giao diện, dữ liệu cục bộ, sao lưu và thông tin ứng dụng' }] },
];
const ALL = GROUPS.flatMap((g) => g.items);
const metaOf = (p: string) => ALL.find((n) => (n.to === '/' ? p === '/' : p.startsWith(n.to))) ?? ALL[0];

export function PageSkeleton() {
  return <div className="col" aria-busy="true" aria-label="Đang tải trang"><div className="grid g4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={92} r={12} />)}</div><Skeleton h={320} r={12} /></div>;
}

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open, close]);
  return ref;
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const nav = useNavigate();
  const { status } = useAgent(); const { findings, devices, newDevices } = useNetData();
  const items: { icon: ReactNode; text: ReactNode; to: string }[] = [];
  if (status !== 'connected' && status !== 'checking') items.push({ icon: <PlugZap size={16} color="var(--warn)" />, text: <><b>Agent chưa sẵn sàng.</b> Quét LAN, WiFi, camera và Monitor cần Agent đang chạy và đã ghép cặp.</>, to: '/' });
  const crit = findings.filter((f) => f.severity === 'critical').length; const high = findings.filter((f) => f.severity === 'high').length;
  if (crit + high) items.push({ icon: <ShieldAlert size={16} color="var(--bad)" />, text: <><b>{crit} nghiêm trọng, {high} mức cao</b> trong Security Audit.</>, to: '/security' });
  const off = devices.filter((d) => d.status === 'offline').length;
  if (off) items.push({ icon: <AlertTriangle size={16} color="var(--warn)" />, text: <><b>{off} thiết bị offline</b> trong lần quét gần nhất.</>, to: '/inventory' });
  if (newDevices) items.push({ icon: <Radar size={16} color="var(--accent)" />, text: <><b>{newDevices} thiết bị chưa có trong baseline</b> — cần xác nhận.</>, to: '/history' });
  const n = items.length;
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="ghost icon btn-badge" aria-label={`Thông báo (${n})`} aria-expanded={open} onClick={() => setOpen((o) => !o)}><Bell size={17} />{n > 0 && <i>{n}</i>}</button>
      {open && (
        <div className="popover" role="menu">
          <div className="pop-h">Thông báo<span className="spacer" /><span className="small muted">{n ? `${n} mục` : ''}</span></div>
          {n === 0 ? <div className="empty" style={{ padding: 24 }}><div className="e-ic"><ShieldCheck size={20} /></div><b>Không có cảnh báo</b><p>Mọi thứ đang ổn định.</p></div>
            : items.map((it, i) => <div key={i} className="pop-item" style={{ cursor: 'pointer' }} onClick={() => { nav(it.to); setOpen(false); }}>{it.icon}<div>{it.text}</div></div>)}
        </div>
      )}
    </div>
  );
}

export function App() {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => lsGet<boolean | null>('sidebar', null) ?? window.innerWidth < 1200);
  const { status, health } = useAgent();
  const { networks, current, setCurrentId } = useNetwork();
  const { devices, online } = useNetData();
  const [theme, setTheme] = useTheme();
  const loc = useLocation(); const nav = useNavigate();
  const meta = metaOf(loc.pathname);
  useEffect(() => { setOpen(false); document.title = `${meta.title} · HACHIHI Network Tool`; }, [meta.title]);
  const toggle = () => setCollapsed((c) => { lsSet('sidebar', !c); return !c; });
  const nextTheme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
  const ThemeIcon = theme === 'system' ? MonitorIcon : theme === 'light' ? Sun : Moon;

  const agentTone = status === 'connected' ? 'on' : status === 'checking' ? 'warn' : status === 'unpaired' ? 'warn' : 'bad';
  const agentText = status === 'connected' ? 'Connected' : status === 'checking' ? 'Checking…' : status === 'unpaired' ? 'Chưa ghép cặp' : 'Disconnected';

  return (
    <div className="shell">
      <div className={`scrim ${open ? 'on' : ''}`} onClick={() => setOpen(false)} />
      <nav className={`sidebar ${collapsed ? 'collapsed' : ''} ${open ? 'open' : ''}`} aria-label="Điều hướng chính">
        <div className="sb-brand">
          <div className="sb-logo"><Network size={17} strokeWidth={2.2} /></div>
          <div><b>HACHIHI</b><small>Network Tool</small></div>
        </div>
        <div className="sb-scroll">
          {GROUPS.map((g) => (
            <div className="sb-group" key={g.title}>
              <div className="sb-title">{g.title}</div>
              {g.items.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `sb-link ${isActive ? 'active' : ''}`} title={collapsed ? n.label : n.needsAgent ? 'Cần Agent' : undefined}>
                  <n.icon size={18} strokeWidth={1.8} /><span>{n.label}</span>{n.needsAgent && <i className="sb-tag">Agent</i>}
                </NavLink>
              ))}
            </div>
          ))}
        </div>
        <div className="sb-foot">
          <button className="ghost sm" onClick={toggle} aria-label={collapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}>{collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}<span>Thu gọn</span></button>
        </div>
      </nav>
      <div className="main-col">
        <header className="header">
          <button className="ghost icon menu-btn" onClick={() => setOpen(true)} aria-label="Mở menu"><Menu size={18} /></button>
          <div className="hd-title"><h1>{meta.title}</h1><p>{meta.desc}</p></div>
          <div className="hd-actions">
            <div className="hd-net row tight nowrap hd-hide-sm" title={current ? `Mạng hiện tại: ${current.label}` : 'Chưa có dữ liệu mạng'}>
              <ListChecks size={15} style={{ color: 'var(--text-3)' }} />
              {networks.length > 1 ? (
                <select value={current?.id ?? ''} onChange={(e) => setCurrentId(e.target.value)} aria-label="Chọn mạng" style={{ height: 30 }}>
                  {networks.map((n) => <option key={n.id} value={n.id}>{n.label}{n.gateway ? ` · gw ${n.gateway}` : ''}</option>)}
                </select>
              ) : current ? (
                <span className="chip">{current.subnetCidr}</span>
              ) : <span className="small muted">Chưa quét mạng</span>}
              {current && devices.length > 0 && <span className="small muted lbl"><b style={{ color: 'var(--ok)', fontWeight: 600 }}>{online}</b>/{devices.length} online</span>}
            </div>
            <button className={`status ${agentTone}`} style={{ height: 30, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-full)', background: 'var(--surface-1)' }} onClick={() => nav('/')}
              title={health ? `Windows Agent ${health.agentVersion}` : 'Windows Agent'} aria-label={`Windows Agent: ${agentText}`}>
              <i className="dot" />Agent {agentText}
            </button>
            <Notifications />
            <button className="ghost icon" onClick={() => setTheme(nextTheme)} aria-label={`Giao diện: ${theme}. Bấm để đổi`} title={`Giao diện: ${theme === 'system' ? 'theo hệ thống' : theme === 'light' ? 'sáng' : 'tối'}`}><ThemeIcon size={17} /></button>
            <button className="ghost icon" onClick={() => nav('/settings')} aria-label="Cài đặt"><SettingsIcon size={17} /></button>
          </div>
        </header>
        <main className="content">
          <Suspense fallback={<PageSkeleton />} key={loc.pathname}>
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/lan" element={<LanScanner />} />
              <Route path="/topology" element={<Topology />} />
              <Route path="/cameras" element={<Cameras />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/security" element={<Security />} />
              <Route path="/wan" element={<WanCheck />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/monitor" element={<MonitorPage />} />
              <Route path="/wifi" element={<Wifi_ />} />
              <Route path="/speed" element={<SpeedTest />} />
              <Route path="/tools" element={<Tools />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
