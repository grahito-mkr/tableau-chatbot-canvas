import { runAgentLoop, type Widget } from "@/lib/agentLoop";
import { describeFilters } from "@/lib/filters";
import type { QueryFilter } from "@/lib/tableauClient";

export const runtime = "nodejs";
export const maxDuration = 120;

const SYSTEM_PROMPT = `You are a data analyst embedded inside a Tableau dashboard.
Answer the user's question using real data only - always call query_data (after
list_fields if you're unsure of exact field names) before making any claim with
numbers. When a chart or KPI would help answer the question, call emit_widget
with the real data you queried. Keep prose answers short (2-4 sentences). If
filters are active, your answer describes the filtered data, not the whole
dataset - mention the filter briefly if it's relevant.`;

export async function POST(req: Request) {
  const { message, filters } = await req.json();

  if (!message || typeof message !== "string") {
    return new Response("Missing `message`", { status: 400 });
  }
  const activeFilters: QueryFilter[] = Array.isArray(filters) ? filters : [];
  const filterLine = describeFilters(activeFilters);
  const userPrompt = filterLine ? `${filterLine}\n\n${message}` : message;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const finalText = await runAgentLoop(
          SYSTEM_PROMPT,
          userPrompt,
          (widget: Widget) => send("widget", widget),
          8,
          activeFilters
        );
        send("done", { text: finalText });
      } catch (err: any) {
        send("error", { message: err.message });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
