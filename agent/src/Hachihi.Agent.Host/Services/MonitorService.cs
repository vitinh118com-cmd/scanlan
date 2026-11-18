using System.Collections.Concurrent;
using System.Net;
using System.Text.RegularExpressions;
using Hachihi.Agent.Security;
using Hachihi.Agent.Transport;
using HachihiNetworkScanner.Protocols;

namespace Hachihi.Agent.Services;

public sealed class MonitorSession
{
    public string SessionId { get; init; } = Guid.NewGuid().ToString("N");
    public string Target { get; init; } = "";
    public int IntervalSec { get; init; }
    public bool KeepRunning { get; init; }
    public int Sent, Received, DowntimeSec;
    public double? LastRttMs;
    public bool? LastReachable;
    public CancellationTokenSource Cts { get; } = new();
    public DateTime StartedAt { get; } = DateTime.UtcNow;
}

/// <summary>Giám sát ping. Mặc định dừng khi không còn tab nào kết nối (không chạy nền ngầm). KeepRunning cần người dùng đồng ý rõ.</summary>
public sealed class MonitorService
{
    private static readonly Regex HostRx = new(@"^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$", RegexOptions.Compiled);
    private readonly ConcurrentDictionary<string, MonitorSession> _sessions = new();
    private readonly EventHub _hub;
    private readonly AgentOptions _opt;

    public MonitorService(EventHub hub, AgentOptions opt) { _hub = hub; _opt = opt; }

    public MonitorSession Start(MonitorRequest req)
    {
        if (_sessions.Count >= _opt.MaxMonitorSessions) throw new ApiError(429, "MONITOR_LIMIT", "Đã đạt số phiên giám sát tối đa.", true);
        if (req.IntervalSec is not (1 or 5 or 10 or 30)) throw new ApiError(400, "INTERVAL_INVALID", "Chu kỳ phải là 1, 5, 10 hoặc 30 giây.");
        var target = (req.Target ?? "").Trim();
        if (IPAddress.TryParse(target, out var ip))
        {
            if (TargetPolicy.IsForbidden(ip)) throw new ApiError(400, "TARGET_FORBIDDEN", "Địa chỉ đích bị chặn (loopback/multicast/link-local…).");
        }
        else if (!HostRx.IsMatch(target)) throw new ApiError(400, "TARGET_INVALID", "Đích phải là IP hoặc tên máy hợp lệ.");

        var s = new MonitorSession { Target = target, IntervalSec = req.IntervalSec, KeepRunning = req.KeepRunning };
        _sessions[s.SessionId] = s;
        _ = Task.Run(() => LoopAsync(s));
        return s;
    }

    private async Task LoopAsync(MonitorSession s)
    {
        var ct = s.Cts.Token;
        var timeoutMs = Math.Min(2000, s.IntervalSec * 1000 - 100 < 400 ? 400 : s.IntervalSec * 1000 - 100);
        try
        {
            while (!ct.IsCancellationRequested)
            {
                var t0 = DateTime.UtcNow;
                var r = await AsyncPingHelper.PingAsync(s.Target, timeoutMs);
                s.Sent++;
                bool ok = r != null && r.IsAlive;
                if (ok) { s.Received++; s.LastRttMs = r!.RttMs; } else { s.LastRttMs = null; s.DowntimeSec += s.IntervalSec; }
                s.LastReachable = ok;
                _hub.Publish("monitor.tick", s.SessionId, new
                {
                    s.Target, timestamp = DateTime.UtcNow, rttMs = s.LastRttMs, isReachable = ok, errorCode = ok ? null : "TIMEOUT",
                    sent = s.Sent, received = s.Received, lossPercent = Math.Round(100.0 * (s.Sent - s.Received) / s.Sent, 1),
                    downtimeSec = s.DowntimeSec
                });

                if (!s.KeepRunning && _hub.ClientCount == 0 && (DateTime.UtcNow - _hub.LastClientSeenUtc).TotalSeconds > 60) break;
                var wait = TimeSpan.FromSeconds(s.IntervalSec) - (DateTime.UtcNow - t0);
                if (wait > TimeSpan.Zero) await Task.Delay(wait, ct);
            }
        }
        catch (OperationCanceledException) { }
        finally { _sessions.TryRemove(s.SessionId, out _); _hub.Publish("agent.warning", s.SessionId, new { code = "MONITOR_STOPPED", s.Target }); }
    }

    public bool Stop(string id)
    {
        if (!_sessions.TryGetValue(id, out var s)) return false;
        s.Cts.Cancel();
        return true;
    }

    public IEnumerable<MonitorSession> All() => _sessions.Values;
}
