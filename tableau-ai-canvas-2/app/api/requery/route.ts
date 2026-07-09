import { queryDatasource, type FieldSpec, type QueryFilter } from "@/lib/tableauClient";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Re-runs one widget's original query with a new set of filters and returns
 * fresh rows. Used when the global filter bar changes, so every widget
 * already on the canvas updates instantly WITHOUT calling Claude again -
 * this only works for widgets that have a `sourceQuery` (see agentLoop.ts).
 */
export async function POST(req: Request) {
  const { fields, filters } = await req.json();

  if (!Array.isArray(fields) || fields.length === 0) {
    return new Response("Missing `fields`", { status: 400 });
  }

  try {
    const result: any = await queryDatasource(fields as FieldSpec[], (filters as QueryFilter[]) || []);
    return Response.json({ data: result?.data || [] });
  } catch (err: any) {
    return new Response(err.message, { status: 500 });
  }
}
