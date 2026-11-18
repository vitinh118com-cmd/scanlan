using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using HachihiNetworkScanner.Core;
using HachihiNetworkScanner.Models;
using HachihiNetworkScanner.Protocols;

namespace HachihiNetworkScanner.Engine
{
    public class WanScanEngine
    {
        private CancellationTokenSource _cts;

        public bool IsScanning { get; private set; }

        public void StopScan()
        {
            if (_cts != null && !_cts.IsCancellationRequested)
            {
                _cts.Cancel();
            }
        }

        public async Task StartScanAsync(
            string target,
            List<int> portsToCheck,
            IProgress<WanProgressReport> progress)
        {
            IsScanning = true;
            _cts = new CancellationTokenSource();
            CancellationToken token = _cts.Token;

            // Clean domain / target string
            string cleanTarget = target.Trim();
            if (cleanTarget.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
                cleanTarget = cleanTarget.Substring(7);
            else if (cleanTarget.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                cleanTarget = cleanTarget.Substring(8);

            int slashIdx = cleanTarget.IndexOf('/');
            if (slashIdx >= 0) cleanTarget = cleanTarget.Substring(0, slashIdx);

            int colonIdx = cleanTarget.IndexOf(':');
            if (colonIdx >= 0 && !cleanTarget.Contains("]")) cleanTarget = cleanTarget.Substring(0, colonIdx);

            string resolvedIp = cleanTarget;
            IPAddress[] addrs = null;
            try
            {
                addrs = await Dns.GetHostAddressesAsync(cleanTarget).ConfigureAwait(false);
            }
            catch
            {
                addrs = null;
            }

            if (addrs != null && addrs.Length > 0)
            {
                resolvedIp = addrs[0].ToString();
            }
            else
            {
                IPHostEntry entry = null;
                try
                {
                    entry = await Dns.GetHostEntryAsync(cleanTarget).ConfigureAwait(false);
                }
                catch
                {
                    entry = null;
                }

                if (entry != null && entry.AddressList != null && entry.AddressList.Length > 0)
                {
                    resolvedIp = entry.AddressList[0].ToString();
                }
            }

            int total = portsToCheck.Count;
            int doneCount = 0;

            List<WanPortResult> results = new List<WanPortResult>();
            List<Task> scanTasks = new List<Task>();
            // Concurrency optimal for WAN to avoid router SYN-flood firewall drops
            SemaphoreSlim concurrency = new SemaphoreSlim(Math.Min(25, Math.Max(5, total)));

            foreach (int port in portsToCheck)
            {
                if (token.IsCancellationRequested) break;

                int p = port;
                Task t = Task.Run(async () =>
                {
                    await concurrency.WaitAsync().ConfigureAwait(false);
                    try
                    {
                        if (token.IsCancellationRequested) return;
                        WanPortResult res = await SocketProbe.CheckWanPortAsync(cleanTarget, resolvedIp, p, Constants.WanPortTimeoutSec, token).ConfigureAwait(false);
                        
                        // Retry once for high priority ports if timeout/closed on jittery WAN
                        if (res != null && !res.IsOpen && (p == 5000 || p == 5001 || p == 445 || p == 80 || p == 443 || p == 8080 || p == 3389 || p == 22))
                        {
                            await Task.Delay(150, token).ConfigureAwait(false);
                            WanPortResult retryRes = await SocketProbe.CheckWanPortAsync(cleanTarget, resolvedIp, p, 4.0, token).ConfigureAwait(false);
                            if (retryRes != null && retryRes.IsOpen)
                            {
                                res = retryRes;
                            }
                        }

                        if (res != null)
                        {
                            lock (results)
                            {
                                results.Add(res);
                            }
                            int done = Interlocked.Increment(ref doneCount);
                            if (progress != null)
                            {
                                progress.Report(new WanProgressReport
                                {
                                    DoneCount = done,
                                    TotalPorts = total,
                                    Result = res
                                });
                            }
                        }
                    }
                    finally
                    {
                        concurrency.Release();
                    }
                });

                scanTasks.Add(t);
            }

            await Task.WhenAll(scanTasks).ConfigureAwait(false);

            IsScanning = false;
            if (progress != null)
            {
                progress.Report(new WanProgressReport
                {
                    DoneCount = doneCount,
                    TotalPorts = total,
                    IsCompleted = true
                });
            }
        }

        public async Task<List<WanPortResult>> ScanPortsAsync(string target, int[] ports, int timeoutMs, IProgress<WanPortResult> progress)
        {
            List<WanPortResult> results = new List<WanPortResult>();
            if (ports == null || ports.Length == 0) return results;

            List<int> portList = new List<int>(ports);
            Progress<WanProgressReport> prog = new Progress<WanProgressReport>(rep =>
            {
                if (rep.Result != null)
                {
                    lock (results) { results.Add(rep.Result); }
                    if (progress != null) progress.Report(rep.Result);
                }
            });

            await StartScanAsync(target, portList, prog).ConfigureAwait(false);
            return results;
        }

        private static readonly Dictionary<string, GeoIpResult> _geoCache = new Dictionary<string, GeoIpResult>(StringComparer.OrdinalIgnoreCase);
        private static readonly object _cacheLock = new object();

        public async Task<GeoIpResult> LookupGeoIpAsync(string ipOrTarget)
        {
            if (string.IsNullOrEmpty(ipOrTarget)) return new GeoIpResult();

            string clean = ipOrTarget.Trim();
            if (clean.StartsWith("http://", StringComparison.OrdinalIgnoreCase)) clean = clean.Substring(7);
            else if (clean.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) clean = clean.Substring(8);
            int sIdx = clean.IndexOf('/');
            if (sIdx >= 0) clean = clean.Substring(0, sIdx);
            int cIdx = clean.IndexOf(':');
            if (cIdx >= 0 && !clean.Contains("]")) clean = clean.Substring(0, cIdx);

            string ip = clean;
            IPAddress ipObj;
            if (!IPAddress.TryParse(clean, out ipObj))
            {
                try
                {
                    IPAddress[] addrs = await Dns.GetHostAddressesAsync(clean).ConfigureAwait(false);
                    if (addrs != null && addrs.Length > 0)
                    {
                        ip = addrs[0].ToString();
                    }
                }
                catch
                {
                }
            }

            // 1. Check Local Private / Bogon IP
            if (IsPrivateOrBogonIp(ip))
            {
                return new GeoIpResult
                {
                    IpAddress = ip,
                    Country = "Mạng nội bộ (Private LAN / Localhost)",
                    CountryCode = "LAN",
                    City = "Mạng cục bộ",
                    Isp = "Gateway Router / Switch nội bộ",
                    Organization = "Hạ tầng mạng LAN Doanh nghiệp",
                    AsNumber = "N/A",
                    IpType = "Private IP (RFC 1918)",
                    IsVpn = false,
                    IsDatacenter = false,
                    CachedSource = "Localhost Detection (0 ms)"
                };
            }

            // 2. Check Memory Cache
            lock (_cacheLock)
            {
                if (_geoCache.ContainsKey(ip))
                {
                    GeoIpResult cached = _geoCache[ip];
                    cached.CachedSource = "Bộ đệm Cache RAM / Disk (0 ms)";
                    return cached;
                }
            }

            GeoIpResult result = new GeoIpResult { IpAddress = ip };

            // 3. TIER 1: ipapi.is (Primary - High detail ASN, ISP, VPN, Datacenter, Singapore POP)
            bool tier1Success = false;
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("https://api.ipapi.is/?q=" + ip);
                req.Method = "GET";
                req.Timeout = 3000;
                req.ReadWriteTimeout = 3000;
                req.UserAgent = "HachihiScanner/3.0 (Enterprise Network Scanner)";

                using (WebResponse resp = await req.GetResponseAsync().ConfigureAwait(false))
                using (StreamReader reader = new StreamReader(resp.GetResponseStream()))
                {
                    string json = await reader.ReadToEndAsync().ConfigureAwait(false);
                    if (!string.IsNullOrEmpty(json))
                    {
                        tier1Success = ParseIpApiIs(json, result);
                    }
                }
            }
            catch
            {
                tier1Success = false;
            }

            // 4. TIER 2: ipinfo.io (Fallback - High reliability, HTTPS, Singapore POP)
            bool tier2Success = false;
            if (!tier1Success)
            {
                try
                {
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create("https://ipinfo.io/" + ip + "/json");
                    req.Method = "GET";
                    req.Timeout = 3000;
                    req.ReadWriteTimeout = 3000;
                    req.UserAgent = "HachihiScanner/3.0";

                    using (WebResponse resp = await req.GetResponseAsync().ConfigureAwait(false))
                    using (StreamReader reader = new StreamReader(resp.GetResponseStream()))
                    {
                        string json = await reader.ReadToEndAsync().ConfigureAwait(false);
                        if (!string.IsNullOrEmpty(json))
                        {
                            tier2Success = ParseIpInfoIo(json, result);
                        }
                    }
                }
                catch
                {
                    tier2Success = false;
                }
            }

            // 5. TIER 3: ipwho.is (Tertiary Fallback)
            if (!tier1Success && !tier2Success)
            {
                try
                {
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create("https://ipwho.is/" + ip);
                    req.Method = "GET";
                    req.Timeout = 3000;
                    req.ReadWriteTimeout = 3000;
                    req.UserAgent = "HachihiScanner/3.0";

                    using (WebResponse resp = await req.GetResponseAsync().ConfigureAwait(false))
                    using (StreamReader reader = new StreamReader(resp.GetResponseStream()))
                    {
                        string json = await reader.ReadToEndAsync().ConfigureAwait(false);
                        if (!string.IsNullOrEmpty(json))
                        {
                            ParseIpWhoIs(json, result);
                        }
                    }
                }
                catch
                {
                }
            }

            // Cache if valid info found
            if (!string.IsNullOrEmpty(result.Country) || !string.IsNullOrEmpty(result.Isp))
            {
                lock (_cacheLock)
                {
                    _geoCache[ip] = result;
                }
            }

            return result;
        }

        private static bool IsPrivateOrBogonIp(string ip)
        {
            if (string.IsNullOrEmpty(ip)) return false;
            if (ip == "127.0.0.1" || ip == "localhost" || ip == "::1") return true;
            if (ip.StartsWith("192.168.") || ip.StartsWith("10.")) return true;
            if (ip.StartsWith("169.254.")) return true;
            if (ip.StartsWith("172."))
            {
                string[] parts = ip.Split('.');
                if (parts.Length >= 2)
                {
                    int second;
                    if (int.TryParse(parts[1], out second) && second >= 16 && second <= 31)
                    {
                        return true;
                    }
                }
            }
            return false;
        }

        private static bool ParseIpApiIs(string json, GeoIpResult res)
        {
            try
            {
                Match mCountry = Regex.Match(json, @"""country""\s*:\s*""([^""]+)""");
                if (mCountry.Success) res.Country = mCountry.Groups[1].Value;

                Match mCountryCode = Regex.Match(json, @"""country_code""\s*:\s*""([^""]+)""");
                if (mCountryCode.Success) res.CountryCode = mCountryCode.Groups[1].Value;

                Match mCity = Regex.Match(json, @"""city""\s*:\s*""([^""]+)""");
                if (mCity.Success) res.City = mCity.Groups[1].Value;

                Match mState = Regex.Match(json, @"""state""\s*:\s*""([^""]+)""");
                if (mState.Success) res.Region = mState.Groups[1].Value;

                Match mAsn = Regex.Match(json, @"""asn""\s*:\s*(\d+)");
                if (mAsn.Success) res.AsNumber = "AS" + mAsn.Groups[1].Value;

                Match mAsnOrg = Regex.Match(json, @"""asn""\s*:\s*\{[^}]*""org""\s*:\s*""([^""]+)""");
                if (mAsnOrg.Success) res.AsName = mAsnOrg.Groups[1].Value;

                Match mCompany = Regex.Match(json, @"""company""\s*:\s*\{[^}]*""name""\s*:\s*""([^""]+)""");
                if (mCompany.Success) res.Organization = mCompany.Groups[1].Value;

                Match mCompType = Regex.Match(json, @"""company""\s*:\s*\{[^}]*""type""\s*:\s*""([^""]+)""");
                if (mCompType.Success)
                {
                    string ctype = mCompType.Groups[1].Value;
                    if (ctype.Equals("isp", StringComparison.OrdinalIgnoreCase)) res.IpType = "Residential / Internet ISP";
                    else if (ctype.Equals("hosting", StringComparison.OrdinalIgnoreCase)) res.IpType = "Datacenter / Hosting Cloud";
                    else if (ctype.Equals("business", StringComparison.OrdinalIgnoreCase)) res.IpType = "Doanh nghiệp (Business / Enterprise)";
                    else res.IpType = ctype;
                }

                // Security & VPN flags
                Match mVpn = Regex.Match(json, @"""is_vpn""\s*:\s*(true|false)");
                if (mVpn.Success) res.IsVpn = mVpn.Groups[1].Value.Equals("true", StringComparison.OrdinalIgnoreCase);

                Match mProxy = Regex.Match(json, @"""is_proxy""\s*:\s*(true|false)");
                if (mProxy.Success) res.IsProxy = mProxy.Groups[1].Value.Equals("true", StringComparison.OrdinalIgnoreCase);

                Match mTor = Regex.Match(json, @"""is_tor""\s*:\s*(true|false)");
                if (mTor.Success) res.IsTor = mTor.Groups[1].Value.Equals("true", StringComparison.OrdinalIgnoreCase);

                Match mDc = Regex.Match(json, @"""is_datacenter""\s*:\s*(true|false)");
                if (mDc.Success) res.IsDatacenter = mDc.Groups[1].Value.Equals("true", StringComparison.OrdinalIgnoreCase);

                res.Isp = !string.IsNullOrEmpty(res.Organization) ? res.Organization : (!string.IsNullOrEmpty(res.AsName) ? res.AsName : "Việt Nam ISP");
                res.CachedSource = "Live API (ipapi.is - Tầng 1)";
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static bool ParseIpInfoIo(string json, GeoIpResult res)
        {
            try
            {
                Match mCountry = Regex.Match(json, @"""country""\s*:\s*""([^""]+)""");
                if (mCountry.Success) res.CountryCode = mCountry.Groups[1].Value;
                if (res.CountryCode == "VN") res.Country = "Việt Nam";

                Match mCity = Regex.Match(json, @"""city""\s*:\s*""([^""]+)""");
                if (mCity.Success) res.City = mCity.Groups[1].Value;

                Match mRegion = Regex.Match(json, @"""region""\s*:\s*""([^""]+)""");
                if (mRegion.Success) res.Region = mRegion.Groups[1].Value;

                Match mOrg = Regex.Match(json, @"""org""\s*:\s*""([^""]+)""");
                if (mOrg.Success)
                {
                    string orgFull = mOrg.Groups[1].Value;
                    if (orgFull.StartsWith("AS", StringComparison.OrdinalIgnoreCase))
                    {
                        int spaceIdx = orgFull.IndexOf(' ');
                        if (spaceIdx > 0)
                        {
                            res.AsNumber = orgFull.Substring(0, spaceIdx);
                            res.Isp = orgFull.Substring(spaceIdx + 1);
                            res.Organization = res.Isp;
                        }
                        else
                        {
                            res.AsNumber = orgFull;
                            res.Isp = orgFull;
                        }
                    }
                    else
                    {
                        res.Isp = orgFull;
                        res.Organization = orgFull;
                    }
                }

                Match mHosting = Regex.Match(json, @"""hosting""\s*:\s*(true|false)");
                if (mHosting.Success) res.IsDatacenter = mHosting.Groups[1].Value.Equals("true", StringComparison.OrdinalIgnoreCase);

                Match mVpn = Regex.Match(json, @"""vpn""\s*:\s*(true|false)");
                if (mVpn.Success) res.IsVpn = mVpn.Groups[1].Value.Equals("true", StringComparison.OrdinalIgnoreCase);

                res.IpType = res.IsDatacenter ? "Datacenter / Cloud Server" : "Doanh nghiệp / Thuê bao";
                res.CachedSource = "Live API (ipinfo.io - Tầng 2)";
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static bool ParseIpWhoIs(string json, GeoIpResult res)
        {
            try
            {
                Match mCountry = Regex.Match(json, @"""country""\s*:\s*""([^""]+)""");
                if (mCountry.Success) res.Country = mCountry.Groups[1].Value;

                Match mCountryCode = Regex.Match(json, @"""country_code""\s*:\s*""([^""]+)""");
                if (mCountryCode.Success) res.CountryCode = mCountryCode.Groups[1].Value;

                Match mCity = Regex.Match(json, @"""city""\s*:\s*""([^""]+)""");
                if (mCity.Success) res.City = mCity.Groups[1].Value;

                Match mIsp = Regex.Match(json, @"""isp""\s*:\s*""([^""]+)""");
                if (mIsp.Success) res.Isp = mIsp.Groups[1].Value;

                Match mOrg = Regex.Match(json, @"""org""\s*:\s*""([^""]+)""");
                if (mOrg.Success) res.Organization = mOrg.Groups[1].Value;

                Match mAsn = Regex.Match(json, @"""asn""\s*:\s*""?([^"",}]+)""?");
                if (mAsn.Success) res.AsNumber = mAsn.Groups[1].Value;

                res.CachedSource = "Live API (ipwho.is - Tầng 3)";
                return true;
            }
            catch
            {
                return false;
            }
        }
    }
}
