using System;
using System.Net.NetworkInformation;
using System.Threading;
using System.Threading.Tasks;

namespace HachihiNetworkScanner.Protocols
{
    public class PingResult
    {
        public bool IsAlive { get; set; }
        public int? Ttl { get; set; }
        public double? RttMs { get; set; }
    }

    public static class AsyncPingHelper
    {
        public static async Task<PingResult> PingAsync(string ipAddress, int timeoutMs = 400, SemaphoreSlim semaphore = null)
        {
            if (semaphore != null)
                await semaphore.WaitAsync().ConfigureAwait(false);

            try
            {
                using (Ping ping = new Ping())
                {
                    PingOptions options = new PingOptions(64, true);
                    byte[] buffer = new byte[32];

                    PingReply reply = await ping.SendPingAsync(ipAddress, timeoutMs, buffer, options).ConfigureAwait(false);
                    if (reply != null && reply.Status == IPStatus.Success)
                    {
                        int? ttl = null;
                        if (reply.Options != null)
                        {
                            ttl = reply.Options.Ttl;
                        }
                        return new PingResult
                        {
                            IsAlive = true,
                            Ttl = ttl,
                            RttMs = reply.RoundtripTime
                        };
                    }
                }
            }
            catch
            {
            }
            finally
            {
                if (semaphore != null)
                    semaphore.Release();
            }

            return new PingResult { IsAlive = false, Ttl = null, RttMs = null };
        }
    }
}
