using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using HachihiNetworkScanner.Core;
using HachihiNetworkScanner.Models;
using HachihiNetworkScanner.Protocols;

namespace HachihiNetworkScanner.Engine
{
    public class LanScanEngine
    {
        private readonly object _lifecycleLock = new object();
        private CancellationTokenSource _cts;

        public bool IsScanning { get; private set; }

        public void StopScan()
        {
            lock (_lifecycleLock)
            {
                if (_cts != null && !_cts.IsCancellationRequested)
                {
                    _cts.Cancel();
                }
            }
        }

        /// <summary>
        /// Bắt đầu một phiên quét LAN mới. Ném <see cref="InvalidOperationException"/> nếu
        /// đã có một phiên quét đang chạy, thay vì âm thầm ghi đè CancellationTokenSource cũ
        /// (hành vi cũ có thể làm rò rỉ token nguồn và khiến lệnh Dừng của phiên trước mất tác dụng).
        /// </summary>
        public async Task StartScanAsync(
            List<string> subnets,
            string modeKey,
            Dictionary<string, string> arpCache,
            bool includeArpOffline,
            IProgress<ScanProgressReport> progress)
        {
            CancellationTokenSource previousCts;
            lock (_lifecycleLock)
            {
                if (IsScanning)
                {
                    throw new InvalidOperationException("Một phiên quét LAN khác đang chạy. Vui lòng dừng phiên hiện tại trước.");
                }
                IsScanning = true;
                previousCts = _cts;
                _cts = new CancellationTokenSource();
            }
            // Giải phóng CTS của phiên trước đó (nếu còn) ngoài vùng lock để tránh giữ khóa lâu.
            if (previousCts != null)
            {
                try { previousCts.Dispose(); } catch { }
            }

            CancellationTokenSource activeCts = _cts;
            CancellationToken token = activeCts.Token;

            try
            {
                await RunScanAsync(subnets, modeKey, arpCache, includeArpOffline, progress, token).ConfigureAwait(false);
            }
            finally
            {
                lock (_lifecycleLock)
                {
                    IsScanning = false;
                    if (ReferenceEquals(_cts, activeCts))
                    {
                        _cts = null;
                    }
                }
                activeCts.Dispose();
            }
        }

