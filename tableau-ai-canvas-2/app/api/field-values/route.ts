import { queryDatasource } from "@/lib/tableauClient";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Returns up to 200 distinct values for one field, so the FilterBar can show
 * a checklist (e.g. every Branch name) instead of asking the user to type a
 * value blind. Direct Tableau call - no Claude involved.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const field = searchParams.get("field");
  if (!field) {
    return new Response("Missing `field` query param", { status: 400 });
  }

  try {
    const result: any = await queryDatasource([{ fieldCaption: field }]);
    const rows: any[] = result?.data || [];
    const values = Array.from(
      new Set(rows.map((r) => r[field]).filter((v) => v !== null && v !== undefined && v !== ""))
    )
      .slice(0, 200)
      .map(String);

    return Response.json({ values });
  } catch (err: any) {
    return new Response(err.message, { status: 500 });
  }
}
