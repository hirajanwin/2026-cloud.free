/**
 * Product analysis, server side.
 *
 * Given a URL or a description, produce a canivibecodeit-style breakdown:
 * what the product is, which features are the core loop, which are polish,
 * and which platform primitives the core loop needs. Workers AI does the
 * reading when the binding is available; a keyword heuristic covers local
 * development and any model failure so the studio never dead-ends.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  url: z.string().url().optional(),
  description: z.string().max(4000).optional(),
});

export const NEED_KEYS = [
  "auth",
  "sql",
  "kv",
  "blob",
  "queue",
  "realtime",
  "llm",
  "vector",
  "search",
  "cron",
  "payments",
  "email",
  "ssr",
] as const;
export type NeedKey = (typeof NEED_KEYS)[number];

export const AnalysisSchema = z.object({
  name: z.string(),
  url: z.string().optional(),
  summary: z.string(),
  core: z.array(z.string()).min(1).max(8),
  polish: z.array(z.string()).max(8),
  needs: z.record(z.enum(NEED_KEYS), z.boolean()),
  call: z.enum(["yes", "kinda", "not-really"]),
  whyPeoplePay: z.string(),
  source: z.enum(["ai", "heuristic"]),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 400_000;
const MAX_TEXT = 12_000;

async function fetchPageText(
  url: string,
): Promise<{ title: string; text: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent":
          "Mozilla/5.0 (compatible; BlueprintAnalyzer/1.0; +https://github.com/)",
      },
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html") && !type.includes("text")) return null;
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      received += value.byteLength;
      if (received >= MAX_BYTES) {
        await reader.cancel();
        break;
      }
    }
    const html = new TextDecoder().decode(concat(chunks));
    return {
      title: extractTitle(html),
      text: htmlToText(html).slice(0, MAX_TEXT),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((s, c) => s + c.byteLength, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

function extractTitle(html: string): string {
  const og = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
  )?.[1];
  const t = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  return decode((og ?? t ?? "").trim());
}

function htmlToText(html: string): string {
  const meta =
    html.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    )?.[1] ?? "";
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<(h[1-3])[^>]*>/gi, "\n## ")
    .replace(/<(p|li|br|div|section|article)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decode(`${meta}\n${body}`)
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/* ------------------------------------------------------------------ *
 * Heuristic fallback. Deliberately crude and deliberately labelled.
 * ------------------------------------------------------------------ */

const NEED_HINTS: Record<NeedKey, RegExp> = {
  auth: /\b(sign ?in|log ?in|account|sso|oauth|workspace|team)s?\b/i,
  sql: /\b(dashboard|crm|invoice|project|task|ticket|customer|record|table|database|notes?)\b/i,
  kv: /\b(session|feature flag|cache|preference)s?\b/i,
  blob: /\b(upload|file|image|photo|video|audio|recording|attachment|pdf)s?\b/i,
  queue:
    /\b(transcri|process|render|export|convert|background|batch|pipeline|webhook)/i,
  realtime:
    /\b(real[- ]?time|live|collaborat|presence|chat|multiplayer|cursor)/i,
  llm: /\b(ai|gpt|llm|assistant|summar|transcri|generate|copilot|chatbot)/i,
  vector: /\b(semantic|embedding|rag|knowledge base|retrieval|similar)/i,
  search: /\b(search|find|filter|discover)\b/i,
  cron: /\b(daily|weekly|schedule|digest|remind|recurring|sync)/i,
  payments: /\b(pricing|subscription|checkout|billing|\$\d|per month|\/mo)\b/i,
  email: /\b(email|newsletter|notify|notification|invite)s?\b/i,
  ssr: /\b(seo|blog|landing|marketing|public page|share link)/i,
};

function heuristicAnalysis(
  name: string,
  url: string | undefined,
  text: string,
): Analysis {
  const needs = Object.fromEntries(
    NEED_KEYS.map((k) => [k, NEED_HINTS[k].test(text)]),
  ) as Record<NeedKey, boolean>;
  const active = NEED_KEYS.filter((k) => needs[k]);
  const core = active.slice(0, 5).map((k) => CORE_TEXT[k]);
  if (core.length === 0)
    core.push("A web app with a signed-in area and a small API");
  const polish = [
    "Native mobile apps",
    "Team roles and permissions",
    "Integrations marketplace",
    "Enterprise SSO and audit logs",
  ].slice(0, 3);
  return {
    name: name || "Untitled product",
    url,
    summary:
      text.slice(0, 280).replace(/\s+/g, " ").trim() ||
      "No description could be read; showing a keyword-based guess.",
    core,
    polish,
    needs,
    call:
      active.length <= 5 ? "yes" : active.length <= 8 ? "kinda" : "not-really",
    whyPeoplePay:
      "Polish, reliability and the integrations around the core loop. The core loop itself is a weekend.",
    source: "heuristic",
  };
}

