using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading.Tasks;

namespace HachihiNetworkScanner.Protocols
{
    public static class MiniSnmpClient
    {
        public const string OidSysDescr = "1.3.6.1.2.1.1.1.0";
        public const string OidSysUptime = "1.3.6.1.2.1.1.3.0";
        public const string OidSysName = "1.3.6.1.2.1.1.5.0";
        public const string OidSysLocation = "1.3.6.1.2.1.1.6.0";
        public const string OidHrCpuLoad = "1.3.6.1.2.1.25.3.3.1.2.1";
        public const string OidHrMemTotal = "1.3.6.1.2.1.25.2.2.0";

        public static async Task<Dictionary<string, object>> GetAsync(string ip, List<string> oids, string community = "public", int version = 1, double timeoutSec = 2.5, int port = 161)
        {
            Dictionary<string, object> results = new Dictionary<string, object>();
            int reqId = (int)(DateTime.UtcNow.Ticks % 65535);
            byte[] packet = BuildSnmpGet(oids, community, version, reqId);

            using (UdpClient client = new UdpClient())
            {
                client.Client.SendTimeout = (int)(timeoutSec * 1000);
                client.Client.ReceiveTimeout = (int)(timeoutSec * 1000);

                IPEndPoint ep = new IPEndPoint(IPAddress.Parse(ip), port);
                await client.SendAsync(packet, packet.Length, ep).ConfigureAwait(false);

                Task<UdpReceiveResult> receiveTask = client.ReceiveAsync();
                Task timeoutTask = Task.Delay(TimeSpan.FromSeconds(timeoutSec));

                if (await Task.WhenAny(receiveTask, timeoutTask).ConfigureAwait(false) == receiveTask)
                {
                    byte[] data = receiveTask.Result.Buffer;
                    return ParseSnmpResponse(data);
                }
                else
                {
                    throw new TimeoutException("SNMP request timeout (" + timeoutSec + "s)");
                }
            }
        }

        public static string FormatUptime(object ticksObj)
        {
            if (ticksObj == null) return "N/A";
            try
            {
                long ticks = Convert.ToInt64(ticksObj);
                double seconds = ticks / 100.0;
                TimeSpan span = TimeSpan.FromSeconds(seconds);
                return string.Format("{0} ngày {1} giờ {2} phút", span.Days, span.Hours, span.Minutes);
            }
            catch
            {
                return "N/A";
            }
        }

        private static byte[] BerLength(int n)
        {
            if (n < 0x80) return new byte[] { (byte)n };
            List<byte> bytes = new List<byte>();
            int temp = n;
            while (temp > 0)
            {
                bytes.Insert(0, (byte)(temp & 0xFF));
                temp >>= 8;
            }
            bytes.Insert(0, (byte)(0x80 | bytes.Count));
            return bytes.ToArray();
        }

        private static byte[] BerTlv(byte tag, byte[] value)
        {
            List<byte> result = new List<byte>();
            result.Add(tag);
            result.AddRange(BerLength(value.Length));
            result.AddRange(value);
            return result.ToArray();
        }

        private static byte[] BerInt(int n)
        {
            List<byte> bytes = new List<byte>();
            if (n == 0)
            {
                bytes.Add(0);
            }
            else
            {
                int temp = n;
                while (temp != 0 && temp != -1)
                {
                    bytes.Insert(0, (byte)(temp & 0xFF));
                    temp >>= 8;
                }
                if (n > 0 && (bytes[0] & 0x80) != 0)
                {
                    bytes.Insert(0, 0x00);
                }
                else if (n < 0 && (bytes[0] & 0x80) == 0)
                {
                    bytes.Insert(0, 0xFF);
                }
            }
            return BerTlv(0x02, bytes.ToArray());
        }

        private static byte[] BerOid(string oidStr)
        {
            string[] parts = oidStr.Trim('.').Split('.');
            List<int> intParts = new List<int>();
            foreach (string p in parts) intParts.Add(int.Parse(p));

            List<byte> outBytes = new List<byte>();
            outBytes.Add((byte)(intParts[0] * 40 + intParts[1]));

            for (int i = 2; i < intParts.Count; i++)
            {
                int p = intParts[i];
                if (p == 0)
                {
                    outBytes.Add(0);
                    continue;
                }
                List<byte> chunk = new List<byte>();
                while (p > 0)
                {
                    chunk.Insert(0, (byte)(p & 0x7F));
                    p >>= 7;
                }
                for (int c = 0; c < chunk.Count - 1; c++)
                {
                    chunk[c] |= 0x80;
                }
                outBytes.AddRange(chunk);
            }
            return BerTlv(0x06, outBytes.ToArray());
        }

        private static byte[] BerSequence(params byte[][] chunks)
        {
            List<byte> combined = new List<byte>();
            foreach (byte[] c in chunks) combined.AddRange(c);
            return BerTlv(0x30, combined.ToArray());
        }

