import { bufferbloatGrade, dropOutliers, jitter, mbps, median, SPEED_METHOD_VERSION, trimmedSliceMean, bytesAt } from '../../core/domain/speed';

/**
 * Speed test đo từ trình duyệt của người dùng tới endpoint đo — KHÔNG đo qua Worker/VPS của Hachihi (spec §9.1).
 * Provider là adapter có thể thay thế. Mặc định: endpoint công khai của Cloudflare (speed.cloudflare.com).
 * ⚠ BẮT BUỘC kiểm tra CORS + điều khoản sử dụng hiện hành trước khi phát hành (docs/speedtest.md).
 */
export interface SpeedProvider {
  id: string; displayName: string; provider: string;
  latencyUrl(): string; downloadUrl(bytes: number): string; uploadUrl(): string;
  metaUrl?: string;
}
const rnd = () => Math.random().toString(36).slice(2);
export const CLOUDFLARE: SpeedProvider = {
  id: 'cloudflare', displayName: 'Cloudflare Speed', provider: 'Cloudflare', metaUrl: 'https://speed.cloudflare.com/meta',
  latencyUrl: () => `https://speed.cloudflare.com/__down?bytes=0&r=${rnd()}`,
  downloadUrl: (b) => `https://speed.cloudflare.com/__down?bytes=${b}&r=${rnd()}`,
  uploadUrl: () => `https://speed.cloudflare.com/__up?r=${rnd()}`,
};
export const PROVIDERS: SpeedProvider[] = [CLOUDFLARE];

export type Phase = 'idle' | 'latency' | 'download' | 'upload' | 'done' | 'error' | 'cancelled';
export interface SpeedProgress { phase: Phase; liveMbps?: number; latencyMs?: number; message?: string; elapsedSec?: number }
export interface SpeedResult {
  serverName: string; serverProvider: string; idleLatencyMs: number; jitterMs: number; downloadMbps: number; uploadMbps: number;
  loadedLatencyMs?: number; bufferbloatGrade?: string; testMethodVersion: string; durationSec: number; warnings: string[];
}

const DL_SECONDS = 10, UL_SECONDS = 8, WARMUP_SEC = 2, STREAMS = 4;

async function ping(url: string, signal: AbortSignal): Promise<number> {
  const t0 = performance.now();
  const r = await fetch(url, { cache: 'no-store', signal });
  await r.arrayBuffer();
  return performance.now() - t0;
}

function randomPayload(bytes: number): Blob {
  const buf = new Uint8Array(bytes);
  for (let o = 0; o < bytes; o += 65536) crypto.getRandomValues(buf.subarray(o, Math.min(bytes, o + 65536)));
  return new Blob([buf]);
}

async function collectLatency(p: SpeedProvider, n: number, signal: AbortSignal): Promise<number[]> {
  const xs: number[] = [];
  for (let i = 0; i < n; i++) { xs.push(await ping(p.latencyUrl(), signal)); }
  return xs.slice(2); // bỏ 2 mẫu warm-up (kết nối TLS đầu tiên)
}

function summarize(times: number[], counts: number[]): number {
  if (times.length < 2) return 0;
  const t = trimmedSliceMean(times, counts, WARMUP_SEC, 1, 1);
  if (t >= 0) return t;
  const end = times[times.length - 1];
  if (end <= WARMUP_SEC) return mbps(bytesAt(times, counts, end), end);
  return mbps(bytesAt(times, counts, end) - bytesAt(times, counts, WARMUP_SEC), end - WARMUP_SEC);
}

