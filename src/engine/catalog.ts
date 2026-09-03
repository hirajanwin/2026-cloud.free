/**
 * The product catalog: one generic KIND per architectural role, and for each
 * kind a concrete product on each provider. The diagram only ever names
 * kinds, so flipping the provider re-labels every node and re-prices every
 * meter without touching the document.
 *
 * The prose here is deliberately opinionated ("when to use") but every
 * number lives in pricing.*.json with a source URL. Per-request meter usage
 * declared below is a DEFAULT the node's attrs can override (e.g. `rowsRead`).
 */
import type { Provider } from "./dsl";
import type { RequestClass } from "./types";

export type ProductKind =
  | "client"
  | "edge-cache"
  | "waf"
  | "bot-shield"
  | "rate-limit"
  | "static"
  | "ssr"
  | "compute"
  | "kv"
  | "sql"
  | "blob"
  | "queue"
  | "actor"
  | "workflow"
  | "vector"
  | "llm"
  | "ai-gateway"
  | "search"
  | "cron"
  | "realtime"
  | "hyperdrive"
  | "images"
  | "stream"
  | "browser"
  | "turnstile"
  | "email"
  | "load-balancer"
  | "zaraz"
  | "analytics"
  | "access"
  | "container"
  | "flags"
  | "sandbox"
  | "middleware"
  | "external";

export const PRODUCT_KINDS: readonly ProductKind[] = [
  "client",
  "edge-cache",
  "waf",
  "bot-shield",
  "rate-limit",
  "static",
  "ssr",
  "compute",
  "kv",
  "sql",
  "blob",
  "queue",
  "actor",
  "workflow",
  "vector",
  "llm",
  "ai-gateway",
  "search",
  "cron",
  "realtime",
  "hyperdrive",
  "images",
  "stream",
  "browser",
  "turnstile",
  "email",
  "load-balancer",
  "zaraz",
  "analytics",
  "access",
  "container",
  "flags",
  "sandbox",
  "middleware",
  "external",
];

export function isProductKind(v: string): v is ProductKind {
  return (PRODUCT_KINDS as readonly string[]).includes(v);
}

export type Category =
  | "traffic"
  | "edge"
  | "security"
  | "compute"
  | "data"
  | "messaging"
  | "ai"
  | "other";

/**
 * How the simulator treats a node.
 *  source   emits requests (the client).
 *  gate     may block a class before anything downstream is billed.
 *  cache    answers a share of requests itself; the rest go downstream.
 *  compute  runs per request, then fans out to every outgoing edge.
 *  store    leaf that is read/written; never fans out.
 *  sink     leaf with no meters of its own (external services).
 */
export type Role = "source" | "gate" | "cache" | "compute" | "store" | "sink";

export interface KindSpec {
  kind: ProductKind;
  category: Category;
  role: Role;
  /** Generic name shown when no provider is chosen. */
  name: string;
  description: string;
  /** Default node attrs the simulator reads. */
  defaults: Record<string, number>;
}

/** Cache hit rate by class, relative to the node's `hit` attr for humans. */
export const CACHE_HIT_BY_CLASS: Record<RequestClass, number> = {
  human: 1, // × hit attr
  googlebot: 0.55, // crawls broadly, some pages warm
  "ai-crawler": 0.25, // long tail, mostly cold
  scraper: 0.1, // deliberately uncached paths
  botnet: 0, // random URLs, never warm
};

