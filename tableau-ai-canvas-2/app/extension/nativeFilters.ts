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
      // The wrapper (if any) also tells us the granularity Tableau applied.
      const granularity = extractGranularity(f.fieldName);

      if (f.filterType === "categorical") {
        if (f.isAllSelected) continue; // "all selected" = not actually narrowing anything

        // Special case: a "MONTH(field) = June" style filter is exposed by
        // Tableau as a CATEGORICAL filter, but the underlying field is a
        // real date column. Formatting the picked Date as a truncated
        // string (e.g. "2026-06") doesn't work - VDS rejects it as a type
        // mismatch. The semantically correct translation is a RANGE filter
        // covering the picked period: "June 2026" = [2026-06-01, 2026-07-01).
        // This also handles Tableau's inclusion of multiple months as a
        // union of ranges - though VDS only supports one min/max range at a
        // time, so if the user picked more than one month we fall back to
        // covering the full span from earliest to latest.
        if (granularity && f.appliedValues?.some((v: any) => v.value instanceof Date)) {
          const dates = f.appliedValues
            .map((v: any) => v.value)
            .filter((d: any): d is Date => d instanceof Date && !isNaN(d.getTime()));
          if (dates.length === 0) continue;

          // Sort so we can take the earliest as the range start and derive
          // the latest's period-end as the range end.
          dates.sort((a: Date, b: Date) => a.getTime() - b.getTime());
          const first = dates[0];
          const last = dates[dates.length - 1];
          const min = periodStart(first, granularity);
          const max = periodEnd(last, granularity);
          results.push({ field: rawFieldName, type: "range", min, max });
          continue;
        }

        // Non-date categorical filter: use raw v.value, falling back to
        // v.formattedValue only when raw is missing.
        const values = (f.appliedValues || [])
          .map((v: any) => (v.value !== undefined && v.value !== null ? String(v.value) : v.formattedValue))
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
 * ISO-date string for the start of the period that `d` falls into, at the
 * given granularity. E.g. periodStart(Date(2026-06-15), "MONTH") =
 * "2026-06-01". Uses LOCAL date components (not UTC) because Tableau's
 * Filter API returns Dates constructed from the local timezone, and
 * getUTC* would sometimes fall back to the previous day / month depending
 * on the user's UTC offset (Jakarta = UTC+7, so midnight-local is 5pm-UTC
 * the day before).
 */
function periodStart(d: Date, granularity: Granularity): string {
  const y = d.getFullYear();
  const m = d.getMonth(); // 0-indexed
  const day = d.getDate();
  switch (granularity) {
    case "YEAR":
      return isoDate(y, 0, 1);
    case "QUARTER": {
      const qStartMonth = Math.floor(m / 3) * 3;
      return isoDate(y, qStartMonth, 1);
    }
    case "MONTH":
      return isoDate(y, m, 1);
    case "WEEK": {
      // Week starts Sunday - shift the day back to the previous Sunday.
      const dow = d.getDay(); // 0 = Sunday
      const weekStart = new Date(y, m, day - dow);
      return isoDate(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
    }
    case "DAY":
    case "HOUR":
    case "MINUTE":
    case "SECOND":
    default:
      return isoDate(y, m, day);
  }
}

/**
 * ISO-date string for the LAST day of the period `d` falls into.
 * Range filters in VDS are typically inclusive on both ends, so we return
 * the last day rather than "start of next period". If your VDS is
 * exclusive-max, swap this to `periodStartOfNext` and adjust the caller.
 */
function periodEnd(d: Date, granularity: Granularity): string {
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  switch (granularity) {
    case "YEAR":
      return isoDate(y, 11, 31);
    case "QUARTER": {
      const qEndMonth = Math.floor(m / 3) * 3 + 2;
      return isoDate(y, qEndMonth, daysInMonth(y, qEndMonth));
    }
    case "MONTH":
      return isoDate(y, m, daysInMonth(y, m));
    case "WEEK": {
      const dow = d.getDay();
      const weekEnd = new Date(y, m, day - dow + 6);
      return isoDate(weekEnd.getFullYear(), weekEnd.getMonth(), weekEnd.getDate());
    }
    case "DAY":
    case "HOUR":
    case "MINUTE":
    case "SECOND":
    default:
      return isoDate(y, m, day);
  }
}

function isoDate(year: number, monthZeroIndexed: number, day: number): string {
  const m = String(monthZeroIndexed + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

function daysInMonth(year: number, monthZeroIndexed: number): number {
  // Day 0 of next month = last day of this month.
  return new Date(year, monthZeroIndexed + 1, 0).getDate();
}
