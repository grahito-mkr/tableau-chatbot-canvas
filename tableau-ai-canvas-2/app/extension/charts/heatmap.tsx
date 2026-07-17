"use client";

import { formatCategoryLabel, formatNumber, longestLabel, truncate } from "./shared";

type Row = Record<string, unknown>;

export function Heatmap({
  rows,
  xKey,
  yKey,
  measureKey,
  width,
  height
}: {
  rows: Row[];
  xKey: string;
  yKey: string;
  measureKey: string;
  width: number;
  height: number;
}) {
  // Distinct x and y labels, preserving first-seen order.
  const xLabels: string[] = [];
  const yLabels: string[] = [];
  const cellMap: Record<string, number> = {};

  for (const r of rows) {
    // Keep raw stringified value as the bucket key so identical
    // dates/values from different sources (initial build vs. requery)
    // group into the same cell even if their display format differs.
    const x = String(r[xKey] ?? "");
    const y = String(r[yKey] ?? "");
    const v = Number(r[measureKey]) || 0;
    if (!xLabels.includes(x)) xLabels.push(x);
    if (!yLabels.includes(y)) yLabels.push(y);
    const key = x + "\u0001" + y; // unlikely-to-collide separator
    cellMap[key] = (cellMap[key] || 0) + v;
  }

  const values = Object.values(cellMap);
  const maxValue = Math.max(0, ...values);

  const marginTop = 20;
  const marginRight = 12;
  const marginBottom = Math.min(90, Math.max(50, longestLabel(rows, xKey) * 6));
  const marginLeft = Math.max(60, longestLabel(rows, yKey) * 6 + 20);

  const innerW = Math.max(1, width - marginLeft - marginRight);
  const innerH = Math.max(1, height - marginTop - marginBottom);
  const cellW = innerW / Math.max(1, xLabels.length);
  const cellH = innerH / Math.max(1, yLabels.length);

  // Simple sequential color scale (light -> dark blue).
  const colorFor = (v: number) => {
    if (maxValue === 0) return "#eee";
    const t = v / maxValue;
    // Interpolate between #eaf2fa and #1f4e79.
    const r = Math.round(234 + (31 - 234) * t);
    const g = Math.round(242 + (78 - 242) * t);
    const b = Math.round(250 + (121 - 250) * t);
    return `rgb(${r}, ${g}, ${b})`;
  };
  // Choose text color that reads on the cell fill.
  const textColorFor = (v: number) => {
    if (maxValue === 0) return "#666";
    return v / maxValue > 0.55 ? "#fff" : "#333";
  };

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block", fontFamily: "system-ui, sans-serif" }}
    >
      {/* Cells */}
      {yLabels.map((y, yi) =>
        xLabels.map((x, xi) => {
          const v = cellMap[x + "\u0001" + y] || 0;
          const cx = marginLeft + xi * cellW;
          const cy = marginTop + yi * cellH;
          return (
            <g key={`cell-${xi}-${yi}`}>
              <rect
                x={cx}
                y={cy}
                width={cellW - 1}
                height={cellH - 1}
                fill={colorFor(v)}
              >
                <title>
                  {formatCategoryLabel(x)} × {formatCategoryLabel(y)}: {formatNumber(v)}
                </title>
              </rect>
              {cellW >= 30 && cellH >= 16 && (
                <text
                  x={cx + cellW / 2}
                  y={cy + cellH / 2 + 3}
                  textAnchor="middle"
                  fontSize={10}
                  fill={textColorFor(v)}
                >
                  {v === 0 ? "" : formatNumber(v)}
                </text>
              )}
            </g>
          );
        })
      )}

      {/* Y-axis labels */}
      {yLabels.map((y, yi) => (
        <text
          key={`ylab-${yi}`}
          x={marginLeft - 6}
          y={marginTop + yi * cellH + cellH / 2 + 3}
          textAnchor="end"
          fontSize={10}
          fill="#333"
        >
          {truncate(formatCategoryLabel(y), Math.max(10, Math.floor((marginLeft - 12) / 6)))}
        </text>
      ))}

      {/* X-axis labels */}
      {xLabels.map((x, xi) => {
        const cx = marginLeft + xi * cellW + cellW / 2;
        const cy = marginTop + innerH + 12;
        const rotate = xLabels.length > 6;
        return (
          <text
            key={`xlab-${xi}`}
            x={cx}
            y={cy}
            fontSize={10}
            fill="#333"
            textAnchor={rotate ? "end" : "middle"}
            transform={rotate ? `rotate(-45 ${cx} ${cy})` : undefined}
          >
            {truncate(formatCategoryLabel(x), 24)}
          </text>
        );
      })}

      {/* Axis titles */}
      <text
        x={12}
        y={marginTop + innerH / 2}
        transform={`rotate(-90 12 ${marginTop + innerH / 2})`}
        textAnchor="middle"
        fontSize={11}
        fill="#333"
      >
        {yKey}
      </text>
      <text
        x={marginLeft + innerW / 2}
        y={height - 4}
        textAnchor="middle"
        fontSize={11}
        fill="#333"
      >
        {xKey}
      </text>
    </svg>
  );
}
