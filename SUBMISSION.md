# freenet.free — WebMCP Challenge submission

## Links
- Live app: https://freenet.free (Cloudflare Workers; workers.dev fallback listed in the submission form)
- Source: https://github.com/hirajanwin/2026-cloud.free (MIT; Cloudflare product icons CC BY 4.0)
- Requires Chrome 149+ with `chrome://flags/#enable-webmcp-testing` for the browser-agent path. Everything else works in any browser.

## Project name
freenet.free

## Tagline
Design a product on Cloudflare or Vercel, watch requests flow and get billed, and let your browser's agent build it with you through WebMCP.

## Inspiration
Every "can I build this for free" question ends the same way: someone opens six pricing pages, guesses at request counts, and finds out at the end of the month. We wanted a canvas where the architecture is the source of truth, the traffic is honest (humans, search crawlers, AI crawlers, scrapers, botnets), and the bill is computed from the providers' own pricing pages. Then WebMCP made the second half obvious: if the studio exposes its actions as tools, an agent in the browser can design alongside you, on the same canvas, with the same rules.

## What it does
- A DSL describes the architecture; the canvas, layers, timeline and bill are all derived from it.
- A request-accounting simulator sends a daily mix of five traffic classes through the graph. Gates block, caches answer, stores meter reads and writes, compute meters CPU.
- Free-tier quotas are enforced the way the platforms enforce them: past the cap, requests drop or the feature stops. Paid plans keep serving and charge overage. Cloudflare and Vercel price the same design side by side, with partner gaps called out.
- Third-party services (OpenAI, Shopify, Netlify) sit on the canvas as metered nodes billed by the vendor.
- The timeline plays a day, a month or a year, one track per layer as percent of allowance, with daily caps drawn as sawtooth resets.
- 33 WebMCP tools cover all of it: read and rewrite the diagram, switch provider and plan, set traffic, toggle protections, read the bill and layers, drive the timeline, arrange the canvas, focus nodes, look up alternatives and services, analyse a product URL, propose an architecture, export config, and save, open, rename, remix or delete designs.
- An in-page architect (Cloudflare Agents SDK + Workers AI) uses the same tools through `document.modelContext.executeTool`, so one execution path serves both agents, and every call from either shows up in the conversation.

## How we built it
TanStack Start on Cloudflare Workers with a Durable Object agent (Agents SDK, AI SDK v7, Workers AI gpt-oss-120b). React Flow for the canvas, ELK for layout with a custom snake wrap, Fluid Functionalism components and tokens, Geist Sans and Mono. Tools are defined once with zod; the JSON Schema is derived and registered three ways: an inline script in `<head>` so `getTools()` is never empty, declarative `<form toolname>` elements server-rendered for agents that only read markup, and the full imperative registration after hydration. Pricing lives in JSON with a source URL on every meter; `computeBill` never invents a number.

## Challenges we ran into
- Discoverability: a browser agent listed tools before React hydrated and saw nothing. Registering the tool surface from the server-rendered head, then handing execution over to the app, fixed it.
- Chrome returns `executeTool` results as a JSON string envelope; the in-page architect had to unwrap it so both agents see identical results.
- Background tabs: agents often drive a tab you are not looking at, where animation frames never fire. The clock, focus animations and tool handlers all had to work without them.
- Honest pricing for two providers plus three vendors: every unit had to be normalised (per day vs per month, 1k vs 1M, credits vs dollars) without smoothing over the gaps.

## Accomplishments we're proud of
- One tool contract, two agents, one execution path, full audit trail in the chat.
- Conservation-tested simulation: arrivals always equal served plus blocked plus dropped.
- The free-tier verdict is concrete: which meter breaks, on which day, and what the platform does about it.

## What we learned
Agents are excellent at using a well-described tool surface and terrible at guessing UI. Investing in `describe_studio`, tool descriptions and workflows paid off more than any prompt engineering.

## What's next
Partner pricing for Marketplace products (Neon, Upstash), shareable public designs, and a declarative-only mode so agents can drive the studio with JavaScript disabled.

## Built with
TypeScript, React, TanStack Start, TanStack Router, Cloudflare Workers, Durable Objects, Workers AI, Cloudflare Agents SDK, AI SDK, React Flow, ELK, zod, Vitest, Fluid Functionalism, Geist.

---

## Voice-over script (about 2 minutes 30 seconds)

**[0:00 — canvas with the SaaS template, requests counting]**
This is freenet.free. Every card is a real product on Cloudflare or Vercel, and every line is real traffic: humans, search crawlers, AI crawlers, scrapers and botnets, a hundred thousand requests a day, flowing right now.

**[0:15 — press Space, the timeline plays a month]**
The timeline plays a whole month in ninety seconds. Each track is one layer of the design as a percent of its free allowance. Watch KV writes: they hit the daily cap by early afternoon every single day, and past the cap the platform drops the request. That is not a warning we wrote. It is what Cloudflare's pricing page says happens.

**[0:40 — drag the Botnet scrubber up]**
Push botnet traffic up and watch the edge. Bot Fight Mode blocks it before it touches anything billable. Turn it off, and every one of those requests renders a page and reads a database row.

**[0:55 — press P to switch to Vercel]**
One key switches the same design to Vercel. Names change, prices change, and the gaps are honest: no first-party actor model, no WebSockets on Functions, KV and Postgres through Marketplace partners. Same diagram, different bill.

**[1:10 — open Chrome's agent, ask: "Analyse outbid.lol and build it on Cloudflare, then tell me if the free tier holds"]**
Now the part this challenge is about. The page registers thirty-three WebMCP tools. Chrome's agent can see them, and so can this in-page architect, which calls the very same tools through document.modelContext. Ask it to design a real product.

**[1:30 — canvas fills in, AI panel shows the tool calls]**
It analyses the product, proposes an architecture, adds bot protection, simulates the month, and reads the layers. Every call it makes lands in the conversation, and the canvas updates live. Fifteen nodes, and the verdict is specific: Durable Objects requests breach at 3.5 million against 3 million, queues at a million against three hundred thousand. On the paid plan the whole thing costs about twenty-two dollars a month.

**[2:00 — hover an OpenAI node]**
Third-party services sit on the same canvas: OpenAI, Shopify, Netlify, each metered per request and priced from the vendor, so the bill never pretends the model is free.

**[2:15 — press ? for shortcuts, then Save]**
Everything is a keyboard away, and every design saves as a freenet you can remix. freenet.free: the architecture is the source of truth, the traffic is honest, the bill is computed, and the agent in your browser builds with you.
