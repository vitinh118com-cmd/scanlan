using System.Collections.Concurrent;
using Hachihi.Agent.Security;
using Hachihi.Agent.Transport;
using HachihiNetworkScanner.Core;
using HachihiNetworkScanner.Protocols;

namespace Hachihi.Agent.Services;

public sealed class CameraDto
{
    public string IpAddress { get; set; } = "";
    public string? MacAddress { get; set; }
    public string? Vendor { get; set; }
    public string? Hostname { get; set; }
    public string? Model { get; set; }
    public List<string> Protocols { get; set; } = new();   // bằng chứng: sadp | ssdp | mdns | port
    public List<int> ServicePorts { get; set; } = new();
    public string Confidence { get; set; } = "low";        // low | medium | high
    public string Kind { get; set; } = "camera/NVR (suy đoán)";
}

public sealed class CameraJob
{
    public string JobId { get; init; } = Guid.NewGuid().ToString("N");
    public string Status { get; set; } = "running";
    public DateTime StartedAt { get; } = DateTime.UtcNow;
    public readonly ConcurrentDictionary<string, CameraDto> Found = new();
    public CancellationTokenSource Cts { get; } = new();
}

/// <summary>
/// Camera Discovery: SADP + SSDP + mDNS + dò cổng đặc trưng. KHÔNG đăng nhập, KHÔNG thử mật khẩu mặc định, KHÔNG xem stream.
/// ONVIF WS-Discovery chưa có trong mã nguồn gốc → chưa triển khai (DEFER), không tuyên bố hỗ trợ.
/// </summary>
public sealed class CameraService
{
    private static readonly int[] ProbePorts = { 80, 443, 554, 8000, 8080, 8899, 37777 };
    private static readonly int[] StrongPorts = { 554, 8000, 8899, 37777 };
    private static readonly string[] Keywords = { "hikvision", "dahua", "onvif", "ipcamera", "ip camera", "ipc", "nvr", "dvr", "camera", "axis", "reolink", "uniview", "tiandy", "amcrest", "ezviz", "imou", "kbvision", "vivotek" };

    private readonly ConcurrentDictionary<string, CameraJob> _jobs = new();
    private readonly EventHub _hub;
    public CameraService(EventHub hub) { _hub = hub; }

    public CameraJob Start(CameraRequest req)
    {
        if (_jobs.Values.Count(j => j.Status == "running") >= 2) throw new ApiError(429, "CAMERA_JOB_LIMIT", "Đang có quá nhiều phiên dò camera.", true);
        if (!string.IsNullOrWhiteSpace(req.Cidr))
        {
            var chk = TargetPolicy.CheckLanCidr(req.Cidr, req.ConfirmedAuthorized, req.ConfirmLarge);
            if (!chk.Ok) throw new ApiError(chk.ErrorCode is "AUTHORIZATION_REQUIRED" or "LARGE_SCAN_CONFIRMATION_REQUIRED" ? 403 : 400, chk.ErrorCode!, chk.Message!);
        }
        var job = new CameraJob();
        _jobs[job.JobId] = job;
        while (_jobs.Count > 10) { var old = _jobs.Values.OrderBy(j => j.StartedAt).First(); _jobs.TryRemove(old.JobId, out _); }
        _ = Task.Run(() => RunAsync(job, req.Cidr?.Trim()));
        return job;
    }

    private void Add(CameraJob job, string ip, string proto, string? name = null, string? vendor = null)
    {
        var c = job.Found.GetOrAdd(ip, _ => new CameraDto { IpAddress = ip });
        lock (c)
        {
            if (!c.Protocols.Contains(proto)) c.Protocols.Add(proto);
            if (name != null && c.Hostname == null) c.Hostname = name;
            if (vendor != null && c.Vendor == null) c.Vendor = vendor;
        }
    }

