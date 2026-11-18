using System;
using System.Collections.Generic;
using System.Net;
using System.IO;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace HachihiNetworkScanner.Protocols
{
    /// <summary>Thông tin một thiết bị trả lời SSDP.</summary>
    public class SsdpInfo
    {
        public string Text = "";       // SERVER (hoặc ST nếu không có SERVER) - tương thích kiểu cũ
        public string Server = "";
        public string Location = "";   // URL mô tả thiết bị UPnP
    }

    /// <summary>Một số trường của mô tả UPnP (device description XML).</summary>
    public class UpnpDescription
    {
        public string Manufacturer = "", ModelName = "", FriendlyName = "";
    }

    public static class SsdpDiscovery
    {
        private static readonly IPEndPoint SsdpEndPoint = new IPEndPoint(IPAddress.Parse("239.255.255.250"), 1900);

        /// <summary>Giữ nguyên API cũ: IP -> dòng SERVER (hoặc ST).</summary>
        public static async Task<Dictionary<string, string>> DiscoverAsync(double timeoutSec = 2.5, CancellationToken token = default(CancellationToken))
        {
            Dictionary<string, SsdpInfo> detailed = await DiscoverDetailedAsync(timeoutSec, token).ConfigureAwait(false);
            Dictionary<string, string> simple = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var kvp in detailed) simple[kvp.Key] = kvp.Value.Text;
            return simple;
        }

        public static async Task<Dictionary<string, SsdpInfo>> DiscoverDetailedAsync(double timeoutSec = 2.5, CancellationToken token = default(CancellationToken))
        {
            Dictionary<string, SsdpInfo> results = new Dictionary<string, SsdpInfo>(StringComparer.OrdinalIgnoreCase);

            try
            {
                using (UdpClient client = new UdpClient())
                {
                    client.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
                    client.Client.Bind(new IPEndPoint(IPAddress.Any, 0));

                    string msg = "M-SEARCH * HTTP/1.1\r\n" +
                                 "HOST: 239.255.255.250:1900\r\n" +
                                 "MAN: \"ssdp:discover\"\r\n" +
                                 "MX: 2\r\n" +
                                 "ST: ssdp:all\r\n\r\n";
                    byte[] data = Encoding.UTF8.GetBytes(msg);
                    await client.SendAsync(data, data.Length, SsdpEndPoint).ConfigureAwait(false);

                    DateTime endTime = DateTime.UtcNow.AddSeconds(timeoutSec);
                    while (DateTime.UtcNow < endTime && !token.IsCancellationRequested)
                    {
                        TimeSpan remaining = endTime - DateTime.UtcNow;
                        if (remaining <= TimeSpan.Zero) break;

                        Task<UdpReceiveResult> receiveTask = client.ReceiveAsync();
                        Task timeoutTask = Task.Delay(remaining, token);

                        Task completed = await Task.WhenAny(receiveTask, timeoutTask).ConfigureAwait(false);
                        if (completed != receiveTask) break;

                        UdpReceiveResult res = receiveTask.Result;
                        string ip = res.RemoteEndPoint.Address.ToString();
                        string text = Encoding.UTF8.GetString(res.Buffer);

                        Match sm = Regex.Match(text, @"(?im)^SERVER:\s*(.+)$");
                        Match lm = Regex.Match(text, @"(?im)^LOCATION:\s*(.+)$");
                        Match stm = Regex.Match(text, @"(?im)^ST:\s*(.+)$");

                        SsdpInfo info;
                        if (!results.TryGetValue(ip, out info))
                        {
                            if (sm.Success || stm.Success)
                            {
                                info = new SsdpInfo();
                                string val = (sm.Success ? sm : stm).Groups[1].Value.Trim();
                                if (val.Length > 80) val = val.Substring(0, 80);
                                info.Text = val;
                                if (sm.Success) info.Server = sm.Groups[1].Value.Trim();
                                results[ip] = info;
                            }
                        }
                        // thiết bị có thể trả lời nhiều lần (mỗi ST một gói): lấy LOCATION đầu tiên xuất hiện
                        if (info != null && info.Location.Length == 0 && lm.Success)
                        {
                            info.Location = lm.Groups[1].Value.Trim();
                        }
                    }
                }
            }
            catch
            {
            }

            return results;
        }

        /// <summary>
        /// Tải mô tả UPnP (manufacturer / modelName / friendlyName). Chỉ chấp nhận URL http trỏ đúng IP thiết bị đã trả lời,
        /// để một gói SSDP giả không thể khiến máy quét gọi sang địa chỉ khác.
        /// </summary>
        public static async Task<UpnpDescription> FetchDescriptionAsync(string location, string expectedIp, int timeoutMs = 1500)
        {
            try
            {
                Uri uri;
                if (!Uri.TryCreate(location, UriKind.Absolute, out uri)) return null;
                if (uri.Scheme != Uri.UriSchemeHttp) return null;
                if (!string.Equals(uri.Host, expectedIp, StringComparison.OrdinalIgnoreCase)) return null;

                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(uri);
                req.Proxy = null;
                req.Timeout = timeoutMs;
                req.ReadWriteTimeout = timeoutMs;
                req.UserAgent = HachihiNetworkScanner.Core.AppInfo.UserAgent + " UPnP/1.0";

                Task<UpnpDescription> work = ReadDescriptionAsync(req);
                if (await Task.WhenAny(work, Task.Delay(timeoutMs + 500)).ConfigureAwait(false) != work)
                {
                    try { req.Abort(); } catch { }
                    return null;
                }
                return work.Result;
            }
            catch
            {
                return null;
            }
        }

        private static async Task<UpnpDescription> ReadDescriptionAsync(HttpWebRequest req)
        {
            try
            {
                using (WebResponse resp = await req.GetResponseAsync().ConfigureAwait(false))
                using (Stream st = resp.GetResponseStream())
                {
                    byte[] buf = new byte[65536];
                    int total = 0, n;
                    while (total < buf.Length &&
                           (n = await st.ReadAsync(buf, total, buf.Length - total).ConfigureAwait(false)) > 0)
                    {
                        total += n;
                    }
                    string xml = Encoding.UTF8.GetString(buf, 0, total);
                    UpnpDescription d = new UpnpDescription();
                    d.Manufacturer = XmlTag(xml, "manufacturer");
                    d.ModelName = XmlTag(xml, "modelName");
                    d.FriendlyName = XmlTag(xml, "friendlyName");
                    return d;
                }
            }
            catch
            {
                return null;
            }
        }

        private static string XmlTag(string xml, string tag)
        {
            Match m = Regex.Match(xml, "<" + tag + @">\s*([^<]{1,120}?)\s*</" + tag + ">", RegexOptions.IgnoreCase);
            return m.Success ? WebUtility.HtmlDecode(m.Groups[1].Value) : "";
        }
    }
}
