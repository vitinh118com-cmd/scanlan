using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using HachihiNetworkScanner.Core;

namespace Hachihi.Agent.Security;

/// <summary>Chính sách mục tiêu quét: chặn loopback/multicast/link-local/metadata, giới hạn CIDR, phân biệt LAN và public.</summary>
public static class TargetPolicy
{
    public static bool IsPrivateOrLocal(IPAddress ip)
    {
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (ip.AddressFamily == AddressFamily.InterNetworkV6)
            return ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal || (ip.GetAddressBytes()[0] & 0xFE) == 0xFC; // fc00::/7
        var b = ip.GetAddressBytes();
        return b[0] == 10 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168)
               || (b[0] == 100 && b[1] >= 64 && b[1] <= 127); // CGNAT
    }

    /// <summary>Địa chỉ không bao giờ được quét/kết nối: loopback, unspecified, multicast, broadcast, link-local (gồm 169.254.169.254).</summary>
    public static bool IsForbidden(IPAddress ip)
    {
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (IPAddress.IsLoopback(ip) || ip.Equals(IPAddress.Any) || ip.Equals(IPAddress.IPv6Any) || ip.Equals(IPAddress.Broadcast)) return true;
        if (ip.AddressFamily == AddressFamily.InterNetworkV6)
            return ip.IsIPv6Multicast || ip.IsIPv6LinkLocal;
        var b = ip.GetAddressBytes();
        return b[0] == 0 || b[0] >= 224 || (b[0] == 169 && b[1] == 254);
    }

    /// <summary>Địa chỉ public thật sự (không private, không đặc biệt) — dùng cho WAN check.</summary>
    public static bool IsPublicRoutable(IPAddress ip)
    {
        if (IsForbidden(ip) || IsPrivateOrLocal(ip)) return false;
        if (ip.AddressFamily == AddressFamily.InterNetwork)
        {
            var b = ip.GetAddressBytes();
            if (b[0] == 192 && b[1] == 0 && b[2] == 0) return false;               // 192.0.0.0/24
            if (b[0] == 192 && b[1] == 0 && b[2] == 2) return false;               // TEST-NET-1
            if (b[0] == 198 && (b[1] == 18 || b[1] == 19)) return false;           // benchmark
            if (b[0] == 198 && b[1] == 51 && b[2] == 100) return false;            // TEST-NET-2
            if (b[0] == 203 && b[1] == 0 && b[2] == 113) return false;             // TEST-NET-3
        }
        return true;
    }

    public static List<(uint net, uint bc, int plen)> LocalSubnets()
    {
        var list = new List<(uint, uint, int)>();
        foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (ni.OperationalStatus != OperationalStatus.Up || ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
            foreach (var ua in ni.GetIPProperties().UnicastAddresses)
            {
                if (ua.Address.AddressFamily != AddressFamily.InterNetwork || ua.IPv4Mask == null) continue;
                uint mask = NetworkUtils.IpToUInt(ua.IPv4Mask);
                int plen = 0; for (uint m = mask; (m & 0x80000000u) != 0; m <<= 1) plen++;
                if (plen < 8) continue;
                uint net = NetworkUtils.IpToUInt(ua.Address) & mask;
                list.Add((net, net | ~mask, plen));
            }
        }
        return list;
    }

    public sealed record CidrCheck(bool Ok, string? ErrorCode, string? Message, long Hosts, bool IsLocal);

    /// <summary>Kiểm tra CIDR cho LAN scan. Quy tắc: IPv4 hợp lệ, ≥ /16, không vùng cấm; trong subnet của máy hoặc dải private + người dùng xác nhận.</summary>
    public static CidrCheck CheckLanCidr(string? cidr, bool confirmedAuthorized, bool confirmLarge)
    {
        if (string.IsNullOrWhiteSpace(cidr) || !NetworkUtils.TryParseCidr(cidr!.Trim(), out var net, out var bc, out var plen))
            return new(false, "CIDR_INVALID", "CIDR IPv4 không hợp lệ (ví dụ 192.168.1.0/24).", 0, false);
        if (plen < 16)
            return new(false, "CIDR_TOO_LARGE", "Không quét dải lớn hơn /16.", 0, false);
        var first = new IPAddress(new[] { (byte)(net >> 24), (byte)(net >> 16), (byte)(net >> 8), (byte)net });
        var last = new IPAddress(new[] { (byte)(bc >> 24), (byte)(bc >> 16), (byte)(bc >> 8), (byte)bc });
        if (IsForbidden(first) || IsForbidden(last))
            return new(false, "CIDR_FORBIDDEN", "Dải địa chỉ thuộc vùng bị chặn (loopback, multicast, link-local…).", 0, false);

        long hosts = NetworkUtils.CountHosts(cidr);
        bool local = LocalSubnets().Any(s => net >= s.net && bc <= s.bc);
        if (!local)
        {
            if (!IsPrivateOrLocal(first) || !IsPrivateOrLocal(last))
                return new(false, "CIDR_PUBLIC_NOT_ALLOWED", "LAN Scanner chỉ quét subnet của máy hoặc dải private. Dùng 'Public Target Check' cho mục tiêu public.", hosts, false);
            if (!confirmedAuthorized)
                return new(false, "AUTHORIZATION_REQUIRED", "CIDR không thuộc subnet của máy — cần xác nhận bạn có quyền kiểm tra dải này.", hosts, false);
        }
        if (hosts > 1024 && !confirmLarge)
            return new(false, "LARGE_SCAN_CONFIRMATION_REQUIRED", $"Dải có {hosts} địa chỉ (> 1024) — cần xác nhận quét lớn.", hosts, local);
        return new(true, null, null, hosts, local);
    }
}
