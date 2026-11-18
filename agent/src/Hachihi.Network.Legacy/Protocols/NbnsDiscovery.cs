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
    public static class NbnsDiscovery
    {
        public static async Task<Dictionary<string, string>> BulkDiscoverAsync(List<string> ipList, double timeoutSec = 1.5, CancellationToken token = default(CancellationToken))
        {
            Dictionary<string, string> results = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (ipList == null || ipList.Count == 0) return results;

            byte[] query = BuildNbnsQuery();

            try
            {
                using (UdpClient client = new UdpClient())
                {
                    client.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
                    client.Client.Bind(new IPEndPoint(IPAddress.Any, 0));

                    // Send queries to all hosts (this triggers ARP resolution implicitly by the OS kernel)
                    foreach (string ip in ipList)
                    {
                        try
                        {
                            IPAddress addr;
                            if (IPAddress.TryParse(ip, out addr))
                            {
                                IPEndPoint target = new IPEndPoint(addr, 137);
                                await client.SendAsync(query, query.Length, target).ConfigureAwait(false);
                            }
                        }
                        catch
                        {
                        }
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
                        string ip = res.RemoteEndPoint.Address.ToString();
                        if (!results.ContainsKey(ip))
                        {
                            string name = ParseNbnsResponse(res.Buffer);
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

        private static byte[] BuildNbnsQuery()
        {
            List<byte> bytes = new List<byte>();
            ushort transId = (ushort)(new Random().Next(1, 65535));

            // Header
            bytes.Add((byte)(transId >> 8));
            bytes.Add((byte)(transId & 0xFF));
            bytes.AddRange(new byte[] { 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 });

            // Wildcard NetBIOS name "*" padded to 16 spaces
            string name = "*               ";
            bytes.Add(0x20); // Length of first-level encoded name (32 bytes)
            for (int i = 0; i < 16; i++)
            {
                byte b = (byte)name[i];
                bytes.Add((byte)(((b >> 4) & 0x0F) + 0x41));
                bytes.Add((byte)((b & 0x0F) + 0x41));
            }
            bytes.Add(0x00); // Terminator

            // QTYPE: 0x0021 (NBSTAT), QCLASS: 0x0001 (IN)
            bytes.AddRange(new byte[] { 0x00, 0x21, 0x00, 0x01 });

            return bytes.ToArray();
        }

        private static string ParseNbnsResponse(byte[] data)
        {
            int[] baseOffsets = new int[] { 56, 24 };

            foreach (int baseOffset in baseOffsets)
            {
                try
                {
                    if (data.Length < baseOffset + 1) continue;
                    int numNames = data[baseOffset];
                    if (numNames <= 0 || numNames > 32) continue;

                    int offset = baseOffset + 1;
                    for (int i = 0; i < numNames; i++)
                    {
                        if (offset + 18 > data.Length) break;
                        byte[] rawNameBytes = new byte[15];
                        Buffer.BlockCopy(data, offset, rawNameBytes, 0, 15);
                        byte flag1 = data[offset + 16];
                        offset += 18;

                        string candidate = Encoding.ASCII.GetString(rawNameBytes).Trim();
                        if (string.IsNullOrEmpty(candidate) || !Regex.IsMatch(candidate, @"^[A-Za-z0-9_\-]+$"))
                            continue;

                        bool isGroup = (flag1 & 0x80) != 0;
                        if (!isGroup)
                        {
                            return candidate;
                        }
                    }
                }
                catch
                {
                }
            }
            return null;
        }
    }
}
