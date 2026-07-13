"use client";

import { useEffect, useRef, useState } from "react";
import type { Widget } from "@/lib/agentLoop";
import { toVizInputSpec } from "./vizSpec";

export default function WidgetCard({ widget, onRemove }: { widget: Widget; onRemove: () => void }) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string | null>(null);
  const chartAreaRef = useRef<HTMLDivElement | null>(null);
  // Actual rendered pixel size of the chart area, kept in sync via
  // ResizeObserver so dragging the react-grid-layout resize handle
  // re-renders the Tableau image at the new size instead of leaving it
  // stuck at whatever size it first rendered at.
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const el = chartAreaRef.current;
    if (!el || (widget.type !== "bar" && widget.type !== "line")) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      // Ignore transient zero-size measurements (e.g. during initial mount
      // or a collapsed/hidden card) - re-requesting an image at 0x0 would
      // just fail or produce something unusable.
      if (width < 20 || height < 20) return;
      setSize((prev) => {
        // Round to avoid re-render loops from sub-pixel ResizeObserver noise.
        const w = Math.round(width);
        const h = Math.round(height);
        if (prev && prev.width === w && prev.height === h) return prev;
        return { width: w, height: h };
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [widget.type]);

  useEffect(() => {
    if (widget.type !== "bar" && widget.type !== "line") return;
    // Wait for the first real size measurement before the first render, so
    // we don't render once at a default size and immediately again at the
    // measured size (double flicker / double Tableau call on every mount).
    if (!size) return;

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
      spec = toVizInputSpec(widget, tableau, size);
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
  }, [widget, size]);

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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", position: "relative", zIndex: 2 }}>
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
      {(widget.type === "bar" || widget.type === "line") && (
        <div
          ref={chartAreaRef}
          style={{ width: "100%", height: "calc(100% - 36px)", position: "relative" }}
        >
          {error && (
            <div style={{ color: "crimson", fontSize: 12, whiteSpace: "pre-wrap" }}>{error}</div>
          )}
          {imgUrl ? (
            // Rendered at the size we told Tableau to target (maxWidth/
            // maxHeight in the spec), so it's shown at native size rather
            // than stretched via CSS - stretching a small default-size
            // image doesn't recover the label legibility that comes from
            // Tableau actually laying out the chart for this pixel size.
            <img src={imgUrl} alt={widget.title} style={{ maxWidth: "100%", maxHeight: "100%", display: "block" }} />
          ) : (
            !error && <div style={{ fontSize: 12, color: "#999" }}>Rendering...</div>
          )}
          {!imgUrl && debugInfo && (
            <div style={{ fontSize: 10, color: "#bbb", marginTop: 6, wordBreak: "break-all" }}>
              spec: {debugInfo}
            </div>
          )}
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
