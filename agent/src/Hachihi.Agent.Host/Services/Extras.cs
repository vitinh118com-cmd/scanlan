using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Cryptography.X509Certificates;
using Hachihi.Agent.Security;
using HachihiNetworkScanner.Core;

namespace Hachihi.Agent.Services;

/// <summary>Audit log cục bộ cho các thao tác quét có thể nhạy cảm (WAN/TLS). Không ghi token/mật khẩu.</summary>
public static class AuditLog
{
    private static readonly object L = new();
    public static void Write(string kind, string detail)
    {
        try
        {
            var path = Path.Combine(NetworkUtils.GetDataDirectory(), "audit.log");
            lock (L) File.AppendAllText(path, $"{DateTime.UtcNow:O}\t{kind}\t{detail}{Environment.NewLine}");
        }
        catch { }
    }
}

public static class Resolver
{
    /// <summary>Phân giải host → danh sách IP; ném ApiError nếu bất kỳ IP nào thuộc vùng cấm (chống DNS rebinding: kết nối trực tiếp tới IP đã kiểm tra).</summary>
    public static async Task<List<IPAddress>> ResolveCheckedAsync(string host, CancellationToken ct)
    {
        host = (host ?? "").Trim();
        if (host.Length == 0 || host.Length > 253) throw new ApiError(400, "TARGET_INVALID", "Đích không hợp lệ.");
        var ips = IPAddress.TryParse(host, out var lit) ? new[] { lit } : await Dns.GetHostAddressesAsync(host, ct);
        if (ips.Length == 0) throw new ApiError(404, "DNS_NO_RECORDS", "Không phân giải được tên miền.");
        foreach (var ip in ips)
            if (TargetPolicy.IsForbidden(ip)) throw new ApiError(400, "TARGET_FORBIDDEN", "Đích phân giải tới địa chỉ bị chặn (loopback/link-local/multicast/metadata…).");
        return ips.ToList();
    }
}

public static class TlsInspector
{
    public static async Task<object> InspectAsync(string host, IPAddress ip, int port, CancellationToken ct)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(6));
        try
        {
            using var tcp = new TcpClient();
            await tcp.ConnectAsync(ip, port, cts.Token);
            using var ssl = new SslStream(tcp.GetStream(), false, (_, _, _, _) => true); // chỉ ĐỌC chứng chỉ, không gửi dữ liệu nhạy cảm
            await ssl.AuthenticateAsClientAsync(new SslClientAuthenticationOptions { TargetHost = host }, cts.Token);
            var c = new X509Certificate2(ssl.RemoteCertificate!);
            return new
            {
                success = true, host, ip = ip.ToString(), port,
                tlsVersion = ssl.SslProtocol.ToString(),
                subject = c.Subject, issuer = c.Issuer,
                validFrom = c.NotBefore.ToUniversalTime(), validTo = c.NotAfter.ToUniversalTime(),
                daysRemaining = (int)Math.Floor((c.NotAfter.ToUniversalTime() - DateTime.UtcNow).TotalDays),
                selfSigned = c.Subject == c.Issuer,
                sha256 = c.GetCertHashString(System.Security.Cryptography.HashAlgorithmName.SHA256)
            };
        }
        catch (Exception ex)
        {
            return new { success = false, host, ip = ip.ToString(), port, error = ex is OperationCanceledException ? "TIMEOUT" : ex.GetType().Name };
        }
    }
}
