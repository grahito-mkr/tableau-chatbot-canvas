"use client";

import { useMemo } from "react";
import type { Widget } from "@/lib/agentLoop";
import { ErrorBox, sortKey } from "./charts/shared";
import { HorizontalBar, VerticalBar } from "./charts/bar";
import { LineOrAreaChart } from "./charts/line";
import { PieChart } from "./charts/pie";
import { ScatterChart } from "./charts/scatter";
import { MultiSeriesBar } from "./charts/multiSeriesBar";
import { Heatmap } from "./charts/heatmap";

/**
 * Main chart dispatcher. Given a Widget from the agent, decide which
 * concrete chart component to render and figure out the field roles
 * (category / measure / series / x / y) it needs.
 *
 * Field-role resolution priority:
 *   1. widget.sourceQuery.fields (measure = has aggregation `function`)
 *   2. widget.encoding.columns / rows / color hints from the model
 *   3. value shape (numeric vs. string) as a last resort
 *
 * This is what makes bar-vs-crosstab decisions deterministic instead of
 * relying on Tableau's opaque createVizImageAsync layout.
 */
export default function SimpleChart({
  widget,
  width,
  height
}: {
  widget: Widget;
  width: number;
  height: number;
}) {
  const model = useMemo(() => buildChartModel(widget), [widget]);

  if ("error" in model) return <ErrorBox message={model.error} />;

  switch (model.kind) {
    case "vertical-bar":
      return (
        <VerticalBar
          rows={model.rows}
          categoryKey={model.categoryKey}
          measureKey={model.measureKey}
          width={width}
          height={height}
        />
      );
    case "horizontal-bar":
      return (
        <HorizontalBar
          rows={model.rows}
          categoryKey={model.categoryKey}
          measureKey={model.measureKey}
          width={width}
          height={height}
        />
      );
    case "line":
      return (
        <LineOrAreaChart
          rows={model.rows}
          categoryKey={model.categoryKey}
          measureKey={model.measureKey}
          width={width}
          height={height}
          fill={false}
        />
      );
    case "area":
      return (
        <LineOrAreaChart
          rows={model.rows}
          categoryKey={model.categoryKey}
          measureKey={model.measureKey}
          width={width}
          height={height}
          fill={true}
        />
      );
    case "pie":
      return (
        <PieChart
          rows={model.rows}
          categoryKey={model.categoryKey}
          measureKey={model.measureKey}
          width={width}
          height={height}
          donut={model.donut}
        />
      );
    case "scatter":
      return (
        <ScatterChart
          rows={model.rows}
          xKey={model.xKey}
          yKey={model.yKey}
          categoryKey={model.seriesKey}
          labelKey={model.labelKey}
          width={width}
          height={height}
        />
      );
    case "stacked-bar":
    case "grouped-bar":
      return (
        <MultiSeriesBar
          rows={model.rows}
          categoryKey={model.categoryKey}
          seriesKey={model.seriesKey}
          measureKey={model.measureKey}
          width={width}
          height={height}
          stacked={model.kind === "stacked-bar"}
        />
      );
    case "heatmap":
      return (
        <Heatmap
          rows={model.rows}
          xKey={model.xKey}
          yKey={model.yKey}
          measureKey={model.measureKey}
          width={width}
          height={height}
        />
      );
  }
}

// ---- Field-role resolution ------------------------------------------------

type ChartModel =
  | { error: string }
  | {
      kind: "vertical-bar" | "horizontal-bar" | "line" | "area";
      rows: Record<string, unknown>[];
      categoryKey: string;
      measureKey: string;
    }
  | {
      kind: "pie";
      rows: Record<string, unknown>[];
      categoryKey: string;
      measureKey: string;
      donut: boolean;
    }
  | {
      kind: "scatter";
      rows: Record<string, unknown>[];
      xKey: string;
      yKey: string;
      seriesKey?: string;
      labelKey?: string;
    }
  | {
      kind: "stacked-bar" | "grouped-bar";
      rows: Record<string, unknown>[];
      categoryKey: string;
      seriesKey: string;
      measureKey: string;
    }
  | {
      kind: "heatmap";
      rows: Record<string, unknown>[];
      xKey: string;
      yKey: string;
      measureKey: string;
    };

