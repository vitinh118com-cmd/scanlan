import { db, getSetting, isQuotaError, uid } from './db';
import { identityKey, networkKey } from '../../core/domain/identity';
import type { AgentDevice, DeviceRec, NetworkRec, ObservationRec, ScanSessionRec } from '../../core/domain/types';
import { APP_VERSION } from './backup';

export const DEFAULT_RETENTION = { maxScanSessions: 100, monitorDays: 7 };

export async function upsertNetwork(subnetCidr: string, gateway: string | undefined, interfaceLabel: string): Promise<NetworkRec> {
  const key = networkKey(subnetCidr, gateway);
  const now = Date.now();
  const ex = await db.networks.where('networkKey').equals(key).first();
  if (ex) { const u = { ...ex, lastSeenAt: now, updatedAt: now, interfaceLabel }; await db.networks.put(u); return u; }
  const n: NetworkRec = { id: uid(), networkKey: key, label: subnetCidr, interfaceLabel, subnetCidr, gateway: gateway ?? '', firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now };
  await db.networks.add(n);
  return n;
}

export interface SaveScanInput {
  network: NetworkRec; cidr: string; profile: string; status: ScanSessionRec['status']; startedAt: number; completedAt?: number;
  total: number; processed: number; devices: AgentDevice[]; agentVersion: string; errorSummary?: string;
}

/** Lưu một phiên quét + upsert thiết bị + observation trong 1 transaction. Báo lỗi dung lượng rõ ràng, KHÔNG xoá dữ liệu âm thầm. */
export async function saveScan(inp: SaveScanInput): Promise<ScanSessionRec> {
  const session: ScanSessionRec = {
    id: uid(), networkId: inp.network.id, startedAt: inp.startedAt, completedAt: inp.completedAt, status: inp.status, profile: inp.profile,
    cidr: inp.cidr, totalTargets: inp.total, processedTargets: inp.processed, devicesFound: inp.devices.length, agentVersion: inp.agentVersion,
    appVersion: APP_VERSION, errorSummary: inp.errorSummary,
  };
  const now = Date.now();
  try {
    await db.transaction('rw', db.scanSessions, db.devices, db.deviceObservations, async () => {
      await db.scanSessions.add(session);
      for (const d of inp.devices) {
        const key = identityKey(d);
        const id = `${inp.network.id}:${key}`;
        const prev = await db.devices.get(id);
        const rec: DeviceRec = {
          id, networkId: inp.network.id, identityKey: key, ipAddress: d.ipAddress, macAddress: d.macAddress ?? undefined, macRandomized: d.macRandomized,
          hostname: d.hostname ?? undefined, vendor: d.vendor ?? undefined, deviceType: d.deviceType, osGuess: d.osGuess ?? undefined,
          classificationConfidence: d.classificationConfidence, status: d.status, openPorts: d.openPorts, httpTitle: d.httpTitle ?? undefined,
          pingMs: d.pingMs ?? undefined, firstSeenAt: prev?.firstSeenAt ?? now, lastSeenAt: now, note: prev?.note, tags: prev?.tags ?? [],
          source: d.source, updatedAt: now,
        };
        await db.devices.put(rec);
        const obs: ObservationRec = {
          id: uid(), scanSessionId: session.id, deviceId: id, networkId: inp.network.id, observedAt: now, ipAddress: d.ipAddress,
          macAddress: d.macAddress ?? undefined, pingMs: d.pingMs ?? undefined, status: d.status, ports: d.openPorts, protocols: d.source,
          evidence: [`deviceType=${d.deviceType}`, `confidence=${d.classificationConfidence}`],
        };
        await db.deviceObservations.add(obs);
      }
    });
  } catch (e) {
    if (isQuotaError(e)) throw new Error('Hết dung lượng lưu trữ của trình duyệt. Hãy xuất backup rồi xoá bớt lịch sử trong Cài đặt.');
    throw e;
  }
  return session;
}

/** Áp dụng retention theo cấu hình. CHỈ chạy khi người dùng bấm (không xoá âm thầm). */
export async function applyRetention(): Promise<{ sessions: number; samples: number }> {
  const r = await getSetting('retention', DEFAULT_RETENTION);
  const all = await db.scanSessions.orderBy('startedAt').toArray();
  const drop = all.slice(0, Math.max(0, all.length - r.maxScanSessions));
  for (const s of drop) {
    await db.deviceObservations.where('scanSessionId').equals(s.id).delete();
    await db.scanSessions.delete(s.id);
  }
  const cutoff = Date.now() - r.monitorDays * 86400000;
  const samples = await db.monitorSamples.where('timestamp').below(cutoff).delete();
  return { sessions: drop.length, samples };
}

export async function clearAllLocalData(): Promise<void> {
  await db.delete();
  await db.open();
  try { localStorage.clear(); } catch { /* ignore */ }
}

export async function storageEstimate(): Promise<{ usage?: number; quota?: number; persisted?: boolean }> {
  const out: { usage?: number; quota?: number; persisted?: boolean } = {};
  try {
    if (navigator.storage?.estimate) { const e = await navigator.storage.estimate(); out.usage = e.usage; out.quota = e.quota; }
    if (navigator.storage?.persisted) out.persisted = await navigator.storage.persisted();
  } catch { /* ignore */ }
  return out;
}
export async function requestPersistence(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}
