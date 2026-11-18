export interface DnsAnswer { name: string; type: number; TTL: number; data: string }
export interface DnsResult { provider: string; status: number; answers: DnsAnswer[]; ms: number }
export const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'CAA'] as const;
const PROVIDERS = [
  { name: 'Cloudflare', url: 'https://cloudflare-dns.com/dns-query' },
  { name: 'Google', url: 'https://dns.google/resolve' },
];
export const DNS_STATUS: Record<number, string> = { 0: 'NOERROR', 1: 'FORMERR', 2: 'SERVFAIL', 3: 'NXDOMAIN', 4: 'NOTIMP', 5: 'REFUSED' };

/** DNS-over-HTTPS (JSON API). Thử lần lượt các resolver; hết thời gian sau 6 giây mỗi resolver. */
export async function dohLookup(name: string, type: string, signal?: AbortSignal): Promise<DnsResult> {
  const n = name.trim().replace(/\.$/, '');
  if (!/^[A-Za-z0-9_]([A-Za-z0-9_.-]{0,251}[A-Za-z0-9_])?$/.test(n)) throw new Error('Tên miền không hợp lệ.');
  let lastErr: unknown;
  for (const p of PROVIDERS) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    signal?.addEventListener('abort', () => ctl.abort(), { once: true });
    const t0 = performance.now();
    try {
      const r = await fetch(`${p.url}?name=${encodeURIComponent(n)}&type=${encodeURIComponent(type)}`, { headers: { accept: 'application/dns-json' }, signal: ctl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      return { provider: p.name, status: j.Status, answers: (j.Answer ?? []) as DnsAnswer[], ms: Math.round(performance.now() - t0) };
    } catch (e) { lastErr = e; } finally { clearTimeout(t); }
  }
  throw new Error('Không truy vấn được DNS (resolver không khả dụng hoặc bị chặn): ' + (lastErr as Error)?.message);
}
