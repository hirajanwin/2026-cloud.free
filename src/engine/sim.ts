/**
 * Request accounting.
 *
 * Not a queueing simulator. Each request class is walked through the diagram
 * as a RATE (requests per day) and every node it passes either blocks it,
 * answers it, or bills it and forwards it along its outgoing edges. Because
 * the walk is linear in traffic, rates are computed once per configuration
 * and `advance()` only accumulates them into totals, so a 60 fps loop costs
 * nothing.
 *
 * Invariants, tested in sim.test.ts:
 *   node conservation  arrivals = blocked + dropped + answeredHere + forwarded
 *   determinism        same input, byte-identical snapshot
 *   finiteness         no NaN or Infinity anywhere in a snapshot
 *
 * Two passes: the first is unconstrained, the second applies the free plan's
 * hard caps ("drop"/"block" overage) as a served fraction at the capped
 * node, so anything downstream of a cut-off Worker is cut off too.
 */
import { resolveService, serviceMeterId } from "./services";
import type { Diagram, DiagramEdge, DiagramNode, Provider } from "./dsl";
import { CACHE_HIT_BY_CLASS, KINDS, PRODUCTS, isProductKind } from "./catalog";
import type { ProductSpec } from "./catalog";
import { freeServedFraction } from "./pricing";
import {
  REQUEST_CLASSES,
  type EdgeStats,
  type MeterReadings,
  type NodeStats,
  type Plan,
  type ProtectionMode,
  type Protections,
  type RequestClass,
  type Snapshot,
  type TrafficMix,
  zeroByClass,
} from "./types";

export interface SimInput {
  diagram: Diagram;
  provider: Provider;
  mix: TrafficMix;
  protections: Protections;
  plan: Plan;
}

/** Which classes a gate blocks in each mode. */
const BLOCKS: Record<ProtectionMode, ReadonlySet<RequestClass>> = {
  off: new Set(),
  bots: new Set<RequestClass>(["scraper", "botnet"]),
  "bots+ai": new Set<RequestClass>(["scraper", "botnet", "ai-crawler"]),
  "all-bots": new Set<RequestClass>([
    "scraper",
    "botnet",
    "ai-crawler",
    "googlebot",
  ]),
};

/** Default protection when the user has not touched a gate. */
export function defaultProtection(kind: string): ProtectionMode {
  if (kind === "waf") return "bots";
  return "off";
}

const SECONDS_PER_DAY = 86_400;

interface Flow {
  /** Per-day rates by class. */
  arrivals: Record<RequestClass, number>;
  blocked: Record<RequestClass, number>;
  dropped: Record<RequestClass, number>;
  answeredHere: Record<RequestClass, number>;
  forwarded: Record<RequestClass, number>;
  meters: MeterReadings;
}

interface EdgeFlow {
  flow: Record<RequestClass, number>;
}

export interface Rates {
  nodes: Record<string, Flow>;
  edges: Record<string, EdgeFlow>;
  /** Daily meter totals across all nodes. */
  daily: MeterReadings;
  offered: Record<RequestClass, number>;
  /** Which nodes were capped by the free plan, and by how much. */
  caps: Record<string, { fraction: number; meter: string }>;
  /** Diagnostics for the Explain panel. */
  warnings: string[];
}

export function edgeKey(e: DiagramEdge): string {
  return `${e.from}>${e.to}`;
}

/** Edges that carry requests, oriented from → to. */
function flowEdges(diagram: Diagram): DiagramEdge[] {
  const out: DiagramEdge[] = [];
  for (const e of diagram.edges) {
    if (e.style === "arrow" || e.style === "both" || e.style === "dotted-arrow")
      out.push(e);
    else if (e.style === "back") out.push({ ...e, from: e.to, to: e.from });
    // "line" and "dotted" are annotations, not traffic.
  }
  return out;
}

function numericAttrs(node: DiagramNode): Record<string, number> {
  const defaults = isProductKind(node.kind) ? KINDS[node.kind].defaults : {};
  const out: Record<string, number> = { ...defaults };
  for (const [k, v] of Object.entries(node.attrs))
    if (typeof v === "number") out[k] = v;
  return out;
}

