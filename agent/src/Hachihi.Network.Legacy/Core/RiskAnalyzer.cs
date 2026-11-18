// RiskAnalyzer - danh gia rui ro bao mat tu danh sach thiet bi da quet (dung chung Tong quan + Bao cao)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using HachihiNetworkScanner.Models;

namespace HachihiNetworkScanner.Core
{
    public class RiskItem
    {
        public string Severity;     // CRITICAL / WARNING / LOW
        public string Ip, Host, Title, Port, Recommendation;
    }

    public static class RiskAnalyzer
    {
        public static List<RiskItem> Analyze(IEnumerable<DeviceInfo> devices)
        {
            var list = new List<RiskItem>();
            if (devices == null) return list;
            foreach (var d in devices)
            {
                var ports = new HashSet<int>();
                foreach (Match m in Regex.Matches(d.OpenPorts ?? "", @"\d{1,5}"))
                {
                    int p; if (int.TryParse(m.Value, out p)) ports.Add(p);
                }
                string txt = (d.OpenPorts ?? "").ToLowerInvariant();
                string who = d.IpAddress + (string.IsNullOrEmpty(d.Brand) || d.Brand == "Không rõ" ? "" : " (" + d.Brand + ")");

                if (ports.Contains(23) || txt.Contains("telnet"))
                    list.Add(new RiskItem { Severity = "CRITICAL", Ip = d.IpAddress, Host = who, Port = "23", Title = "Mở Telnet (truyền văn bản không mã hóa)", Recommendation = "Tắt Telnet, chuyển sang SSH (cổng 22)." });
                if (ports.Contains(445) || txt.Contains("smb"))
                    list.Add(new RiskItem { Severity = "WARNING", Ip = d.IpAddress, Host = who, Port = "445", Title = "Mở chia sẻ tệp SMB (nguy cơ ransomware)", Recommendation = "Chặn cổng 445 ra Internet, cập nhật bản vá Windows, dùng SMBv3." });
                if (ports.Contains(3389) || txt.Contains("rdp"))
                    list.Add(new RiskItem { Severity = "WARNING", Ip = d.IpAddress, Host = who, Port = "3389", Title = "Mở Remote Desktop (RDP)", Recommendation = "Bật NLA, mật khẩu mạnh, truy cập từ xa qua VPN." });
                if (ports.Contains(21) || txt.Contains("ftp"))
                    list.Add(new RiskItem { Severity = "WARNING", Ip = d.IpAddress, Host = who, Port = "21", Title = "Mở FTP (không mã hóa)", Recommendation = "Chuyển sang SFTP/FTPS." });
                if (ports.Contains(5900) || txt.Contains("vnc"))
                    list.Add(new RiskItem { Severity = "WARNING", Ip = d.IpAddress, Host = who, Port = "5900", Title = "Mở VNC điều khiển từ xa", Recommendation = "Đặt mật khẩu mạnh, giới hạn IP hoặc dùng VPN." });
                if (ports.Contains(3306) || ports.Contains(1433))
                    list.Add(new RiskItem { Severity = "WARNING", Ip = d.IpAddress, Host = who, Port = ports.Contains(3306) ? "3306" : "1433", Title = "Cổng cơ sở dữ liệu mở trong mạng", Recommendation = "Chỉ cho phép máy ứng dụng truy cập, không mở ra Internet." });
                if ((ports.Contains(80) || ports.Contains(8080)) && !ports.Contains(443))
                    list.Add(new RiskItem { Severity = "LOW", Ip = d.IpAddress, Host = who, Port = "80", Title = "Trang quản trị HTTP chưa có HTTPS", Recommendation = "Bật HTTPS và cài chứng chỉ SSL/TLS." });
            }
            return list;
        }

        public static int Critical(List<RiskItem> r) { return r.Count(x => x.Severity == "CRITICAL"); }
        public static int Warning(List<RiskItem> r) { return r.Count(x => x.Severity == "WARNING"); }
        public static int Low(List<RiskItem> r) { return r.Count(x => x.Severity == "LOW"); }

        // 0..100 (100 = an toan)
        public static int Score(List<RiskItem> r)
        {
            int s = 100 - 20 * Critical(r) - 8 * Warning(r) - 1 * Math.Min(10, Low(r));
            return Math.Max(0, Math.Min(100, s));
        }
    }
}