export const KINDS: Record<ProductKind, KindSpec> = {
  client: {
    kind: "client",
    category: "traffic",
    role: "source",
    name: "Visitors",
    description:
      "Where requests come from. The traffic mix decides who they are.",
    defaults: {},
  },
  "edge-cache": {
    kind: "edge-cache",
    category: "edge",
    role: "cache",
    name: "Edge cache / CDN",
    description:
      "Answers repeat requests at the edge so nothing behind it is billed.",
    defaults: { hit: 0.85, bytesKb: 60 },
  },
  waf: {
    kind: "waf",
    category: "security",
    role: "gate",
    name: "WAF",
    description:
      "Managed rules that drop malicious payloads and known-bad traffic before origin.",
    defaults: {},
  },
  "bot-shield": {
    kind: "bot-shield",
    category: "security",
    role: "gate",
    name: "Bot protection",
    description:
      "Classifies automation. Verified crawlers can be allowed while scrapers and botnets are blocked.",
    defaults: {},
  },
  "rate-limit": {
    kind: "rate-limit",
    category: "security",
    role: "gate",
    name: "Rate limiting",
    description:
      "Caps requests per client. Sheds the burst; well-behaved traffic is untouched.",
    defaults: { limitRps: 50 },
  },
  static: {
    kind: "static",
    category: "compute",
    role: "cache",
    name: "Static assets",
    description: "Pre-built HTML, JS, CSS and images served from the edge.",
    defaults: { hit: 1, bytesKb: 120 },
  },
  ssr: {
    kind: "ssr",
    category: "compute",
    role: "compute",
    name: "Server rendering",
    description:
      "Renders pages per request. Every hit costs compute; cache what you can in front of it.",
    defaults: { cpuMs: 30, bytesKb: 80 },
  },
  compute: {
    kind: "compute",
    category: "compute",
    role: "compute",
    name: "API / functions",
    description: "Request handlers. Billed per invocation and per CPU time.",
    defaults: { cpuMs: 5, bytesKb: 8 },
  },
  kv: {
    kind: "kv",
    category: "data",
    role: "store",
    name: "Key-value store",
    description:
      "Eventually consistent reads at the edge. Sessions, flags, small config.",
    defaults: { writeShare: 0.1 },
  },
  sql: {
    kind: "sql",
    category: "data",
    role: "store",
    name: "SQL database",
    description:
      "Relational data. Priced by rows touched or by compute hours depending on the vendor.",
    defaults: { rowsRead: 20, rowsWritten: 1, writeShare: 0.2 },
  },
  blob: {
    kind: "blob",
    category: "data",
    role: "store",
    name: "Object storage",
    description: "Files, uploads, media. Egress is where vendors differ most.",
    defaults: { bytesKb: 500, writeShare: 0.05 },
  },
  queue: {
    kind: "queue",
    category: "messaging",
    role: "compute",
    name: "Queue",
    description: "Buffers work for consumers. Absorbs bursts; drains later.",
    defaults: { opsPerMessage: 3 },
  },
  actor: {
    kind: "actor",
    category: "compute",
    role: "compute",
    name: "Stateful actor",
    description:
      "A single-threaded object with its own storage and address. Rooms, counters, per-user state.",
    defaults: { cpuMs: 2, durationMs: 50, memGb: 0.128 },
  },
  workflow: {
    kind: "workflow",
    category: "compute",
    role: "compute",
    name: "Durable workflow",
    description:
      "Multi-step jobs that survive restarts. Steps retry; state persists between them.",
    defaults: { steps: 5, cpuMs: 10 },
  },
  vector: {
    kind: "vector",
    category: "ai",
    role: "store",
    name: "Vector index",
    description: "Similarity search over embeddings for retrieval.",
    defaults: { dims: 768, indexVectors: 10_000 },
  },
  llm: {
    kind: "llm",
    category: "ai",
    role: "store",
    name: "LLM inference",
    description:
      "Text or embedding generation. Priced by tokens or neurons; varies per model.",
    defaults: { neurons: 300 },
  },
  "ai-gateway": {
    kind: "ai-gateway",
    category: "ai",
    role: "compute",
    name: "AI gateway",
    description:
      "Proxy in front of model providers: caching, rate limits, logs, fallbacks.",
    defaults: {},
  },
  search: {
    kind: "search",
    category: "data",
    role: "store",
    name: "Search index",
    description:
      "Full-text search. Usually a partner service on both platforms.",
    defaults: {},
  },
  cron: {
    kind: "cron",
    category: "compute",
    role: "compute",
    name: "Scheduled job",
    description:
      "Runs on a timer, not per request. Contributes a fixed daily invocation count.",
    defaults: { runsPerDay: 24, cpuMs: 50 },
  },
  realtime: {
    kind: "realtime",
    category: "messaging",
    role: "compute",
    name: "Realtime / WebSockets",
    description: "Long-lived connections and fan-out to connected clients.",
    defaults: { cpuMs: 1, durationMs: 100, memGb: 0.128 },
  },
  hyperdrive: {
    kind: "hyperdrive",
    category: "data",
    role: "compute",
    name: "Database proxy / pooler",
    description: "Pools connections and caches queries in front of an existing Postgres or MySQL.",
    defaults: { hit: 0.4 },
  },
  images: {
    kind: "images",
    category: "edge",
    role: "compute",
    name: "Image optimisation",
    description: "Resizes and transforms images on request. Priced per unique transformation.",
    defaults: { uniqueShare: 0.02, bytesKb: 120 },
  },
  stream: {
    kind: "stream",
    category: "edge",
    role: "compute",
    name: "Video",
    description: "Stores and delivers video. Priced per minute stored and per minute watched.",
    defaults: { minutesPerView: 4, uploadShare: 0.001 },
  },
  browser: {
    kind: "browser",
    category: "compute",
    role: "compute",
    name: "Headless browser",
    description: "Renders pages or screenshots in a real browser. Priced by browser time.",
    defaults: { seconds: 6 },
  },
  turnstile: {
    kind: "turnstile",
    category: "security",
    role: "gate",
    name: "Human verification",
    description: "An invisible challenge on forms and sign-ups. Blocks automation without a CAPTCHA puzzle.",
    defaults: {},
  },
  email: {
    kind: "email",
    category: "messaging",
    role: "store",
    name: "Email",
    description: "Transactional email out, routing in.",
    defaults: { sendShare: 0.02 },
  },
  "load-balancer": {
    kind: "load-balancer",
    category: "edge",
    role: "compute",
    name: "Load balancer",
    description: "Steers traffic across origins by health and geography.",
    defaults: {},
  },
  zaraz: {
    kind: "zaraz",
    category: "edge",
    role: "compute",
    name: "Tag manager",
    description: "Loads third-party tags server-side so the browser stays fast.",
    defaults: { eventsPerView: 3 },
  },
  analytics: {
    kind: "analytics",
    category: "data",
    role: "store",
    name: "Product analytics store",
    description: "Write events per request, query them later.",
    defaults: { pointsPerRequest: 1 },
  },
  access: {
    kind: "access",
    category: "security",
    role: "gate",
    name: "Identity gate",
    description: "SSO in front of internal apps and admin routes. Priced per user, not per request.",
    defaults: { users: 25 },
  },
  container: {
    kind: "container",
    category: "compute",
    role: "compute",
    name: "Container",
    description: "Run any binary on demand next to your functions. Priced by vCPU and memory seconds.",
    defaults: { cpuSeconds: 0.5 },
  },
  flags: {
    kind: "flags",
    category: "data",
    role: "store",
    name: "Config & feature flags",
    description: "Tiny, ultra-low-latency reads of config and flags on every request.",
    defaults: { readsPerRequest: 1 },
  },
  sandbox: {
    kind: "sandbox",
    category: "compute",
    role: "compute",
    name: "Code sandbox",
    description: "Run untrusted or agent-generated code in an isolated VM or container.",
    defaults: { cpuSeconds: 2, memGb: 1 },
  },
  middleware: {
    kind: "middleware",
    category: "edge",
    role: "compute",
    name: "Routing middleware",
    description: "Runs before the cache and the app on every request: rewrites, redirects, auth checks, A/B.",
    defaults: { cpuMs: 1 },
  },
  external: {
    kind: "external",
    category: "other",
    role: "sink",
    name: "External service",
    description:
      "Third-party API. Not billed by the platform; shown for completeness.",
    defaults: {},
  },
};

/**
 * One billable meter a request touches at this product. `perRequest` is
 * either a number or a function of the node attrs, so a D1 query can bill
 * `rowsRead` rows rather than a made-up constant.
 */
export interface MeterUse {
  meter: string;
  perRequest: number | ((attrs: Record<string, number>) => number);
  /** Shown in the Explain panel. */
  note?: string;
  /** Marks a value that is a modelling estimate, not a fixed price fact. */
  estimate?: boolean;
}

export interface ProductSpec {
  provider: Provider;
  kind: ProductKind;
  /** Official product name. Word marks only; no logos in the data layer. */
  name: string;
  tagline: string;
  docs: string;
  whenToUse: string;
  limits: string;
  /** Recommended frameworks or libraries when this node is the app shell. */
  stack?: string[];
  meters: MeterUse[];
  /**
   * Present when the provider has no first-party product for this kind.
   * The node still exists in the diagram so the comparison stays honest.
   */
  gap?: { severity: "none" | "partner" | "missing"; note: string };
}

const cf = (p: Omit<ProductSpec, "provider">): ProductSpec => ({
  provider: "cloudflare",
  ...p,
});
const vc = (p: Omit<ProductSpec, "provider">): ProductSpec => ({
  provider: "vercel",
  ...p,
});