function ops(e: DiagramEdge): number {
  const v = e.attrs["ops"];
  return typeof v === "number" && v >= 0 ? v : 1;
}

/**
 * Compute steady-state rates for one configuration. Pure; the Engine wraps
 * it with time. Exported for tests and for the Explain panel, which wants
 * the same numbers the meters show.
 */
export function computeRates(input: SimInput): Rates {
  const { diagram, provider, mix, protections, plan } = input;
  const warnings: string[] = [];

  const nodesById = new Map(diagram.nodes.map((n) => [n.id, n] as const));
  const edges = flowEdges(diagram).filter((e) => {
    const ok = nodesById.has(e.from) && nodesById.has(e.to);
    if (!ok)
      warnings.push(
        `Edge ${e.from} > ${e.to} touches a group or unknown node and carries no traffic.`,
      );
    return ok;
  });
  const outgoing = new Map<string, DiagramEdge[]>();
  const indegree = new Map<string, number>();
  for (const n of diagram.nodes) {
    outgoing.set(n.id, []);
    indegree.set(n.id, 0);
  }
  for (const e of edges) {
    outgoing.get(e.from)?.push(e);
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
  }

  // Topological order (Kahn). Cycles are broken by dropping back-edges to
  // already-visited nodes; a warning says so.
  const order: string[] = [];
  const remaining = new Map(indegree);
  const queue = diagram.nodes
    .filter((n) => (remaining.get(n.id) ?? 0) === 0)
    .map((n) => n.id);
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    for (const e of outgoing.get(id) ?? []) {
      const r = (remaining.get(e.to) ?? 0) - 1;
      remaining.set(e.to, r);
      if (r === 0) queue.push(e.to);
    }
  }
  const cyclic = diagram.nodes.filter((n) => !seen.has(n.id));
  if (cyclic.length > 0) {
    warnings.push(
      `Cycle detected through ${cyclic.map((n) => n.id).join(", ")}; back-edges carry no traffic.`,
    );
    for (const n of cyclic) order.push(n.id);
  }
  const isBackEdge = (e: DiagramEdge) =>
    order.indexOf(e.to) <= order.indexOf(e.from);

  // Sources: explicit clients, else anything with no inbound traffic.
  const sourceIds = diagram.nodes
    .filter((n) => n.kind === "client")
    .map((n) => n.id);
  const sources =
    sourceIds.length > 0
      ? sourceIds
      : diagram.nodes
          .filter((n) => (indegree.get(n.id) ?? 0) === 0)
          .map((n) => n.id);
  if (sourceIds.length === 0)
    warnings.push(
      "No client node; treating nodes without inbound edges as traffic sources.",
    );

  const shareTotal =
    REQUEST_CLASSES.reduce((s, c) => s + Math.max(0, mix.shares[c] ?? 0), 0) ||
    1;
  const offered = zeroByClass();
  for (const c of REQUEST_CLASSES)
    offered[c] =
      (Math.max(0, mix.perDay) * Math.max(0, mix.shares[c] ?? 0)) / shareTotal;
  const perSource = sources.length || 1;

  const walk = (
    caps: Record<string, number>,
  ): {
    nodes: Record<string, Flow>;
    edges: Record<string, EdgeFlow>;
    daily: MeterReadings;
  } => {
    const flows: Record<string, Flow> = {};
    const edgeFlows: Record<string, EdgeFlow> = {};
    const daily: MeterReadings = {};
    for (const n of diagram.nodes) {
      flows[n.id] = {
        arrivals: zeroByClass(),
        blocked: zeroByClass(),
        dropped: zeroByClass(),
        answeredHere: zeroByClass(),
        forwarded: zeroByClass(),
        meters: {},
      };
    }
    for (const e of edges) edgeFlows[edgeKey(e)] = { flow: zeroByClass() };

    for (const id of sources)
      for (const c of REQUEST_CLASSES)
        flows[id].arrivals[c] += offered[c] / perSource;

    for (const id of order) {
      const node = nodesById.get(id)!;
      const flow = flows[id];
      const kindSpec = isProductKind(node.kind) ? KINDS[node.kind] : undefined;
      const product: ProductSpec | undefined = isProductKind(node.kind)
        ? PRODUCTS[provider][node.kind]
        : undefined;
      if (!kindSpec)
        warnings.push(
          `Unknown kind "${node.kind}" on ${node.id}; treated as pass-through.`,
        );
      const attrs = numericAttrs(node);
      const role = kindSpec?.role ?? "compute";
      const capFraction = caps[id] ?? 1;

      for (const c of REQUEST_CLASSES) {
        let a = flow.arrivals[c];
        if (a <= 0) continue;

        // 1. Gate.
        if (role === "gate") {
          const mode = protections[id] ?? defaultProtection(node.kind);
          let blockedFrac = 0;
          if (node.kind === "rate-limit") {
            if (mode !== "off" && (c === "scraper" || c === "botnet")) {
              const rps = a / SECONDS_PER_DAY;
              const limit = attrs.limitRps ?? 50;
              blockedFrac = rps > limit ? 1 - limit / rps : 0;
            }
          } else if (node.kind === "waf") {
            blockedFrac = mode !== "off" && c === "botnet" ? 1 : 0;
          } else {
            blockedFrac = BLOCKS[mode].has(c) ? 1 : 0;
          }
          const blocked = a * blockedFrac;
          flow.blocked[c] += blocked;
          // Inspection is billed on everything that arrived.
          bill(flow, daily, product, attrs, a);
          billService(flow, daily, node, attrs, a);
          a -= blocked;
        } else {
          bill(flow, daily, product, attrs, a);
          billService(flow, daily, node, attrs, a);
        }

        // 2. Free-plan cap at this node.
        if (capFraction < 1) {
          const dropped = a * (1 - capFraction);
          flow.dropped[c] += dropped;
          a -= dropped;
        }

        // 3. Answer here or forward.
        if (role === "cache") {
          const hit = Math.min(
            1,
            Math.max(0, (attrs.hit ?? 1) * CACHE_HIT_BY_CLASS[c]),
          );
          const answered = a * hit;
          flow.answeredHere[c] += answered;
          a -= answered;
        }
        if (role === "store" || role === "sink") {
          flow.answeredHere[c] += a;
          a = 0;
        }
        if (a > 0) {
          const outs = (outgoing.get(id) ?? []).filter((e) => !isBackEdge(e));
          if (outs.length === 0) {
            flow.answeredHere[c] += a;
          } else {
            flow.forwarded[c] += a;
            for (const e of outs) {
              const amount = a * ops(e);
              edgeFlows[edgeKey(e)].flow[c] += amount;
              flows[e.to].arrivals[c] += amount;
            }
          }
        }
      }
    }
    return { nodes: flows, edges: edgeFlows, daily };
  };

  // Pass 1: unconstrained.
  const first = walk({});
  const caps: Record<string, { fraction: number; meter: string }> = {};
  if (plan === "free") {
    for (const n of diagram.nodes) {
      if (!isProductKind(n.kind)) continue;
      let worst = 1;
      let worstMeter = "";
      for (const use of PRODUCTS[provider][n.kind].meters) {
        const f = freeServedFraction(
          provider,
          use.meter,
          first.daily[use.meter] ?? 0,
        );
        if (f < worst) {
          worst = f;
          worstMeter = use.meter;
        }
      }
      if (worst < 1) caps[n.id] = { fraction: worst, meter: worstMeter };
    }
  }
  // Pass 2: with caps applied. Only re-walk if something is capped.
  const final =
    Object.keys(caps).length > 0
      ? walk(
          Object.fromEntries(
            Object.entries(caps).map(([k, v]) => [k, v.fraction]),
          ),
        )
      : first;

  return {
    nodes: final.nodes,
    edges: final.edges,
    daily: final.daily,
    offered,
    caps,
    warnings,
  };
}