    private async Task RunAsync(CameraJob job, string? cidr)
    {
        var ct = job.Cts.Token;
        try
        {
            var sadp = SadpDiscovery.DiscoverAsync(d =>
            {
                Add(job, d.IpAddress, "sadp", string.IsNullOrEmpty(d.Hostname) || d.Hostname == "Không xác định" ? null : d.Hostname,
                    string.IsNullOrEmpty(d.Brand) || d.Brand == "Không rõ" ? "Hikvision (SADP)" : d.Brand);
            }, ct);
            var ssdp = SsdpDiscovery.DiscoverDetailedAsync(3.0, ct);
            var mdns = MdnsDiscovery.DiscoverAsync(3.0, ct);
            await Task.WhenAll(sadp, ssdp, mdns);

            foreach (var kv in ssdp.Result)
                if (HasKeyword(kv.Value.Text)) Add(job, kv.Key, "ssdp", Trunc(kv.Value.Text));
            foreach (var kv in mdns.Result)
                if (HasKeyword(kv.Value)) Add(job, kv.Key, "mdns", kv.Value);

            // Dải CIDR tuỳ chọn: chỉ dò các cổng đặc trưng của camera/NVR (không đăng nhập).
            if (cidr != null)
            {
                var sem = new SemaphoreSlim(200);
                var ips = NetworkUtils.ExpandSubnet(cidr);
                var tasks = new List<Task>();
                foreach (var ip in ips)
                    foreach (var p in StrongPorts)
                    {
                        var (ipc, pc) = (ip, p);
                        tasks.Add(Task.Run(async () =>
                        {
                            if (ct.IsCancellationRequested) return;
                            if (await SocketProbe.CheckPortAsync(ipc, pc, 0.4, sem)) Add(job, ipc, "port");
                        }, ct));
                    }
                await Task.WhenAll(tasks);
            }

            // Hoàn thiện từng ứng viên: dò cổng, MAC/hãng, độ tin cậy.
            var psem = new SemaphoreSlim(64);
            var arp = NetworkUtils.LoadArpCache();
            foreach (var c in job.Found.Values.ToList())
            {
                if (ct.IsCancellationRequested) break;
                var results = await Task.WhenAll(ProbePorts.Select(async p => (p, ok: await SocketProbe.CheckPortAsync(c.IpAddress, p, 0.4, psem))));
                c.ServicePorts = results.Where(r => r.ok).Select(r => r.p).OrderBy(p => p).ToList();
                if (c.ServicePorts.Any(p => StrongPorts.Contains(p)) && !c.Protocols.Contains("port")) c.Protocols.Add("port");
                var mac = NetworkUtils.ResolveMac(c.IpAddress, arp);
                if (mac != "Không rõ") { c.MacAddress = mac; var brand = DeviceClassifier.GetBrand(mac); if (!string.IsNullOrEmpty(brand) && brand != "Không rõ" && c.Vendor == null) c.Vendor = brand; }
                c.Confidence = c.Protocols.Contains("sadp") || (c.Protocols.Contains("port") && c.Protocols.Count > 1) ? "high"
                             : c.Protocols.Contains("port") || c.Protocols.Contains("ssdp") || c.Protocols.Contains("mdns") ? "medium" : "low";
                _hub.Publish("camera.deviceFound", job.JobId, c);
            }
            // Ứng viên chỉ có "port" 80/443 đơn lẻ không thể xảy ra vì Strong ports là điều kiện thêm từ CIDR.
            job.Status = ct.IsCancellationRequested ? "cancelled" : "completed";
        }
        catch (Exception ex) { job.Status = "failed"; Logger.LogWarning("CameraService.Run", ex.Message); }
        _hub.Publish("scan.completed", job.JobId, new { kind = "camera", job.Status, found = job.Found.Count });
    }

    private static bool HasKeyword(string? s) => !string.IsNullOrEmpty(s) && Keywords.Any(k => s.Contains(k, StringComparison.OrdinalIgnoreCase));
    private static string Trunc(string s) => s.Length > 80 ? s[..80] : s;

    public CameraJob? Get(string id) => _jobs.TryGetValue(id, out var j) ? j : null;
    public bool Cancel(string id) { var j = Get(id); if (j == null) return false; j.Cts.Cancel(); return true; }
}
