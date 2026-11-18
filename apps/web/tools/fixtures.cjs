// Dữ liệu mẫu cho Agent giả (chỉ dùng để chụp ảnh/kiểm thử giao diện — không đi vào bản build).
const P = (port, service) => ({ port, protocol: 'tcp', service, state: 'open' });
let n = 0;
const mk = (ip, o) => ({
  ipAddress: ip, macAddress: o.mac ?? null, macRandomized: !!o.rand, hostname: o.host ?? null, vendor: o.vendor ?? null,
  deviceType: o.type, osGuess: o.os ?? null, classificationConfidence: o.conf ?? 'high', status: o.off ? 'offline' : 'online',
  pingMs: o.off ? null : o.ping ?? +(0.6 + (n++ % 9) * 0.7).toFixed(1), openPorts: o.ports ?? [], httpTitle: o.title ?? null,
  source: o.src ?? ['ARP', 'ICMP'], note: o.note ?? null,
});
const mac = (i) => '3C:' + [0xa1, 0x22, 0x5b, 0x00, i].map((x) => (x & 255).toString(16).padStart(2, '0')).join(':').toUpperCase();
const devices = [];
const D = (ip, o) => devices.push(mk('192.168.10.' + ip, o));
D(1, { type: 'Router/Gateway', vendor: 'MikroTik', host: 'gw-core', mac: '4C:5E:0C:11:22:01', os: 'RouterOS', ports: [P(80, 'http'), P(443, 'https'), P(8728, 'api')], src: ['ARP', 'ICMP', 'SNMP', 'mDNS'], title: 'RouterOS v7' });
D(2, { type: 'Switch / AP', vendor: 'TP-Link', host: 'sw-core-24p', mac: '50:C7:BF:10:00:02', ports: [P(80, 'http')], src: ['ARP', 'ICMP', 'SNMP'] });
D(3, { type: 'Router/Gateway (Wi-Fi)', vendor: 'Ubiquiti', host: 'ap-floor1', mac: '78:8A:20:00:00:03', ports: [P(22, 'ssh'), P(443, 'https')], src: ['ARP', 'ICMP', 'SSDP'] });
D(4, { type: 'Router/Gateway (Wi-Fi)', vendor: 'Ubiquiti', host: 'ap-floor2', mac: '78:8A:20:00:00:04', ports: [P(22, 'ssh'), P(443, 'https')], src: ['ARP', 'ICMP', 'SSDP'] });
D(10, { type: 'Windows PC / Server', vendor: 'Dell', host: 'srv-ad01', mac: '18:66:DA:00:00:10', os: 'Windows Server 2019', ports: [P(53, 'dns'), P(88, 'kerberos'), P(389, 'ldap'), P(445, 'smb'), P(3389, 'rdp')], src: ['ARP', 'ICMP', 'NBNS', 'TCP'] });
D(11, { type: 'Windows PC / Server', vendor: 'HPE', host: 'srv-erp', mac: '94:57:A5:00:00:11', os: 'Windows Server 2016', ports: [P(445, 'smb'), P(1433, 'mssql'), P(3389, 'rdp')], src: ['ARP', 'ICMP', 'NBNS', 'TCP'] });
D(12, { type: 'Linux/Unix', vendor: 'Raspberry Pi', host: 'srv-files', mac: 'DC:A6:32:00:00:12', os: 'Linux', ports: [P(22, 'ssh'), P(23, 'telnet'), P(80, 'http')], src: ['ARP', 'ICMP', 'TCP'], note: 'Telnet đang mở' });
D(13, { type: 'NAS Storage', vendor: 'Synology', host: 'nas-backup', mac: '00:11:32:00:00:13', ports: [P(80, 'http'), P(445, 'smb'), P(5000, 'dsm'), P(5001, 'dsm-ssl')], src: ['ARP', 'ICMP', 'SSDP', 'mDNS'], title: 'Synology DiskStation' });
D(20, { type: 'Camera / NVR', vendor: 'Hikvision', host: 'nvr-01', mac: 'BC:AD:28:00:00:20', ports: [P(80, 'http'), P(554, 'rtsp'), P(8000, 'sdk')], src: ['ARP', 'ICMP', 'SADP', 'TCP'], title: 'NVR', conf: 'high' });
for (let i = 0; i < 6; i++) D(21 + i, { type: 'Camera / NVR', vendor: i % 2 ? 'Dahua' : 'Hikvision', host: 'cam-' + (i + 1), mac: 'BC:AD:28:00:00:' + (21 + i).toString(16), ports: [P(80, 'http'), P(554, 'rtsp')], src: ['ARP', 'ICMP', 'SADP', 'TCP'], off: i === 5, conf: i === 3 ? 'medium' : 'high' });
D(40, { type: 'Máy in mạng', vendor: 'HP', host: 'prn-office', mac: '3C:D9:2B:00:00:40', ports: [P(9100, 'jetdirect'), P(631, 'ipp'), P(80, 'http')], src: ['ARP', 'ICMP', 'mDNS', 'SNMP'] });
D(41, { type: 'Máy in mạng', vendor: 'Canon', host: 'prn-acct', mac: '00:BB:C1:00:00:41', ports: [P(9100, 'jetdirect')], src: ['ARP', 'ICMP', 'SNMP'], off: true });
for (let i = 0; i < 18; i++) D(50 + i, { type: 'Windows PC / Server', vendor: ['Dell', 'Lenovo', 'HP', 'ASUS'][i % 4], host: 'pc-' + String(i + 1).padStart(2, '0'), mac: mac(50 + i), os: 'Windows 11', ports: i % 6 === 0 ? [P(445, 'smb')] : [], src: ['ARP', 'ICMP', 'NBNS'], off: i % 7 === 3, conf: 'medium' });
for (let i = 0; i < 6; i++) D(100 + i, { type: 'Điện thoại/Thiết bị di động (MAC ngẫu nhiên)', host: i % 2 ? null : 'iPhone-' + i, mac: '9A:' + [0x11, 0x22, 0x33, 0x44, i].map((x) => x.toString(16).padStart(2, '0')).join(':').toUpperCase(), rand: true, conf: 'low', src: ['ARP', 'ICMP'], os: 'iOS/Android', off: i === 4 });
for (let i = 0; i < 4; i++) D(120 + i, { type: 'Thiết bị mạng / Khác', vendor: ['Espressif', 'Tuya', 'ZKTeco', 'Sonoff'][i], host: ['esp-sensor', 'tuya-plug', 'zk-attend', null][i], mac: 'A4:CF:12:00:00:' + (20 + i).toString(16), ports: i === 2 ? [P(4370, 'zk')] : [], src: ['ARP', 'ICMP'], conf: 'low' });
D(200, { type: 'Không rõ', mac: '02:AB:CD:00:00:01', rand: true, conf: 'low', src: ['ARP'], note: 'Thiết bị lạ' });
D(201, { type: 'Không rõ', mac: '00:E0:4C:00:00:02', vendor: 'Realtek', conf: 'low', src: ['ARP', 'ICMP'] });

