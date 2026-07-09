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
      if (f.filterType === "categorical") {
        if (f.isAllSelected) continue; // "all selected" = not actually narrowing anything
        const values = (f.appliedValues || []).map((v: any) => String(v.formattedValue ?? v.value));
        if (values.length === 0) continue;
        results.push({ field: f.fieldName, type: "set", values, exclude: !!f.isExcludeMode });
      } else if (f.filterType === "range") {
        const min = f.minValue?.value;
        const max = f.maxValue?.value;
        if (min === undefined && max === undefined) continue;
        results.push({ field: f.fieldName, type: "range", min, max });
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
