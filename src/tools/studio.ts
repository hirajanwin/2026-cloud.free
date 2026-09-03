/**
 * Studio tools: everything about the app itself rather than the architecture.
 *
 * Orientation (describe_studio), the layer view against free-tier allowances,
 * the timeline (period, play/pause/seek), the canvas view, focusing nodes,
 * opening panels, alternatives per product, and saved blueprints. Same
 * contract as the architecture tools: compact JSON an agent can quote.
 */
import { z } from "zod";
import { alternativesFor, KINDS, PRODUCTS, isProductKind } from "@/engine/catalog";
import { computeBill, PRICING } from "@/engine/pricing";
import { REQUEST_CLASSES, REQUEST_CLASS_DESCRIPTION, REQUEST_CLASS_LABEL, PROTECTION_MODE_LABEL } from "@/engine/types";
import { blueprints } from "@/state/blueprints";
import { PERIOD_DAYS, periodSeconds, studio, type Period } from "@/state/store";
import { defineTool, type ToolDef } from "./define";
import { listServices, serviceMeter, SERVICES, VENDOR_IDS, type VendorId } from "@/engine/services";
import { SHORTCUTS } from "@/lib/shortcuts";

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const MONTH_LEN = 365 / 12;

const PeriodSchema = z.enum(["day", "month", "year"]);
const LayoutSchema = z.enum(["snake", "vertical", "horizontal"]);
const EdgeStyleSchema = z.enum(["curved", "step", "straight"]);
const PanelSchema = z.enum(["inspect", "bill", "chat"]);
const ChatTabSchema = z.enum(["chat", "activity", "alternatives"]);

export const ABOUT = {
  name: "freenet.free",
  tagline: "Design how to build a product on Cloudflare or Vercel, then watch requests flow and get billed.",
  whatItIs:
    "A studio for cloud architecture. You lay out products (Workers, KV, D1, R2, Vercel Functions, Postgres...) as nodes on a canvas, connect them, and a request-accounting simulator sends a daily mix of humans, search crawlers, AI crawlers, scrapers and botnet traffic through the graph. Every node meters what it does (requests, reads, writes, CPU, storage) and the bill is priced from the providers' official pricing pages, with free-tier allowances and what happens when you breach them.",
  howToThink: [
    "The DSL text is the source of truth; the canvas, layers, timeline and bill are all derived from it.",
    "Traffic classes matter: bots never hit the cache, AI crawlers hit the long tail, and blocking search crawlers removes you from search.",
    "Gates (bot shield, WAF, rate limit) decide who gets through; caches answer requests before compute; stores meter reads and writes.",
    "Free plans have hard quotas: past them, requests drop or the feature stops. Paid plans keep serving and charge for overage.",
    "The timeline plays one simulated period (a day, a month or a year) in about 90 seconds and shows each layer as a percent of its allowance.",
    "Cloudflare and Vercel are compared on the same graph: switching provider re-labels and re-prices nodes without changing the design.",
  ],
  requestClasses: REQUEST_CLASSES.map((c) => ({ id: c, label: REQUEST_CLASS_LABEL[c], description: REQUEST_CLASS_DESCRIPTION[c] })),
  protectionModes: PROTECTION_MODE_LABEL,
  ui: {
    leftSidebar: "Search, New freenet, then Freenets (your saved designs), Templates and Products by category. Theme toggle in its header.",
    topBar: "Cloudflare / Vercel provider tabs on the left, Free / Paid plan in the centre, the WebMCP switch on the right.",
    trafficStrip: "Requests so far, a donut of the class mix, sliders for requests per day and each class share, and served / blocked / dropped counts.",
    canvas: "Nodes with product icons inside coloured groups. Snake, vertical or horizontal layout; curved, step or straight edges; reset re-runs auto layout.",
    timeline: "Play, pause and reset; Day / Month / Year period; Bar view with markers or Tracks view with one row per layer, its percent of allowance and daily caps as a sawtooth.",
    rightSidebar: "Inspect (overview, layers, node details, protection), Bill (per-meter lines with sources) and AI (the in-page architect, tool activity log, alternatives).",
  },
  keyboardShortcuts: SHORTCUTS.map((s) => `${s.keys}: ${s.label}`),
  toolGuide: {
    orient: ["describe_studio", "get_diagram", "get_snapshot", "get_layers"],
    design: ["list_templates", "load_template", "patch_diagram", "set_diagram", "list_products", "explain_product", "list_alternatives", "list_services"],
    simulate: ["set_traffic_mix", "set_protection", "set_simulation_period", "control_timeline"],
    price: ["get_bill", "compare_providers", "explain_charge", "set_provider", "set_plan"],
    fromAnIdea: ["analyze_product", "propose_architecture", "export_config"],
    navigate: ["focus_node", "open_panel", "set_view"],
    keep: ["list_blueprints", "save_blueprint", "open_blueprint", "rename_blueprint", "remix_blueprint", "delete_blueprint"],
  },
  workflows: [
    "How would I build X? -> analyze_product, propose_architecture, get_bill, compare_providers.",
    "Is the free tier enough? -> set_traffic_mix, set_simulation_period month, control_timeline seek 1, get_layers, get_bill.",
    "What is costing money? -> explain_charge, then patch_diagram (raise cache hit, add a gate) and get_bill again.",
    "Bots are eating my quota -> set_protection on the gate node, get_snapshot to see what got blocked, and check search traffic still passes.",
  ],
};

