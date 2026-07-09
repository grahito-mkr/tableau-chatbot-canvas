// Thin client for Tableau REST API (auth) + VizQL Data Service (querying real data).
// This replaces "run the Tableau MCP server" for a serverless/Vercel deployment:
// instead of spawning a persistent MCP process, we call the same underlying
// Tableau REST/VDS endpoints directly from inside the serverless function.
//
// If you'd rather use the official @tableau/mcp-server verbatim, deploy it in
// "http" transport mode on an always-on host (Railway/Fly/Render/a VM) and
// swap the functions below for calls to that server instead. See README.md.

const SERVER = process.env.TABLEAU_SERVER_URL!; // e.g. https://xxx.online.tableau.com
const API_VERSION = process.env.TABLEAU_API_VERSION || "3.24";
const SITE_CONTENT_URL = process.env.TABLEAU_SITE_CONTENT_URL || "";
const PAT_NAME = process.env.TABLEAU_PAT_NAME!;
const PAT_SECRET = process.env.TABLEAU_PAT_SECRET!;

type Session = { token: string; siteId: string; expiresAt: number };

// Module-level cache. On a warm serverless instance this avoids re-authenticating
// on every request. On a cold start it just signs in again.
let cachedSession: Session | null = null;

async function signIn(): Promise<Session> {
  if (cachedSession && cachedSession.expiresAt > Date.now()) {
    return cachedSession;
  }

  const res = await fetch(`${SERVER}/api/${API_VERSION}/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      credentials: {
        personalAccessTokenName: PAT_NAME,
        personalAccessTokenSecret: PAT_SECRET,
        site: { contentUrl: SITE_CONTENT_URL }
      }
    })
  });

  if (!res.ok) {
    throw new Error(`Tableau sign-in failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  const token = json.credentials.token as string;
  const siteId = json.credentials.site.id as string;

  // Tableau tokens are valid ~2 hours by default; refresh a bit early.
  cachedSession = { token, siteId, expiresAt: Date.now() + 100 * 60 * 1000 };
  return cachedSession;
}

export type FieldSpec = { fieldCaption: string; function?: "SUM" | "AVG" | "COUNT" | "MIN" | "MAX"; sortPriority?: number };
export type SetFilter = { field: string; values: string[]; exclude?: boolean };

/**
 * Fetch the list of fields (dimensions/measures) available on the configured
 * datasource, so Claude knows what it's allowed to ask for.
 */
export async function getDatasourceMetadata() {
  const session = await signIn();
  const luid = process.env.TABLEAU_DATASOURCE_LUID!;

  const res = await fetch(`${SERVER}/api/v1/vizql-data-service/read-metadata`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tableau-Auth": session.token
    },
    body: JSON.stringify({ datasource: { datasourceLuid: luid } })
  });

  if (!res.ok) {
    throw new Error(`read-metadata failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/**
 * Run a query against the datasource via VizQL Data Service.
 * Every number returned here is real - queried live from Tableau, never
 * invented by the model.
 */
export async function queryDatasource(fields: FieldSpec[], filters: SetFilter[] = []) {
  const session = await signIn();
  const luid = process.env.TABLEAU_DATASOURCE_LUID!;

  const body = {
    datasource: { datasourceLuid: luid },
    query: {
      fields: fields.map((f) => ({
        fieldCaption: f.fieldCaption,
        ...(f.function ? { function: f.function } : {}),
        ...(f.sortPriority ? { sortPriority: f.sortPriority } : {})
      })),
      filters: filters.map((f) => ({
        field: { fieldCaption: f.field },
        filterType: "SET",
        values: f.values,
        exclude: !!f.exclude
      }))
    }
  };

  const res = await fetch(`${SERVER}/api/v1/vizql-data-service/query-datasource`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tableau-Auth": session.token
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    throw new Error(`query-datasource failed: ${res.status} ${await res.text()}`);
  }
  return res.json(); // { data: [ { FieldA: ..., FieldB: ... }, ... ] }
}