        private async Task RunScanAsync(
            List<string> subnets,
            string modeKey,
            Dictionary<string, string> arpCache,
            bool includeArpOffline,
            IProgress<ScanProgressReport> progress,
            CancellationToken token)
        {
            ScanMode mode;
            if (!Constants.ScanModes.TryGetValue(modeKey, out mode))
            {
                mode = Constants.ScanModes["fast"];
            }

            if (arpCache == null)
            {
                arpCache = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            }

            string localSubnet = NetworkUtils.GetLocalSubnetPrefix();
            string localIp = NetworkUtils.GetLocalIpAddress();
            List<string> allIps = new List<string>();
            HashSet<string> seenIps = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            List<string> skippedSubnets = new List<string>();

            SemaphoreSlim semPing = new SemaphoreSlim(Constants.SemPingLimit);
            SemaphoreSlim semPort = new SemaphoreSlim(Constants.SemPortLimit);
            SemaphoreSlim semHttp = new SemaphoreSlim(Constants.SemHttpLimit);

            // Filter subnets
            foreach (string subnet in subnets)
            {
                string prefix, gatewayIp;
                if (!NetworkUtils.ParseSubnetPrefixAndGateway(subnet, out prefix, out gatewayIp))
                    continue;

                // Dai co chua IP cua may (ke ca /22, /16...) la dai noi bo -> khong can kiem tra gateway.
                bool isLocalRange = NetworkUtils.SubnetContainsIp(subnet, localIp);
                if (!string.IsNullOrEmpty(localSubnet) && !isLocalRange && prefix != localSubnet)
                {
                    bool alive = await IsGatewayAliveAsync(gatewayIp, semPing, semPort).ConfigureAwait(false);
                    if (!alive)
                    {
                        skippedSubnets.Add(subnet);
                        continue;
                    }
                }
                // Loai IP trung (vd dai /22 nguoi dung nhap da bao gom 192.168.1. trong danh sach mac dinh)
                foreach (string host in NetworkUtils.ExpandSubnet(subnet))
                {
                    if (seenIps.Add(host)) allIps.Add(host);
                }
            }

            if (skippedSubnets.Count > 0 && progress != null)
            {
                progress.Report(new ScanProgressReport { SkippedSubnets = skippedSubnets });
            }

            int total = allIps.Count;
            if (progress != null)
            {
                progress.Report(new ScanProgressReport { Total = total, Scanned = 0 });
            }

            // Start SADP broadcast discovery
            Task sadpTask = SadpDiscovery.DiscoverAsync(dev =>
            {
                if (progress != null)
                {
                    progress.Report(new ScanProgressReport { DiscoveredDevice = dev });
                }
            }, token);

            // Mang lon (/21 tro len): ping sweep truoc, chi do sau cac may dang song de khong tao hang trieu tac vu.
            // Sau sweep doc lai bang ARP de bat them cac may chan ICMP (cung dai L2 se co ARP entry).
            bool largeScan = allIps.Count > Constants.LargeScanThreshold;
            List<string> probeIps = allIps;
            HashSet<string> sweepLive = null;
            if (largeScan && !token.IsCancellationRequested)
            {
                sweepLive = await SweepLiveHostsAsync(allIps, total, progress, token).ConfigureAwait(false);

                Dictionary<string, string> arpAfterSweep = NetworkUtils.LoadArpCache();
                foreach (var kvp in arpAfterSweep)
                {
                    if (!arpCache.ContainsKey(kvp.Key)) arpCache[kvp.Key] = kvp.Value;
                    if (seenIps.Contains(kvp.Key)) sweepLive.Add(kvp.Key);
                }

                probeIps = new List<string>();
                foreach (string ip in allIps)
                {
                    if (sweepLive.Contains(ip)) probeIps.Add(ip);
                }

                // Tong tien do = buoc sweep (da xong) + buoc do sau tung may song
                total = allIps.Count + probeIps.Count;
                if (progress != null)
                {
                    progress.Report(new ScanProgressReport { Total = total, Scanned = allIps.Count });
                }
            }

            // Deep scan active discovery
            Dictionary<string, string> mdnsMap = new Dictionary<string, string>();
            Dictionary<string, string> ssdpMap = new Dictionary<string, string>();
            Dictionary<string, SsdpInfo> ssdpInfoMap = new Dictionary<string, SsdpInfo>(StringComparer.OrdinalIgnoreCase);
            Dictionary<string, string> nbnsMap = new Dictionary<string, string>();
            HashSet<string> discoverHintIps = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            if (mode.Key == "deep" && probeIps.Count > 0 && !token.IsCancellationRequested)
            {
                var mdnsTask = MdnsDiscovery.DiscoverAsync(2.5, token);
                var ssdpTask = SsdpDiscovery.DiscoverDetailedAsync(2.5, token);
                var nbnsTask = NbnsDiscovery.BulkDiscoverAsync(probeIps, 1.5, token);
                // tra mDNS nguoc tung may: lay duoc ten may that cua iPhone/iPad/Mac du MAC ngau nhien
                var mdnsRevTask = MdnsDiscovery.ReverseLookupAsync(probeIps, 1.5, token);

                await Task.WhenAll(mdnsTask, ssdpTask, nbnsTask, mdnsRevTask).ConfigureAwait(false);

                mdnsMap = mdnsTask.Result;
                ssdpInfoMap = ssdpTask.Result;
                foreach (var kvp in ssdpInfoMap) ssdpMap[kvp.Key] = kvp.Value.Text;
                nbnsMap = nbnsTask.Result;
                // ten tra nguoc chinh xac hon ten doan tu goi quang ba dich vu -> de len
                foreach (var kvp in mdnsRevTask.Result) mdnsMap[kvp.Key] = kvp.Value;

                // Re-read OS ARP Cache table after NBNS broadcast triggers ARP resolution
                Dictionary<string, string> freshArp = NetworkUtils.LoadArpCache();
                foreach (var kvp in freshArp)
                {
                    if (!arpCache.ContainsKey(kvp.Key))
                    {
                        arpCache[kvp.Key] = kvp.Value;
                    }
                }

                foreach (string ip in mdnsMap.Keys) discoverHintIps.Add(ip);
                foreach (string ip in ssdpMap.Keys) discoverHintIps.Add(ip);
                foreach (string ip in nbnsMap.Keys) discoverHintIps.Add(ip);
                foreach (string ip in freshArp.Keys) discoverHintIps.Add(ip);
            }

            int scannedCount = largeScan ? allIps.Count : 0;
            List<Task> probeTasks = new List<Task>();

            HashSet<string> reportedIps = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (string ip in probeIps)
            {
                if (token.IsCancellationRequested) break;

                DiscoveryHints hints = new DiscoveryHints();
                if (mdnsMap.ContainsKey(ip)) hints.Mdns = mdnsMap[ip];
                if (ssdpMap.ContainsKey(ip)) hints.Ssdp = ssdpMap[ip];
                if (nbnsMap.ContainsKey(ip)) hints.Nbns = nbnsMap[ip];
                SsdpInfo ssdpInfo;
                if (ssdpInfoMap.TryGetValue(ip, out ssdpInfo)) hints.SsdpLocation = ssdpInfo.Location;

                bool forceOnline = discoverHintIps.Contains(ip) || (sweepLive != null && sweepLive.Contains(ip));

                Task t = ProbeHostAsync(
                    ip,
                    mode,
                    arpCache,
                    semPort,
                    semPing,
                    semHttp,
                    includeArpOffline,
                    hints,
                    forceOnline,
                    token
                ).ContinueWith(resTask =>
                {
                    Interlocked.Increment(ref scannedCount);
                    DeviceInfo dev = null;
                    if (resTask.Status == TaskStatus.RanToCompletion)
                    {
                        dev = resTask.Result;
                    }
                    if (dev != null)
                    {
                        lock (reportedIps)
                        {
                            reportedIps.Add(dev.IpAddress);
                        }
                    }
                    if (progress != null)
                    {
                        progress.Report(new ScanProgressReport
                        {
                            Total = total,
                            Scanned = scannedCount,
                            DiscoveredDevice = dev
                        });
                    }
                });

                probeTasks.Add(t);
            }

            await Task.WhenAll(probeTasks).ConfigureAwait(false);

            // If includeArpOffline is checked, emit all ARP Cache entries not yet discovered
            if (includeArpOffline && arpCache != null)
            {
                foreach (var kvp in arpCache)
                {
                    string arpIp = kvp.Key;
                    string arpMac = kvp.Value;
                    if (string.IsNullOrEmpty(arpIp) || arpIp.StartsWith("224.") || arpIp.StartsWith("239.") || arpIp.EndsWith(".255"))
                        continue;

                    bool alreadyReported;
                    lock (reportedIps)
                    {
                        alreadyReported = reportedIps.Contains(arpIp);
                    }

                    if (!alreadyReported)
                    {
                        string macPrefix = (arpMac != null && arpMac.Length >= 8) ? arpMac.Substring(0, 8).ToUpper() : "";
                        string brand = DeviceClassifier.GetBrand(arpMac);
                        string devType = DeviceClassifier.RefineGenericDevType(macPrefix, brand);

                        DeviceInfo dev = new DeviceInfo
                        {
                            IpAddress = arpIp,
                            MacAddress = arpMac ?? "Không rõ",
                            Brand = brand ?? "Không rõ",
                            OperatingSystem = "N/A",
                            DeviceType = devType ?? "Thiết bị mạng (ARP Cache)",
                            OpenPorts = "Chưa kết nối cổng",
                            WebTitle = "",
                            Hostname = "Không xác định",
                            PingMs = "--",
                            Status = "Offline (Lưu vết ARP)",
                            Note = "Phát hiện trong ARP Cache hệ thống",
                            TimeDiscovered = DateTime.Now.ToString("HH:mm:ss")
                        };

                        if (progress != null)
                        {
                            progress.Report(new ScanProgressReport
                            {
                                Total = total,
                                Scanned = scannedCount,
                                DiscoveredDevice = dev
                            });
                        }
                    }
                }
            }

            try
            {
                await sadpTask.ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                Logger.LogWarning("LanScanEngine.RunScanAsync/sadpTask", ex.Message);
            }

            if (progress != null)
            {
                progress.Report(new ScanProgressReport { IsCompleted = true, Total = total, Scanned = total });
            }
        }

