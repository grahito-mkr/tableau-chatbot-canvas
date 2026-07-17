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
    const s = formatCategoryLabel(r[key]);
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

/**
 * Convert a category axis value to a consistent display label. This is
 * called for every axis tick / bar label / point tooltip, so it needs to
 * be cheap and stable across renders.
 *
 * The main job is normalizing DATE VALUES so a widget's axis looks the
 * same whether it was first populated by the initial build (where Claude
 * often emits friendly strings like "2024-08" or "Aug 2024") or by a
 * later filter-driven requery (where VDS returns raw ISO timestamps like
 * "2024-08-01T00:00:00"). Both should show up on the axis as "Aug 24".
 *
 * Detection is conservative: we ONLY reformat values that look
 * unambiguously like ISO 8601 dates. Everything else - department names,
 * region codes, numeric IDs - passes through untouched.
 */
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ISO_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_MONTH_RE = /^(\d{4})-(\d{2})$/;

export function formatCategoryLabel(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    // A very large number MIGHT be an epoch timestamp, but numeric
    // categorical values (branch id, employee id) are also common - so
    // don't try to be clever here, just stringify.
    return String(v);
  }
  if (v instanceof Date && !isNaN(v.getTime())) {
    return shortMonthYear(v.getFullYear(), v.getMonth());
  }
  if (typeof v !== "string") return String(v);

  // ISO datetime string, e.g. "2024-08-01T00:00:00" or "2024-08-01T00:00:00Z"
  const m1 = v.match(ISO_DATETIME_RE);
  if (m1) {
    const year = parseInt(m1[1], 10);
    const month = parseInt(m1[2], 10) - 1;
    return shortMonthYear(year, month);
  }

  // ISO date string, e.g. "2024-08-01"
  const m2 = v.match(ISO_DATE_RE);
  if (m2) {
    const year = parseInt(m2[1], 10);
    const month = parseInt(m2[2], 10) - 1;
    const day = parseInt(m2[3], 10);
    // If it's the first of the month, treat as a monthly label; otherwise
    // show the full date. This matches how Tableau's own axis labels
    // behave when the granularity of the field is monthly.
    if (day === 1) return shortMonthYear(year, month);
    return `${SHORT_MONTHS[month]} ${day}, ${String(year).slice(-2)}`;
  }

  // Year-month string, e.g. "2024-08"
  const m3 = v.match(YEAR_MONTH_RE);
  if (m3) {
    const year = parseInt(m3[1], 10);
    const month = parseInt(m3[2], 10) - 1;
    return shortMonthYear(year, month);
  }

  return v;
}

function shortMonthYear(year: number, monthZeroIndexed: number): string {
  const m = SHORT_MONTHS[monthZeroIndexed] || "?";
  return `${m} ${String(year).slice(-2)}`;
}

/**
 * Parse a value to a comparable sort key. Numbers stay numeric, ISO dates
 * become their epoch time, and everything else falls back to a
 * lowercased string. Used by chart sorters so we can order by category
 * or measure with sensible semantics regardless of what shape the data
 * arrives in.
 */
export function sortKey(v: unknown): number | string {
  if (v === null || v === undefined) return -Infinity;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") {
    if (ISO_DATETIME_RE.test(v) || ISO_DATE_RE.test(v)) {
      const t = Date.parse(v);
      if (!isNaN(t)) return t;
    }
    if (YEAR_MONTH_RE.test(v)) {
      const t = Date.parse(v + "-01");
      if (!isNaN(t)) return t;
    }
    const asNum = Number(v);
    if (!isNaN(asNum) && v.trim() !== "") return asNum;
    return v.toLowerCase();
  }
  return String(v).toLowerCase();
}
