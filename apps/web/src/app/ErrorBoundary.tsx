import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Bắt lỗi render; KHÔNG tự gửi log đi đâu (spec §11.1). Người dùng có thể sao chép chi tiết khi cần báo lỗi. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('[Hachihi]', error.message, info.componentStack?.slice(0, 400)); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: 32, maxWidth: 640, margin: '40px auto', font: '14px system-ui' }}>
        <h1>Đã xảy ra lỗi</h1>
        <p>Dữ liệu của bạn vẫn an toàn trong trình duyệt. Hãy tải lại trang; nếu lỗi lặp lại, hãy xuất backup trong Cài đặt trước.</p>
        <pre style={{ whiteSpace: 'pre-wrap', background: '#f1f5f9', padding: 10, borderRadius: 8 }}>{this.state.error.message}</pre>
        <button onClick={() => location.reload()}>Tải lại trang</button>
      </div>
    );
  }
}
