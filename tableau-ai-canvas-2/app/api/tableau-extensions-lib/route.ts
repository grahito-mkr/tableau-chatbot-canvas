// Proxies Tableau's Extensions API script through our own domain.
//
// Why: the extension is loaded inside Tableau Desktop/Server/Cloud's embedded
// browser, and some corporate networks/proxies block tableau.github.io (or any
// unfamiliar third-party domain) even though they allow the extension's own
// Vercel domain. Rather than depending on that external CDN loading
// successfully at runtime, we fetch it once here (server-side, from Vercel -
// which has normal outbound internet access) and serve it from our own
// origin, so the browser only ever talks to one domain.
export const runtime = "nodejs";

const UPSTREAM = "https://tableau.github.io/extensions-api/lib/tableau.extensions.1.latest.js";

export async function GET() {
  try {
    const res = await fetch(UPSTREAM, { cache: "no-store" });
    if (!res.ok) {
      return new Response(`// Failed to fetch upstream Tableau Extensions API script: ${res.status}`, {
        status: 502,
        headers: { "Content-Type": "application/javascript; charset=utf-8" }
      });
    }
    const body = await res.text();
    return new Response(body, {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        // Cache at the edge for a day, but let the browser revalidate often -
        // this is a stable library file, safe to cache aggressively server-side.
        "Cache-Control": "public, max-age=300, s-maxage=86400, stale-while-revalidate=86400"
      }
    });
  } catch (err: any) {
    return new Response(`// Failed to fetch upstream Tableau Extensions API script: ${err?.message || err}`, {
      status: 502,
      headers: { "Content-Type": "application/javascript; charset=utf-8" }
    });
  }
}
