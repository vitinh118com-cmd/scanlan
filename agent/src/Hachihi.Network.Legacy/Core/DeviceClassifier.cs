using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace HachihiNetworkScanner.Core
{
    public class HostnamePatternRule
    {
        public Regex Pattern { get; set; }
        public string OsLabel { get; set; }
        public string DeviceTypeLabel { get; set; }
        public string BrandHint { get; set; }

        public HostnamePatternRule(string regexPattern, string osLabel, string deviceTypeLabel, string brandHint)
        {
            Pattern = new Regex(regexPattern, RegexOptions.IgnoreCase | RegexOptions.Compiled);
            OsLabel = osLabel;
            DeviceTypeLabel = deviceTypeLabel;
            BrandHint = brandHint;
        }
    }

    public static class DeviceClassifier
    {
        public static readonly List<HostnamePatternRule> HostnamePatterns = new List<HostnamePatternRule>
        {
            // Router / Gateway (Wi-Fi / GPON)
            new HostnamePatternRule(@"\b(RT-|GT-AX|GT-AC|TUF-AX|ZENWIFI)", "Thiết bị nhúng (Router - Linux)", "Router/Gateway (Wi-Fi)", "ASUS"),
            new HostnamePatternRule(@"\barcher\b|\bdeco\b|\btl-wr|\btl-mr", "Thiết bị nhúng (Router - Linux)", "Router/Gateway (Wi-Fi)", "TP-Link"),
            new HostnamePatternRule(@"mikrotik|routeros", "Thiết bị nhúng (Router - RouterOS/Linux)", "Router/Gateway", "MikroTik"),
            new HostnamePatternRule(@"gpon|\bont\b|home\s*gateway|\bhg\d{3,4}|zxhn|\bvigor\b", "Thiết bị nhúng (Router - Linux)", "Router/Gateway (Modem quang)", null),
            new HostnamePatternRule(@"^gateway$|^router$|^modem$", "Thiết bị nhúng (Router - Linux)", "Router/Gateway", null),

            // NAS
            new HostnamePatternRule(@"diskstation|\bds-?\d|synology", "Thiết bị nhúng (NAS - Linux)", "NAS Storage", "Synology"),
            new HostnamePatternRule(@"\bqnap\b", "Thiết bị nhúng (NAS - Linux)", "NAS Storage", "QNAP"),

            // Printers
            new HostnamePatternRule(@"printer|laserjet|deskjet|officejet|pixma|\bepson\b|\bbrother\b", "Thiết bị nhúng (Máy in)", "Máy in mạng", null),

            // Camera / Attendance
            new HostnamePatternRule(@"hikvision|\bipc-|\bipcam", "Thiết bị nhúng (Camera)", "Camera / NVR", "Hikvision"),
            new HostnamePatternRule(@"\bdahua\b|\bdvr-|\bnvr-", "Thiết bị nhúng (Camera)", "Camera / NVR", "Dahua"),
            new HostnamePatternRule(@"zkteco|chamcong", "Thiết bị nhúng (Chấm công)", "Máy chấm công", "ZKTeco"),

            // Apple
            new HostnamePatternRule(@"iphone", "iOS", "Điện thoại (iPhone)", "Apple"),
            new HostnamePatternRule(@"ipad", "iPadOS", "Máy tính bảng (iPad)", "Apple"),
            new HostnamePatternRule(@"\bipod\b", "iOS", "Thiết bị Apple (iPod)", "Apple"),
            new HostnamePatternRule(@"macbook|imac\b|mac-?mini|mac-?pro", "macOS", "Máy tính (Mac)", "Apple"),

            // Android
            new HostnamePatternRule(@"\bsm-[a-z]\d|galaxy|\bredmi\b|\bpoco\b|\bxiaomi\b|\boppo\b|\bvivo\b|\brealme\b|\boneplus\b|\bhonor\b|\bhuawei\b|\bpixel\b|\binfinix\b|\btecno\b|\bzenfone\b|\bmoto[- ]?g|\bnexus\b|android", "Android", "Điện thoại/Máy tính bảng (Android)", null),
            new HostnamePatternRule(@"\btab[- ]?[a-z]?\d|tablet", "Android", "Máy tính bảng (Android)", null),

            // Windows PC
            new HostnamePatternRule(@"^(desktop|laptop|win|pc)[-_]", "Windows", "Windows PC / Server", null),

            // Linux
            new HostnamePatternRule(@"raspberrypi|raspbian", "Linux/Unix", "Raspberry Pi", "Raspberry Pi"),
            new HostnamePatternRule(@"\bubuntu\b|\bdebian\b|\bcentos\b|\bfedora\b|\bopenwrt\b|\bkali\b", "Linux/Unix", "Linux Server", null),

            // Smart TV
            new HostnamePatternRule(@"smarttv|chromecast|\bfiretv\b|\broku\b|androidtv|bravia", "Thiết bị nhúng (Smart TV)", "Smart TV / Thiết bị giải trí", null)
        };

        private static volatile Dictionary<string, string> _customOuiDb = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        private static bool _ouiLoaded = false;
        private static readonly object _ouiLock = new object();

        public static void EnsureOuiDatabaseLoaded()
        {
            if (_ouiLoaded) return;
            lock (_ouiLock)
            {
                if (_ouiLoaded) return;
                try { LoadBuiltInOui(); } catch { }
                try
                {
                    LoadCustomOuiFiles(_customOuiDb);
                }
                catch
                {
                }
                finally
                {
                    _ouiLoaded = true;
                }
            }
        }

        /// <summary>
        /// Nạp các file OUI mở rộng. Thứ tự (sau ghi đè trước): dữ liệu tải từ IEEE trong AppData
        /// (oui.csv = MA-L, mam.csv = MA-M, oui36.csv = MA-S), rồi oui.csv đặt cạnh file exe (ưu tiên cao nhất).
        /// </summary>
        private static void LoadCustomOuiFiles(Dictionary<string, string> target)
        {
            string appData = NetworkUtils.GetDataDirectory();
            foreach (string name in new string[] { "oui.csv", "mam.csv", "oui36.csv" })
            {
                string p = Path.Combine(appData, name);
                if (File.Exists(p)) LoadOuiCsvFile(p, target);
            }
            string local = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "oui.csv");
            if (File.Exists(local)) LoadOuiCsvFile(local, target);
        }

        /// <summary>Nạp lại bảng OUI (sau khi cập nhật từ IEEE) mà không cần khởi động lại. An toàn khi đang quét.</summary>
        public static int ReloadOuiDatabase()
        {
            EnsureOuiDatabaseLoaded();
            Dictionary<string, string> fresh = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            lock (_ouiLock)
            {
                LoadCustomOuiFiles(fresh);
                _customOuiDb = fresh;   // hoán đổi tham chiếu: luồng đang tra cứu vẫn dùng bảng cũ nguyên vẹn
            }
            return fresh.Count;
        }

        /// <summary>Tổng số mục OUI hiện có (nhúng sẵn + tải thêm), để hiển thị trong cài đặt.</summary>
        public static int OuiEntryCount()
        {
            EnsureOuiDatabaseLoaded();
            return _builtInOui.Count + _customOuiDb.Count;
        }

        private static readonly Dictionary<string, string> _builtInOui = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        private static void LoadBuiltInOui()
        {
            byte[] gz = Convert.FromBase64String(string.Concat(OuiData.Chunks));
            using (var ms = new MemoryStream(gz))
            using (var z = new System.IO.Compression.GZipStream(ms, System.IO.Compression.CompressionMode.Decompress))
            using (var rd = new StreamReader(z, Encoding.UTF8))
            {
                string line;
                while ((line = rd.ReadLine()) != null)
                {
                    int i = line.IndexOf('|');
                    if (i == 6 || i == 7 || i == 9) _builtInOui[line.Substring(0, i)] = line.Substring(i + 1); // MA-L / MA-M / MA-S+IAB
                }
            }
        }

        public static int LoadOuiCsvFile(string csvFilePath)
        {
            return LoadOuiCsvFile(csvFilePath, _customOuiDb);
        }

        public static int LoadOuiCsvFile(string csvFilePath, Dictionary<string, string> target)
        {
            if (!File.Exists(csvFilePath)) return 0;
            int loaded = 0;

            try
            {
                using (var reader = new StreamReader(csvFilePath, Encoding.UTF8))
                {
                    string header = reader.ReadLine(); // Skip header
                    string line;
                    while ((line = reader.ReadLine()) != null)
                    {
                        if (string.IsNullOrWhiteSpace(line)) continue;
                        List<string> fields = ParseCsvLine(line);
                        // Standard IEEE format: Registry,Assignment,Organization Name,Organization Address
                        // e.g. MA-L,286FB9,"Nokia Shanghai Bell Co., Ltd.","..."
                        if (fields.Count >= 3)
                        {
                            string assignment = fields[1].Trim().ToUpper();
                            string orgName = fields[2].Trim();

                            // 6 = MA-L, 7 = MA-M, 9 = MA-S / IAB (bo qua dong "Private" / "IEEE Registration Authority")
                            if ((assignment.Length == 6 || assignment.Length == 7 || assignment.Length == 9) && !IsPlaceholderOrg(orgName))
                            {
                                target[assignment] = SimplifyVendorName(orgName);
                                loaded++;
                            }
                        }
                    }
                }
            }
            catch
            {
            }
            return loaded;
        }

        private static List<string> ParseCsvLine(string line)
        {
            List<string> result = new List<string>();
            bool inQuotes = false;
            StringBuilder sb = new StringBuilder();

            for (int i = 0; i < line.Length; i++)
            {
                char c = line[i];
                if (c == '\"')
                {
                    inQuotes = !inQuotes;
                }
                else if (c == ',' && !inQuotes)
                {
                    result.Add(sb.ToString());
                    sb.Length = 0;
                }
                else
                {
                    sb.Append(c);
                }
            }
            result.Add(sb.ToString());
            return result;
        }

        public static string SimplifyVendorName(string orgName)
        {
            if (string.IsNullOrEmpty(orgName)) return "Không rõ";
            string clean = orgName.Trim('\"', ' ', '\t');

            // Quick friendly brand mapping
            string lower = clean.ToLowerInvariant();
            if (lower.Contains("cisco")) return "Cisco";
            if (lower.Contains("huawei")) return "Huawei";
            if (lower.Contains("tp-link") || lower.Contains("tplink")) return "TP-Link";
            if (lower.Contains("mikrotik")) return "MikroTik";
            if (lower.Contains("hikvision")) return "Hikvision";
            if (lower.Contains("dahua")) return "Dahua";
            if (lower.Contains("apple")) return "Apple";
            if (lower.Contains("samsung")) return "Samsung";
            if (Regex.IsMatch(lower, @"\bintel\b")) return "Intel";
            if (lower.Contains("hewlett") || lower.Contains("hp inc") || lower.Contains("hp enterprise")) return "HP";
            if (lower.Contains("dell")) return "Dell";
            if (lower.Contains("nokia")) return "Nokia";
            if (lower.Contains("zte")) return "ZTE";
            if (lower.Contains("sony")) return "Sony";
            if (lower.Contains("xiaomi")) return "Xiaomi";
            if (lower.Contains("honor")) return "Honor";
            if (lower.Contains("asus") || lower.Contains("asustek")) return "ASUS";
            if (lower.Contains("synology")) return "Synology";
            if (lower.Contains("qnap")) return "QNAP";
            if (lower.Contains("ubiquiti")) return "Ubiquiti";
            if (lower.Contains("fiberhome")) return "Fiberhome";
            if (lower.Contains("ruijie") || lower.Contains("reyee")) return "Ruijie Reyee";
            if (lower.Contains("d-link")) return "D-Link";
            if (lower.Contains("tenda")) return "Tenda";
            if (Regex.IsMatch(lower, @"\bcanon\b")) return "Canon";
            if (lower.Contains("epson")) return "Epson";
            if (lower.Contains("brother")) return "Brother";
            if (lower.Contains("realtek")) return "Realtek";
            if (lower.Contains("routerboard")) return "MikroTik";      // IEEE ghi MikroTik la "Routerboard.com"
            if (lower.Contains("ezviz")) return "Ezviz";
            if (lower.Contains("zkteco") || lower.Contains("zksoftware")) return "ZKTeco";
            if (lower.Contains("uniview")) return "Uniview";
            if (lower.Contains("kbvision")) return "KBVision";
            if (lower.Contains("hanwha")) return "Hanwha";
            if (lower.Contains("reolink")) return "Reolink";
            if (lower.Contains("vnpt")) return "VNPT";
            if (lower.Contains("viettel")) return "Viettel";
            if (lower.Contains("fpt telecom")) return "FPT";
            if (lower.Contains("vinsmart") || lower.Contains("vsmart")) return "VinSmart";
            if (lower.Contains("grandstream")) return "Grandstream";
            if (lower.Contains("tuya")) return "Tuya";
            if (lower.Contains("espressif")) return "Espressif";
            if (lower.Contains("oppo mobile")) return "OPPO";
            if (lower.Contains("vivo mobile")) return "vivo";
            if (lower.Contains("realme")) return "realme";
            if (lower.Contains("oneplus")) return "OnePlus";
            if (lower.Contains("lg electronics")) return "LG";
            if (lower.Contains("microsoft")) return "Microsoft";

            // Clean common corporate suffixes
            string friendly = Regex.Replace(clean, @"(?i),?\s*(Inc\.?|Co\.?,?\s*Ltd\.?|LLC|Corporation|Corp\.?|GmbH|B\.V\.|Technology|Technologies|International|Electronics|Systems)$", "").Trim();
            return string.IsNullOrEmpty(friendly) ? clean : friendly;
        }

        private static readonly int[] LookupLengths = new int[] { 9, 7, 6 }; // 36-bit (MA-S/IAB) -> 28-bit (MA-M) -> 24-bit (MA-L)

        // IEEE dung "Private" (hang an danh) va "IEEE Registration Authority" (khung MA-L chia nho cho MA-M/MA-S) -> khong co y nghia
        private static bool IsPlaceholderOrg(string org)
        {
            if (string.IsNullOrWhiteSpace(org)) return true;
            string l = org.Trim().Trim('"').Trim().ToLowerInvariant();
            return l == "private" || l.StartsWith("ieee registration authority");
        }

        // Truyen DAY DU dia chi MAC (vd "8C:1F:64:AF:A1:23") de tra cuu duoc MA-M / MA-S;
        // chi truyen 3 byte dau thi chi tra cuu duoc MA-L.  Khop dai nhat thang.
        public static string GetBrand(string mac)
        {
            if (string.IsNullOrEmpty(mac)) return "Không rõ";
            EnsureOuiDatabaseLoaded();

            string clean = Regex.Replace(mac, @"[^0-9A-Fa-f]", "").ToUpperInvariant();
            if (clean.Length < 6) return "Không rõ";
            string org;

            // 1) oui.csv do nguoi dung dat canh exe (uu tien cao nhat)
            foreach (int n in LookupLengths)
            {
                if (clean.Length < n) continue;
                if (_customOuiDb.TryGetValue(clean.Substring(0, n), out org)) return org;
            }

            // 2) du lieu IEEE nhung san
            foreach (int n in LookupLengths)
            {
                if (clean.Length < n) continue;
                if (_builtInOui.TryGetValue(clean.Substring(0, n), out org)) return SimplifyVendorName(org);
            }

            // 3) bang tay Hachihi: chi dung khi IEEE khong co (hoac ghi "Private")
            string colon = string.Format("{0}:{1}:{2}", clean.Substring(0, 2), clean.Substring(2, 2), clean.Substring(4, 2));
            if (Constants.MacPrefixDb.TryGetValue(colon, out org)) return org;

            return "Không rõ";
        }

        public const string RandomMacLabel = "MAC ngẫu nhiên";

        // Chi dung de HIEN THI: hang chua ro + MAC "locally administered" = dien thoai bat MAC rieng tu / ngau nhien
        public static string DisplayBrand(string brand, string mac)
        {
            bool unknown = string.IsNullOrEmpty(brand) || brand == "Không rõ";
            if (unknown && NetworkUtils.IsLocallyAdministeredMac(mac)) return RandomMacLabel;
            return brand;
        }

        private static Dictionary<int, string> _ianaPorts;
        private static readonly object _ianaLock = new object();

        private static void EnsureIanaPorts()
        {
            if (_ianaPorts != null) return;
            lock (_ianaLock)
            {
                if (_ianaPorts != null) return;
                var d = new Dictionary<int, string>();
                try
                {
                    byte[] gz = Convert.FromBase64String(string.Concat(OuiData.PortChunks));
                    using (var ms = new MemoryStream(gz))
                    using (var z = new System.IO.Compression.GZipStream(ms, System.IO.Compression.CompressionMode.Decompress))
                    using (var rd = new StreamReader(z, Encoding.UTF8))
                    {
                        string line;
                        while ((line = rd.ReadLine()) != null)
                        {
                            int i = line.IndexOf('|'); int port;
                            if (i > 0 && int.TryParse(line.Substring(0, i), out port)) d[port] = line.Substring(i + 1);
                        }
                    }
                }
                catch { }
                _ianaPorts = d;
            }
        }

        public static string GetServiceName(int port, string defaultName = "?")
        {
            string name;
            if (Constants.ServiceNames.TryGetValue(port, out name)) return name;
            EnsureIanaPorts();
            if (_ianaPorts.TryGetValue(port, out name)) return name;
            return defaultName;
        }

        public static string GuessOsByTtl(int? ttl, string macPrefix, string brand, string hostname)
        {
            if (!ttl.HasValue) return "Không rõ";
            int val = ttl.Value;
            if (val > 128) return "Thiết bị mạng (Cisco/Solaris)";
            if (val > 64) return "Windows";

            string brandLower = (brand ?? "").ToLowerInvariant();
            if (brandLower.Contains("apple"))
                return "macOS / iOS (chưa rõ loại thiết bị)";

            foreach (string hint in Constants.MobileVendorHints)
            {
                if (brandLower.Contains(hint))
                    return "Android (theo hãng, chưa chắc chắn)";
            }

            if (NetworkUtils.IsLocallyAdministeredMac(macPrefix))
                return "Có thể là di động (MAC ngẫu nhiên riêng tư)";

            return "Linux/Unix/macOS/Android (TTL=64)";
        }

        public static void ClassifyByPorts(
            HashSet<int> openPorts,
            string macPrefix,
            ref string brand,
            out string devType,
            out string osOverride,
            out bool tentative)
        {
            devType = "Thiết bị mạng / Khác";
            osOverride = null;
            tentative = false;

            if (openPorts.Contains(22))
            {
                devType = "Linux/Unix Server";
                osOverride = "Linux/Unix";
                if (brand == "Không rõ") brand = "Linux Host";
            }
            if (openPorts.Contains(3389))
            {
                devType = "Windows PC / Server";
                osOverride = "Windows";
                if (brand == "Không rõ") brand = "Microsoft Windows";
            }
            else if (openPorts.Contains(8291))
            {
                brand = "MikroTik";
                devType = "Router/Gateway (RouterOS)";
                osOverride = "Thiết bị nhúng (Router - RouterOS/Linux)";
            }
            else if (openPorts.Contains(5001) || macPrefix == "00:11:32")
            {
                brand = "Synology";
                devType = "NAS Storage";
                osOverride = "Thiết bị nhúng (NAS - Linux)";
            }
            else if (openPorts.Contains(8000))
            {
                brand = "Hikvision";
                devType = "Camera / NVR";
                osOverride = "Thiết bị nhúng (Camera)";
            }
            else if (openPorts.Contains(37777))
            {
                brand = "Dahua";
                devType = "Camera / NVR";
                osOverride = "Thiết bị nhúng (Camera)";
            }
            else if (openPorts.Contains(9000))
            {
                brand = "ZKTeco";
                devType = "Máy chấm công";
                osOverride = "Thiết bị nhúng (Chấm công)";
            }
            else if (openPorts.Contains(9100))
            {
                devType = "Máy in mạng";
                tentative = true;
            }
            else if (openPorts.Contains(161))
            {
                devType = "SNMP Device";
                tentative = true;
            }
            else if (openPorts.Contains(445) && !openPorts.Contains(3389))
            {
                devType = "NAS / Samba Share";
                tentative = true;
            }
        }

        public static void RefineByHostname(
            string hostname,
            ref string devType,
            ref string osOverride,
            ref string brand,
            bool tentative)
        {
            if (string.IsNullOrEmpty(hostname) || hostname == "Không xác định" || hostname == "N/A")
                return;

            if (!tentative && devType != "Thiết bị mạng / Khác")
                return;

            foreach (HostnamePatternRule rule in HostnamePatterns)
            {
                if (rule.Pattern.IsMatch(hostname))
                {
                    devType = rule.DeviceTypeLabel;
                    if (!string.IsNullOrEmpty(rule.OsLabel))
                        osOverride = rule.OsLabel;
                    if (!string.IsNullOrEmpty(rule.BrandHint) && brand == "Không rõ")
                        brand = rule.BrandHint;
                    break;
                }
            }
        }

        public static string RefineGenericDevType(string macPrefix, string brand)
        {
            string brandLower = (brand ?? "").ToLowerInvariant();
            if (brandLower.Contains("apple"))
                return "Thiết bị Apple (chưa rõ loại)";

            foreach (string hint in Constants.MobileVendorHints)
            {
                if (brandLower.Contains(hint))
                    return "Điện thoại/Máy tính bảng (theo hãng)";
            }

            if (NetworkUtils.IsLocallyAdministeredMac(macPrefix))
                return "Điện thoại/Thiết bị di động (MAC ngẫu nhiên)";

            return "Thiết bị mạng / Khác";
        }
    }
}
