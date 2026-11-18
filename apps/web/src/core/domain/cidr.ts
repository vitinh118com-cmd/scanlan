export function parseIPv4(s: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s.trim());
  if (!m) return null;
  let v = 0;
  for (let i = 1; i <= 4; i++) {
    const o = Number(m[i]);
    if (o > 255 || (m[i].length > 1 && m[i].startsWith('0'))) return null;
    v = v * 256 + o;
  }
  return v >>> 0;
}
export function intToIPv4(v: number): string { return [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join('.'); }

export function isValidIPv6(s: string): boolean {
  const t = s.trim();
  if (!/^[0-9a-fA-F:.]+$/.test(t) || !t.includes(':')) return false;
  try { new URL(`http://[${t}]/`); return true; } catch { return false; }
}
export function validateIp(s: string): 'ipv4' | 'ipv6' | null {
  if (parseIPv4(s) !== null) return 'ipv4';
  if (isValidIPv6(s)) return 'ipv6';
  return null;
}

export interface CidrInfo {
  cidr: string; prefix: number; network: string; broadcast: string; netmask: string; wildcard: string;
  firstHost: string; lastHost: string; totalAddresses: number; usableHosts: number; isPrivate: boolean; ipClass: string;
}

export function parseCidr(input: string): CidrInfo | null {
  const m = /^\s*([\d.]+)\s*\/\s*(\d{1,2})\s*$/.exec(input);
  if (!m) return null;
  const ip = parseIPv4(m[1]);
  const p = Number(m[2]);
  if (ip === null || p < 0 || p > 32) return null;
  const mask = p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0;
  const net = (ip & mask) >>> 0;
  const bc = (net | (~mask >>> 0)) >>> 0;
  const total = 2 ** (32 - p);
  // Quy ước: /31 (RFC 3021) và /32 dùng toàn bộ địa chỉ; còn lại bỏ network + broadcast.
  const usable = p >= 31 ? total : Math.max(0, total - 2);
  const first = p >= 31 ? net : net + 1;
  const last = p >= 31 ? bc : bc - 1;
  return {
    cidr: `${intToIPv4(net)}/${p}`, prefix: p, network: intToIPv4(net), broadcast: intToIPv4(bc),
    netmask: intToIPv4(mask), wildcard: intToIPv4(~mask >>> 0), firstHost: intToIPv4(first), lastHost: intToIPv4(last),
    totalAddresses: total, usableHosts: usable, isPrivate: isPrivateIPv4(net), ipClass: ipClassOf(net),
  };
}

export function isPrivateIPv4(v: number): boolean {
  const a = v >>> 24, b = (v >>> 16) & 255;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
function ipClassOf(v: number): string {
  const a = v >>> 24;
  if (a < 128) return 'A'; if (a < 192) return 'B'; if (a < 224) return 'C'; if (a < 240) return 'D (multicast)'; return 'E';
}

/** Chuyển dải IP bắt đầu–kết thúc thành danh sách CIDR tối thiểu. Giới hạn input hợp lý (≤ 4096 CIDR). */
export function rangeToCidrs(startStr: string, endStr: string): string[] | null {
  const s = parseIPv4(startStr), e = parseIPv4(endStr);
  if (s === null || e === null || s > e) return null;
  const out: string[] = [];
  let cur = s;
  while (cur <= e && out.length < 4096) {
    let size = cur === 0 ? 2 ** 32 : (cur & -cur) >>> 0; // bit thấp nhất = kích thước khối căn chỉnh lớn nhất
    while (cur + size - 1 > e) size = size / 2;
    out.push(`${intToIPv4(cur)}/${32 - Math.log2(size)}`);
    cur += size;
    if (cur > 0xffffffff) break;
  }
  return out;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const c = parseCidr(cidr); const v = parseIPv4(ip);
  if (!c || v === null) return false;
  const net = parseIPv4(c.network)!, bc = parseIPv4(c.broadcast)!;
  return v >= net && v <= bc;
}

/** Chia một CIDR thành các mạng con có prefix dài hơn (tối đa 256 kết quả). */
export function splitCidr(cidr: string, newPrefix: number): string[] | null {
  const c = parseCidr(cidr);
  if (!c || newPrefix <= c.prefix || newPrefix > 32 || newPrefix - c.prefix > 8) return null;
  const n = 2 ** (newPrefix - c.prefix), step = 2 ** (32 - newPrefix), base = parseIPv4(c.network)!;
  return Array.from({ length: n }, (_, i) => `${intToIPv4(base + i * step)}/${newPrefix}`);
}