function buildChartModel(widget: Widget): ChartModel {
  if (!Array.isArray(widget.data) || widget.data.length === 0) {
    return { error: "No data to chart." };
  }
  const rows = widget.data as Record<string, unknown>[];
  const keys = Object.keys(rows[0]);
  if (keys.length < 2) {
    return { error: `Chart needs at least two fields, got: ${keys.join(", ") || "(none)"}` };
  }

  const measureNames = new Set(
    (widget.sourceQuery?.fields || []).filter((f) => !!f.function).map((f) => f.fieldCaption)
  );
  const encColumns = widget.encoding?.columns;
  const encRows = widget.encoding?.rows;
  const encSeries = widget.encoding?.color;

  const isNumericByShape = (field: string) => {
    let seen = false;
    for (const r of rows) {
      const v = r[field];
      if (v === null || v === undefined || v === "") continue;
      seen = true;
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isNaN(n)) return false;
    }
    return seen;
  };

  const measureKeysFromSQ = keys.filter((k) => measureNames.has(k));
  const nonMeasureKeys = keys.filter((k) => !measureNames.has(k));

  const kindHint = widget.type;
  const isHorizontalBar = widget.type === "bar" && widget.orientation === "horizontal";

  // ---- Pie / donut ---------------------------------------------------------
  if (kindHint === "pie" || kindHint === "donut") {
    const result = pickMeasureAndCategory(
      keys,
      rows,
      measureKeysFromSQ,
      nonMeasureKeys,
      encColumns,
      encRows,
      isNumericByShape
    );
    if (!result.ok) return { error: result.err };
    return {
      kind: "pie",
      rows: sortByMeasureDesc(rows, result.measureKey),
      categoryKey: result.categoryKey,
      measureKey: result.measureKey,
      donut: kindHint === "donut"
    };
  }

  // ---- Scatter -------------------------------------------------------------
  if (kindHint === "scatter") {
    // Scatter needs two numeric axes. Prefer sourceQuery measures; fall back
    // to any two numeric-by-shape fields.
    const numericKeys = measureKeysFromSQ.length >= 2
      ? measureKeysFromSQ
      : keys.filter(isNumericByShape);
    if (numericKeys.length < 2) {
      return { error: "Scatter needs at least two numeric fields; the data only has " + numericKeys.length + "." };
    }
    // Honor encoding.columns/rows if they name real numeric fields.
    const xKey = numericKeys.includes(encColumns || "") ? encColumns! : numericKeys[0];
    const yKey = numericKeys.includes(encRows || "") ? encRows! : numericKeys.find((k) => k !== xKey) || numericKeys[1];
    // Any leftover non-numeric key can be used as a color grouping.
    const seriesKey = encSeries && keys.includes(encSeries)
      ? encSeries
      : keys.find((k) => k !== xKey && k !== yKey && !isNumericByShape(k));
    const labelKey = keys.find((k) => k !== xKey && k !== yKey && k !== seriesKey);
    return { kind: "scatter", rows, xKey, yKey, seriesKey, labelKey };
  }

  // ---- Stacked / grouped bar ----------------------------------------------
  if (kindHint === "stacked-bar" || kindHint === "grouped-bar") {
    if (keys.length < 3) {
      return {
        error:
          `A ${kindHint} chart needs three fields (category, series, and measure); got: ${keys.join(", ")}.`
      };
    }
    const result = pickMeasureOnly(keys, measureKeysFromSQ, isNumericByShape);
    if (!result.ok) return { error: result.err };
    const measureKey = result.measureKey;
    // Pick category vs series from the two non-measure fields, honoring hints.
    const others = keys.filter((k) => k !== measureKey);
    const categoryKey = others.includes(encColumns || "")
      ? encColumns!
      : others.includes(encRows || "")
        ? encRows!
        : others[0];
    const seriesKey = encSeries && others.includes(encSeries)
      ? encSeries
      : others.find((k) => k !== categoryKey) || others[1];
    return { kind: kindHint, rows, categoryKey, seriesKey, measureKey };
  }

  // ---- Heatmap -------------------------------------------------------------
  if (kindHint === "heatmap") {
    if (keys.length < 3) {
      return { error: `A heatmap needs three fields (x, y, measure); got: ${keys.join(", ")}.` };
    }
    const result = pickMeasureOnly(keys, measureKeysFromSQ, isNumericByShape);
    if (!result.ok) return { error: result.err };
    const measureKey = result.measureKey;
    const others = keys.filter((k) => k !== measureKey);
    const xKey = others.includes(encColumns || "") ? encColumns! : others[0];
    const yKey = others.includes(encRows || "") ? encRows! : others.find((k) => k !== xKey) || others[1];
    return { kind: "heatmap", rows, xKey, yKey, measureKey };
  }

  // ---- Line / area ---------------------------------------------------------
  if (kindHint === "line" || kindHint === "area") {
    const result = pickMeasureAndCategory(
      keys,
      rows,
      measureKeysFromSQ,
      nonMeasureKeys,
      encColumns,
      encRows,
      isNumericByShape
    );
    if (!result.ok) return { error: result.err };
    return {
      kind: kindHint,
      rows: sortByCategoryAsc(rows, result.categoryKey),
      categoryKey: result.categoryKey,
      measureKey: result.measureKey
    };
  }

  // ---- Default: bar (vertical or horizontal) ------------------------------
  const barResult = pickMeasureAndCategory(
    keys,
    rows,
    measureKeysFromSQ,
    nonMeasureKeys,
    encColumns,
    encRows,
    isNumericByShape
  );
  if (!barResult.ok) return { error: barResult.err };
  // Sort intelligently based on what the category looks like:
  //   - Date-like categories (Month, Order Date, etc.) sort chronologically
  //     so a time-series bar chart runs left-to-right in time order.
  //   - Everything else sorts by measure descending, so "top N" charts and
  //     categorical breakdowns stay in a stable meaningful order across
  //     filter changes. Without this, requerying with new filters can
  //     shuffle the bars into random order because VDS returns rows in
  //     whichever order matched the underlying index.
  const sortedRows = looksDateLike(rows, barResult.categoryKey)
    ? sortByCategoryAsc(rows, barResult.categoryKey)
    : sortByMeasureDesc(rows, barResult.measureKey);
  return {
    kind: isHorizontalBar ? "horizontal-bar" : "vertical-bar",
    rows: sortedRows,
    categoryKey: barResult.categoryKey,
    measureKey: barResult.measureKey
  };
}

