// Minimal typing for the Tableau Extensions API, loaded at runtime via
// https://tableau.github.io/extensions-api/lib/tableau.extensions.1.latest.js
// The real library is much larger - this only covers what this app calls.
export {};

// A Tableau filter value, e.g. { value: "Jakarta", formattedValue: "Jakarta" }.
type TableauFilterValue = { value: unknown; formattedValue?: string };

// A filter as applied on a native Tableau worksheet (not our extension).
// filterType is "categorical" (a picklist filter) or "range" (a min/max
// filter, used for numeric and date ranges) - those are the two we translate.
// "relativedate" and "hierarchical" filters exist too but aren't handled yet.
type TableauWorksheetFilter = {
  filterType: "categorical" | "range" | "relativedate" | "hierarchical";
  fieldName: string;
  appliedValues?: TableauFilterValue[];
  isAllSelected?: boolean;
  isExcludeMode?: boolean;
  minValue?: TableauFilterValue;
  maxValue?: TableauFilterValue;
};

type TableauWorksheet = {
  name: string;
  getFiltersAsync: () => Promise<TableauWorksheetFilter[]>;
  addEventListener: (type: string, handler: (event: unknown) => void) => () => void;
};

declare global {
  interface Window {
    tableau?: {
      extensions: {
        initializeAsync: () => Promise<void>;
        createVizImageAsync: (spec: unknown) => Promise<string>;
        settings: {
          get: (key: string) => string | undefined;
          set: (key: string, value: string) => void;
          saveAsync: () => Promise<void>;
        };
        dashboardContent?: {
          dashboard: {
            worksheets: TableauWorksheet[];
          };
        };
      };
      MarkType: Record<string, string>;
      VizImageEncodingType: { Discrete: string; Continuous: string };
      TableauEventType: { FilterChanged: string };
    };
  }
}