function clockReadout() {
  const s = studio.get();
  const total = periodSeconds(s.period);
  const elapsed = Math.min(total, s.snapshot.elapsedS);
  const days = elapsed / 86_400;
  const label =
    s.period === "day"
      ? `Hour ${Math.floor(days * 24)} of 24`
      : s.period === "year"
        ? `Month ${Math.floor(days / MONTH_LEN) + 1} · day ${Math.floor(days % MONTH_LEN) + 1}`
        : `Day ${Math.floor(days)} of ${PERIOD_DAYS.month}`;
  return {
    period: s.period,
    periodDays: PERIOD_DAYS[s.period],
    running: s.running,
    position: round(total ? elapsed / total : 0, 4),
    elapsedDays: round(days, 3),
    label,
    atEnd: elapsed >= total,
  };
}

function nodeSummary(id: string) {
  const s = studio.get();
  const n = s.diagram.nodes.find((x) => x.id === id);
  if (!n) return null;
  const f = s.rates.nodes[id];
  const sum = (r?: Record<string, number>) => (r ? Object.values(r).reduce((a, b) => a + b, 0) : 0);
  return {
    id: n.id,
    kind: n.kind,
    label: n.label ?? null,
    group: n.group ?? null,
    product: isProductKind(n.kind) ? PRODUCTS[s.provider][n.kind].name : null,
    role: isProductKind(n.kind) ? KINDS[n.kind].role : null,
    attrs: n.attrs,
    perDay: f
      ? { arrivals: Math.round(sum(f.arrivals)), blocked: Math.round(sum(f.blocked)), dropped: Math.round(sum(f.dropped)), answeredHere: Math.round(sum(f.answeredHere)) }
      : null,
  };
}

function stateSummary() {
  const s = studio.get();
  const open = s.blueprintId ? blueprints.get(s.blueprintId) : undefined;
  return {
    title: s.diagram.title ?? null,
    provider: s.provider,
    plan: s.plan,
    template: s.templateId,
    blueprint: open ? { id: open.id, name: open.name } : null,
    nodes: s.diagram.nodes.length,
    groups: s.diagram.groups.length,
    edges: s.diagram.edges.length,
    parseErrors: s.parseErrors.length,
    warnings: s.rates.warnings,
    traffic: { perDay: s.mix.perDay, shares: s.mix.shares },
    protections: s.protections,
    clock: clockReadout(),
    view: { layout: s.viewLayout === "snake" ? "snake" : s.diagram.direction === "down" ? "vertical" : "horizontal", edgeStyle: s.edgeStyle },
    selectedNode: s.selectedId,
    panel: s.panel,
    chatTab: s.chatTab,
    analysis: s.analysis ? { name: s.analysis.name, call: s.analysis.call, source: s.analysis.source } : null,
    webmcp: s.webmcp,
  };
}

