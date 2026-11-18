using System;
using System.IO;
using System.Text;

namespace HachihiNetworkScanner.Core
{
    /// <summary>
    /// Ghi log lỗi tối giản, an toàn luồng (thread-safe), không phụ thuộc thư viện ngoài.
    /// Mục tiêu: thay thế các khối "catch { }" nuốt lỗi âm thầm bằng một nơi tập trung
    /// để chẩn đoán sự cố khi triển khai thực tế (không có Visual Studio để debug).
    /// Mọi lỗi ghi log đều tự nuốt lỗi nội bộ — Logger không bao giờ được phép ném ngoại lệ
    /// làm hỏng luồng xử lý chính.
    /// </summary>
    public static class Logger
    {
        private static readonly object SyncRoot = new object();
        private static string _logFilePath;

        private const long MaxLogBytes = 2L * 1024 * 1024;   // vượt ngưỡng này thì xoay vòng sang .old.log

        /// <summary>Thư mục chứa file log (để mở thư mục / đóng gói gửi log).</summary>
        public static string LogDirectory
        {
            get { return Path.GetDirectoryName(LogFilePath); }
        }

        /// <summary>Đường dẫn file log hiện tại.</summary>
        public static string CurrentLogPath
        {
            get { return LogFilePath; }
        }

        private static string LogFilePath
        {
            get
            {
                if (_logFilePath == null)
                {
                    lock (SyncRoot)
                    {
                        if (_logFilePath == null)
                        {
                            string dir = Path.Combine(NetworkUtils.GetDataDirectory(), "logs");
                            try
                            {
                                if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
                            }
                            catch
                            {
                                dir = NetworkUtils.GetDataDirectory();
                            }
                            _logFilePath = Path.Combine(dir, "hachihi_error.log");
                        }
                    }
                }
                return _logFilePath;
            }
        }

        /// <summary>Ghi lại một ngoại lệ kèm ngữ cảnh (tên hàm/thao tác đang thực hiện).</summary>
        public static void LogError(string context, Exception ex)
        {
            Write("ERROR", context, ex != null ? ex.ToString() : "(null exception)");
        }

        /// <summary>Ghi lại một thông tin cảnh báo không nghiêm trọng (không phải exception).</summary>
        public static void LogWarning(string context, string message)
        {
            Write("WARN", context, message);
        }

        /// <summary>Ghi một dòng thông tin (khởi động, thao tác quan trọng).</summary>
        public static void LogInfo(string context, string message)
        {
            Write("INFO", context, message);
        }

        /// <summary>Thông tin môi trường kèm theo khi gửi log cho bộ phận hỗ trợ.</summary>
        public static string BuildSystemInfo()
        {
            StringBuilder sb = new StringBuilder();
            sb.AppendLine(AppInfo.ProductName + " " + AppInfo.FullLabel);
            sb.AppendLine("Thời điểm : " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss zzz"));
            sb.AppendLine("Hệ điều hành : " + Environment.OSVersion + (Environment.Is64BitOperatingSystem ? " (64-bit)" : " (32-bit)"));
            sb.AppendLine("Tiến trình : " + (Environment.Is64BitProcess ? "64-bit" : "32-bit"));
            sb.AppendLine(".NET CLR : " + Environment.Version);
            sb.AppendLine("Số CPU : " + Environment.ProcessorCount);
            sb.AppendLine("Quyền admin : " + NetworkUtils.IsAdministrator());
            sb.AppendLine("Ngôn ngữ UI : " + System.Globalization.CultureInfo.CurrentUICulture.Name);
            return sb.ToString();
        }

        private static void RotateIfNeeded(string path)
        {
            try
            {
                FileInfo fi = new FileInfo(path);
                if (fi.Exists && fi.Length > MaxLogBytes)
                {
                    string old = Path.Combine(fi.DirectoryName, "hachihi_error.old.log");
                    if (File.Exists(old)) File.Delete(old);
                    File.Move(path, old);
                }
            }
            catch { }
        }

        private static void Write(string level, string context, string message)
        {
            try
            {
                string line = string.Format(
                    "[{0:yyyy-MM-dd HH:mm:ss.fff}] [{1}] [{2}] {3}{4}",
                    DateTime.Now, level, context, message, Environment.NewLine);

                lock (SyncRoot)
                {
                    RotateIfNeeded(LogFilePath);
                    File.AppendAllText(LogFilePath, line, Encoding.UTF8);
                }
            }
            catch
            {
                // Ghi log là tiện ích phụ trợ — không bao giờ được để lỗi ghi log
                // làm sập luồng xử lý chính của ứng dụng.
            }
        }
    }
}