        private async Task<DeviceInfo> ProbeHostAsync(
            string ip,
            ScanMode mode,
            Dictionary<string, string> arpCache,
            SemaphoreSlim semPort,
            SemaphoreSlim semPing,
            SemaphoreSlim semHttp,
            bool includeArpOffline,
            DiscoveryHints hints,
            bool forceOnline,
            CancellationToken token)
        {
            if (token.IsCancellationRequested || string.IsNullOrEmpty(ip)) return null;
            string discoveryHint = hints != null ? hints.First() : null;

            try
            {
                if (mode == null)
                {
                    mode = Constants.ScanModes["fast"];
                }

                if (arpCache == null)
                {
                    arpCache = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                }

                // Probe quick ports
                List<Task<bool>> quickTasks = new List<Task<bool>>();
                foreach (int p in Constants.QuickPorts)
                {
                    quickTasks.Add(SocketProbe.CheckPortAsync(ip, p, Constants.PortTimeoutSec, semPort));
                }
                bool[] quickResults = await Task.WhenAll(quickTasks).ConfigureAwait(false);

                HashSet<int> openQuick = new HashSet<int>();
                for (int i = 0; i < Constants.QuickPorts.Length; i++)
                {
                    if (quickResults[i]) openQuick.Add(Constants.QuickPorts[i]);
                }

                bool pingAlive = false;
                int? ttl = null;
                double? pingMs = null;

                if (mode.DoPing)
                {
                    PingResult pr = await AsyncPingHelper.PingAsync(ip, Constants.PingTimeoutMs, semPing).ConfigureAwait(false);
                    if (pr != null)
                    {
                        pingAlive = pr.IsAlive;
                        ttl = pr.Ttl;
                        pingMs = pr.RttMs;
                    }
                }

                bool inArp = arpCache.ContainsKey(ip);
                bool online = openQuick.Count > 0 || pingAlive || forceOnline;

                if (!online && !(includeArpOffline && inArp))
                {
                    return null;
                }

                List<int> openPorts = new List<int>(openQuick);
                if (mode.PortList != null && mode.PortList != Constants.QuickPorts)
                {
                    List<int> remainingPorts = new List<int>();
                    foreach (int p in mode.PortList)
                    {
                        if (!openQuick.Contains(p)) remainingPorts.Add(p);
                    }

                    List<Task<bool>> remainingTasks = new List<Task<bool>>();
                    foreach (int p in remainingPorts)
                    {
                        remainingTasks.Add(SocketProbe.CheckPortAsync(ip, p, Constants.PortTimeoutSec, semPort));
                    }
                    bool[] remainingResults = await Task.WhenAll(remainingTasks).ConfigureAwait(false);
                    for (int i = 0; i < remainingPorts.Count; i++)
                    {
                        if (remainingResults[i]) openPorts.Add(remainingPorts[i]);
                    }
                }
                openPorts.Sort();

                string macAddr = NetworkUtils.ResolveMac(ip, arpCache);
                string macPrefix = (macAddr != null && macAddr.Length >= 8) ? macAddr.Substring(0, 8).ToUpper() : "";
                string brand = DeviceClassifier.GetBrand(macAddr);

                string devType = "Thiết bị mạng / Khác";
                string osOverride = null;
                bool tentative = false;
                DeviceClassifier.ClassifyByPorts(new HashSet<int>(openPorts), macPrefix, ref brand, out devType, out osOverride, out tentative);

                // Resolve Hostname
                string hostname = "Không xác định";
                if (mode.DoHostname)
                {
                    try
                    {
                        IPHostEntry entry = await Dns.GetHostEntryAsync(ip).ConfigureAwait(false);
                        if (entry != null && !string.IsNullOrEmpty(entry.HostName))
                        {
                            hostname = entry.HostName;
                        }
                    }
                    catch
                    {
                    }
                }

                if (hostname == "Không xác định" && !string.IsNullOrEmpty(discoveryHint))
                {
                    hostname = discoveryHint;
                }

                DeviceClassifier.RefineByHostname(hostname, ref devType, ref osOverride, ref brand, tentative);

                string httpTitle = "";
                string httpServer = "";
                string httpRealm = "";
                if (mode.DoHttp && openPorts.Count > 0)
                {
                    try
                    {
                        SocketProbe.HttpProbeInfo httpInfo = await SocketProbe.GrabHttpInfoAsync(ip, new HashSet<int>(openPorts), semHttp).ConfigureAwait(false);
                        httpTitle = httpInfo.Title;
                        httpServer = httpInfo.Server;
                        httpRealm = httpInfo.Realm;
                        if (!string.IsNullOrEmpty(httpTitle))
                        {
                            string tl = httpTitle.ToLowerInvariant();
                            if (tl.Contains("hikvision"))
                            {
                                brand = "Hikvision";
                                devType = "Camera / NVR (Web)";
                                osOverride = "IoT (Camera)";
                            }
                            else if (tl.Contains("dahua"))
                            {
                                brand = "Dahua";
                                devType = "Camera / NVR (Web)";
                                osOverride = "IoT (Camera)";
                            }
                            else if (tl.Contains("mikrotik"))
                            {
                                brand = "MikroTik";
                                devType = "Router/Gateway (Web)";
                                osOverride = "IoT (Router - RouterOS/Linux)";
                            }
                            else if (tl.Contains("synology"))
                            {
                                brand = "Synology";
                                devType = "NAS (DSM Web)";
                                osOverride = "IoT (NAS - Linux)";
                            }
                        }
                    }
                    catch
                    {
                    }
                }

                // Hang con chua ro (dien thoai bat MAC ngau nhien, thiet bi IoT...) -> suy doan tu UPnP, ten may, banner
                if (IsBrandUnknownOrWeak(brand))
                {
                    VendorGuess guess = await InferVendorAsync(ip, hints, hostname, httpTitle, httpServer, httpRealm, semHttp).ConfigureAwait(false);
                    if (guess != null)
                    {
                        if (!string.IsNullOrEmpty(guess.Brand)) brand = guess.Brand;
                        if (!string.IsNullOrEmpty(guess.DeviceType) && IsGenericDevType(devType)) devType = guess.DeviceType;
                        if (!string.IsNullOrEmpty(guess.Os) && string.IsNullOrEmpty(osOverride)) osOverride = guess.Os;
                    }
                }

                string defaultGw = NetworkUtils.GetDefaultGateway();
                bool isSystemDefaultGateway = (!string.IsNullOrEmpty(defaultGw) && defaultGw == ip);

                if (devType == "Thiết bị mạng / Khác")
                {
                    devType = DeviceClassifier.RefineGenericDevType(macPrefix, brand);
                }

                // Nếu IP này trùng với Default Gateway hệ thống hoặc có đặc điểm Gateway (.1)
                if (isSystemDefaultGateway)
                {
                    devType = "Router/Gateway Chính (Default Gateway)";
                    if (string.IsNullOrEmpty(osOverride)) osOverride = "IoT (Router/Gateway)";
                }
                else if ((devType == "Thiết bị mạng / Khác" || devType.Contains("chưa rõ")) && ip.EndsWith(".1"))
                {
                    devType = "Router/Gateway (Địa chỉ .1)";
                    if (string.IsNullOrEmpty(osOverride)) osOverride = "IoT (Router - Linux)";
                }

                string osGuess;
                if (!string.IsNullOrEmpty(osOverride))
                {
                    osGuess = osOverride;
                }
                else if (pingAlive)
                {
                    osGuess = DeviceClassifier.GuessOsByTtl(ttl, macPrefix, brand, hostname);
                }
                else
                {
                    osGuess = "N/A";
                }

                string portsStr;
                if (openPorts.Count > 0)
                {
                    List<string> portEntries = new List<string>();
                    foreach (int p in openPorts)
                    {
                        portEntries.Add(string.Format("{0}({1})", p, DeviceClassifier.GetServiceName(p)));
                    }
                    portsStr = string.Join(", ", portEntries);
                }
                else
                {
                    portsStr = "Không có cổng mở";
                }

                string statusStr;
                if (pingAlive) statusStr = "Online (Ping)";
                else if (openPorts.Count > 0) statusStr = "Online (TCP)";
                else if (forceOnline) statusStr = "Online (mDNS/SSDP/ARP)";
                else statusStr = "⚠ Offline (chỉ còn dấu vết trong ARP Cache)";

                string pingStr = pingMs.HasValue ? string.Format("{0:F1}", pingMs.Value) : "N/A";

                return new DeviceInfo
                {
                    IpAddress = ip,
                    MacAddress = macAddr ?? "Không rõ",
                    Brand = brand ?? "Không rõ",
                    OperatingSystem = osGuess ?? "N/A",
                    DeviceType = devType ?? "Thiết bị mạng / Khác",
                    OpenPorts = portsStr ?? "",
                    WebTitle = httpTitle ?? "",
                    Hostname = hostname ?? "Không xác định",
                    PingMs = pingStr,
                    Status = statusStr,
                    Note = "",
                    TimeDiscovered = DateTime.Now.ToString("HH:mm:ss")
                };
            }
            catch (OperationCanceledException)
            {
                // Hủy quét là hành vi bình thường, không cần ghi log.
                return null;
            }
            catch (Exception ex)
            {
                Logger.LogWarning("LanScanEngine.ProbeHostAsync[" + ip + "]", ex.Message);
                return null;
            }
        }

