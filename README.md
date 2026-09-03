# Blueprint

**Design how to build a product on Cloudflare or Vercel, watch requests flow and get billed, and let your browser's agent drive the canvas through WebMCP.**

Blueprint is a WebMCP-powered studio for the question "how would I vibecode this, and what will it cost me?"

- Paste a product URL or describe an app. The architect splits it into a core loop and polish, decides which platform primitives the core loop needs, and draws the architecture.
- Flip one switch to price the same design on **Cloudflare** or **Vercel**, free tier or paid. Every number comes from the official pricing pages, with a source link and an as-of date on every line.
- Drag the traffic mix (humans, search crawlers, AI crawlers, scrapers, botnet) and watch requests flow through the diagram. Turn on bot protection and see the bill fall; block every bot and see search disappear too.
- Export `wrangler.jsonc` or `vercel.json` plus the recommended stack.

Everything an agent can do, a person can do, and the other way round. The diagram is a small text DSL; the canvas, the simulator and the exports are all views of it.

## Flows

- **Start**: pick a template, open a saved blueprint, or press *New blueprint* for an empty canvas. Remix any template or blueprint into a saved copy; blueprints autosave to the browser.
- **Analyse a product**: ask the architect (or your browser agent) to analyse a URL or description. It proposes an architecture on the canvas and explains why each piece is there.
- **Shape it**: click a product in the left rail to add it, drag a node's handle onto another to connect, double-click to inspect, Delete to remove. Every edit is also available as a tool and in the DSL panel.
- **Load it**: set requests per day and the class mix. Scrub the timeline to see the day each quota is crossed; daily caps show the hour they hit.
- **Protect it**: flip a gate's protection and watch blocked traffic, bills and search visibility change together.
- **Price it**: switch Cloudflare/Vercel and Free/Paid in the top bar. Every bill line links to the pricing page it came from.
- **Ship it**: export `wrangler.jsonc` or `vercel.json` plus stack notes.

## WebMCP

The page registers **32 tools** on `document.modelContext` (Chrome 149+ with `chrome://flags/#enable-webmcp-testing`). A browser agent such as Gemini in Chrome can orient itself (`describe_studio`), read and rewrite the diagram, change the provider and plan, set traffic, toggle protections, read the bill and the layer view against free-tier allowances, drive the timeline (day / month / year, play, seek), arrange the canvas, focus nodes and open panels, look up alternatives, analyse a product URL, export configuration, and save, open, rename, remix or delete blueprints.

The in-page architect (an Agents SDK `Agent` on a Durable Object, streaming over HTTP through the AI SDK, with Workers AI) uses **the same tool definitions**. Its tools have no server-side `execute`: the stream stops at each call, the browser runs it, and the AI SDK continues the turn. Its tool calls are routed through `document.modelContext.executeTool` when the browser exposes it, so WebMCP is the single execution path for both agents. Without WebMCP the assistant runs the identical tools directly, and the badge in the top bar says so. The **Tools** tab lists every call, who made it, and which path it took.

Tool definitions live in [`src/tools/index.ts`](src/tools/index.ts); the schema is zod, and JSON Schema is derived once for both consumers ([`src/tools/define.ts`](src/tools/define.ts)). Registration and routing are in [`src/tools/webmcp.ts`](src/tools/webmcp.ts).

| Tool                                                              | Purpose                                    |
| ----------------------------------------------------------------- | ------------------------------------------ |
| `get_diagram`, `set_diagram`, `patch_diagram`                     | Read, replace or edit the architecture DSL |
| `list_templates`, `load_template`                                 | Starting points, including verdict pages   |
| `list_products`, `explain_product`                                | The catalog on both providers, with gaps   |
| `set_provider`, `set_plan`                                        | Re-label and re-price the whole design     |
| `set_traffic_mix`, `set_protection`                               | Drive the simulator                        |
| `get_snapshot`, `get_bill`, `compare_providers`, `explain_charge` | Read what happened and why it costs that   |
| `analyze_product`, `propose_architecture`                         | URL or description → breakdown → diagram   |
| `export_config`                                                   | Deployable config and stack notes          |

