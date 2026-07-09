"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { Responsive, WidthProvider, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { Widget } from "@/lib/agentLoop";
import WidgetCard from "./WidgetCard";
import { postSSE } from "./sse";

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
  const nextY = useRef(0);

  // 1. Initialize the Tableau Extensions API + restore any saved canvas.
  useEffect(() => {
    if (!window.tableau) return;
    window.tableau.extensions.initializeAsync().then(() => {
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
    });
  }, []);

  // 2. Persist canvas state whenever it changes.
  useEffect(() => {
    if (!ready || !window.tableau) return;
    const t = setTimeout(() => {
      window.tableau!.extensions.settings.set(SETTINGS_KEY, JSON.stringify({ widgets, layout }));
      window.tableau!.extensions.settings.saveAsync();
    }, 500);
    return () => clearTimeout(t);
  }, [widgets, layout, ready]);

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
      await postSSE("/api/chat", { message: question }, {
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
    setBusy(true);
    setMessages((m) => [...m, { role: "user", text: `Build dashboard: ${g}` }]);
    try {
      await postSSE("/api/build-dashboard", { goal: g }, {
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
      <Script src="https://tableau.github.io/extensions-api/lib/tableau.extensions.1.latest.js" strategy="beforeInteractive" />
      <div style={{ display: "flex", height: "100vh", background: "#f5f6f8" }}>
        {/* Canvas */}
        <div style={{ flex: 1, padding: 12, overflow: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <strong>Canvas</strong>
            <button onClick={tidy}>Tidy</button>
          </div>
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
            {!ready && <div style={{ color: "#999" }}>Connecting to Tableau...</div>}
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
