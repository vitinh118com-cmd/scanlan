using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using HachihiNetworkScanner.Core;
using HachihiNetworkScanner.Models;

namespace HachihiNetworkScanner.Protocols
{
    public static class SocketProbe
    {
        public static async Task<bool> CheckPortAsync(string ip, int port, double timeoutSec = 0.35, SemaphoreSlim semaphore = null)
        {
            if (semaphore != null)
                await semaphore.WaitAsync().ConfigureAwait(false);

            try
            {
                using (TcpClient client = new TcpClient())
                {
                    Task connectTask = client.ConnectAsync(ip, port);
                    Task timeoutTask = Task.Delay(TimeSpan.FromSeconds(timeoutSec));

                    Task completed = await Task.WhenAny(connectTask, timeoutTask).ConfigureAwait(false);
                    if (completed == connectTask && client.Connected)
                    {
                        return true;
                    }
                }
            }
            catch
            {
            }
            finally
            {
                if (semaphore != null)
                    semaphore.Release();
            }
            return false;
        }

        public static async Task<WanPortResult> CheckWanPortAsync(string target, string resolvedIp, int port, double timeoutSec = 2.5, CancellationToken token = default(CancellationToken))
        {
            if (token.IsCancellationRequested) return null;

            string serviceName = DeviceClassifier.GetServiceName(port, "Custom");
            DateTime startTime = DateTime.UtcNow;

            try
            {
                using (TcpClient client = new TcpClient())
                {
                    Task connectTask = client.ConnectAsync(resolvedIp, port);
                    Task timeoutTask = Task.Delay(TimeSpan.FromSeconds(timeoutSec), token);

                    Task completed = await Task.WhenAny(connectTask, timeoutTask).ConfigureAwait(false);
                    if (completed == timeoutTask)
                    {
                        return new WanPortResult
                        {
                            Port = port,
                            IsOpen = false,
                            State = "TIMEOUT",
                            Service = serviceName,
                            Latency = "-",
                            Banner = "-",
                            StatusReason = "Timeout / Bị lọc bởi Firewall (không phản hồi SYN)",
                            WinsockErrno = null
                        };
                    }

                    if (!client.Connected)
                    {
                        return new WanPortResult
                        {
                            Port = port,
                            IsOpen = false,
                            State = "CLOSED",
                            Service = serviceName,
                            Latency = "-",
                            Banner = "-",
                            StatusReason = "Đóng (Connection Refused)",
                            WinsockErrno = null
                        };
                    }

                    double latencyMs = (DateTime.UtcNow - startTime).TotalMilliseconds;
                    string latencyStr = string.Format("{0:F1} ms", latencyMs);
                    string banner = "Active Connection";

                    try
                    {
                        NetworkStream stream = client.GetStream();
                        stream.ReadTimeout = (int)(timeoutSec * 1000);
                        stream.WriteTimeout = (int)(timeoutSec * 1000);

                        if (Constants.HttpsWanPorts.Contains(port))
                        {
                            using (SslStream sslStream = new SslStream(stream, false, (s, cert, chain, err) => true))
                            {
                                await sslStream.AuthenticateAsClientAsync(target).ConfigureAwait(false);
                                byte[] req = Encoding.UTF8.GetBytes(string.Format("HEAD / HTTP/1.1\r\nHost: {0}\r\nUser-Agent: " + AppInfo.UserAgent + "\r\nConnection: close\r\n\r\n", target));
                                await sslStream.WriteAsync(req, 0, req.Length).ConfigureAwait(false);

                                byte[] buffer = new byte[2048];
                                int bytesRead = await sslStream.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false);
                                string resp = Encoding.UTF8.GetString(buffer, 0, bytesRead);
                                banner = ParseHttpBanner(resp) + " [TLS " + sslStream.SslProtocol + "]";
                            }
                        }
                        else if (Constants.HttpWanPorts.Contains(port))
                        {
                            byte[] req = Encoding.UTF8.GetBytes(string.Format("HEAD / HTTP/1.1\r\nHost: {0}\r\nUser-Agent: " + AppInfo.UserAgent + "\r\nConnection: close\r\n\r\n", target));
                            await stream.WriteAsync(req, 0, req.Length).ConfigureAwait(false);

                            byte[] buffer = new byte[2048];
                            int bytesRead = await stream.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false);
                            string resp = Encoding.UTF8.GetString(buffer, 0, bytesRead);
                            banner = ParseHttpBanner(resp);
                        }
                        else if (port == 22)
                        {
                            byte[] buffer = new byte[256];
                            int bytesRead = await stream.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false);
                            string text = Encoding.UTF8.GetString(buffer, 0, bytesRead).Trim();
                            banner = string.IsNullOrEmpty(text) ? "SSH Active" : text;
                            if (banner.Contains("OpenSSH")) banner = "OpenSSH Server";
                        }
                        else if (port == 8291)
                        {
                            banner = "MikroTik RouterOS Winbox";
                        }
                        else
                        {
                            banner = "Port Active";
                        }
                    }
                    catch
                    {
                        banner = "Active Connection (không lấy được banner chi tiết)";
                    }

