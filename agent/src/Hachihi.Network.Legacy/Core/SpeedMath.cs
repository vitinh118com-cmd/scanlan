using System;
using System.Collections.Generic;

namespace HachihiNetworkScanner.Core
{
    /// <summary>Phép tính tốc độ của Speed Test, tách riêng khỏi giao diện để kiểm thử được.</summary>
    public static class SpeedMath
    {
        /// <summary>
        /// Trung bình cắt bỏ kiểu Ookla: chia giai đoạn đo (từ startSec tới mẫu cuối) thành các "lát" sliceSec giây,
        /// tính tốc độ từng lát (Mbps), bỏ trim lát chậm nhất và trim lát nhanh nhất rồi lấy trung bình.
        /// times: mốc thời gian tăng dần (giây); counts: tổng số byte luỹ kế tại các mốc đó.
        /// Trả về -1 nếu không đủ lát (đo quá ngắn) để caller dùng trung bình thường.
        /// </summary>
        public static double TrimmedSliceMean(List<double> times, List<long> counts, double startSec, double sliceSec, int trim)
        {
            int n = times.Count;
            if (n < 2 || sliceSec <= 0) return -1;
            double end = times[n - 1];
            int sliceCount = (int)Math.Floor((end - startSec) / sliceSec + 1e-9);
            if (sliceCount < 2 * trim + 2) return -1;

            List<double> speeds = new List<double>();
            for (int i = 0; i < sliceCount; i++)
            {
                double a = startSec + i * sliceSec;
                double b0 = BytesAt(times, counts, a);
                double b1 = BytesAt(times, counts, a + sliceSec);
                speeds.Add((b1 - b0) * 8.0 / sliceSec / 1e6);
            }
            speeds.Sort();
            double sum = 0; int cnt = 0;
            for (int i = trim; i < speeds.Count - trim; i++) { sum += speeds[i]; cnt++; }
            return cnt > 0 ? sum / cnt : -1;
        }

        /// <summary>Số byte luỹ kế tại thời điểm t (nội suy tuyến tính giữa hai mẫu).</summary>
        public static double BytesAt(List<double> times, List<long> counts, double t)
        {
            int last = times.Count - 1;
            if (t <= 0) return 0;
            if (t >= times[last]) return counts[last];
            int hi = 0;
            while (hi < last && times[hi] < t) hi++;
            double tl = hi == 0 ? 0 : times[hi - 1];
            double cl = hi == 0 ? 0 : counts[hi - 1];
            double th = times[hi], ch = counts[hi];
            return th > tl ? cl + (ch - cl) * (t - tl) / (th - tl) : ch;
        }
    }
}