export const PRODUCTS: Record<Provider, Record<ProductKind, ProductSpec>> = {
  cloudflare: {
    client: cf({
      kind: "client",
      name: "Visitors",
      tagline: "Browsers, crawlers, bots.",
      docs: "https://developers.cloudflare.com/fundamentals/",
      whenToUse: "Always present. Shape the mix with the traffic panel.",
      limits: "",
      meters: [],
    }),
    "edge-cache": cf({
      kind: "edge-cache",
      name: "Cloudflare Cache",
      tagline: "CDN caching at 330+ cities, included on every plan.",
      docs: "https://developers.cloudflare.com/cache/",
      whenToUse:
        "Put it in front of anything that can be cached. Cache hits cost nothing downstream.",
      limits:
        "Default cache rules only cache static file types; use Cache Rules or Cache-Control to cache HTML.",
      meters: [
        {
          meter: "cf.cache.requests",
          perRequest: 1,
          note: "Included; no per-request charge.",
        },
      ],
    }),
    waf: cf({
      kind: "waf",
      name: "WAF managed rules",
      tagline: "Free managed ruleset plus custom rules on every zone.",
      docs: "https://developers.cloudflare.com/waf/",
      whenToUse:
        "Always on. Blocks known exploits and volumetric junk before it reaches a Worker.",
      limits:
        "The full managed ruleset needs Pro or above; the free ruleset covers high-severity CVEs.",
      meters: [
        {
          meter: "cf.waf.requests",
          perRequest: 1,
          note: "Included with the zone.",
        },
      ],
    }),
    "bot-shield": cf({
      kind: "bot-shield",
      name: "Bot Fight Mode",
      tagline: "Challenges definitely-automated traffic; verified bots pass.",
      docs: "https://developers.cloudflare.com/bots/get-started/bot-fight-mode/",
      whenToUse:
        "Turn on for any public site. Add the AI crawler block if you do not want to be training data.",
      limits:
        "Bot Fight Mode is coarse. Super Bot Fight Mode (Pro) adds likely-automated scoring and allow lists.",
      meters: [
        {
          meter: "cf.bot_fight.requests",
          perRequest: 1,
          note: "Included on all plans.",
        },
      ],
    }),
    "rate-limit": cf({
      kind: "rate-limit",
      name: "Rate limiting rules",
      tagline: "Per-IP request caps at the edge.",
      docs: "https://developers.cloudflare.com/waf/rate-limiting-rules/",
      whenToUse:
        "Protect login, search and any endpoint that hits the database per request.",
      limits:
        "Free plan includes one rule with a 10 second window; more rules and windows on paid plans.",
      meters: [
        {
          meter: "cf.rate_limit.requests",
          perRequest: 1,
          note: "Included; rule count is plan-limited.",
        },
      ],
    }),
    static: cf({
      kind: "static",
      name: "Workers Static Assets",
      tagline: "Free static hosting bound to your Worker.",
      docs: "https://developers.cloudflare.com/workers/static-assets/",
      whenToUse:
        "Ship the built frontend here. Requests for static assets are free and do not invoke the Worker.",
      limits: "20,000 files per version, 25 MiB per file.",
      stack: ["Astro", "Vite + React", "TanStack Router"],
      meters: [
        {
          meter: "cf.cache.requests",
          perRequest: 1,
          note: "Static asset requests are free and not counted as Worker requests.",
        },
      ],
    }),
    ssr: cf({
      kind: "ssr",
      name: "Workers (SSR)",
      tagline: "Server-render with TanStack Start, Astro or Remix on Workers.",
      docs: "https://developers.cloudflare.com/workers/framework-guides/",
      whenToUse:
        "Pages that depend on the user or on fresh data. Cache the rest as static.",
      limits:
        "CPU time per request is capped (10 ms on Free, configurable up to 5 minutes on Paid).",
      stack: ["TanStack Start", "Astro", "Hono + JSX"],
      meters: [
        { meter: "cf.workers.requests", perRequest: 1 },
        {
          meter: "cf.workers.cpu_ms",
          perRequest: (a) => a.cpuMs ?? 30,
          note: "Wall time is free; only CPU time is billed.",
        },
      ],
    }),
    compute: cf({
      kind: "compute",
      name: "Workers",
      tagline: "Serverless at the edge, billed by request and CPU time.",
      docs: "https://developers.cloudflare.com/workers/platform/pricing/",
      whenToUse:
        "APIs, webhooks, glue. Small CPU footprints make the paid tier very cheap.",
      limits:
        "Free plan: daily request cap; requests past it fail. No charge for time spent waiting on I/O.",
      stack: ["Hono", "TanStack Start", "Workers RPC"],
      meters: [
        { meter: "cf.workers.requests", perRequest: 1 },
        { meter: "cf.workers.cpu_ms", perRequest: (a) => a.cpuMs ?? 5 },
      ],
    }),
    kv: cf({
      kind: "kv",
      name: "Workers KV",
      tagline: "Global, eventually consistent key-value reads.",
      docs: "https://developers.cloudflare.com/kv/",
      whenToUse:
        "Sessions, feature flags, cached API responses. Reads are cheap; writes propagate in about a minute.",
      limits:
        "Eventual consistency (up to 60 s); 25 MiB per value; one write per second per key.",
      meters: [
        { meter: "cf.kv.reads", perRequest: (a) => 1 - (a.writeShare ?? 0.1) },
        { meter: "cf.kv.writes", perRequest: (a) => a.writeShare ?? 0.1 },
      ],
    }),
    sql: cf({
      kind: "sql",
      name: "D1",
      tagline: "Serverless SQLite, billed by rows read and written.",
      docs: "https://developers.cloudflare.com/d1/",
      whenToUse:
        "Relational app data with modest write volume. Index your queries: rows scanned are rows billed.",
      limits:
        "10 GB per database; one primary region per database (read replication available).",
      meters: [
        {
          meter: "cf.d1.rows_read",
          perRequest: (a) => (a.rowsRead ?? 20) * (1 - (a.writeShare ?? 0.2)),
          note: "Rows scanned per query, not rows returned. Indexes matter.",
        },
        {
          meter: "cf.d1.rows_written",
          perRequest: (a) => (a.rowsWritten ?? 1) * (a.writeShare ?? 0.2),
        },
      ],
    }),
    blob: cf({
      kind: "blob",
      name: "R2",
      tagline: "S3-compatible object storage with zero egress fees.",
      docs: "https://developers.cloudflare.com/r2/",
      whenToUse:
        "Uploads, media, backups, anything users download a lot. Egress is free.",
      limits:
        "Class A operations (writes, lists) cost more than Class B (reads).",
      meters: [
        {
          meter: "cf.r2.class_b",
          perRequest: (a) => 1 - (a.writeShare ?? 0.05),
          note: "Reads",
        },
        {
          meter: "cf.r2.class_a",
          perRequest: (a) => a.writeShare ?? 0.05,
          note: "Writes and lists",
        },
        {
          meter: "cf.r2.egress_gb",
          perRequest: (a) =>
            ((a.bytesKb ?? 500) / 1_048_576) * (1 - (a.writeShare ?? 0.05)),
          note: "Counted but priced at zero.",
        },
      ],
    }),
    queue: cf({
      kind: "queue",
      name: "Queues",
      tagline: "Message queue billed per operation, with batching and retries.",
      docs: "https://developers.cloudflare.com/queues/",
      whenToUse:
        "Decouple slow work from the request: emails, image processing, webhooks fan-out.",
      limits:
        "Each write, read and delete of a message is one operation; a message costs about three.",
      meters: [
        {
          meter: "cf.queues.ops",
          perRequest: (a) => a.opsPerMessage ?? 3,
          note: "write + read + ack",
        },
      ],
    }),
    actor: cf({
      kind: "actor",
      name: "Durable Objects",
      tagline:
        "Single-threaded objects with storage and WebSockets, addressed by name.",
      docs: "https://developers.cloudflare.com/durable-objects/",
      whenToUse:
        "Chat rooms, collaborative docs, per-user rate limits, anything that needs coordination.",
      limits:
        "One object handles one request at a time. Shard by key for throughput.",
      meters: [
        { meter: "cf.do.requests", perRequest: 1 },
        {
          meter: "cf.do.duration_gbs",
          perRequest: (a) => ((a.durationMs ?? 50) / 1000) * (a.memGb ?? 0.128),
          note: "Billed while the object is active, in GB-seconds.",
        },
      ],
    }),
    workflow: cf({
      kind: "workflow",
      name: "Workflows",
      tagline: "Durable, multi-step execution on Workers.",
      docs: "https://developers.cloudflare.com/workflows/",
      whenToUse:
        "Onboarding sequences, long-running pipelines, anything with retries and sleeps.",
      limits:
        "Billed as Workers CPU time plus storage; each step is an invocation.",
      meters: [
        {
          meter: "cf.workers.requests",
          perRequest: (a) => a.steps ?? 5,
          note: "One Worker invocation per step.",
        },
        {
          meter: "cf.workers.cpu_ms",
          perRequest: (a) => (a.steps ?? 5) * (a.cpuMs ?? 10),
        },
      ],
    }),
    vector: cf({
      kind: "vector",
      name: "Vectorize",
      tagline: "Vector database billed by dimensions queried and stored.",
      docs: "https://developers.cloudflare.com/vectorize/",
      whenToUse: "RAG over your own documents next to Workers AI embeddings.",
      limits:
        "Queried dimensions scale with index size, so a query over a big index costs more.",
      meters: [
        {
          meter: "cf.vectorize.queried_dims",
          perRequest: (a) => (a.dims ?? 768) * (a.indexVectors ?? 10_000),
          note: "Dimensions × vectors in the index per query.",
          estimate: true,
        },
      ],
    }),
    llm: cf({
      kind: "llm",
      name: "Workers AI",
      tagline: "Serverless inference billed in neurons.",
      docs: "https://developers.cloudflare.com/workers-ai/",
      whenToUse:
        "Embeddings, summaries, small chat models without an API key. Route big models through AI Gateway.",
      limits:
        "Neurons per request depend on the model and token count. Set `neurons` per node.",
      meters: [
        {
          meter: "cf.workers_ai.neurons",
          perRequest: (a) => a.neurons ?? 300,
          note: "Model dependent.",
          estimate: true,
        },
      ],
    }),
    "ai-gateway": cf({
      kind: "ai-gateway",
      name: "AI Gateway",
      tagline:
        "Caching, rate limiting, logs and fallbacks in front of any model provider.",
      docs: "https://developers.cloudflare.com/ai-gateway/",
      whenToUse:
        "Any app calling OpenAI, Anthropic or Workers AI. Cached prompts are free repeats.",
      limits:
        "Provider token costs still apply; the gateway itself is free with log retention limits.",
      meters: [
        {
          meter: "cf.ai_gateway.requests",
          perRequest: 1,
          note: "Gateway is free; provider tokens are not.",
        },
      ],
    }),
    search: cf({
      kind: "search",
      name: "Search (partner)",
      tagline: "No first-party full-text search; use D1 FTS5 or a partner.",
      docs: "https://developers.cloudflare.com/d1/",
      whenToUse:
        "Small indexes: SQLite FTS5 inside D1. Large: Algolia, Typesense, Meilisearch.",
      limits: "",
      meters: [],
      gap: {
        severity: "partner",
        note: "D1 FTS5 covers small sites; otherwise a partner service.",
      },
    }),
    cron: cf({
      kind: "cron",
      name: "Cron Triggers",
      tagline: "Scheduled Worker invocations.",
      docs: "https://developers.cloudflare.com/workers/configuration/cron-triggers/",
      whenToUse: "Nightly jobs, digests, cache warming.",
      limits:
        "Counted as Worker requests. Up to 5 triggers per Worker on Free.",
      meters: [
        { meter: "cf.workers.requests", perRequest: 1 },
        { meter: "cf.workers.cpu_ms", perRequest: (a) => a.cpuMs ?? 50 },
      ],
    }),
    realtime: cf({
      kind: "realtime",
      name: "Durable Objects WebSockets",
      tagline: "Hibernatable WebSockets on Durable Objects.",
      docs: "https://developers.cloudflare.com/durable-objects/best-practices/websockets/",
      whenToUse:
        "Presence, live cursors, chat. Hibernation means idle sockets cost nothing.",
      limits: "Per-object throughput; shard rooms by id.",
      meters: [
        { meter: "cf.do.requests", perRequest: 1 },
        {
          meter: "cf.do.duration_gbs",
          perRequest: (a) =>
            ((a.durationMs ?? 100) / 1000) * (a.memGb ?? 0.128),
        },
      ],
    }),
    hyperdrive: cf({
      kind: "hyperdrive",
      name: "Hyperdrive",
      tagline: "Connection pooling and query caching for your existing database.",
      docs: "https://developers.cloudflare.com/hyperdrive/",
      whenToUse: "Put it between Workers and a Postgres or MySQL you already run. Cached reads never reach the origin.",
      limits: "Included with Workers; caching applies to non-mutating queries.",
      meters: [{ meter: "cf.hyperdrive.queries", perRequest: 1, note: "Included; no per-query charge." }],
    }),
    images: cf({
      kind: "images",
      name: "Cloudflare Images",
      tagline: "Store, resize and deliver images from the edge.",
      docs: "https://developers.cloudflare.com/images/",
      whenToUse: "User avatars, product photos, any responsive image set. Unique transformations are what you pay for; repeats are cached.",
      limits: "Priced per unique transformation per month, plus storage and delivery if you store originals in Images.",
      meters: [
        { meter: "cf.images.transformations", perRequest: (a) => a.uniqueShare ?? 0.02, note: "Share of requests that are a new (size, format) variant.", estimate: true },
        { meter: "cf.images.delivered", perRequest: 1 },
      ],
    }),
    stream: cf({
      kind: "stream",
      name: "Cloudflare Stream",
      tagline: "Video storage, encoding and delivery by the minute.",
      docs: "https://developers.cloudflare.com/stream/",
      whenToUse: "Course platforms, UGC video, recordings. No egress line; you pay per minute watched.",
      limits: "Minutes stored and minutes delivered are the two meters; live streaming has its own rates.",
      meters: [
        { meter: "cf.stream.minutes_delivered", perRequest: (a) => a.minutesPerView ?? 4, note: "Minutes watched per request." },
        { meter: "cf.stream.minutes_stored", perRequest: (a) => (a.uploadShare ?? 0.001) * (a.minutesPerView ?? 4), note: "Uploads as a share of requests.", estimate: true },
      ],
    }),
    browser: cf({
      kind: "browser",
      name: "Browser Rendering",
      tagline: "Headless Chromium from a Worker.",
      docs: "https://developers.cloudflare.com/browser-rendering/",
      whenToUse: "Screenshots, PDFs, scraping your own pages, agent browsing. Keep sessions short; time is the meter.",
      limits: "Free plan has a small daily allowance; paid bills browser hours beyond the included amount.",
      meters: [{ meter: "cf.browser_rendering.hours", perRequest: (a) => (a.seconds ?? 6) / 3600, note: "Browser seconds per request." }],
    }),
    turnstile: cf({
      kind: "turnstile",
      name: "Turnstile",
      tagline: "Invisible human verification, no puzzles.",
      docs: "https://developers.cloudflare.com/turnstile/",
      whenToUse: "Sign-up, login and contact forms. Stops scripted abuse before it hits a Worker or a database.",
      limits: "Free; widget count varies by plan.",
      meters: [{ meter: "cf.turnstile.requests", perRequest: 1, note: "Included." }],
    }),
    email: cf({
      kind: "email",
      name: "Email Routing + Email Service",
      tagline: "Receive on your domain for free; send transactional mail from Workers.",
      docs: "https://developers.cloudflare.com/email-routing/",
      whenToUse: "Magic links, receipts, inbound parsing with Email Workers.",
      limits: "Routing is free; sending is priced per message.",
      meters: [{ meter: "cf.email_sending.messages", perRequest: (a) => a.sendShare ?? 0.02, note: "Messages sent as a share of requests." }],
    }),
    "load-balancer": cf({
      kind: "load-balancer",
      name: "Load Balancing",
      tagline: "Health-checked, geo-steered traffic across origins.",
      docs: "https://developers.cloudflare.com/load-balancing/",
      whenToUse: "Multiple origins or regions, failover, canary by weight.",
      limits: "Monthly base price with included DNS queries; more queries billed in blocks.",
      meters: [{ meter: "cf.load_balancing.queries", perRequest: 1 }],
    }),
    zaraz: cf({
      kind: "zaraz",
      name: "Zaraz",
      tagline: "Third-party tags loaded at the edge, not in the browser.",
      docs: "https://developers.cloudflare.com/zaraz/",
      whenToUse: "Analytics, ads and chat widgets without shipping their JavaScript.",
      limits: "Free monthly events, then per million.",
      meters: [{ meter: "cf.zaraz.events", perRequest: (a) => a.eventsPerView ?? 3, note: "Tag events per page view.", estimate: true }],
    }),
    analytics: cf({
      kind: "analytics",
      name: "Workers Analytics Engine",
      tagline: "Write time-series data points from Workers; query with SQL.",
      docs: "https://developers.cloudflare.com/analytics/analytics-engine/",
      whenToUse: "Usage metering, product analytics, per-customer dashboards.",
      limits: "Priced by data points written and read queries.",
      meters: [{ meter: "cf.analytics_engine.datapoints", perRequest: (a) => a.pointsPerRequest ?? 1 }],
    }),
    access: cf({
      kind: "access",
      name: "Cloudflare Access",
      tagline: "Zero Trust SSO in front of any app.",
      docs: "https://developers.cloudflare.com/cloudflare-one/policies/access/",
      whenToUse: "Admin panels, staging, internal tools. Priced per user, so traffic volume does not matter.",
      limits: "Free for a small team; per-user pricing above that.",
      meters: [{ meter: "cf.access.users", perRequest: 0, note: "Billed per user, not per request. Set `users` on the node." }],
    }),
    container: cf({
      kind: "container",
      name: "Containers",
      tagline: "Run containers on demand, orchestrated from a Worker.",
      docs: "https://developers.cloudflare.com/containers/",
      whenToUse: "Binaries, long jobs, languages the Workers runtime cannot run.",
      limits: "Workers Paid only; billed by vCPU, memory and disk seconds while running.",
      meters: [{ meter: "cf.containers.vcpu_seconds", perRequest: (a) => a.cpuSeconds ?? 0.5, note: "vCPU seconds per request.", estimate: true }],
    }),
    flags: cf({
      kind: "flags",
      name: "Workers KV (config)",
      tagline: "Flags and config as KV reads, cached at the edge.",
      docs: "https://developers.cloudflare.com/kv/",
      whenToUse: "Feature flags, remote config, A/B allocation. Reads are cheap; writes propagate in about a minute.",
      limits: "Eventual consistency; no first-party flag UI.",
      meters: [{ meter: "cf.kv.reads", perRequest: (a) => a.readsPerRequest ?? 1 }],
    }),
    sandbox: cf({
      kind: "sandbox",
      name: "Sandbox SDK (Containers)",
      tagline: "Isolated containers for agent-generated code, driven from a Worker.",
      docs: "https://developers.cloudflare.com/sandbox/",
      whenToUse: "Run code an LLM wrote, build steps, data jobs. Billed as container vCPU, memory and disk time.",
      limits: "Workers Paid only.",
      meters: [{ meter: "cf.containers.vcpu_seconds", perRequest: (a) => a.cpuSeconds ?? 2, note: "vCPU seconds per run.", estimate: true }],
    }),
    middleware: cf({
      kind: "middleware",
      name: "Workers (middleware)",
      tagline: "A Worker in front of the origin; Snippets for the simplest rules.",
      docs: "https://developers.cloudflare.com/workers/",
      whenToUse: "Redirects, header rewrites, auth checks, geo routing before the cache decides.",
      limits: "Counts as a Worker request per hit.",
      meters: [
        { meter: "cf.workers.requests", perRequest: 1 },
        { meter: "cf.workers.cpu_ms", perRequest: (a) => a.cpuMs ?? 1 },
      ],
    }),
    external: cf({
      kind: "external",
      name: "External API",
      tagline: "Third-party service.",
      docs: "",
      whenToUse: "Payments, email, auth providers.",
      limits: "",
      meters: [],
    }),
  },
  vercel: {
    client: vc({
      kind: "client",
      name: "Visitors",
      tagline: "Browsers, crawlers, bots.",
      docs: "https://vercel.com/docs",
      whenToUse: "Always present. Shape the mix with the traffic panel.",
      limits: "",
      meters: [],
    }),
    "edge-cache": vc({
      kind: "edge-cache",
      name: "Vercel CDN + ISR",
      tagline: "Edge network caching; ISR keeps rendered pages warm.",
      docs: "https://vercel.com/docs/edge-network/caching",
      whenToUse:
        "Cache rendered pages with ISR or Cache-Control so functions run rarely.",
      limits:
        "Every request, cached or not, counts as an Edge Request. ISR reads and writes are metered separately.",
      meters: [
        {
          meter: "vc.edge.requests",
          perRequest: 1,
          note: "Cache hits still count.",
        },
        {
          meter: "vc.data_transfer.fast_gb",
          perRequest: (a) => (a.bytesKb ?? 60) / 1_048_576,
        },
      ],
    }),
    waf: vc({
      kind: "waf",
      name: "Vercel WAF",
      tagline: "Managed rulesets and custom rules on the Vercel Firewall.",
      docs: "https://vercel.com/docs/vercel-firewall/vercel-waf",
      whenToUse: "Always on. Blocks OWASP-style attacks before functions run.",
      limits: "Custom rule counts and some managed rulesets vary by plan.",
      meters: [
        {
          meter: "vc.firewall.requests",
          perRequest: 1,
          note: "Included with the platform.",
        },
      ],
    }),
    "bot-shield": vc({
      kind: "bot-shield",
      name: "Bot Protection + BotID",
      tagline: "Managed bot rules and invisible challenges.",
      docs: "https://vercel.com/docs/vercel-firewall/bot-protection",
      whenToUse:
        "Enable the managed bot ruleset; add BotID on forms and expensive routes.",
      limits: "Attack Challenge Mode is a manual switch for active incidents.",
      meters: [
        {
          meter: "vc.bot_protection.requests",
          perRequest: 1,
          note: "Included with the platform.",
        },
      ],
    }),
    "rate-limit": vc({
      kind: "rate-limit",
      name: "Firewall rate limiting",
      tagline: "Rate limit rules in the Vercel Firewall.",
      docs: "https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting",
      whenToUse: "Login, search, and API routes that hit a database.",
      limits: "Availability of rate limiting rules depends on plan.",
      meters: [{ meter: "vc.firewall.requests", perRequest: 1 }],
    }),
    static: vc({
      kind: "static",
      name: "Static assets on the Edge Network",
      tagline: "Built output served from the CDN.",
      docs: "https://vercel.com/docs/edge-network",
      whenToUse: "Everything that does not change per user.",
      limits: "Counted as Edge Requests plus Fast Data Transfer.",
      stack: ["Next.js (static export)", "Astro", "Vite"],
      meters: [
        { meter: "vc.edge.requests", perRequest: 1 },
        {
          meter: "vc.data_transfer.fast_gb",
          perRequest: (a) => (a.bytesKb ?? 120) / 1_048_576,
        },
      ],
    }),
    ssr: vc({
      kind: "ssr",
      name: "Next.js on Fluid Compute",
      tagline: "Server rendering on Vercel Functions with active-CPU billing.",
      docs: "https://vercel.com/docs/fluid-compute",
      whenToUse:
        "Dynamic pages, Server Components, streaming. Use ISR or `use cache` to avoid rendering per request.",
      limits:
        "Billed per invocation, active CPU hours and provisioned memory. Hobby pauses when limits are hit.",
      stack: ["Next.js App Router", "Vercel AI SDK"],
      meters: [
        { meter: "vc.functions.invocations", perRequest: 1 },
        {
          meter: "vc.functions.active_cpu_hrs",
          perRequest: (a) => (a.cpuMs ?? 30) / 3_600_000,
        },
        { meter: "vc.edge.requests", perRequest: 1 },
        {
          meter: "vc.data_transfer.fast_gb",
          perRequest: (a) => (a.bytesKb ?? 80) / 1_048_576,
        },
      ],
    }),
    compute: vc({
      kind: "compute",
      name: "Vercel Functions",
      tagline: "Serverless functions with Fluid Compute.",
      docs: "https://vercel.com/docs/functions",
      whenToUse:
        "Route handlers and API routes. Concurrency inside one instance keeps costs down.",
      limits:
        "Invocations, active CPU and provisioned memory are each metered.",
      stack: ["Next.js Route Handlers", "Hono"],
      meters: [
        { meter: "vc.functions.invocations", perRequest: 1 },
        {
          meter: "vc.functions.active_cpu_hrs",
          perRequest: (a) => (a.cpuMs ?? 5) / 3_600_000,
        },
        { meter: "vc.edge.requests", perRequest: 1 },
        {
          meter: "vc.data_transfer.fast_gb",
          perRequest: (a) => (a.bytesKb ?? 8) / 1_048_576,
        },
      ],
    }),
    kv: vc({
      kind: "kv",
      name: "Upstash Redis (Marketplace)",
      tagline: "Redis via the Vercel Marketplace, billed by the partner.",
      docs: "https://vercel.com/marketplace/upstash",
      whenToUse:
        "Sessions, counters, caching. Vercel KV itself was retired in favour of Marketplace Redis.",
      limits: "Partner pricing and free tier apply, not Vercel's.",
      meters: [
        { meter: "vc.kv.commands", perRequest: 1, note: "Partner-billed." },
      ],
      gap: {
        severity: "partner",
        note: "No first-party KV; Upstash via Marketplace.",
      },
    }),
    sql: vc({
      kind: "sql",
      name: "Neon Postgres (Marketplace)",
      tagline: "Serverless Postgres via the Vercel Marketplace.",
      docs: "https://vercel.com/marketplace/neon",
      whenToUse:
        "Relational data with Prisma or Drizzle. Compute-hour billing, so idle is cheap and bursts are not.",
      limits:
        "Partner pricing; connection pooling matters with many function instances.",
      meters: [
        {
          meter: "vc.postgres.compute_hrs",
          perRequest: (a) => (a.queryMs ?? 5) / 3_600_000,
          note: "Approximates compute time per query; Neon bills active compute hours.",
          estimate: true,
        },
      ],
      gap: {
        severity: "partner",
        note: "Vercel Postgres moved to Neon on the Marketplace.",
      },
    }),
    blob: vc({
      kind: "blob",
      name: "Vercel Blob",
      tagline: "Object storage with simple and advanced operations.",
      docs: "https://vercel.com/docs/vercel-blob",
      whenToUse: "User uploads and media served from the edge.",
      limits: "Data transfer out is metered, unlike R2.",
      meters: [
        {
          meter: "vc.blob.simple_ops",
          perRequest: (a) => 1 - (a.writeShare ?? 0.05),
          note: "Reads / HEAD",
        },
        {
          meter: "vc.blob.advanced_ops",
          perRequest: (a) => a.writeShare ?? 0.05,
          note: "Puts, lists, copies",
        },
        {
          meter: "vc.blob.data_transfer_gb",
          perRequest: (a) =>
            ((a.bytesKb ?? 500) / 1_048_576) * (1 - (a.writeShare ?? 0.05)),
        },
      ],
    }),
    queue: vc({
      kind: "queue",
      name: "Queue (partner: Inngest / QStash)",
      tagline:
        "No first-party queue; use Vercel Queues (beta) or a Marketplace partner.",
      docs: "https://vercel.com/docs/queues",
      whenToUse:
        "Background jobs and fan-out. Each delivered message invokes a function.",
      limits:
        "Partner-billed; the function invocation on delivery is still Vercel-billed.",
      meters: [
        {
          meter: "vc.functions.invocations",
          perRequest: 1,
          note: "Delivery invokes a function; queue itself is partner-billed.",
        },
      ],
      gap: {
        severity: "partner",
        note: "Queue is a partner or beta product; only the delivery invocation is modelled.",
      },
    }),
    actor: vc({
      kind: "actor",
      name: "No equivalent",
      tagline: "Vercel has no stateful actor primitive.",
      docs: "https://vercel.com/docs/functions",
      whenToUse:
        "Emulate with a function plus Redis, or run PartyKit / a Durable Object elsewhere.",
      limits:
        "Coordination state must live in an external store; single-writer semantics are on you.",
      meters: [
        {
          meter: "vc.functions.invocations",
          perRequest: 1,
          note: "Modelled as a function plus external Redis.",
        },
        {
          meter: "vc.kv.commands",
          perRequest: 2,
          note: "Read-modify-write against Redis.",
        },
      ],
      gap: {
        severity: "missing",
        note: "No first-party actor model. Modelled as Functions + Upstash Redis.",
      },
    }),
    workflow: vc({
      kind: "workflow",
      name: "Workflow Development Kit",
      tagline: "Durable functions with `use workflow` on Vercel.",
      docs: "https://vercel.com/docs/workflow",
      whenToUse:
        "Multi-step jobs with retries and sleeps, colocated with your Next.js app.",
      limits:
        "Each step runs as a function invocation; state is stored by the platform.",
      meters: [
        {
          meter: "vc.functions.invocations",
          perRequest: (a) => a.steps ?? 5,
          note: "One invocation per step.",
        },
        {
          meter: "vc.functions.active_cpu_hrs",
          perRequest: (a) => ((a.steps ?? 5) * (a.cpuMs ?? 10)) / 3_600_000,
        },
      ],
    }),
    vector: vc({
      kind: "vector",
      name: "Vector DB (partner)",
      tagline:
        "Upstash Vector, Pinecone or pgvector on Neon via the Marketplace.",
      docs: "https://vercel.com/marketplace",
      whenToUse: "RAG retrieval. pgvector on Neon keeps it in one database.",
      limits: "Partner-billed.",
      meters: [],
      gap: { severity: "partner", note: "No first-party vector store." },
    }),
    llm: vc({
      kind: "llm",
      name: "Model provider via AI Gateway",
      tagline:
        "Vercel does not host models; AI Gateway routes to providers at list price.",
      docs: "https://vercel.com/docs/ai-gateway",
      whenToUse:
        "Any model. Provider token pricing applies; the gateway adds no markup.",
      limits:
        "Token cost is the provider's, not Vercel's, so it is outside this bill.",
      meters: [],
      gap: {
        severity: "partner",
        note: "Provider-billed tokens; not on the Vercel invoice.",
      },
    }),
    "ai-gateway": vc({
      kind: "ai-gateway",
      name: "Vercel AI Gateway",
      tagline:
        "Unified endpoint, failover and spend tracking across providers.",
      docs: "https://vercel.com/docs/ai-gateway",
      whenToUse:
        "Any app using the AI SDK. Switch models without code changes.",
      limits: "Pass-through pricing; provider tokens are billed at list price.",
      meters: [],
    }),
    search: vc({
      kind: "search",
      name: "Search (partner)",
      tagline: "Algolia, Typesense or Postgres full-text via Marketplace.",
      docs: "https://vercel.com/marketplace",
      whenToUse: "Small: Postgres tsvector on Neon. Large: a partner index.",
      limits: "",
      meters: [],
      gap: { severity: "partner", note: "No first-party search." },
    }),
    cron: vc({
      kind: "cron",
      name: "Cron Jobs",
      tagline: "Scheduled function invocations.",
      docs: "https://vercel.com/docs/cron-jobs",
      whenToUse: "Nightly jobs and digests.",
      limits: "Hobby is limited to daily schedules and a small number of jobs.",
      meters: [
        { meter: "vc.functions.invocations", perRequest: 1 },
        {
          meter: "vc.functions.active_cpu_hrs",
          perRequest: (a) => (a.cpuMs ?? 50) / 3_600_000,
        },
      ],
    }),
    realtime: vc({
      kind: "realtime",
      name: "Realtime (partner)",
      tagline:
        "Functions cannot hold WebSockets; use Ably, Pusher, PartyKit or Supabase Realtime.",
      docs: "https://vercel.com/docs/functions/limitations",
      whenToUse:
        "Presence and live updates via a partner; Vercel serves the app shell.",
      limits: "No long-lived connections on Vercel Functions.",
      meters: [],
      gap: {
        severity: "missing",
        note: "WebSockets are not supported on Vercel Functions; partner required.",
      },
    }),
    hyperdrive: vc({
      kind: "hyperdrive",
      name: "Connection pooling (partner)",
      tagline: "Neon and Supabase ship their own poolers; Vercel has no first-party proxy.",
      docs: "https://vercel.com/docs/storage",
      whenToUse: "Use your database vendor's pooled connection string from Vercel Functions.",
      limits: "Partner-billed.",
      meters: [],
      gap: { severity: "partner", note: "No first-party pooler or query cache." },
    }),
    images: vc({
      kind: "images",
      name: "Vercel Image Optimization",
      tagline: "next/image transforms, cached at the edge.",
      docs: "https://vercel.com/docs/image-optimization",
      whenToUse: "Any Next.js image. Source images are transformed on first request per size.",
      limits: "Priced per transformation (cache miss) plus cache reads and writes.",
      meters: [{ meter: "vc.image.transformations", perRequest: (a) => a.uniqueShare ?? 0.02, note: "Share of requests that are a new variant.", estimate: true }],
    }),
    stream: vc({
      kind: "stream",
      name: "Video (partner: Mux)",
      tagline: "No first-party video product.",
      docs: "https://vercel.com/marketplace",
      whenToUse: "Mux or Cloudflare Stream behind a Vercel app.",
      limits: "Partner-billed.",
      meters: [],
      gap: { severity: "missing", note: "No first-party video storage or delivery." },
    }),
    browser: vc({
      kind: "browser",
      name: "Headless browser (partner)",
      tagline: "Browserbase or a self-hosted Puppeteer on a long function.",
      docs: "https://vercel.com/docs/functions",
      whenToUse: "Run Puppeteer inside a Fluid function with a partner-hosted browser.",
      limits: "Function duration and partner minutes both count.",
      meters: [{ meter: "vc.functions.invocations", perRequest: 1 }],
      gap: { severity: "partner", note: "No first-party browser rendering." },
    }),
    turnstile: vc({
      kind: "turnstile",
      name: "BotID",
      tagline: "Invisible bot detection on forms and routes.",
      docs: "https://vercel.com/docs/botid",
      whenToUse: "Sign-up and checkout routes. Basic is free; Deep Analysis is metered.",
      limits: "Deep Analysis is Pro-only and priced per check.",
      meters: [{ meter: "vc.bot_protection.requests", perRequest: 1 }],
    }),
    email: vc({
      kind: "email",
      name: "Email (partner: Resend)",
      tagline: "No first-party email; Resend and others via the Marketplace.",
      docs: "https://vercel.com/marketplace",
      whenToUse: "Transactional email from Route Handlers.",
      limits: "Partner-billed.",
      meters: [],
      gap: { severity: "partner", note: "No first-party email sending or routing." },
    }),
    "load-balancer": vc({
      kind: "load-balancer",
      name: "Edge Network routing",
      tagline: "Vercel routes to the nearest region for you; there is no configurable load balancer.",
      docs: "https://vercel.com/docs/edge-network/regions",
      whenToUse: "Multi-region functions are a setting, not a product.",
      limits: "No health-checked steering across your own origins.",
      meters: [],
      gap: { severity: "missing", note: "No load balancer for external origins." },
    }),
    zaraz: vc({
      kind: "zaraz",
      name: "Tag management (partner)",
      tagline: "Google Tag Manager or a partner; nothing first-party.",
      docs: "https://vercel.com/docs",
      whenToUse: "Ship tags from the browser as usual.",
      limits: "",
      meters: [],
      gap: { severity: "missing", note: "No server-side tag manager." },
    }),
    analytics: vc({
      kind: "analytics",
      name: "Vercel Web Analytics",
      tagline: "Page views and custom events, priced per event on Pro.",
      docs: "https://vercel.com/docs/analytics",
      whenToUse: "Product analytics without a third party. Not a general time-series store.",
      limits: "Event quotas per plan; not modelled as a meter here.",
      meters: [],
      gap: { severity: "partner", note: "Event pricing is not in the data file; shown as included." },
    }),
    access: vc({
      kind: "access",
      name: "Deployment Protection",
      tagline: "Vercel Authentication or password in front of deployments; app auth via Clerk or Auth.js.",
      docs: "https://vercel.com/docs/deployment-protection",
      whenToUse: "Protect previews and staging. For app users, use an auth partner.",
      limits: "Per-plan; not per user.",
      meters: [],
      gap: { severity: "partner", note: "No Zero Trust product; per-user SSO is a partner." },
    }),
    container: vc({
      kind: "container",
      name: "No equivalent",
      tagline: "Vercel runs functions, not containers.",
      docs: "https://vercel.com/docs/functions",
      whenToUse: "Move the binary to a Fluid function if it fits the runtime, or host it elsewhere.",
      limits: "",
      meters: [],
      gap: { severity: "missing", note: "No container runtime." },
    }),
    flags: vc({
      kind: "flags",
      name: "Edge Config",
      tagline: "Ultra-low-latency key-value reads for flags and config.",
      docs: "https://vercel.com/docs/edge-config",
      whenToUse: "Feature flags, redirects tables, A/B allocation read in middleware. Reads are near-instant; writes are rare.",
      limits: "Read and write quotas per plan; small values only.",
      meters: [{ meter: "vc.edge_config.reads", perRequest: (a) => a.readsPerRequest ?? 1 }],
    }),
    sandbox: vc({
      kind: "sandbox",
      name: "Vercel Sandbox",
      tagline: "Ephemeral Firecracker microVMs for untrusted code.",
      docs: "https://vercel.com/docs/vercel-sandbox",
      whenToUse: "Run agent-generated code, tests, builds. Billed by active CPU, provisioned memory and creations.",
      limits: "Per-sandbox duration limits by plan.",
      meters: [
        { meter: "vc.sandbox.active_cpu_hrs", perRequest: (a) => (a.cpuSeconds ?? 2) / 3600 },
        { meter: "vc.sandbox.creations", perRequest: 1 },
      ],
    }),
    middleware: vc({
      kind: "middleware",
      name: "Routing Middleware",
      tagline: "Code that runs before the cache on every matching request.",
      docs: "https://vercel.com/docs/routing-middleware",
      whenToUse: "Rewrites, redirects, auth gates, experiments. Keep it thin; it runs on everything it matches.",
      limits: "Invocations are metered per plan.",
      meters: [{ meter: "vc.middleware.invocations", perRequest: 1 }],
    }),
    external: vc({
      kind: "external",
      name: "External API",
      tagline: "Third-party service.",
      docs: "",
      whenToUse: "Payments, email, auth providers.",
      limits: "",
      meters: [],
    }),
  },
};

