import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { LineChart, BarChart, PieChart, GaugeChart, ScatterChart, CustomChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, DataZoomComponent, GraphicComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([LineChart, BarChart, PieChart, GaugeChart, ScatterChart, CustomChart, GridComponent, TooltipComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, DataZoomComponent, GraphicComponent, CanvasRenderer]);

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const chartColors = () => ({
  text: css('--text'), text2: css('--text-2'), text3: css('--text-3'), border: css('--border'), grid: css('--grid-line'), surface: css('--surface-2'), surface1: css('--surface-1'), surface3: css('--surface-3'),
  accent: css('--accent'), ok: css('--ok'), warn: css('--warn'), bad: css('--bad'), crit: css('--crit'), info: css('--info'), font: css('--font-sans'), mono: css('--font-mono'),
});
export type ChartColors = ReturnType<typeof chartColors>;

/** Đổi key mỗi khi Dark/Light đổi để biểu đồ dựng lại với màu mới. */
export function useThemeKey() {
  const [k, setK] = useState(() => document.documentElement.dataset.theme ?? 'dark');
  useEffect(() => { const m = new MutationObserver(() => setK(document.documentElement.dataset.theme ?? 'dark')); m.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); return () => m.disconnect(); }, []);
  return k;
}
export const tooltipBase = (c: ChartColors) => ({ backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, padding: [6, 10], textStyle: { color: c.text, fontSize: 12, fontFamily: c.font }, extraCssText: 'border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35)' });

/**
 * Bao ECharts (canvas). `build` nhận bảng màu theo theme hiện tại và trả option; chỉ dựng lại khi `deps`/theme đổi,
 * dùng setOption (không dispose) nên cập nhật dữ liệu realtime không nhấp nháy.
 */
export function Chart({ build, deps, className, label, height = 220, onReady }: { build: (c: ChartColors) => EChartsCoreOption; deps: unknown[]; className?: string; label: string; height?: number | string; onReady?: (ch: echarts.ECharts) => void }) {
  const ref = useRef<HTMLDivElement>(null); const inst = useRef<echarts.ECharts>(); const nSeries = useRef(-1);
  const theme = useThemeKey();
  useEffect(() => {
    if (!ref.current) return;
    const ch = echarts.init(ref.current, undefined, { renderer: 'canvas' }); inst.current = ch; onReady?.(ch);
    const ro = new ResizeObserver(() => ch.resize()); ro.observe(ref.current);
    return () => { ro.disconnect(); ch.dispose(); inst.current = undefined; };
  }, [theme]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { nSeries.current = -1; }, [theme]);
  useEffect(() => {
    const opt = build(chartColors()) as { series?: unknown[] }; const n = Array.isArray(opt.series) ? opt.series.length : 0;
    // Chỉ thay thế series khi số lượng đổi — giữ nguyên series để hoạt ảnh/cập nhật realtime mượt, không dựng lại từ 0.
    inst.current?.setOption(opt as EChartsCoreOption, { notMerge: false, lazyUpdate: true, ...(n !== nSeries.current ? { replaceMerge: ['series'] } : {}) }); nSeries.current = n;
  }, [theme, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={ref} className={className} style={{ width: '100%', height }} role="img" aria-label={label} />;
}
