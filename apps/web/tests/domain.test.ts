import { describe, expect, it } from 'vitest';
import { parseCidr, rangeToCidrs, ipInCidr, validateIp, splitCidr } from '../src/core/domain/cidr';
import { identityKey, networkKey } from '../src/core/domain/identity';
import { compareDevices } from '../src/core/domain/diff';
import { analyzeRisk, riskScore } from '../src/core/domain/risk';
import { trimmedSliceMean, mbps, median, jitter, bufferbloatGrade } from '../src/core/domain/speed';
import { toCsv } from '../src/infrastructure/export/export';
import type { AgentDevice } from '../src/core/domain/types';

const dev = (o: Partial<AgentDevice>): AgentDevice => ({ ipAddress: '192.168.1.10', macRandomized: false, deviceType: 'PC', classificationConfidence: 'medium', status: 'online', openPorts: [], source: [], ...o });
const open = (...p: number[]) => p.map((port) => ({ port, protocol: 'tcp', service: '', state: 'open' }));

describe('CIDR', () => {
  it('/24', () => { const i = parseCidr('192.168.1.77/24')!; expect(i.network).toBe('192.168.1.0'); expect(i.broadcast).toBe('192.168.1.255'); expect(i.usableHosts).toBe(254); expect(i.firstHost).toBe('192.168.1.1'); expect(i.lastHost).toBe('192.168.1.254'); });
  it('/16', () => expect(parseCidr('10.1.2.3/16')!.usableHosts).toBe(65534));
  it('/30', () => { const i = parseCidr('10.0.0.0/30')!; expect(i.usableHosts).toBe(2); expect(i.firstHost).toBe('10.0.0.1'); });
  it('/31 dùng cả 2 địa chỉ (RFC 3021)', () => { const i = parseCidr('10.0.0.0/31')!; expect(i.usableHosts).toBe(2); expect(i.firstHost).toBe('10.0.0.0'); expect(i.lastHost).toBe('10.0.0.1'); });
  it('/32', () => { const i = parseCidr('10.0.0.5/32')!; expect(i.usableHosts).toBe(1); expect(i.firstHost).toBe('10.0.0.5'); });
  it('/0 không tràn số', () => expect(parseCidr('0.0.0.0/0')!.totalAddresses).toBe(2 ** 32));
  it('từ chối đầu vào xấu', () => { for (const x of ['', '1.2.3/24', '1.2.3.4/33', '256.1.1.1/24', 'abc', '1.2.3.4']) expect(parseCidr(x)).toBeNull(); });
  it('ipInCidr / split / range', () => {
    expect(ipInCidr('192.168.1.200', '192.168.1.0/24')).toBe(true); expect(ipInCidr('192.168.2.1', '192.168.1.0/24')).toBe(false);
    expect(splitCidr('192.168.1.0/24', 26)).toEqual(['192.168.1.0/26', '192.168.1.64/26', '192.168.1.128/26', '192.168.1.192/26']);
    expect(rangeToCidrs('192.168.1.0', '192.168.1.255')).toEqual(['192.168.1.0/24']); expect(rangeToCidrs('10.0.0.5', '10.0.0.1')).toBeNull();
  });
  it('validate IPv4/IPv6', () => { expect(validateIp('8.8.8.8')).toBe('ipv4'); expect(validateIp('2001:db8::1')).toBe('ipv6'); expect(validateIp('999.1.1.1')).toBeNull(); expect(validateIp('::gg')).toBeNull(); });
});

describe('Identity', () => {
  it('MAC thật → khoá theo MAC', () => expect(identityKey(dev({ macAddress: 'aa:bb:cc:dd:ee:ff' }))).toBe('mac:AA:BB:CC:DD:EE:FF'));
  it('MAC ngẫu nhiên → fallback IP+hostname (không bền)', () => expect(identityKey(dev({ macAddress: 'AA:BB:CC:DD:EE:FF', macRandomized: true, hostname: 'Phone' }))).toBe('ip:192.168.1.10|phone'));
  it('networkKey ổn định và phân biệt mạng', () => { expect(networkKey('192.168.1.0/24', '192.168.1.1')).toBe(networkKey('192.168.1.0/24', '192.168.1.1')); expect(networkKey('192.168.1.0/24', '192.168.1.1')).not.toBe(networkKey('192.168.1.0/24', '192.168.1.254')); });
});

