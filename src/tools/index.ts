/**
 * The tools. One list, consumed by both agents:
 *   - registered on document.modelContext for the browser's agent (WebMCP)
 *   - sent as client tools to the in-page assistant (Agents SDK / AI SDK)
 *
 * Every tool reads and writes the studio store. Results are compact JSON an
 * agent can quote; numbers about money always come from computeBill.
 */
import { z } from "zod";
import { applyPatch, parse, toEraser, type PatchOp } from "@/engine/dsl";
import {
  gapsIn,
  CATEGORY_LABEL,
  KINDS,
  PRODUCTS,
  PRODUCT_KINDS,
  isProductKind,
} from "@/engine/catalog";
import { computeBill, PRICING, type Bill } from "@/engine/pricing";
import { defaultProtection } from "@/engine/sim";
import { TEMPLATES } from "@/engine/templates";
import {
  PROTECTION_MODES,
  REQUEST_CLASSES,
  REQUEST_CLASS_LABEL,
  type RequestClass,
} from "@/engine/types";
import { analyzeProduct } from "@/server/analyze";
import { studio, type ProductAnalysis } from "@/state/store";
import { defineTool, type ToolDef } from "./define";
import { exportConfig, proposeDsl } from "./generate";

const ProviderSchema = z.enum(["cloudflare", "vercel"]);
const PlanSchema = z.enum(["free", "paid"]);
const KindSchema = z.enum(PRODUCT_KINDS as [string, ...string[]]);
const ClassSchema = z.enum(
  REQUEST_CLASSES as [RequestClass, ...RequestClass[]],
);
const ModeSchema = z.enum(PROTECTION_MODES as [string, ...string[]]);
const AttrValue = z.union([z.string(), z.number(), z.boolean()]);
const AttrsSchema = z.record(z.string(), AttrValue);
const EdgeStyle = z.enum([
  "arrow",
  "back",
  "both",
  "line",
  "dotted",
  "dotted-arrow",
]);

const PatchOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add_node"),
    id: z.string(),
    kind: KindSchema,
    label: z.string().optional(),
    group: z.string().optional(),
    attrs: AttrsSchema.optional(),
  }),
  z.object({ op: z.literal("remove_node"), id: z.string() }),
  z.object({
    op: z.literal("set_node"),
    id: z.string(),
    kind: KindSchema.optional(),
    label: z.string().optional(),
    group: z.string().nullable().optional(),
    attrs: AttrsSchema.optional(),
  }),
  z.object({
    op: z.literal("add_group"),
    id: z.string(),
    label: z.string().optional(),
    parent: z.string().optional(),
  }),
  z.object({ op: z.literal("remove_group"), id: z.string() }),
  z.object({
    op: z.literal("add_edge"),
    from: z.string(),
    to: z.string(),
    label: z.string().optional(),
    style: EdgeStyle.optional(),
    attrs: AttrsSchema.optional(),
  }),
  z.object({ op: z.literal("remove_edge"), from: z.string(), to: z.string() }),
  z.object({
    op: z.literal("set_direction"),
    direction: z.enum(["right", "down", "left", "up"]),
  }),
  z.object({ op: z.literal("set_title"), title: z.string() }),
  z.object({ op: z.literal("set_provider"), provider: ProviderSchema }),
]);

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const sumClasses = (r: Record<RequestClass, number>) =>
  REQUEST_CLASSES.reduce((s, c) => s + r[c], 0);

function billSummary(b: Bill) {
  return {
    provider: b.provider,
    plan: b.plan,
    planLabel: b.planLabel,
    pricesAsOf: b.asOf,
    totalUsdPerMonth: round(b.totalUsd),
    planFeeUsd: b.planFeeUsd,
    meteredUsageUsd: round(b.usageUsd),
    creditUsd: b.creditUsd,
    freeTierBreaches: b.breaches.map((l) => ({
      meter: l.label,
      monthly: Math.round(l.monthly),
      allowanceMonthly:
        l.allowanceMonthly === null ? null : Math.round(l.allowanceMonthly),
      whatHappens:
        l.overage === "drop"
          ? "requests fail past the quota"
          : l.overage === "block"
            ? "feature blocked past the quota"
            : "no enforcement",
      note: l.note,
      source: l.source,
    })),
    topLines: b.lines.slice(0, 8).map((l) => ({
      meter: l.label,
      unit: l.unit,
      monthly: Math.round(l.monthly),
      allowanceMonthly:
        l.allowanceMonthly === null ? null : Math.round(l.allowanceMonthly),
      costUsd: round(l.costUsd),
      status: l.status,
      unverified: l.unverified || undefined,
      source: l.source,
    })),
    caveats: b.caveats,
  };
}

