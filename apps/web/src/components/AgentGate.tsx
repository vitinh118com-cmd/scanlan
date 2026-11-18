import { useState, type ReactNode } from 'react';
import { AgentError, AGENT_DOWNLOAD_URL, AGENT_PORT } from '../infrastructure/agent/client';
import { useAgent } from '../app/context';
import { Banner, Card } from './ui';

/** Ô nhập mã ghép cặp (mã 6 số hiển thị trên cửa sổ Agent). */
export function PairBox() {
  const { pair, health } = useAgent();
  const [code, setCode] = useState(''); const [err, setErr] = useState<string>(); const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setErr(undefined);
    try { await pair(code.trim()); setCode(''); }
    catch (e) { setErr(e instanceof AgentError ? e.message : (e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Card title="Ghép cặp với Agent">
      <p>Agent {health?.agentVersion} đang chạy. Nhập <b>mã 6 số</b> đang hiển thị trên cửa sổ Agent (mã dùng một lần, hiệu lực 5 phút). Việc này chứng minh bạn đang ngồi trước máy chạy Agent.</p>
      <div className="row">
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="off" placeholder="000000"
          aria-label="Mã ghép cặp" className="mono" style={{ width: 120, fontSize: 18, letterSpacing: 3 }} onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && void submit()} />
        <button className="primary" disabled={code.length !== 6 || busy} onClick={() => void submit()}>{busy ? 'Đang ghép…' : 'Ghép cặp'}</button>
      </div>
      {err && <p style={{ color: 'var(--bad)' }} role="alert">{err}</p>}
    </Card>
  );
}

export function AgentInstallHelp({ error }: { error?: string }) {
  return (
    <Card title="Chưa kết nối được Agent">
      <p>Tính năng này cần <b>Hachihi Agent</b> (miễn phí) chạy trên máy trong mạng cần kiểm tra — trình duyệt không thể tự quét LAN/WiFi. Các công cụ không cần Agent (Speed Test, Network Tools, History, Inventory, Reports…) vẫn dùng bình thường.</p>
      <ol>
        <li>Tải Agent từ trang phát hành chính thức: <a href={AGENT_DOWNLOAD_URL} target="_blank" rel="noreferrer noopener">GitHub Releases</a> và kiểm tra checksum SHA-256.</li>
        <li>Chạy Agent (chỉ lắng nghe <span className="mono">127.0.0.1:{AGENT_PORT}</span>, không mở ra mạng).</li>
        <li>Quay lại trang này và nhập mã ghép cặp hiển thị trên cửa sổ Agent.</li>
      </ol>
      <p className="small muted">Nếu Agent đã chạy mà vẫn không kết nối: trình duyệt có thể đang chặn truy cập mạng nội bộ — hãy chọn “Cho phép” khi trình duyệt hỏi quyền truy cập thiết bị trong mạng cục bộ, và kiểm tra Origin của trang đã nằm trong danh sách cho phép của Agent.</p>
      {error && <p className="small muted">Chi tiết: {error}</p>}
    </Card>
  );
}

/** Bao một trang cần Agent: hiện hướng dẫn cài/ghép cặp nếu chưa sẵn sàng, và kiểm tra capability. */
export function RequireAgent({ capability, children, feature }: { capability?: string; feature: string; children: ReactNode }) {
  const { status, error, has, health } = useAgent();
  if (status === 'checking') return <Banner>Đang kiểm tra Agent…</Banner>;
  if (status === 'not-installed' || status === 'error') return <AgentInstallHelp error={error} />;
  if (status === 'unpaired') return <PairBox />;
  if (capability && !has(capability))
    return <Banner kind="warn">{feature} chưa khả dụng với Agent hiện tại{health?.platform && health.platform !== 'windows' ? ` (nền tảng: ${health.platform}; tính năng này cần Agent chạy trên Windows)` : ''}.</Banner>;
  return <>{children}</>;
}
