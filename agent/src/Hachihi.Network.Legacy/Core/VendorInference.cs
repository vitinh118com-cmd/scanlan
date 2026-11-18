using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace HachihiNetworkScanner.Core
{
    /// <summary>Kết quả suy đoán hãng/loại thiết bị từ nguồn ngoài OUI.</summary>
    public class VendorGuess
    {
        public string Brand;        // có thể null nếu chỉ đoán được hệ điều hành
        public string DeviceType;   // có thể null
        public string Os;           // có thể null
        public string Source;       // nguồn gợi ý, vd "UPnP", "mDNS", "Tên máy", "HTTP"
    }

    /// <summary>Các gợi ý thu thập riêng lẻ cho một IP trong lúc quét (truyền từ engine xuống ProbeHostAsync).</summary>
    public class DiscoveryHints
    {
        public string Mdns;           // tên mDNS (tra ngược hoặc đoán từ gói trả lời)
        public string Ssdp;           // dòng SERVER hoặc ST của SSDP
        public string Nbns;           // tên NetBIOS
        public string SsdpLocation;   // URL mô tả thiết bị UPnP (nếu có)

        public string First()
        {
            if (!string.IsNullOrEmpty(Mdns)) return Mdns;
            if (!string.IsNullOrEmpty(Ssdp)) return Ssdp;
            if (!string.IsNullOrEmpty(Nbns)) return Nbns;
            return null;
        }
    }

    /// <summary>
    /// Suy đoán hãng cho thiết bị mà bảng OUI không trả lời được — chủ yếu là điện thoại/máy tính bảng
    /// bật "MAC ngẫu nhiên / MAC riêng tư" (bit locally-administered), nên MAC không còn mang thông tin hãng.
    /// Nguồn dùng (theo thứ tự tin cậy): nhà sản xuất khai báo trong mô tả UPnP/SSDP,
    /// tên máy (mDNS / DNS-DHCP / NetBIOS / friendlyName UPnP), banner HTTP và dòng SERVER của SSDP.
    /// Đây là suy đoán dựa trên tên nên có thể sai nếu người dùng tự đặt tên máy lạ.
    /// </summary>
    public static class VendorInference
    {
        private class Rule
        {
            public Regex Pattern;
            public string Brand, DeviceType, Os;
        }

        private static Rule R(string pattern, string brand, string deviceType, string os)
        {
            return new Rule
            {
                Pattern = new Regex(pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant),
                Brand = brand,
                DeviceType = deviceType,
                Os = os
            };
        }

        private const string PhoneAndroid = "Điện thoại/Máy tính bảng (Android)";
        private const string TabletAndroid = "Máy tính bảng (Android)";
        private const string NotAlnum = @"(?<![a-z0-9])";   // ranh giới "từ" cho tên máy có dấu - _ .

        // Luật theo TÊN máy (hostname / mDNS / NetBIOS / friendlyName). Luật cụ thể đặt trước luật chung.
        private static readonly List<Rule> NameRules = new List<Rule>
        {
            // ---- Apple ----
            R(NotAlnum + @"iphone", "Apple", "Điện thoại (iPhone)", "iOS"),
            R(NotAlnum + @"ipad", "Apple", "Máy tính bảng (iPad)", "iPadOS"),
            R(NotAlnum + @"(macbook|imac|mac-?mini|mac-?pro|mac-?studio)", "Apple", "Máy tính (Mac)", "macOS"),
            R(NotAlnum + @"apple-?watch", "Apple", "Đồng hồ (Apple Watch)", "watchOS"),
            R(NotAlnum + @"(apple-?tv|homepod)", "Apple", "Thiết bị giải trí (Apple)", null),

            // ---- Smart TV (đặt trước điện thoại để \"Samsung TV\" không bị nhầm) ----
            R(@"\[tv\]|samsung[-_ ]?(smart)?[-_ ]?tv|tizen", "Samsung", "Smart TV", "Thiết bị nhúng (Smart TV)"),
            R(@"lg[-_ ]?webos|webos|lgwebostv|lg[-_ ]?tv", "LG", "Smart TV", "Thiết bị nhúng (Smart TV)"),
            R(@"bravia", "Sony", "Smart TV", "Thiết bị nhúng (Smart TV)"),
            R(@"chromecast|google[-_ ]?(home|nest|tv)|nest[-_ ](hub|mini|audio|cam)", "Google", "Thiết bị giải trí / Smart home", null),
            R(@"fire[-_ ]?tv|kindle|echo[-_ ]?(dot|show|plus|studio)|amazon", "Amazon", "Thiết bị giải trí / Smart home", null),

            // ---- Samsung ----
            R(NotAlnum + @"galaxy[-_ ]?watch", "Samsung", "Đồng hồ (Galaxy Watch)", null),
            R(NotAlnum + @"galaxy[-_ ]?(tab|book)", "Samsung", TabletAndroid, "Android"),
            R(NotAlnum + @"sm-[a-z]\d{3}|" + NotAlnum + @"galaxy|samsung", "Samsung", PhoneAndroid, "Android"),
            R(NotAlnum + @"sec[0-9a-f]{12}(?![0-9a-f])", "Samsung", "Máy in mạng", null),

            // ---- Điện thoại Android theo hãng ----
            R(@"redmi|xiaomi|miui|" + NotAlnum + @"poco|" + NotAlnum + @"mi[-_]?\d{1,2}(?![0-9])|" + NotAlnum + @"mi[-_ ]?(pad|band|box)", "Xiaomi", PhoneAndroid, "Android"),
            R(@"oppo|" + NotAlnum + @"cph\d{4}|" + NotAlnum + @"reno[-_ ]?\d|" + NotAlnum + @"find[-_ ]?x\d", "OPPO", PhoneAndroid, "Android"),
            R(@"realme|" + NotAlnum + @"rmx\d{4}", "realme", PhoneAndroid, "Android"),
            R(NotAlnum + @"(vivo(?!book)|iqoo)", "vivo", PhoneAndroid, "Android"),
            R(@"one[-_ ]?plus", "OnePlus", PhoneAndroid, "Android"),
            R(@"honor", "Honor", PhoneAndroid, "Android"),
            R(@"huawei|matepad|mediapad|" + NotAlnum + @"nova[-_ ]?\d", "Huawei", PhoneAndroid, "Android"),
            R(NotAlnum + @"pixel[-_ ]?\d", "Google", PhoneAndroid, "Android"),
            R(@"nokia", "Nokia", PhoneAndroid, "Android"),
            R(@"motorola|" + NotAlnum + @"moto[-_ ]?[gexz]", "Motorola", PhoneAndroid, "Android"),
            R(@"xperia", "Sony", PhoneAndroid, "Android"),
            R(@"vsmart|vinsmart", "VinSmart", PhoneAndroid, "Android"),
            R(@"infinix", "Infinix", PhoneAndroid, "Android"),
            R(@"tecno", "Tecno", PhoneAndroid, "Android"),
            R(NotAlnum + @"itel", "itel", PhoneAndroid, "Android"),
            R(@"zenfone|rog[-_ ]?phone", "ASUS", PhoneAndroid, "Android"),

            // ---- Laptop / PC ----
            R(@"vivobook|zenbook|rog[-_ ]?strix|tuf[-_ ]?gaming", "ASUS", "Laptop / PC", "Windows"),
            R(@"lenovo|thinkpad|ideapad|thinkcentre", "Lenovo", "Laptop / PC", "Windows"),
            R(@"latitude|inspiron|optiplex|" + NotAlnum + @"dell", "Dell", "Laptop / PC", "Windows"),
            R(@"^(desktop|laptop|win|pc|ws|workstation)[-_][a-z0-9]{3,}", "Microsoft Windows", "Windows PC / Server", "Windows"),

            // ---- Máy in ----
            R(NotAlnum + @"(hp|npi)[0-9a-f]{6}(?![0-9a-f])|laserjet|officejet|deskjet", "HP", "Máy in mạng", null),
            R(@"epson[0-9a-f]{0,6}", "Epson", "Máy in mạng", null),
            R(NotAlnum + @"(brn|brw)[0-9a-f]{12}|brother", "Brother", "Máy in mạng", null),
            R(@"canon|pixma", "Canon", "Máy in mạng", null),

            // ---- IoT / smart home ----
            R(NotAlnum + @"esp[-_ ]?(32|8266)|espressif", "Espressif", "Thiết bị IoT", "Thiết bị nhúng (IoT)"),
            R(@"tuya|smartlife", "Tuya", "Thiết bị IoT", "Thiết bị nhúng (IoT)"),
            R(@"yeelight", "Yeelight", "Thiết bị IoT", "Thiết bị nhúng (IoT)"),
            R(@"shelly", "Shelly", "Thiết bị IoT", "Thiết bị nhúng (IoT)"),
            R(@"sonoff|ewelink", "Sonoff", "Thiết bị IoT", "Thiết bị nhúng (IoT)"),
            R(@"philips[-_ ]?hue|hue[-_ ]?bridge", "Philips", "Thiết bị IoT", "Thiết bị nhúng (IoT)"),
            R(@"sonos", "Sonos", "Loa thông minh", null),

            // ---- Chỉ đoán được HĐH: Android đặt tên mặc định android-<16 hex> ----
            R(@"^android[-_][0-9a-f]{8,}", null, PhoneAndroid, "Android")
        };

        // Luật theo BANNER (Server / realm / title HTTP, dòng SERVER của SSDP, manufacturer/model UPnP)
        private static readonly List<Rule> BannerRules = new List<Rule>
        {
            R(@"hikvision|dnvrs-webs|app-webs", "Hikvision", "Camera / NVR", "Thiết bị nhúng (Camera)"),
            R(@"dahua|dh-(ipc|nvr|xvr)", "Dahua", "Camera / NVR", "Thiết bị nhúng (Camera)"),
            R(@"mikrotik|routeros", "MikroTik", "Router/Gateway", "Thiết bị nhúng (Router - RouterOS/Linux)"),
            R(@"synology|diskstation", "Synology", "NAS Storage", "Thiết bị nhúng (NAS - Linux)"),
            R(@"qnap", "QNAP", "NAS Storage", "Thiết bị nhúng (NAS - Linux)"),
            R(@"tp-?link|tl-(wr|mr)|archer", "TP-Link", "Router/Gateway (Wi-Fi)", "Thiết bị nhúng (Router - Linux)"),
            R(@"asuswrt|asustek|rt-(ac|ax)\d", "ASUS", "Router/Gateway (Wi-Fi)", "Thiết bị nhúng (Router - Linux)"),
            R(@"d-?link|dir-\d{3}", "D-Link", "Router/Gateway", "Thiết bị nhúng (Router - Linux)"),
            R(@"tenda", "Tenda", "Router/Gateway", "Thiết bị nhúng (Router - Linux)"),
            R(@"netgear", "Netgear", "Router/Gateway", "Thiết bị nhúng (Router - Linux)"),
            R(@"zyxel", "ZyXEL", "Router/Gateway", "Thiết bị nhúng (Router - Linux)"),
            R(@"zte|zxhn", "ZTE", "Router/Gateway (Modem quang)", "Thiết bị nhúng (Router - Linux)"),
            R(@"huawei|hg8\d{3}", "Huawei", "Router/Gateway (Modem quang)", "Thiết bị nhúng (Router - Linux)"),
            R(@"ubiquiti|unifi|ubnt", "Ubiquiti", "Access Point / Router", "Thiết bị nhúng (Linux)"),
            R(@"samsung", "Samsung", null, null),
            R(NotAlnum + @"lge(?![a-z])|webos", "LG", "Smart TV", "Thiết bị nhúng (Smart TV)"),
            R(@"bravia|sony", "Sony", null, null),
            R(@"roku", "Roku", "Smart TV / Thiết bị giải trí", "Thiết bị nhúng (Smart TV)"),
            R(@"airtunes|airplay|airport|apple", "Apple", null, null),
            R(@"sonos", "Sonos", "Loa thông minh", null),
            R(@"philips", "Philips", null, null),
            R(@"hp[ -]?(ethernet|laserjet|officejet)|hp-chai|hewlett", "HP", "Máy in mạng", null),
            R(@"epson", "Epson", "Máy in mạng", null),
            R(@"canon", "Canon", "Máy in mạng", null),
            R(@"brother", "Brother", "Máy in mạng", null),
            R(@"xerox", "Xerox", "Máy in mạng", null),
            R(@"ricoh", "Ricoh", "Máy in mạng", null),
            R(@"kyocera", "Kyocera", "Máy in mạng", null),
            R(@"lexmark", "Lexmark", "Máy in mạng", null),
            R(@"microsoft-windows|windows[-_ ]?\d", "Microsoft Windows", "Windows PC / Server", "Windows")
        };

        /// <summary>
        /// Suy đoán hãng. names: (nhãn nguồn, tên) theo thứ tự ưu tiên; banners: (nhãn nguồn, banner).
        /// manufacturer: giá trị &lt;manufacturer&gt; trong mô tả UPnP nếu có (đáng tin nhất).
        /// Trả về null nếu không có gợi ý nào.
        /// </summary>
        public static VendorGuess Infer(
            string manufacturer,
            IEnumerable<KeyValuePair<string, string>> names,
            IEnumerable<KeyValuePair<string, string>> banners)
        {
            // 1) Nhà sản xuất khai báo thẳng (UPnP)
            if (!string.IsNullOrWhiteSpace(manufacturer))
            {
                string b = DeviceClassifier.SimplifyVendorName(manufacturer);
                if (!string.IsNullOrEmpty(b) && b != "Không rõ")
                    return new VendorGuess { Brand = b, Source = "UPnP" };
            }

            // 2) Tên máy
            if (names != null)
            {
                foreach (var n in names)
                {
                    VendorGuess g = Match(NameRules, n.Value, n.Key);
                    if (g != null) return g;
                }
            }

            // 3) Banner
            if (banners != null)
            {
                foreach (var bn in banners)
                {
                    VendorGuess g = Match(BannerRules, bn.Value, bn.Key);
                    if (g != null) return g;
                }
            }
            return null;
        }

        private static VendorGuess Match(List<Rule> rules, string text, string source)
        {
            if (string.IsNullOrWhiteSpace(text) || text == "Không xác định" || text == "N/A") return null;
            foreach (Rule r in rules)
            {
                if (r.Pattern.IsMatch(text))
                {
                    return new VendorGuess { Brand = r.Brand, DeviceType = r.DeviceType, Os = r.Os, Source = source };
                }
            }
            return null;
        }
    }
}