function diagramSummary() {
  const s = studio.get();
  return {
    dsl: s.source,
    title: s.diagram.title ?? null,
    provider: s.provider,
    plan: s.plan,
    direction: s.diagram.direction,
    parseErrors: s.parseErrors,
    simulationWarnings: s.rates.warnings,
    nodes: s.diagram.nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      label: n.label ?? null,
      group: n.group ?? null,
      product: isProductKind(n.kind) ? PRODUCTS[s.provider][n.kind].name : null,
      attrs: n.attrs,
    })),
    groups: s.diagram.groups.map((g) => ({
      id: g.id,
      label: g.label ?? null,
      parent: g.parent ?? null,
    })),
    edges: s.diagram.edges.map((e) => ({
      from: e.from,
      to: e.to,
      style: e.style,
      label: e.label ?? null,
      attrs: e.attrs,
    })),
  };
}

export const tools: ToolDef[] = [
  defineTool({
    name: "get_diagram",
    description:
      "Read the current architecture as DSL plus a structured summary (nodes, groups, edges, provider, plan, parse errors). Call this before editing.",
    schema: z.object({}),
    annotations: { readOnlyHint: true },
    execute: () => diagramSummary(),
  }),

  defineTool({
    name: "set_diagram",
    description:
      'Replace the whole architecture with new DSL. Grammar: `id [kind: <kind>, label: "...", attr: value]` for nodes, `group "Label" { ... }` for groups, `a > b: "label" [ops: 2]` for edges (`ops` = calls per request), `direction right|down`, `title "..."`, `provider cloudflare|vercel`. Kinds: ' +
      PRODUCT_KINDS.join(", ") +
      ". Prefer patch_diagram for small edits.",
    schema: z.object({ dsl: z.string().min(1).max(20_000) }),
    needsApproval: true,
    execute: ({ dsl }) => {
      const { errors } = parse(dsl);
      const applied = studio.setSource(dsl);
      const fatal = applied.length > 0 && studio.get().source !== dsl;
      return {
        applied: !fatal,
        errors: errors.length ? errors : undefined,
        ...(fatal ? {} : { summary: diagramSummary() }),
      };
    },
  }),

  defineTool({
    name: "patch_diagram",
    description:
      "Apply small edits to the architecture: add/remove/set nodes, groups and edges, or set direction/title/provider. Node attrs that matter to the simulator: hit (cache 0..1), cpuMs, bytesKb, rowsRead, writeShare, limitRps, neurons, ops on edges.",
    schema: z.object({ ops: z.array(PatchOpSchema).min(1).max(50) }),
    execute: ({ ops }) => {
      const { diagram, errors } = applyPatch(
        studio.get().diagram,
        ops as PatchOp[],
      );
      if (errors.length === ops.length) return { applied: false, errors };
      studio.setDiagram(diagram);
      return {
        applied: true,
        errors: errors.length ? errors : undefined,
        summary: diagramSummary(),
      };
    },
  }),

  defineTool({
    name: "list_templates",
    description:
      "List starting-point architectures (id, name, tagline, lesson). Load one with load_template.",
    schema: z.object({}),
    annotations: { readOnlyHint: true },
    execute: () =>
      TEMPLATES.map((t) => ({
        id: t.id,
        name: t.name,
        tagline: t.tagline,
        lesson: t.lesson,
        isVerdict: !!t.verdict,
      })),
  }),

  defineTool({
    name: "load_template",
    description:
      "Load a template architecture by id onto the canvas, replacing the current diagram.",
    schema: z.object({ id: z.string() }),
    execute: ({ id }) => {
      if (!studio.loadTemplate(id))
        return {
          error: "unknown_template",
          available: TEMPLATES.map((t) => t.id),
        };
      return { loaded: id, summary: diagramSummary() };
    },
  }),

  defineTool({
    name: "list_products",
    description:
      "List the generic product kinds and what each maps to on Cloudflare and Vercel, including gaps where a provider has no first-party product.",
    schema: z.object({
      provider: ProviderSchema.optional(),
      category: z.string().optional(),
    }),
    annotations: { readOnlyHint: true },
    execute: ({ provider, category }) =>
      PRODUCT_KINDS.filter(
        (k) => !category || KINDS[k].category === category,
      ).map((k) => {
        const spec = KINDS[k];
        const entry = (p: "cloudflare" | "vercel") => {
          const pr = PRODUCTS[p][k];
          return {
            name: pr.name,
            tagline: pr.tagline,
            gap: pr.gap ?? null,
            meters: pr.meters.map((m) => m.meter),
          };
        };
        return {
          kind: k,
          category: CATEGORY_LABEL[spec.category],
          role: spec.role,
          description: spec.description,
          defaults: spec.defaults,
          ...(provider
            ? { [provider]: entry(provider) }
            : { cloudflare: entry("cloudflare"), vercel: entry("vercel") }),
        };
      }),
  }),

  defineTool({
    name: "explain_product",
    description:
      "Explain one product kind on both providers: what it is, when to use it, limits, recommended stack, billing meters, and the counterpart gap.",
    schema: z.object({ kind: KindSchema }),
    annotations: { readOnlyHint: true },
    execute: ({ kind }) => {
      if (!isProductKind(kind)) return { error: "unknown_kind" };
      const both = (["cloudflare", "vercel"] as const).map((p) => {
        const pr = PRODUCTS[p][kind];
        return {
          provider: p,
          name: pr.name,
          tagline: pr.tagline,
          whenToUse: pr.whenToUse,
          limits: pr.limits,
          stack: pr.stack ?? [],
          docs: pr.docs,
          gap: pr.gap ?? null,
          meters: pr.meters.map((m) => ({
            meter: m.meter,
            label: PRICING[p].meters[m.meter]?.label ?? m.meter,
            note: m.note,
            estimate: m.estimate ?? false,
          })),
        };
      });
      return { kind, generic: KINDS[kind], providers: both };
    },
  }),

  defineTool({
    name: "set_provider",
    description:
      "Switch the whole architecture between Cloudflare and Vercel. Nodes are re-labelled and re-priced; the diagram itself does not change.",
    schema: z.object({ provider: ProviderSchema }),
    execute: ({ provider }) => {
      studio.setProvider(provider);
      return {
        provider,
        bill: billSummary(
          computeBill(provider, studio.get().plan, studio.get().rates.daily),
        ),
      };
    },
  }),

  defineTool({
    name: "set_plan",
    description:
      "Choose which plan to price against: free (Cloudflare Free / Vercel Hobby) or paid (Workers Paid / Vercel Pro).",
    schema: z.object({ plan: PlanSchema }),
    execute: ({ plan }) => {
      studio.setPlan(plan);
      const s = studio.get();
      return {
        plan,
        bill: billSummary(computeBill(s.provider, plan, s.rates.daily)),
      };
    },
  }),

  defineTool({
    name: "set_traffic_mix",
    description:
      "Set requests per day and the share of each request class (human, googlebot, ai-crawler, scraper, botnet). Shares are normalised. Omitted fields keep their value.",
    schema: z.object({
      perDay: z.number().min(0).max(1e10).optional(),
      shares: z.record(ClassSchema, z.number().min(0).max(1)).optional(),
    }),
    execute: ({ perDay, shares }) => {
      studio.setMix({
        perDay,
        shares,
      });
      return { mix: studio.get().mix };
    },
  }),

  defineTool({
    name: "set_protection",
    description:
      "Set a gate node's protection mode. Modes: off, bots (block scrapers + botnets), bots+ai (also block AI crawlers), all-bots (also block search crawlers, which hurts SEO). Works on bot-shield, waf and rate-limit nodes.",
    schema: z.object({ nodeId: z.string(), mode: ModeSchema }),
    execute: ({ nodeId, mode }) => {
      const s = studio.get();
      const node = s.diagram.nodes.find((n) => n.id === nodeId);
      if (!node) return { error: "unknown_node" };
      if (!isProductKind(node.kind) || KINDS[node.kind].role !== "gate")
        return { error: "not_a_gate", kind: node.kind };
      studio.setProtection(nodeId, mode as (typeof PROTECTION_MODES)[number]);
      const r = studio.get().rates.nodes[nodeId];
      return {
        nodeId,
        mode,
        blockedPerDay: Object.fromEntries(
          REQUEST_CLASSES.map((c) => [c, Math.round(r?.blocked[c] ?? 0)]),
        ),
      };
    },
  }),

  defineTool({
    name: "get_snapshot",
    description:
      "Current simulation state: offered traffic by class, what was blocked/dropped, and per-node arrivals. Use it to explain where requests go.",
    schema: z.object({}),
    annotations: { readOnlyHint: true },
    execute: () => {
      const s = studio.get();
      const r = s.rates;
      return {
        perDayOffered: Object.fromEntries(
          REQUEST_CLASSES.map((c) => [c, Math.round(r.offered[c])]),
        ),
        nodes: Object.entries(r.nodes).map(([id, f]) => {
          const node = s.diagram.nodes.find((n) => n.id === id);
          const cap = r.caps[id];
          return {
            id,
            kind: node?.kind,
            arrivalsPerDay: Math.round(sumClasses(f.arrivals)),
            blockedPerDay: Math.round(sumClasses(f.blocked)),
            droppedPerDay: Math.round(sumClasses(f.dropped)),
            answeredHerePerDay: Math.round(sumClasses(f.answeredHere)),
            protection:
              node &&
              isProductKind(node.kind) &&
              KINDS[node.kind].role === "gate"
                ? (s.protections[id] ?? defaultProtection(node.kind))
                : undefined,
            freeTierCap: cap
              ? {
                  servedFraction: round(cap.fraction, 3),
                  meter:
                    PRICING[s.provider].meters[cap.meter]?.label ?? cap.meter,
                }
              : undefined,
          };
        }),
        warnings: r.warnings,
      };
    },
  }),

  defineTool({
    name: "get_bill",
    description:
      "Projected monthly bill for the current architecture and traffic, priced from the official pricing pages (with source URLs). Optionally for a different provider or plan.",
    schema: z.object({
      provider: ProviderSchema.optional(),
      plan: PlanSchema.optional(),
    }),
    annotations: { readOnlyHint: true },
    execute: ({ provider, plan }) => {
      const s = studio.get();
      const p = provider ?? s.provider;
      const pl = plan ?? s.plan;
      const rates =
        p === s.provider && pl === s.plan ? s.rates : studio.ratesFor(p, pl);
      return billSummary(computeBill(p, pl, rates.daily));
    },
  }),

  defineTool({
    name: "compare_providers",
    description:
      "Price the same architecture on Cloudflare and Vercel, free and paid, side by side, with the gaps each provider has for the kinds in use.",
    schema: z.object({}),
    annotations: { readOnlyHint: true },
    execute: () => {
      const s = studio.get();
      const out: Record<string, unknown> = {};
      for (const p of ["cloudflare", "vercel"] as const) {
        const gaps = gapsIn(s.diagram.nodes, p);
        const free = computeBill(p, "free", studio.ratesFor(p, "free").daily);
        const paid = computeBill(p, "paid", studio.ratesFor(p, "paid").daily);
        out[p] = {
          free: {
            planLabel: free.planLabel,
            totalUsd: 0,
            breaches: free.breaches.map((b) => b.label),
          },
          paid: {
            planLabel: paid.planLabel,
            totalUsdPerMonth: round(paid.totalUsd),
            meteredUsageUsd: round(paid.usageUsd),
            topCosts: paid.lines
              .filter((l) => l.costUsd > 0)
              .slice(0, 4)
              .map((l) => ({ meter: l.label, costUsd: round(l.costUsd) })),
          },
          gaps,
          pricesAsOf: PRICING[p].asOf,
        };
      }
      return out;
    },
  }),

  defineTool({
    name: "explain_charge",
    description:
      "Explain what drives a meter: which nodes contribute, how much, and which request classes are behind it. Without a meter, explains the top five by monthly volume.",
    schema: z.object({ meter: z.string().optional() }),
    annotations: { readOnlyHint: true },
    execute: ({ meter }) => {
      const s = studio.get();
      const meters = meter
        ? [meter]
        : Object.entries(s.rates.daily)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([m]) => m);
      return meters.map((m) => {
        const spec = PRICING[s.provider].meters[m];
        const contributors = Object.entries(s.rates.nodes)
          .filter(([, f]) => (f.meters[m] ?? 0) > 0)
          .map(([id, f]) => {
            const node = s.diagram.nodes.find((n) => n.id === id);
            const total = sumClasses(f.arrivals) || 1;
            return {
              node: id,
              label: node?.label ?? id,
              product:
                node && isProductKind(node.kind)
                  ? PRODUCTS[s.provider][node.kind].name
                  : node?.kind,
              dailyAmount: Math.round(f.meters[m] ?? 0),
              byClassShare: Object.fromEntries(
                REQUEST_CLASSES.map((c) => [
                  REQUEST_CLASS_LABEL[c],
                  round(f.arrivals[c] / total, 3),
                ]),
              ),
            };
          })
          .sort((a, b) => b.dailyAmount - a.dailyAmount);
        return {
          meter: m,
          label: spec?.label ?? m,
          unit: spec?.unit,
          dailyTotal: Math.round(s.rates.daily[m] ?? 0),
          monthlyTotal: Math.round((s.rates.daily[m] ?? 0) * 30),
          source: spec?.source,
          contributors,
        };
      });
    },
  }),

  defineTool({
    name: "analyze_product",
    description:
      "Analyse a product from its URL or a description: what it is, the core loop vs polish features, which platform primitives it needs, and a build verdict. Follow with propose_architecture.",
    schema: z
      .object({
        url: z.string().url().optional(),
        description: z.string().max(4000).optional(),
      })
      .refine((v) => v.url || v.description, {
        message: "Provide a url or a description",
      }),
    annotations: { untrustedContentHint: true },
    execute: async ({ url, description }) => {
      const analysis = (await analyzeProduct({
        data: { url, description },
      })) as ProductAnalysis;
      studio.setAnalysis(analysis);
      return analysis;
    },
  }),

  defineTool({
    name: "propose_architecture",
    description:
      "Generate an architecture from the last analyze_product result (or from explicit needs flags) and put it on the canvas. Needs: auth, sql, kv, blob, queue, realtime, llm, vector, search, cron, payments, email, ssr.",
    schema: z.object({
      name: z.string().optional(),
      needs: z.record(z.string(), z.boolean()).optional(),
      provider: ProviderSchema.optional(),
    }),
    execute: ({ name, needs, provider }) => {
      const a = studio.get().analysis;
      const merged = {
        name: name ?? a?.name ?? "New product",
        needs: needs ?? a?.needs,
      };
      if (!merged.needs)
        return {
          error: "no_analysis",
          hint: "Call analyze_product first or pass needs.",
        };
      const { dsl, rationale } = proposeDsl(
        merged as Pick<ProductAnalysis, "name" | "needs">,
        provider,
      );
      studio.setSource(dsl);
      if (provider) studio.setProvider(provider);
      return { dsl, rationale, summary: diagramSummary() };
    },
  }),

  defineTool({
    name: "export_config",
    description:
      "Generate deployable configuration for the current architecture: wrangler.jsonc and a Worker entry for Cloudflare, or vercel.json and a setup guide for Vercel, plus the recommended stack.",
    schema: z.object({ provider: ProviderSchema.optional() }),
    annotations: { readOnlyHint: true },
    execute: ({ provider }) =>
      exportConfig(studio.get().diagram, provider ?? studio.get().provider),
  }),

  defineTool({
    name: "export_eraser",
    description:
      "Export the diagram in Eraser's cloud-architecture syntax so it can be pasted into eraser.io.",
    schema: z.object({}),
    annotations: { readOnlyHint: true },
    execute: () => ({ eraser: toEraser(studio.get().diagram) }),
  }),
];

export const toolByName = new Map(tools.map((t) => [t.name, t] as const));
