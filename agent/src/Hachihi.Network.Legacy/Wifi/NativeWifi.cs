// TRÍCH TỪ UI/WifiProPanel.cs (v5) — chỉ giữ lớp Native WLAN API; đã BỎ toàn bộ phần đọc/giải mã mật khẩu WiFi đã lưu.
// WifiProPanel - Do song WiFi chuyen nghiep dang UserControl (C# 5, .NET Framework 4.5+)
// Cach nhung: tab.Controls.Add(new WifiPro.WifiProPanel { Dock = DockStyle.Fill });
// Dung Native WiFi API (wlanapi.dll) de lay RSSI dBm that, kenh, bang tan, chuan, bao mat.
// Khong can thu vien ben ngoai: chi dung System.*, bien dich thanh 1 file exe duy nhat.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;

namespace WifiPro
{
    // =====================================================================
    //  NATIVE WLAN API
    // =====================================================================
    static class Native
    {
        [DllImport("wlanapi.dll")]
        public static extern int WlanOpenHandle(uint clientVersion, IntPtr reserved, out uint negotiated, out IntPtr handle);
        [DllImport("wlanapi.dll")]
        public static extern int WlanCloseHandle(IntPtr handle, IntPtr reserved);
        [DllImport("wlanapi.dll")]
        public static extern int WlanEnumInterfaces(IntPtr handle, IntPtr reserved, out IntPtr list);
        [DllImport("wlanapi.dll")]
        public static extern int WlanScan(IntPtr handle, ref Guid iface, IntPtr ssid, IntPtr ie, IntPtr reserved);
        [DllImport("wlanapi.dll")]
        public static extern int WlanGetNetworkBssList(IntPtr handle, ref Guid iface, IntPtr ssid, int bssType,
            [MarshalAs(UnmanagedType.Bool)] bool securityEnabled, IntPtr reserved, out IntPtr list);
        [DllImport("wlanapi.dll")]
        public static extern int WlanQueryInterface(IntPtr handle, ref Guid iface, int opCode, IntPtr reserved,
            out int size, out IntPtr data, IntPtr opType);
        [DllImport("wlanapi.dll")]
        public static extern void WlanFreeMemory(IntPtr p);

        [DllImport("wlanapi.dll")]
        public static extern int WlanGetProfileList(IntPtr handle, ref Guid iface, IntPtr reserved, out IntPtr list);
        [DllImport("wlanapi.dll")]
        public static extern int WlanGetProfile(IntPtr handle, ref Guid iface, [MarshalAs(UnmanagedType.LPWStr)] string profileName,
            IntPtr reserved, out IntPtr xml, ref uint flags, out uint access);

        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        public delegate void WlanNotificationCallback(IntPtr data, IntPtr context);
        [DllImport("wlanapi.dll")]
        public static extern int WlanRegisterNotification(IntPtr handle, uint source, bool ignoreDuplicate,
            WlanNotificationCallback callback, IntPtr context, IntPtr reserved, out uint prevSource);
        [DllImport("kernel32.dll")]
        public static extern bool Beep(uint freq, uint duration);
    }

