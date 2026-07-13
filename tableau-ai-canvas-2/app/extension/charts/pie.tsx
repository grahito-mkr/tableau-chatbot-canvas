"use client";

import { colorForIndex, formatNumber, formatPercent, truncate } from "./shared";

type Row = Record<string, unknown>;

export function PieChart({
  rows,
  categoryKey,
  measureKey,
  width,
  height,
  donut
}: {
  rows: Row[];
  categoryKey: string;
  measureKey: string;
  width: number;
  height: number;
  donut: boolean;
}) {
  const values = rows.map((r) => Math.max(0, Number(r[measureKey]) || 0));
  const total = values.reduce((a, b) => a + b, 0);
  if (total === 0) {
    return <div style={{ fontSize: 12, padding: 8, color: "#666" }}>All values are zero — nothing to chart.</div>;
  }

  // Reserve legend space on the right, or below if the container is very narrow.
  const legendBelow = width < 320;
  const legendReservedWidth = legendBelow ? 0 : Math.min(180, Math.max(120, width * 0.35));
  const legendReservedHeight = legendBelow ? Math.min(rows.length * 16 + 8, height * 0.4) : 0;

  const pieW = width - legendReservedWidth;
  const pieH = height - legendReservedHeight;
  const cx = pieW / 2;
  const cy = pieH / 2;
  const outerR = Math.min(pieW, pieH) / 2 - 20;
  const innerR = donut ? outerR * 0.55 : 0;

  // Slice angles.
  let angleStart = -Math.PI / 2; // start at 12 o'clock
  const slices = rows.map((r, i) => {
    const v = values[i];
    const frac = v / total;
    const angleEnd = angleStart + frac * Math.PI * 2;
    const path = arcPath(cx, cy, outerR, innerR, angleStart, angleEnd);
    const midAngle = (angleStart + angleEnd) / 2;
    const labelX = cx + Math.cos(midAngle) * (outerR * 0.6 + innerR * 0.4);
    const labelY = cy + Math.sin(midAngle) * (outerR * 0.6 + innerR * 0.4);
    const slice = {
      index: i,
      category: String(r[categoryKey] ?? ""),
      value: v,
      frac,
      path,
      color: colorForIndex(i),
      labelX,
      labelY,
      // Only show inline % label for slices big enough to fit readable text.
      showInlineLabel: frac >= 0.06
    };
    angleStart = angleEnd;
    return slice;
  });

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block", fontFamily: "system-ui, sans-serif" }}
    >
      {slices.map((s) => (
        <g key={`slice-${s.index}`}>
          <path d={s.path} fill={s.color} stroke="#fff" strokeWidth={1}>
            <title>
              {s.category}: {formatNumber(s.value)} ({formatPercent(s.frac)})
            </title>
          </path>
          {s.showInlineLabel && (
            <text
              x={s.labelX}
              y={s.labelY + 3}
              textAnchor="middle"
              fontSize={11}
              fill="#fff"
              style={{ pointerEvents: "none" }}
            >
              {formatPercent(s.frac)}
            </text>
          )}
        </g>
      ))}

      {/* Legend */}
      {legendBelow ? (
        <g transform={`translate(8 ${pieH + 4})`}>
          {slices.map((s, i) => (
            <g key={`leg-${i}`} transform={`translate(0 ${i * 14})`}>
              <rect width={10} height={10} fill={s.color} />
              <text x={14} y={9} fontSize={10} fill="#333">
                {truncate(s.category, 32)} — {formatNumber(s.value)}
              </text>
            </g>
          ))}
        </g>
      ) : (
        <g transform={`translate(${pieW + 8} ${Math.max(8, cy - slices.length * 8)})`}>
          {slices.map((s, i) => (
            <g key={`leg-${i}`} transform={`translate(0 ${i * 16})`}>
              <rect width={10} height={10} fill={s.color} />
              <text x={14} y={9} fontSize={10} fill="#333">
                {truncate(s.category, 22)} — {formatNumber(s.value)}
              </text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

// Build an SVG arc path for one slice, supporting both pie (innerR=0) and
// donut (innerR>0). The math is standard "large-arc-flag" SVG stuff.
function arcPath(cx: number, cy: number, outerR: number, innerR: number, a0: number, a1: number) {
  const largeArc = a1 - a0 > Math.PI ? 1 : 0;
  const x0o = cx + Math.cos(a0) * outerR;
  const y0o = cy + Math.sin(a0) * outerR;
  const x1o = cx + Math.cos(a1) * outerR;
  const y1o = cy + Math.sin(a1) * outerR;

  if (innerR <= 0) {
    return `M ${cx} ${cy} L ${x0o} ${y0o} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x1o} ${y1o} Z`;
  }
  const x0i = cx + Math.cos(a0) * innerR;
  const y0i = cy + Math.sin(a0) * innerR;
  const x1i = cx + Math.cos(a1) * innerR;
  const y1i = cy + Math.sin(a1) * innerR;
  return (
    `M ${x0o} ${y0o} ` +
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x1o} ${y1o} ` +
    `L ${x1i} ${y1i} ` +
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x0i} ${y0i} ` +
    `Z`
  );
}