export async function runSpeedTest(p: SpeedProvider, onProgress: (x: SpeedProgress) => void, signal: AbortSignal): Promise<SpeedResult> {
  const t00 = performance.now();
  const warnings: string[] = [];
  if (!navigator.onLine) throw new Error('Trình duyệt đang offline.');
  const hidden = () => document.visibilityState === 'hidden';
  let throttled = false;
  const onVis = () => { if (hidden()) throttled = true; };
  document.addEventListener('visibilitychange', onVis);

  try {
    let serverName = p.displayName;
    if (p.metaUrl) {
      try { const m = await (await fetch(p.metaUrl, { cache: 'no-store', signal })).json(); if (m?.colo?.city || m?.city) serverName += ` — ${m.colo?.city ?? m.city}${m.colo?.iata ? ' (' + m.colo.iata + ')' : ''}`; } catch { /* meta không bắt buộc */ }
    }

    // 1) Idle latency
    onProgress({ phase: 'latency', message: 'Đo độ trễ…' });
    const lat = dropOutliers(await collectLatency(p, 14, signal));
    const idle = median(lat), jit = jitter(lat);

    // 2) Download: nhiều luồng song song, đồng thời đo loaded latency
    onProgress({ phase: 'download', latencyMs: idle, message: 'Đo tải xuống…' });
    const times: number[] = [], counts: number[] = [];
    let total = 0; const start = performance.now();
    const loaded: number[] = [];
    const stop = new AbortController();
    const link = () => stop.abort();
    signal.addEventListener('abort', link, { once: true });
    const dlWorker = async () => {
      let size = 4_000_000;
      while (!stop.signal.aborted && (performance.now() - start) / 1000 < DL_SECONDS) {
        const res = await fetch(p.downloadUrl(size), { cache: 'no-store', signal: stop.signal });
        const reader = res.body!.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          const t = (performance.now() - start) / 1000;
          times.push(t); counts.push(total);
          if ((performance.now() - start) / 1000 >= DL_SECONDS) { stop.abort(); break; }
        }
        size = Math.min(size * 2, 50_000_000);
      }
    };
    const loadedProbe = (async () => {
      await new Promise((r) => setTimeout(r, 1500));
      while (!stop.signal.aborted) { try { loaded.push(await ping(p.latencyUrl(), stop.signal)); } catch { break; } await new Promise((r) => setTimeout(r, 400)); }
    })();
    const ticker = setInterval(() => {
      const el = (performance.now() - start) / 1000;
      onProgress({ phase: 'download', liveMbps: el > 0.5 ? mbps(total, el) : undefined, elapsedSec: el, latencyMs: idle });
    }, 250);
    try { await Promise.all([...Array.from({ length: STREAMS }, () => dlWorker().catch((e) => { if ((e as Error).name !== 'AbortError') throw e; })), loadedProbe]); }
    finally { clearInterval(ticker); }
    if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
    // JS đơn luồng: các mẫu (thời gian, byte tích luỹ) được ghi theo thứ tự thời gian nên đã đơn điệu dù có nhiều luồng.
    const downloadMbps = summarize(times, counts);

    // 3) Upload bằng XHR (có upload.onprogress, fetch streaming upload chưa phổ biến)
    onProgress({ phase: 'upload', latencyMs: idle, message: 'Đo tải lên…' });
    const payload = randomPayload(2_000_000);
    const uTimes: number[] = [], uCounts: number[] = [];
    let uTotal = 0; const uStart = performance.now();
    const uStop = new AbortController();
    signal.addEventListener('abort', () => uStop.abort(), { once: true });
    const ulOnce = () => new Promise<void>((resolve, reject) => {
      const x = new XMLHttpRequest(); let last = 0;
      x.open('POST', p.uploadUrl());
      x.upload.onprogress = (e) => { uTotal += e.loaded - last; last = e.loaded; const t = (performance.now() - uStart) / 1000; uTimes.push(t); uCounts.push(uTotal); };
      x.onload = () => resolve(); x.onerror = () => reject(new Error('Upload lỗi (endpoint có thể chặn CORS).'));
      x.onabort = () => resolve();
      uStop.signal.addEventListener('abort', () => x.abort(), { once: true });
      x.send(payload);
    });
    const ulWorker = async () => { while (!uStop.signal.aborted && (performance.now() - uStart) / 1000 < UL_SECONDS) await ulOnce(); };
    const uTicker = setInterval(() => { const el = (performance.now() - uStart) / 1000; onProgress({ phase: 'upload', liveMbps: el > 0.5 ? mbps(uTotal, el) : undefined, elapsedSec: el }); }, 250);
    const uTimer = setTimeout(() => uStop.abort(), UL_SECONDS * 1000 + 500);
    try { await Promise.all(Array.from({ length: 3 }, () => ulWorker())); } finally { clearInterval(uTicker); clearTimeout(uTimer); }
    if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
    const uMbps = summarize(uTimes, uCounts);

    if (throttled) warnings.push('Tab bị ẩn trong lúc đo — trình duyệt có thể giảm tốc, kết quả kém tin cậy.');
    if (loaded.length < 3) warnings.push('Không đủ mẫu loaded latency để chấm bufferbloat.');
    const loadedMs = loaded.length >= 3 ? median(dropOutliers(loaded)) : undefined;
    if (lat.length >= 4 && jit > idle) warnings.push('Độ trễ dao động lớn — endpoint hoặc đường truyền không ổn định.');
    const result: SpeedResult = {
      serverName, serverProvider: p.provider, idleLatencyMs: idle, jitterMs: jit, downloadMbps, uploadMbps: uMbps,
      loadedLatencyMs: loadedMs, bufferbloatGrade: loadedMs !== undefined ? bufferbloatGrade(idle, loadedMs) : undefined,
      testMethodVersion: SPEED_METHOD_VERSION, durationSec: (performance.now() - t00) / 1000, warnings,
    };
    onProgress({ phase: 'done' });
    return result;
  } finally { document.removeEventListener('visibilitychange', onVis); }
}
