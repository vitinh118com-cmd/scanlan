using Hachihi.Agent.Security;
using Hachihi.Agent.Transport;
using HachihiNetworkScanner.Core;
using HachihiNetworkScanner.Engine;
using HachihiNetworkScanner.Models;

namespace Hachihi.Agent.Services;

public sealed class ScanJob
{
    public string ScanId { get; init; } = "";
    public string Status { get; set; } = "queued"; // queued|running|cancelling|completed|cancelled|failed
    public string Cidr { get; init; } = "";
    public string Profile { get; init; } = "";
    public int Processed { get; set; }
    public int Total { get; set; }
    public DateTime StartedAt { get; init; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }
    public string? ErrorSummary { get; set; }
    public List<string> SkippedSubnets { get; } = new();
    public readonly List<DeviceDto> Devices = new();
    public readonly object Lock = new();
}

public sealed class ScanService
{
    private readonly LanScanEngine _engine = new();
    private readonly EventHub _hub;
    private readonly Dictionary<string, ScanJob> _jobs = new();
    private readonly object _gate = new();
    private const int MaxKeptJobs = 20;

    public ScanService(EventHub hub) { _hub = hub; }

    public ScanJob Start(ScanRequest req)
    {
        var chk = TargetPolicy.CheckLanCidr(req.Cidr, req.ConfirmedAuthorized, req.ConfirmLarge);
        if (!chk.Ok) throw new ApiError(chk.ErrorCode == "AUTHORIZATION_REQUIRED" || chk.ErrorCode == "LARGE_SCAN_CONFIRMATION_REQUIRED" ? 403 : 400, chk.ErrorCode!, chk.Message!);

        var profile = (req.Profile ?? "normal").ToLowerInvariant();
        if (profile is not ("fast" or "normal" or "deep")) throw new ApiError(400, "PROFILE_INVALID", "Profile phải là fast, normal hoặc deep.");

        ScanJob job;
        lock (_gate)
        {
            if (_engine.IsScanning) throw new ApiError(409, "SCAN_ALREADY_RUNNING", "Đang có một phiên quét khác.", true);
            job = new ScanJob { ScanId = Guid.NewGuid().ToString("N"), Cidr = req.Cidr!.Trim(), Profile = profile };
            _jobs[job.ScanId] = job;
            while (_jobs.Count > MaxKeptJobs)
                _jobs.Remove(_jobs.Values.OrderBy(j => j.StartedAt).First().ScanId);
        }

        // Profile cấu hình bằng dữ liệu, không hard-code ở UI. Cổng nhanh luôn được dò để xác định "online".
        var ports = profile == "deep" && req.IncludeCommonPorts ? Constants.FullPorts : Constants.QuickPorts;
        Constants.ScanModes[profile] = new ScanMode(profile, profile, true, req.IncludeHostname, profile != "fast", ports);
        var arp = req.IncludeArpCache ? NetworkUtils.LoadArpCache() : new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        _ = Task.Run(() => RunAsync(job, profile, arp, req.IncludeArpCache));
        return job;
    }

    private async Task RunAsync(ScanJob job, string profile, Dictionary<string, string> arp, bool includeArpOffline)
    {
        job.Status = "running";
        _hub.Publish("scan.progress", job.ScanId, new { job.Processed, job.Total, status = job.Status });
        var lastProgress = DateTime.MinValue;
        var progress = new SyncProgress<ScanProgressReport>(r =>
        {
            if (r.SkippedSubnets != null) lock (job.Lock) job.SkippedSubnets.AddRange(r.SkippedSubnets);
            if (r.Total > 0) { job.Total = r.Total; job.Processed = Math.Min(r.Scanned, r.Total); }
            if (r.DiscoveredDevice != null) AddDevice(job, r.DiscoveredDevice);
            var now = DateTime.UtcNow;
            if ((now - lastProgress).TotalMilliseconds > 250)
            {
                lastProgress = now;
                _hub.Publish("scan.progress", job.ScanId, new { job.Processed, job.Total, devicesFound = job.Devices.Count, status = job.Status });
            }
        });
        try
        {
            await _engine.StartScanAsync(new List<string> { job.Cidr }, profile, arp, includeArpOffline, progress);
            job.Status = job.Status == "cancelling" ? "cancelled" : "completed";
        }
        catch (Exception ex)
        {
            job.Status = "failed";
            job.ErrorSummary = ex.GetType().Name; // không trả stack trace/chi tiết OS cho UI
            Logger.LogWarning("ScanService.Run", ex.Message);
        }
        job.CompletedAt = DateTime.UtcNow;
        if (job.Status == "completed") job.Processed = job.Total;
        _hub.Publish(job.Status == "failed" ? "scan.failed" : "scan.completed", job.ScanId,
            new { job.Status, job.Processed, job.Total, devicesFound = job.Devices.Count, job.ErrorSummary });
    }

    private void AddDevice(ScanJob job, DeviceInfo d)
    {
        var src = d.Note != null && d.Note.Contains("SADP", StringComparison.OrdinalIgnoreCase) ? "sadp" : null;
        var dto = DeviceMapper.ToDto(d, src);
        lock (job.Lock)
        {
            var idx = job.Devices.FindIndex(x => x.IpAddress == dto.IpAddress);
            if (idx >= 0)
            {
                if (job.Devices[idx].Vendor == null && dto.Vendor != null) job.Devices[idx] = dto; else return;
            }
            else job.Devices.Add(dto);
        }
        _hub.Publish("scan.deviceFound", job.ScanId, dto);
    }

    public ScanJob? Get(string id) { lock (_gate) return _jobs.TryGetValue(id, out var j) ? j : null; }

    public bool Cancel(string id)
    {
        var j = Get(id);
        if (j == null) return false;
        if (j.Status is "running" or "queued") { j.Status = "cancelling"; _engine.StopScan(); }
        return true;
    }

    public (int total, List<DeviceDto> items) Page(ScanJob j, int since)
    {
        lock (j.Lock) return (j.Devices.Count, j.Devices.Skip(Math.Max(0, since)).ToList());
    }
}

/// <summary>IProgress đồng bộ (Progress&lt;T&gt; mặc định post lên SynchronizationContext — không cần trong service nền).</summary>
public sealed class SyncProgress<T> : IProgress<T>
{
    private readonly Action<T> _h;
    public SyncProgress(Action<T> h) { _h = h; }
    public void Report(T value) { try { _h(value); } catch { } }
}
