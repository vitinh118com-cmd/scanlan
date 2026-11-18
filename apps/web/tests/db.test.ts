import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { HachihiDB } from '../src/infrastructure/db/db';
import { exportBackup, importBackup, validateBackup } from '../src/infrastructure/db/backup';

let db: HachihiDB;
beforeEach(async () => { db = new HachihiDB('test-' + Math.random()); await db.open(); });

const net = { id: 'n1', networkKey: 'k', label: '192.168.1.0/24', interfaceLabel: 'eth0', subnetCidr: '192.168.1.0/24', gateway: '192.168.1.1', firstSeenAt: 1, lastSeenAt: 1, createdAt: 1, updatedAt: 1 };

describe('IndexedDB + backup', () => {
  it('CRUD và index', async () => {
    await db.networks.add(net);
    expect((await db.networks.where('networkKey').equals('k').first())?.id).toBe('n1');
    await expect(db.networks.add({ ...net, id: 'n2' })).rejects.toThrow(); // networkKey duy nhất
  });
  it('export → import (replace) khứ hồi', async () => {
    await db.networks.add(net);
    const f = await exportBackup(db); const text = JSON.stringify(f);
    const v = validateBackup(text); expect(v.ok).toBe(true);
    const db2 = new HachihiDB('test-' + Math.random()); await db2.open();
    if (v.ok) await importBackup(v.data, 'replace', db2);
    expect(await db2.networks.count()).toBe(1);
  });
  it('merge không nhân đôi', async () => {
    await db.networks.add(net); const v = validateBackup(JSON.stringify(await exportBackup(db)));
    if (v.ok) { await importBackup(v.data, 'merge', db); await importBackup(v.data, 'merge', db); }
    expect(await db.networks.count()).toBe(1);
  });
  it('từ chối JSON hỏng / sai schema / thiếu trường', () => {
    for (const bad of ['{not json', '{}', '[]', JSON.stringify({ schemaVersion: 999 }), JSON.stringify({ schemaVersion: 1, networks: 'x' })]) expect(validateBackup(bad).ok).toBe(false);
  });
  it('import lỗi giữa chừng → rollback, dữ liệu cũ nguyên vẹn', async () => {
    await db.networks.add(net);
    const f = await exportBackup(db);
    const broken = { ...f, networks: [{ ...net, id: 'n9', networkKey: 'k9' }, { ...net, id: 'n10', networkKey: 'k9' }] }; // vi phạm unique key
    await importBackup(broken as never, 'replace', db).catch(() => undefined);
    expect(await db.networks.count()).toBe(1); expect((await db.networks.get('n1'))?.networkKey).toBe('k');
  });
});
