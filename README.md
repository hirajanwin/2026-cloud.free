# freenet.free

**Design how to build a product on Cloudflare or Vercel, watch requests flow and get billed, and let your browser's agent drive the canvas through WebMCP.**

freenet.free is a WebMCP-powered studio for the question "how would I vibecode this, and what will it cost me?"

- Paste a product URL or describe an app. The architect splits it into a core loop and polish, decides which platform primitives the core loop needs, and draws the architecture.
- Flip one switch to price the same design on **Cloudflare** or **Vercel**, free tier or paid. Every number comes from the official pricing pages, with a source link and an as-of date on every line.
- Drag the traffic mix (humans, search crawlers, AI crawlers, scrapers, botnet) and watch requests flow through the diagram. Turn on bot protection and see the bill fall; block every bot and see search disappear too.
- Export `wrangler.jsonc` or `vercel.json` plus the recommended stack.

Everything an agent can do, a person can do, and the other way round. The diagram is a small text DSL; the canvas, the simulator and the exports are all views of it.

## Why this is needed

**The people building software changed.** Vibe coding, indie hacking and AI-assisted development have put shipping in reach of designers, founders and students who have never read a pricing page. They start on free tiers because the tiers are generous, and they find the limits the way everyone does: a paused project, a dropped request, or an invoice. The tooling for choosing and validating a stack has not kept up with the number of people who now need it.

**Free tiers are quotas, not discounts.** Cloudflare's Free plan and Vercel's Hobby plan are real production tiers, but each is a bundle of separate meters with separate windows: requests per day, rows per day, writes per day, GB per month, minutes per month. A design that fits the headline number can still fail on the meter you did not think about. Nothing in either dashboard shows you that before you deploy.

**Traffic is not what the calculator assumes.** Industry bot reports have put automated traffic at roughly half of all web requests for years, and AI crawlers are now a visible share of that. Bots never hit the cache, hit the long tail, and ignore robots.txt, so they land on exactly the metered paths. A cost model that only counts human visitors is wrong by the amount that matters. Blocking is not free either: block the wrong crawler and you leave search.

**Provider choice is a real decision again.** Cloudflare and Vercel now cover overlapping ground with different primitives, different free allowances, different overage rules and different partner dependencies. Pricing pages change every few months. Comparing the same design on both, honestly, is a spreadsheet exercise almost nobody does, so teams pick on familiarity and discover the gaps later.

**Agents need a place to design, not just to code.** Coding agents write the code they are asked for; the expensive mistakes happen a step earlier, in the architecture. WebMCP lets an agent operate a real tool with real rules. A studio that exposes design, simulation and pricing as tools gives the agent, and the person watching it, a way to reason about cost and failure before the first commit.

freenet.free exists for that gap: one canvas where the diagram, the traffic model, the quota rules and the bill are the same object, and where a person and an agent can work it together.

## Use cases

- **Choose a stack before writing code.** Describe the product, let the architect propose the design, then press `P` to price the same graph on Cloudflare and on Vercel. The gaps are explicit: partner products, missing primitives, different overage rules. Decide with a bill in front of you instead of six pricing tabs.
- **Find out where the free tier breaks.** Set a realistic traffic mix, simulate a month, and read the layers: which meter crosses its allowance, on which day, and whether the platform drops requests or turns the feature off. Then raise a cache hit rate or add a gate and watch the verdict change.
- **Size the cost of bots and crawlers.** Push scrapers and botnet traffic up and see what reaches billable compute and rows. Turn on Bot Fight Mode or a WAF and watch the blocked count and the bill. Block AI crawlers but keep search, and confirm Googlebot still passes.
- **Budget an AI feature honestly.** Drop an OpenAI model on the canvas with its tokens per call, feed it a fraction of your requests, and see the vendor line on the bill, separate from the platform, on the free plan too.
- **Explain a bill you already have.** Rebuild the architecture, match the traffic, and use `explain_charge` to see which nodes and which request classes drive each meter.
- **Let an agent do the design review.** With WebMCP in Chrome, ask the browser's agent to analyse a URL, propose an architecture, run the month and report the breaches. Every tool call lands in the conversation, so the review is auditable.
- **Teach the platforms.** Templates for a static site with an API, a SaaS app, an upload pipeline, realtime rooms and a retrieval assistant each carry a lesson about what breaks first and why.

## Flows

- **Start**: pick a default net, open a saved freenet, or press *New freenet* for an empty canvas. Remix any of them into a saved copy; freenets autosave to the browser.
- **Analyse a product**: ask the architect (or your browser agent) to analyse a URL or description. It proposes an architecture on the canvas and explains why each piece is there.
- **Shape it**: click a product in the left rail to add it, drag a node's handle onto another to connect, double-click to inspect, Delete to remove. Every edit is also available as a tool.
- **Load it**: set requests per day and the class mix. Scrub the timeline to see the day each quota is crossed; daily caps show the hour they hit.
- **Protect it**: flip a gate's protection and watch blocked traffic, bills and search visibility change together.
- **Price it**: switch Cloudflare/Vercel and Free/Paid in the top bar. Every bill line links to the pricing page it came from.
- **Ship it**: export `wrangler.jsonc` or `vercel.json` plus stack notes.

## WebMCP