                    return new WanPortResult
                    {
                        Port = port,
                        IsOpen = true,
                        State = "OPEN",
                        Service = serviceName,
                        Latency = latencyStr,
                        Banner = banner,
                        StatusReason = "OPEN (TCP Handshake thành công)",
                        WinsockErrno = 0
                    };
                }
            }
            catch (SocketException ex)
            {
                string state = ex.SocketErrorCode == SocketError.ConnectionRefused ? "CLOSED" : "FILTERED";
                string reason = ex.SocketErrorCode == SocketError.ConnectionRefused
                    ? "Đóng (Connection Refused)"
                    : "Bị lọc bởi Firewall (" + ex.SocketErrorCode + ")";

                return new WanPortResult
                {
                    Port = port,
                    IsOpen = false,
                    State = state,
                    Service = serviceName,
                    Latency = "-",
                    Banner = "-",
                    StatusReason = reason,
                    WinsockErrno = ex.ErrorCode
                };
            }
            catch (Exception)
            {
                return new WanPortResult
                {
                    Port = port,
                    IsOpen = false,
                    State = "FILTERED",
                    Service = serviceName,
                    Latency = "-",
                    Banner = "-",
                    StatusReason = "Lỗi không xác định",
                    WinsockErrno = null
                };
            }
        }

        /// <summary>Thông tin lấy được từ trang chủ HTTP(S) của thiết bị.</summary>
        public class HttpProbeInfo
        {
            public string Title = "";
            public string Server = "";   // header Server:
            public string Realm = "";    // realm trong WWW-Authenticate (thường ghi tên model thiết bị)
            public bool HasAny { get { return Title.Length > 0 || Server.Length > 0 || Realm.Length > 0; } }
        }

        public static async Task<string> GrabHttpTitleAsync(string ip, HashSet<int> openPorts, SemaphoreSlim semaphore = null)
        {
            HttpProbeInfo info = await GrabHttpInfoAsync(ip, openPorts, semaphore).ConfigureAwait(false);
            return info.Title;
        }

        public static async Task<HttpProbeInfo> GrabHttpInfoAsync(string ip, HashSet<int> openPorts, SemaphoreSlim semaphore = null)
        {
            HttpProbeInfo fallback = new HttpProbeInfo();

            foreach (var probe in Constants.HttpProbePorts)
            {
                int port = probe.Key;
                string scheme = probe.Value;
                if (!openPorts.Contains(port)) continue;

                if (semaphore != null)
                    await semaphore.WaitAsync().ConfigureAwait(false);

                try
                {
                    using (TcpClient client = new TcpClient())
                    {
                        Task connectTask = client.ConnectAsync(ip, port);
                        Task timeoutTask = Task.Delay(TimeSpan.FromSeconds(Constants.HttpTimeoutSec));

                        if (await Task.WhenAny(connectTask, timeoutTask).ConfigureAwait(false) != connectTask || !client.Connected)
                            continue;

                        Stream stream = client.GetStream();
                        if (scheme == "https")
                        {
                            SslStream sslStream = new SslStream(stream, false, (s, cert, chain, err) => true);
                            await sslStream.AuthenticateAsClientAsync(ip).ConfigureAwait(false);
                            stream = sslStream;
                        }

                        byte[] req = Encoding.UTF8.GetBytes(string.Format("GET / HTTP/1.1\r\nHost: {0}\r\nUser-Agent: " + AppInfo.UserAgent + "\r\nConnection: close\r\n\r\n", ip));
                        await stream.WriteAsync(req, 0, req.Length).ConfigureAwait(false);

                        byte[] buffer = new byte[4096];
                        int bytesRead = await stream.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false);
                        string text = Encoding.UTF8.GetString(buffer, 0, bytesRead);

                        HttpProbeInfo info = new HttpProbeInfo();

                        Match sm = Regex.Match(text, @"(?im)^Server:[ \t]*(.+?)\s*$");
                        if (sm.Success) info.Server = Clip(sm.Groups[1].Value, 80);

                        Match rm = Regex.Match(text, @"(?im)^WWW-Authenticate:.*?realm=""?([^"",\r\n]+)");
                        if (rm.Success) info.Realm = Clip(rm.Groups[1].Value.Trim(), 80);

                        Match m = Regex.Match(text, @"<title[^>]*>(.*?)</title>", RegexOptions.IgnoreCase | RegexOptions.Singleline);
                        if (m.Success)
                        {
                            string title = Regex.Replace(m.Groups[1].Value, @"\s+", " ").Trim();
                            info.Title = Clip(title, 80);
                        }

                        // Có tiêu đề -> dùng ngay (hành vi cũ). Chưa có thì giữ banner đầu tiên và thử cổng kế tiếp.
                        if (info.Title.Length > 0) return info;
                        if (!fallback.HasAny && info.HasAny) fallback = info;
                    }
                }
                catch
                {
                }
                finally
                {
                    if (semaphore != null)
                        semaphore.Release();
                }
            }
            return fallback;
        }

        private static string Clip(string s, int max)
        {
            if (s == null) return "";
            return s.Length > max ? s.Substring(0, max) : s;
        }

        private static string ParseHttpBanner(string resp)
        {
            if (string.IsNullOrEmpty(resp)) return "HTTP Active";
            if (resp.Contains("Apache")) return "Apache Server";
            if (resp.Contains("nginx")) return "Nginx Web Server";
            if (resp.Contains("Microsoft-IIS")) return "Microsoft IIS";
            if (resp.Contains("Synology")) return "Synology DSM Web";

            string[] lines = resp.Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            return lines.Length > 0 ? lines[0] : "HTTP Active";
        }
    }
}
