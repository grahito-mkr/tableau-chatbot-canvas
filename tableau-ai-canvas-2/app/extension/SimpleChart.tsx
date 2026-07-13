"use client";

import { useMemo } from "react";
import type { Widget } from "@/lib/agentLoop";

/**
 * A minimal SVG bar/line chart renderer that bypasses Tableau's
 * createVizImageAsync entirely. That API kept producing crosstabs whenever
 * it disagreed with our field-type inference, and its layout ignored the
 * container size unless given specific hints that turned out fragile.
 *
 * Drawing the chart ourselves from `widget.data` sidesteps all of that:
 * we already know which field is the category and which is the measure
 * (from Widget.sourceQuery or, failing that, from value shape), so the
 * output shape is guaranteed - no more accidental highlight-tables.
 *
 * Deliberately basic: axis labels, bars/points, value labels, hover
 * tooltip. No trendlines, no dual-axis, no color legend. Enough to
 * replace what the createVizImageAsync path was doing for our
 * kpi/bar/line/table widgets.
 */
export default function SimpleChart({
  widget,
  width,
  height
}: {
  widget: Widget;
  width: number;
  height: number;
}) {
  const chart = useMemo(() => buildChartModel(widget), [widget]);

  if ("error" in chart) {
    return <div style={{ color: "#c00", fontSize: 12, padding: 8 }}>{chart.error}</div>;
  }

  const { rows, categoryKey, measureKey, isLine } = chart;

  // Layout. Reserve enough left margin for the y-axis labels and enough
  // bottom margin for angled category labels. These are conservative
  // defaults tuned by eye; tweak if very long labels still get cut.
  const marginTop = 20;
  const marginRight = 12;
  const marginBottom = Math.min(80, Math.max(50, longestLabel(rows, categoryKey) * 6));
  const marginLeft = Math.max(40, longestNumberLabel(rows, measureKey) * 8);

  const innerW = Math.max(1, width - marginLeft - marginRight);
  const innerH = Math.max(1, height - marginTop - marginBottom);

  // Value scale: use max only (bars start at zero, matching Tableau).
  const values = rows.map((r) => Number(r[measureKey]) || 0);
  const maxValue = Math.max(0, ...values);
  const yScale = (v: number) => (maxValue === 0 ? innerH : innerH - (v / maxValue) * innerH);

  // Category x positions - evenly spaced band scale.
  const bandW = innerW / Math.max(1, rows.length);
  const xForIndex = (i: number) => i * bandW + bandW / 2;

  // Y-axis tick marks.
  const yTicks = niceTicks(maxValue, 5);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block", fontFamily: "system-ui, sans-serif" }}
    >
      {/* Y-axis ticks and gridlines */}
      {yTicks.map((tick, i) => {
        const y = marginTop + yScale(tick);
        return (
          <g key={`ytick-${i}`}>
            <line
              x1={marginLeft}
              x2={marginLeft + innerW}
              y1={y}
              y2={y}
              stroke="#eee"
              strokeWidth={1}
            />
            <text
              x={marginLeft - 6}
              y={y + 4}
              textAnchor="end"
              fontSize={10}
              fill="#666"
            >
              {formatNumber(tick)}
            </text>
          </g>
        );
      })}

      {/* Y-axis title (measure field name) */}
      <text
        x={12}
        y={marginTop + innerH / 2}
        transform={`rotate(-90 12 ${marginTop + innerH / 2})`}
        textAnchor="middle"
        fontSize={11}
        fill="#333"
      >
        {measureKey}
      </text>

      {/* Data marks */}
      {isLine ? (
        <>
          <polyline
            points={rows
              .map((r, i) => `${marginLeft + xForIndex(i)},${marginTop + yScale(Number(r[measureKey]) || 0)}`)
              .join(" ")}
            fill="none"
            stroke="#4c78a8"
            strokeWidth={2}
          />
          {rows.map((r, i) => {
            const cx = marginLeft + xForIndex(i);
            const cy = marginTop + yScale(Number(r[measureKey]) || 0);
            return (
              <g key={`pt-${i}`}>
                <circle cx={cx} cy={cy} r={3} fill="#4c78a8" />
                <title>
                  {String(r[categoryKey])}: {formatNumber(Number(r[measureKey]) || 0)}
                </title>
              </g>
            );
          })}
        </>
      ) : (
        rows.map((r, i) => {
          const v = Number(r[measureKey]) || 0;
          const bw = Math.max(1, bandW * 0.7);
          const bx = marginLeft + xForIndex(i) - bw / 2;
          const by = marginTop + yScale(v);
          const bh = marginTop + innerH - by;
          return (
            <g key={`bar-${i}`}>
              <rect x={bx} y={by} width={bw} height={bh} fill="#4c78a8">
                <title>
                  {String(r[categoryKey])}: {formatNumber(v)}
                </title>
              </rect>
              {/* Value label on top of the bar - matches native Tableau behavior. */}
              {bw >= 12 && (
                <text
                  x={bx + bw / 2}
                  y={by - 3}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#333"
                >
                  {formatNumber(v)}
                </text>
              )}
            </g>
          );
        })
      )}

      {/* X-axis line */}
      <line
        x1={marginLeft}
        x2={marginLeft + innerW}
        y1={marginTop + innerH}
        y2={marginTop + innerH}
        stroke="#999"
        strokeWidth={1}
      />

      {/* X-axis category labels - rotated 45° when many categories to avoid overlap */}
      {rows.map((r, i) => {
        const cx = marginLeft + xForIndex(i);
        const cy = marginTop + innerH + 12;
        const label = String(r[categoryKey] ?? "");
        const rotate = rows.length > 6;
        return (
          <text
            key={`xlab-${i}`}
            x={cx}
            y={cy}
            fontSize={10}
            fill="#333"
            textAnchor={rotate ? "end" : "middle"}
            transform={rotate ? `rotate(-45 ${cx} ${cy})` : undefined}
          >
            {truncate(label, 24)}
          </text>
        );
      })}

      {/* X-axis title (category field name) */}
      <text
        x={marginLeft + innerW / 2}
        y={height - 4}
        textAnchor="middle"
        fontSize={11}
        fill="#333"
      >
        {categoryKey}
      </text>
    </svg>
  );
}

