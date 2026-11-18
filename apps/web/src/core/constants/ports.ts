/** Trích từ Core/Constants.cs (ServiceNames) của bản WinForms. */
export const SERVICE_NAMES: Record<number, string> = {
  21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 80: 'HTTP Web', 110: 'POP3', 135: 'RPC', 139: 'NetBIOS', 143: 'IMAP',
  161: 'SNMP', 443: 'HTTPS Web', 445: 'SMB/File Sharing', 554: 'RTSP Camera', 1194: 'OpenVPN', 1433: 'MS SQL', 1521: 'Oracle DB',
  1723: 'PPTP VPN', 3306: 'MySQL', 3389: 'RDP Remote Desktop', 5000: 'Synology DSM (HTTP)', 5001: 'Synology DSM (HTTPS)',
  5060: 'SIP VoIP', 5432: 'PostgreSQL', 5900: 'VNC Remote', 6379: 'Redis', 8000: 'Hikvision SDK / HTTP-Alt', 8080: 'HTTP-Proxy / Web',
  8291: 'MikroTik Winbox', 8443: 'HTTPS-Alt', 8888: 'HTTP-Alt', 8899: 'ONVIF Camera', 9000: 'ZKTeco / Portainer', 9100: 'Printer / RAW',
  27017: 'MongoDB', 32400: 'Plex Media Server', 37777: 'Dahua DVR/NVR', 51820: 'WireGuard VPN',
};
export const CAMERA_PORTS = [80, 443, 554, 8000, 8080, 8899, 37777];
export const DEVICE_TYPES = ['workstation', 'server', 'router', 'switch', 'access-point', 'camera', 'nvr', 'printer', 'nas', 'phone', 'iot', 'other'];
