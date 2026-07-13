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
      "\n\n" +
      "ORIENTATION for type 'bar':\n" +
      "- Use orientation='vertical' (default) for a 'column chart' or any chart where the user says the CATEGORY (e.g. Department, Month) is on the X-axis and the MEASURE (e.g. count, sum) is on the Y-axis. Bars grow upward.\n" +
      "- Use orientation='horizontal' for a 'horizontal bar chart' or any chart where the user says the MEASURE is on the X-axis and the CATEGORY is on the Y-axis. Bars grow rightward.\n" +
      "- When the user says 'x axis = <measure name>' AND 'y axis = <category name>' (e.g. 'x axis total leaving employees, y axis department'), that is a HORIZONTAL bar chart - measure on X, category on Y - so use orientation='horizontal'. This is the most common way users describe horizontal bars.\n" +
      "- Common terminology: 'column chart' = vertical bars; 'bar chart' can mean either (default to vertical unless the user specifies horizontal, or asks for the measure on the X-axis).\n" +
      "\n" +
      "encoding.color (if you set it at all) MUST be the exact name of a field that exists in `data`, used to split bars into categories/series - " +
      "it is NOT a way to set a literal color like 'green' or 'blue'. If the user asks for a specific solid color, that isn't currently supported: " +
      "just skip encoding.color and mention the limitation in your closing text reply instead of inventing a fake field name (doing so will make the chart fail to render).",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        type: { type: "string", enum: ["kpi", "bar", "line", "table"] },
        orientation: {
          type: "string",
          enum: ["vertical", "horizontal"],
          description: "For type='bar' only. 'vertical' (default) = categories on X-axis, measure on Y-axis (a.k.a. column chart). 'horizontal' = measure on X-axis, categories on Y-axis (a.k.a. horizontal bar chart). See the ORIENTATION section of this tool's description for how everyday phrases map to this."
        },
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
  // For type='bar' only. Undefined defaults to 'vertical' (column chart).
  orientation?: "vertical" | "horizontal";
  data: Record<string, unknown>[];
  encoding?: { columns?: string; rows?: string; color?: string };
  // The fields this widget's data was queried with - matched by
  // field-caption overlap against the widget's own data keys (see
  // runAgentLoop), not just "whichever query_data call happened most
  // recently". Used both by vizSpec.ts (to know which field is the measure
  // vs. the dimension) and by the frontend's filter bar to re-run the same
  // query with new filters and refresh this widget in place.
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
  // Every query_data call made so far in this run, in order. When tagging an
  // emit_widget call with its sourceQuery, we match by field-caption overlap
  // against a widget's actual data keys rather than just grabbing "the most
  // recent query_data call" - Build Dashboard mode routinely issues several
  // query_data calls (one per planned widget) before their corresponding
  // emit_widget calls arrive, all within the same turn, so "most recent" is
  // frequently the WRONG query for an earlier widget. Tagging a widget with
  // the wrong query's fields silently breaks vizSpec.ts's measure/dimension
  // detection (a field gets treated as neither measure nor dimension because
  // its name isn't in the mistakenly-attached field list), which is exactly
  // what turned the monthly-trend and department charts into crosstabs.
  const allQueries: FieldSpec[][] = [];

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
        const dataKeys = new Set(
          Array.isArray(input.data) && input.data.length > 0 ? Object.keys(input.data[0]) : []
        );

        // Find the query_data call whose requested fields best match this
        // widget's actual data keys (by fieldCaption). This is what lets us
        // correctly attribute sourceQuery even when several query_data calls
        // happened earlier in the same turn, in a different order than
        // their corresponding emit_widget calls.
        let bestMatch: FieldSpec[] | null = null;
        let bestScore = 0;
        for (const fields of allQueries) {
          const score = fields.reduce((acc, f) => acc + (dataKeys.has(f.fieldCaption) ? 1 : 0), 0);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = fields;
          }
        }
        // Fall back to the most recent query if nothing matched at all
        // (e.g. the model renamed a field between query_data and
        // emit_widget) - better to attach something than nothing.
        const matchedQuery = bestMatch ?? allQueries[allQueries.length - 1] ?? null;

        onWidget({
          id: `widget-${Date.now()}-${widgetCounter}`,
          title: input.title,
          type: input.type,
          ...(input.orientation === "horizontal" || input.orientation === "vertical"
            ? { orientation: input.orientation }
            : {}),
          data: input.data,
          encoding: input.encoding,
          ...(matchedQuery ? { sourceQuery: { fields: matchedQuery } } : {})
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: "widget added to canvas"
        });
        continue;
      }

      if (block.name === "query_data") {
        const fields = (block.input as any).fields || null;
        if (fields) allQueries.push(fields);
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