// ---- helpers ----

type ChartModel =
  | { error: string }
  | { rows: Record<string, unknown>[]; categoryKey: string; measureKey: string; isLine: boolean };

function buildChartModel(widget: Widget): ChartModel {
  if (!Array.isArray(widget.data) || widget.data.length === 0) {
    return { error: "No data to chart." };
  }
  const rows = widget.data as Record<string, unknown>[];
  const keys = Object.keys(rows[0]);
  if (keys.length < 2) {
    return { error: `Chart needs at least two fields, got: ${keys.join(", ") || "(none)"}` };
  }

  const isLine = widget.type === "line";

  // Prefer the measure/dimension roles the sourceQuery gives us; fall back
  // to the encoding hint from the model; fall back to value shape.
  const measureNames = new Set(
    (widget.sourceQuery?.fields || []).filter((f) => !!f.function).map((f) => f.fieldCaption)
  );
  const encColumns = widget.encoding?.columns;
  const encRows = widget.encoding?.rows;

  const isNumericByShape = (field: string) => {
    let seen = false;
    for (const r of rows) {
      const v = r[field];
      if (v === null || v === undefined || v === "") continue;
      seen = true;
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isNaN(n)) return false;
    }
    return seen;
  };

  let measureKey: string | undefined;
  let categoryKey: string | undefined;

  // First: trust sourceQuery if it tells us exactly one of the keys is a measure.
  const measureKeysFromSQ = keys.filter((k) => measureNames.has(k));
  const nonMeasureKeys = keys.filter((k) => !measureNames.has(k));
  if (measureKeysFromSQ.length === 1 && nonMeasureKeys.length >= 1) {
    measureKey = measureKeysFromSQ[0];
    // If the model also gave a category hint that matches a real key, use it.
    categoryKey = nonMeasureKeys.includes(encColumns || "")
      ? encColumns!
      : nonMeasureKeys.includes(encRows || "")
        ? encRows!
        : nonMeasureKeys[0];
  } else {
    // Second: value-shape guess. The measure is whichever field is
    // uniformly numeric; the category is the other one.
    const numericKeys = keys.filter(isNumericByShape);
    if (numericKeys.length === 1) {
      measureKey = numericKeys[0];
      categoryKey = keys.find((k) => k !== measureKey) || keys[0];
    } else if (encRows && keys.includes(encRows) && encColumns && keys.includes(encColumns)) {
      // Last resort: honour whatever the model said, even without type info.
      measureKey = encRows;
      categoryKey = encColumns;
    } else {
      // Give up: assume second key is measure (typical for our tool-call output).
      categoryKey = keys[0];
      measureKey = keys[1];
    }
  }

  if (!measureKey || !categoryKey) {
    return { error: "Couldn't determine which field is the category vs. the measure." };
  }
  return { rows, categoryKey, measureKey, isLine };
}

function longestLabel(rows: Record<string, unknown>[], key: string) {
  let m = 0;
  for (const r of rows) {
    const s = String(r[key] ?? "");
    if (s.length > m) m = s.length;
  }
  return m;
}

function longestNumberLabel(rows: Record<string, unknown>[], key: string) {
  let m = 1;
  for (const r of rows) {
    const s = formatNumber(Number(r[key]) || 0);
    if (s.length > m) m = s.length;
  }
  return m;
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function formatNumber(n: number) {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (Math.abs(n) >= 10_000) return (n / 1_000).toFixed(1) + "K";
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(2).replace(/\.?0+$/, "");
}

function niceTicks(maxValue: number, count: number): number[] {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return [0];
  const rawStep = maxValue / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = mag * (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1);
  const ticks: number[] = [];
  for (let v = 0; v <= maxValue + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}
