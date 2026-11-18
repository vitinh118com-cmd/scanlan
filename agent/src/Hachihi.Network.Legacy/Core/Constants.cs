using System.Collections.Generic;
using HachihiNetworkScanner.Models;

namespace HachihiNetworkScanner.Core
{
    public static class Constants
    {
        public const string AppTitle = "HACHIHI NETWORK SCANNER — ULTIMATE";
        public const string AppVersion = AppInfo.FullLabel;

        public const double PortTimeoutSec = 0.35;
        public const int PingTimeoutMs = 400;
        public const double HttpTimeoutSec = 1.5;
        public const double WanPortTimeoutSec = 3.5;

        public const int SemPortLimit = 400;
        public const int SemPingLimit = 60;
        public const int SemHttpLimit = 40;

        // ---- quet mang lon (/22, /16...) ----
        public const int MaxScanHosts = 65534;        // toi da 1 dai CIDR (= /16); dai lon hon bi cat con /16 dau tien
        public const int LargeScanThreshold = 2048;   // tong so IP vuot nguong nay -> quet 2 buoc (ping sweep truoc, chi do sau may dang song)
        public const int SemSweepLimit = 256;         // so ping dong thoi khi sweep
        public const int SweepChunk = 2048;           // so IP moi lo sweep (gioi han bo nho)
        public const int SweepPingTimeoutMs = 350;

        public const string NotesFile = "device_notes.json";
        public const string HistoryFile = "scan_history.json";
        public const string TopoPosFile = "topology_positions.json";
        public const int MaxHistorySnapshots = 20;

        public static readonly Dictionary<int, string> ServiceNames = new Dictionary<int, string>
        {
            { 21, "FTP" }, { 22, "SSH" }, { 23, "Telnet" }, { 25, "SMTP" }, { 53, "DNS" },
            { 80, "HTTP Web" }, { 110, "POP3" }, { 135, "RPC" }, { 139, "NetBIOS" }, { 143, "IMAP" },
            { 161, "SNMP" }, { 443, "HTTPS Web" }, { 445, "SMB/File Sharing" }, { 554, "RTSP Camera" },
            { 1194, "OpenVPN" }, { 1433, "MS SQL" }, { 1521, "Oracle DB" }, { 1723, "PPTP VPN" },
            { 3306, "MySQL" }, { 3389, "RDP Remote Desktop" }, { 5000, "Synology DSM (HTTP)" },
            { 5001, "Synology DSM (HTTPS)" }, { 5060, "SIP VoIP" }, { 5432, "PostgreSQL" },
            { 5900, "VNC Remote" }, { 6379, "Redis" }, { 8000, "Hikvision SDK / HTTP-Alt" },
            { 8080, "HTTP-Proxy / Web" }, { 8291, "MikroTik Winbox" }, { 8443, "HTTPS-Alt" },
            { 8888, "HTTP-Alt" }, { 8899, "ONVIF Camera" }, { 9000, "ZKTeco / Portainer" },
            { 9100, "Printer / RAW" }, { 27017, "MongoDB" }, { 32400, "Plex Media Server" },
            { 37777, "Dahua DVR/NVR" }, { 51820, "WireGuard VPN" }
        };

        public static readonly int[] QuickPorts = new int[]
        {
            80, 443, 22, 445, 139, 3389, 5000, 5001, 8291, 8000, 554, 9100, 161, 135
        };

        public static readonly int[] TopWanPorts = new int[]
        {
            21, 22, 23, 25, 53, 80, 81, 110, 135, 139, 143, 443, 445, 465, 554, 587, 993, 995,
            1194, 1433, 1521, 1723, 3306, 3389, 5000, 5001, 5060, 5432, 5900, 6379, 8000, 8080,
            8081, 8291, 8443, 8888, 8899, 9000, 9100, 9200, 10000, 27017, 32400, 37777, 50000, 51820
        };

        public static readonly int[] FullPorts;

        static Constants()
        {
            List<int> ports = new List<int>(ServiceNames.Keys);
            ports.Sort();
            FullPorts = ports.ToArray();
        }