### How agents find the tools

Three layers, all backed by the same tool definitions:

1. **Inline registration in `<head>`.** The tool surface (names, descriptions, JSON Schemas) is rendered into the server HTML and registered on `document.modelContext` before any bundle loads, so `getTools()` is never empty. The stubs wait for the app and hand off to the full implementations once React mounts.
2. **Declarative forms.** Twelve tools are also announced as `<form toolname tooldescription toolautosubmit>` with `toolparamdescription` on each field, visually hidden. Agents that only read the declarative surface, or that inspect the page before JavaScript runs, still see them; submissions answer through `SubmitEvent.respondWith`.
3. **Imperative bridge.** After hydration the full set of 32 tools is registered with `registerTool`, logged in the Tools tab and shared with the in-page architect.

## How the numbers work

Not a queueing simulator. Each request class is walked through the diagram as a rate; each node blocks it, answers it, or bills it and forwards it along its edges. Rates are computed once per configuration and the clock only accumulates them, so the canvas runs at 60 fps for free.

- **Pricing and quotas** are in [`src/engine/pricing.cloudflare.json`](src/engine/pricing.cloudflare.json) and [`src/engine/pricing.vercel.json`](src/engine/pricing.vercel.json). Every meter has a source URL. Values the pricing pages do not state are `null` and flagged `unverified`; the UI shows them as such rather than guessing.
- **Free-plan caps** are enforced. On Cloudflare Free, requests past the daily Worker cap fail, and the simulator drops them at that node so nothing downstream is billed either. Vercel Hobby limits block the feature.
- **Vercel Pro** is modelled as a plan fee that includes a shared usage credit, which is how the plan page describes it.
- **Tests** assert per-node conservation (arrivals = blocked + dropped + answered + forwarded), determinism, and that no snapshot value is ever `NaN`. Run `npm test`.

Modelling assumptions that are not price facts are labelled _estimate_ in the inspector (Workers AI neurons per request, Vectorize dimensions per query, Neon compute per query).

## The DSL

```
direction right
title "SaaS app"

client [kind: client]
edge "Edge" {
  shield [kind: bot-shield]
  cache [kind: edge-cache, hit: 0.6]
}
app [kind: ssr, label: "App (SSR)", cpuMs: 25]
db [kind: sql, rowsRead: 40]

client > shield
shield > cache
cache > app
app > db: "queries" [ops: 2]
```

Kinds are generic (`compute`, `kv`, `sql`, `blob`, `queue`, `actor`, …) and map to a product on each provider in [`src/engine/catalog.ts`](src/engine/catalog.ts). `ops` on an edge is calls per request. Parser, printer and patch operations are in [`src/engine/dsl.ts`](src/engine/dsl.ts).

## Stack

TanStack Start on Cloudflare Workers, React Flow + ELK for the canvas, Cloudflare Agents SDK (an `Agent` on a Durable Object, HTTP streaming) with the AI SDK and Workers AI for the architect, Tailwind v4 with [Fluid Functionalism](https://www.fluidfunctionalism.com) components and tokens.

## Run it

```bash
npm install
npx wrangler types
npm run dev
```

Open http://localhost:5173. For WebMCP, use Chrome 149+ with `chrome://flags/#enable-webmcp-testing` enabled and reload; the badge turns green.

Deploy with `npm run deploy`. The Worker needs the `AI` binding and the `ArchitectAgent` Durable Object declared in [`wrangler.jsonc`](wrangler.jsonc); both are created on first deploy.

## Notices

Cloudflare, the Cloudflare logo, and Cloudflare Workers are trademarks of Cloudflare, Inc. Vercel and the Vercel logo are trademarks of Vercel, Inc. Granola is a trademark of its owner. Blueprint is an independent project and is not affiliated with or endorsed by any of them. Product names are used to describe the products. Cloudflare product icons are from the cloudflare-docs repository (CC BY 4.0); Vercel has no product icon set, so Blueprint's own glyphs are used there.

UI components and design tokens are vendored from Fluid Functionalism (MIT). See [LICENSE](LICENSE).
