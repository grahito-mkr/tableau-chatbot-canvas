import type { QueryFilter } from "@/lib/tableauClient";

/**
 * Reads every filter currently applied on every native worksheet on the
 * dashboard (the filter cards a user drags onto the dashboard themselves -
 * NOT anything inside our own extension zone) and converts them into the
 * shape lib/tableauClient expects. This is what lets Tableau's own filters
 * scope the AI's queries too, without us building any filter UI ourselves.
 *
 * Only "categorical" (pick-a-value) and "range" (min/max, used for numeric
 * and date ranges) filters are translated. "Relative date" and
 * "hierarchical" filters exist in Tableau but aren't handled yet - if a
 * dashboard uses one of those, it's silently ignored (logged to console).
 */
export async function readDashboardFilters(tableau: NonNullable<Window["tableau"]>): Promise<QueryFilter[]> {
  const dashboard = tableau.extensions.dashboardContent?.dashboard;
  if (!dashboard) return [];

  const results: QueryFilter[] = [];

  for (const worksheet of dashboard.worksheets) {
    let filters: any[] = [];
    try {
      filters = await worksheet.getFiltersAsync();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[nativeFilters] couldn't read filters for worksheet "${worksheet.name}":`, err);
      continue;
    }

    for (const f of filters) {
      // Tableau reports a filter's field as a "display" name, which for
      // date/time filters is often wrapped in a truncation function like
      // "MONTH(Month)" or "YEAR([Order Date])". VDS won't accept those -
      // it needs the underlying field name. Strip the function wrapper.
      const rawFieldName = unwrapFieldName(f.fieldName);
      // The wrapper (if any) also tells us the granularity Tableau applied,
      // which we use below when formatting Date values back to strings.
      const granularity = extractGranularity(f.fieldName);

      if (f.filterType === "categorical") {
        if (f.isAllSelected) continue; // "all selected" = not actually narrowing anything
        // Prefer v.value (the raw underlying value - a Date or number)
        // over v.formattedValue (a display string like "Jun 26" that won't
        // match the raw data stored in the datasource). Format Dates back
        // to the string representation the underlying data likely uses,
        // based on the filter's granularity.
        const values = (f.appliedValues || [])
          .map((v: any) => formatFilterValue(v.value, v.formattedValue, granularity))
          .filter((v: unknown): v is string => typeof v === "string" && v.length > 0);
        if (values.length === 0) continue;
        results.push({ field: rawFieldName, type: "set", values, exclude: !!f.isExcludeMode });
      } else if (f.filterType === "range") {
        const min = f.minValue?.value;
        const max = f.maxValue?.value;
        if (min === undefined && max === undefined) continue;
        results.push({ field: rawFieldName, type: "range", min, max });
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[nativeFilters] skipping unsupported filter type "${f.filterType}" on field "${f.fieldName}"`);
      }
    }
  }

  // De-dupe by field (rare for the same field to be filtered on two
  // worksheets with different values at once - last one seen wins).
  const byField = new Map<string, QueryFilter>();
  for (const f of results) byField.set(f.field, f);
  return Array.from(byField.values());
}

/**
 * Subscribes to filter changes on every worksheet on the dashboard and calls
 * `onChange` with the freshly-read filter list whenever anything changes
 * anywhere on the dashboard (debounced, since Tableau can fire several
 * FilterChanged events in a row). Returns an unsubscribe function.
 */
export function watchDashboardFilters(
  tableau: NonNullable<Window["tableau"]>,
  onChange: (filters: QueryFilter[]) => void
): () => void {
  const dashboard = tableau.extensions.dashboardContent?.dashboard;
  if (!dashboard) return () => {};

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const handleChange = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      readDashboardFilters(tableau).then(onChange);
    }, 300);
  };

  const unsubscribers: Array<() => void> = [];
  for (const worksheet of dashboard.worksheets) {
    try {
      const remove = worksheet.addEventListener(tableau.TableauEventType.FilterChanged, handleChange);
      if (typeof remove === "function") unsubscribers.push(remove);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[nativeFilters] couldn't listen for filter changes on worksheet "${worksheet.name}":`, err);
    }
  }

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    unsubscribers.forEach((fn) => fn());
  };
}

