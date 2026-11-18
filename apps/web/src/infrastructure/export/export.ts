import { downloadText } from '../db/backup';

export interface ReportSection { heading: string; columns: string[]; rows: (string | number | null | undefined)[][]; note?: string }
export interface ReportData { title: string; subtitle?: string; generatedAt: string; sections: ReportSection[] }

const cell = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const csvEscape = (v: unknown) => {
  let s = cell(v);
  // Chống CSV/formula injection khi mở bằng Excel.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(columns: string[], rows: unknown[][]): string {
  return '﻿' + [columns, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n');
}
export function exportCsv(filename: string, columns: string[], rows: unknown[][]) { downloadText(filename, toCsv(columns, rows), 'text/csv;charset=utf-8'); }
export function exportJson(filename: string, data: unknown) { downloadText(filename, JSON.stringify(data, null, 2)); }

export async function exportXlsx(filename: string, report: ReportData): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file');
  const sheets = report.sections.map((s) => ({
    data: [
      s.columns.map((c) => ({ value: c, fontWeight: 'bold' as const })),
      ...s.rows.map((r) => r.map((v) => ({ value: typeof v === 'number' ? v : cell(v).replace(/^([=+\-@])/, "'$1") }))),
    ],
    sheet: s.heading.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet',
  }));
  await writeXlsxFile(sheets.map((s) => s.data) as never, { sheets: sheets.map((s) => s.sheet), fileName: filename } as never);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** HTML in được (A4) — người dùng dùng "In → Lưu thành PDF" của trình duyệt: hỗ trợ đủ tiếng Việt, không cần font nhúng. Mọi dữ liệu được escape. */
export function reportHtml(r: ReportData): string {
  const tables = r.sections.map((s) => `<h2>${esc(s.heading)}</h2>${s.note ? `<p class="n">${esc(s.note)}</p>` : ''}<table><thead><tr>${s.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${
    s.rows.length ? s.rows.map((row) => `<tr>${row.map((v) => `<td>${esc(cell(v))}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${s.columns.length}">Không có dữ liệu</td></tr>`}</tbody></table>`).join('');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(r.title)}</title><style>
  @page{size:A4;margin:14mm}body{font:12px/1.45 system-ui,Segoe UI,Arial,sans-serif;color:#111}h1{font-size:20px;margin:0}.sub{color:#555;margin:2px 0 14px}
  h2{font-size:14px;margin:18px 0 6px;border-bottom:2px solid #0ea5e9;padding-bottom:3px}table{width:100%;border-collapse:collapse;font-size:11px}
  th,td{border:1px solid #cbd5e1;padding:3px 5px;text-align:left;vertical-align:top;word-break:break-word}th{background:#f1f5f9}.n{color:#555;font-size:11px}
  header{display:flex;justify-content:space-between;align-items:baseline;border-bottom:3px solid #0f172a;margin-bottom:8px}.brand{font-weight:800;letter-spacing:.06em}
  </style></head><body><header><span class="brand">HACHIHI NETWORK TOOL</span><span>${esc(r.generatedAt)}</span></header>
  <h1>${esc(r.title)}</h1><div class="sub">${esc(r.subtitle ?? '')}</div>${tables}</body></html>`;
}

export function printReport(r: ReportData): void {
  const w = window.open('', '_blank');
  if (!w) { alert('Trình duyệt chặn cửa sổ in. Hãy cho phép pop-up cho trang này.'); return; }
  w.document.open(); w.document.write(reportHtml(r)); w.document.close();
  w.focus(); setTimeout(() => w.print(), 300);
}