describe('Diff', () => {
  const d = (k: string, ip: string, mac?: string) => ({ identityKey: k, ipAddress: ip, macAddress: mac });
  it('mới / mất / đổi IP', () => {
    const r = compareDevices([d('mac:A', '192.168.1.2', 'A'), d('mac:B', '192.168.1.3', 'B')], [d('mac:A', '192.168.1.9', 'A'), d('mac:C', '192.168.1.4', 'C')]);
    expect(r.added.map((x) => x.identityKey)).toEqual(['mac:C']); expect(r.removed.map((x) => x.identityKey)).toEqual(['mac:B']); expect(r.ipChanged).toHaveLength(1);
  });
  it('rỗng', () => expect(compareDevices([], [])).toEqual({ added: [], removed: [], ipChanged: [], macChanged: [] }));
});

describe('Risk', () => {
  const ctx = { identityKeyOf: identityKey };
  it('Telnet là critical, có bằng chứng + dương tính giả', () => {
    const f = analyzeRisk([dev({ openPorts: open(23) })], ctx);
    expect(f[0].severity).toBe('critical'); expect(f[0].evidence.length).toBeGreaterThan(0); expect(f[0].falsePositiveNote).not.toBe('');
  });
  it('HTTP không HTTPS → low; có 443 thì không báo', () => {
    expect(analyzeRisk([dev({ openPorts: open(80) })], ctx).some((x) => x.severity === 'low')).toBe(true);
    expect(analyzeRisk([dev({ openPorts: open(80, 443) })], ctx).some((x) => x.title.includes('HTTP chưa'))).toBe(false);
  });
  it('công thức điểm', () => {
    expect(riskScore([])).toBe(100);
    const f = analyzeRisk([dev({ openPorts: open(23, 445, 3389) })], ctx); // 1 critical + 2 high
    expect(riskScore(f)).toBe(100 - 20 - 12 * 2);
  });
  it('baseline: thiết bị mới được đánh dấu; MAC ngẫu nhiên → tin cậy thấp', () => {
    const f = analyzeRisk([dev({ macAddress: 'AA:BB:CC:00:00:01' })], { ...ctx, baselineKeys: new Set(['mac:ZZ']) });
    expect(f.some((x) => x.title.includes('baseline'))).toBe(true);
    const g = analyzeRisk([dev({ macAddress: '02:00:00:00:00:01', macRandomized: true })], { ...ctx, baselineKeys: new Set(['mac:ZZ']) });
    expect(g.find((x) => x.title.includes('baseline'))!.confidence).toBe('low');
  });
  it('không còn rule đọc/lưu mật khẩu', () => expect(JSON.stringify(analyzeRisk([dev({ openPorts: open(23) })], ctx)).toLowerCase()).not.toContain('wifi password'));
});

describe('Speed math', () => {
  it('Mbps', () => expect(mbps(12_500_000, 1)).toBeCloseTo(100));
  it('trimmed mean bỏ lát chậm/nhanh nhất', () => {
    // 6 giây, 10 MB/s ổn định (=80 Mbps)
    const times = Array.from({ length: 61 }, (_, i) => i / 10), counts = times.map((t) => Math.round(t * 10_000_000));
    expect(trimmedSliceMean(times, counts, 1, 1, 1)).toBeCloseTo(80, 0);
  });
  it('đo quá ngắn → -1', () => expect(trimmedSliceMean([0, 0.5], [0, 100], 0, 1, 1)).toBe(-1));
  it('median/jitter/bufferbloat', () => { expect(median([1, 3, 2])).toBe(2); expect(median([1, 2, 3, 4])).toBe(2.5); expect(jitter([10, 10, 10])).toBe(0); expect(bufferbloatGrade(10, 12)).toMatch(/A/); expect(bufferbloatGrade(10, 400)).not.toMatch(/A/); });
});

describe('CSV', () => {
  it('chống formula injection & escape', () => {
    const c = toCsv(['a'], [['=cmd|calc'], ['x,"y"'], ['+1'], [null]]);
    expect(c).toContain("'=cmd|calc"); expect(c).toContain('"x,""y"""'); expect(c).toContain("'+1");
  });
});
