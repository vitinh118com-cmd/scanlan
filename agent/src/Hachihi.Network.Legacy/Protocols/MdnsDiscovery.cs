using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace HachihiNetworkScanner.Protocols
{
    public static class MdnsDiscovery
    {
        private static readonly IPEndPoint MdnsEndPoint = new IPEndPoint(IPAddress.Parse("224.0.0.251"), 5353);

        public static async Task<Dictionary<string, string>> DiscoverAsync(double timeoutSec = 2.5, CancellationToken token = default(CancellationToken))
        {
            Dictionary<string, string> results = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            try
            {
                using (UdpClient client = new UdpClient())
                {
                    client.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
                    client.Client.Bind(new IPEndPoint(IPAddress.Any, 5353));
                    client.JoinMulticastGroup(IPAddress.Parse("224.0.0.251"));

                    byte[] query = BuildMdnsQuery("_services._dns-sd._udp.local", 12);
                    await client.SendAsync(query, query.Length, MdnsEndPoint).ConfigureAwait(false);

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
                        if (!results.ContainsKey(ip))
                        {
                            string name = ExtractReadableName(res.Buffer);
                            if (!string.IsNullOrEmpty(name))
                            {
                                results[ip] = name;
                            }
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
        /// Tra ngược mDNS (PTR d.c.b.a.in-addr.arpa) gửi unicast tới cổng 5353 của từng máy.
        /// iPhone/iPad/Mac (và nhiều thiết bị Apple, TV, máy in) trả về tên máy dạng "Minhs-iPhone.local",
        /// nhờ đó nhận ra hãng ngay cả khi điện thoại dùng MAC ngẫu nhiên. Android thường không trả lời.
        /// Trả về: IP -> tên máy (đã bỏ hậu tố .local).
        /// </summary>
        public static async Task<Dictionary<string, string>> ReverseLookupAsync(IEnumerable<string> ips, double timeoutSec = 1.5, CancellationToken token = default(CancellationToken))
        {
            Dictionary<string, string> results = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (ips == null) return results;

            try
            {
                using (UdpClient client = new UdpClient())
                {
                    client.Client.Bind(new IPEndPoint(IPAddress.Any, 0));

                    foreach (string ip in ips)
                    {
                        if (token.IsCancellationRequested) break;
                        IPAddress addr;
                        if (!IPAddress.TryParse(ip, out addr) || addr.AddressFamily != AddressFamily.InterNetwork) continue;

                        byte[] a = addr.GetAddressBytes();
                        string qname = a[3] + "." + a[2] + "." + a[1] + "." + a[0] + ".in-addr.arpa";
                        byte[] query = BuildMdnsQuery(qname, 12);
                        try { await client.SendAsync(query, query.Length, new IPEndPoint(addr, 5353)).ConfigureAwait(false); }
                        catch { }
                    }

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
                        string fromIp = res.RemoteEndPoint.Address.ToString();
                        if (results.ContainsKey(fromIp)) continue;

                        string host = ParseHostname(res.Buffer);
                        if (!string.IsNullOrEmpty(host)) results[fromIp] = host;
                    }
                }
            }
            catch
            {
            }
            return results;
        }

        // Lấy tên máy từ gói trả lời DNS/mDNS: ưu tiên đích của bản ghi PTR, sau đó tên của bản ghi A/AAAA.
        private static string ParseHostname(byte[] buf)
        {
            try
            {
                if (buf == null || buf.Length < 12) return null;
                int qd = (buf[4] << 8) | buf[5];
                int rrCount = ((buf[6] << 8) | buf[7]) + ((buf[8] << 8) | buf[9]) + ((buf[10] << 8) | buf[11]);
                if (rrCount > 64) rrCount = 64;

                int pos = 12;
                for (int i = 0; i < qd; i++)
                {
                    int nx;
                    if (ReadDnsName(buf, pos, out nx) == null) return null;
                    pos = nx + 4;
                }

                for (int i = 0; i < rrCount; i++)
                {
                    int nx;
                    string rrName = ReadDnsName(buf, pos, out nx);
                    if (rrName == null || nx + 10 > buf.Length) return null;

                    int type = (buf[nx] << 8) | buf[nx + 1];
                    int rdLen = (buf[nx + 8] << 8) | buf[nx + 9];
                    int rdata = nx + 10;
                    if (rdata + rdLen > buf.Length) return null;

                    string candidate = null;
                    if (type == 12)
                    {
                        int n2;
                        candidate = CleanHostname(ReadDnsName(buf, rdata, out n2));
                    }
                    else if (type == 1 || type == 28)
                    {
                        candidate = CleanHostname(rrName);
                    }
                    if (candidate != null) return candidate;

                    pos = rdata + rdLen;
                }
            }
            catch
            {
            }
            return null;
        }

        private static string CleanHostname(string name)
        {
            if (string.IsNullOrEmpty(name)) return null;
            string n = name.Trim().TrimEnd('.');
            if (n.EndsWith(".local", StringComparison.OrdinalIgnoreCase)) n = n.Substring(0, n.Length - 6);
            if (n.Length == 0 || n.StartsWith("_") || n.EndsWith("arpa", StringComparison.OrdinalIgnoreCase)) return null;
            return n.Length > 64 ? n.Substring(0, 64) : n;
        }

        // Đọc một tên DNS có nén con trỏ; next = vị trí ngay sau tên (tại chỗ ban đầu, không theo con trỏ).
        private static string ReadDnsName(byte[] buf, int pos, out int next)
        {
            StringBuilder sb = new StringBuilder();
            int p = pos;
            int jumps = 0;
            next = -1;

            while (true)
            {
                if (p >= buf.Length) return null;
                int len = buf[p];

                if (len == 0)
                {
                    if (next < 0) next = p + 1;
                    break;
                }
                if ((len & 0xC0) == 0xC0)
                {
                    if (p + 1 >= buf.Length) return null;
                    if (next < 0) next = p + 2;
                    int ptr = ((len & 0x3F) << 8) | buf[p + 1];
                    if (++jumps > 20 || ptr >= buf.Length) return null;
                    p = ptr;
                    continue;
                }
                if ((len & 0xC0) != 0 || p + 1 + len > buf.Length) return null;

                if (sb.Length > 0) sb.Append('.');
                sb.Append(Encoding.UTF8.GetString(buf, p + 1, len));
                if (sb.Length > 255) return null;
                p += 1 + len;
            }
            return sb.ToString();
        }

        private static byte[] BuildMdnsQuery(string qname, ushort qtype)
        {
            List<byte> bytes = new List<byte>();
            // Header: ID=0, Flags=0, QDCOUNT=1, ANCOUNT=0, NSCOUNT=0, ARCOUNT=0
            bytes.AddRange(new byte[] { 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0 });

            // Encode DNS Name
            string[] parts = qname.Trim('.').Split('.');
            foreach (string p in parts)
            {
                byte[] pBytes = Encoding.UTF8.GetBytes(p);
                bytes.Add((byte)pBytes.Length);
                bytes.AddRange(pBytes);
            }
            bytes.Add(0); // End of name

            // QTYPE (12 = PTR) and QCLASS (1 = IN)
            bytes.Add((byte)(qtype >> 8));
            bytes.Add((byte)(qtype & 0xFF));
            bytes.Add(0);
            bytes.Add(1);

            return bytes.ToArray();
        }

        private static string ExtractReadableName(byte[] rawPacket)
        {
            string ascii = Encoding.ASCII.GetString(rawPacket);
            MatchCollection matches = Regex.Matches(ascii, @"[ -~]{4,64}");
            string[] noiseWords = new string[] { "_tcp", "_udp", "local", "_dns-sd", "_services", "in-addr", "arpa" };

            foreach (Match m in matches)
            {
                string run = m.Value;
                string[] parts = run.Split('.');
                foreach (string s in parts)
                {
                    string trimmed = s.Trim(' ', '\0');
                    if (trimmed.Length < 3 || trimmed.StartsWith("_") || !Regex.IsMatch(trimmed, @"[A-Za-z]"))
                        continue;

                    bool isNoise = false;
                    string lower = trimmed.ToLowerInvariant();
                    foreach (string w in noiseWords)
                    {
                        if (lower.Contains(w)) { isNoise = true; break; }
                    }
                    if (!isNoise) return trimmed;
                }
            }
            return null;
        }
    }
}
