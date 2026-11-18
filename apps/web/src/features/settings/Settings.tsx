import { useEffect, useRef, useState } from 'react';
import { useAgent } from '../../app/context';
import { Database, HardDrive, Info, Lock, PlugZap, Download, Upload } from 'lucide-react';
import { Banner, Card, PageHeader, ProgressBar, fmtBytes } from '../../components/ui';
import { getSetting, setSetting } from '../../infrastructure/db/db';
import { APP_VERSION, BACKUP_EXT, downloadText, exportBackup, importBackup, MAX_IMPORT_BYTES, validateBackup, type ImportPreview } from '../../infrastructure/db/backup';
import { applyRetention, clearAllLocalData, DEFAULT_RETENTION, requestPersistence, storageEstimate } from '../../infrastructure/db/repo';
import { ouiVersion } from '../../infrastructure/oui/oui';
import { AGENT_DOWNLOAD_URL } from '../../infrastructure/agent/client';

export default function Settings() {
  const { status, health, revoke } = useAgent();
  const [ret, setRet] = useState(DEFAULT_RETENTION); const [est, setEst] = useState<Awaited<ReturnType<typeof storageEstimate>>>({});
  const [msg, setMsg] = useState<{ k: 'ok' | 'bad' | 'warn'; t: string }>(); const [prev, setPrev] = useState<ImportPreview>(); const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [oui, setOui] = useState<string>(); const file = useRef<HTMLInputElement>(null);
  const refresh = () => void storageEstimate().then(setEst);
  useEffect(() => { void getSetting('retention', DEFAULT_RETENTION).then(setRet); refresh(); ouiVersion().then((x) => setOui(`${x.version} — ${x.entries.toLocaleString('vi-VN')} mã`)).catch(() => undefined); }, []);

  const doExport = async () => { const d = await exportBackup(); downloadText(`hachihi-backup-${new Date().toISOString().slice(0, 10)}${BACKUP_EXT}`, JSON.stringify(d)); setMsg({ k: 'ok', t: 'Đã tạo file backup.' }); };
  const pick = async (f: File) => {
    if (f.size > MAX_IMPORT_BYTES) { setMsg({ k: 'bad', t: `File quá lớn (tối đa ${fmtBytes(MAX_IMPORT_BYTES)}).` }); return; }
    const r = validateBackup(await f.text()); if (!r.ok) { setMsg({ k: 'bad', t: r.error }); setPrev(undefined); return; } setPrev(r); setMsg(undefined);
  };
  const doImport = async () => {
    if (!prev) return;
    if (mode === 'replace' && !confirm('Chế độ THAY THẾ sẽ xoá dữ liệu hiện có. Tiếp tục?')) return;
    try { await importBackup(prev.data, mode); setPrev(undefined); setMsg({ k: 'ok', t: 'Đã nhập dữ liệu.' }); refresh(); } catch (e) { setMsg({ k: 'bad', t: 'Nhập thất bại, dữ liệu cũ được giữ nguyên: ' + (e as Error).message }); }
  };

  return (<>
    <PageHeader title="Cài đặt & Giới thiệu" sub={`Hachihi Network Tool v${APP_VERSION}`} />
    {msg && <Banner kind={msg.k}>{msg.t}</Banner>}
    <div className="grid g2">
      <Card title="Backup / Restore" icon={Database}>
        <p>Dữ liệu chỉ nằm trong trình duyệt này và có thể bị xoá nếu bạn xoá dữ liệu trang web. Hãy backup định kỳ.</p>
        <div className="row"><button className="primary" onClick={() => void doExport()}><Download size={15} />Xuất backup</button><button onClick={() => file.current?.click()}><Upload size={15} />Chọn file để nhập</button>
          <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ''; }} /></div>
        {prev && (<div style={{ marginTop: 10 }}><p>File hợp lệ: {Object.entries(prev.counts).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
          <div className="row"><label className="chk"><input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')} />Gộp (không trùng lặp)</label><label className="chk"><input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} />Thay thế</label>
            <button className="primary" onClick={() => void doImport()}>Nhập</button><button className="ghost" onClick={() => setPrev(undefined)}>Huỷ</button></div></div>)}
      </Card>
      <Card title="Lưu trữ cục bộ" icon={HardDrive}>
        {est.usage !== undefined && est.quota ? <div style={{ margin: '4px 0 10px' }}><ProgressBar value={est.usage} max={est.quota} /></div> : null}
        <p>Đang dùng: <b>{fmtBytes(est.usage)}</b> / {fmtBytes(est.quota)}. Lưu trữ bền vững: <b>{est.persisted === undefined ? 'không rõ' : est.persisted ? 'đã bật' : 'chưa'}</b>.</p>
        <div className="row"><button onClick={() => void requestPersistence().then((ok) => { setMsg({ k: ok ? 'ok' : 'warn', t: ok ? 'Trình duyệt đã chấp thuận lưu trữ bền vững.' : 'Trình duyệt không chấp thuận (không đảm bảo giữ dữ liệu).' }); refresh(); })}>Yêu cầu lưu trữ bền vững</button></div>
        <h3 style={{ marginTop: 14 }}>Retention (chỉ chạy khi bạn bấm)</h3>
        <div className="row"><label className="f">Số phiên quét tối đa<input type="number" min={1} value={ret.maxScanSessions} onChange={(e) => setRet({ ...ret, maxScanSessions: Math.max(1, Number(e.target.value)) })} style={{ width: 110 }} /></label>
          <label className="f">Giữ monitor (ngày)<input type="number" min={1} value={ret.monitorDays} onChange={(e) => setRet({ ...ret, monitorDays: Math.max(1, Number(e.target.value)) })} style={{ width: 110 }} /></label></div>
        <div className="row" style={{ marginTop: 8 }}><button onClick={async () => { await setSetting('retention', ret); const r = await applyRetention(); setMsg({ k: 'ok', t: `Đã xoá ${r.sessions} phiên quét và ${r.samples} mẫu monitor cũ.` }); refresh(); }}>Lưu & áp dụng retention</button>
          <button className="danger" onClick={() => { if (confirm('XOÁ TOÀN BỘ dữ liệu cục bộ của Hachihi trên trình duyệt này? Không thể hoàn tác.')) void clearAllLocalData().then(() => { setMsg({ k: 'ok', t: 'Đã xoá toàn bộ dữ liệu cục bộ.' }); refresh(); }); }}>Xoá toàn bộ dữ liệu</button></div>
        <p className="small muted">Hachihi không bao giờ xoá dữ liệu cũ một cách âm thầm.</p>
      </Card>
      <Card title="Agent" icon={PlugZap}>
        <p>Trạng thái: <b>{status}</b>{health ? ` · Agent ${health.agentVersion} (${health.platform}) · giao thức v${health.protocolVersion}` : ''}</p>
        {status === 'connected' && <button onClick={() => void revoke()}>Thu hồi ghép cặp (ngắt kết nối)</button>}
        <p className="small muted">Token ghép cặp chỉ giữ trong bộ nhớ trang này (không lưu localStorage); tải lại trang là phải ghép cặp lại. <a href={AGENT_DOWNLOAD_URL} target="_blank" rel="noreferrer noopener">Tải Agent</a></p>
      </Card>
      <Card title="Quyền riêng tư" icon={Lock}>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>Không đăng nhập, không analytics, không tracking.</li><li>Không gửi IP/MAC/SSID/hostname/kết quả quét lên máy chủ nào của Hachihi.</li>
          <li>Không đọc hay lưu mật khẩu WiFi, thông tin đăng nhập camera.</li><li>Chỉ các công cụ bạn chủ động bấm (DNS-over-HTTPS, IP public, Speed Test) mới gọi dịch vụ bên ngoài, và được ghi rõ trên từng trang.</li>
        </ul>
      </Card>
      <Card title="Giới thiệu" icon={Info}><dl className="kv"><dt>Phiên bản Web</dt><dd>{APP_VERSION}</dd><dt>Dataset OUI</dt><dd>{oui ?? '—'}</dd><dt>Mã nguồn gốc</dt><dd>Hachihi Network Scanner (Windows, C#) — logic quét được tái sử dụng trong Agent</dd></dl>
        <p className="small muted">Phần mềm cung cấp “như hiện có”. Chỉ quét mạng bạn sở hữu hoặc được ủy quyền. Chi tiết giấy phép thư viện: xem THIRD_PARTY_NOTICES.md.</p></Card>
    </div>
  </>);
}
