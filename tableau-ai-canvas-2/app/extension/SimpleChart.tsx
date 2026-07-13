"use client";

import { useMemo } from "react";
import type { Widget } from "@/lib/agentLoop";

/**
 * A minimal SVG bar/line chart renderer, drawn directly in the browser
 * from the widget's data. Bypasses Tableau's createVizImageAsync entirely.
 *
 * Supports both orientations for bar charts:
 *   - orientation = 'vertical' (default): categories on X, measure on Y.
 *     This is what most people call a "column chart".
 *   - orientation = 'horizontal': measure on X, categories on Y. Bars grow
 *     from left to right. This is the "horizontal bar chart" shape - good
 *     for many categories or long labels (e.g. departments).
 *
 * Line charts are always drawn horizontally with time/category on X.
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

  const { rows, categoryKey, measureKey, isLine, orientation } = chart;

  if (!isLine && orientation === "horizontal") {
    return (
      <HorizontalBar
        rows={rows}
        categoryKey={categoryKey}
        measureKey={measureKey}
        width={width}
        height={height}
      />
    );
  }

  return (
    <VerticalChart
      rows={rows}
      categoryKey={categoryKey}
      measureKey={measureKey}
      isLine={isLine}
      width={width}
      height={height}
    />
  );
}

// ---- Vertical bar / line chart --------------------------------------------

function VerticalChart({
  rows,
  categoryKey,
  measureKey,
  isLine,
  width,
  height
}: {
  rows: Record<string, unknown>[];
  categoryKey: string;
  measureKey: string;
  isLine: boolean;
  width: number;
  height: number;
}) {
  const marginTop = 20;
  const marginRight = 12;
  const marginBottom = Math.min(90, Math.max(50, longestLabel(rows, categoryKey) * 6));
  const marginLeft = Math.max(50, longestNumberLabel(rows, measureKey) * 8 + 20);

  const innerW = Math.max(1, width - marginLeft - marginRight);
  const innerH = Math.max(1, height - marginTop - marginBottom);

  const values = rows.map((r) => Number(r[measureKey]) || 0);
  const maxValue = Math.max(0, ...values);
  const yScale = (v: number) => (maxValue === 0 ? innerH : innerH - (v / maxValue) * innerH);

  const bandW = innerW / Math.max(1, rows.length);
  const xForIndex = (i: number) => i * bandW + bandW / 2;
  const yTicks = niceTicks(maxValue, 5);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block", fontFamily: "system-ui, sans-serif" }}
    >
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
            <text x={marginLeft - 6} y={y + 4} textAnchor="end" fontSize={10} fill="#666">
              {formatNumber(tick)}
            </text>
          </g>
        );
      })}

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

      {isLine ? (
        <>
          <polyline
            points={rows
              .map(
                (r, i) => `${marginLeft + xForIndex(i)},${marginTop + yScale(Number(r[measureKey]) || 0)}`
              )
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
              {bw >= 12 && (
                <text x={bx + bw / 2} y={by - 3} textAnchor="middle" fontSize={10} fill="#333">
                  {formatNumber(v)}
                </text>
              )}
            </g>
          );
        })
      )}

      <line
        x1={marginLeft}
        x2={marginLeft + innerW}
        y1={marginTop + innerH}
        y2={marginTop + innerH}
        stroke="#999"
        strokeWidth={1}
      />

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

// ---- Horizontal bar chart -------------------------------------------------

function HorizontalBar({
  rows,
  categoryKey,
  measureKey,
  width,
  height
}: {
  rows: Record<string, unknown>[];
  categoryKey: string;
  measureKey: string;
  width: number;
  height: number;
}) {
  const marginTop = 20;
  const marginRight = 40; // room for value labels at end of bars
  // Left margin sized to fit the longest category label - horizontal bars
  // put those on the Y-axis so we need real space, not rotation. Cap at
  // ~40% of the width so extreme labels don't crowd out the bars themselves.
  const marginLeft = Math.min(
    Math.max(width * 0.35, 80),
    Math.max(80, longestLabel(rows, categoryKey) * 6 + 20)
  );
  const marginBottom = 40;

  const innerW = Math.max(1, width - marginLeft - marginRight);
  const innerH = Math.max(1, height - marginTop - marginBottom);

  const values = rows.map((r) => Number(r[measureKey]) || 0);
  const maxValue = Math.max(0, ...values);
  const xScale = (v: number) => (maxValue === 0 ? 0 : (v / maxValue) * innerW);

  const bandH = innerH / Math.max(1, rows.length);
  const yForIndex = (i: number) => i * bandH + bandH / 2;
  const xTicks = niceTicks(maxValue, 5);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block", fontFamily: "system-ui, sans-serif" }}
    >
      {/* X-axis vertical gridlines + tick labels below the chart */}
      {xTicks.map((tick, i) => {
        const x = marginLeft + xScale(tick);
        return (
          <g key={`xtick-${i}`}>
            <line
              x1={x}
              x2={x}
              y1={marginTop}
              y2={marginTop + innerH}
              stroke="#eee"
              strokeWidth={1}
            />
            <text x={x} y={marginTop + innerH + 14} textAnchor="middle" fontSize={10} fill="#666">
              {formatNumber(tick)}
            </text>
          </g>
        );
      })}

      {/* Bars, one per row */}
      {rows.map((r, i) => {
        const v = Number(r[measureKey]) || 0;
        const bh = Math.max(1, bandH * 0.7);
        const by = marginTop + yForIndex(i) - bh / 2;
        const bx = marginLeft;
        const bw = xScale(v);
        return (
          <g key={`hbar-${i}`}>
            <rect x={bx} y={by} width={bw} height={bh} fill="#4c78a8">
              <title>
                {String(r[categoryKey])}: {formatNumber(v)}
              </title>
            </rect>
            {bh >= 10 && (
              <text
                x={bx + bw + 4}
                y={by + bh / 2 + 3}
                textAnchor="start"
                fontSize={10}
                fill="#333"
              >
                {formatNumber(v)}
              </text>
            )}
          </g>
        );
      })}

      {/* Y-axis category labels, positioned to the left of each bar */}
      {rows.map((r, i) => {
        const cy = marginTop + yForIndex(i) + 3;
        const label = String(r[categoryKey] ?? "");
        return (
          <text
            key={`ylab-${i}`}
            x={marginLeft - 6}
            y={cy}
            fontSize={10}
            fill="#333"
            textAnchor="end"
          >
            {truncate(label, Math.max(10, Math.floor((marginLeft - 12) / 6)))}
          </text>
        );
      })}

      {/* Axis line on the left */}
      <line
        x1={marginLeft}
        x2={marginLeft}
        y1={marginTop}
        y2={marginTop + innerH}
        stroke="#999"
        strokeWidth={1}
      />

      {/* Y-axis title (category field name) */}
      <text
        x={12}
        y={marginTop + innerH / 2}
        transform={`rotate(-90 12 ${marginTop + innerH / 2})`}
        textAnchor="middle"
        fontSize={11}
        fill="#333"
      >
        {categoryKey}
      </text>

      {/* X-axis title (measure field name) */}
      <text
        x={marginLeft + innerW / 2}
        y={height - 4}
        textAnchor="middle"
        fontSize={11}
        fill="#333"
      >
        {measureKey}
      </text>
    </svg>
  );
}

