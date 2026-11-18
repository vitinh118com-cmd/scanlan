/** Port từ Core/SpeedMath.cs (C#) — trung bình cắt bỏ kiểu Ookla. Trả -1 nếu đo quá ngắn. */
export function bytesAt(times: number[], counts: number[], t: number): number {
  const last = times.length - 1;
  if (t <= 0) return 0;
  if (t >= times[last]) return counts[last];
  let hi = 0;
  while (hi < last && times[hi] < t) hi++;
  const tl = hi === 0 ? 0 : times[hi - 1];
  const cl = hi === 0 ? 0 : counts[hi - 1];
  const th = times[hi], ch = counts[hi];
  return th > tl ? cl + ((ch - cl) * (t - tl)) / (th - tl) : ch;
}

export function trimmedSliceMean(times: number[], counts: number[], startSec: number, sliceSec: number, trim: number): number {
  const n = times.length;
  if (n < 2 || sliceSec <= 0) return -1;
  const end = times[n - 1];
  const sliceCount = Math.floor((end - startSec) / sliceSec + 1e-9);
  if (sliceCount < 2 * trim + 2) return -1;
  const speeds: number[] = [];
  for (let i = 0; i < sliceCount; i++) {
    const a = startSec + i * sliceSec;
    speeds.push(((bytesAt(times, counts, a + sliceSec) - bytesAt(times, counts, a)) * 8) / sliceSec / 1e6);
  }
  speeds.sort((x, y) => x - y);
  const kept = speeds.slice(trim, speeds.length - trim);
  return kept.length ? kept.reduce((s, v) => s + v, 0) / kept.length : -1;
}

/** Mbps = bytes * 8 / seconds / 1,000,000 (spec §9.2). */
export const mbps = (bytes: number, seconds: number): number => (seconds > 0 ? (bytes * 8) / seconds / 1e6 : 0);

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Jitter (định nghĩa cố định, version method v1): trung bình |Δ| giữa các mẫu liên tiếp. */
export function jitter(xs: number[]): number {
  if (xs.length < 2) return 0;
  let s = 0;
  for (let i = 1; i < xs.length; i++) s += Math.abs(xs[i] - xs[i - 1]);
  return s / (xs.length - 1);
}

/** Loại outlier: giữ mẫu trong [Q1-1.5IQR, Q3+1.5IQR]. */
export function dropOutliers(xs: number[]): number[] {
  if (xs.length < 4) return xs;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  const q1 = q(0.25), q3 = q(0.75), iqr = q3 - q1;
  return xs.filter((x) => x >= q1 - 1.5 * iqr && x <= q3 + 1.5 * iqr);
}

export function bufferbloatGrade(idleMs: number, loadedMs: number): string {
  const d = Math.max(0, loadedMs - idleMs);
  return d < 5 ? 'A+' : d < 30 ? 'A' : d < 60 ? 'B' : d < 200 ? 'C' : d < 400 ? 'D' : 'F';
}
export const SPEED_METHOD_VERSION = 'browser-v1';