        private static bool IsBrandUnknownOrWeak(string brand)
        {
            return string.IsNullOrEmpty(brand) || brand == "Không rõ" || brand == "Linux Host" || brand == "Microsoft Windows";
        }

        private static bool IsGenericDevType(string devType)
        {
            return string.IsNullOrEmpty(devType)
                || devType == "Thiết bị mạng / Khác"
                || devType.Contains("chưa rõ")
                || devType.Contains("MAC ngẫu nhiên");
        }

        /// <summary>
        /// Gom cac nguon goi y (mo ta UPnP, ten mDNS/DNS/NetBIOS, banner HTTP/SSDP) va nho VendorInference doan hang.
        /// </summary>
        private async Task<VendorGuess> InferVendorAsync(
            string ip,
            DiscoveryHints hints,
            string hostname,
            string httpTitle,
            string httpServer,
            string httpRealm,
            SemaphoreSlim semHttp)
        {
            try
            {
                UpnpDescription upnp = null;
                if (hints != null && !string.IsNullOrEmpty(hints.SsdpLocation))
                {
                    await semHttp.WaitAsync().ConfigureAwait(false);
                    try { upnp = await SsdpDiscovery.FetchDescriptionAsync(hints.SsdpLocation, ip).ConfigureAwait(false); }
                    finally { semHttp.Release(); }
                }

                List<KeyValuePair<string, string>> names = new List<KeyValuePair<string, string>>();
                if (upnp != null)
                {
                    if (upnp.FriendlyName.Length > 0) names.Add(new KeyValuePair<string, string>("UPnP", upnp.FriendlyName));
                    if (upnp.ModelName.Length > 0) names.Add(new KeyValuePair<string, string>("UPnP", upnp.ModelName));
                }
                if (hints != null && !string.IsNullOrEmpty(hints.Mdns)) names.Add(new KeyValuePair<string, string>("mDNS", hints.Mdns));
                if (!string.IsNullOrEmpty(hostname)) names.Add(new KeyValuePair<string, string>("Tên máy", hostname));
                if (hints != null && !string.IsNullOrEmpty(hints.Nbns)) names.Add(new KeyValuePair<string, string>("NetBIOS", hints.Nbns));

                List<KeyValuePair<string, string>> banners = new List<KeyValuePair<string, string>>();
                if (!string.IsNullOrEmpty(httpTitle)) banners.Add(new KeyValuePair<string, string>("HTTP", httpTitle));
                if (!string.IsNullOrEmpty(httpServer)) banners.Add(new KeyValuePair<string, string>("HTTP", httpServer));
                if (!string.IsNullOrEmpty(httpRealm)) banners.Add(new KeyValuePair<string, string>("HTTP", httpRealm));
                if (hints != null && !string.IsNullOrEmpty(hints.Ssdp)) banners.Add(new KeyValuePair<string, string>("SSDP", hints.Ssdp));

                return VendorInference.Infer(upnp != null ? upnp.Manufacturer : null, names, banners);
            }
            catch (Exception ex)
            {
                Logger.LogWarning("LanScanEngine.InferVendorAsync[" + ip + "]", ex.Message);
                return null;
            }
        }