// ---- helpers --------------------------------------------------------------

type ChartModel =
  | { error: string }
  | {
      rows: Record<string, unknown>[];
      categoryKey: string;
      measureKey: string;
      isLine: boolean;
      orientation: "vertical" | "horizontal";
    };

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
  const orientation: "vertical" | "horizontal" =
    widget.orientation === "horizontal" ? "horizontal" : "vertical";

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

  const measureKeysFromSQ = keys.filter((k) => measureNames.has(k));
  const nonMeasureKeys = keys.filter((k) => !measureNames.has(k));
  if (measureKeysFromSQ.length === 1 && nonMeasureKeys.length >= 1) {
    measureKey = measureKeysFromSQ[0];
    categoryKey = nonMeasureKeys.includes(encColumns || "")
      ? encColumns!
      : nonMeasureKeys.includes(encRows || "")
        ? encRows!
        : nonMeasureKeys[0];
  } else {
    const numericKeys = keys.filter(isNumericByShape);
    if (numericKeys.length === 1) {
      measureKey = numericKeys[0];
      categoryKey = keys.find((k) => k !== measureKey) || keys[0];
    } else if (encRows && keys.includes(encRows) && encColumns && keys.includes(encColumns)) {
      measureKey = encRows;
      categoryKey = encColumns;
    } else {
      categoryKey = keys[0];
      measureKey = keys[1];
    }
  }

  if (!measureKey || !categoryKey) {
    return { error: "Couldn't determine which field is the category vs. the measure." };
  }
  return { rows, categoryKey, measureKey, isLine, orientation };
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
