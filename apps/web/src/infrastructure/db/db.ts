import Dexie, { type Table } from 'dexie';
import type {
  AssetRec, BaselineRec, CameraRec, DeviceRec, MonitorSampleRec, NetworkRec, ObservationRec, ScanSessionRec,
  SettingRec, SpeedTestRec, TopologyLayoutRec, WifiSnapshotRec,
} from '../../core/domain/types';

export const DB_NAME = 'hachihi-network-tool';
export const SCHEMA_VERSION = 1;
export interface ReportRec { id: string; createdAt: number; reportType: string; fileName: string; filters?: unknown }

export class HachihiDB extends Dexie {
  appMeta!: Table<SettingRec, string>;
  networks!: Table<NetworkRec, string>;
  scanSessions!: Table<ScanSessionRec, string>;
  devices!: Table<DeviceRec, string>;
  deviceObservations!: Table<ObservationRec, string>;
  baselines!: Table<BaselineRec, string>;
  assets!: Table<AssetRec, string>;
  wifiSnapshots!: Table<WifiSnapshotRec, string>;
  speedTests!: Table<SpeedTestRec, string>;
  monitorSamples!: Table<MonitorSampleRec, number>;
  cameras!: Table<CameraRec, string>;
  topologyLayouts!: Table<TopologyLayoutRec, string>;
  reports!: Table<ReportRec, string>;

  constructor(name = DB_NAME) {
    super(name);
    // Index theo docs/database-schema.md (spec §8.3) + bảng cameras/topologyLayouts bổ sung cho §6.4/§6.5.
    this.version(1).stores({
      appMeta: 'key',
      networks: 'id, &networkKey',
      scanSessions: 'id, networkId, startedAt, status',
      devices: 'id, networkId, identityKey, ipAddress, macAddress, lastSeenAt',
      deviceObservations: 'id, scanSessionId, deviceId, observedAt',
      baselines: 'id, networkId, deviceIdentityKey',
      assets: 'id, networkId, deviceId, assetName',
      wifiSnapshots: 'id, capturedAt',
      speedTests: 'id, timestamp',
      monitorSamples: '++id, sessionId, timestamp',
      cameras: 'id, ipAddress, discoveredAt',
      topologyLayouts: 'networkId',
      reports: 'id, createdAt',
    });
  }
}

export const db = new HachihiDB();
export const uid = (): string => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

export const BACKUP_TABLES = [
  'networks', 'scanSessions', 'devices', 'deviceObservations', 'baselines', 'assets', 'wifiSnapshots', 'speedTests', 'cameras', 'topologyLayouts',
] as const;

/** Chỉ localStorage cho preference nhỏ (theme/ngôn ngữ). Dữ liệu quét luôn ở IndexedDB. */
export function lsGet<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(`hachihi.${key}`); return v === null ? fallback : (JSON.parse(v) as T); } catch { return fallback; }
}
export function lsSet(key: string, value: unknown): void {
  try { localStorage.setItem(`hachihi.${key}`, JSON.stringify(value)); } catch { /* private mode */ }
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const r = await db.appMeta.get(key);
  return r ? (r.value as T) : fallback;
}
export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.appMeta.put({ key, value, updatedAt: Date.now() });
}

export function isQuotaError(e: unknown): boolean {
  return e instanceof DOMException ? e.name === 'QuotaExceededError' : (e as { name?: string })?.name === 'QuotaExceededError';
}