        private static byte[] BuildSnmpGet(List<string> oids, string community, int version, int requestId)
        {
            byte[] nullTlv = new byte[] { 0x05, 0x00 };
            List<byte[]> varbindList = new List<byte[]>();

            foreach (string oid in oids)
            {
                byte[] vb = BerSequence(BerOid(oid), nullTlv);
                varbindList.Add(vb);
            }
            byte[] varbinds = BerSequence(varbindList.ToArray());

            List<byte> pduBody = new List<byte>();
            pduBody.AddRange(BerInt(requestId));
            pduBody.AddRange(BerInt(0)); // error-status
            pduBody.AddRange(BerInt(0)); // error-index
            pduBody.AddRange(varbinds);

            byte[] pdu = BerTlv(0xA0, pduBody.ToArray()); // GetRequest-PDU

            byte[] verTlv = BerInt(version);
            byte[] commTlv = BerTlv(0x04, Encoding.ASCII.GetBytes(community));

            return BerSequence(verTlv, commTlv, pdu);
        }

        private static void BerReadTlv(byte[] data, ref int idx, out byte tag, out byte[] value)
        {
            tag = data[idx++];
            byte first = data[idx++];
            int length;
            if ((first & 0x80) == 0)
            {
                length = first;
            }
            else
            {
                int n = first & 0x7F;
                length = 0;
                for (int i = 0; i < n; i++)
                {
                    length = (length << 8) | data[idx++];
                }
            }
            value = new byte[length];
            Buffer.BlockCopy(data, idx, value, 0, length);
            idx += length;
        }

        private static string BerDecodeOid(byte[] value)
        {
            if (value == null || value.Length == 0) return "";
            List<int> parts = new List<int>();
            parts.Add(value[0] / 40);
            parts.Add(value[0] % 40);

            int n = 0;
            for (int i = 1; i < value.Length; i++)
            {
                byte b = value[i];
                n = (n << 7) | (b & 0x7F);
                if ((b & 0x80) == 0)
                {
                    parts.Add(n);
                    n = 0;
                }
            }
            return string.Join(".", parts);
        }

        private static Dictionary<string, object> ParseSnmpResponse(byte[] data)
        {
            Dictionary<string, object> results = new Dictionary<string, object>();
            int idx = 0;
            byte tag;
            byte[] msgBody;
            BerReadTlv(data, ref idx, out tag, out msgBody);

            int p = 0;
            byte[] verVal, commVal, pduBody;
            BerReadTlv(msgBody, ref p, out tag, out verVal);
            BerReadTlv(msgBody, ref p, out tag, out commVal);
            BerReadTlv(msgBody, ref p, out tag, out pduBody);

            int q = 0;
            byte[] reqIdVal, errStatusVal, errIndexVal, varbindsVal;
            BerReadTlv(pduBody, ref q, out tag, out reqIdVal);
            BerReadTlv(pduBody, ref q, out tag, out errStatusVal);
            BerReadTlv(pduBody, ref q, out tag, out errIndexVal);
            BerReadTlv(pduBody, ref q, out tag, out varbindsVal);

            int r = 0;
            while (r < varbindsVal.Length)
            {
                byte[] vbVal;
                BerReadTlv(varbindsVal, ref r, out tag, out vbVal);

                int s = 0;
                byte[] oidVal, valVal;
                byte valTag;
                BerReadTlv(vbVal, ref s, out tag, out oidVal);
                BerReadTlv(vbVal, ref s, out valTag, out valVal);

                string oidStr = BerDecodeOid(oidVal);
                if (valTag == 0x02) // INTEGER
                {
                    long intVal = 0;
                    foreach (byte b in valVal) intVal = (intVal << 8) | b;
                    results[oidStr] = intVal;
                }
                else if (valTag == 0x04) // OCTET STRING
                {
                    results[oidStr] = Encoding.UTF8.GetString(valVal);
                }
                else if (valTag == 0x41 || valTag == 0x42 || valTag == 0x43 || valTag == 0x46) // Counter/TimeTicks
                {
                    ulong uintVal = 0;
                    foreach (byte b in valVal) uintVal = (uintVal << 8) | b;
                    results[oidStr] = uintVal;
                }
                else
                {
                    results[oidStr] = valVal;
                }
            }

            return results;
        }

        public static async Task<HachihiNetworkScanner.Models.SnmpExtendedInfo> QueryAsync(string ip, string community = "public")
        {
            var info = new HachihiNetworkScanner.Models.SnmpExtendedInfo();
            try
            {
                List<string> oids = new List<string> { OidSysDescr, OidSysName, OidSysUptime, OidHrCpuLoad, OidHrMemTotal };
                var dict = await GetAsync(ip, oids, community, 1, 2.0).ConfigureAwait(false);

                if (dict != null && dict.Count > 0)
                {
                    info.IsSuccess = true;
                    if (dict.ContainsKey(OidSysDescr)) info.SysDescr = dict[OidSysDescr] != null ? dict[OidSysDescr].ToString() : "N/A";
                    if (dict.ContainsKey(OidSysName)) info.SysName = dict[OidSysName] != null ? dict[OidSysName].ToString() : "N/A";
                    if (dict.ContainsKey(OidSysUptime)) info.Uptime = FormatUptime(dict[OidSysUptime]);
                    if (dict.ContainsKey(OidHrCpuLoad)) info.CpuLoad = Convert.ToInt32(dict[OidHrCpuLoad]);
                    if (dict.ContainsKey(OidHrMemTotal)) info.RamTotalMb = (int)(Convert.ToInt64(dict[OidHrMemTotal]) / 1024);
                }
            }
            catch
            {
                info.IsSuccess = false;
            }
            return info;
        }
    }
}
