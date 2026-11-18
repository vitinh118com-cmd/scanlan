using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using HachihiNetworkScanner.Models;

namespace HachihiNetworkScanner.Protocols
{
    public static class SadpDiscovery
    {
        public static async Task DiscoverAsync(Action<DeviceInfo> onDeviceFound, CancellationToken token = default(CancellationToken))
        {
            string sadpPacket =
                "<?xml version=\"1.0\" encoding=\"utf-8\" ?>" +
                "<Probe><Uuid>00000000-0000-0000-0000-000000000000</Uuid>" +
                "<Types>Inquiry</Types></Probe>";

            byte[] data = Encoding.UTF8.GetBytes(sadpPacket);
            HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            try
            {
                using (UdpClient client = new UdpClient())
                {
                    client.EnableBroadcast = true;
                    client.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
                    client.Client.Bind(new IPEndPoint(IPAddress.Any, 0));

                    IPEndPoint broadcastEp = new IPEndPoint(IPAddress.Broadcast, 9988);
                    await client.SendAsync(data, data.Length, broadcastEp).ConfigureAwait(false);

                    DateTime endTime = DateTime.UtcNow.AddSeconds(2.0);
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
                        if (seen.Contains(ip)) continue;
                        seen.Add(ip);

                        string text = Encoding.UTF8.GetString(res.Buffer);
                        Match macMatch = Regex.Match(text, @"<MAC>(.*?)</MAC>", RegexOptions.IgnoreCase);
                        string mac = macMatch.Success ? macMatch.Groups[1].Value.ToUpper().Replace("-", ":") : "Xem ARP";

                        DeviceInfo dev = new DeviceInfo
                        {
                            IpAddress = ip,
                            MacAddress = mac,
                            Brand = "Hikvision",
                            OperatingSystem = "Thiết bị nhúng (Camera)",
                            DeviceType = "Camera / NVR (SADP)",
                            OpenPorts = "9988 (UDP)",
                            WebTitle = "",
                            Hostname = "Hikvision Device",
                            PingMs = "N/A",
                            Status = "Online (SADP)",
                            Note = ""
                        };

                        if (onDeviceFound != null)
                        {
                            onDeviceFound(dev);
                        }
                    }
                }
            }
            catch
            {
            }
        }
    }
}
