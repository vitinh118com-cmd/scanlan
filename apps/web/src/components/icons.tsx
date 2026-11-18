import { Router, Network, Wifi, Server, Monitor, Video, HardDrive, Printer, Smartphone, Cpu, CircleHelp, Camera, type LucideIcon } from 'lucide-react';

export type DevKind = 'router' | 'switch' | 'ap' | 'server' | 'workstation' | 'camera' | 'nvr' | 'printer' | 'nas' | 'phone' | 'iot' | 'other';

export const KIND: Record<DevKind, { icon: LucideIcon; label: string }> = {
  router: { icon: Router, label: 'Router / Gateway' }, switch: { icon: Network, label: 'Switch' }, ap: { icon: Wifi, label: 'Access Point' },
  server: { icon: Server, label: 'Server' }, workstation: { icon: Monitor, label: 'PC / Laptop' }, camera: { icon: Camera, label: 'Camera' },
  nvr: { icon: Video, label: 'NVR / DVR' }, printer: { icon: Printer, label: 'Máy in' }, nas: { icon: HardDrive, label: 'NAS' },
  phone: { icon: Smartphone, label: 'Điện thoại' }, iot: { icon: Cpu, label: 'IoT / Nhúng' }, other: { icon: CircleHelp, label: 'Chưa rõ' },
};
export const KIND_ORDER: DevKind[] = ['router', 'switch', 'ap', 'server', 'nas', 'workstation', 'camera', 'nvr', 'printer', 'phone', 'iot', 'other'];

interface Likeness { deviceType: string; ipAddress?: string; hostname?: string | null; osGuess?: string | null; openPorts?: { port: number }[] }

/** Phân loại hiển thị từ deviceType (chuỗi do Agent trả về) + gợi ý hostname/cổng. Chỉ dùng cho giao diện, không đổi dữ liệu. */
export function kindOf(d: Likeness, gateway?: string): DevKind {
  const t = d.deviceType.toLowerCase(); const h = (d.hostname ?? '').toLowerCase();
  if (gateway && d.ipAddress === gateway) return 'router';
  if (/^(nvr|dvr)/.test(h) || (/nvr|dvr/.test(t) && !/camera/.test(t))) return 'nvr';
  if (/camera/.test(t)) return 'camera';
  if (/router|gateway/.test(t) && /wi-?fi/.test(t)) return 'ap';
  if (/router|gateway/.test(t)) return 'router';
  if (/switch/.test(t)) return /\bap\b/.test(t) ? 'switch' : 'switch';
  if (/access point|\bap\b|wifi ap/.test(t) || /^ap[-_]/.test(h)) return 'ap';
  if (/nas/.test(t)) return 'nas';
  if (/máy in|printer/.test(t)) return 'printer';
  if (/điện thoại|iphone|android|di động|tablet/.test(t)) return 'phone';
  const os = (d.osGuess ?? '').toLowerCase();
  if (/^srv[-_]/.test(h) || /server/.test(os)) return 'server';
  if (/^(pc|lt|nb|laptop)[-_]/.test(h)) return 'workstation';
  if (/linux|unix/.test(t) || (/server/.test(t) && !/windows pc/.test(t))) return 'server';
  if (/windows|pc|laptop|macos|máy tính/.test(t)) return 'workstation';
  if (/nhúng|chấm công|iot|khác/.test(t)) return 'iot';
  return 'other';
}

export function DeviceAvatar({ kind, off, size = 'md' }: { kind: DevKind; off?: boolean; size?: 'md' | 'lg' }) {
  const I = KIND[kind].icon;
  return <span className={`avatar k-${kind} ${size === 'lg' ? 'lg' : ''} ${off ? 'off' : ''}`} aria-hidden><I size={size === 'lg' ? 22 : 17} strokeWidth={1.8} /></span>;
}
