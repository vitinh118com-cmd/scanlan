using System.Collections.Concurrent;
using System.Net;
using System.Text.Json;
using Hachihi.Agent.Security;
using Hachihi.Agent.Services;
using Hachihi.Agent.Transport;
using HachihiNetworkScanner.Core;
using HachihiNetworkScanner.Engine;
using HachihiNetworkScanner.Wifi;

namespace Hachihi.Agent;

public static class Program
{
    public const string AgentVersion = "1.0.0";

    public static async Task<int> Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);
        var opt = builder.Configuration.GetSection("Agent").Get<AgentOptions>() ?? new AgentOptions();
        // Cho phép thêm origin qua biến môi trường HACHIHI_ALLOWED_ORIGINS (phân tách bằng dấu phẩy) — vd. domain riêng hachihi.vn.
        var extra = Environment.GetEnvironmentVariable("HACHIHI_ALLOWED_ORIGINS");
        if (!string.IsNullOrWhiteSpace(extra))
            opt.AllowedOrigins = opt.AllowedOrigins.Concat(extra.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)).ToArray();

        // BẮT BUỘC: chỉ listen loopback. Không bao giờ 0.0.0.0.
        builder.WebHost.ConfigureKestrel(k => k.Listen(IPAddress.Loopback, opt.Port));
        builder.Logging.ClearProviders();

        builder.Services.AddSingleton(opt);
        builder.Services.AddSingleton<PairingService>();
        builder.Services.AddSingleton<EventHub>();
        builder.Services.AddSingleton<ScanService>();
        builder.Services.AddSingleton<MonitorService>();
        builder.Services.AddSingleton<CameraService>();
        builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase);

        var app = builder.Build();
        app.UseWebSockets();
        var pairing = app.Services.GetRequiredService<PairingService>();
        var hub = app.Services.GetRequiredService<EventHub>();
        var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);

        // ---------- Middleware bảo mật: Host, Origin/CORS, PNA, rate limit, xác thực ----------
        var rate = new ConcurrentDictionary<string, (long window, int count)>();
        app.Use(async (ctx, next) =>
        {
            var corr = Guid.NewGuid().ToString("N")[..12];
            ctx.Items["corr"] = corr;
            var host = ctx.Request.Host.Host;
            var port = ctx.Request.Host.Port ?? 80;
            // Chống DNS rebinding / Host header attack: chỉ chấp nhận chính xác 127.0.0.1|localhost + cổng của Agent.
            if (port != opt.Port || !(host == "127.0.0.1" || host.Equals("localhost", StringComparison.OrdinalIgnoreCase)))
            { await Fail(ctx, 421, "HOST_NOT_ALLOWED", "Host header không hợp lệ."); return; }

            var origin = ctx.Request.Headers.Origin.ToString();
            var allowed = opt.IsOriginAllowed(origin);
            if (!string.IsNullOrEmpty(origin) && !allowed)
            { await Fail(ctx, 403, "ORIGIN_NOT_ALLOWED", "Origin chưa được đăng ký."); return; }

            if (allowed)
            {
                var h = ctx.Response.Headers;
                h["Access-Control-Allow-Origin"] = origin;     // origin chính xác, KHÔNG dùng '*'
                h["Vary"] = "Origin";
                h["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
                h["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS";
                h["Access-Control-Allow-Private-Network"] = "true";
                h["Access-Control-Max-Age"] = "120";
            }
            ctx.Response.Headers["Cache-Control"] = "no-store";
            ctx.Response.Headers["X-Content-Type-Options"] = "nosniff";

            if (ctx.Request.Method == "OPTIONS") { ctx.Response.StatusCode = 204; return; }

            // Mọi request thật (không phải OPTIONS) phải có Origin hợp lệ — chặn gọi trực tiếp từ script/ứng dụng khác không khai Origin.
            if (!allowed) { await Fail(ctx, 403, "ORIGIN_REQUIRED", "Thiếu Origin hợp lệ."); return; }

            // Rate limit: 600 request/phút/origin.
            var win = DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 60;
            var rc = rate.AddOrUpdate(origin, _ => (win, 1), (_, v) => v.window == win ? (win, v.count + 1) : (win, 1));
            if (rc.count > 600) { await Fail(ctx, 429, "RATE_LIMITED", "Quá nhiều yêu cầu.", retryable: true); return; }

            var path = ctx.Request.Path.Value ?? "";
            var open = path == "/api/v1/health" || path == "/api/v1/pair";
            if (!open && path != "/api/v1/events")
            {
                var auth = ctx.Request.Headers.Authorization.ToString();
                var token = auth.StartsWith("Bearer ", StringComparison.Ordinal) ? auth[7..] : null;
                if (!pairing.Validate(token, origin)) { await Fail(ctx, 401, "AGENT_NOT_PAIRED", "Chưa ghép cặp hoặc phiên đã hết hạn."); return; }
                ctx.Items["token"] = token;
            }

            try { await next(); }
            catch (ApiError e) { await Fail(ctx, e.Status, e.Code, e.Message, e.Retryable); }
            catch (OperationCanceledException) { /* client huỷ */ }
            catch (Exception ex)
            {
                Logger.LogWarning("Agent.Unhandled", ex.Message); // không trả stack trace cho UI
                await Fail(ctx, 500, "AGENT_INTERNAL_ERROR", "Agent gặp lỗi nội bộ.");
            }
        });

        var api = app.MapGroup("/api/v1");

        // ---------- Health (không lộ hostname/username/serial) ----------
        api.MapGet("/health", () => new
        {
            agentVersion = AgentVersion,
            protocolVersion = EventHub.ProtocolVersion,
            status = "ready",
            paired = pairing.IsPaired,
            platform = OperatingSystem.IsWindows() ? "windows" : OperatingSystem.IsLinux() ? "linux" : "other",
            // Chỉ công bố những gì Agent thực sự làm được trên hệ điều hành hiện tại (WiFi cần Native WLAN API của Windows).
            capabilities = new[]
            {
                "network.interfaces", "lan.scan", "camera.discovery", "monitor.ping", "network.wake", "tls.inspect", "wan.check"
            }.Concat(OperatingSystem.IsWindows() ? new[] { "wifi.snapshot", "wifi.survey" } : Array.Empty<string>())
        });

        // ---------- Pairing ----------
        api.MapPost("/pair", (HttpContext ctx, PairRequest req) =>
        {
            var origin = ctx.Request.Headers.Origin.ToString();
            var (token, err, retry) = pairing.TryPair(origin, req.Code);
            if (err != null)
                throw new ApiError(err == "PAIRING_LOCKED" ? 429 : 400, err,
                    err == "PAIRING_LOCKED" ? $"Sai quá nhiều lần. Thử lại sau {retry} giây." : "Mã ghép cặp không đúng.", err == "PAIRING_LOCKED");
            AuditLog.Write("pair", "origin=" + origin);
            return Results.Json(new { token, expiresInSec = opt.SessionHours * 3600 }, json);
        });
        api.MapPost("/session/revoke", (HttpContext ctx) =>
        {
            if (ctx.Items["token"] is string t) pairing.Revoke(t);
            return Results.NoContent();
        });

        // ---------- Network ----------
        api.MapGet("/network/interfaces", () => NetworkInfoService.Interfaces());
        api.MapPost("/network/wake", (WakeRequest r) =>
        {
            try { NetworkUtils.SendWakeOnLan(r.Mac ?? ""); }
            catch (ArgumentException e) { throw new ApiError(400, "MAC_INVALID", e.Message); }
            return Results.Accepted();
        });

        // ---------- LAN scan ----------
        var scans = app.Services.GetRequiredService<ScanService>();
        api.MapPost("/scans", (ScanRequest r) =>
        {
            var job = scans.Start(r);
            AuditLog.Write("lan.scan", $"cidr={job.Cidr} profile={job.Profile}");
            return Results.Json(new { scanId = job.ScanId, status = job.Status }, json, statusCode: 202);
        });
        api.MapGet("/scans/{id}", (string id, int? since) =>
        {
            var j = scans.Get(id) ?? throw new ApiError(404, "SCAN_NOT_FOUND", "Không tìm thấy phiên quét.");
            var (total, items) = scans.Page(j, since ?? 0);
            return new
            {
                scanId = j.ScanId, status = j.Status, processed = j.Processed, total = j.Total, devicesFound = total,
                startedAt = j.StartedAt, completedAt = j.CompletedAt, cidr = j.Cidr, profile = j.Profile,
                errorSummary = j.ErrorSummary, skippedSubnets = j.SkippedSubnets, devices = items, nextIndex = (since ?? 0) + items.Count
            };
        });
        api.MapPost("/scans/{id}/cancel", (string id) =>
            scans.Cancel(id) ? Results.Accepted() : throw new ApiError(404, "SCAN_NOT_FOUND", "Không tìm thấy phiên quét."));

        // ---------- Camera discovery ----------
        var cams = app.Services.GetRequiredService<CameraService>();
        api.MapPost("/discovery/cameras", (CameraRequest r) =>
        {
            var j = cams.Start(r);
            return Results.Json(new { jobId = j.JobId, status = j.Status }, json, statusCode: 202);
        });
        api.MapGet("/discovery/cameras/{id}", (string id) =>
        {
            var j = cams.Get(id) ?? throw new ApiError(404, "JOB_NOT_FOUND", "Không tìm thấy phiên dò camera.");
            return new { jobId = j.JobId, status = j.Status, cameras = j.Found.Values.OrderBy(c => c.IpAddress).ToList() };
        });
        api.MapPost("/discovery/cameras/{id}/cancel", (string id) =>
            cams.Cancel(id) ? Results.Accepted() : throw new ApiError(404, "JOB_NOT_FOUND", "Không tìm thấy phiên dò camera."));

        // ---------- WiFi (KHÔNG BAO GIỜ đọc mật khẩu / profile XML) ----------
        static void RequireWifi()
        {
            if (!OperatingSystem.IsWindows())
                throw new ApiError(501, "WIFI_UNSUPPORTED", "WiFi Analyzer cần Agent chạy trên Windows (Native WLAN API).");
        }
        api.MapGet("/wifi/snapshot", async (CancellationToken ct) =>
        { RequireWifi(); return new { capturedAt = DateTime.UtcNow, interfaces = await WifiReader.ReadAsync(false, ct) }; });
        api.MapPost("/wifi/survey", async (CancellationToken ct) =>
        { RequireWifi(); return new { capturedAt = DateTime.UtcNow, interfaces = await WifiReader.ReadAsync(true, ct) }; });

        // ---------- Monitor ----------
        var mon = app.Services.GetRequiredService<MonitorService>();
        api.MapPost("/monitor/sessions", (MonitorRequest r) =>
            Results.Json(new { sessionId = mon.Start(r).SessionId }, json, statusCode: 201));
        api.MapDelete("/monitor/sessions/{id}", (string id) =>
            mon.Stop(id) ? Results.NoContent() : throw new ApiError(404, "SESSION_NOT_FOUND", "Không tìm thấy phiên giám sát."));

        // ---------- TLS / WAN: chỉ chạy cục bộ, bắt buộc xác nhận quyền ----------
        api.MapPost("/tls/inspect", async (TlsRequest r, CancellationToken ct) =>
        {
            if (!r.ConfirmedAuthorized) throw new ApiError(403, "AUTHORIZATION_REQUIRED", "Cần xác nhận bạn có quyền kiểm tra mục tiêu này.");
            if (r.Port is < 1 or > 65535) throw new ApiError(400, "PORT_INVALID", "Cổng không hợp lệ.");
            var ips = await Resolver.ResolveCheckedAsync(r.Host ?? "", ct);
            AuditLog.Write("tls.inspect", $"host={r.Host} port={r.Port}");
            return await TlsInspector.InspectAsync(r.Host!.Trim(), ips[0], r.Port, ct);
        });

        var wanLimit = new SemaphoreSlim(1, 1);
        api.MapPost("/wan/check", async (WanRequest r, CancellationToken ct) =>
        {
            if (!r.ConfirmedAuthorized) throw new ApiError(403, "AUTHORIZATION_REQUIRED", "Cần xác nhận bạn sở hữu hoặc được ủy quyền kiểm tra mục tiêu này.");
            var ips = await Resolver.ResolveCheckedAsync(r.Target ?? "", ct);
            // Quét mục tiêu public: chặn private/reserved. Kiểm tra TẤT CẢ A/AAAA, kết nối thẳng tới IP đã kiểm tra (chống rebinding).
            if (ips.Any(i => !TargetPolicy.IsPublicRoutable(i)))
                throw new ApiError(400, "TARGET_NOT_PUBLIC", "Mục tiêu phân giải tới địa chỉ nội bộ/đặc biệt. 'Public Target Check' chỉ dành cho địa chỉ public.");
            var ports = (r.Ports is { Length: > 0 } ? r.Ports : new[] { 80, 443, 22, 21, 25, 3389, 8080, 8443 })
                .Where(p => p is >= 1 and <= 65535).Distinct().Take(20).ToArray();
            if (ports.Length == 0) throw new ApiError(400, "PORTS_INVALID", "Danh sách cổng không hợp lệ (tối đa 20 cổng).");
            if (!await wanLimit.WaitAsync(0, ct)) throw new ApiError(409, "WAN_BUSY", "Đang có một phiên kiểm tra khác.", true);
            try
            {
                var ip = ips.First(i => i.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork);
                AuditLog.Write("wan.check", $"target={r.Target} ip={ip} ports={string.Join(',', ports)}");
                var res = await new WanScanEngine().ScanPortsAsync(ip.ToString(), ports, 3000, null!);
                return new
                {
                    target = r.Target, resolved = ips.Select(i => i.ToString()).ToArray(), connectedTo = ip.ToString(),
                    results = res.Select(x => new { port = x.Port, state = x.State, service = x.ServiceName, latencyMs = x.LatencyMs > 0 ? x.LatencyMs : (double?)null, banner = x.Banner })
                };
            }
            finally { wanLimit.Release(); }
        });

        // ---------- WebSocket sự kiện ----------
        app.Map("/api/v1/events", async ctx =>
        {
            if (!ctx.WebSockets.IsWebSocketRequest) { await Fail(ctx, 400, "WS_REQUIRED", "Cần WebSocket."); return; }
            var token = ctx.Request.Query["session"].ToString();
            if (!pairing.Validate(token, ctx.Request.Headers.Origin.ToString())) { await Fail(ctx, 401, "AGENT_NOT_PAIRED", "Token không hợp lệ."); return; }
            using var ws = await ctx.WebSockets.AcceptWebSocketAsync();
            await hub.RunClientAsync(ws, ctx.RequestAborted);
        });

        // ---------- Giao diện điều khiển: hiện mã ghép cặp + địa chỉ ----------
        pairing.CodeChanged += c => PrintCode(c, opt);
        app.Lifetime.ApplicationStarted.Register(() => { PrintBanner(opt); PrintCode(pairing.CurrentCode, opt); });
        _ = Task.Run(async () => { while (true) { await Task.Delay(30_000); _ = pairing.CurrentCode; } }); // làm mới mã khi hết hạn

        await app.RunAsync();
        return 0;
    }

    private static async Task Fail(HttpContext ctx, int status, string code, string message, bool retryable = false)
    {
        if (ctx.Response.HasStarted) return;
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = "application/json";
        await ctx.Response.WriteAsync(JsonSerializer.Serialize(new
        {
            code, message, details = new { }, correlationId = ctx.Items["corr"] as string ?? "", retryable
        }, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }

    private static void PrintBanner(AgentOptions o)
    {
        Console.WriteLine("============================================================");
        Console.WriteLine($" HACHIHI AGENT v{AgentVersion}");
        Console.WriteLine($" Chỉ lắng nghe tại http://127.0.0.1:{o.Port} (loopback) — không mở ra mạng LAN/Internet.");
        Console.WriteLine(" Mở WebApp Hachihi rồi nhập mã ghép cặp bên dưới. Nhấn Ctrl+C để thoát.");
        Console.WriteLine(" Origin được phép: " + string.Join(", ", o.AllowedOrigins));
        Console.WriteLine("============================================================");
    }

    private static void PrintCode(string code, AgentOptions _) =>
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] MÃ GHÉP CẶP (dùng một lần, hiệu lực 5 phút): {code}");
}
