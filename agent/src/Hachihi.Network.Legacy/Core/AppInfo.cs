namespace HachihiNetworkScanner.Core
{
    /// <summary>
    /// NGUỒN DUY NHẤT của thông tin phiên bản/thương hiệu. Muốn đổi phiên bản chỉ sửa Major/Minor/Patch/Build ở đây:
    /// assembly (AssemblyInfo.cs), tiêu đề cửa sổ, tab giới thiệu, báo cáo, User-Agent, log đều lấy từ các hằng số này.
    /// Trình cài đặt (installer\HachihiNetworkScanner.iss) đọc phiên bản trực tiếp từ file exe đã build.
    /// </summary>
    public static class AppInfo
    {
        public const string Major = "3";
        public const string Minor = "0";
        public const string Patch = "0";
        public const string Build = "0";

        public const string ShortVersion = Major + "." + Minor;                 // 3.0
        public const string Version = Major + "." + Minor + "." + Patch;         // 3.0.0
        public const string AssemblyVersionString = Version + "." + Build;       // 3.0.0.0 (dùng cho attribute assembly)

        public const string ShortLabel = "v" + ShortVersion;                     // v3.0   (chip ở tab giới thiệu)
        public const string FullLabel = "v" + Version;                           // v3.0.0

        public const string ProductName = "Hachihi Network Scanner";
        public const string WindowTitle = "Hachihi Network Scanner Enterprise " + ShortLabel;
        public const string HeaderTitle = "HACHIHI NETWORK SCANNER PRO " + ShortLabel + " (ENTERPRISE EDITION)";
        public const string UserAgent = "HachihiScanner/" + ShortVersion;

        // Liên hệ hỗ trợ cho nút "Gửi log". ĐÂY LÀ GIÁ TRỊ MẶC ĐỊNH GIẢ ĐỊNH — hãy thay bằng địa chỉ thật.
        public const string SupportEmail = "support@hachihi.vn";

        // (Tuỳ chọn) URL nhận log qua HTTP POST. Để rỗng = tắt gửi tự động, chỉ tạo file zip + mở email.
        public const string LogUploadUrl = "";
    }
}
