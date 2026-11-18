using System.Globalization;
using System.Text.RegularExpressions;
using HachihiNetworkScanner.Core;
using HachihiNetworkScanner.Models;

namespace Hachihi.Agent.Services;

/// <summary>Chuẩn hoá DeviceInfo (chuỗi tiếng Việt của bản WinForms) thành DTO trung lập cho Web.</summary>
public static partial class DeviceMapper
{
    [GeneratedRegex(@"(\d{1,5})\(([^)]*)\)")]
    private static partial Regex PortRx();

    private static string? Clean(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        var t = s.Trim();
        return t is "Không rõ" or "Không xác định" or "N/A" or "--" or "Xem ARP" ? null : t;
    }

    public static DeviceDto ToDto(DeviceInfo d, string? extraSource = null)
    {
        var dto = new DeviceDto
        {
            IpAddress = d.IpAddress,
            MacAddress = Clean(d.MacAddress),
            Hostname = Clean(d.Hostname),
            Vendor = Clean(d.Brand),
            DeviceType = d.DeviceType ?? "",
            OsGuess = Clean(d.OperatingSystem) is { } os ? os + " (suy đoán)" : null,
            HttpTitle = Clean(d.WebTitle),
            Note = Clean(d.Note),
        };

        foreach (Match m in PortRx().Matches(d.OpenPorts ?? ""))
            if (int.TryParse(m.Groups[1].Value, out var p))
                dto.OpenPorts.Add(new PortDto(p, "tcp", m.Groups[2].Value, "open"));

        var st = d.Status ?? "";
        dto.Status = st.Contains("Offline", StringComparison.OrdinalIgnoreCase) ? "offline" : "online";
        if (st.Contains("(Ping)")) dto.Source.Add("icmp");
        if (st.Contains("(TCP)") || dto.OpenPorts.Count > 0) dto.Source.Add("tcp");
        if (st.Contains("mDNS")) dto.Source.Add("mdns");
        if (st.Contains("SSDP")) dto.Source.Add("ssdp");
        if (st.Contains("ARP") || dto.MacAddress != null) dto.Source.Add("arp");
        if (extraSource != null) dto.Source.Add(extraSource);
        dto.Source = dto.Source.Distinct().ToList();

        if (double.TryParse(d.PingMs, NumberStyles.Float, CultureInfo.InvariantCulture, out var ms)) dto.PingMs = ms;

        if (dto.MacAddress != null && dto.MacAddress.Length >= 8)
            dto.MacRandomized = NetworkUtils.IsLocallyAdministeredMac(dto.MacAddress.Substring(0, 8));

        // Độ tin cậy phân loại là HEURISTIC, không phải khẳng định (spec §6.3).
        var t = dto.DeviceType;
        if (dto.MacRandomized || t.Contains("chưa rõ") || t.Contains("Khác") || t.Contains("ngẫu nhiên")) dto.ClassificationConfidence = "low";
        else if (dto.HttpTitle != null && dto.Vendor != null && dto.HttpTitle.Contains(dto.Vendor, StringComparison.OrdinalIgnoreCase)) dto.ClassificationConfidence = "high";
        else if (extraSource == "sadp") dto.ClassificationConfidence = "high";
        return dto;
    }
}
