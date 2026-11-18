import type { AgentDevice, Confidence, Finding, Severity } from './types';

export const RISK_RULESET_VERSION = 'v1.0';
export const SCORE_FORMULA =
  `Điểm = 100 − 20×Critical − 12×High − 4×Medium − 1×min(10, Low). Giới hạn 0–100 (100 = không phát hiện rủi ro). Bộ luật ${RISK_RULESET_VERSION}. ` +
  'Tương thích công thức bản WinForms (Critical 20, Warning 8, Low 1); mức Warning cũ được tách thành High (12) và Medium (4) cho các luật mới.';

const W: Record<Severity, number> = { critical: 20, high: 12, medium: 4, low: 1, info: 0 };

export interface RiskContext {
  /** identityKey các thiết bị đã duyệt baseline (nếu có). */
  baselineKeys?: Set<string>;
  /** IP/MAC đã có trong Inventory. */
  inventoryIps?: Set<string>;
  inventoryMacs?: Set<string>;
  identityKeyOf: (d: AgentDevice) => string;
}

const openSet = (d: AgentDevice) => new Set(d.openPorts.filter((p) => p.state === 'open').map((p) => p.port));
const who = (d: AgentDevice) => d.ipAddress + (d.vendor ? ` (${d.vendor})` : '');
const isCam = (d: AgentDevice) => /camera|nvr|dvr/i.test(d.deviceType) || openSet(d).has(554) || openSet(d).has(37777);

interface Rule { id: string; severity: Severity; port?: number; title: string; match: (p: Set<number>) => boolean; explanation: string; recommendation: string; fp: string; confidence: Confidence }

const PORT_RULES: Rule[] = [
  { id: 'telnet', severity: 'critical', port: 23, title: 'Mở Telnet (truyền văn bản không mã hóa)', match: (p) => p.has(23), confidence: 'high',
    explanation: 'Telnet gửi tên đăng nhập/mật khẩu dạng rõ; ai nghe được mạng đều đọc được.', recommendation: 'Tắt Telnet, chuyển sang SSH (cổng 22).',
    fp: 'Một số thiết bị mạng cũ bật Telnet có chủ đích trong mạng quản trị tách biệt.' },
  { id: 'smb', severity: 'high', port: 445, title: 'Mở chia sẻ tệp SMB (nguy cơ ransomware)', match: (p) => p.has(445), confidence: 'high',
    explanation: 'SMB mở là đường lây phổ biến của ransomware nếu thiếu bản vá/mật khẩu yếu.', recommendation: 'Chặn 445 ra Internet, cập nhật Windows, dùng SMBv3, hạn chế truy cập theo IP.',
    fp: 'Máy chủ file nội bộ bắt buộc mở SMB; đây là cảnh báo tiếp xúc, không phải xác nhận lỗ hổng.' },
  { id: 'rdp', severity: 'high', port: 3389, title: 'Mở Remote Desktop (RDP)', match: (p) => p.has(3389), confidence: 'high',
    explanation: 'RDP là mục tiêu dò mật khẩu/khai thác phổ biến.', recommendation: 'Bật NLA, mật khẩu mạnh + MFA, truy cập từ xa qua VPN.', fp: 'Có thể là máy được quản trị từ xa hợp lệ.' },
  { id: 'ftp', severity: 'high', port: 21, title: 'Mở FTP (không mã hóa)', match: (p) => p.has(21), confidence: 'high',
    explanation: 'FTP truyền thông tin đăng nhập dạng rõ.', recommendation: 'Chuyển sang SFTP/FTPS.', fp: 'FTP ẩn danh nội bộ có thể chấp nhận được ở môi trường kín.' },
  { id: 'vnc', severity: 'high', port: 5900, title: 'Mở VNC điều khiển từ xa', match: (p) => p.has(5900), confidence: 'medium',
    explanation: 'VNC thường yếu về xác thực/mã hóa.', recommendation: 'Đặt mật khẩu mạnh, giới hạn IP hoặc đi qua VPN.', fp: 'Cổng 5900 có thể do phần mềm khác dùng.' },
  { id: 'db', severity: 'high', title: 'Cổng cơ sở dữ liệu mở trong mạng', match: (p) => p.has(3306) || p.has(1433) || p.has(5432) || p.has(27017) || p.has(6379), confidence: 'medium',
    explanation: 'CSDL nên chỉ cho máy ứng dụng truy cập.', recommendation: 'Giới hạn truy cập theo IP, không mở ra Internet.', fp: 'Máy phát triển/test có thể cố ý mở.' },
];

