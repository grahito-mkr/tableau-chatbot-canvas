import { getDatasourceMetadata } from "@/lib/tableauClient";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Lists the fields on the datasource for the FilterBar UI. This does NOT go
 * through Claude - it's a direct, cheap call to Tableau's metadata endpoint,
 * used purely to populate "which field do you want to filter by" dropdowns.
 *
 * The response shape from read-metadata may need adjusting once tested
 * against your live server (see README's "Known simplifications") - this
 * route normalizes a couple of likely shapes defensively.
 */
export async function GET() {
  try {
    const meta: any = await getDatasourceMetadata();
    const rawFields: any[] = meta?.data || meta?.fields || [];

    const fields = rawFields.map((f) => {
      const name = f.fieldCaption || f.fieldName || f.name || String(f);
      const dataType = (f.dataType || f.type || "").toString().toUpperCase();
      const isDate = dataType.includes("DATE");
      return { name, dataType, isDate };
    });

    return Response.json({ fields });
  } catch (err: any) {
    return new Response(err.message, { status: 500 });
  }
}
