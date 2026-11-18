import { z } from 'zod';
import { BACKUP_TABLES, SCHEMA_VERSION, db, type HachihiDB } from './db';

export const APP_VERSION = '1.0.0';
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

const rec = z.object({ id: z.string() }).passthrough();
const backupSchema = z.object({
  schemaVersion: z.number().int(),
  exportedAt: z.string(),
  appVersion: z.string(),
  networks: z.array(rec.extend({ networkKey: z.string() })).default([]),
  scanSessions: z.array(rec).default([]),
  devices: z.array(rec.extend({ identityKey: z.string(), networkId: z.string() })).default([]),
  deviceObservations: z.array(rec).default([]),
  baselines: z.array(rec).default([]),
  assets: z.array(rec).default([]),
  wifiSnapshots: z.array(rec).default([]),
  speedTests: z.array(rec).default([]),
  cameras: z.array(rec).default([]),
  topologyLayouts: z.array(z.object({ networkId: z.string() }).passthrough()).default([]),
  settings: z.record(z.unknown()).default({}),
});
export type BackupFile = z.infer<typeof backupSchema>;
export const BACKUP_EXT = '.hachihtool.json';

export async function exportBackup(database: HachihiDB = db, networkId?: string): Promise<BackupFile> {
  const out: Record<string, unknown> = { schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), appVersion: APP_VERSION };
  for (const t of BACKUP_TABLES) {
    const table = database.table(t);
    let rows = await table.toArray();
    if (networkId) rows = rows.filter((r: Record<string, unknown>) => (t === 'networks' ? r.id === networkId : !('networkId' in r) || r.networkId === networkId || r.networkId === undefined));
    out[t] = rows;
  }
  const settings: Record<string, unknown> = {};
  for (const s of await database.appMeta.toArray()) settings[s.key] = s.value;
  out.settings = settings;
  return out as BackupFile;
}

export interface ImportPreview { ok: true; counts: Record<string, number>; data: BackupFile }
export interface ImportError { ok: false; error: string }

/** Validate trước khi import; KHÔNG ghi gì vào DB. */
export function validateBackup(text: string): ImportPreview | ImportError {
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, error: 'File quá lớn (giới hạn 50 MB).' };
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { ok: false, error: 'File không phải JSON hợp lệ (có thể bị hỏng).' }; }
  const r = backupSchema.safeParse(parsed);
  if (!r.success) return { ok: false, error: 'Cấu trúc backup không hợp lệ: ' + r.error.issues.slice(0, 3).map((i) => i.path.join('.') + ' ' + i.message).join('; ') };
  if (r.data.schemaVersion > SCHEMA_VERSION) return { ok: false, error: `Backup từ phiên bản mới hơn (schema ${r.data.schemaVersion} > ${SCHEMA_VERSION}). Hãy cập nhật ứng dụng.` };
  const counts: Record<string, number> = {};
  for (const t of BACKUP_TABLES) counts[t] = (r.data[t] as unknown[]).length;
  return { ok: true, counts, data: r.data };
}

/**
 * Import trong MỘT transaction (lỗi → rollback toàn bộ).
 * merge: ghi đè theo id ổn định (không nhân đôi); replace: xoá dữ liệu cũ trước rồi ghi.
 */
export async function importBackup(data: BackupFile, mode: 'merge' | 'replace', database: HachihiDB = db): Promise<void> {
  const tables = BACKUP_TABLES.map((t) => database.table(t));
  await database.transaction('rw', [...tables, database.appMeta], async () => {
    if (mode === 'replace') { for (const t of tables) await t.clear(); await database.appMeta.clear(); }
    for (const name of BACKUP_TABLES) {
      const rows = data[name] as Record<string, unknown>[];
      if (rows.length) {
        if (name === 'networks' && mode === 'merge') {
          // networkKey là unique: nếu đã có network cùng key nhưng khác id thì dùng lại bản có sẵn.
          for (const n of rows) {
            const exist = await database.networks.where('networkKey').equals(n.networkKey as string).first();
            if (!exist || exist.id === n.id) await database.networks.put(n as never);
          }
        } else await database.table(name).bulkPut(rows);
      }
    }
    for (const [k, v] of Object.entries(data.settings)) await database.appMeta.put({ key: k, value: v, updatedAt: Date.now() });
  });
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
