using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

namespace HachihiNetworkScanner.Core
{
    public static class NetworkUtils
    {
        public static bool IsAdministrator()
        {
            try
            {
                System.Security.Principal.WindowsIdentity id = System.Security.Principal.WindowsIdentity.GetCurrent();
                return new System.Security.Principal.WindowsPrincipal(id).IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);
            }
            catch { return false; }
        }

        public static string GetDataDirectory()
        {
            try
            {
                string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
                string targetDir = Path.Combine(appData, "HachihiNetworkScanner");
                if (!Directory.Exists(targetDir))
                {
                    Directory.CreateDirectory(targetDir);
                }
                return targetDir;
            }
            catch
            {
                return AppDomain.CurrentDomain.BaseDirectory;
            }
        }

        public static string GetLocalIpAddress()
        {
            try
            {
                using (Socket socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, 0))
                {
                    socket.Connect("8.8.8.8", 80);
                    IPEndPoint endPoint = socket.LocalEndPoint as IPEndPoint;
                    if (endPoint != null)
                    {
                        return endPoint.Address.ToString();
                    }
                }
            }
            catch
            {
                // Fallback to NetworkInterfaces
                foreach (NetworkInterface ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus == OperationalStatus.Up &&
                        ni.NetworkInterfaceType != NetworkInterfaceType.Loopback)
                    {
                        foreach (UnicastIPAddressInformation ip in ni.GetIPProperties().UnicastAddresses)
                        {
                            if (ip.Address.AddressFamily == AddressFamily.InterNetwork)
                            {
                                return ip.Address.ToString();
                            }
                        }
                    }
                }
            }
            return "127.0.0.1";
        }

        public static string GetLocalSubnetPrefix()
        {
            string localIp = GetLocalIpAddress();
            string[] parts = localIp.Split('.');
            if (parts.Length == 4)
            {
                return string.Format("{0}.{1}.{2}.", parts[0], parts[1], parts[2]);
            }
            return null;
        }

        public static string GetDefaultGateway()
        {
            try
            {
                foreach (NetworkInterface ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus == OperationalStatus.Up &&
                        ni.NetworkInterfaceType != NetworkInterfaceType.Loopback)
                    {
                        IPInterfaceProperties props = ni.GetIPProperties();
                        foreach (GatewayIPAddressInformation gw in props.GatewayAddresses)
                        {
                            if (gw.Address.AddressFamily == AddressFamily.InterNetwork &&
                                !gw.Address.ToString().StartsWith("0.0.0.0"))
                            {
                                return gw.Address.ToString();
                            }
                        }
                    }
                }

                // Fallback: parse route print
                ProcessStartInfo psi = new ProcessStartInfo("route", "print -4 0.0.0.0")
                {
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                using (Process p = Process.Start(psi))
                {
                    string output = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(3000);
                    Match m = Regex.Match(output, @"0\.0\.0\.0\s+0\.0\.0\.0\s+(\d{1,3}(?:\.\d{1,3}){3})");
                    if (m.Success)
                    {
                        return m.Groups[1].Value;
                    }
                }
            }
            catch (Exception ex)
            {
                Logger.LogWarning("NetworkUtils.GetDefaultGateway", ex.Message);
            }
            return null;
        }

        // ---------- CIDR helpers (IPv4) ----------
        public static uint IpToUInt(IPAddress ip)
        {
            byte[] b = ip.GetAddressBytes();
            return ((uint)b[0] << 24) | ((uint)b[1] << 16) | ((uint)b[2] << 8) | (uint)b[3];
        }

        public static string UIntToIp(uint v)
        {
            return new IPAddress(new byte[] { (byte)(v >> 24), (byte)(v >> 16), (byte)(v >> 8), (byte)v }).ToString();
        }

        /// <summary>Phan tich "a.b.c.d/n". Tra ve false neu khong phai CIDR IPv4 hop le.</summary>
        public static bool TryParseCidr(string subnetStr, out uint network, out uint broadcast, out int prefixLen)
        {
            network = 0; broadcast = 0; prefixLen = 0;
            if (string.IsNullOrEmpty(subnetStr)) return false;
            int slash = subnetStr.IndexOf('/');
            if (slash <= 0) return false;

            IPAddress ip;
            if (!IPAddress.TryParse(subnetStr.Substring(0, slash).Trim(), out ip)) return false;
            if (ip.AddressFamily != AddressFamily.InterNetwork) return false;

            int n;
            if (!int.TryParse(subnetStr.Substring(slash + 1).Trim(), out n) || n < 0 || n > 32) return false;

            uint mask = n == 0 ? 0u : (uint.MaxValue << (32 - n));
            network = IpToUInt(ip) & mask;
            broadcast = network | ~mask;
            prefixLen = n;
            return true;
        }

        /// <summary>Khoang host quet duoc cua mot CIDR (bo network + broadcast, tru /31 va /32).</summary>
        private static void GetCidrHostRange(uint network, uint broadcast, int prefixLen, out uint first, out uint last)
        {
            if (prefixLen >= 31) { first = network; last = broadcast; }
            else { first = network + 1; last = broadcast - 1; }
        }

        /// <summary>So host cua mot dai (khong cat theo gioi han). Dang "192.168.1." = 254.</summary>
        public static long CountHosts(string subnetStr)
        {
            if (string.IsNullOrEmpty(subnetStr)) return 0;
            subnetStr = subnetStr.Trim();
            if (subnetStr.Contains("/"))
            {
                uint net, bc; int plen;
                if (!TryParseCidr(subnetStr, out net, out bc, out plen)) return 0;
                uint first, last;
                GetCidrHostRange(net, bc, plen, out first, out last);
                return (long)last - (long)first + 1;
            }
            return 254;
        }

        /// <summary>True neu dai CIDR lon hon gioi han Constants.MaxScanHosts (se bi cat).</summary>
        public static bool IsOversizedSubnet(string subnetStr)
        {
            return CountHosts(subnetStr) > Constants.MaxScanHosts;
        }

        /// <summary>IP co nam trong dai khong? Ho tro "192.168.1." va "10.0.0.0/22".</summary>
        public static bool SubnetContainsIp(string subnetStr, string ip)
        {
            if (string.IsNullOrEmpty(subnetStr) || string.IsNullOrEmpty(ip)) return false;
            subnetStr = subnetStr.Trim();
            if (subnetStr.Contains("/"))
            {
                uint net, bc; int plen;
                IPAddress addr;
                if (!TryParseCidr(subnetStr, out net, out bc, out plen)) return false;
                if (!IPAddress.TryParse(ip, out addr) || addr.AddressFamily != AddressFamily.InterNetwork) return false;
                uint v = IpToUInt(addr);
                return v >= net && v <= bc;
            }
            string prefix = subnetStr.EndsWith(".") ? subnetStr : subnetStr + ".";
            return ip.StartsWith(prefix);
        }

        /// <summary>
        /// Dai mang that cua may (theo subnet mask cua card mang), dang CIDR, vi du "10.0.0.0/22".
        /// Tra ve null neu khong doc duoc mask.
        /// </summary>
        public static string GetLocalSubnetCidr()
        {
            try
            {
                string localIp = GetLocalIpAddress();
                foreach (NetworkInterface ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up) continue;
                    foreach (UnicastIPAddressInformation ua in ni.GetIPProperties().UnicastAddresses)
                    {
                        if (ua.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                        if (ua.Address.ToString() != localIp) continue;
                        if (ua.IPv4Mask == null) continue;

                        uint mask = IpToUInt(ua.IPv4Mask);
                        int plen = 0;
                        for (uint m = mask; (m & 0x80000000u) != 0; m <<= 1) plen++;
                        if (plen <= 0 || plen > 32) return null;
                        uint net = IpToUInt(ua.Address) & mask;
                        return UIntToIp(net) + "/" + plen;
                    }
                }
            }
            catch (Exception ex)
            {
                Logger.LogWarning("NetworkUtils.GetLocalSubnetCidr", ex.Message);
            }
            return null;
        }

        public static List<string> ExpandSubnet(string subnetStr)
        {
            List<string> ips = new List<string>();
            if (string.IsNullOrEmpty(subnetStr)) return ips;
            subnetStr = subnetStr.Trim();
            if (subnetStr.Length == 0) return ips;

            if (subnetStr.Contains("/"))
            {
                uint net, bc; int plen;
                if (!TryParseCidr(subnetStr, out net, out bc, out plen))
                {
                    Logger.LogWarning("NetworkUtils.ExpandSubnet", "CIDR khong hop le: " + subnetStr);
                    return ips;
                }

                uint first, last;
                GetCidrHostRange(net, bc, plen, out first, out last);

                long count = (long)last - (long)first + 1;
                if (count > Constants.MaxScanHosts)
                {
                    Logger.LogWarning("NetworkUtils.ExpandSubnet",
                        subnetStr + " co " + count + " host, vuot gioi han " + Constants.MaxScanHosts + " -> chi quet phan dau.");
                    last = first + (uint)(Constants.MaxScanHosts - 1);
                }

                for (uint i = first; ; i++)
                {
                    ips.Add(UIntToIp(i));
                    if (i == last) break;
                }
                return ips;
            }

            if (!subnetStr.EndsWith("."))
            {
                subnetStr += ".";
            }

            for (int i = 1; i <= 254; i++)
            {
                ips.Add(subnetStr + i);
            }
            return ips;
        }

        public static bool ParseSubnetPrefixAndGateway(string subnetStr, out string prefix, out string gatewayIp)
        {
            prefix = null;
            gatewayIp = null;
            if (string.IsNullOrEmpty(subnetStr)) return false;
            subnetStr = subnetStr.Trim();
            if (subnetStr.Length == 0) return false;

            if (subnetStr.Contains("/"))
            {
                // Khong can liet ke ca dai (/16 = 65k dia chi) chi de lay dia chi dau tien.
                uint net, bc; int plen;
                if (!TryParseCidr(subnetStr, out net, out bc, out plen)) return false;
                uint first, last;
                GetCidrHostRange(net, bc, plen, out first, out last);

                gatewayIp = UIntToIp(first);
                string[] parts = gatewayIp.Split('.');
                prefix = string.Format("{0}.{1}.{2}.", parts[0], parts[1], parts[2]);
                return true;
            }

            if (!subnetStr.EndsWith("."))
                subnetStr += ".";

            prefix = subnetStr;
            gatewayIp = subnetStr + "1";
            return true;
        }

        [System.Runtime.InteropServices.DllImport("iphlpapi.dll", ExactSpelling = true)]
        public static extern int SendARP(int destIp, int srcIp, byte[] macAddr, ref int macAddrLen);

        public static string ResolveMac(string ip, Dictionary<string, string> fallbackCache = null)
        {
            if (string.IsNullOrEmpty(ip)) return "Không rõ";

            // 1. Try SendARP Win32 direct query (most accurate on Windows LAN)
            try
            {
                IPAddress ipAddress;
                if (IPAddress.TryParse(ip, out ipAddress) && ipAddress.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
                {
                    byte[] mac = new byte[6];
                    int len = mac.Length;
                    int dest = BitConverter.ToInt32(ipAddress.GetAddressBytes(), 0);
                    int res = SendARP(dest, 0, mac, ref len);
                    if (res == 0 && len == 6)
                    {
                        return string.Format("{0:X2}:{1:X2}:{2:X2}:{3:X2}:{4:X2}:{5:X2}",
                            mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
                    }
                }
            }
            catch
            {
            }

            // 2. Try Fallback ARP Cache table
            if (fallbackCache != null && fallbackCache.ContainsKey(ip) && !string.IsNullOrEmpty(fallbackCache[ip]))
            {
                return fallbackCache[ip];
            }

            return "Không rõ";
        }

        public static Dictionary<string, string> LoadArpCache()
        {
            Dictionary<string, string> cache = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("arp", "-a")
                {
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                using (Process p = Process.Start(psi))
                {
                    string output = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(4000);
                    MatchCollection matches = Regex.Matches(output, @"(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+([0-9a-fA-F:-]{11,20})");
                    foreach (Match m in matches)
                    {
                        string ip = m.Groups[1].Value;
                        string mac = m.Groups[2].Value.ToUpper().Replace("-", ":");
                        if (mac.Length >= 17 && !mac.StartsWith("FF:FF:FF"))
                        {
                            cache[ip] = mac;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Logger.LogWarning("NetworkUtils.LoadArpCache", ex.Message);
            }
            return cache;
        }

        public static bool IsLocallyAdministeredMac(string macPrefix)
        {
            try
            {
                if (string.IsNullOrEmpty(macPrefix)) return false;
                string firstOctetStr = macPrefix.Split(':')[0];
                int firstOctet = Convert.ToInt32(firstOctetStr, 16);
                return (firstOctet & 0x02) != 0;
            }
            catch
            {
                return false;
            }
        }

        public static void SendWakeOnLan(string macAddress)
        {
            if (string.IsNullOrEmpty(macAddress) || macAddress == "Không rõ" || macAddress == "Xem ARP")
            {
                throw new ArgumentException("Địa chỉ MAC không hợp lệ để gửi Wake-on-LAN.");
            }

            string cleanMac = Regex.Replace(macAddress, @"[^0-9A-Fa-f]", "");
            if (cleanMac.Length != 12)
            {
                throw new ArgumentException("Định dạng MAC phải đủ 12 ký tự hex (ví dụ: AA:BB:CC:DD:EE:FF).");
            }

            byte[] macBytes = new byte[6];
            for (int i = 0; i < 6; i++)
            {
                macBytes[i] = Convert.ToByte(cleanMac.Substring(i * 2, 2), 16);
            }

            byte[] magicPacket = new byte[102];
            for (int i = 0; i < 6; i++)
            {
                magicPacket[i] = 0xFF;
            }
            for (int i = 0; i < 16; i++)
            {
                Buffer.BlockCopy(macBytes, 0, magicPacket, 6 + (i * 6), 6);
            }

            using (UdpClient client = new UdpClient())
            {
                client.EnableBroadcast = true;
                client.Send(magicPacket, magicPacket.Length, new IPEndPoint(IPAddress.Broadcast, 9));
                client.Send(magicPacket, magicPacket.Length, new IPEndPoint(IPAddress.Broadcast, 7));
            }
        }
    }
}