The page registers **33 tools** on `document.modelContext` (Chrome 149+ with `chrome://flags/#enable-webmcp-testing`). A browser agent such as Gemini in Chrome can orient itself (`describe_studio`), read and rewrite the diagram, change the provider and plan, set traffic, toggle protections, read the bill and the layer view against free-tier allowances, drive the timeline (day / month / year, play, seek), arrange the canvas, focus nodes and open panels, look up alternatives, analyse a product URL, export configuration, and save, open, rename, remix or delete blueprints.

The in-page architect (an Agents SDK `Agent` on a Durable Object, streaming over HTTP through the AI SDK, with Workers AI) uses **the same tool definitions**. Its tools have no server-side `execute`: the stream stops at each call, the browser runs it, and the AI SDK continues the turn. Its tool calls are routed through `document.modelContext.executeTool` when the browser exposes it, so WebMCP is the single execution path for both agents. Without WebMCP the assistant runs the identical tools directly, and the badge in the top bar says so. The **Tools** tab lists every call, who made it, and which path it took.

Tool definitions live in [`src/tools/index.ts`](src/tools/index.ts); the schema is zod, and JSON Schema is derived once for both consumers ([`src/tools/define.ts`](src/tools/define.ts)). Registration and routing are in [`src/tools/webmcp.ts`](src/tools/webmcp.ts).

| Tool                                                              | Purpose                                    |
| ----------------------------------------------------------------- | ------------------------------------------ |
| `get_diagram`, `set_diagram`, `patch_diagram`                     | Read, replace or edit the architecture DSL |
| `list_templates`, `load_template`                                 | Starting points                            |
| `list_products`, `explain_product`                                | The catalog on both providers, with gaps   |
| `set_provider`, `set_plan`                                        | Re-label and re-price the whole design     |
| `set_traffic_mix`, `set_protection`                               | Drive the simulator                        |
| `get_snapshot`, `get_bill`, `compare_providers`, `explain_charge` | Read what happened and why it costs that   |
| `analyze_product`, `propose_architecture`                         | URL or description → breakdown → diagram   |
| `export_config`                                                   | Deployable config and stack notes          |

### How the tools are registered

Every tool is defined once and registered with the standard imperative API. The code lives in [`src/tools/webmcp.ts`](src/tools/webmcp.ts) and [`src/tools/define.ts`](src/tools/define.ts); this is the shape the browser sees:

```ts
document.modelContext.registerTool({
  name: "set_traffic_mix",
  description:
    "Set requests per day and the share of each request class (human, googlebot, ai-crawler, scraper, botnet). Shares are normalised. Omitted fields keep their value.",
  inputSchema: {
    type: "object",
    properties: {
      perDay: { type: "number", minimum: 0 },
      shares: { type: "object", properties: { human: { type: "number" }, botnet: { type: "number" } /* ... */ } },
    },
  },
  execute: async (input) => {
    studio.setMix(input);
    return { content: [{ type: "text", text: JSON.stringify({ mix: studio.get().mix }) }] };
  },
});
```

The same definitions are also announced as declarative forms (`<form toolname tooldescription toolautosubmit>` with `toolparamdescription` on each field) and pre-registered from an inline script in `<head>`, so `getTools()` is populated before hydration.

### How agents find the tools

Three layers, all backed by the same tool definitions:

1. **Inline registration in `<head>`.** The tool surface (names, descriptions, JSON Schemas) is rendered into the server HTML and registered on `document.modelContext` before any bundle loads, so `getTools()` is never empty. The stubs wait for the app and hand off to the full implementations once React mounts.
2. **Declarative forms.** Twelve tools are also announced as `<form toolname tooldescription toolautosubmit>` with `toolparamdescription` on each field, visually hidden. Agents that only read the declarative surface, or that inspect the page before JavaScript runs, still see them; submissions answer through `SubmitEvent.respondWith`.
3. **Imperative bridge.** After hydration the full set of 33 tools is registered with `registerTool`, logged in the Tools tab and shared with the in-page architect.

## Third-party services

OpenAI, Shopify and Netlify products sit on any canvas as `external` nodes with a `service` attr (`openai.gpt55_chat`, `shopify.storefront_api`, `netlify.functions`). Each meters its own units per request (tokens, calls, GB) from `src/engine/services.json`, priced from the vendor's pricing page with source URLs, and shows up as its own lines on the bill, marked as billed by the vendor rather than the platform. The left sidebar lists them next to Cloudflare and Vercel; the filter narrows by vendor. `list_services` exposes the same catalogue to agents.

## Keyboard shortcuts

Press `?` in the studio for the full sheet. Space plays or pauses, `R` resets the clock, `1` `2` `3` pick a day, month or year, `P` switches provider and `Shift+P` the plan, `S` `V` `H` choose the layout, `E` cycles edge style, `L` re-runs layout, `F` fits the design, `I` `B` `A` open the panels, `T` the tools log, `N` starts a new freenet, `⌘S` saves, `[` `]` toggle the sidebars and `/` searches. The same list is returned by `describe_studio`. When a browser agent calls a tool through WebMCP the AI panel comes forward on its own, with a status orb while the agent is working.

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

## Licence

MIT. See [LICENSE](LICENSE); third-party assets and their licences are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