const interfaces = [
  { interfaceId: 'eth0', name: 'Ethernet', status: 'up', ipv4: '192.168.10.50', subnetCidr: '192.168.10.0/24', gateway: '192.168.10.1', dnsServers: ['192.168.10.1', '1.1.1.1'], isWifi: false },
  { interfaceId: 'wlan0', name: 'Wi-Fi', status: 'up', ipv4: '192.168.10.77', subnetCidr: '192.168.10.0/24', gateway: '192.168.10.1', dnsServers: ['192.168.10.1'], isWifi: true },
];
const ap = (ssid, ch, rssi, o = {}) => {
  const band = ch > 177 ? '6 GHz' : ch > 14 ? '5 GHz' : '2.4 GHz';
  const f = band === '2.4 GHz' ? 2407 + ch * 5 : band === '5 GHz' ? 5000 + ch * 5 : 5950 + (ch - 1) * 5;
  return { ssid, bssid: '78:8A:20:' + (ch * 3 % 256).toString(16).padStart(2, '0') + ':' + (Math.abs(rssi) % 256).toString(16).padStart(2, '0') + ':01', rssiDbm: rssi, signalQuality: Math.max(0, Math.min(100, 2 * (rssi + 100))), frequencyMHz: f, channel: ch, band, phy: band === '2.4 GHz' ? '802.11n' : '802.11ax', security: 'WPA2-Personal', connected: false, ...o };
};
const wifi = { capturedAt: new Date().toISOString(), interfaces: [{ name: 'Wi-Fi', connection: { ssid: 'HACHIHI-Office', bssid: '78:8A:20:00:00:03', signalQuality: 82, rssiDbm: -59, channel: 36, band: '5 GHz', phy: '802.11ax', security: 'WPA2-Personal', rxMbps: 866, txMbps: 780 }, nearbyAps: [
  ap('HACHIHI-Office', 36, -59, { connected: true }), ap('HACHIHI-Office', 6, -52), ap('HACHIHI-Guest', 11, -64), ap('VNPT_2G_A1B2', 1, -71), ap('FPT-Telecom', 6, -78), ap('Cafe_Free', 11, -83),
  ap('TP-Link_5G_77', 44, -68), ap('HACHIHI-Office', 149, -61), ap('Viettel_5G', 157, -74), ap('Neighbor-5G', 36, -81), ap('HACHIHI-6E', 37, -66), ap('Lab-6E', 53, -79), ap('Zalo_Wifi', 3, -88), ap('IoT-Net', 1, -76),
] }] };
const cameras = devices.filter((d) => /Camera/.test(d.deviceType)).map((d) => ({ ipAddress: d.ipAddress, macAddress: d.macAddress, vendor: d.vendor, hostname: d.hostname, protocols: d.source.filter((s) => ['SADP', 'ONVIF', 'SSDP'].includes(s)).concat(['RTSP']), servicePorts: d.openPorts.map((p) => p.port), confidence: d.classificationConfidence }));
module.exports = { devices, interfaces, wifi, cameras };
