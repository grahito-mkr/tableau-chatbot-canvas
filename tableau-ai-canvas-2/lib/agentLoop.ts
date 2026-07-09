import Anthropic from "@anthropic-ai/sdk";
import { getDatasourceMetadata, queryDatasource, type FieldSpec, type SetFilter } from "./tableauClient";

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
      "Run a live query against the Tableau datasource and return real rows. Always call this before emit_widget so numbers are real, not guessed.",
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
      "Emit one finished widget to render on the canvas. Call this once per chart/KPI/table you want to show. Use real data returned from query_data.",
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
          description: "For bar/line charts: which fields map to columns/rows/color.",
          properties: {
            columns: { type: "string" },
            rows: { type: "string" },
            color: { type: "string" }
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
};

async function executeTool(name: string, input: any): Promise<unknown> {
  switch (name) {
    case "list_fields":
      return getDatasourceMetadata();
    case "query_data":
      return queryDatasource(input.fields as FieldSpec[], (input.filters as SetFilter[]) || []);
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
  maxTurns = 8
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userPrompt }];
  let widgetCounter = 0;
  let finalText = "";

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
          encoding: input.encoding
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: "widget added to canvas"
        });
        continue;
      }

      try {
        const result = await executeTool(block.name, block.input);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result).slice(0, 8000) // keep context lean
        });
      } catch (err: any) {
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

  return finalText || "Done.";
}