    [StructLayout(LayoutKind.Sequential)]
    struct DOT11_SSID
    {
        public uint uSSIDLength;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)]
        public byte[] ucSSID;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct WLAN_RATE_SET
    {
        public uint uRateSetLength;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 126)]
        public ushort[] usRateSet;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct WLAN_BSS_ENTRY
    {
        public DOT11_SSID dot11Ssid;
        public uint uPhyId;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 6)]
        public byte[] dot11Bssid;
        public int dot11BssType;
        public int dot11BssPhyType;
        public int lRssi;
        public uint uLinkQuality;
        [MarshalAs(UnmanagedType.U1)]
        public bool bInRegDomain;
        public ushort usBeaconPeriod;
        public ulong ullTimestamp;
        public ulong ullHostTimestamp;
        public ushort usCapabilityInformation;
        public uint ulChCenterFrequency; // kHz
        public WLAN_RATE_SET wlanRateSet;
        public uint ulIeOffset;
        public uint ulIeSize;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct WLAN_INTERFACE_INFO
    {
        public Guid InterfaceGuid;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string strInterfaceDescription;
        public int isState;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct WLAN_ASSOCIATION_ATTRIBUTES
    {
        public DOT11_SSID dot11Ssid;
        public int dot11BssType;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 6)]
        public byte[] dot11Bssid;
        public int dot11PhyType;
        public uint uDot11PhyIndex;
        public uint wlanSignalQuality;
        public uint ulRxRate; // Kbps
        public uint ulTxRate; // Kbps
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct WLAN_CONNECTION_ATTRIBUTES
    {
        public int isState;
        public int wlanConnectionMode;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string strProfileName;
        public WLAN_ASSOCIATION_ATTRIBUTES wlanAssociationAttributes;
    }

    // =====================================================================
    //  MODEL
    // =====================================================================
    class WifiAp
    {
        public string Ssid, Bssid, Phy, Security, Band;
        public int Rssi, Quality, FreqMHz, Channel;
        public bool Connected;
        public string Vendor;          // hang san xuat theo OUI cua BSSID (dien luc hien thi)
        public bool VendorMix;         // cung SSID nhung co AP khac hang -> can luu y (AP la / evil twin)
    }


    class ConnInfo
    {
        public string Ssid, Bssid, Profile;
        public int Quality;
        public double RxMbps, TxMbps;
    }

    class WlanIface
    {
        public Guid Id;
        public string Name;
        public override string ToString() { return Name; }
    }

    class ScanResult
    {
        public List<WifiAp> Aps;
        public ConnInfo Conn;
    }

    static class Util
    {
        public static int ChannelOf(int mhz)
        {
            if (mhz == 2484) return 14;
            if (mhz >= 2400 && mhz < 2500) return (mhz - 2407) / 5;
            if (mhz >= 5925) return (mhz - 5950) / 5;
            if (mhz >= 4900) return (mhz - 5000) / 5;
            return 0;
        }

        public static string BandOf(int mhz)
        {
            if (mhz < 3000) return "2.4";
            if (mhz < 5925) return "5";
            return "6";
        }

        public static string PhyName(int t)
        {
            switch (t)
            {
                case 1: return "FHSS";
                case 2: return "802.11 DSSS";
                case 3: return "IR";
                case 4: return "802.11a";
                case 5: return "802.11b";
                case 6: return "802.11g";
                case 7: return "802.11n (Wi-Fi 4)";
                case 8: return "802.11ac (Wi-Fi 5)";
                case 9: return "802.11ad";
                case 10: return "802.11ax (Wi-Fi 6)";
                case 11: return "802.11be (Wi-Fi 7)";
                default: return "?";
            }
        }

        public static string Rating(int rssi)
        {
            if (rssi >= -50) return "Xuất sắc";
            if (rssi >= -60) return "Tốt";
            if (rssi >= -70) return "Khá";
            if (rssi >= -80) return "Yếu";
            return "Rất yếu";
        }


        public static string Csv(string s)
        {
            if (s == null) return "";
            return "\"" + s.Replace("\"", "\"\"") + "\"";
        }


        public static string Mac(byte[] b)
        {
            return BitConverter.ToString(b).Replace('-', ':');
        }

        public const string VendorUnknown = "Không rõ";
        const string VendorVirtual = "MAC ảo/riêng";
        static readonly Dictionary<string, string> vendorCache = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        // Hang san xuat cua AP theo OUI (bang IEEE nhung san + oui.csv). Co cache vi bang quet WiFi lam moi lien tuc.
        // BSSID cua SSID phu (multi-SSID) thuong bat bit "locally administered" (0x02) tren byte dau cua MAC goc,
        // nen neu tra khong ra thi thu lai voi bit nay da tat.
        public static string ApVendor(string bssid)
        {
            if (string.IsNullOrEmpty(bssid)) return VendorUnknown;
            string cached;
            lock (vendorCache) { if (vendorCache.TryGetValue(bssid, out cached)) return cached; }

            string v = HachihiNetworkScanner.Core.DeviceClassifier.GetBrand(bssid);
            bool unknown = string.IsNullOrEmpty(v) || v == VendorUnknown;
            if (unknown && bssid.Length >= 2)
            {
                try
                {
                    int first = Convert.ToInt32(bssid.Substring(0, 2), 16);
                    if ((first & 0x02) != 0)
                    {
                        string baseMac = (first & ~0x02).ToString("X2") + bssid.Substring(2);
                        v = HachihiNetworkScanner.Core.DeviceClassifier.GetBrand(baseMac);
                        unknown = string.IsNullOrEmpty(v) || v == VendorUnknown;
                        if (unknown) v = VendorVirtual;
                    }
                }
                catch { }
            }
            if (string.IsNullOrEmpty(v)) v = VendorUnknown;
            lock (vendorCache) { vendorCache[bssid] = v; }
            return v;
        }

        public static bool IsKnownVendor(string v)
        {
            return !string.IsNullOrEmpty(v) && v != VendorUnknown && v != VendorVirtual;
        }

        public static string SsidOf(DOT11_SSID s)
        {
            int len = (int)Math.Min(s.uSSIDLength, 32u);
            return len == 0 ? "" : Encoding.UTF8.GetString(s.ucSSID, 0, len);
        }

        // Doc IE de nhan dien WPA / WPA2 / WPA3 / Enterprise / OWE
        public static string ParseSecurity(byte[] ie, bool privacy)
        {
            bool wpa = false, rsn = false, sae = false, psk = false, eap = false, owe = false;
            int i = 0;
            while (i + 2 <= ie.Length)
            {
                int id = ie[i], len = ie[i + 1];
                int o = i + 2;
                if (o + len > ie.Length) break;

                if (id == 48 && len >= 8)
                {
                    rsn = true;
                    int p = o + 2 + 4; // version + group cipher
                    int end = o + len;
                    if (p + 2 <= end)
                    {
                        int pc = ie[p] | (ie[p + 1] << 8);
                        p += 2 + pc * 4;
                        if (p + 2 <= end)
                        {
                            int ac = ie[p] | (ie[p + 1] << 8);
                            p += 2;
                            for (int k = 0; k < ac && p + 4 <= end; k++, p += 4)
                            {
                                if (ie[p] == 0x00 && ie[p + 1] == 0x0F && ie[p + 2] == 0xAC)
                                {
                                    int t = ie[p + 3];
                                    if (t == 8 || t == 9) sae = true;
                                    else if (t == 2 || t == 4 || t == 6) psk = true;
                                    else if (t == 1 || t == 3 || t == 5) eap = true;
                                    else if (t == 18) owe = true;
                                }
                            }
                        }
                    }
                }
                else if (id == 221 && len >= 4 && ie[o] == 0x00 && ie[o + 1] == 0x50 && ie[o + 2] == 0xF2 && ie[o + 3] == 1)
                {
                    wpa = true;
                }
                i += 2 + len;
            }

            if (owe) return "OWE (Enhanced Open)";
            if (sae) return psk ? "WPA2/WPA3" : "WPA3";
            if (rsn) return eap ? "WPA2-Enterprise" : "WPA2";
            if (wpa) return "WPA";
            if (privacy) return "WEP";
            return "Mở (không bảo mật)";
        }
    }

    // =====================================================================
    //  WLAN CLIENT
    // =====================================================================
    class WlanClient : IDisposable
    {
        IntPtr handle = IntPtr.Zero;

        public WlanClient()
        {
            uint ver;
            int r = Native.WlanOpenHandle(2, IntPtr.Zero, out ver, out handle);
            if (r != 0)
                throw new Exception("Không mở được WLAN API (mã " + r + "). Hãy kiểm tra dịch vụ WLAN AutoConfig.");
        }

        // ---- su kien tu Windows (ket noi / ngat / cam rut card) ----
        Native.WlanNotificationCallback notifyCb;
        public event Action<uint> AcmEvent;

        public void EnableEvents()
        {
            if (notifyCb != null || handle == IntPtr.Zero) return;
            try
            {
                notifyCb = OnNotify; // giu tham chieu de GC khong thu hoi delegate
                uint prev;
                Native.WlanRegisterNotification(handle, 0x8 /* ACM */, true, notifyCb, IntPtr.Zero, IntPtr.Zero, out prev);
            }
            catch { notifyCb = null; }
        }

        void OnNotify(IntPtr data, IntPtr ctx)
        {
            try
            {
                if (data == IntPtr.Zero) return;
                uint src = (uint)Marshal.ReadInt32(data, 0);
                uint code = (uint)Marshal.ReadInt32(data, 4);
                if (src != 8) return;
                var h = AcmEvent;
                if (h != null) h(code);
            }
            catch { }
        }

        public List<WlanIface> GetInterfaces()
        {
            var list = new List<WlanIface>();
            IntPtr p;
            int r = Native.WlanEnumInterfaces(handle, IntPtr.Zero, out p);
            if (r != 0) throw new Exception("WlanEnumInterfaces lỗi " + r);
            try
            {
                int n = Marshal.ReadInt32(p, 0);
                int size = Marshal.SizeOf(typeof(WLAN_INTERFACE_INFO));
                for (int i = 0; i < n; i++)
                {
                    IntPtr e = new IntPtr(p.ToInt64() + 8 + (long)i * size);
                    var info = (WLAN_INTERFACE_INFO)Marshal.PtrToStructure(e, typeof(WLAN_INTERFACE_INFO));
                    list.Add(new WlanIface { Id = info.InterfaceGuid, Name = info.strInterfaceDescription });
                }
            }
            finally { Native.WlanFreeMemory(p); }
            return list;
        }

        public void Scan(Guid iface)
        {
            Native.WlanScan(handle, ref iface, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
        }

        public List<WifiAp> GetBssList(Guid iface)
        {
            var result = new List<WifiAp>();
            IntPtr p;
            int r = Native.WlanGetNetworkBssList(handle, ref iface, IntPtr.Zero, 3, false, IntPtr.Zero, out p);
            if (r != 0) throw new Exception("WlanGetNetworkBssList lỗi " + r);
            try
            {
                int n = Marshal.ReadInt32(p, 4);
                int size = Marshal.SizeOf(typeof(WLAN_BSS_ENTRY));
                for (int i = 0; i < n; i++)
                {
                    IntPtr e = new IntPtr(p.ToInt64() + 8 + (long)i * size);
                    var b = (WLAN_BSS_ENTRY)Marshal.PtrToStructure(e, typeof(WLAN_BSS_ENTRY));

                    byte[] ie = new byte[0];
                    if (b.ulIeSize > 0 && b.ulIeSize < 8192)
                    {
                        ie = new byte[b.ulIeSize];
                        Marshal.Copy(new IntPtr(e.ToInt64() + b.ulIeOffset), ie, 0, (int)b.ulIeSize);
                    }

                    var ap = new WifiAp();
                    ap.Ssid = Util.SsidOf(b.dot11Ssid);
                    if (ap.Ssid.Length == 0) ap.Ssid = "(ẩn)";
                    ap.Bssid = Util.Mac(b.dot11Bssid);
                    ap.Rssi = b.lRssi;
                    ap.Quality = (int)b.uLinkQuality;
                    ap.FreqMHz = (int)(b.ulChCenterFrequency / 1000);
                    ap.Channel = Util.ChannelOf(ap.FreqMHz);
                    ap.Band = Util.BandOf(ap.FreqMHz);
                    ap.Phy = Util.PhyName(b.dot11BssPhyType);
                    ap.Security = Util.ParseSecurity(ie, (b.usCapabilityInformation & 0x10) != 0);
                    result.Add(ap);
                }
            }
            finally { Native.WlanFreeMemory(p); }
            return result;
        }

        public ConnInfo GetConnection(Guid iface)
        {
            IntPtr p;
            int size;
            int r = Native.WlanQueryInterface(handle, ref iface, 7, IntPtr.Zero, out size, out p, IntPtr.Zero);
            if (r != 0) return null;
            try
            {
                var c = (WLAN_CONNECTION_ATTRIBUTES)Marshal.PtrToStructure(p, typeof(WLAN_CONNECTION_ATTRIBUTES));
                if (c.isState != 1) return null;
                var a = c.wlanAssociationAttributes;
                return new ConnInfo
                {
                    Ssid = Util.SsidOf(a.dot11Ssid),
                    Bssid = Util.Mac(a.dot11Bssid),
                    Profile = c.strProfileName,
                    Quality = (int)a.wlanSignalQuality,
                    RxMbps = a.ulRxRate / 1000.0,
                    TxMbps = a.ulTxRate / 1000.0
                };
            }
            finally { Native.WlanFreeMemory(p); }
        }

        public void Dispose()
        {
            if (handle != IntPtr.Zero)
            {
                if (notifyCb != null)
                {
                    try { uint prev; Native.WlanRegisterNotification(handle, 0, true, null, IntPtr.Zero, IntPtr.Zero, out prev); } catch { }
                    notifyCb = null;
                }
                Native.WlanCloseHandle(handle, IntPtr.Zero);
                handle = IntPtr.Zero;
            }
        }
    }

}
