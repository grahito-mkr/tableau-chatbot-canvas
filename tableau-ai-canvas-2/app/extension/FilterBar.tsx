"use client";

import { useEffect, useState } from "react";
import type { QueryFilter } from "@/lib/tableauClient";

// UI-side representation of one active filter. Kept separate from
// lib/tableauClient's QueryFilter because the UI needs to track partially-
// filled-in state (e.g. a date field added but no dates picked yet) that
// wouldn't be valid to send to Tableau.
export type ActiveFilter = {
  field: string;
  isDate: boolean;
  values: string[]; // selected values, for non-date fields
  min?: string; // for date range
  max?: string;
};

type FieldInfo = { name: string; dataType: string; isDate: boolean };

/** Converts UI filter state into the shape lib/tableauClient expects, dropping
 * any filter that isn't actually filled in yet (e.g. a date field with
 * neither a from nor to date set). */
export function toQueryFilters(filters: ActiveFilter[]): QueryFilter[] {
  return filters
    .filter((f) => (f.isDate ? !!(f.min || f.max) : f.values.length > 0))
    .map((f) =>
      f.isDate
        ? { field: f.field, type: "range" as const, min: f.min || undefined, max: f.max || undefined }
        : { field: f.field, type: "set" as const, values: f.values }
    );
}

export default function FilterBar({
  value,
  onChange
}: {
  value: ActiveFilter[];
  onChange: (filters: ActiveFilter[]) => void;
}) {
  const [allFields, setAllFields] = useState<FieldInfo[]>([]);
  const [loadingFields, setLoadingFields] = useState(false);
  const [fieldsError, setFieldsError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [valueOptions, setValueOptions] = useState<Record<string, string[]>>({});
  const [valueLoading, setValueLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setLoadingFields(true);
    fetch("/api/fields")
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load fields (${r.status})`);
        return r.json();
      })
      .then((json) => setAllFields(json.fields || []))
      .catch((err) => setFieldsError(err.message))
      .finally(() => setLoadingFields(false));
  }, []);

  function loadValues(field: string) {
    setValueLoading((v) => ({ ...v, [field]: true }));
    fetch(`/api/field-values?field=${encodeURIComponent(field)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load values (${r.status})`);
        return r.json();
      })
      .then((json) => setValueOptions((v) => ({ ...v, [field]: json.values || [] })))
      .catch(() => setValueOptions((v) => ({ ...v, [field]: [] })))
      .finally(() => setValueLoading((v) => ({ ...v, [field]: false })));
  }

  function addFilter(fieldName: string) {
    const info = allFields.find((f) => f.name === fieldName);
    if (!info) return;
    onChange([...value, { field: fieldName, isDate: info.isDate, values: [] }]);
    setAdding(false);
    if (!info.isDate) loadValues(fieldName);
  }

  function updateFilter(field: string, patch: Partial<ActiveFilter>) {
    onChange(value.map((f) => (f.field === field ? { ...f, ...patch } : f)));
  }

  function removeFilter(field: string) {
    onChange(value.filter((f) => f.field !== field));
  }

  function toggleValue(field: string, v: string) {
    const current = value.find((f) => f.field === field);
    if (!current) return;
    const has = current.values.includes(v);
    updateFilter(field, { values: has ? current.values.filter((x) => x !== v) : [...current.values, v] });
  }

  const availableFields = allFields.filter((f) => !value.some((v) => v.field === f.name));

  return (
    <div style={{ border: "1px solid #e2e2e2", borderRadius: 8, background: "#fff", padding: 10, marginBottom: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: value.length ? 8 : 0
        }}
      >
        <strong style={{ fontSize: 13 }}>Filters</strong>
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setAdding((a) => !a)}
            disabled={loadingFields}
            style={{
              fontSize: 12,
              padding: "3px 10px",
              border: "1px solid #ddd",
              borderRadius: 4,
              background: "#f8f8f8",
              cursor: "pointer"
            }}
          >
            {loadingFields ? "Loading fields..." : "+ Add filter"}
          </button>
          {adding && (
            <div
              style={{
                position: "absolute",
                right: 0,
                top: "100%",
                marginTop: 4,
                background: "#fff",
                border: "1px solid #ddd",
                borderRadius: 6,
                boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                maxHeight: 220,
                overflow: "auto",
                zIndex: 10,
                minWidth: 180
              }}
            >
              {availableFields.length === 0 && (
                <div style={{ padding: 8, fontSize: 12, color: "#999" }}>No more fields</div>
              )}
              {availableFields.map((f) => (
                <div
                  key={f.name}
                  onClick={() => addFilter(f.name)}
                  style={{ padding: "6px 10px", fontSize: 12, cursor: "pointer" }}
                >
                  {f.name}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {fieldsError && (
        <div style={{ fontSize: 11, color: "crimson" }}>Couldn&apos;t load fields: {fieldsError}</div>
      )}

      {value.map((f) => (
        <div key={f.field} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, minWidth: 90, paddingTop: 4 }}>{f.field}</div>
          <div style={{ flex: 1 }}>
            {f.isDate ? (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="date"
                  value={f.min || ""}
                  onChange={(e) => updateFilter(f.field, { min: e.target.value })}
                  style={{ fontSize: 12, padding: 3 }}
                />
                <span style={{ fontSize: 12, color: "#999" }}>to</span>
                <input
                  type="date"
                  value={f.max || ""}
                  onChange={(e) => updateFilter(f.field, { max: e.target.value })}
                  style={{ fontSize: 12, padding: 3 }}
                />
              </div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 280 }}>
                {valueLoading[f.field] && <span style={{ fontSize: 11, color: "#999" }}>Loading values...</span>}
                {(valueOptions[f.field] || []).map((v) => {
                  const selected = f.values.includes(v);
                  return (
                    <button
                      key={v}
                      onClick={() => toggleValue(f.field, v)}
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 12,
                        cursor: "pointer",
                        border: selected ? "1px solid #2563eb" : "1px solid #ddd",
                        background: selected ? "#2563eb" : "#fff",
                        color: selected ? "#fff" : "#333"
                      }}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <button
            onClick={() => removeFilter(f.field)}
            title="Remove filter"
            style={{ border: "none", background: "none", color: "#999", cursor: "pointer", fontSize: 14 }}
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
