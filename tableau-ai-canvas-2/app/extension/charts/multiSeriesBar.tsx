"use client";

import {
  colorForIndex,
  formatNumber,
  longestLabel,
  niceTicks,
  truncate
} from "./shared";

type Row = Record<string, unknown>;

/**
 * Data shape expected: flat rows with three keys - the category, the series
 * (color-splitter), and the measure. Example:
 *   [{Region: "West", Product: "A", Sales: 100}, {Region: "West", Product: "B", Sales: 60}, ...]
 * The chart groups by category and stacks or groups by series.
 */
export function MultiSeriesBar({
  rows,
  categoryKey,
  seriesKey,
  measureKey,
  width,
  height,
  stacked
}: {
  rows: Row[];
  categoryKey: string;
  seriesKey: string;
  measureKey: string;
  width: number;
  height: number;
  stacked: boolean; // true = stacked, false = grouped (side-by-side)
}) {
  // Pivot flat rows into {category: {series: value}}.
  const categoriesInOrder: string[] = [];
  const seriesInOrder: string[] = [];
  const byCategory: Record<string, Record<string, number>> = {};

  for (const r of rows) {
    const c = String(r[categoryKey] ?? "");
    const s = String(r[seriesKey] ?? "");
    const v = Number(r[measureKey]) || 0;
    if (!byCategory[c]) {
      byCategory[c] = {};
      categoriesInOrder.push(c);
    }
    if (!seriesInOrder.includes(s)) seriesInOrder.push(s);
    byCategory[c][s] = (byCategory[c][s] || 0) + v;
  }

  const categoryTotals = categoriesInOrder.map((c) =>
    seriesInOrder.reduce((sum, s) => sum + (byCategory[c][s] || 0), 0)
  );
  const maxValue = stacked
    ? Math.max(0, ...categoryTotals)
    : Math.max(
        0,
        ...categoriesInOrder.flatMap((c) => seriesInOrder.map((s) => byCategory[c][s] || 0))
      );

  const marginTop = 20;
  const marginRight = 140; // legend space
  const marginBottom = Math.min(90, Math.max(50, longestLabel(rows, categoryKey) * 6));
  const marginLeft = 60;

  const innerW = Math.max(1, width - marginLeft - marginRight);
  const innerH = Math.max(1, height - marginTop - marginBottom);
  const yScale = (v: number) => (maxValue === 0 ? innerH : innerH - (v / maxValue) * innerH);
  const yTicks = niceTicks(maxValue, 5);
  const bandW = innerW / Math.max(1, categoriesInOrder.length);

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

      {categoriesInOrder.map((cat, ci) => {
        const groupCenterX = marginLeft + ci * bandW + bandW / 2;

        if (stacked) {
          // Stack each series on top of the previous, from bottom up.
          let cumulative = 0;
          const barW = Math.max(1, bandW * 0.7);
          const barX = groupCenterX - barW / 2;
          return (
            <g key={`cat-${ci}`}>
              {seriesInOrder.map((series, si) => {
                const v = byCategory[cat][series] || 0;
                const y0 = marginTop + yScale(cumulative);
                const y1 = marginTop + yScale(cumulative + v);
                cumulative += v;
                return (
                  <rect
                    key={`stack-${ci}-${si}`}
                    x={barX}
                    y={y1}
                    width={barW}
                    height={y0 - y1}
                    fill={colorForIndex(si)}
                  >
                    <title>
                      {cat} — {series}: {formatNumber(v)}
                    </title>
                  </rect>
                );
              })}
            </g>
          );
        } else {
          // Side-by-side grouped bars.
          const seriesGap = 2;
          const groupInnerW = bandW * 0.85;
          const oneBarW = Math.max(1, (groupInnerW - seriesGap * (seriesInOrder.length - 1)) / seriesInOrder.length);
          const groupStartX = groupCenterX - groupInnerW / 2;
          return (
            <g key={`cat-${ci}`}>
              {seriesInOrder.map((series, si) => {
                const v = byCategory[cat][series] || 0;
                const bx = groupStartX + si * (oneBarW + seriesGap);
                const by = marginTop + yScale(v);
                const bh = marginTop + innerH - by;
                return (
                  <rect
                    key={`grp-${ci}-${si}`}
                    x={bx}
                    y={by}
                    width={oneBarW}
                    height={bh}
                    fill={colorForIndex(si)}
                  >
                    <title>
                      {cat} — {series}: {formatNumber(v)}
                    </title>
                  </rect>
                );
              })}
            </g>
          );
        }
      })}

      <line
        x1={marginLeft}
        x2={marginLeft + innerW}
        y1={marginTop + innerH}
        y2={marginTop + innerH}
        stroke="#999"
        strokeWidth={1}
      />

      {categoriesInOrder.map((cat, ci) => {
        const cx = marginLeft + ci * bandW + bandW / 2;
        const cy = marginTop + innerH + 12;
        const rotate = categoriesInOrder.length > 6;
        return (
          <text
            key={`xlab-${ci}`}
            x={cx}
            y={cy}
            fontSize={10}
            fill="#333"
            textAnchor={rotate ? "end" : "middle"}
            transform={rotate ? `rotate(-45 ${cx} ${cy})` : undefined}
          >
            {truncate(cat, 24)}
          </text>
        );
      })}

      {/* Axis titles */}
      <text
        x={marginLeft + innerW / 2}
        y={height - 4}
        textAnchor="middle"
        fontSize={11}
        fill="#333"
      >
        {categoryKey}
      </text>
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

      {/* Series legend */}
      <g transform={`translate(${marginLeft + innerW + 12} ${marginTop})`}>
        <text x={0} y={0} fontSize={11} fill="#333" fontWeight="bold">
          {seriesKey}
        </text>
        {seriesInOrder.map((s, i) => (
          <g key={`leg-${i}`} transform={`translate(0 ${14 + i * 14})`}>
            <rect width={10} height={10} fill={colorForIndex(i)} />
            <text x={14} y={9} fontSize={10} fill="#333">
              {truncate(s, 18)}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}
