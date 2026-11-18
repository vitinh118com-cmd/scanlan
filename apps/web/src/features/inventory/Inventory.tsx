import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNetwork } from '../../app/context';
import { Link } from 'react-router-dom';
import { Boxes, Download, Plus, Upload } from 'lucide-react';
import { Banner, Card, DataTable, Empty, Modal, PageHeader, Segmented, type Col } from '../../components/ui';
import { DeviceTable } from '../devices/DeviceTable';
import { DeviceAvatar, KIND_ORDER, type DevKind } from '../../components/icons';
import { recToAgent, useNetData } from '../../app/data';
import { db, uid } from '../../infrastructure/db/db';
import { exportCsv, exportJson } from '../../infrastructure/export/export';
import { DEVICE_TYPES } from '../../core/constants/ports';
import type { AssetRec, DeviceRec } from '../../core/domain/types';

const blank = (): Partial<AssetRec> => ({ assetName: '', assetType: 'other', tags: [] });

/** Parser CSV tối giản (có hỗ trợ dấu ngoặc kép) cho import. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cur = ''; let q = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

export default function Inventory() {
  const { current } = useNetwork();
  const { findings } = useNetData();
  const [tab, setTab] = useState<'devices' | 'assets'>('devices'); const [editing, setEditing] = useState(false);
  const assets = useLiveQuery(() => db.assets.toArray(), [], [] as AssetRec[]);
  const devices = useLiveQuery(() => (current ? db.devices.where('networkId').equals(current.id).toArray() : []), [current?.id], [] as DeviceRec[]);
  const [form, setForm] = useState<Partial<AssetRec>>(blank()); const [msg, setMsg] = useState<{ kind: 'ok' | 'warn' | 'bad'; text: string }>();
  const file = useRef<HTMLInputElement>(null);

  const dup = useMemo(() => {
    const ip = form.ipAddress?.trim(), mac = form.macAddress?.trim().toUpperCase();
    return assets.find((a) => a.id !== form.id && ((ip && a.ipAddress === ip) || (mac && a.macAddress?.toUpperCase() === mac)));
  }, [form, assets]);

  const save = async (override = false) => {
    if (!form.assetName?.trim()) { setMsg({ kind: 'bad', text: 'Cần nhập tên tài sản.' }); return; }
    if (dup && !override) { setMsg({ kind: 'warn', text: `Trùng IP/MAC với “${dup.assetName}”. Bấm “Vẫn lưu” để ghi đè cảnh báo.` }); return; }
    const now = Date.now();
    const rec: AssetRec = { id: form.id ?? uid(), networkId: current?.id, deviceId: form.deviceId, assetName: form.assetName.trim(), assetType: form.assetType ?? 'other',
      owner: form.owner?.trim() || undefined, location: form.location?.trim() || undefined, tags: form.tags ?? [], note: form.note?.trim() || undefined,
      ipAddress: form.ipAddress?.trim() || undefined, macAddress: form.macAddress?.trim().toUpperCase() || undefined, vendor: form.vendor?.trim() || undefined,
      createdAt: form.createdAt ?? now, updatedAt: now };
    await db.assets.put(rec); setForm(blank()); setEditing(false); setMsg({ kind: 'ok', text: 'Đã lưu tài sản.' });
  };
  const fromDevice = (d: DeviceRec) => setForm({ assetName: d.hostname ?? d.ipAddress, assetType: guessType(d.deviceType), ipAddress: d.ipAddress, macAddress: d.macAddress, vendor: d.vendor, deviceId: d.id, tags: [] });
  const importCsv = async (f: File) => {
    if (f.size > 5 * 1024 * 1024) { setMsg({ kind: 'bad', text: 'File quá lớn (tối đa 5 MB).' }); return; }
    const rows = parseCsv(await f.text()); const head = rows[0]?.map((h) => h.trim().toLowerCase()) ?? [];
    const ix = (n: string) => head.indexOf(n);
    if (ix('assetname') < 0 && ix('tên') < 0) { setMsg({ kind: 'bad', text: 'CSV cần cột “assetName” (hoặc “Tên”).' }); return; }
    const now = Date.now(); const recs: AssetRec[] = [];
    for (const r of rows.slice(1)) {
      const g = (n: string) => (ix(n) >= 0 ? r[ix(n)]?.trim() : undefined) || undefined;
      const name = g('assetname') ?? g('tên'); if (!name) continue;
      recs.push({ id: uid(), assetName: name.slice(0, 200), assetType: g('assettype') ?? 'other', owner: g('owner'), location: g('location'), ipAddress: g('ip'), macAddress: g('mac')?.toUpperCase(), vendor: g('vendor'), note: g('note'), tags: (g('tags') ?? '').split(/[;|]/).map((x) => x.trim()).filter(Boolean), createdAt: now, updatedAt: now });
    }
    await db.assets.bulkAdd(recs); setMsg({ kind: 'ok', text: `Đã nhập ${recs.length} tài sản.` });
  };

  const cols: Col<AssetRec>[] = [
    { key: 'n', header: 'Tên', render: (a) => <div className="row nowrap" style={{ gap: 10 }}><DeviceAvatar kind={assetKind(a.assetType)} /><b style={{ fontWeight: 550 }}>{a.assetName}</b></div>, sort: (a, b) => a.assetName.localeCompare(b.assetName), text: (a) => a.assetName },
    { key: 't', header: 'Loại', render: (a) => a.assetType, text: (a) => a.assetType },
    { key: 'ip', header: 'IP', render: (a) => <span className="mono">{a.ipAddress ?? '—'}</span>, text: (a) => a.ipAddress ?? '' },
    { key: 'm', header: 'MAC', render: (a) => <span className="mono">{a.macAddress ?? '—'}</span>, text: (a) => a.macAddress ?? '' },
    { key: 'o', header: 'Chủ sở hữu', render: (a) => a.owner ?? '—', text: (a) => a.owner ?? '' },
    { key: 'l', header: 'Vị trí', render: (a) => a.location ?? '—', text: (a) => a.location ?? '' },
    { key: 'tg', header: 'Tag', render: (a) => <span className="row tight">{a.tags.map((t) => <span key={t} className="chip">{t}</span>)}</span>, text: (a) => a.tags.join(' ') },
    { key: 'a', header: '', render: (a) => (<span className="row tight noprint nowrap"><button className="ghost sm" onClick={(e) => { e.stopPropagation(); setForm(a); setEditing(true); }}>Sửa</button><button className="ghost sm danger" onClick={(e) => { e.stopPropagation(); if (confirm(`Xoá “${a.assetName}”?`)) void db.assets.delete(a.id); }}>Xoá</button></span>) },
  ];
  const set = <K extends keyof AssetRec>(k: K, v: AssetRec[K]) => setForm((f) => ({ ...f, [k]: v }));
  const exCols = ['assetName', 'assetType', 'ip', 'mac', 'vendor', 'owner', 'location', 'tags', 'note'];
  const exRows = assets.map((a) => [a.assetName, a.assetType, a.ipAddress, a.macAddress, a.vendor, a.owner, a.location, a.tags.join(';'), a.note]);
  const closeForm = () => { setEditing(false); setForm(blank()); setMsg(undefined); };
  const agentDevices = useMemo(() => devices.map(recToAgent), [devices]);
  const byIp = useMemo(() => new Map(devices.map((d) => [d.ipAddress, d])), [devices]);
  const tracked = (ip: string) => assets.some((a) => a.ipAddress === ip);

  return (<>
    <PageHeader actions={<>
      <Segmented label="Chế độ xem" value={tab} onChange={setTab} options={[{ value: 'devices', label: 'Thiết bị đã quét', count: devices.length }, { value: 'assets', label: 'Tài sản', count: assets.length }]} />
      <span className="spacer" />
      {tab === 'assets' && <>
        <button onClick={() => exportCsv('hachihi-inventory.csv', exCols, exRows)} disabled={!assets.length}><Download size={15} />CSV</button>
        <button onClick={() => exportJson('hachihi-inventory.json', assets)} disabled={!assets.length}>JSON</button>
        <button onClick={() => file.current?.click()}><Upload size={15} />Nhập CSV</button>
        <button className="primary" onClick={() => { setForm(blank()); setEditing(true); }}><Plus size={15} />Thêm tài sản</button>
        <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importCsv(f); e.target.value = ''; }} /></>}</>} />
    {msg && !editing && <Banner kind={msg.kind}>{msg.text}</Banner>}

    {tab === 'devices' ? (
      <Card flush className="table-card"><div style={{ padding: 16 }}>
        <DeviceTable devices={agentDevices} gateway={current?.gateway} findings={findings}
          empty={<Empty icon={Boxes} title="Chưa có thiết bị trong danh mục" action={<Link to="/lan"><button className="primary">Mở LAN Scanner</button></Link>}>Chạy LAN Scanner để phát hiện thiết bị; kết quả được lưu cục bộ và hiện ở đây.</Empty>}
          drawerFooter={(d) => <button className="primary" disabled={tracked(d.ipAddress)} onClick={() => { const r = byIp.get(d.ipAddress); if (r) { fromDevice(r); setTab('assets'); setEditing(true); } }}><Plus size={15} />{tracked(d.ipAddress) ? 'Đã có trong tài sản' : 'Thêm vào tài sản'}</button>} />
      </div></Card>
    ) : (
      <Card flush title={`Tài sản (${assets.length})`} sub="Danh mục do bạn xác nhận, lưu cục bộ"><div style={{ padding: 16 }}>
        <DataTable rows={assets} cols={cols} rowKey={(a) => a.id} empty={<Empty icon={Boxes} title="Chưa có tài sản" action={<button className="primary" onClick={() => setEditing(true)}><Plus size={15} />Thêm tài sản</button>}>Thêm tài sản thủ công, nhập từ CSV, hoặc mở một thiết bị đã quét và chọn “Thêm vào tài sản”.</Empty>} />
      </div></Card>
    )}

    <Modal open={editing} onClose={closeForm} title={form.id ? 'Sửa tài sản' : 'Thêm tài sản'}
      footer={<>{dup && <button onClick={() => void save(true)}>Vẫn lưu (trùng {dup.assetName})</button>}<button className="ghost" onClick={closeForm}>Huỷ</button><button className="primary" onClick={() => void save(false)}>Lưu</button></>}>
      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
        <label className="f">Tên *<input value={form.assetName ?? ''} onChange={(e) => set('assetName', e.target.value)} maxLength={200} autoFocus /></label>
        <label className="f">Loại<select value={form.assetType} onChange={(e) => set('assetType', e.target.value)}>{DEVICE_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label className="f">IP<input className="mono" value={form.ipAddress ?? ''} onChange={(e) => set('ipAddress', e.target.value)} /></label>
        <label className="f">MAC<input className="mono" value={form.macAddress ?? ''} onChange={(e) => set('macAddress', e.target.value)} /></label>
        <label className="f">Hãng<input value={form.vendor ?? ''} onChange={(e) => set('vendor', e.target.value)} /></label>
        <label className="f">Chủ sở hữu<input value={form.owner ?? ''} onChange={(e) => set('owner', e.target.value)} /></label>
        <label className="f">Vị trí<input value={form.location ?? ''} onChange={(e) => set('location', e.target.value)} /></label>
        <label className="f">Tag (cách nhau dấu phẩy)<input value={(form.tags ?? []).join(', ')} onChange={(e) => set('tags', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} /></label>
      </div>
      <label className="f" style={{ marginTop: 12 }}>Ghi chú<textarea value={form.note ?? ''} onChange={(e) => set('note', e.target.value)} /></label>
    </Modal>
  </>);
}

const assetKind = (t: string): DevKind => (KIND_ORDER.includes(t as DevKind) ? (t as DevKind) : 'other');

function guessType(t: string): string {
  const s = t.toLowerCase();
  return /camera/.test(s) ? 'camera' : /nvr|dvr/.test(s) ? 'nvr' : /router|gateway/.test(s) ? 'router' : /switch/.test(s) ? 'switch' : /printer|in/.test(s) && /printer|máy in/.test(s) ? 'printer'
    : /nas/.test(s) ? 'nas' : /server|chủ/.test(s) ? 'server' : /phone|điện thoại/.test(s) ? 'phone' : /pc|windows|máy tính|laptop/.test(s) ? 'workstation' : 'other';
}
