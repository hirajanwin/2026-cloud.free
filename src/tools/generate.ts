/**
 * Generators: from an analysis to a diagram, and from a diagram to
 * deployable configuration. Both are deterministic templates over the
 * catalog so the output is explainable line by line.
 */
import type { Diagram, Provider } from "@/engine/dsl";
import { PRODUCTS, isProductKind, type ProductKind } from "@/engine/catalog";
import type { ProductAnalysis } from "@/state/store";

/* ------------------------------------------------------------------ *
 * Analysis → DSL
 * ------------------------------------------------------------------ */

export function proposeDsl(
  a: Pick<ProductAnalysis, "name" | "needs">,
  provider?: Provider,
): { dsl: string; rationale: string[] } {
  const n = a.needs;
  const lines: string[] = [];
  const edges: string[] = [];
  const why: string[] = [];
  const title = (a.name || "New product").replace(/"/g, "'");

  lines.push("direction right", `title "${title}"`);
  if (provider) lines.push(`provider ${provider}`);
  lines.push("", 'client [kind: client, label: "Visitors"]');

  // Edge layer: always a bot shield; a rate limiter if anything expensive sits per request.
  const expensive = n.llm || n.sql || n.search;
  lines.push('edge "Edge" {', "  shield [kind: bot-shield]");
  if (expensive) lines.push("  limiter [kind: rate-limit, limitRps: 20]");
  lines.push(`  cache [kind: edge-cache, hit: ${n.ssr ? 0.75 : 0.5}]`, "}");
  edges.push("client > shield");
  edges.push(expensive ? "shield > limiter" : "shield > cache");
  if (expensive) edges.push("limiter > cache");
  why.push(
    "Bot protection first: scrapers and botnets never reach anything billable.",
  );
  if (expensive)
    why.push(
      "A rate limiter in front because the core loop touches a database or a model per request.",
    );

  // App shell.
  if (n.ssr) {
    lines.push('app [kind: ssr, label: "App (SSR)", cpuMs: 25]');
    why.push(
      "Public pages need indexing, so the shell renders on the server behind the cache.",
    );
  } else {
    lines.push(
      'app [kind: static, label: "App shell"]',
      'api [kind: compute, label: "API", cpuMs: 6]',
    );
    why.push(
      "No SEO requirement: ship a static shell and keep compute for the API only.",
    );
  }
  edges.push("cache > app");
  const origin = n.ssr ? "app" : "api";
  if (!n.ssr) edges.push('cache > api: "/api/*" [ops: 0.4]');

  if (n.auth || n.kv) {
    lines.push('sessions [kind: kv, label: "Sessions"]');
    edges.push(`${origin} > sessions`);
    why.push(
      "Sessions and flags in a key-value store: cheap reads at the edge.",
    );
  }
  if (n.sql) {
    lines.push('db [kind: sql, label: "Records", rowsRead: 30]');
    edges.push(`${origin} > db: "queries" [ops: 2]`);
    why.push(
      "Structured records in SQL. Rows read per request is the number to watch.",
    );
  }
  if (n.blob) {
    lines.push(
      'files [kind: blob, label: "Uploads", bytesKb: 600, writeShare: 0.1]',
    );
    edges.push(`${origin} > files [ops: 0.3]`);
    why.push(
      "Files in object storage; egress pricing is where the providers diverge.",
    );
  }
  if (n.queue) {
    lines.push(
      'jobs [kind: queue, label: "Background jobs"]',
      'worker [kind: compute, label: "Worker", cpuMs: 80]',
    );
    edges.push(`${origin} > jobs [ops: 0.2]`, "jobs > worker");
    if (n.sql) edges.push('worker > db: "write results" [ops: 0.5]');
    why.push(
      "Slow work goes through a queue so the request returns fast and bursts drain later.",
    );
  }
  if (n.realtime) {
    lines.push(
      'rooms [kind: actor, label: "Rooms"]',
      'sockets [kind: realtime, label: "WebSockets"]',
    );
    edges.push(`shield > sockets: "ws" [ops: 0.3]`, "sockets > rooms");
    why.push(
      "Live state lives in a stateful actor per room. Vercel needs a partner for this.",
    );
  }
  if (n.llm) {
    lines.push(
      "gateway [kind: ai-gateway]",
      'model [kind: llm, label: "Model", neurons: 800]',
    );
    edges.push(
      `${n.queue ? "worker" : origin} > gateway [ops: ${n.queue ? 1 : 0.3}]`,
      "gateway > model",
    );
    why.push(
      "Model calls go through an AI gateway for caching, limits and logs.",
    );
  }
  if (n.vector) {
    lines.push(
      'embed [kind: llm, label: "Embeddings", neurons: 40]',
      'index [kind: vector, label: "Index", indexVectors: 20000]',
    );
    edges.push("gateway > embed", 'embed > index: "top-k"');
    why.push("Retrieval: embed the question, query the index, feed the model.");
  }
  if (n.search) {
    lines.push('search [kind: search, label: "Search"]');
    edges.push(`${origin} > search [ops: 0.2]`);
  }
  if (n.cron) {
    lines.push('nightly [kind: cron, label: "Scheduled jobs", runsPerDay: 24]');
    if (n.sql) edges.push("nightly > db [ops: 50]");
    why.push("Scheduled work is a fixed daily cost, independent of traffic.");
  }
  if (n.payments) {
    lines.push('payments [kind: external, label: "Payments provider"]');
    edges.push(`${origin} > payments [ops: 0.02]`);
  }
  if (n.email) {
    lines.push('email [kind: external, label: "Email provider"]');
    edges.push(`${n.queue ? "worker" : origin} > email [ops: 0.05]`);
  }

  return { dsl: [...lines, "", ...edges].join("\n") + "\n", rationale: why };
}

/* ------------------------------------------------------------------ *
 * Diagram → config
 * ------------------------------------------------------------------ */

export interface ExportedFile {
  path: string;
  content: string;
}

export interface ConfigExport {
  provider: Provider;
  files: ExportedFile[];
  stack: string[];
  notes: string[];
}

function kindsIn(diagram: Diagram): Set<ProductKind> {
  const s = new Set<ProductKind>();
  for (const n of diagram.nodes) if (isProductKind(n.kind)) s.add(n.kind);
  return s;
}

function slug(s: string | undefined): string {
  return (
    (s ?? "my-app")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "my-app"
  );
}

export function exportConfig(
  diagram: Diagram,
  provider: Provider,
): ConfigExport {
  const kinds = kindsIn(diagram);
  const name = slug(diagram.title);
  const notes: string[] = [];
  const stack = new Set<string>();
  for (const k of kinds) {
    const p = PRODUCTS[provider][k];
    for (const s of p.stack ?? []) stack.add(s);
    if (p.gap) notes.push(`${p.name}: ${p.gap.note}`);
  }

  if (provider === "cloudflare") {
    const cfg: Record<string, unknown> = {
      $schema: "node_modules/wrangler/config-schema.json",
      name,
      main: "src/server.ts",
      compatibility_date: "2026-08-31",
      compatibility_flags: ["nodejs_compat"],
      observability: { enabled: true },
    };
    if (kinds.has("static") || kinds.has("ssr"))
      cfg.assets = { directory: "./dist/client", binding: "ASSETS" };
    if (kinds.has("kv"))
      cfg.kv_namespaces = [
        { binding: "KV", id: "<create with: wrangler kv namespace create KV>" },
      ];
    if (kinds.has("sql"))
      cfg.d1_databases = [
        {
          binding: "DB",
          database_name: `${name}-db`,
          database_id: "<create with: wrangler d1 create>",
        },
      ];
    if (kinds.has("blob"))
      cfg.r2_buckets = [{ binding: "BUCKET", bucket_name: `${name}-files` }];
    if (kinds.has("queue")) {
      cfg.queues = {
        producers: [{ binding: "JOBS", queue: `${name}-jobs` }],
        consumers: [
          { queue: `${name}-jobs`, max_batch_size: 10, max_retries: 3 },
        ],
      };
    }
    if (kinds.has("actor") || kinds.has("realtime")) {
      cfg.durable_objects = {
        bindings: [{ name: "ROOMS", class_name: "Room" }],
      };
      cfg.migrations = [{ tag: "v1", new_sqlite_classes: ["Room"] }];
    }
    if (kinds.has("workflow"))
      cfg.workflows = [
        {
          binding: "PIPELINE",
          name: `${name}-pipeline`,
          class_name: "Pipeline",
        },
      ];
    if (kinds.has("vector"))
      cfg.vectorize = [{ binding: "INDEX", index_name: `${name}-index` }];
    if (kinds.has("llm") || kinds.has("vector") || kinds.has("ai-gateway"))
      cfg.ai = { binding: "AI" };
    if (kinds.has("cron")) cfg.triggers = { crons: ["0 * * * *"] };

    const files: ExportedFile[] = [
      { path: "wrangler.jsonc", content: JSON.stringify(cfg, null, 2) + "\n" },
    ];
    files.push({ path: "src/server.ts", content: cloudflareEntry(kinds) });
    if (kinds.has("ssr")) stack.add("TanStack Start");
    notes.push(
      "Run `npx wrangler types` after editing wrangler.jsonc so `Env` matches the bindings.",
    );
    notes.push(
      "On the Free plan the Worker stops at the daily request cap; the bill panel shows when that happens for your mix.",
    );
    return { provider, files, stack: [...stack], notes };
  }

  // Vercel
  const vercelJson: Record<string, unknown> = {
    $schema: "https://openapi.vercel.sh/vercel.json",
  };
  if (kinds.has("cron"))
    vercelJson.crons = [{ path: "/api/cron", schedule: "0 * * * *" }];
  if (kinds.has("compute") || kinds.has("ssr"))
    vercelJson.functions = { "app/api/**/*.ts": { maxDuration: 60 } };
  const deps: string[] = ["next", "react", "react-dom"];
  if (kinds.has("blob")) deps.push("@vercel/blob");
  if (kinds.has("kv") || kinds.has("actor")) deps.push("@upstash/redis");
  if (kinds.has("sql")) deps.push("@neondatabase/serverless", "drizzle-orm");
  if (kinds.has("queue")) deps.push("@vercel/queue");
  if (kinds.has("workflow")) deps.push("workflow");
  if (kinds.has("llm") || kinds.has("ai-gateway"))
    deps.push("ai", "@ai-sdk/react");
  if (kinds.has("realtime")) deps.push("ably");
  const files: ExportedFile[] = [
    {
      path: "vercel.json",
      content: JSON.stringify(vercelJson, null, 2) + "\n",
    },
    {
      path: "SETUP.md",
      content:
        [
          `# ${diagram.title ?? "App"} on Vercel`,
          "",
          "```bash",
          `npx create-next-app@latest ${name} --ts --app`,
          `cd ${name} && npm i ${deps.join(" ")}`,
          "```",
          "",
          "Marketplace integrations to add from the Vercel dashboard:",
          ...[
            kinds.has("kv") || kinds.has("actor") ? "- Upstash Redis" : "",
            kinds.has("sql") ? "- Neon Postgres" : "",
            kinds.has("vector") ? "- Upstash Vector or pgvector on Neon" : "",
          ].filter(Boolean),
          "",
          "Enable in Project Settings → Firewall: Bot Protection managed ruleset" +
            (kinds.has("rate-limit")
              ? ", a rate-limit rule on the expensive routes"
              : "") +
            ".",
        ].join("\n") + "\n",
    },
  ];
  stack.add("Next.js App Router");
  notes.push(
    "Hobby is for non-commercial use only; anything with payments or ads needs Pro.",
  );
  return { provider, files, stack: [...stack], notes };
}

function cloudflareEntry(kinds: Set<ProductKind>): string {
  const parts: string[] = [
    'import handler from "@tanstack/react-start/server-entry";',
  ];
  if (kinds.has("actor") || kinds.has("realtime"))
    parts.push('export { Room } from "./room";');
  if (kinds.has("workflow"))
    parts.push('export { Pipeline } from "./pipeline";');
  parts.push("", "export default {", "  fetch: handler.fetch,");
  if (kinds.has("queue")) {
    parts.push(
      "  async queue(batch: MessageBatch, env: Env) {",
      "    for (const msg of batch.messages) {",
      "      // process msg.body",
      "      msg.ack();",
      "    }",
      "  },",
    );
  }
  if (kinds.has("cron"))
    parts.push(
      "  async scheduled(event: ScheduledController, env: Env) {",
      "    // nightly work",
      "  },",
    );
  parts.push("} satisfies ExportedHandler<Env>;", "");
  return parts.join("\n");
}
