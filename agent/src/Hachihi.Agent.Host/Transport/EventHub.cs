using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace Hachihi.Agent.Transport;

/// <summary>Phát sự kiện tới các WebSocket đã xác thực. Mọi message có protocolVersion, eventId, timestamp, jobId.</summary>
public sealed class EventHub
{
    public const int ProtocolVersion = 1;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private sealed class Client { public required WebSocket Socket; public readonly SemaphoreSlim Gate = new(1, 1); }
    private readonly ConcurrentDictionary<Guid, Client> _clients = new();

    public int ClientCount => _clients.Count;
    public DateTime LastClientSeenUtc { get; private set; } = DateTime.UtcNow;

    public async Task RunClientAsync(WebSocket ws, CancellationToken ct)
    {
        var id = Guid.NewGuid();
        _clients[id] = new Client { Socket = ws };
        try
        {
            var buf = new byte[1024];
            while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                var r = await ws.ReceiveAsync(buf, ct); // chỉ để phát hiện đóng kết nối; bỏ qua dữ liệu client gửi
                LastClientSeenUtc = DateTime.UtcNow;
                if (r.MessageType == WebSocketMessageType.Close) break;
            }
        }
        catch { /* client rời đi */ }
        finally
        {
            _clients.TryRemove(id, out _);
            LastClientSeenUtc = DateTime.UtcNow;
            try { if (ws.State is WebSocketState.Open or WebSocketState.CloseReceived) await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None); } catch { }
        }
    }

    public void Publish(string type, string? jobId, object? data)
    {
        if (_clients.IsEmpty) return;
        var payload = JsonSerializer.SerializeToUtf8Bytes(new
        {
            protocolVersion = ProtocolVersion,
            eventId = Guid.NewGuid().ToString("N"),
            timestamp = DateTime.UtcNow,
            jobId,
            type,
            data
        }, Json);
        foreach (var c in _clients.Values) _ = SendAsync(c, payload);
    }

    private static async Task SendAsync(Client c, byte[] payload)
    {
        if (c.Socket.State != WebSocketState.Open) return;
        await c.Gate.WaitAsync();
        try { await c.Socket.SendAsync(payload, WebSocketMessageType.Text, true, CancellationToken.None); }
        catch { /* socket hỏng — vòng đọc sẽ dọn */ }
        finally { c.Gate.Release(); }
    }
}
