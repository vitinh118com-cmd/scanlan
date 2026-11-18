import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, Info, Inbox, Search, X, XCircle, type LucideIcon } from 'lucide-react';

/* ====== Layout primitives ====== */
/** Thanh công cụ của trang (tiêu đề + mô tả nằm ở Header chung). `title`/`sub` giữ để tương thích, không còn hiển thị riêng. */
export function PageHeader({ actions }: { title?: string; sub?: string; actions?: ReactNode }) {
  return <div className="toolbar noprint">{actions}</div>;
}

export function Card({ title, icon: Icon, sub, children, actions, className = '', flush, tight }: { title?: ReactNode; icon?: LucideIcon; sub?: ReactNode; children?: ReactNode; actions?: ReactNode; className?: string; flush?: boolean; tight?: boolean }) {
  return (
    <section className={`card ${flush ? 'flush' : ''} ${tight ? 'tight' : ''} ${className}`}>
      {(title || actions) && (
        <div className="card-h">
          <h2>{Icon && <Icon size={15} />}{title}</h2>
          {sub && <span className="sub">{sub}</span>}
          <span className="spacer" />
          {actions}
        </div>
      )}
      <div className="card-b">{children}</div>
    </section>
  );
}

export type Tone = 'ok' | 'warn' | 'bad' | 'accent' | undefined;
export function Kpi({ label, value, unit, hint, tone, icon: Icon }: { label: ReactNode; value: ReactNode; unit?: ReactNode; hint?: ReactNode; tone?: Tone; icon?: LucideIcon }) {
  return (
    <div className={`kpi ${tone ? 't-' + tone : ''}`}>
      <div className="k-top">{Icon && <Icon size={15} />}{label}</div>
      <div className="k-val">{value}{unit && <small>{unit}</small>}</div>
      {hint && <div className="k-hint">{hint}</div>}
    </div>
  );
}
/** Tương thích cũ. */
export function Stat({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return <div className="stat"><span>{label}</span><b>{value}</b>{hint && <span className="small muted">{hint}</span>}</div>;
}

const BANNER_ICON = { info: Info, ok: CheckCircle2, warn: AlertTriangle, bad: XCircle };
export function Banner({ kind = 'info', children }: { kind?: 'info' | 'ok' | 'warn' | 'bad'; children?: ReactNode }) {
  const I = BANNER_ICON[kind];
  return <div className={`banner ${kind}`} role={kind === 'bad' ? 'alert' : 'status'}><I size={16} /><div>{children}</div></div>;
}

export function Badge({ children, kind, dot }: { children?: ReactNode; kind?: string; dot?: boolean }) {
  return <span className={`badge ${kind ? 'b-' + kind : ''}`}>{dot && <i className="dot" />}{children}</span>;
}
export function StatusBadge({ status }: { status: string }) {
  const on = status === 'online';
  return <span className={`status ${on ? 'on' : 'off'}`}><i className="dot" />{on ? 'Online' : 'Offline'}</span>;
}
export const sevLabel: Record<string, string> = { critical: 'Nghiêm trọng', high: 'Cao', medium: 'Trung bình', low: 'Thấp', info: 'Thông tin' };
export const confLabel: Record<string, string> = { high: 'Cao', medium: 'Vừa', low: 'Thấp' };
export const sevColor: Record<string, string> = { critical: 'var(--crit)', high: 'var(--bad)', medium: 'var(--warn)', low: 'var(--info)', info: 'var(--text-3)' };
export function Confidence({ level, label = true }: { level: 'low' | 'medium' | 'high'; label?: boolean }) {
  const n = level === 'high' ? 3 : level === 'medium' ? 2 : 1;
  return <span className="row tight nowrap" title={`Độ tin cậy: ${confLabel[level]}`}><span className={`conf c${n}`}><i /><i /><i /></span>{label && <span className="small muted">{confLabel[level]}</span>}</span>;
}

/* ====== Trạng thái: empty / error / skeleton ====== */
export function Empty({ children, icon: Icon = Inbox, title, action }: { children?: ReactNode; icon?: LucideIcon; title?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="e-ic"><Icon size={22} /></div>
      {title && <b>{title}</b>}
      {children && <div className="e-p">{children}</div>}
      {action && <div className="e-act">{action}</div>}
    </div>
  );
}
export function ErrorState({ title = 'Đã xảy ra lỗi', children, action }: { title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty errorstate" role="alert"><div className="e-ic"><XCircle size={22} /></div><b>{title}</b>{children && <div className="e-p">{children}</div>}{action && <div className="e-act">{action}</div>}</div>;
}
export function Skeleton({ h = 14, w = '100%', r }: { h?: number | string; w?: number | string; r?: number }) {
  return <span className="skel" style={{ height: h, width: w, borderRadius: r }} aria-hidden />;
}
export function SkeletonRows({ n = 6, h = 38 }: { n?: number; h?: number }) {
  return <div className="col" style={{ gap: 8 }} aria-busy="true" aria-label="Đang tải">{Array.from({ length: n }, (_, i) => <Skeleton key={i} h={h} />)}</div>;
}

export function ProgressBar({ value, max, tone, thick, indeterminate }: { value: number; max: number; tone?: 'ok' | 'warn' | 'bad'; thick?: boolean; indeterminate?: boolean }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className={`bar ${tone ?? ''} ${thick ? 'thick' : ''} ${indeterminate ? 'ind' : ''}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: pct + '%' }} />
    </div>
  );
}

/* ====== Điều khiển ====== */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => <button key={o.value} className={value === o.value ? 'on' : ''} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}{o.count !== undefined && <span className="n">{o.count}</span>}</button>)}
    </div>
  );
}
export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[] }) {
  return <div className="tabs" role="tablist">{tabs.map((t) => <button key={t.value} role="tab" aria-selected={value === t.value} className={value === t.value ? 'on' : ''} onClick={() => onChange(t.value)}>{t.label}</button>)}</div>;
}
export function SearchBox({ value, onChange, placeholder = 'Tìm kiếm…', width }: { value: string; onChange: (v: string) => void; placeholder?: string; width?: number }) {
  return <label className="search"><Search size={15} /><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} style={width ? { width } : undefined} /></label>;
}
export function Tooltip({ text, children, side }: { text: string; children: ReactNode; side?: 'right' }) {
  return <span className={`tip ${side ?? ''}`}>{children}<span className="tip-b" role="tooltip">{text}</span></span>;
}

/* ====== Drawer / Modal ====== */
function useEsc(open: boolean, onClose: () => void) {
  useEffect(() => { if (!open) return; const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [open, onClose]);
}
export function Drawer({ open, onClose, title, subtitle, icon, children, footer, modal = true }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; children?: ReactNode; footer?: ReactNode; modal?: boolean }) {
  useEsc(open, onClose);
  if (!open) return null;
  return (<>
    {modal && <div className="ov" onClick={onClose} />}
    <aside className="drawer" role="dialog" aria-label={typeof title === 'string' ? title : 'Chi tiết'}>
      <div className="dr-h">{icon}<div className="t"><h2 className="ellipsis">{title}</h2>{subtitle && <div className="small muted ellipsis">{subtitle}</div>}</div><button className="ghost icon sm" onClick={onClose} aria-label="Đóng"><X size={16} /></button></div>
      <div className="dr-b">{children}</div>
      {footer && <div className="dr-f">{footer}</div>}
    </aside>
  </>);
}
export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children?: ReactNode; footer?: ReactNode }) {
  useEsc(open, onClose);
  if (!open) return null;
  return (<>
    <div className="ov" onClick={onClose} />
    <div className="modal" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Hộp thoại'}>
      <div className="dr-h"><div className="t"><h2>{title}</h2></div><button className="ghost icon sm" onClick={onClose} aria-label="Đóng"><X size={16} /></button></div>
      <div className="dr-b">{children}</div>
      {footer && <div className="dr-f">{footer}</div>}
    </div>
  </>);
}

/* ====== Định dạng ====== */
export const fmtTime = (t?: number | string | null) => (t ? new Date(t).toLocaleString('vi-VN') : '—');
export const fmtBytes = (n?: number) => (n === undefined ? '—' : n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : (n / 1e3).toFixed(0) + ' KB');
export function fmtAgo(t?: number | string | null, now = Date.now()) {
  if (!t) return '—';
  const s = Math.max(0, Math.round((now - (typeof t === 'number' ? t : Date.parse(t))) / 1000));
  if (s < 45) return 'vừa xong'; if (s < 3600) return `${Math.round(s / 60)} phút trước`; if (s < 86400) return `${Math.round(s / 3600)} giờ trước`; return `${Math.round(s / 86400)} ngày trước`;
}

/* ====== Bảng ====== */
export interface Col<T> { key: string; header: ReactNode; render: (row: T) => ReactNode; sort?: (a: T, b: T) => number; text?: (row: T) => string }
function SortIcon({ dir }: { dir?: number }) { return dir === undefined ? <ArrowUpDown size={12} className="sort" style={{ opacity: .4 }} /> : dir === 1 ? <ArrowUp size={12} className="sort" /> : <ArrowDown size={12} className="sort" />; }

/** Bảng thường (≤ vài trăm dòng): tìm kiếm, sắp xếp, "xem thêm". Dữ liệu lớn dùng VTable. */
export function DataTable<T>({ rows, cols, rowKey, search = true, limit = 300, onRow, empty }: {
  rows: T[]; cols: Col<T>[]; rowKey: (row: T) => string | number; search?: boolean; limit?: number; onRow?: (row: T) => void; empty?: ReactNode;
}) {
  const [q, setQ] = useState(''); const [sort, setSort] = useState<{ k: string; dir: number } | null>(null); const [shown, setShown] = useState(limit);
  const data = useMemo(() => {
    let r = rows; const needle = q.trim().toLowerCase();
    if (needle) r = r.filter((row) => cols.some((c) => (c.text ? c.text(row) : '').toLowerCase().includes(needle)));
    if (sort) { const c = cols.find((x) => x.key === sort.k); if (c?.sort) r = [...r].sort((a, b) => c.sort!(a, b) * sort.dir); }
    return r;
  }, [rows, q, sort, cols]);
  return (
    <div>
      {search && <div className="row" style={{ marginBottom: 10 }}><SearchBox value={q} onChange={(v) => { setQ(v); setShown(limit); }} /><span className="muted small">{data.length}/{rows.length} dòng</span></div>}
      <div className="tablewrap">
        <table>
          <thead><tr>{cols.map((c) => (
            <th key={c.key} className={c.sort ? 'sortable' : ''} aria-sort={sort?.k === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
              onClick={() => c.sort && setSort((s) => (s?.k === c.key ? { k: c.key, dir: s.dir * -1 } : { k: c.key, dir: 1 }))}>
              {c.header}{c.sort && <SortIcon dir={sort?.k === c.key ? sort.dir : undefined} />}
            </th>))}</tr></thead>
          <tbody>
            {data.slice(0, shown).map((row) => <tr key={rowKey(row)} className={onRow ? 'clickable' : ''} onClick={() => onRow?.(row)}>{cols.map((c) => <td key={c.key}>{c.render(row)}</td>)}</tr>)}
            {data.length === 0 && <tr><td colSpan={cols.length}><Empty>{empty ?? 'Không có dữ liệu'}</Empty></td></tr>}
          </tbody>
        </table>
      </div>
      {data.length > shown && <div className="row" style={{ marginTop: 10 }}><button onClick={() => setShown((s) => s + limit)}>Hiển thị thêm ({data.length - shown} dòng còn lại)</button></div>}
    </div>
  );
}

export interface VCol<T> { key: string; header: ReactNode; width: string; render: (row: T) => ReactNode; sort?: (a: T, b: T) => number; hideBelow?: number }
/** Bảng ảo hoá: chỉ dựng các dòng đang nhìn thấy → mượt với hàng nghìn thiết bị. Việc lọc/sắp xếp do nơi gọi (hoặc sortState) xử lý. */
export function VTable<T>({ rows, cols, rowKey, onRow, selectedKey, rowHeight = 48, sort, onSort, empty, footer, minWidth = 760 }: {
  rows: T[]; cols: VCol<T>[]; rowKey: (r: T) => string; onRow?: (r: T) => void; selectedKey?: string | null; rowHeight?: number;
  sort?: { k: string; dir: number } | null; onSort?: (k: string) => void; empty?: ReactNode; footer?: ReactNode; minWidth?: number;
}) {
  const body = useRef<HTMLDivElement>(null);
  const [vw, setVw] = useState(1200);
  useEffect(() => { const el = body.current; if (!el) return; const ro = new ResizeObserver(() => { setVw(el.clientWidth); el.parentElement?.style.setProperty('--vt-sb', el.offsetWidth - el.clientWidth + 'px'); }); ro.observe(el); return () => ro.disconnect(); }, []);
  const vis = cols.filter((c) => !c.hideBelow || vw >= c.hideBelow);
  const tpl = vis.map((c) => c.width).join(' ');
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => body.current, estimateSize: () => rowHeight, overscan: 10 });
  return (
    <div className="vt" style={{ height: '100%' }}>
      <div className="vt-head" role="row" style={{ gridTemplateColumns: tpl, minWidth }}>
        {vis.map((c) => <div key={c.key} role="columnheader" className={`vt-hc ${c.sort ? 'sortable' : ''} ${sort?.k === c.key ? 'sorted' : ''}`} onClick={() => c.sort && onSort?.(c.key)} aria-sort={sort?.k === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>{c.header}{c.sort && <SortIcon dir={sort?.k === c.key ? sort.dir : undefined} />}</div>)}
      </div>
      <div className="vt-body" ref={body} role="rowgroup">
        {rows.length === 0 ? (empty ?? <Empty>Không có dữ liệu</Empty>) : (
          <div style={{ height: v.getTotalSize(), minWidth, position: 'relative' }}>
            {v.getVirtualItems().map((vi) => {
              const r = rows[vi.index]; const k = rowKey(r);
              return <div key={k} role="row" className={`vt-row ${onRow ? 'clickable' : ''} ${selectedKey === k ? 'sel' : ''}`} style={{ height: vi.size, transform: `translateY(${vi.start}px)`, gridTemplateColumns: tpl, top: 0 }} onClick={() => onRow?.(r)}>
                {vis.map((c) => <div key={c.key} role="cell" className="vt-cell">{c.render(r)}</div>)}
              </div>;
            })}
          </div>
        )}
      </div>
      {footer && <div className="vt-foot">{footer}</div>}
    </div>
  );
}

/* ====== Biểu đồ SVG đơn giản (giữ cho các trang chưa chuyển sang ECharts) ====== */
export function LineChart({ data, unit = '', height = 170, color = 'var(--accent)', min = 0 }: { data: (number | null)[]; unit?: string; height?: number; color?: string; min?: number }) {
  const vals = data.filter((z): z is number => z !== null); const hi = Math.max(1, ...vals) * 1.1; const lo = Math.min(min, ...vals);
  const x = (i: number) => (data.length <= 1 ? 0 : (i / (data.length - 1)) * 600); const y = (v: number) => height - 18 - ((v - lo) / (hi - lo || 1)) * (height - 30);
  let d = ''; let pen = false;
  data.forEach((v, i) => { if (v === null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `; pen = true; });
  return (
    <svg viewBox={`0 0 600 ${height}`} className="chart" role="img" aria-label="Biểu đồ" preserveAspectRatio="none">
      <line x1="0" x2={600} y1={height - 18} y2={height - 18} stroke="var(--border)" />
      <text x="4" y="12" fontSize="11" fill="var(--text-3)">{hi.toFixed(0)}{unit}</text>
      <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {data.map((v, i) => (v === null ? <line key={i} x1={x(i)} x2={x(i)} y1="8" y2={height - 18} stroke="var(--bad)" strokeOpacity=".35" /> : null))}
    </svg>
  );
}
export function BarChart({ items, height = 170 }: { items: { label: string; value: number; color?: string }[]; height?: number }) {
  const max = Math.max(1, ...items.map((i) => i.value)); const w = 600 / Math.max(1, items.length);
  return (
    <svg viewBox={`0 0 600 ${height}`} className="chart" role="img" aria-label="Biểu đồ cột">
      {items.map((it, i) => { const h = (it.value / max) * (height - 34); return (
        <g key={it.label}>
          <rect x={i * w + 4} y={height - 22 - h} width={w - 8} height={h} rx="3" fill={it.color ?? 'var(--accent)'} />
          <text x={i * w + w / 2} y={height - 7} fontSize="11" textAnchor="middle" fill="var(--text-3)">{it.label}</text>
          <text x={i * w + w / 2} y={height - 26 - h} fontSize="11" textAnchor="middle" fill="var(--text)">{it.value || ''}</text>
        </g>); })}
    </svg>
  );
}