export function productFor(
  provider: Provider,
  kind: string,
): ProductSpec | undefined {
  return isProductKind(kind) ? PRODUCTS[provider][kind] : undefined;
}

/** Categories in display order, for the palette. */
export const CATEGORY_ORDER: readonly Category[] = [
  "traffic",
  "edge",
  "security",
  "compute",
  "data",
  "messaging",
  "ai",
  "other",
];

export const CATEGORY_LABEL: Record<Category, string> = {
  traffic: "Traffic",
  edge: "Edge",
  security: "Security",
  compute: "Compute",
  data: "Data",
  messaging: "Messaging",
  ai: "AI",
  other: "Other",
};

/** Nodes whose kind has no first-party product on `provider`, with the catalog note. */
export function gapsIn(
  nodes: readonly { id: string; kind: string }[],
  provider: Provider,
): { id: string; kind: ProductKind; product: string; severity: "none" | "partner" | "missing"; note: string }[] {
  const out: { id: string; kind: ProductKind; product: string; severity: "none" | "partner" | "missing"; note: string }[] = [];
  for (const n of nodes) {
    if (!isProductKind(n.kind)) continue;
    const p = PRODUCTS[provider][n.kind];
    if (p.gap) out.push({ id: n.id, kind: n.kind, product: p.name, ...p.gap });
  }
  return out;
}