        /// <summary>
        /// Ping sweep nhanh theo tung lo (Constants.SweepChunk) de gioi han bo nho khi quet /16.
        /// Tra ve tap IP co tra loi ICMP.
        /// </summary>
        private async Task<HashSet<string>> SweepLiveHostsAsync(
            List<string> ips,
            int total,
            IProgress<ScanProgressReport> progress,
            CancellationToken token)
        {
            HashSet<string> live = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            SemaphoreSlim sem = new SemaphoreSlim(Constants.SemSweepLimit);

            for (int start = 0; start < ips.Count; start += Constants.SweepChunk)
            {
                if (token.IsCancellationRequested) break;

                int end = Math.Min(ips.Count, start + Constants.SweepChunk);
                List<Task> batch = new List<Task>(end - start);
                for (int i = start; i < end; i++)
                {
                    batch.Add(SweepOneAsync(ips[i], sem, live));
                }
                await Task.WhenAll(batch).ConfigureAwait(false);

                if (progress != null)
                {
                    progress.Report(new ScanProgressReport { Total = total, Scanned = end });
                }
            }
            return live;
        }

        private async Task SweepOneAsync(string ip, SemaphoreSlim sem, HashSet<string> live)
        {
            PingResult pr = await AsyncPingHelper.PingAsync(ip, Constants.SweepPingTimeoutMs, sem).ConfigureAwait(false);
            if (pr != null && pr.IsAlive)
            {
                lock (live) { live.Add(ip); }
            }
        }

        private async Task<bool> IsGatewayAliveAsync(string ip, SemaphoreSlim semPing, SemaphoreSlim semPort)
        {
            PingResult pr = await AsyncPingHelper.PingAsync(ip, 400, semPing).ConfigureAwait(false);
            if (pr.IsAlive) return true;

            int[] checkPorts = new int[] { 80, 443, 22, 8080, 8291 };
            List<Task<bool>> tasks = new List<Task<bool>>();
            foreach (int p in checkPorts)
            {
                tasks.Add(SocketProbe.CheckPortAsync(ip, p, 0.4, semPort));
            }
            bool[] results = await Task.WhenAll(tasks).ConfigureAwait(false);
            foreach (bool ok in results)
            {
                if (ok) return true;
            }
            return false;
        }
    }
}
