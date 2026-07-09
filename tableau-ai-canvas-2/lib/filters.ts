import type { QueryFilter, RangeFilter, SetFilter } from "./tableauClient";

/**
 * Turn the active filter-bar filters into a short human-readable line, so it
 * can be prepended to the user's prompt. This is purely for the model's
 * benefit (so its text reply can say "for the Jakarta branch..." instead of
 * ignoring the filters) - the filters are applied to every query_data call
 * regardless, in lib/agentLoop.ts, so correctness never depends on the model
 * reading this line.
 */
export function describeFilters(filters: QueryFilter[]): string {
  if (!filters || filters.length === 0) return "";
  const parts = filters.map((f) => {
    if (f.type === "range") {
      const rf = f as RangeFilter;
      if (rf.min && rf.max) return `${rf.field} between ${rf.min} and ${rf.max}`;
      if (rf.min) return `${rf.field} on or after ${rf.min}`;
      if (rf.max) return `${rf.field} on or before ${rf.max}`;
      return `${rf.field} (range filter)`;
    }
    const sf = f as SetFilter;
    const verb = sf.exclude ? "excluding" : "in";
    return `${sf.field} ${verb} [${sf.values.join(", ")}]`;
  });
  return `Active filters: ${parts.join("; ")}.`;
}