        public static readonly KeyValuePair<int, string>[] HttpProbePorts = new KeyValuePair<int, string>[]
        {
            new KeyValuePair<int, string>(80, "http"),
            new KeyValuePair<int, string>(8080, "http"),
            new KeyValuePair<int, string>(8000, "http"),
            new KeyValuePair<int, string>(443, "https"),
            new KeyValuePair<int, string>(5001, "https"),
            new KeyValuePair<int, string>(8443, "https")
        };

        public static readonly HashSet<int> HttpsWanPorts = new HashSet<int> { 443, 5001, 8443, 9443 };
        public static readonly HashSet<int> HttpWanPorts = new HashSet<int> { 80, 5000, 8080, 8000, 8081, 8888 };

        public static readonly string[] FastExtraSubnets = new string[] { "192.168.1.", "192.168.0." };
        public static readonly string[] DeepExtraSubnets = new string[]
        {
            "192.168.1.", "192.168.0.", "192.168.2.", "192.168.10.", "192.168.100.", "192.168.50.",
            "192.168.88.", "192.168.123.", "192.168.3.", "192.168.30.",
            "10.0.0.", "10.0.1.", "10.1.1.", "10.10.10.",
            "172.16.0.", "172.16.1."
        };

        public static readonly Dictionary<string, string> MacPrefixDb = new Dictionary<string, string>
        {
            { "04:D9:F5", "ASUS" }, { "18:31:BF", "ASUS" }, { "24:4B:FE", "ASUS" }, { "50:46:5D", "ASUS" }, { "A8:5E:45", "ASUS" },
            { "4C:5E:0C", "MikroTik" }, { "6C:3B:6B", "MikroTik" }, { "D4:CA:6D", "MikroTik" }, { "E4:8D:8C", "MikroTik" },
            { "10:D4:7A", "Hikvision" }, { "A4:14:37", "Hikvision" }, 
            { "3C:EF:8C", "Dahua" }, { "4C:11:BF", "Dahua" }, { "90:02:A9", "Dahua" },
            { "00:1D:0F", "TP-Link" }, { "50:C7:BF", "TP-Link" }, { "B0:4E:26", "TP-Link" }, { "F4:F2:6D", "TP-Link" },
            { "00:17:61", "ZKTeco" }, 
            { "00:11:32", "Synology" }, 
            { "DC:A6:32", "Raspberry Pi" }, { "B8:27:EB", "Raspberry Pi" }, { "E4:5F:01", "Raspberry Pi" },
            { "00:50:56", "VMware" }, { "00:0C:29", "VMware" }, { "00:05:69", "VMware" },
            { "52:54:00", "QEMU/KVM" },
            { "00:03:93", "Apple" }, { "3C:07:54", "Apple" }, { "A4:5E:60", "Apple" }, { "F0:18:98", "Apple" },
            { "00:0D:93", "Apple" }, { "AC:87:A3", "Apple" },
            { "00:16:6C", "Samsung" }, { "8C:79:F5", "Samsung" }, { "D0:22:BE", "Samsung" },
            { "24:A4:3C", "Ubiquiti" }, { "F0:9F:C2", "Ubiquiti" }, { "78:8A:20", "Ubiquiti" },
            { "00:E0:4C", "Realtek NIC" }
        };

        public static readonly string[] MobileVendorHints = new string[]
        {
            "xiaomi", "samsung", "oppo", "vivo", "realme", "huawei", "honor",
            "oneplus", "nokia", "meizu", "infinix", "tecno", "transsion", "vsmart"
        };

        public static readonly HashSet<int> IspCommonlyBlockedPorts = new HashSet<int>
        {
            445, 139, 137, 138, 25, 23, 1433, 3389
        };

        public static readonly Dictionary<string, ScanMode> ScanModes = new Dictionary<string, ScanMode>
        {
            { "fast", new ScanMode("fast", "⚡ Nhanh (Quick discovery)", true, true, true, FullPorts) },
            { "deep", new ScanMode("deep", "🔬 Sâu (Đầy đủ thông tin)", true, true, true, FullPorts) }
        };
    }
}
