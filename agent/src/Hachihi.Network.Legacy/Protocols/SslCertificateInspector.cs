using System;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Threading.Tasks;
using HachihiNetworkScanner.Models;

namespace HachihiNetworkScanner.Protocols
{
    public static class SslCertificateInspector
    {
        public static async Task<SslCertInfo> InspectAsync(string ip, int port = 443, double timeoutSec = 4.0)
        {
            return await InspectCertificateAsync(ip, port, timeoutSec).ConfigureAwait(false);
        }

        public static async Task<SslCertInfo> InspectCertificateAsync(string ip, int port = 443, double timeoutSec = 4.0)
        {
            SslCertInfo info = new SslCertInfo();

            try
            {
                using (TcpClient client = new TcpClient())
                {
                    Task connectTask = client.ConnectAsync(ip, port);
                    Task timeoutTask = Task.Delay(TimeSpan.FromSeconds(timeoutSec));

                    if (await Task.WhenAny(connectTask, timeoutTask).ConfigureAwait(false) != connectTask || !client.Connected)
                    {
                        info.HasSsl = false;
                        info.Success = false;
                        info.Error = "Không thể kết nối TCP tới " + ip + ":" + port;
                        info.ErrorMessage = info.Error;
                        return info;
                    }

                    using (SslStream sslStream = new SslStream(
                        client.GetStream(),
                        false,
                        (sender, cert, chain, errors) => true))
                    {
                        await sslStream.AuthenticateAsClientAsync(ip).ConfigureAwait(false);

                        info.HasSsl = true;
                        info.Success = true;
                        info.TlsVersion = sslStream.SslProtocol.ToString();
                        info.Cipher = sslStream.CipherAlgorithm.ToString();

                        X509Certificate remoteCert = sslStream.RemoteCertificate;
                        if (remoteCert != null)
                        {
                            X509Certificate2 cert2 = new X509Certificate2(remoteCert);
                            info.Subject = cert2.Subject;
                            info.Issuer = cert2.Issuer;
                            info.ValidFrom = cert2.NotBefore;
                            info.ValidTo = cert2.NotAfter;
                            info.SerialNumber = cert2.SerialNumber;
                            info.Thumbprint = cert2.Thumbprint;
                            info.DaysRemaining = (cert2.NotAfter - DateTime.UtcNow).Days;
                            info.DaysLeft = info.DaysRemaining;

                            using (SHA256 sha256 = SHA256.Create())
                            {
                                byte[] hash = sha256.ComputeHash(cert2.RawData);
                                StringBuilder sb = new StringBuilder();
                                foreach (byte b in hash) sb.Append(b.ToString("X2"));
                                info.Sha256Fingerprint = sb.ToString();
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                info.HasSsl = false;
                info.Success = false;
                info.Error = ex.Message;
                info.ErrorMessage = ex.Message;
            }

            return info;
        }
    }
}
