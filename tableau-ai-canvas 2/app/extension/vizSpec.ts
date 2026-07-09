import type { Widget } from "@/lib/agentLoop";

/**
 * Turn one of our widgets into a Tableau Viz `inputSpec` for bar/line types.
 * KPI and table widgets are rendered directly as DOM (see WidgetCard) since
 * they don't need Tableau's chart renderer.
 */
export function toVizInputSpec(widget: Widget, tableau: NonNullable<Window["tableau"]>) {
  const columnsField = widget.encoding?.columns;
  const rowsField = widget.encoding?.rows;

  // Fall back to the first two keys of the data if the model didn't specify
  // an encoding explicitly.
  const keys = widget.data.length > 0 ? Object.keys(widget.data[0]) : [];
  const col = columnsField || keys[0];
  const row = rowsField || keys[1];

  return {
    description: widget.title,
    data: { values: widget.data },
    mark: widget.type === "line" ? tableau.MarkType.Line : tableau.MarkType.Bar,
    encoding: {
      columns: { field: col, type: tableau.VizImageEncodingType.Discrete },
      rows: { field: row, type: tableau.VizImageEncodingType.Continuous },
      ...(widget.encoding?.color
        ? { color: { field: widget.encoding.color, type: tableau.VizImageEncodingType.Discrete } }
        : {})
    }
  };
}
