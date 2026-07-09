import { runAgentLoop, type Widget } from "@/lib/agentLoop";

export const runtime = "nodejs";
export const maxDuration = 300; // dashboards take longer - several sequential queries

const SYSTEM_PROMPT = `You are building a Tableau dashboard canvas for the user.
Given a one-line goal, plan 4-8 widgets (a mix of kpi, bar, line, table) that would
make a useful dashboard for that goal. For EACH widget: first call list_fields if
needed, then query_data to get real numbers, then call emit_widget with that data.
Do this widget by widget - call emit_widget as soon as each one's data is ready,
don't wait until the end. Finish with one short sentence summarizing the dashboard.`;

export async function POST(req: Request) {
  const { goal } = await req.json();

  if (!goal || typeof goal !== "string") {
    return new Response("Missing `goal`", { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const finalText = await runAgentLoop(
          SYSTEM_PROMPT,
          `Build a dashboard for: ${goal}`,
          (widget: Widget) => send("widget", widget),
          14 // dashboards need more tool turns than a single Q&A
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
