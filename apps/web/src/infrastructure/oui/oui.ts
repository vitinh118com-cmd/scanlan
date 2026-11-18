interface OuiData { version: string; l: Record<string, string>; m: Record<string, string>; s: Record<string, string> }
let cache: Promise<OuiData> | null = null;

/** Dataset OUI tải theo nhu cầu (không nằm trong bundle chính), cache bởi Service Worker. */
export function loadOui(): Promise<OuiData> {
  cache ??= fetch('/data/oui.json').then((r) => { if (!r.ok) throw new Error('Không tải được dataset OUI'); return r.json() as Promise<OuiData>; }).catch((e) => { cache = null; throw e; });
  return cache;
}
export function normalizeMac(input: string): string | null {
  const h = input.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  return h.length >= 6 ? h : null;
}
export function isLocallyAdministered(hex: string): boolean { return (parseInt(hex.slice(0, 2), 16) & 2) !== 0; }
/** Tra theo MA-S (36-bit) → MA-M (28-bit) → MA-L (24-bit) — ưu tiên khớp dài nhất. */
export async function lookupVendor(input: string): Promise<{ vendor: string | null; kind?: 'MA-S' | 'MA-M' | 'MA-L'; hex: string; randomized: boolean } | null> {
  const hex = normalizeMac(input);
  if (!hex) return null;
  const d = await loadOui();
  const randomized = isLocallyAdministered(hex);
  const s = hex.length >= 9 ? d.s[hex.slice(0, 9)] : undefined; if (s) return { vendor: s, kind: 'MA-S', hex, randomized };
  const m = hex.length >= 7 ? d.m[hex.slice(0, 7)] : undefined; if (m) return { vendor: m, kind: 'MA-M', hex, randomized };
  const l = d.l[hex.slice(0, 6)]; if (l) return { vendor: l, kind: 'MA-L', hex, randomized };
  return { vendor: null, hex, randomized };
}
export async function ouiVersion(): Promise<{ version: string; entries: number }> {
  const d = await loadOui();
  return { version: d.version, entries: Object.keys(d.l).length + Object.keys(d.m).length + Object.keys(d.s).length };
}