/**
 * External nodes that point at a third-party service ("service: openai.gpt55_chat")
 * meter that vendor's units per request. A numeric attr named after a meter
 * id overrides its default consumption (e.g. `output_tokens: 900`).
 */
function billService(
  flow: Flow,
  daily: MeterReadings,
  node: DiagramNode,
  attrs: Record<string, number>,
  amount: number,
) {
  if (node.kind !== "external") return;
  const res = resolveService(node.attrs["service"]);
  if (!res) return;
  for (const m of res.product.meters) {
    const per = attrs[m.id] ?? m.defaultPerRequest;
    const v = per * amount;
    if (!Number.isFinite(v) || v <= 0) continue;
    const id = serviceMeterId(res.vendor, res.product.id, m.id);
    flow.meters[id] = (flow.meters[id] ?? 0) + v;
    daily[id] = (daily[id] ?? 0) + v;
  }
}

function bill(
  flow: Flow,
  daily: MeterReadings,
  product: ProductSpec | undefined,
  attrs: Record<string, number>,
  amount: number,
) {
  if (!product) return;
  for (const use of product.meters) {
    const per =
      typeof use.perRequest === "function"
        ? use.perRequest(attrs)
        : use.perRequest;
    const v = per * amount;
    if (!Number.isFinite(v)) continue;
    flow.meters[use.meter] = (flow.meters[use.meter] ?? 0) + v;
    daily[use.meter] = (daily[use.meter] ?? 0) + v;
  }
}