/**
 * Tableau's Filter.fieldName is the DISPLAY name of the field being
 * filtered. For date-based filters, Tableau wraps the underlying field
 * name in a truncation function that reflects the granularity of the
 * filter card - "MONTH(Month)", "YEAR([Order Date])", "QUARTER(Ship Date)",
 * etc. VDS doesn't understand those wrappers - it needs the underlying
 * field name - so we strip the function envelope here.
 *
 * Recognized function wrappers:
 *   YEAR, QUARTER, MONTH, WEEK, DAY, HOUR, MINUTE, SECOND
 * (plus MDY etc. that some Tableau versions emit).
 *
 * Field names inside the parens may themselves be bracket-quoted
 * ([Order Date]) - we strip the brackets too.
 *
 * If the wrapper isn't recognized, we leave the name alone rather than
 * risk mangling a legitimately-parenthesized field name.
 */
function unwrapFieldName(name: string): string {
  const knownWrappers = /^(YEAR|QUARTER|MONTH|WEEK|DAY|HOUR|MINUTE|SECOND|MDY|MY)\((.+)\)$/i;
  const match = name.match(knownWrappers);
  if (!match) return name;
  let inner = match[2].trim();
  // Strip surrounding [] brackets Tableau sometimes uses to quote names
  // containing spaces or special characters.
  if (inner.startsWith("[") && inner.endsWith("]")) {
    inner = inner.slice(1, -1);
  }
  return inner;
}

/**
 * Extract the date-truncation granularity from a wrapped fieldName so we
 * can format a filter's raw Date value to match how the underlying data
 * is likely stored. E.g. "MONTH(Month)" -> "MONTH", "YEAR(Date)" -> "YEAR".
 * Returns null for names that aren't wrapped in a known function.
 */
type Granularity = "YEAR" | "QUARTER" | "MONTH" | "WEEK" | "DAY" | "HOUR" | "MINUTE" | "SECOND";
function extractGranularity(name: string): Granularity | null {
  const knownWrappers = /^(YEAR|QUARTER|MONTH|WEEK|DAY|HOUR|MINUTE|SECOND)\(/i;
  const match = name.match(knownWrappers);
  return match ? (match[1].toUpperCase() as Granularity) : null;
}

/**
 * Turn a raw filter value into the string form most likely to match how
 * the datasource stores it. Tableau's Filter API returns Date objects for
 * truncated-date filters; the underlying data is usually stored as an
 * ISO-ish string (e.g. "2026-06" for a MONTH-truncated field). We format
 * the Date to match that granularity. For non-date values we just
 * stringify. As a last resort we fall back to the formatted display.
 *
 * This is inherently best-effort: how the underlying data is stored
 * depends on the datasource (some databases store dates as full ISO
 * timestamps, others as strings the analyst pre-formatted). If a specific
 * shape doesn't match, the requery will run but return zero rows - which
 * is at least a no-op rather than an error.
 */
function formatFilterValue(
  rawValue: unknown,
  formattedValue: string | undefined,
  granularity: Granularity | null
): string | undefined {
  if (rawValue instanceof Date && !isNaN(rawValue.getTime())) {
    const y = rawValue.getUTCFullYear();
    const m = String(rawValue.getUTCMonth() + 1).padStart(2, "0");
    const d = String(rawValue.getUTCDate()).padStart(2, "0");
    switch (granularity) {
      case "YEAR":
        return `${y}`;
      case "QUARTER": {
        const q = Math.floor(rawValue.getUTCMonth() / 3) + 1;
        return `${y}-Q${q}`;
      }
      case "MONTH":
        return `${y}-${m}`;
      case "DAY":
      case "WEEK":
      default:
        return `${y}-${m}-${d}`;
    }
  }
  if (rawValue !== undefined && rawValue !== null) return String(rawValue);
  if (typeof formattedValue === "string" && formattedValue.length > 0) return formattedValue;
  return undefined;
}
