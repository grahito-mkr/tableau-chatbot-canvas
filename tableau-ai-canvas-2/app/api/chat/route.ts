import { runAgentLoop, type Widget } from "@/lib/agentLoop";

export const runtime = "nodejs";
export const maxDuration = 120;

const SYSTEM_PROMPT = `You are a data analyst embedded inside a Tableau dashboard.
Answer the user's question using real data only - always call query_data (after
list_fields if you're unsure of exact field names) before making any claim with
numbers. When a chart or KPI would help answer the question, call emit_widget
with the real data you queried. Keep prose answers short (2-4 sentences).`;

export async function POST(req: Request) {
  const { message } = await req.json();

  if (!message || typeof message !== "string") {
    return new Response("Missing `message`", { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const finalText = await runAgentLoop(SYSTEM_PROMPT, message, (widget: Widget) => {
          send("widget", widget);
        });
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
