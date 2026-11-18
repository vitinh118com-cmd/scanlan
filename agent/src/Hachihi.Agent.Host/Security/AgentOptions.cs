namespace Hachihi.Agent.Security;

public sealed class AgentOptions
{
    public int Port { get; set; } = 47800;
    public string[] AllowedOrigins { get; set; } = Array.Empty<string>();
    public int SessionHours { get; set; } = 8;
    public int MaxMonitorSessions { get; set; } = 5;

    public bool IsOriginAllowed(string? origin)
    {
        if (string.IsNullOrEmpty(origin)) return false;
        foreach (var o in AllowedOrigins)
            if (string.Equals(o.TrimEnd('/'), origin.TrimEnd('/'), StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }
}