export function analyzeRisk(devices: AgentDevice[], ctx: RiskContext): Finding[] {
  const out: Finding[] = [];
  const push = (f: Omit<Finding, 'id'>) => out.push({ ...f, id: `${f.title}|${f.ip}|${f.port ?? ''}` });

  for (const d of devices) {
    const ports = openSet(d);
    for (const r of PORT_RULES) {
      if (!r.match(ports)) continue;
      const port = r.port ?? [3306, 1433, 5432, 27017, 6379].find((x) => ports.has(x));
      push({ severity: r.severity, ip: d.ipAddress, host: who(d), title: r.title, port, confidence: r.confidence,
        evidence: [`TCP ${port} phản hồi mở trên ${d.ipAddress}`, ...(d.source.length ? [`Nguồn: ${d.source.join(', ')}`] : [])],
        explanation: r.explanation, recommendation: r.recommendation, falsePositiveNote: r.fp });
    }
    if ((ports.has(80) || ports.has(8080)) && !ports.has(443)) {
      push({ severity: 'low', ip: d.ipAddress, host: who(d), title: 'Trang quản trị HTTP chưa có HTTPS', port: ports.has(80) ? 80 : 8080, confidence: 'medium',
        evidence: [`TCP ${ports.has(80) ? 80 : 8080} mở, TCP 443 không mở`, ...(d.httpTitle ? [`Tiêu đề trang: ${d.httpTitle}`] : [])],
        explanation: 'Truy cập HTTP không mã hóa, thông tin đăng nhập có thể bị nghe lén trong mạng.', recommendation: 'Bật HTTPS và cài chứng chỉ SSL/TLS.',
        falsePositiveNote: 'Thiết bị có thể chỉ chuyển hướng sang HTTPS ở cổng khác chưa được quét.' });
    }
    const key = ctx.identityKeyOf(d);
    if (ctx.baselineKeys && ctx.baselineKeys.size > 0 && !ctx.baselineKeys.has(key)) {
      push({ severity: 'medium', ip: d.ipAddress, host: who(d), title: 'Thiết bị mới so với baseline', confidence: d.macRandomized ? 'low' : 'high',
        evidence: [`${key} chưa có trong baseline đã duyệt`], explanation: 'Thiết bị xuất hiện sau lần duyệt baseline gần nhất.',
        recommendation: 'Xác minh chủ sở hữu; nếu hợp lệ hãy duyệt vào baseline và Inventory.',
        falsePositiveNote: d.macRandomized ? 'MAC ngẫu nhiên (điện thoại) đổi định danh theo mạng/thời gian nên dễ báo thiết bị mới.' : 'Khách/thiết bị mới mua hợp lệ.' });
    }
    const inInv = ctx.inventoryIps?.has(d.ipAddress) || (d.macAddress ? ctx.inventoryMacs?.has(d.macAddress.toUpperCase()) : false);
    if (ctx.inventoryIps && !inInv && isCam(d)) {
      push({ severity: 'medium', ip: d.ipAddress, host: who(d), title: 'Camera/NVR chưa có trong Inventory', confidence: 'medium',
        evidence: [`Loại thiết bị: ${d.deviceType}`, ...Array.from(ports).filter((p) => [554, 8000, 37777, 8899].includes(p)).map((p) => `TCP ${p} mở`)],
        explanation: 'Thiết bị có đặc điểm camera/NVR nhưng chưa được ghi nhận trong danh mục tài sản.', recommendation: 'Thêm vào Inventory, đổi mật khẩu mặc định, cập nhật firmware.',
        falsePositiveNote: 'Phân loại dựa trên cổng/hãng nên có thể nhầm với thiết bị khác.' });
    }
    if (d.deviceType.includes('chưa rõ') || (d.deviceType.includes('Khác') && !d.vendor)) {
      push({ severity: 'info', ip: d.ipAddress, host: who(d), title: 'Thiết bị chưa nhận diện được', confidence: 'low',
        evidence: [`Loại: ${d.deviceType}`, `MAC: ${d.macAddress ?? 'không có'}`], explanation: 'Không đủ dữ liệu để xác định hãng/loại.',
        recommendation: 'Kiểm tra vật lý hoặc trên router để xác định thiết bị.', falsePositiveNote: 'Đây chỉ là thiếu thông tin, không phải mối đe doạ.' });
    }
  }
  const order: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
  return out.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
}

export function riskScore(f: Finding[]): number {
  const c = (s: Severity) => f.filter((x) => x.severity === s).length;
  const s = 100 - W.critical * c('critical') - W.high * c('high') - W.medium * c('medium') - Math.min(10, c('low')) * W.low;
  return Math.max(0, Math.min(100, s));
}
