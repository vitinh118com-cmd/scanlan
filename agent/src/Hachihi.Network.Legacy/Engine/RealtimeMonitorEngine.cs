using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using HachihiNetworkScanner.Models;
using HachihiNetworkScanner.Protocols;

namespace HachihiNetworkScanner.Engine
{
    public class RealtimeMonitorEngine
    {
        private CancellationTokenSource _cts;
        private int _sent;
        private int _received;
        private int _downtimeSec;
        private DateTime? _lastDownTime;
        private readonly List<double> _rttHistory = new List<double>();

        public bool IsMonitoring { get; private set; }

        public void StopMonitoring()
        {
            IsMonitoring = false;
            if (_cts != null && !_cts.IsCancellationRequested)
            {
                _cts.Cancel();
            }
        }

        public void StartMonitoring(string target, int intervalMs, IProgress<MonitorTickReport> progress)
        {
            if (IsMonitoring) return;

            IsMonitoring = true;
            _sent = 0;
            _received = 0;
            _downtimeSec = 0;
            _lastDownTime = null;
            _rttHistory.Clear();
            _cts = new CancellationTokenSource();

            Task.Run(async () =>
            {
                CancellationToken token = _cts.Token;
                while (!token.IsCancellationRequested && IsMonitoring)
                {
                    _sent++;
                    PingResult pr = await AsyncPingHelper.PingAsync(target, 500).ConfigureAwait(false);

                    double rttVal = 0;
                    if (pr.IsAlive)
                    {
                        _received++;
                        _lastDownTime = null;
                        rttVal = pr.RttMs.HasValue ? pr.RttMs.Value : 5.0;
                    }
                    else
                    {
                        if (!_lastDownTime.HasValue)
                        {
                            _lastDownTime = DateTime.UtcNow;
                        }
                        else
                        {
                            _downtimeSec = (int)(DateTime.UtcNow - _lastDownTime.Value).TotalSeconds;
                        }
                        rttVal = 0.0;
                    }

                    lock (_rttHistory)
                    {
                        _rttHistory.Add(rttVal);
                        if (_rttHistory.Count > 60) _rttHistory.RemoveAt(0);
                    }

                    double loss = _sent > 0 ? (double)(_sent - _received) / _sent * 100.0 : 0.0;

                    if (progress != null)
                    {
                        List<double> histCopy;
                        lock (_rttHistory) { histCopy = new List<double>(_rttHistory); }

                        progress.Report(new MonitorTickReport
                        {
                            IsAlive = pr.IsAlive,
                            LastRttMs = rttVal,
                            RttMs = pr.IsAlive ? (double?)rttVal : null,
                            SentPackets = _sent,
                            ReceivedPackets = _received,
                            PacketLossPercent = loss,
                            TotalDowntimeSeconds = _downtimeSec,
                            RttHistory = histCopy
                        });
                    }

                    try
                    {
                        await Task.Delay(Math.Max(500, intervalMs), token).ConfigureAwait(false);
                    }
                    catch
                    {
                        break;
                    }
                }
                IsMonitoring = false;
            });
        }
    }
}
