import type { AgentDevice } from './types';

export function hashString(s: string): string {
  // FNV-1a 53-bit-ish: đủ cho khoá nội bộ, KHÔNG dùng cho bảo mật.
  let h1 = 0xdeadbeef ^ s.length, h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Network key: subnet + gateway (interfaceId của Agent đổi theo phiên nên không dùng). Không phải định danh tuyệt đối. */
export function networkKey(subnetCidr: string, gateway?: string | null): string {
  return `net:${hashString(`${subnetCidr}|${gateway ?? ''}`)}`;
}

/** MAC hợp lệ & không randomized → mac:XX; ngược lại fallback ip+hostname (đánh dấu kém bền). */
export function identityKey(d: Pick<AgentDevice, 'macAddress' | 'macRandomized' | 'ipAddress' | 'hostname'>): string {
  const mac = d.macAddress?.toUpperCase();
  if (mac && /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac) && !d.macRandomized) return `mac:${mac}`;
  return `ip:${d.ipAddress}|${(d.hostname ?? '').toLowerCase()}`;
}
