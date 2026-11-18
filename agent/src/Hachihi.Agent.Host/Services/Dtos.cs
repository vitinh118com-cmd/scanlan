namespace Hachihi.Agent.Services;

public sealed record PortDto(int Port, string Protocol, string Service, string State);

public sealed class DeviceDto
{
    public string IpAddress { get; set; } = "";
    public string? MacAddress { get; set; }
    public bool MacRandomized { get; set; }
    public string? Hostname { get; set; }
    public string? Vendor { get; set; }
    public string DeviceType { get; set; } = "";
    public string? OsGuess { get; set; }
    public string ClassificationConfidence { get; set; } = "medium"; // heuristic: low | medium | high
    public string Status { get; set; } = "online";                   // online | offline
    public double? PingMs { get; set; }
    public List<PortDto> OpenPorts { get; set; } = new();
    public string? HttpTitle { get; set; }
    public List<string> Source { get; set; } = new();
    public string? Note { get; set; }
}

public sealed record ScanRequest(string? Cidr, string? Profile, bool IncludeArpCache = true, bool IncludeHostname = true,
    bool IncludeCommonPorts = true, bool ConfirmedAuthorized = false, bool ConfirmLarge = false);

public sealed record CameraRequest(string? Cidr, bool ConfirmedAuthorized = false, bool ConfirmLarge = false);
public sealed record MonitorRequest(string? Target, int IntervalSec = 5, bool KeepRunning = false);
public sealed record PairRequest(string? Code);
public sealed record WakeRequest(string? Mac);
public sealed record TlsRequest(string? Host, int Port = 443, bool ConfirmedAuthorized = false);
public sealed record WanRequest(string? Target, int[]? Ports, bool ConfirmedAuthorized = false);

public sealed class ApiError : Exception
{
    public int Status { get; }
    public string Code { get; }
    public bool Retryable { get; }
    public ApiError(int status, string code, string message, bool retryable = false) : base(message) { Status = status; Code = code; Retryable = retryable; }
}
