// Minimal typing for the Tableau Extensions API, loaded at runtime via
// https://tableau.github.io/extensions-api/lib/tableau.extensions.1.latest.js
// The real library is much larger - this only covers what this app calls.
export {};

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
      };
      MarkType: Record<string, string>;
      VizImageEncodingType: { Discrete: string; Continuous: string };
    };
  }
}
