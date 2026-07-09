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

  // Whether a field's values are actually numeric - used to decide Discrete
  // vs Continuous per field, instead of assuming columns is always the
  // category and rows is always the measure. That assumption broke as soon
  // as someone asked for a horizontal bar chart (measure on columns,
  // category on rows): Tableau rejected it with "Field X has unsupported
  // data" because a text field was being sent as Continuous.
  const isNumericField = (field: string | undefined) => {
    if (!field) return false;
    return widget.data.every((r) => {
      const v = (r as Record<string, unknown>)[field];
      return (
        v === null ||
        v === undefined ||
        typeof v === "number" ||
        (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)))
      );
    });
  };

  const { Discrete, Continuous } = tableau.VizImageEncodingType;
  const colType = isNumericField(col) ? Continuous : Discrete;
  const rowType = isNumericField(row) ? Continuous : Discrete;

  // The on-bar value label should point at whichever field is the actual
  // numeric measure, wherever it ended up (columns or rows) - not hardcoded
  // to `row`, since that's not always the measure (see above).
  const measureField = isNumericField(row) ? row : isNumericField(col) ? col : row;
  const measureType = isNumericField(measureField) ? Continuous : Discrete;

  // `color` in the Tableau Viz spec must reference a real field in the data
  // (it's a data-driven encoding, not a way to set a literal color like
  // "green"). If the model hallucinated a color name instead of a field that
  // actually exists in the row data, drop it rather than sending an invalid
  // field reference that makes createVizImageAsync fail outright.
  const requestedColor = widget.encoding?.color;
  const colorField = requestedColor && keys.includes(requestedColor) ? requestedColor : undefined;

  return {
    description: widget.title,
    data: { values: widget.data },
    mark: widget.type === "line" ? tableau.MarkType.Line : tableau.MarkType.Bar,
    encoding: {
      columns: { field: col, type: colType },
      rows: { field: row, type: rowType },
      // Print the value on top of each bar/point, matching a normal Tableau chart.
      text: { field: measureField, type: measureType },
      ...(colorField ? { color: { field: colorField, type: Discrete } } : {})
    }
  };
}
