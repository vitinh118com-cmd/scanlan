import type { AgentDevice } from '../../core/domain/types';

export const AGENT_PORT = 47800;
export const AGENT_BASE = `http://127.0.0.1:${AGENT_PORT}/api/v1`;
export const AGENT_DOWNLOAD_URL = 'https://github.com/hachihi/hachihi-network-tool/releases'; // TODO: cập nhật URL repo thật

export interface AgentHealth { agentVersion: string; protocolVersion: number; status: string; paired: boolean; platform: string; capabilities: string[] }
export interface AgentInterface { interfaceId: string; name: string; status: string; ipv4?: string; subnetCidr?: string; gateway?: string; dnsServers: string[]; isWifi: boolean }
export interface ScanStatusResponse {
  scanId: string; status: string; processed: number; total: number; devicesFound: number; startedAt: string; completedAt?: string;
  cidr: string; profile: string; errorSummary?: string; skippedSubnets: string[]; devices: AgentDevice[]; nextIndex: number;
}
export interface ScanOptions { cidr: string; profile: 'fast' | 'normal' | 'deep'; includeArpCache: boolean; includeHostname: boolean; includeCommonPorts: boolean; confirmedAuthorized?: boolean; confirmLarge?: boolean }
export interface AgentCamera { ipAddress: string; macAddress?: string; vendor?: string; hostname?: string; protocols: string[]; servicePorts: number[]; confidence: 'low' | 'medium' | 'high' }
export interface WifiAp { ssid: string; bssid: string; rssiDbm: number; signalQuality: number; frequencyMHz: number; channel: number; band: string; phy: string; security: string; connected: boolean }
export interface WifiIface { name: string; connection?: { ssid: string; bssid: string; signalQuality: number; rssiDbm?: number; channel?: number; band?: string; phy?: string; security?: string; rxMbps: number; txMbps: number }; nearbyAps: WifiAp[] }
export interface MonitorTick { target: string; timestamp: string; rttMs?: number | null; isReachable: boolean; errorCode?: string | null; sent: number; received: number; lossPercent: number; downtimeSec: number }

export class AgentError extends Error {
  constructor(public code: string, message: string, public status = 0, public retryable = false, public details?: Record<string, unknown>) { super(message); }
}

export interface AgentEvent { protocolVersion: number; eventId: string; timestamp: string; jobId: string | null; type: string; data: unknown }

/**
 * Client Agent. Token chỉ giữ trong bộ nhớ (không localStorage/sessionStorage) theo spec §7.4;
 * reload trang = ghép cặp lại. Mọi lỗi mạng được chuẩn hoá thành AgentError.
 */
export class AgentClient {
  private token: string | null = null;
  private ws: WebSocket | null = null;
  private listeners = new Set<(e: AgentEvent) => void>();
  wsConnected = false;
  onChange?: () => void;

  get paired() { return this.token !== null; }

  private async req<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let res: Response;
    try {
      res = await fetch(AGENT_BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal, cache: 'no-store' });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new AgentError('AGENT_UNREACHABLE', 'Không kết nối được Agent. Agent đã chạy chưa? Trình duyệt có chặn truy cập mạng nội bộ không?');
    }
    if (res.status === 204 || res.status === 202 && res.headers.get('content-length') === '0') return undefined as T;
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      if (res.status === 401 && data?.code === 'AGENT_NOT_PAIRED') { this.token = null; this.closeEvents(); this.onChange?.(); }
      throw new AgentError(data?.code ?? 'HTTP_' + res.status, data?.message ?? `Lỗi ${res.status}`, res.status, !!data?.retryable, data?.details);
    }
    return data as T;
  }

  health(signal?: AbortSignal) { return this.req<AgentHealth>('GET', '/health', undefined, signal); }
  async pair(code: string) {
    const r = await this.req<{ token: string; expiresInSec: number }>('POST', '/pair', { code });
    this.token = r.token; this.onChange?.(); this.openEvents();
  }
  async revoke() { try { await this.req('POST', '/session/revoke'); } finally { this.token = null; this.closeEvents(); this.onChange?.(); } }
  interfaces() { return this.req<AgentInterface[]>('GET', '/network/interfaces'); }
  startScan(o: ScanOptions) { return this.req<{ scanId: string; status: string }>('POST', '/scans', o); }
  scanStatus(id: string, since: number) { return this.req<ScanStatusResponse>('GET', `/scans/${id}?since=${since}`); }
  cancelScan(id: string) { return this.req('POST', `/scans/${id}/cancel`); }
  startCameras(o: { cidr?: string; confirmedAuthorized?: boolean; confirmLarge?: boolean }) { return this.req<{ jobId: string; status: string }>('POST', '/discovery/cameras', o); }
  cameraStatus(id: string) { return this.req<{ jobId: string; status: string; cameras: AgentCamera[] }>('GET', `/discovery/cameras/${id}`); }
  cancelCameras(id: string) { return this.req('POST', `/discovery/cameras/${id}/cancel`); }
  wifiSnapshot() { return this.req<{ capturedAt: string; interfaces: WifiIface[] }>('GET', '/wifi/snapshot'); }
  wifiSurvey() { return this.req<{ capturedAt: string; interfaces: WifiIface[] }>('POST', '/wifi/survey'); }
  startMonitor(target: string, intervalSec: number, keepRunning = false) { return this.req<{ sessionId: string }>('POST', '/monitor/sessions', { target, intervalSec, keepRunning }); }
  stopMonitor(id: string) { return this.req('DELETE', `/monitor/sessions/${id}`); }
  wake(mac: string) { return this.req('POST', '/network/wake', { mac }); }
  tls(host: string, port: number, confirmedAuthorized: boolean) { return this.req<Record<string, unknown>>('POST', '/tls/inspect', { host, port, confirmedAuthorized }); }
  wan(target: string, ports: number[] | undefined, confirmedAuthorized: boolean) {
    return this.req<{ target: string; resolved: string[]; connectedTo: string; results: { port: number; state: string; service: string; latencyMs?: number; banner?: string }[] }>('POST', '/wan/check', { target, ports, confirmedAuthorized });
  }

  // ---- WebSocket sự kiện (token ngắn hạn qua query theo spec) ----
  on(fn: (e: AgentEvent) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private openEvents() {
    this.closeEvents();
    if (!this.token) return;
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${AGENT_PORT}/api/v1/events?session=${encodeURIComponent(this.token)}`);
      ws.onopen = () => { this.wsConnected = true; this.onChange?.(); };
      ws.onclose = () => { this.wsConnected = false; this.onChange?.(); };
      ws.onerror = () => { this.wsConnected = false; };
      ws.onmessage = (m) => { try { const e = JSON.parse(String(m.data)) as AgentEvent; this.listeners.forEach((l) => l(e)); } catch { /* bỏ message hỏng */ } };
      this.ws = ws;
    } catch { this.wsConnected = false; }
  }
  private closeEvents() { try { this.ws?.close(); } catch { /* */ } this.ws = null; this.wsConnected = false; }
}

export const agent = new AgentClient();
