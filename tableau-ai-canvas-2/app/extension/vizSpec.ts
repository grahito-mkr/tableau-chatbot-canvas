import type { Widget } from "@/lib/agentLoop";

/**
 * Turn one of our widgets into a Tableau Viz `inputSpec` for bar/line types.
 * KPI and table widgets are rendered directly as DOM (see WidgetCard) since
 * they don't need Tableau's chart renderer.
 */
export function toVizInputSpec(widget: Widget, tableau: NonNullable<Window["tableau"]>) {
  const columnsField = widget.encoding?.columns;
  const rowsField = widget.encoding?.rows;
  const keys = widget.data.length > 0 ? Object.keys(widget.data[0]) : [];

  // sourceQuery.fields (captured from the query_data call that produced this
  // widget's data - see agentLoop.ts) tells us, per field, whether it was
  // queried as a measure (has an aggregation `function`: SUM/AVG/COUNT/etc.)
  // or a plain dimension (no function - e.g. "Branch Id"). This is the
  // authoritative signal for Discrete vs Continuous, because VDS commonly
  // returns every value - measures included - as a JSON string, and
  // ID-like dimensions (Branch Id, Employee Id) are ALSO numeric-looking
  // strings (e.g. "61331"). Guessing from the shape of the value alone
  // can't tell these two cases apart; guessing wrong for an ID field is
  // exactly what caused "Field Branch Id has unsupported data" (a string
  // sent where Tableau's viz spec requires a true Continuous number).
  const measureFieldNames = new Set(
    (widget.sourceQuery?.fields || []).filter((f) => !!f.function).map((f) => f.fieldCaption)
  );
  const hasSourceQueryInfo = (widget.sourceQuery?.fields?.length ?? 0) > 0;

  // Fallback heuristic, used only when we have no sourceQuery metadata to
  // rely on (e.g. older widgets, or a future caller that doesn't set it).
  // Trusts the real JS type only - a numeric-looking string is NOT treated
  // as numeric here, since that's what misclassified Branch Id before.
  const valueShapeIsNumeric = (field: string | undefined) => {
    if (!field) return false;
    let sawValue = false;
    const allNumbers = widget.data.every((r) => {
      const v = (r as Record<string, unknown>)[field];
      if (v === null || v === undefined) return true;
      sawValue = true;
      return typeof v === "number";
    });
    return sawValue && allNumbers;
  };

  const isNumericField = (field: string | undefined) => {
    if (!field) return false;
    if (hasSourceQueryInfo) return measureFieldNames.has(field);
    return valueShapeIsNumeric(field);
  };

  // Which of the (up to) two fields is the category and which is the
  // measure, independent of the order they happen to appear in the row
  // object. A standard vertical bar/column chart needs the category
  // (Discrete) field on `columns` and the measure (Continuous) field on
  // `rows` - if the model emitted the measure first in its JSON (e.g.
  // { "Branch Id": ..., "Total Leaving Employees": ... } vs the reverse),
  // blindly taking keys[0]/keys[1] as columns/rows respectively can put the
  // measure on columns and the category on rows. Tableau renders THAT shape
  // as a crosstab/highlight table (each discrete value becomes its own
  // column header) instead of a normal bar chart - which is exactly what
  // produced the truncated-header, one-bar-per-column layout.
  const otherKey = (used: string | undefined) => keys.find((k) => k !== used);
  let categoryField: string | undefined;
  let measureFieldGuess: string | undefined;

  if (columnsField || rowsField) {
    // Model gave an explicit encoding. Still validate it against the
    // measure/dimension metadata when we have it: nothing in the tool
    // description tells the model which shelf a measure belongs on, so an
    // explicit encoding can be just as backwards as the positional default
    // was (e.g. encoding: { columns: "Total Leaving Employees", rows:
    // "Branch Id" }). If exactly one of the two named fields is a known
    // measure, force it onto `rows` and the other onto `columns`,
    // regardless of which way the model assigned them.
    if (hasSourceQueryInfo && columnsField && rowsField) {
      const colIsMeasure = measureFieldNames.has(columnsField);
      const rowIsMeasure = measureFieldNames.has(rowsField);
      if (colIsMeasure && !rowIsMeasure) {
        categoryField = rowsField;
        measureFieldGuess = columnsField;
      } else {
        categoryField = columnsField;
        measureFieldGuess = rowsField;
      }
    } else {
      categoryField = columnsField;
      measureFieldGuess = rowsField;
    }
  } else if (hasSourceQueryInfo && keys.length >= 2) {
    // Use the measure/dimension metadata to assign roles correctly,
    // regardless of key order in the row object.
    const measureKey = keys.find((k) => measureFieldNames.has(k));
    const dimensionKey = keys.find((k) => !measureFieldNames.has(k));
    categoryField = dimensionKey ?? keys[0];
    measureFieldGuess = measureKey ?? otherKey(categoryField);
  } else {
    // No metadata to go on - fall back to positional default.
    categoryField = keys[0];
    measureFieldGuess = keys[1];
  }

  const col = categoryField ?? keys[0];
  const row = measureFieldGuess ?? otherKey(col) ?? keys[1];

  const { Discrete, Continuous } = tableau.VizImageEncodingType;
  const colType = isNumericField(col) ? Continuous : Discrete;
  const rowType = isNumericField(row) ? Continuous : Discrete;

  // The on-bar value label should point at whichever field is the actual
  // numeric measure, wherever it ended up (columns or rows) - not hardcoded
  // to `row`, since that's not always the measure (see above).
  const measureField = isNumericField(row) ? row : isNumericField(col) ? col : row;
  const measureType = isNumericField(measureField) ? Continuous : Discrete;

  // `data.values` must actually match the types we just declared - declaring
  // a field Continuous but leaving its values as strings (e.g. VDS returning
  // "94" instead of 94) is the same class of bug as the Branch Id issue, just
  // in the opposite direction. Coerce each row so Continuous fields hold real
  // numbers and Discrete fields hold strings, regardless of what shape the
  // upstream data happened to arrive in.
  const numericCols = new Set([col, row, measureField].filter((f) => f && isNumericField(f)));
  const coercedValues = widget.data.map((r) => {
    const rec = r as Record<string, unknown>;
    const out: Record<string, unknown> = { ...rec };
    for (const key of Object.keys(rec)) {
      const v = rec[key];
      if (v === null || v === undefined) continue;
      if (numericCols.has(key)) {
        if (typeof v !== "number") {
          const n = Number(v);
          out[key] = Number.isNaN(n) ? v : n;
        }
      } else if (typeof v !== "string") {
        out[key] = String(v);
      }
    }
    return out;
  });

  // `color` in the Tableau Viz spec must reference a real field in the data
  // (it's a data-driven encoding, not a way to set a literal color like
  // "green"). If the model hallucinated a color name instead of a field that
  // actually exists in the row data, drop it rather than sending an invalid
  // field reference that makes createVizImageAsync fail outright.
  const requestedColor = widget.encoding?.color;
  const colorField = requestedColor && keys.includes(requestedColor) ? requestedColor : undefined;

  return {
    description: widget.title,
    data: { values: coercedValues },
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
