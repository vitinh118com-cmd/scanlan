using System;
using System.Collections.Generic;

namespace HachihiNetworkScanner.Models
{
    public class DeviceInfo
    {
        public int Stt { get; set; }
        public string IpAddress { get; set; }
        public string MacAddress { get; set; }
        public string Brand { get; set; }
        public string OperatingSystem { get; set; }
        public string DeviceType { get; set; }
        public string OpenPorts { get; set; }
        public string WebTitle { get; set; }
        public string Hostname { get; set; }
        public string PingMs { get; set; }
        public string Status { get; set; }
        public string Note { get; set; }
        public string TimeDiscovered { get; set; }

        public DeviceInfo()
        {
            IpAddress = "";
            MacAddress = "Không rõ";
            Brand = "Không rõ";
            OperatingSystem = "Không rõ";
            DeviceType = "Thiết bị mạng / Khác";
            OpenPorts = "Không có cổng mở";
            WebTitle = "";
            Hostname = "Không xác định";
            PingMs = "N/A";
            Status = "Online";
            Note = "";
            TimeDiscovered = DateTime.Now.ToString("HH:mm:ss");
        }

        public string GetDeviceKey()
        {
            if (!string.IsNullOrEmpty(MacAddress) && MacAddress != "Không rõ" && MacAddress != "Xem ARP")
            {
                return "mac:" + MacAddress.ToUpper();
            }
            return "ip:" + IpAddress;
        }

        public double GetNumericPing()
        {
            if (string.IsNullOrEmpty(PingMs) || PingMs == "N/A" || PingMs == "--") return 0.0;
            double val;
            string clean = PingMs.Replace("ms", "").Trim();
            if (double.TryParse(clean, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out val))
            {
                return val;
            }
            return 0.0;
        }
    }

    public class ScanMode
    {
        public string Key { get; set; }
        public string Label { get; set; }
        public bool DoPing { get; set; }
        public bool DoHostname { get; set; }
        public bool DoHttp { get; set; }
        public int[] PortList { get; set; }

        public ScanMode(string key, string label, bool doPing, bool doHostname, bool doHttp, int[] portList)
        {
            Key = key;
            Label = label;
            DoPing = doPing;
            DoHostname = doHostname;
            DoHttp = doHttp;
            PortList = portList;
        }
    }

    public class ScanSnapshot
    {
        public string Id { get; set; }
        public string Timestamp { get; set; }
        public string Subnet { get; set; }
        public string Mode { get; set; }
        public int DeviceCount { get; set; }
        public List<DeviceInfo> Devices { get; set; }

        public ScanSnapshot()
        {
            Id = Guid.NewGuid().ToString().Substring(0, 8);
            Timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
            Subnet = "";
            Mode = "Deep";
            DeviceCount = 0;
            Devices = new List<DeviceInfo>();
        }
    }

    public class NetworkDiffResult
    {
        public List<DeviceInfo> NewDevices { get; set; }
        public List<DeviceInfo> RemovedDevices { get; set; }
        public List<DeviceInfo> IpChangedDevices { get; set; }

        public NetworkDiffResult()
        {
            NewDevices = new List<DeviceInfo>();
            RemovedDevices = new List<DeviceInfo>();
            IpChangedDevices = new List<DeviceInfo>();
        }

        public int TotalChanges
        {
            get { return NewDevices.Count + RemovedDevices.Count + IpChangedDevices.Count; }
        }
    }

    public class WanPortResult
    {
        public int Port { get; set; }
        public bool IsOpen { get; set; }
        public string State { get; set; } // "OPEN", "CLOSED", "FILTERED", "TIMEOUT"
        public string ServiceName { get; set; }
        public double LatencyMs { get; set; }
        public string Banner { get; set; }
        public string StatusReason { get; set; }
        public int? WinsockErrno { get; set; }

        public string Service
        {
            get { return ServiceName; }
            set { ServiceName = value; }
        }

        public string Latency
        {
            get
            {
                return LatencyMs > 0 ? string.Format("{0:F1} ms", LatencyMs) : "-";
            }
            set
            {
                if (string.IsNullOrEmpty(value) || value == "-")
                {
                    LatencyMs = 0;
                }
                else
                {
                    string clean = value.Replace("ms", "").Trim();
                    double d;
                    if (double.TryParse(clean, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out d))
                    {
                        LatencyMs = d;
                    }
                }
            }
        }

