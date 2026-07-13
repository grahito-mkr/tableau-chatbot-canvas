"use client";

import {
  colorForIndex,
  formatNumber,
  niceRangeTicks,
  truncate
} from "./shared";

type Row = Record<string, unknown>;

export function ScatterChart({
  rows,
  xKey,
  yKey,
  categoryKey,
  labelKey,
  width,
  height
}: {
  rows: Row[];
  xKey: string;
  yKey: string;
  // Optional grouping key that determines point color (one color per distinct value).
  categoryKey?: string;
  // Optional label field for point tooltips (typically the row identifier, e.g. name).
  labelKey?: string;
  width: number;
  height: number;
}) {
  const marginTop = 20;
  const marginRight = categoryKey ? 140 : 16;
  const marginBottom = 50;
  const marginLeft = 60;

  const innerW = Math.max(1, width - marginLeft - marginRight);
  const innerH = Math.max(1, height - marginTop - marginBottom);

  const xs = rows.map((r) => Number(r[xKey]) || 0);
  const ys = rows.map((r) => Number(r[yKey]) || 0);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);

  const xTicks = niceRangeTicks(xMin, xMax, 5);
  const yTicks = niceRangeTicks(yMin, yMax, 5);
  const xLo = xTicks[0];
  const xHi = xTicks[xTicks.length - 1];
  const yLo = yTicks[0];
  const yHi = yTicks[yTicks.length - 1];

  const xScale = (v: number) => (xHi === xLo ? innerW / 2 : ((v - xLo) / (xHi - xLo)) * innerW);
  const yScale = (v: number) => (yHi === yLo ? innerH / 2 : innerH - ((v - yLo) / (yHi - yLo)) * innerH);

  // Distinct categories → color map (only if a categoryKey was passed).
  const categoryValues = categoryKey
    ? Array.from(new Set(rows.map((r) => String(r[categoryKey] ?? ""))))
    : [];
  const categoryColor = (cat: string) => {
    if (!categoryKey) return colorForIndex(0);
    const idx = categoryValues.indexOf(cat);
    return colorForIndex(idx < 0 ? 0 : idx);
  };

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
        const cx = marginLeft + xScale(Number(r[xKey]) || 0);
        const cy = marginTop + yScale(Number(r[yKey]) || 0);
        const cat = categoryKey ? String(r[categoryKey] ?? "") : "";
        const label = labelKey ? String(r[labelKey] ?? "") : cat;
        return (
          <circle key={`pt-${i}`} cx={cx} cy={cy} r={4} fill={categoryColor(cat)} fillOpacity={0.75}>
            <title>
              {label ? `${label}\n` : ""}
              {xKey}: {formatNumber(Number(r[xKey]) || 0)}
              {"\n"}
              {yKey}: {formatNumber(Number(r[yKey]) || 0)}
            </title>
          </circle>
        );
      })}

      {/* Axes */}
      <line
        x1={marginLeft}
        x2={marginLeft + innerW}
        y1={marginTop + innerH}
        y2={marginTop + innerH}
        stroke="#999"
        strokeWidth={1}
      />
      <line
        x1={marginLeft}
        x2={marginLeft}
        y1={marginTop}
        y2={marginTop + innerH}
        stroke="#999"
        strokeWidth={1}
      />

      {/* Axis titles */}
      <text
        x={marginLeft + innerW / 2}
        y={height - 4}
        textAnchor="middle"
        fontSize={11}
        fill="#333"
      >
        {xKey}
      </text>
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

      {/* Category legend on the right */}
      {categoryKey && (
        <g transform={`translate(${marginLeft + innerW + 12} ${marginTop})`}>
          <text x={0} y={0} fontSize={11} fill="#333" fontWeight="bold">
            {categoryKey}
          </text>
          {categoryValues.map((cat, i) => (
            <g key={`leg-${i}`} transform={`translate(0 ${14 + i * 14})`}>
              <circle cx={5} cy={5} r={4} fill={colorForIndex(i)} />
              <text x={14} y={9} fontSize={10} fill="#333">
                {truncate(cat || "(blank)", 18)}
              </text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}
