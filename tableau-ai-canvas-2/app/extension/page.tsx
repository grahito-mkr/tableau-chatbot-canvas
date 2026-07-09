"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { Responsive, WidthProvider, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { Widget } from "@/lib/agentLoop";
import type { QueryFilter } from "@/lib/tableauClient";
import WidgetCard from "./WidgetCard";
import { postSSE } from "./sse";
import { readDashboardFilters, watchDashboardFilters } from "./nativeFilters";

const ResponsiveGridLayout = WidthProvider(Responsive);

type ChatMessage = { role: "user" | "assistant"; text: string };

const SETTINGS_KEY = "canvasState";

export default function ExtensionPage() {
  const [ready, setReady] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [layout, setLayout] = useState<Layout[]>([]);
  // Filters now come from Tableau's own native filter cards on the
  // dashboard - see app/extension/nativeFilters.ts. We don't render any
  // filter UI ourselves anymore.
  const [filters, setFilters] = useState<QueryFilter[]>([]);
  const [initError, setInitError] = useState<string | null>(null);
  const nextY = useRef(0);
  const initStarted = useRef(false);
  const unwatchFilters = useRef<(() => void) | null>(null);

  function initTableau() {
    if (initStarted.current) return; // avoid double-initializing (onLoad + poll can both fire)
    if (!window.tableau) return;
    initStarted.current = true;

    window.tableau.extensions
      .initializeAsync()
      .then(() => {
        setReady(true);
        const saved = window.tableau!.extensions.settings.get(SETTINGS_KEY);
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            setWidgets(parsed.widgets || []);
            setLayout(parsed.layout || []);
          } catch {
            /* ignore corrupt settings */
          }
        }

        // Read whatever native filters are already applied, then keep
        // listening for changes for as long as the extension is open.
        readDashboardFilters(window.tableau!).then(setFilters);
        unwatchFilters.current = watchDashboardFilters(window.tableau!, setFilters);
      })
      .catch((err: any) => {
        initStarted.current = false;
        setInitError(err?.message || String(err));
      });
  }

  // Stop listening for filter changes when the page unmounts.
  useEffect(() => {
    return () => {
      if (unwatchFilters.current) unwatchFilters.current();
    };
  }, []);

  // 1. Initialize the Tableau Extensions API + restore any saved canvas.
  //
  // The <Script> tag's onLoad handles the normal case. This effect is a
  // safety net for when the script was already cached/loaded before this
  // component mounted (onLoad wouldn't fire again) - it polls briefly for
  // window.tableau to show up instead of silently giving up after one check.
  useEffect(() => {
    if (window.tableau) {
      initTableau();
      return;
    }
    const interval = setInterval(() => {
      if (window.tableau) {
        initTableau();
        clearInterval(interval);
      }
    }, 200);
    const giveUp = setTimeout(() => {
      clearInterval(interval);
      if (!initStarted.current) {
        setInitError("window.tableau never became available (script may have failed to load or been blocked).");
      }
    }, 15000);
    return () => {
      clearInterval(interval);
      clearTimeout(giveUp);
    };
  }, []);

  // 2. Persist canvas state whenever it changes. Filters aren't saved here -
  // they live in Tableau's own dashboard filters, which Tableau already
  // persists when the workbook is saved.
  useEffect(() => {
    if (!ready || !window.tableau) return;
    const t = setTimeout(() => {
      window.tableau!.extensions.settings.set(SETTINGS_KEY, JSON.stringify({ widgets, layout }));
      window.tableau!.extensions.settings.saveAsync();
    }, 500);
    return () => clearTimeout(t);
  }, [widgets, layout, ready]);

  // 3. Whenever the dashboard's native filters change, re-run every widget's
  // original query with the new filters and swap its data in place - no
  // Claude call needed, so this is fast and doesn't cost anything. Widgets
  // that predate this feature (no sourceQuery) are left untouched.
  useEffect(() => {
    const t = setTimeout(() => {
      setWidgets((prev) => {
        prev.forEach((w) => {
          if (!w.sourceQuery) return;
          fetch("/api/requery", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields: w.sourceQuery!.fields, filters })
          })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`requery failed (${r.status})`))))
            .then((json) => {
              setWidgets((cur) => cur.map((cw) => (cw.id === w.id ? { ...cw, data: json.data || [] } : cw)));
            })
            .catch((err) => {
              // eslint-disable-next-line no-console
              console.error(`[page] failed to refresh widget "${w.title}" for new filters:`, err);
            });
        });
        return prev;
      });
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  function addWidget(widget: Widget) {
    setWidgets((prev) => [...prev, widget]);
    setLayout((prev) => {
      const y = nextY.current;
      nextY.current += 4;
      return [...prev, { i: widget.id, x: (prev.length * 4) % 12, y, w: 4, h: 4 }];
    });
  }

  function removeWidget(id: string) {
    setWidgets((prev) => prev.filter((w) => w.id !== id));
    setLayout((prev) => prev.filter((l) => l.i !== id));
  }

  function tidy() {
    setLayout((prev) =>
      prev.map((l, i) => ({ ...l, x: (i * 4) % 12, y: Math.floor(i / 3) * 4, w: 4, h: 4 }))
    );
  }

  async function askQuestion() {
    if (!input.trim() || busy) return;
    const question = input.trim();
    setInput("");
    setMessages((m) => [...m, { role: "user", text: question }]);
    setBusy(true);
    try {
      await postSSE("/api/chat", { message: question, filters }, {
        onEvent: (event, data) => {
          if (event === "widget") addWidget(data as Widget);
          if (event === "done") setMessages((m) => [...m, { role: "assistant", text: data.text }]);
          if (event === "error") setMessages((m) => [...m, { role: "assistant", text: `Error: ${data.message}` }]);
        }
      });
    } finally {
      setBusy(false);
    }
  }

  async function buildDashboard() {
    if (!goal.trim() || busy) return;
    const g = goal.trim();
    setGoal("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", text: `Build dashboard: ${g}` }]);
    try {
      await postSSE("/api/build-dashboard", { goal: g, filters }, {
        onEvent: (event, data) => {
          if (event === "widget") addWidget(data as Widget); // auto-added, matches "Build Dashboard" mode
          if (event === "done") setMessages((m) => [...m, { role: "assistant", text: data.text }]);
          if (event === "error") setMessages((m) => [...m, { role: "assistant", text: `Error: ${data.message}` }]);
        }
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Script
        src="/tableau-extensions.min.js"
        strategy="afterInteractive"
        onLoad={initTableau}
        onError={() => setInitError("Failed to load /tableau-extensions.min.js (check the file was actually uploaded to public/).")}
      />
      <div style={{ display: "flex", height: "100vh", background: "#f5f6f8" }}>
        {/* Canvas */}
        <div style={{ flex: 1, padding: 12, overflow: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <strong>Canvas</strong>
            <button onClick={tidy}>Tidy</button>
          </div>
          {filters.length > 0 && (
            <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
              Using dashboard filters: {filters.map((f) => f.field).join(", ")}
            </div>
          )}
          <ResponsiveGridLayout
            className="layout"
            layouts={{ lg: layout }}
            breakpoints={{ lg: 800 }}
            cols={{ lg: 12 }}
            rowHeight={40}
            onLayoutChange={(l) => setLayout(l)}
          >
            {widgets.map((w) => (
              <div key={w.id}>
                <WidgetCard widget={w} onRemove={() => removeWidget(w.id)} />
              </div>
            ))}
          </ResponsiveGridLayout>
          {widgets.length === 0 && (
            <div style={{ color: "#999", marginTop: 40, textAlign: "center" }}>
              Ask a question or build a dashboard to fill this canvas.
            </div>
          )}
        </div>

        {/* Chat */}
        <div
          style={{
            width: 340,
            borderLeft: "1px solid #ddd",
            display: "flex",
            flexDirection: "column",
            background: "#fff"
          }}
        >
          <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <strong style={{ fontSize: 13 }}>Chat</strong>
              {messages.length > 0 && (
                <button
                  onClick={() => setMessages([])}
                  style={{ fontSize: 11, color: "#666", background: "none", border: "1px solid #ddd", borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}
                >
                  Clear
                </button>
              )}
            </div>
            {!ready && !initError && <div style={{ color: "#999" }}>Connecting to Tableau...</div>}
            {initError && (
              <div style={{ color: "crimson", fontSize: 12, whiteSpace: "pre-wrap", marginBottom: 10 }}>
                Tableau init error: {initError}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{ marginBottom: 10, textAlign: m.role === "user" ? "right" : "left" }}>
                <span
                  style={{
                    display: "inline-block",
                    background: m.role === "user" ? "#2563eb" : "#f1f1f1",
                    color: m.role === "user" ? "#fff" : "#111",
                    borderRadius: 8,
                    padding: "6px 10px",
                    fontSize: 13,
                    maxWidth: 260
                  }}
                >
                  {m.text}
                </span>
              </div>
            ))}
            {busy && <div style={{ color: "#999", fontSize: 12 }}>Working...</div>}
          </div>

          <div style={{ borderTop: "1px solid #eee", padding: 10 }}>
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Describe your dashboard goal..."
              style={{ width: "100%", padding: 6, marginBottom: 6, fontSize: 12 }}
              onKeyDown={(e) => e.key === "Enter" && buildDashboard()}
            />
            <button onClick={buildDashboard} disabled={busy} style={{ width: "100%", marginBottom: 10 }}>
              Build Dashboard
            </button>

            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question..."
              style={{ width: "100%", padding: 6, fontSize: 12 }}
              onKeyDown={(e) => e.key === "Enter" && askQuestion()}
            />
            <button onClick={askQuestion} disabled={busy} style={{ width: "100%", marginTop: 6 }}>
              Ask
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
