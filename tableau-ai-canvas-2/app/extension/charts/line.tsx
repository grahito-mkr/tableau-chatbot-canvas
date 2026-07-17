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

export function LineOrAreaChart({
  rows,
  categoryKey,
  measureKey,
  width,
  height,
  fill
}: {
  rows: Row[];
  categoryKey: string;
  measureKey: string;
  width: number;
  height: number;
  fill: boolean; // area chart = fill true; line chart = fill false
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

  const linePoints = rows
    .map((r, i) => `${marginLeft + xForIndex(i)},${marginTop + yScale(Number(r[measureKey]) || 0)}`)
    .join(" ");

  // For area: close the polygon back down to the x-axis on both ends.
  const areaPoints = fill
    ? `${marginLeft + xForIndex(0)},${marginTop + innerH} ${linePoints} ${
        marginLeft + xForIndex(rows.length - 1)
      },${marginTop + innerH}`
    : "";

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

      {fill && (
        <polygon points={areaPoints} fill={color} fillOpacity={0.25} stroke="none" />
      )}
      <polyline points={linePoints} fill="none" stroke={color} strokeWidth={2} />
      {rows.map((r, i) => {
        const cx = marginLeft + xForIndex(i);
        const cy = marginTop + yScale(Number(r[measureKey]) || 0);
        return (
          <g key={`pt-${i}`}>
            <circle cx={cx} cy={cy} r={3} fill={color} />
            <title>
              {formatCategoryLabel(r[categoryKey])}: {formatNumber(Number(r[measureKey]) || 0)}
            </title>
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
        x={12}
        y={marginTop + innerH / 2}
        transform={`rotate(-90 12 ${marginTop + innerH / 2})`}
        textAnchor="middle"
        fontSize={11}
        fill="#333"
      >
        {measureKey}
      </text>

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
