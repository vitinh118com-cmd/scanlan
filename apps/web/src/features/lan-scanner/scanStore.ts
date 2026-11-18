import { useSyncExternalStore } from 'react';
import { agent, AgentError, type AgentInterface, type ScanOptions } from '../../infrastructure/agent/client';
import { saveScan, upsertNetwork } from '../../infrastructure/db/repo';
import type { AgentDevice, ScanStatus } from '../../core/domain/types';

/**
 * Store quét LAN ở mức module để phiên quét KHÔNG mất khi chuyển trang. Tiến độ lấy bằng polling (luôn hoạt động),
 * WebSocket chỉ để đánh thức poll sớm hơn — đúng yêu cầu "có polling fallback" (spec §7.5).
 */
export interface ScanState {
  scanId?: string; status: ScanStatus | 'idle'; processed: number; total: number; devices: AgentDevice[];
  startedAt?: number; cidr?: string; profile?: string; error?: string; savedSessionId?: string; skipped: string[];
}
let state: ScanState = { status: 'idle', processed: 0, total: 0, devices: [], skipped: [] };
const subs = new Set<() => void>();
const set = (p: Partial<ScanState>) => { state = { ...state, ...p }; subs.forEach((s) => s()); };
export const useScanState = () => useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => state);

let timer: number | undefined; let unsub: (() => void) | undefined; let iface: AgentInterface | undefined;
export const isScanActive = () => state.status === 'running' || state.status === 'queued' || state.status === 'cancelling';

export async function startScan(opts: ScanOptions, ifc?: AgentInterface): Promise<void> {
  if (isScanActive()) throw new Error('Đang có phiên quét chạy.');
  iface = ifc;
  set({ status: 'queued', processed: 0, total: 0, devices: [], skipped: [], error: undefined, savedSessionId: undefined, cidr: opts.cidr, profile: opts.profile, startedAt: Date.now() });
  try {
    const r = await agent.startScan(opts);
    set({ scanId: r.scanId, status: 'running' });
  } catch (e) {
    set({ status: 'failed', error: e instanceof AgentError ? e.message : (e as Error).message });
    throw e;
  }
  unsub?.(); unsub = agent.on((ev) => { if (ev.jobId === state.scanId) void poll(); });
  let since = 0;
  const loop = async () => {
    try { since = await poll(since); } catch { /* lỗi mạng tạm thời: thử lại */ }
    if (isScanActive()) timer = window.setTimeout(loop, 700);
  };
  timer = window.setTimeout(loop, 300);
  async function poll(s = since): Promise<number> {
    if (!state.scanId) return s;
    const r = await agent.scanStatus(state.scanId, s);
    const devices = r.devices.length ? mergeDevices(state.devices, r.devices) : state.devices;
    set({ status: r.status as ScanStatus, processed: r.processed, total: r.total, devices, skipped: r.skippedSubnets, error: r.errorSummary });
    if (r.status === 'completed' || r.status === 'cancelled' || r.status === 'failed') await finish(r.status as ScanStatus, r.completedAt);
    since = r.nextIndex;
    return r.nextIndex;
  }
}

function mergeDevices(cur: AgentDevice[], inc: AgentDevice[]): AgentDevice[] {
  const m = new Map(cur.map((d) => [d.ipAddress, d]));
  inc.forEach((d) => m.set(d.ipAddress, d));
  return [...m.values()].sort((a, b) => ipNum(a.ipAddress) - ipNum(b.ipAddress));
}
const ipNum = (s: string) => s.split('.').reduce((a, p) => a * 256 + Number(p), 0);

let finishing = false;
async function finish(status: ScanStatus, completedAt?: string) {
  if (finishing || state.savedSessionId) return;
  finishing = true;
  try {
    // Lưu cả phiên bị huỷ nếu đã có thiết bị — người dùng không mất kết quả đã quét được.
    if (state.devices.length > 0 || status === 'completed') {
      const cidr = state.cidr ?? '';
      const net = await upsertNetwork(iface?.subnetCidr ?? cidr, iface?.gateway, iface?.name ?? 'manual');
      const s = await saveScan({
        network: net, cidr, profile: state.profile ?? 'normal', status, startedAt: state.startedAt ?? Date.now(),
        completedAt: completedAt ? Date.parse(completedAt) : Date.now(), total: state.total, processed: state.processed,
        devices: state.devices, agentVersion: '1', errorSummary: state.error,
      });
      set({ savedSessionId: s.id });
    }
  } catch (e) { set({ error: (e as Error).message }); }
  finally { finishing = false; }
}

export async function cancelScan(): Promise<void> {
  if (!state.scanId) return;
  set({ status: 'cancelling' });
  try { await agent.cancelScan(state.scanId); } catch { /* poll sẽ phản ánh trạng thái thật */ }
}
export function disposeScanTimers() { if (timer) clearTimeout(timer); unsub?.(); }
