"use client";

import { useEffect, useRef, useState } from "react";
import type { Widget } from "@/lib/agentLoop";
import SimpleChart from "./SimpleChart";

export default function WidgetCard({ widget, onRemove }: { widget: Widget; onRemove: () => void }) {
  const chartAreaRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  // Bar/line charts are drawn as SVG in the browser (see SimpleChart.tsx),
  // so we just need the container's current size. ResizeObserver keeps it
  // in sync when the react-grid-layout card is resized.
  useEffect(() => {
    const el = chartAreaRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width < 20 || height < 20) return;
      setSize((prev) => {
        const w = Math.round(width);
        const h = Math.round(height);
        if (prev && prev.width === w && prev.height === h) return prev;
        return { width: w, height: h };
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e2e2",
        borderRadius: 8,
        padding: 12,
        height: "100%",
        boxSizing: "border-box",
        overflow: "hidden",
        position: "relative",
        display: "flex",
        flexDirection: "column"
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 6,
          flexShrink: 0
        }}
      >
        <strong style={{ fontSize: 13 }}>{widget.title}</strong>
        <button
          onClick={onRemove}
          title="Remove widget"
          style={{
            border: "none",
            background: "#f1f1f1",
            cursor: "pointer",
            color: "#666",
            fontSize: 16,
            lineHeight: 1,
            width: 28,
            height: 28,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0
          }}
        >
          &times;
        </button>
      </div>

      {widget.type === "kpi" && <KpiBody widget={widget} />}
      {widget.type === "table" && <TableBody widget={widget} />}

      {widget.type !== "kpi" && widget.type !== "table" && (
        <div ref={chartAreaRef} style={{ flex: 1, minHeight: 0, position: "relative" }}>
          {size && <SimpleChart widget={widget} width={size.width} height={size.height} />}
        </div>
      )}
    </div>
  );
}

function KpiBody({ widget }: { widget: Widget }) {
  const row: Record<string, unknown> = widget.data[0] || {};
  const keys = Object.keys(row);

  // Prefer a key whose value is actually numeric (or a numeric-looking string)
  // over just taking the first key, since label fields (e.g. "Metric") often
  // come first in the row the model sends.
  const numericKey = keys.find((k) => {
    const v = row[k];
    return typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)));
  });

  const value = numericKey ? row[numericKey] : keys.length ? row[keys[0]] : "-";

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 28, fontWeight: 700 }}>{String(value)}</div>
    </div>
  );
}

function TableBody({ widget }: { widget: Widget }) {
  const keys = widget.data.length ? Object.keys(widget.data[0]) : [];
  return (
    <table style={{ width: "100%", fontSize: 12, marginTop: 8, borderCollapse: "collapse" }}>
      <thead>
        <tr>
          {keys.map((k) => (
            <th key={k} style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 4 }}>
              {k}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {widget.data.slice(0, 10).map((row, i) => (
          <tr key={i}>
            {keys.map((k) => (
              <td key={k} style={{ padding: 4, borderBottom: "1px solid #f0f0f0" }}>
                {String((row as any)[k])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