export const studioTools: ToolDef[] = [
  defineTool({
    name: "describe_studio",
    description:
      "Start here. What freenet.free is and how it thinks (request classes, gates, caches, free-tier quotas), a map of the UI, which tool to use for what, common workflows, and the current state: provider, plan, traffic, clock position, view, selection, open blueprint.",
    schema: z.object({}),
    annotations: { readOnlyHint: true },
    execute: () => ({ ...ABOUT, state: stateSummary() }),
  }),
  defineTool({
    name: "get_layers",
    description:
      "The layer view: every node with the meters it drives, projected monthly volume against the plan's allowance (percent used, over or not), unit cost and what happens past the quota. This is what the timeline tracks and the Inspect overview show.",
    schema: z.object({}),
    annotations: { readOnlyHint: true },
    execute: () => {
      const s = studio.get();
      const bill = computeBill(s.provider, s.plan, s.rates.daily);
      const lineByMeter = new Map(bill.lines.map((l) => [l.meter, l] as const));
      return {
        provider: s.provider,
        plan: bill.planLabel,
        layers: s.diagram.nodes.map((n) => {
          const f = s.rates.nodes[n.id];
          const meters = Object.entries(f?.meters ?? {})
            .filter(([, v]) => v > 0)
            .map(([m, daily]) => {
              const line = lineByMeter.get(m);
              const spec = PRICING[s.provider].meters[m];
              const svc = serviceMeter(m);
              const monthly = daily * 30;
              const allowance = line?.allowanceMonthly ?? null;
              return {
                meter: m,
                label: line?.label ?? spec?.label ?? m,
                unit: spec?.unit ?? svc?.meter.unit,
                billedBy: svc ? svc.vendorName : undefined,
                monthlyFromThisNode: Math.round(monthly),
                accountMonthly: line ? Math.round(line.monthly) : Math.round(monthly),
                allowanceMonthly: allowance === null ? null : Math.round(allowance),
                percentOfAllowance: allowance ? round(((line?.monthly ?? monthly) / allowance) * 100, 1) : null,
                status: line?.status ?? "unmetered",
                costUsdPerMonth: line ? round(line.costUsd) : 0,
                pastQuota: line?.overage === "drop" ? "requests fail" : line?.overage === "block" ? "feature stops" : "keeps serving",
                source: spec?.source ?? svc?.meter.source,
              };
            })
            .sort((a, b) => (b.percentOfAllowance ?? -1) - (a.percentOfAllowance ?? -1));
          return { ...nodeSummary(n.id), meters };
        }),
      };
    },
  }),
  defineTool({
    name: "set_simulation_period",
    description:
      "Choose what the timeline simulates: a day (hours), a month (30 days) or a year (12 months with monthly quota resets). Restarts the clock and starts playing; the whole period plays in about 90 real seconds.",
    schema: z.object({ period: PeriodSchema }),
    execute: ({ period }) => {
      studio.setPeriod(period as Period);
      return clockReadout();
    },
  }),
  defineTool({
    name: "control_timeline",
    description:
      "Drive the timeline: play, pause, reset to the start, or seek to a position given as a fraction of the period (0 = start, 1 = end; seeking pauses). Returns the clock readout. Use seek 1 to jump to the end-of-period totals.",
    schema: z.object({
      action: z.enum(["play", "pause", "reset", "seek", "status"]),
      at: z.number().min(0).max(1).optional(),
    }),
    execute: ({ action, at }) => {
      const s = studio.get();
      if (action === "play") studio.setRunning(true);
      else if (action === "pause") studio.setRunning(false);
      else if (action === "reset") {
        studio.resetClock();
        studio.setRunning(false);
      } else if (action === "seek") {
        if (at === undefined) return { error: "at_required", hint: "Pass at between 0 and 1." };
        studio.seek(at * periodSeconds(s.period));
      }
      return clockReadout();
    },
  }),
  defineTool({
    name: "set_view",
    description:
      "Arrange the canvas: layout snake (rows that wrap, the default), vertical or horizontal; edge style curved, step or straight; relayout true re-runs auto layout and discards manual nudges.",
    schema: z.object({
      layout: LayoutSchema.optional(),
      edgeStyle: EdgeStyleSchema.optional(),
      relayout: z.boolean().optional(),
    }),
    execute: ({ layout, edgeStyle, relayout }) => {
      if (layout === "snake") {
        if (studio.get().diagram.direction !== "right") studio.setDirection("right");
        studio.setViewLayout("snake");
      } else if (layout) {
        studio.setViewLayout("flow");
        studio.setDirection(layout === "vertical" ? "down" : "right");
      }
      if (edgeStyle) studio.setEdgeStyle(edgeStyle);
      if (relayout) studio.relayout();
      return { view: stateSummary().view };
    },
  }),
  defineTool({
    name: "focus_node",
    description:
      "Select a node, centre the canvas on it and open its details in the Inspect panel. Returns the node's product, role, attributes and per-day flow. Pass an empty id to clear the selection.",
    schema: z.object({ id: z.string() }),
    execute: ({ id }) => {
      if (!id) {
        studio.select(null);
        return { selected: null };
      }
      const node = nodeSummary(id);
      if (!node) return { error: "unknown_node", available: studio.get().diagram.nodes.map((n) => n.id) };
      studio.setPanel("inspect");
      studio.focus(id);
      return { selected: node };
    },
  }),
  defineTool({
    name: "open_panel",
    description:
      "Open a right-hand panel: inspect (overview, layers, node details), bill (per-meter lines) or chat (the AI tab), optionally a chat sub-tab: chat, activity (tool log) or alternatives.",
    schema: z.object({ panel: PanelSchema, chatTab: ChatTabSchema.optional() }),
    execute: ({ panel, chatTab }) => {
      if (panel === "chat" && chatTab) studio.setChatTab(chatTab);
      else studio.setPanel(panel);
      const s = studio.get();
      return { panel: s.panel, chatTab: s.chatTab };
    },
  }),
  defineTool({
    name: "list_alternatives",
    description:
      "Third-party and cross-provider alternatives for a product kind, or for every kind on the canvas: what it is on Cloudflare, what it is on Vercel, gaps, and services people use instead.",
    schema: z.object({ kind: z.string().optional() }),
    annotations: { readOnlyHint: true },
    execute: ({ kind }) => {
      const s = studio.get();
      const kinds = kind ? [kind] : Array.from(new Set(s.diagram.nodes.map((n) => n.kind)));
      return kinds.filter(isProductKind).map((k) => ({
        kind: k,
        cloudflare: { product: PRODUCTS.cloudflare[k].name, gap: PRODUCTS.cloudflare[k].gap ?? null, alternatives: alternativesFor("cloudflare", k) },
        vercel: { product: PRODUCTS.vercel[k].name, gap: PRODUCTS.vercel[k].gap ?? null, alternatives: alternativesFor("vercel", k) },
      }));
    },
  }),
  defineTool({
    name: "list_services",
    description:
      "Third-party services you can put on the canvas next to the platform: OpenAI models and tools, Shopify commerce APIs, Netlify hosting primitives. Each has a service id, vendor pricing meters and default consumption per request. Add one with patch_diagram: add_node with kind external and attrs { service: \"openai.gpt55_chat\" }; override a meter with a numeric attr named after it, e.g. { output_tokens: 900 }.",
    schema: z.object({ vendor: z.enum(["openai", "shopify", "netlify"]).optional() }),
    annotations: { readOnlyHint: true },
    execute: ({ vendor }) => ({
      vendors: (vendor ? [vendor] : VENDOR_IDS).map((v) => ({ id: v, name: SERVICES[v].name, pricesAsOf: SERVICES[v].asOf, freePlanNote: SERVICES[v].freePlanNote })),
      services: listServices(vendor as VendorId | undefined).map((p) => ({
        service: p.service,
        vendor: p.vendorName,
        name: p.name,
        tagline: p.tagline,
        category: p.category,
        role: p.role,
        docs: p.docs,
        meters: p.meters.map((m) => ({ id: m.id, label: m.label, unit: m.unit, pricePerUnitUsd: m.pricePerUnitUsd, freeMonthly: m.freeMonthly, defaultPerRequest: m.defaultPerRequest, note: m.perRequestNote, unverified: m.unverified || undefined })),
      })),
    }),
  }),
  defineTool({
    name: "list_blueprints",
    description: "Saved blueprints in this browser (id, name, provider, plan, node count, where it was remixed from, last updated), and which one is open.",
    schema: z.object({}),
    annotations: { readOnlyHint: true },
    execute: () => ({
      open: studio.get().blueprintId,
      blueprints: blueprints.list().map((b) => ({
        id: b.id,
        name: b.name,
        provider: b.provider,
        plan: b.plan,
        from: b.from ?? null,
        updatedAt: new Date(b.updatedAt).toISOString(),
      })),
    }),
  }),
  defineTool({
    name: "save_blueprint",
    description: "Save what is on the canvas as a new blueprint (optionally named) and open it, so further edits autosave to it.",
    schema: z.object({ name: z.string().max(120).optional() }),
    execute: ({ name }) => {
      const b = blueprints.saveCurrent(name);
      return { saved: { id: b.id, name: b.name } };
    },
  }),
  defineTool({
    name: "open_blueprint",
    description: "Open a saved blueprint by id onto the canvas (replaces the current diagram, provider, plan, traffic and protections).",
    schema: z.object({ id: z.string() }),
    execute: ({ id }) => {
      if (!blueprints.open(id)) return { error: "unknown_blueprint", available: blueprints.list().map((b) => ({ id: b.id, name: b.name })) };
      return { opened: id, state: stateSummary() };
    },
  }),
  defineTool({
    name: "rename_blueprint",
    description: "Rename the open blueprint (or one by id) and set the diagram title to match.",
    schema: z.object({ name: z.string().min(1).max(120), id: z.string().optional() }),
    execute: ({ name, id }) => {
      const target = id ?? studio.get().blueprintId;
      if (!target) return { error: "no_open_blueprint", hint: "Call save_blueprint first or pass an id." };
      if (!blueprints.get(target)) return { error: "unknown_blueprint" };
      blueprints.rename(target, name);
      if (target === studio.get().blueprintId) studio.setTitle(name);
      return { renamed: { id: target, name } };
    },
  }),
  defineTool({
    name: "remix_blueprint",
    description: "Duplicate a saved blueprint (by id) or a template (by templateId) into a new blueprint and open it, keeping the original untouched.",
    schema: z.object({ id: z.string().optional(), templateId: z.string().optional() }),
    execute: ({ id, templateId }) => {
      const b = templateId ? blueprints.remixTemplate(templateId) : id ? blueprints.remix(id) : null;
      if (!b) return { error: "unknown_source", hint: "Pass a blueprint id or a template id." };
      return { remixed: { id: b.id, name: b.name, from: b.from ?? null } };
    },
  }),
  defineTool({
    name: "delete_blueprint",
    description: "Delete a saved blueprint by id. Cannot be undone; the canvas keeps its current contents.",
    schema: z.object({ id: z.string() }),
    needsApproval: true,
    execute: ({ id }) => {
      if (!blueprints.get(id)) return { error: "unknown_blueprint" };
      blueprints.remove(id);
      return { deleted: id, remaining: blueprints.list().length };
    },
  }),
];
