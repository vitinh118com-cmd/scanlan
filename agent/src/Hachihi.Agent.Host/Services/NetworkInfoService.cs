using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using HachihiNetworkScanner.Core;

namespace Hachihi.Agent.Services;

public static class NetworkInfoService
{
    // interfaceId mờ: băm của NIC id + salt theo phiên chạy Agent, không để lộ MAC/GUID thật.
    private static readonly string Salt = Guid.NewGuid().ToString("N");
    private static string OpaqueId(NetworkInterface ni) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Salt + ni.Id)))[..16].ToLowerInvariant();

    public static List<object> Interfaces()
    {
        var res = new List<object>();
        foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (ni.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel) continue;
            var props = ni.GetIPProperties();
            var ua = props.UnicastAddresses.FirstOrDefault(a => a.Address.AddressFamily == AddressFamily.InterNetwork);
            string? cidr = null;
            if (ua?.IPv4Mask != null)
            {
                uint mask = NetworkUtils.IpToUInt(ua.IPv4Mask);
                int plen = 0; for (uint m = mask; (m & 0x80000000u) != 0; m <<= 1) plen++;
                cidr = NetworkUtils.UIntToIp(NetworkUtils.IpToUInt(ua.Address) & mask) + "/" + plen;
            }
            var gw = props.GatewayAddresses.FirstOrDefault(g => g.Address.AddressFamily == AddressFamily.InterNetwork && !g.Address.Equals(System.Net.IPAddress.Any))?.Address.ToString();
            res.Add(new
            {
                interfaceId = OpaqueId(ni),
                name = ni.Name,
                status = ni.OperationalStatus.ToString().ToLowerInvariant(),
                ipv4 = ua?.Address.ToString(),
                subnetCidr = cidr,
                gateway = gw,
                dnsServers = props.DnsAddresses.Where(d => d.AddressFamily == AddressFamily.InterNetwork).Select(d => d.ToString()).ToArray(),
                isWifi = ni.NetworkInterfaceType == NetworkInterfaceType.Wireless80211
            });
        }
        return res;
    }
}
