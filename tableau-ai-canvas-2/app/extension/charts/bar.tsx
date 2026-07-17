"use client";

import {
  colorForIndex,
  formatCategoryLabel,
  formatNumber,
  longestLabel,
  longestNumberLabel,
  niceTicks,
  truncate
} from "./shared";

type Row = Record<string, unknown>;

export function VerticalBar({
  rows,
  categoryKey,
  measureKey,
  width,
  height
}: {
  rows: Row[];
  categoryKey: string;
  measureKey: string;
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
  const color = colorForIndex(0);

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

      {rows.map((r, i) => {
        const v = Number(r[measureKey]) || 0;
        const bw = Math.max(1, bandW * 0.7);
        const bx = marginLeft + xForIndex(i) - bw / 2;
        const by = marginTop + yScale(v);
        const bh = marginTop + innerH - by;
        return (
          <g key={`bar-${i}`}>
            <rect x={bx} y={by} width={bw} height={bh} fill={color}>
              <title>
                {formatCategoryLabel(r[categoryKey])}: {formatNumber(v)}
              </title>
            </rect>
            {bw >= 12 && (
              <text x={bx + bw / 2} y={by - 3} textAnchor="middle" fontSize={10} fill="#333">
                {formatNumber(v)}
              </text>
            )}
          </g>
        );
      })}

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
        const label = formatCategoryLabel(r[categoryKey]);
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

export function HorizontalBar({
  rows,
  categoryKey,
  measureKey,
  width,
  height
}: {
  rows: Row[];
  categoryKey: string;
  measureKey: string;
  width: number;
  height: number;
}) {
  const marginTop = 20;
  const marginRight = 40;
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
  const color = colorForIndex(0);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block", fontFamily: "system-ui, sans-serif" }}
    >
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

      {rows.map((r, i) => {
        const v = Number(r[measureKey]) || 0;
        const bh = Math.max(1, bandH * 0.7);
        const by = marginTop + yForIndex(i) - bh / 2;
        const bx = marginLeft;
        const bw = xScale(v);
        return (
          <g key={`hbar-${i}`}>
            <rect x={bx} y={by} width={bw} height={bh} fill={color}>
              <title>
                {formatCategoryLabel(r[categoryKey])}: {formatNumber(v)}
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

      {rows.map((r, i) => {
        const cy = marginTop + yForIndex(i) + 3;
        const label = formatCategoryLabel(r[categoryKey]);
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

      <line
        x1={marginLeft}
        x2={marginLeft}
        y1={marginTop}
        y2={marginTop + innerH}
        stroke="#999"
        strokeWidth={1}
      />

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
