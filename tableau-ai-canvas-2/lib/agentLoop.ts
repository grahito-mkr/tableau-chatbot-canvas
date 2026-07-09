import Anthropic from "@anthropic-ai/sdk";
import { getDatasourceMetadata, queryDatasource, type FieldSpec, type QueryFilter } from "./tableauClient";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// ---- Tool definitions Claude can call -------------------------------------

const tools: Anthropic.Tool[] = [
  {
    name: "list_fields",
    description: "List the dimensions and measures available on the connected Tableau datasource.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "query_data",
    description:
      "Run a live query against the Tableau datasource and return real rows. Always call this before emit_widget so numbers are real, not guessed. " +
      "Any filters currently set in the user's filter bar (e.g. a date range or a selected branch) are already applied automatically to every call " +
      "of this tool - you don't need to repeat them, but you may add additional `filters` on top if the user's question asks for something more specific.",
    input_schema: {
      type: "object",
      properties: {
        fields: {
          type: "array",
          description: "Fields to select. Use `function` for measures you want aggregated.",
          items: {
            type: "object",
            properties: {
              fieldCaption: { type: "string" },
              function: { type: "string", enum: ["SUM", "AVG", "COUNT", "MIN", "MAX"] },
              sortPriority: { type: "number" }
            },
            required: ["fieldCaption"]
          }
        },
        filters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              field: { type: "string" },
              values: { type: "array", items: { type: "string" } },
              exclude: { type: "boolean" }
            },
            required: ["field", "values"]
          }
        }
      },
      required: ["fields"]
    }
  },
  {
    name: "emit_widget",
    description:
      "Emit one finished widget to render on the canvas. Call this once per chart/KPI/table you want to show. Use real data returned from query_data. " +
      "For type 'kpi', data must be exactly one row with exactly one field, and that field's value must be the number itself, e.g. [{ \"Total Leaving Employees\": 157 }] - not a label/value pair. " +
      "Bar/line charts always show the value printed above each bar/point automatically - you don't need to do anything extra for that. " +
      "encoding.color (if you set it at all) MUST be the exact name of a field that exists in `data`, used to split bars into categories/series - " +
      "it is NOT a way to set a literal color like 'green' or 'blue'. If the user asks for a specific solid color, that isn't currently supported: " +
      "just skip encoding.color and mention the limitation in your closing text reply instead of inventing a fake field name (doing so will make the chart fail to render).",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        type: { type: "string", enum: ["kpi", "bar", "line", "table"] },
        data: {
          type: "array",
          description: "Array of row objects, e.g. [{ Category: 'A', Sales: 123 }, ...]",
          items: { type: "object" }
        },
        encoding: {
          type: "object",
          description: "For bar/line charts: which fields map to columns/rows/color. Every value here must be an exact key present in `data` rows.",
          properties: {
            columns: { type: "string" },
            rows: { type: "string" },
            color: { type: "string", description: "Must be a real field name in `data` for category coloring - never a literal color name." }
          }
        }
      },
      required: ["title", "type", "data"]
    }
  }
];

export type Widget = {
  id: string;
  title: string;
  type: "kpi" | "bar" | "line" | "table";
  data: Record<string, unknown>[];
  encoding?: { columns?: string; rows?: string; color?: string };
  // The exact fields this widget's data was queried with. Captured from the
  // query_data call that preceded this widget's emit_widget call, so the
  // frontend's global filter bar can re-run the same query with new filters
  // and refresh this widget in place, without going back through the LLM.
  sourceQuery?: { fields: FieldSpec[] };
};

async function executeTool(name: string, input: any, baseFilters: QueryFilter[]): Promise<unknown> {
  switch (name) {
    case "list_fields":
      return getDatasourceMetadata();
    case "query_data": {
      // Global filter-bar filters are merged in here unconditionally, so they
      // always apply even if the model forgets to mention them - the model's
      // own filters (if any) are appended after, letting it narrow further.
      const modelFilters = (input.filters as QueryFilter[]) || [];
      return queryDatasource(input.fields as FieldSpec[], [...baseFilters, ...modelFilters]);
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}

/**
 * Runs a full Claude <-> tool-use loop for a single user request.
 * Every time the model emits a widget, `onWidget` fires immediately so the
 * caller can stream it to the browser as soon as it's ready (this is what
 * makes the canvas fill in one widget at a time instead of waiting for the
 * whole dashboard to finish).
 */
export async function runAgentLoop(
  systemPrompt: string,
  userPrompt: string,
  onWidget: (widget: Widget) => void,
  maxTurns = 8,
  baseFilters: QueryFilter[] = []
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userPrompt }];
  let widgetCounter = 0;
  let finalText = "";
  let lastError: string | null = null;
  // The fields from the most recent query_data call, so we can tag the next
  // emit_widget with the query that produced its data (see Widget.sourceQuery).
  let lastQueryFields: FieldSpec[] | null = null;

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 2048,
      system: systemPrompt,
      tools,
      messages
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      // Model is done - collect any closing text and stop.
      finalText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      if (block.name === "emit_widget") {
        widgetCounter += 1;
        const input = block.input as any;
        onWidget({
          id: `widget-${Date.now()}-${widgetCounter}`,
          title: input.title,
          type: input.type,
          data: input.data,
          encoding: input.encoding,
          ...(lastQueryFields ? { sourceQuery: { fields: lastQueryFields } } : {})
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: "widget added to canvas"
        });
        continue;
      }

      if (block.name === "query_data") {
        lastQueryFields = (block.input as any).fields || null;
      }

      try {
        const result = await executeTool(block.name, block.input, baseFilters);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result).slice(0, 8000) // keep context lean
        });
      } catch (err: any) {
        lastError = err.message;
        // eslint-disable-next-line no-console
        console.error(`[agentLoop] tool ${block.name} failed:`, err);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `error: ${err.message}`,
          is_error: true
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  if (finalText) return finalText;
  if (widgetCounter === 0 && lastError) {
    return `I couldn't fetch data from Tableau: ${lastError}`;
  }
  return "Done.";
}
