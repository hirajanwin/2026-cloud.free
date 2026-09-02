import { describe, expect, it } from "vitest";
import { parse } from "./dsl";
import { computeRates, Engine, type SimInput } from "./sim";
import { computeBill } from "./pricing";
import { TEMPLATES } from "./templates";
import { DEFAULT_MIX, REQUEST_CLASSES, type Snapshot } from "./types";

function inputFor(dsl: string, over: Partial<SimInput> = {}): SimInput {
  return {
    diagram: parse(dsl).diagram,
    provider: "cloudflare",
    mix: DEFAULT_MIX,
    protections: {},
    plan: "paid",
    ...over,
  };
}

function walkNumbers(value: unknown, path: string, out: string[]) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) out.push(path);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      walkNumbers(v, `${path}.${k}`, out);
  }
}

describe("computeRates", () => {
  it("conserves requests at every node", () => {
    for (const t of TEMPLATES) {
      for (const provider of ["cloudflare", "vercel"] as const) {
        for (const plan of ["free", "paid"] as const) {
          const rates = computeRates(
            inputFor(t.dsl, {
              provider,
              plan,
              protections: { shield: "bots+ai", limiter: "bots" },
            }),
          );
          for (const [id, f] of Object.entries(rates.nodes)) {
            for (const c of REQUEST_CLASSES) {
              const lhs = f.arrivals[c];
              const rhs =
                f.blocked[c] +
                f.dropped[c] +
                f.answeredHere[c] +
                f.forwarded[c];
              expect(
                Math.abs(lhs - rhs),
                `${t.id}/${provider}/${plan} ${id} ${c}`,
              ).toBeLessThan(1e-6);
            }
          }
        }
      }
    }
  });

  it("blocks exactly the classes the protection mode names", () => {
    const dsl = `client [kind: client]\nshield [kind: bot-shield]\napi [kind: compute]\nclient > shield\nshield > api`;
    const off = computeRates(inputFor(dsl, { protections: { shield: "off" } }));
    const bots = computeRates(
      inputFor(dsl, { protections: { shield: "bots" } }),
    );
    const all = computeRates(
      inputFor(dsl, { protections: { shield: "all-bots" } }),
    );
    expect(off.nodes.api.arrivals.scraper).toBeGreaterThan(0);
    expect(bots.nodes.api.arrivals.scraper).toBe(0);
    expect(bots.nodes.api.arrivals.botnet).toBe(0);
    expect(bots.nodes.api.arrivals.googlebot).toBeGreaterThan(0);
    expect(all.nodes.api.arrivals.googlebot).toBe(0);
    expect(all.nodes.api.arrivals.human).toBe(off.nodes.api.arrivals.human);
  });

  it("caches answer a class-dependent share", () => {
    const dsl = `client [kind: client]\ncache [kind: edge-cache, hit: 0.8]\napi [kind: compute]\nclient > cache\ncache > api`;
    const r = computeRates(inputFor(dsl));
    const human = r.nodes.cache.arrivals.human;
    expect(r.nodes.cache.answeredHere.human).toBeCloseTo(human * 0.8, 6);
    expect(r.nodes.api.arrivals.human).toBeCloseTo(human * 0.2, 6);
    // Botnets never hit the cache.
    expect(r.nodes.api.arrivals.botnet).toBeCloseTo(
      r.nodes.cache.arrivals.botnet,
      6,
    );
  });

  it("applies the free plan's daily Workers cap as dropped requests downstream", () => {
    const dsl = `client [kind: client]\napi [kind: compute]\ndb [kind: sql]\nclient > api\napi > db`;
    const mix = { ...DEFAULT_MIX, perDay: 1_000_000 };
    const paid = computeRates(inputFor(dsl, { plan: "paid", mix }));
    const free = computeRates(inputFor(dsl, { plan: "free", mix }));
    expect(Object.keys(paid.caps)).toEqual([]);
    expect(free.caps.api?.meter).toBe("cf.workers.requests");
    const droppedTotal = REQUEST_CLASSES.reduce(
      (s, c) => s + free.nodes.api.dropped[c],
      0,
    );
    expect(droppedTotal).toBeGreaterThan(0);
    // Whatever the Worker could not serve never reached the database.
    const dbArrivals = REQUEST_CLASSES.reduce(
      (s, c) => s + free.nodes.db.arrivals[c],
      0,
    );
    const apiArrivals = REQUEST_CLASSES.reduce(
      (s, c) => s + free.nodes.api.arrivals[c],
      0,
    );
    expect(dbArrivals).toBeCloseTo(apiArrivals - droppedTotal, 3);
    // And the daily Worker requests billed equal the arrivals (inspection is billed before the cap).
    expect(free.daily["cf.workers.requests"]).toBeCloseTo(apiArrivals, 3);
  });

  it("does not send traffic across annotation edges or cycles", () => {
    const dsl = `client [kind: client]\na [kind: compute]\nb [kind: compute]\nclient > a\na -- b\na > b\nb > a`;
    const r = computeRates(inputFor(dsl));
    expect(r.warnings.some((w) => w.includes("Cycle"))).toBe(true);
    expect(Number.isFinite(r.nodes.b.arrivals.human)).toBe(true);
  });
});

describe("Engine", () => {
  it("is deterministic and finite", () => {
    const t = TEMPLATES.find((x) => x.id === "saas-sql")!;
    const a = new Engine(inputFor(t.dsl));
    const b = new Engine(inputFor(t.dsl));
    for (let i = 0; i < 50; i += 1) {
      a.advance(3600);
      b.advance(3600);
    }
    expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()));
    const bad: string[] = [];
    walkNumbers(a.snapshot(), "snapshot", bad);
    expect(bad).toEqual([]);
  });

  it("scales totals linearly with time", () => {
    const t = TEMPLATES[0];
    const e = new Engine(inputFor(t.dsl));
    e.advance(86_400);
    const one: Snapshot = e.snapshot();
    e.advance(86_400);
    const two = e.snapshot();
    const sum = (s: Snapshot) =>
      REQUEST_CLASSES.reduce((k, c) => k + s.offered[c], 0);
    expect(sum(two)).toBeCloseTo(sum(one) * 2, 6);
    expect(sum(one)).toBeCloseTo(DEFAULT_MIX.perDay, 6);
  });
});

describe("computeBill", () => {
  it("prices overage against the plan and never invents a number", () => {
    const t = TEMPLATES.find((x) => x.id === "saas-sql")!;
    const rates = computeRates(
      inputFor(t.dsl, { mix: { ...DEFAULT_MIX, perDay: 5_000_000 } }),
    );
    const cf = computeBill("cloudflare", "paid", rates.daily);
    expect(cf.totalUsd).toBeGreaterThanOrEqual(cf.planFeeUsd);
    for (const l of cf.lines) {
      expect(Number.isFinite(l.costUsd)).toBe(true);
      expect(l.source).toMatch(/^https:\/\//);
    }
    const free = computeBill("cloudflare", "free", rates.daily);
    expect(free.totalUsd).toBe(0);
    expect(free.breaches.length).toBeGreaterThan(0);
  });

  it("applies Vercel's Pro credit as a pool", () => {
    const vc = computeBill("vercel", "paid", {
      "vc.functions.invocations": 100,
    });
    expect(vc.creditUsd).toBe(20);
    expect(vc.totalUsd).toBe(20);
  });
});