const CORE_TEXT: Record<NeedKey, string> = {
  auth: "Accounts and sessions",
  sql: "Structured records in a database",
  kv: "Fast per-user state at the edge",
  blob: "File and media uploads",
  queue: "Background processing of slow work",
  realtime: "Live updates between users",
  llm: "A model in the loop generating or summarising",
  vector: "Retrieval over your own documents",
  search: "Search across records",
  cron: "Scheduled jobs and digests",
  payments: "Subscriptions and checkout via a payments provider",
  email: "Transactional email",
  ssr: "Public, indexable pages",
};

/* ------------------------------------------------------------------ *
 * Workers AI. Structured output via JSON mode; validated with the same zod
 * schema so a bad completion falls back instead of leaking garbage.
 * ------------------------------------------------------------------ */

async function aiAnalysis(
  name: string,
  url: string | undefined,
  text: string,
): Promise<Analysis | null> {
  let ai: Ai | undefined;
  try {
    const mod = await import("cloudflare:workers");
    ai = (mod.env as unknown as { AI?: Ai }).AI;
  } catch {
    return null;
  }
  if (!ai) return null;

  const schema = {
    type: "object",
    properties: {
      name: { type: "string" },
      summary: { type: "string" },
      core: { type: "array", items: { type: "string" } },
      polish: { type: "array", items: { type: "string" } },
      needs: {
        type: "object",
        properties: Object.fromEntries(
          NEED_KEYS.map((k) => [k, { type: "boolean" }]),
        ),
        required: [...NEED_KEYS],
      },
      call: { type: "string", enum: ["yes", "kinda", "not-really"] },
      whyPeoplePay: { type: "string" },
    },
    required: [
      "name",
      "summary",
      "core",
      "polish",
      "needs",
      "call",
      "whyPeoplePay",
    ],
  };

  const system = `You analyse software products for developers who want to rebuild the core loop themselves on Cloudflare or Vercel.
Return JSON only. "core" is 3-6 features that make up the product's essential loop, each a short imperative phrase.
"polish" is 2-5 features that are nice but not the loop. "needs" flags which platform primitives the CORE loop requires:
auth (accounts), sql (relational records), kv (sessions/flags), blob (files/media), queue (background jobs), realtime (live multi-user),
llm (a model generating/summarising), vector (retrieval over documents), search (full-text), cron (schedules), payments, email, ssr (public indexable pages).
"call" is yes if the core loop is a weekend build, kinda if it is a week or needs one hard integration, not-really if it depends on proprietary data, hardware or network effects.
"whyPeoplePay" is one honest sentence.`;

  try {
    const res = (await ai.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `Product: ${name || "(unknown)"}\nURL: ${url ?? "(none)"}\n\n${text}`,
        },
      ],
      response_format: { type: "json_schema", json_schema: schema },
      max_tokens: 900,
    })) as { response?: unknown };
    const raw =
      typeof res.response === "string"
        ? JSON.parse(res.response)
        : res.response;
    const parsed = AnalysisSchema.omit({ source: true, url: true }).safeParse(
      raw,
    );
    if (!parsed.success) return null;
    return { ...parsed.data, url, source: "ai" };
  } catch {
    return null;
  }
}

export const analyzeProduct = createServerFn({ method: "POST" })
  .validator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<Analysis> => {
    let name = "";
    let text = data.description ?? "";
    if (data.url) {
      const page = await fetchPageText(data.url);
      if (page) {
        name = page.title;
        text = `${text}\n${page.text}`.trim();
      } else if (!data.description) {
        return {
          name: new URL(data.url).hostname,
          url: data.url,
          summary:
            "The site could not be fetched (blocked, timed out, or not HTML). Paste a description instead.",
          core: ["A web app with a signed-in area and a small API"],
          polish: [],
          needs: Object.fromEntries(NEED_KEYS.map((k) => [k, false])) as Record<
            NeedKey,
            boolean
          >,
          call: "kinda",
          whyPeoplePay: "Unknown until the product can be read.",
          source: "heuristic",
        };
      }
    }
    if (!name && data.description)
      name = data.description.split(/[.\n]/)[0].slice(0, 60);
    return (
      (await aiAnalysis(name, data.url, text)) ??
      heuristicAnalysis(name, data.url, text)
    );
  });
