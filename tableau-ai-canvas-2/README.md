# Tableau AI Canvas

A Tableau Dashboard Extension: ask questions in natural language and get real
charts/KPIs, or describe a dashboard goal and watch the canvas fill in with
AI-generated widgets, one at a time. Built with Next.js + Claude, deployable
entirely on Vercel.

## Can this run on Vercel? Yes, with one design change

The original architecture (see the blog post this is based on) spawns the
official `@tableau/mcp-server` as a local child process and talks to it over
stdio. That doesn't work on Vercel: serverless functions are stateless and
can't host a persistent background process.

This project sidesteps that by **not running MCP at all** — `lib/tableauClient.ts`
calls Tableau's REST API (auth) and VizQL Data Service (querying) directly
from inside the same serverless function that talks to Claude. Functionally
it's identical to what the MCP server does (same underlying REST/VDS calls,
same "real data, not hallucinated" guarantee) — it's just inlined instead of
proxied through a separate MCP process. This is the simplest option and needs
no extra hosting.

If you specifically want to keep the official Tableau MCP server (e.g. so
other tools/agents can share it), run it in **HTTP transport mode**
(`TRANSPORT=http`) on a small always-on host — Railway, Fly.io, Render, or a
VM — and swap the functions in `lib/tableauClient.ts` for an MCP HTTP client
that calls that host instead. Vercel functions can call out to it fine; they
just can't *be* it.

## Deploying on Vercel, connected to GitHub

1. Push this project to a new GitHub repo:
   ```bash
   cd tableau-ai-canvas
   git init
   git add .
   git commit -m "Initial commit"
   gh repo create your-org/tableau-ai-canvas --private --source=. --push
   # or create the repo on github.com and: git remote add origin <url> && git push -u origin main
   ```
2. Go to [vercel.com/new](https://vercel.com/new), choose **Import Git Repository**, and authorize Vercel's GitHub App for that repo (first time only).
3. Vercel auto-detects Next.js — leave the build settings default.
4. Add environment variables in the Vercel project (Settings > Environment Variables) — copy every key from `.env.example`:
   - `ANTHROPIC_API_KEY`
   - `TABLEAU_SERVER_URL`
   - `TABLEAU_API_VERSION`
   - `TABLEAU_SITE_CONTENT_URL`
   - `TABLEAU_PAT_NAME`
   - `TABLEAU_PAT_SECRET`
   - `TABLEAU_DATASOURCE_LUID`
5. Deploy. Every push to `main` auto-deploys to production; every PR gets a preview URL.
6. Note your production URL, e.g. `https://tableau-ai-canvas.vercel.app`.

### Plan limits to be aware of

- `Ask` mode (`/api/chat`) usually finishes in a few seconds.
- `Build Dashboard` mode runs several sequential Tableau queries and can take 30–120s+ depending on how many widgets Claude plans. `vercel.json` sets `maxDuration: 300` for that route, which requires a **Pro plan with Fluid Compute** (Hobby caps out lower). If you're on Hobby, either lower `maxTurns` in `lib/agentLoop.ts` or upgrade the plan.

## Wiring it into Tableau

1. Edit `public/tableau-extension.trex` and replace the placeholder URL with `https://<your-vercel-domain>/extension`.
2. Open your dashboard in **Web Edit** (Cloud/Server) or Desktop, drag an **Extension** object onto the canvas, and pick "My Extensions" > choose the `.trex` file.
3. Approve the permission prompt (it names your Vercel domain and the "full data" access level from the manifest).
4. Ask a site admin to add your Vercel domain to the extensions safe list so other users aren't blocked (Cloud: Settings > Extensions; Server: `tsm`/Server Settings).
5. To use it in Tableau Desktop, first enable: Help > Settings and Performance > Set Dashboard Web View Security > Enable JavaScript.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in real values
npm run dev
```

Tableau extensions require HTTPS in production but allow `http://localhost`
for dev — point a `.trex` copy at `http://localhost:3000/extension` and load
it in Tableau Desktop to iterate locally before deploying.

## Project structure

```
lib/tableauClient.ts       Tableau REST auth + VDS query helpers
lib/agentLoop.ts           Claude tool-use loop (list_fields / query_data / emit_widget)
app/api/chat/route.ts      Ask-mode SSE endpoint
app/api/build-dashboard/route.ts   Build-dashboard SSE endpoint (plans + streams widgets)
app/extension/page.tsx     The extension UI: chat panel + drag/resize canvas
app/extension/WidgetCard.tsx       Renders one widget (KPI/table as DOM, bar/line via Tableau's createVizImageAsync)
app/extension/vizSpec.ts   Builds the Tableau Viz inputSpec for chart widgets
app/extension/sse.ts       Client-side SSE-over-POST reader
public/tableau-extension.trex      Extension manifest to upload to Tableau
```

## Known simplifications (read before production use)

- Tool-call loop uses non-streaming `messages.create` per turn — you get
  widget-by-widget streaming (each `emit_widget` call pushes immediately) but
  not token-by-token text streaming. Good enough for this UX; can be upgraded
  to `messages.stream` with tool-use event handling later.
- `queryDatasource`'s field/filter shape is illustrative — confirm exact
  request format against your Tableau version's VDS docs
  (`/api/v1/vizql-data-service/query-datasource`), since VDS has evolved
  across releases.
- Auth token caching is in-memory per warm serverless instance only; cold
  starts re-authenticate, which is fine for PAT-based sign-in but adds
  ~200-500ms latency on cold requests.
- No auth/rate-limiting on the API routes themselves — anyone who can load
  the extension can call your backend. Add a shared secret header or
  Tableau-context check if this goes beyond an internal proof of concept.