/**
 * Cheap check for whether a column looks like it contains dates. Used to
 * decide whether a bar chart should sort by category (time-series) or by
 * measure (top-N). Only samples up to 5 rows to avoid a full scan of
 * large datasets - if the first several rows all look like dates it's
 * almost certainly a date column.
 */
function looksDateLike(rows: Record<string, unknown>[], key: string): boolean {
  const sample = rows.slice(0, 5);
  let dateLikeCount = 0;
  let seenCount = 0;
  for (const r of sample) {
    const v = r[key];
    if (v === null || v === undefined || v === "") continue;
    seenCount++;
    if (v instanceof Date) {
      dateLikeCount++;
      continue;
    }
    if (typeof v !== "string") continue;
    if (/^\d{4}-\d{2}(-\d{2})?([T ].*)?$/.test(v)) dateLikeCount++;
  }
  return seenCount > 0 && dateLikeCount / seenCount >= 0.6;
}

function pickMeasureOnly(
  keys: string[],
  measureKeysFromSQ: string[],
  isNumericByShape: (field: string) => boolean
): { ok: true; measureKey: string } | { ok: false; err: string } {
  if (measureKeysFromSQ.length >= 1) return { ok: true, measureKey: measureKeysFromSQ[0] };
  const numericKeys = keys.filter(isNumericByShape);
  if (numericKeys.length >= 1) return { ok: true, measureKey: numericKeys[0] };
  return { ok: false, err: "Couldn't identify a numeric measure field in the data." };
}

function pickMeasureAndCategory(
  keys: string[],
  rows: Record<string, unknown>[],
  measureKeysFromSQ: string[],
  nonMeasureKeys: string[],
  encColumns: string | undefined,
  encRows: string | undefined,
  isNumericByShape: (field: string) => boolean
): { ok: true; measureKey: string; categoryKey: string } | { ok: false; err: string } {
  if (measureKeysFromSQ.length === 1 && nonMeasureKeys.length >= 1) {
    const measureKey = measureKeysFromSQ[0];
    const categoryKey = nonMeasureKeys.includes(encColumns || "")
      ? encColumns!
      : nonMeasureKeys.includes(encRows || "")
        ? encRows!
        : nonMeasureKeys[0];
    return { ok: true, measureKey, categoryKey };
  }
  const numericKeys = keys.filter(isNumericByShape);
  if (numericKeys.length === 1) {
    const measureKey = numericKeys[0];
    const categoryKey = keys.find((k) => k !== measureKey) || keys[0];
    return { ok: true, measureKey, categoryKey };
  }
  if (encRows && keys.includes(encRows) && encColumns && keys.includes(encColumns)) {
    return { ok: true, measureKey: encRows, categoryKey: encColumns };
  }
  // Fallback: assume second key is the measure (matches how the tool prompt
  // asks the model to structure its emit_widget rows).
  if (keys.length >= 2) {
    return { ok: true, measureKey: keys[1], categoryKey: keys[0] };
  }
  return { ok: false, err: "Couldn't identify a category and measure in the data." };
}

/**
 * Sort rows by the numeric measure column, largest first. Used to keep bar
 * and pie charts in a stable, meaningful order across filter changes -
 * previously the row order came straight from VDS, which returned rows in
 * whichever order matched the underlying index, and a filter change could
 * reshuffle them (turning "Top 10 by count" into random-order bars).
 */
function sortByMeasureDesc(rows: Record<string, unknown>[], measureKey: string) {
  const copy = rows.slice();
  copy.sort((a, b) => {
    const av = Number(a[measureKey]);
    const bv = Number(b[measureKey]);
    const anum = Number.isFinite(av) ? av : -Infinity;
    const bnum = Number.isFinite(bv) ? bv : -Infinity;
    return bnum - anum;
  });
  return copy;
}

/**
 * Sort rows by category ascending. Uses sortKey() so dates sort
 * chronologically, numbers numerically, and text alphabetically. This is
 * the right default for line/area charts (time series should always run
 * left-to-right in time order regardless of source row order).
 */
function sortByCategoryAsc(rows: Record<string, unknown>[], categoryKey: string) {
  const copy = rows.slice();
  copy.sort((a, b) => {
    const av = sortKey(a[categoryKey]);
    const bv = sortKey(b[categoryKey]);
    if (typeof av === "number" && typeof bv === "number") return av - bv;
    return String(av).localeCompare(String(bv));
  });
  return copy;
}