/* ------------------------------------------------------------------ *
 * Engine: rates × time
 * ------------------------------------------------------------------ */

export class Engine {
  private rates: Rates;
  private elapsedS = 0;

  constructor(input: SimInput) {
    this.rates = computeRates(input);
  }

  /** Replace the configuration, keeping the clock. */
  configure(input: SimInput) {
    this.rates = computeRates(input);
  }

  reset() {
    this.elapsedS = 0;
  }

  /** Jump the clock to an absolute simulated time. */
  seek(simSeconds: number) {
    if (Number.isFinite(simSeconds)) this.elapsedS = Math.max(0, simSeconds);
  }

  get currentRates(): Rates {
    return this.rates;
  }

  /** Advance simulated time. Totals are rates × elapsed; nothing is sampled. */
  advance(simSeconds: number) {
    if (Number.isFinite(simSeconds) && simSeconds > 0)
      this.elapsedS += simSeconds;
  }

  snapshot(): Snapshot {
    const days = this.elapsedS / SECONDS_PER_DAY;
    const scale = (r: Record<RequestClass, number>) => {
      const o = zeroByClass();
      for (const c of REQUEST_CLASSES) o[c] = r[c] * days;
      return o;
    };
    const scaleMeters = (m: MeterReadings, k: number) => {
      const o: MeterReadings = {};
      for (const [id, v] of Object.entries(m)) o[id] = v * k;
      return o;
    };

    const nodes: Record<string, NodeStats> = {};
    for (const [id, f] of Object.entries(this.rates.nodes)) {
      nodes[id] = {
        arrivals: scale(f.arrivals),
        blocked: scale(f.blocked),
        dropped: scale(f.dropped),
        answeredHere: scale(f.answeredHere),
        meters: scaleMeters(f.meters, days),
      };
    }
    const edges: Record<string, EdgeStats> = {};
    for (const [k, e] of Object.entries(this.rates.edges))
      edges[k] = { flow: scale(e.flow) };

    const offered = scale(this.rates.offered);
    let blocked = 0;
    let dropped = 0;
    for (const f of Object.values(nodes)) {
      for (const c of REQUEST_CLASSES) {
        blocked += f.blocked[c];
        dropped += f.dropped[c];
      }
    }
    const offeredTotal = REQUEST_CLASSES.reduce((s, c) => s + offered[c], 0);

    return {
      elapsedS: this.elapsedS,
      offered,
      outcomes: {
        served: Math.max(0, offeredTotal - blocked - dropped),
        blocked,
        dropped,
      },
      nodes,
      edges,
      meters: scaleMeters(this.rates.daily, days),
      daily: { ...this.rates.daily },
      monthly: scaleMeters(this.rates.daily, 30),
    };
  }
}
