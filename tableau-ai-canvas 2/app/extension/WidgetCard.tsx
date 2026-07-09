"use client";

import { useEffect, useState } from "react";
import type { Widget } from "@/lib/agentLoop";
import { toVizInputSpec } from "./vizSpec";

export default function WidgetCard({ widget, onRemove }: { widget: Widget; onRemove: () => void }) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (widget.type !== "bar" && widget.type !== "line") return;
    const tableau = window.tableau;
    if (!tableau) return;

    let revoke: string | null = null;
    tableau.extensions
      .createVizImageAsync(toVizInputSpec(widget, tableau))
      .then((svg) => {
        const blob = new Blob([svg], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);
        revoke = url;
        setImgUrl(url);
      })
      .catch((err) => setError(String(err)));

    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget]);

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e2e2",
        borderRadius: 8,
        padding: 12,
        height: "100%",
        boxSizing: "border-box",
        overflow: "auto",
        position: "relative"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ fontSize: 13 }}>{widget.title}</strong>
        <button onClick={onRemove} style={{ border: "none", background: "none", cursor: "pointer", color: "#999" }}>
          x
        </button>
      </div>

      {widget.type === "kpi" && <KpiBody widget={widget} />}
      {widget.type === "table" && <TableBody widget={widget} />}
      {(widget.type === "bar" || widget.type === "line") && (
        <>
          {error && <div style={{ color: "crimson", fontSize: 12 }}>{error}</div>}
          {imgUrl ? (
            <img src={imgUrl} alt={widget.title} style={{ width: "100%", height: "auto" }} />
          ) : (
            !error && <div style={{ fontSize: 12, color: "#999" }}>Rendering...</div>
          )}
        </>
      )}
    </div>
  );
}

function KpiBody({ widget }: { widget: Widget }) {
  const row = widget.data[0] || {};
  const keys = Object.keys(row);
  const value = keys.length ? row[keys[0]] : "-";
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
