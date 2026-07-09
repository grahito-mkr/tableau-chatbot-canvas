import { runAgentLoop, type Widget } from "@/lib/agentLoop";
import { describeFilters } from "@/lib/filters";
import type { QueryFilter } from "@/lib/tableauClient";

export const runtime = "nodejs";
export const maxDuration = 300; // dashboards take longer - several sequential queries

const SYSTEM_PROMPT = `You are building a Tableau dashboard canvas for the user.
Given a one-line goal, decide how many widgets to build: if the user's goal states
or implies a specific number or a single specific chart (e.g. "just one chart",
"I need 1", "build 2 widgets"), build exactly that many - no more, no less. Only
when the user does NOT specify a count should you default to planning 3-4 widgets
(a mix of kpi, bar, line, table) yourself. Call list_fields at most once at the
start if needed. For EACH widget: call query_data to get real numbers, then call
emit_widget with that data - do this widget by widget, calling emit_widget as soon
as each one's data is ready. You have a limited number of turns, so budget
carefully: once you've built the number of widgets you decided on, stop planning
more and finish with one short sentence summarizing the dashboard. Never leave the
conversation without a final text reply after your widgets. If filters are active,
every widget you build is already scoped to them - no need to build a separate
"filtered" version. If the user is correcting or clarifying a previous request
(e.g. "why did you build 3? I need 1"), treat this as a fresh instruction for a
brand-new dashboard - do not add to or repeat widgets from earlier in the
conversation.`;

export async function POST(req: Request) {
  const { goal, filters } = await req.json();

  if (!goal || typeof goal !== "string") {
    return new Response("Missing `goal`", { status: 400 });
  }
  const activeFilters: QueryFilter[] = Array.isArray(filters) ? filters : [];
  const filterLine = describeFilters(activeFilters);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const finalText = await runAgentLoop(
          SYSTEM_PROMPT,
          `Build a dashboard for: ${goal}${filterLine ? `\n\n${filterLine}` : ""}`,
          (widget: Widget) => send("widget", widget),
          24, // dashboards need more tool turns than a single Q&A
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
