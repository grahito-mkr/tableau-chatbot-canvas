// Shared helpers used across every chart-type renderer.
// Keep this file small - anything that grows more than a couple of
// dozen lines probably belongs in the chart file that needs it.

export const CHART_COLORS = [
  "#4c78a8",
  "#f58518",
  "#54a24b",
  "#e45756",
  "#72b7b2",
  "#eeca3b",
  "#b279a2",
  "#ff9da6",
  "#9d755d",
  "#bab0ac"
];

export function colorForIndex(i: number) {
  return CHART_COLORS[i % CHART_COLORS.length];
}

export function longestLabel(rows: Record<string, unknown>[], key: string) {
  let m = 0;
  for (const r of rows) {
    const s = String(r[key] ?? "");
    if (s.length > m) m = s.length;
  }
  return m;
}

export function longestNumberLabel(rows: Record<string, unknown>[], key: string) {
  let m = 1;
  for (const r of rows) {
    const s = formatNumber(Number(r[key]) || 0);
    if (s.length > m) m = s.length;
  }
  return m;
}

export function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function formatNumber(n: number) {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (Math.abs(n) >= 10_000) return (n / 1_000).toFixed(1) + "K";
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(2).replace(/\.?0+$/, "");
}

export function formatPercent(n: number) {
  if (!Number.isFinite(n)) return "-";
  if (n >= 0.1) return (n * 100).toFixed(0) + "%";
  return (n * 100).toFixed(1) + "%";
}

export function niceTicks(maxValue: number, count: number): number[] {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return [0];
  const rawStep = maxValue / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = mag * (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1);
  const ticks: number[] = [];
  for (let v = 0; v <= maxValue + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

// Tick range that spans a min-to-max value (not just 0-to-max) - used by
// scatter plots where an axis might not start at zero.
export function niceRangeTicks(minValue: number, maxValue: number, count: number): number[] {
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) return [0];
  if (minValue === maxValue) return [minValue];
  const range = maxValue - minValue;
  const rawStep = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = mag * (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1);
  const start = Math.floor(minValue / step) * step;
  const end = Math.ceil(maxValue / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

// Rendered when a chart can't build its model (missing fields, bad data).
export function ErrorBox({ message }: { message: string }) {
  return (
    <div style={{ color: "#c00", fontSize: 12, padding: 8, whiteSpace: "pre-wrap" }}>
      {message}
    </div>
  );
}