        public WanPortResult()
        {
            ServiceName = "Unknown";
            Banner = "";
            State = "CLOSED";
            LatencyMs = 0;
        }
    }

    public class GeoIpResult
    {
        public string IpAddress { get; set; }
        public string Country { get; set; }
        public string CountryCode { get; set; }
        public string City { get; set; }
        public string Region { get; set; }
        public string Isp { get; set; }
        public string Organization { get; set; }
        public string AsNumber { get; set; }
        public string AsName { get; set; }
        public string IpType { get; set; } // "Residential", "Business", "Datacenter / Cloud"
        public bool IsVpn { get; set; }
        public bool IsProxy { get; set; }
        public bool IsTor { get; set; }
        public bool IsDatacenter { get; set; }
        public string CloudProvider { get; set; }
        public string Timezone { get; set; }
        public string CachedSource { get; set; }

        public GeoIpResult()
        {
            IpAddress = "";
            Country = "Việt Nam";
            CountryCode = "VN";
            City = "Không rõ";
            Region = "";
            Isp = "Đang tra cứu...";
            Organization = "";
            AsNumber = "";
            AsName = "";
            IpType = "Doanh nghiệp / Thuê bao";
            IsVpn = false;
            IsProxy = false;
            IsTor = false;
            IsDatacenter = false;
            CloudProvider = "";
            Timezone = "Asia/Ho_Chi_Minh";
            CachedSource = "Live API";
        }
    }

    public class SslCertInfo
    {
        public bool HasSsl { get; set; }
        public bool Success { get; set; }
        public string Error { get; set; }
        public string ErrorMessage { get; set; }
        public string TlsVersion { get; set; }
        public string Cipher { get; set; }
        public string Subject { get; set; }
        public string Issuer { get; set; }
        public DateTime? ValidFrom { get; set; }
        public DateTime? ValidTo { get; set; }
        public int DaysRemaining { get; set; }
        public int DaysLeft { get; set; }
        public string SerialNumber { get; set; }
        public string Thumbprint { get; set; }
        public string Sha256Fingerprint { get; set; }
        public string SubjectAltNames { get; set; }
    }

    public class ScanProgressReport
    {
        public int Total { get; set; }
        public int Scanned { get; set; }
        public DeviceInfo DiscoveredDevice { get; set; }
        public List<string> SkippedSubnets { get; set; }
        public bool IsCompleted { get; set; }
    }

    public class WanProgressReport
    {
        public int DoneCount { get; set; }
        public int TotalPorts { get; set; }
        public WanPortResult Result { get; set; }
        public bool IsCompleted { get; set; }
        public string SummaryText { get; set; }
    }

    public class MonitorTickReport
    {
        public bool IsAlive { get; set; }
        public double LastRttMs { get; set; }
        public double? RttMs { get; set; }
        public int SentPackets { get; set; }
        public int ReceivedPackets { get; set; }
        public double PacketLossPercent { get; set; }
        public int TotalDowntimeSeconds { get; set; }
        public List<double> RttHistory { get; set; }

        public MonitorTickReport()
        {
            RttHistory = new List<double>();
        }
    }

    public class AssetInfo
    {
        public string Owner { get; set; }
        public string Department { get; set; }
        public string Location { get; set; }
        public string AssetCode { get; set; }
        public string WarrantyUntil { get; set; }
        public string Notes { get; set; }

        public AssetInfo()
        {
            Owner = "";
            Department = "";
            Location = "";
            AssetCode = "";
            WarrantyUntil = "";
            Notes = "";
        }
    }

    public class SnmpExtendedInfo
    {
        public bool IsSuccess { get; set; }
        public string SysDescr { get; set; }
        public string SysName { get; set; }
        public string Uptime { get; set; }
        public int CpuLoad { get; set; }
        public int RamTotalMb { get; set; }
        public long TrafficBps { get; set; }
        public string PoeStatus { get; set; }

        public SnmpExtendedInfo()
        {
            IsSuccess = false;
            SysDescr = "N/A";
            SysName = "N/A";
            Uptime = "N/A";
            CpuLoad = 0;
            RamTotalMb = 0;
            PoeStatus = "Normal";
        }
    }
}
