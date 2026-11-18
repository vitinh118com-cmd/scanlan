export interface DiffDevice { identityKey: string; ipAddress: string; macAddress?: string; hostname?: string; vendor?: string; deviceType?: string }
export interface DiffResult {
  added: DiffDevice[]; removed: DiffDevice[];
  ipChanged: { before: DiffDevice; after: DiffDevice }[];
  macChanged: { before: DiffDevice; after: DiffDevice }[];
}

/** So sánh hai tập thiết bị. Thiết bị khớp theo identityKey; cùng IP khác MAC → macChanged; cùng MAC khác IP → ipChanged. */
export function compareDevices(before: DiffDevice[], after: DiffDevice[]): DiffResult {
  const bKey = new Map(before.map((d) => [d.identityKey, d]));
  const aKey = new Map(after.map((d) => [d.identityKey, d]));
  const res: DiffResult = { added: [], removed: [], ipChanged: [], macChanged: [] };
  const consumedB = new Set<string>(), consumedA = new Set<string>();

  for (const [k, a] of aKey) {
    const b = bKey.get(k);
    if (!b) continue;
    consumedA.add(k); consumedB.add(k);
    if (b.ipAddress !== a.ipAddress) res.ipChanged.push({ before: b, after: a });
  }
  const bIp = new Map(before.filter((d) => !consumedB.has(d.identityKey)).map((d) => [d.ipAddress, d]));
  for (const a of after) {
    if (consumedA.has(a.identityKey)) continue;
    const b = bIp.get(a.ipAddress);
    if (b && b.macAddress && a.macAddress && b.macAddress !== a.macAddress) {
      res.macChanged.push({ before: b, after: a });
      consumedA.add(a.identityKey); consumedB.add(b.identityKey);
    }
  }
  for (const a of after) if (!consumedA.has(a.identityKey)) res.added.push(a);
  for (const b of before) if (!consumedB.has(b.identityKey)) res.removed.push(b);
  return res;
}
