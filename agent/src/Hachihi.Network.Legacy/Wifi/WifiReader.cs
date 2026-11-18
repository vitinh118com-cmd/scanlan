using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using WifiPro;

namespace HachihiNetworkScanner.Wifi
{
    /// <summary>Kết quả WiFi trung lập (không chứa mật khẩu/profile XML).</summary>
    public class WifiApDto
    {
        public string Ssid { get; set; }
        public string Bssid { get; set; }
        public int RssiDbm { get; set; }
        public int SignalQuality { get; set; }
        public int FrequencyMHz { get; set; }
        public int Channel { get; set; }
        public string Band { get; set; }
        public string Phy { get; set; }
        public string Security { get; set; }
        public bool Connected { get; set; }
    }

    public class WifiConnectionDto
    {
        public string Ssid { get; set; }
        public string Bssid { get; set; }
        public int SignalQuality { get; set; }
        public int? RssiDbm { get; set; }
        public int? Channel { get; set; }
        public string Band { get; set; }
        public string Phy { get; set; }
        public string Security { get; set; }
        public double RxMbps { get; set; }
        public double TxMbps { get; set; }
    }

    public class WifiInterfaceDto
    {
        public string Name { get; set; }
        public WifiConnectionDto Connection { get; set; }
        public List<WifiApDto> NearbyAps { get; set; }
    }

    /// <summary>Facade công khai quanh Native WLAN API (wlanapi.dll). Chỉ chạy trên Windows có dịch vụ WLAN AutoConfig.</summary>
    public static class WifiReader
    {
        public static async Task<List<WifiInterfaceDto>> ReadAsync(bool survey, CancellationToken token)
        {
            var result = new List<WifiInterfaceDto>();
            using (var client = new WlanClient())
            {
                List<WlanIface> ifaces = client.GetInterfaces();
                if (survey)
                {
                    foreach (var i in ifaces) { try { client.Scan(i.Id); } catch { } }
                    // Windows cần vài giây để driver quét xong; đợi có thể huỷ.
                    await Task.Delay(3500, token).ConfigureAwait(false);
                }
                foreach (var i in ifaces)
                {
                    var dto = new WifiInterfaceDto { Name = i.Name, NearbyAps = new List<WifiApDto>() };
                    ConnInfo conn = null;
                    try { conn = client.GetConnection(i.Id); } catch { }
                    List<WifiAp> aps = new List<WifiAp>();
                    try { aps = client.GetBssList(i.Id); } catch { }

                    WifiAp current = null;
                    if (conn != null)
                    {
                        foreach (var a in aps)
                            if (string.Equals(a.Bssid, conn.Bssid, StringComparison.OrdinalIgnoreCase)) { current = a; break; }
                        dto.Connection = new WifiConnectionDto
                        {
                            Ssid = conn.Ssid,
                            Bssid = conn.Bssid,
                            SignalQuality = conn.Quality,
                            RxMbps = conn.RxMbps,
                            TxMbps = conn.TxMbps,
                            RssiDbm = current != null ? (int?)current.Rssi : null,
                            Channel = current != null ? (int?)current.Channel : null,
                            Band = current != null ? current.Band : null,
                            Phy = current != null ? current.Phy : null,
                            Security = current != null ? current.Security : null
                        };
                    }
                    if (survey)
                    {
                        foreach (var a in aps)
                        {
                            dto.NearbyAps.Add(new WifiApDto
                            {
                                Ssid = a.Ssid, Bssid = a.Bssid, RssiDbm = a.Rssi, SignalQuality = a.Quality,
                                FrequencyMHz = a.FreqMHz, Channel = a.Channel, Band = a.Band, Phy = a.Phy, Security = a.Security,
                                Connected = conn != null && string.Equals(a.Bssid, conn.Bssid, StringComparison.OrdinalIgnoreCase)
                            });
                        }
                    }
                    result.Add(dto);
                }
            }
            return result;
        }
    }
}
