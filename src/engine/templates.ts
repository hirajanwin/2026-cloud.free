/**
 * Starting points. Each is plain DSL so the agent can load one and then edit
 * it with the same tools a person would use. `verdict` templates carry the
 * canivibecodeit-style brief and are also rendered as prerendered pages.
 */

export interface Template {
  id: string;
  name: string;
  tagline: string;
  /** Longer description shown once loaded. */
  description: string;
  /** What to watch when you raise traffic or flip protections. */
  lesson: string;
  dsl: string;
  verdict?: Verdict;
}

export interface Verdict {
  product: string;
  url: string;
  priceNote: string;
  /** YES | KINDA | NOT REALLY, in canivibecodeit's vocabulary. */
  call: "yes" | "kinda" | "not-really";
  core: string[];
  polish: string[];
  whyPeoplePay: string;
  whatYouLose: string[];
  /** Prompt a person can paste into their coding agent. */
  prompt: string;
}

export const TEMPLATES: Template[] = [
  {
    id: "static-plus-api",
    name: "Static site + API",
    tagline: "The cheapest shape that is still an app.",
    description:
      "Static frontend on the edge, a tiny API for the two things that need a server, sessions in a key-value store.",
    lesson:
      "Raise the botnet share. On Cloudflare the free plan's daily request cap is the thing that breaks; static assets never count against it. On Vercel every request is an Edge Request.",
    dsl: `direction right
title "Static site + API"

client [kind: client, label: "Visitors"]
edge "Edge" {
  shield [kind: bot-shield]
  cache [kind: edge-cache, hit: 0.9]
}
site [kind: static, label: "Built frontend"]
api [kind: compute, label: "API", cpuMs: 4]
sessions [kind: kv, label: "Sessions"]

client > shield
shield > cache
cache > site: "pages"
cache > api: "/api/*" [ops: 0.3]
api > sessions
`,
  },
  {
    id: "saas-sql",
    name: "SaaS app with SQL",
    tagline: "Server-rendered app, auth, relational data.",
    description:
      "Server rendering behind the cache, sessions in KV, everything else in SQL. The default for a paid product.",
    lesson:
      "Scrapers hit uncached pages, so each one costs a render plus database rows. Turn on bot protection and watch rows read fall while search crawlers keep indexing you.",
    dsl: `direction right
title "SaaS app"

client [kind: client]
edge "Edge" {
  waf [kind: waf]
  shield [kind: bot-shield]
  limiter [kind: rate-limit, limitRps: 20]
  cache [kind: edge-cache, hit: 0.6]
}
app [kind: ssr, label: "App (SSR)", cpuMs: 25]
sessions [kind: kv, label: "Sessions"]
db [kind: sql, label: "Postgres / D1", rowsRead: 40]
files [kind: blob, label: "Uploads", bytesKb: 800]

client > waf
waf > shield
shield > limiter
limiter > cache
cache > app
app > sessions: "session lookup"
app > db: "queries" [ops: 2]
app > files: "attachments" [ops: 0.2]
`,
  },
  {
    id: "media-pipeline",
    name: "Upload pipeline",
    tagline: "Upload, queue, process, store.",
    description:
      "Users upload files; a queue decouples processing; results land in object storage and get served from the cache.",
    lesson:
      "Egress is the story. Serving from R2 is free; serving from Blob is metered. Change the `bytesKb` on the storage node and compare the two bills.",
    dsl: `direction right
title "Upload pipeline"

client [kind: client]
edge "Edge" {
  shield [kind: bot-shield]
  cache [kind: edge-cache, hit: 0.8, bytesKb: 900]
}
api [kind: compute, label: "Upload API", cpuMs: 6]
jobs [kind: queue, label: "Processing queue"]
worker [kind: compute, label: "Transcoder", cpuMs: 400]
store [kind: blob, label: "Media", bytesKb: 900, writeShare: 0.2]

client > shield
shield > cache
cache > api: "POST /upload" [ops: 0.05]
cache > store: "GET media"
api > jobs
jobs > worker
worker > store: "write result"
`,
  },
  {
    id: "realtime-rooms",
    name: "Realtime rooms",
    tagline: "Chat, presence, collaborative state.",
    description:
      "Each room is a stateful actor holding the connections and the state. This is the shape Vercel cannot host natively.",
    lesson:
      "Flip to Vercel and read the gap notes: WebSockets need a partner and the actor becomes a function plus Redis round trips.",
    dsl: `direction right
title "Realtime rooms"

client [kind: client]
edge "Edge" {
  shield [kind: bot-shield]
}
app [kind: static, label: "Client app"]
rooms [kind: actor, label: "Room actor", durationMs: 80]
sockets [kind: realtime, label: "WebSockets"]
history [kind: sql, label: "Message history", rowsRead: 50]

client > shield
shield > app
shield > sockets: "ws://" [ops: 0.5]
sockets > rooms
rooms > history: "persist" [ops: 0.3]
`,
  },
  {
    id: "ai-rag",
    name: "AI assistant with retrieval",
    tagline: "Embeddings, a vector index, a gateway, a model.",
    description:
      "Questions go through an AI gateway to a model; retrieval pulls context from a vector index over your documents.",
    lesson:
      "AI crawlers do not use your assistant, but scrapers hammering the ask endpoint burn neurons. Rate limit the ask route and watch the AI line on the bill.",
    dsl: `direction right
title "AI assistant"

client [kind: client]
edge "Edge" {
  shield [kind: bot-shield]
  limiter [kind: rate-limit, limitRps: 5]
}
app [kind: ssr, label: "Chat UI", cpuMs: 15]
gateway [kind: ai-gateway]
embed [kind: llm, label: "Embeddings", neurons: 40]
index [kind: vector, label: "Docs index", indexVectors: 20000]
model [kind: llm, label: "Chat model", neurons: 900]
openai [kind: external, label: "OpenAI API (tokens billed by OpenAI)"]
docs [kind: sql, label: "Documents"]

client > shield
shield > limiter
limiter > app
app > gateway: "ask" [ops: 0.4]
gateway > embed
embed > index: "top-k"
gateway > model
gateway > openai: "frontier models" [ops: 0.3]
app > docs
`,
  },
];

export function templateById(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
