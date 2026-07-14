"use client";

import { useEffect, useRef, useState } from "react";
import type { Widget } from "@/lib/agentLoop";
import SimpleChart from "./SimpleChart";

export default function WidgetCard({
  widget,
  onRemove,
  refreshing,
  refreshError
}: {
  widget: Widget;
  onRemove: () => void;
  refreshing?: boolean;
  refreshError?: string;
}) {
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
          flexShrink: 0,
          gap: 6
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
          <strong style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {widget.title}
          </strong>
          {refreshing && (
            <span
              title="Refreshing for new filters..."
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 10,
                color: "#666",
                background: "#f1f5f9",
                borderRadius: 10,
                padding: "1px 8px",
                whiteSpace: "nowrap",
                flexShrink: 0
              }}
            >
              <Spinner />
              refreshing
            </span>
          )}
          {!refreshing && refreshError && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                fontSize: 10,
                color: "#c00",
                background: "#fee",
                border: "1px solid #fbb",
                borderRadius: 10,
                padding: "1px 8px",
                whiteSpace: "nowrap",
                flexShrink: 0
              }}
            >
              ⚠ stale
            </span>
          )}
        </div>
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

      {/* Always show refresh error inline. What went wrong is what users
          need to see - hiding it behind a click just adds friction. */}
      {refreshError && !refreshing && (
        <div
          style={{
            fontSize: 11,
            color: "#7a1414",
            background: "#fff5f5",
            border: "1px solid #fbb",
            borderRadius: 4,
            padding: "6px 8px",
            marginBottom: 6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 120,
            overflow: "auto",
            flexShrink: 0
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 2 }}>Refresh failed:</div>
          {refreshError}
        </div>
      )}

      {/* Dim the widget body while a refresh is in progress so users see
          visually that the numbers are being updated (but keep it visible
          rather than hiding it, so nothing "jumps" when the new data lands). */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          opacity: refreshing ? 0.5 : 1,
          transition: "opacity 150ms ease"
        }}
      >
        {widget.type === "kpi" && <KpiBody widget={widget} />}
        {widget.type === "table" && <TableBody widget={widget} />}

        {widget.type !== "kpi" && widget.type !== "table" && (
          <div ref={chartAreaRef} style={{ flex: 1, minHeight: 0, position: "relative" }}>
            {size && <SimpleChart widget={widget} width={size.width} height={size.height} />}
          </div>
        )}
      </div>
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
  const rows = widget.data || [];
  const keys = rows.length ? Object.keys(rows[0]) : [];

  // Detect which columns are numeric so we can right-align them and format
  // numbers consistently. A column counts as numeric if every non-null value
  // parses as a finite number.
  const numericCols = new Set<string>();
  for (const k of keys) {
    let seen = false;
    let allNumeric = true;
    for (const r of rows) {
      const v = (r as Record<string, unknown>)[k];
      if (v === null || v === undefined || v === "") continue;
      seen = true;
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) {
        allNumeric = false;
        break;
      }
    }
    if (seen && allNumeric) numericCols.add(k);
  }

  const formatCell = (k: string, v: unknown) => {
    if (v === null || v === undefined || v === "") return "";
    if (numericCols.has(k)) {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) return String(v);
      if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
      if (Math.abs(n) >= 10_000) return (n / 1_000).toFixed(1) + "K";
      if (Number.isInteger(n)) return n.toLocaleString();
      return n.toFixed(2).replace(/\.?0+$/, "");
    }
    return String(v);
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", marginTop: 8 }}>
      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
        <thead style={{ position: "sticky", top: 0, background: "#fff" }}>
          <tr>
            {keys.map((k) => (
              <th
                key={k}
                style={{
                  textAlign: numericCols.has(k) ? "right" : "left",
                  borderBottom: "1px solid #ccc",
                  padding: "6px 8px",
                  fontWeight: 600,
                  color: "#333",
                  whiteSpace: "nowrap"
                }}
              >
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "#fafafa" }}>
              {keys.map((k) => (
                <td
                  key={k}
                  style={{
                    padding: "5px 8px",
                    borderBottom: "1px solid #f0f0f0",
                    textAlign: numericCols.has(k) ? "right" : "left",
                    fontVariantNumeric: numericCols.has(k) ? "tabular-nums" : "normal",
                    whiteSpace: "nowrap"
                  }}
                >
                  {formatCell(k, (row as Record<string, unknown>)[k])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div style={{ padding: 12, color: "#999", fontSize: 12 }}>No rows to display.</div>
      )}
    </div>
  );
}

// Tiny inline SVG spinner. Uses SVG animateTransform (no CSS keyframes
// needed) so it works even in isolated iframe/extension contexts where a
// global stylesheet might not have loaded yet.
function Spinner() {
  return (
    <svg width={10} height={10} viewBox="0 0 24 24" style={{ display: "inline-block" }}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="#94a3b8" strokeWidth="3" opacity="0.3" />
      <path
        d="M 21 12 A 9 9 0 0 1 12 21"
        fill="none"
        stroke="#3b82f6"
        strokeWidth="3"
        strokeLinecap="round"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="0.9s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}
