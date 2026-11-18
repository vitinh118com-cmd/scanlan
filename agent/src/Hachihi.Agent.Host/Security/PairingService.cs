using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace Hachihi.Agent.Security;

/// <summary>
/// Ghép cặp Web ↔ Agent. Mã 6 số hiển thị TRÊN CỬA SỔ AGENT (người dùng phải nhìn thấy máy mình) và dùng một lần;
/// sai 5 lần thì khoá 60 giây và đổi mã. Token phiên: 256-bit ngẫu nhiên, chỉ giữ trong bộ nhớ, có hạn, thu hồi được.
/// </summary>
public sealed class PairingService
{
    private readonly object _lock = new();
    private readonly AgentOptions _opt;
    private string _code = "";
    private DateTime _codeExpires;
    private int _failures;
    private DateTime _lockedUntil = DateTime.MinValue;

    private sealed record Session(string Origin, DateTime Expires);
    private readonly ConcurrentDictionary<string, Session> _sessions = new();

    public PairingService(AgentOptions opt) { _opt = opt; NewCode(); }

    public string CurrentCode { get { lock (_lock) { if (DateTime.UtcNow > _codeExpires) NewCode(); return _code; } } }
    public bool IsPaired => !_sessions.IsEmpty;
    public event Action<string>? CodeChanged;

    private void NewCode()
    {
        _code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
        _codeExpires = DateTime.UtcNow.AddMinutes(5);
        _failures = 0;
        CodeChanged?.Invoke(_code);
    }

    /// <returns>(token, lỗi). Lỗi = null nếu thành công.</returns>
    public (string? token, string? error, int retryAfterSec) TryPair(string origin, string? code)
    {
        lock (_lock)
        {
            if (DateTime.UtcNow < _lockedUntil)
                return (null, "PAIRING_LOCKED", (int)Math.Ceiling((_lockedUntil - DateTime.UtcNow).TotalSeconds));
            if (DateTime.UtcNow > _codeExpires) NewCode();

            var ok = code is { Length: 6 } &&
                     CryptographicOperations.FixedTimeEquals(
                         System.Text.Encoding.ASCII.GetBytes(code), System.Text.Encoding.ASCII.GetBytes(_code));
            if (!ok)
            {
                if (++_failures >= 5)
                {
                    _lockedUntil = DateTime.UtcNow.AddSeconds(60);
                    NewCode();
                    return (null, "PAIRING_LOCKED", 60);
                }
                return (null, "PAIRING_CODE_INVALID", 0);
            }

            var token = Base64Url(RandomNumberGenerator.GetBytes(32));
            _sessions[token] = new Session(origin, DateTime.UtcNow.AddHours(_opt.SessionHours));
            NewCode(); // mã chỉ dùng một lần
            return (token, null, 0);
        }
    }

    public bool Validate(string? token, string? origin)
    {
        if (string.IsNullOrEmpty(token)) return false;
        if (!_sessions.TryGetValue(token, out var s)) return false;
        if (DateTime.UtcNow > s.Expires) { _sessions.TryRemove(token, out _); return false; }
        return string.Equals(s.Origin, origin, StringComparison.OrdinalIgnoreCase);
    }

    public void Revoke(string token) => _sessions.TryRemove(token, out _);
    public void RevokeAll() => _sessions.Clear();

    private static string Base64Url(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
