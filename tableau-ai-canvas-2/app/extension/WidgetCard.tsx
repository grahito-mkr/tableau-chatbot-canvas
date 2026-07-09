"use client";

import { useEffect, useState } from "react";
import type { Widget } from "@/lib/agentLoop";
import { toVizInputSpec } from "./vizSpec";

export default function WidgetCard({ widget, onRemove }: { widget: Widget; onRemove: () => void }) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string | null>(null);

  useEffect(() => {
    if (widget.type !== "bar" && widget.type !== "line") return;

    const tableau = window.tableau;
    if (!tableau) {
      setError("window.tableau is not available in this context (extension may not be fully initialized).");
      return;
    }
    if (!tableau.MarkType || !tableau.VizImageEncodingType) {
      setError(
        `tableau.MarkType or tableau.VizImageEncodingType is missing on the loaded Extensions API script (MarkType=${String(
          tableau.MarkType
        )}, VizImageEncodingType=${String(tableau.VizImageEncodingType)}).`
      );
      return;
    }

    let revoke: string | null = null;
    let settled = false;
    let spec: unknown;

    // Build the spec in its own try/catch: if this throws synchronously (e.g. a
    // missing enum property), the effect used to die silently and the card
    // would show "Rendering..." forever with no visible error.
    try {
      spec = toVizInputSpec(widget, tableau);
    } catch (err: any) {
      setError(`Failed to build chart spec: ${err?.message || String(err)}`);
      return;
    }

    setDebugInfo(JSON.stringify(spec).slice(0, 500));
    // eslint-disable-next-line no-console
    console.log("[WidgetCard] createVizImageAsync spec for", widget.title, spec);

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        setError("Timed out waiting for Tableau to render this chart (check that the encoded fields match the queried data).");
      }
    }, 10000);

    tableau.extensions
      .createVizImageAsync(spec)
      .then((svg) => {
        if (settled) return; // timed out already, ignore late resolution
        settled = true;
        clearTimeout(timeout);
        const blob = new Blob([svg], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);
        revoke = url;
        setImgUrl(url);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        // eslint-disable-next-line no-console
        console.error("[WidgetCard] createVizImageAsync failed for", widget.title, err);
        setError(err?.message ? String(err.message) : JSON.stringify(err));
      });

    return () => {
      clearTimeout(timeout);
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
          {error && (
            <div style={{ color: "crimson", fontSize: 12, whiteSpace: "pre-wrap" }}>{error}</div>
          )}
          {imgUrl ? (
            <img src={imgUrl} alt={widget.title} style={{ width: "100%", height: "auto" }} />
          ) : (
            !error && <div style={{ fontSize: 12, color: "#999" }}>Rendering...</div>
          )}
          {!imgUrl && debugInfo && (
            <div style={{ fontSize: 10, color: "#bbb", marginTop: 6, wordBreak: "break-all" }}>
              spec: {debugInfo}
            </div>
          )}
        </>
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
