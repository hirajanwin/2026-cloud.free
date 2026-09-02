/**
 * Shared vocabulary for the engine. Pure types and constants, no behaviour.
 */
import type { Provider } from "./dsl";

export type { Provider };

/** Who is sending the request. The simulator walks each class separately. */
export type RequestClass =
  "human" | "googlebot" | "ai-crawler" | "scraper" | "botnet";

export const REQUEST_CLASSES: readonly RequestClass[] = [
  "human",
  "googlebot",
  "ai-crawler",
  "scraper",
  "botnet",
];

export const REQUEST_CLASS_LABEL: Record<RequestClass, string> = {
  human: "Humans",
  googlebot: "Search crawlers",
  "ai-crawler": "AI crawlers",
  scraper: "Scrapers",
  botnet: "Botnet",
};

export const REQUEST_CLASS_DESCRIPTION: Record<RequestClass, string> = {
  human: "Real visitors in browsers. Hit the cache often and follow links.",
  googlebot:
    "Verified search engine crawlers (Googlebot, Bingbot). Blocking them removes you from search.",
  "ai-crawler":
    "AI training and answer crawlers (GPTBot, ClaudeBot, PerplexityBot). Heavy on the long tail.",
  scraper:
    "Unverified automation pretending to be a browser. Ignores robots.txt, hits uncached pages.",
  botnet:
    "Volumetric junk: credential stuffing, random URLs, L7 floods. Never hits the cache.",
};

/** Share of the request mix per class. Shares are normalised by the engine. */
export type TrafficMix = {
  /** Total requests per day across every class. */
  perDay: number;
  shares: Record<RequestClass, number>;
};

export const DEFAULT_MIX: TrafficMix = {
  perDay: 100_000,
  shares: {
    human: 0.7,
    googlebot: 0.08,
    "ai-crawler": 0.07,
    scraper: 0.1,
    botnet: 0.05,
  },
};

/** Which plan the bill is computed against. */
export type Plan = "free" | "paid";

/** Per-gate protection settings. Keys are node ids. */
export type ProtectionMode =
  /** Gate does nothing. */
  | "off"
  /** Block unverified automation (scrapers, botnets). Verified crawlers pass. */
  | "bots"
  /** Also block AI crawlers. Search crawlers still pass. */
  | "bots+ai"
  /** Block everything that is not a human. Search disappears too. */
  | "all-bots";

export const PROTECTION_MODES: readonly ProtectionMode[] = [
  "off",
  "bots",
  "bots+ai",
  "all-bots",
];

export const PROTECTION_MODE_LABEL: Record<ProtectionMode, string> = {
  off: "Off",
  bots: "Block bad bots",
  "bots+ai": "Block bad bots + AI crawlers",
  "all-bots": "Block every bot",
};

export type Protections = Record<string, ProtectionMode>;

/** Where a request ended. Conservation: sum of these equals arrivals. */
export type Outcome = "served" | "blocked" | "dropped";

/** A billable meter reading, keyed by meter id (see pricing.*.json). */
export type MeterReadings = Record<string, number>;

export interface NodeStats {
  /** Arrivals by class, over the simulated window so far. */
  arrivals: Record<RequestClass, number>;
  blocked: Record<RequestClass, number>;
  dropped: Record<RequestClass, number>;
  /** Requests answered here without going downstream (cache hits, static). */
  answeredHere: Record<RequestClass, number>;
  /** Meter increments attributable to this node. */
  meters: MeterReadings;
}

export interface EdgeStats {
  /** Requests that travelled this edge, by class. */
  flow: Record<RequestClass, number>;
}

export interface Snapshot {
  /** Simulated seconds elapsed. */
  elapsedS: number;
  /** Offered requests so far, by class. */
  offered: Record<RequestClass, number>;
  outcomes: Record<Outcome, number>;
  nodes: Record<string, NodeStats>;
  edges: Record<string, EdgeStats>;
  /** Totals over the window, by meter id. */
  meters: MeterReadings;
  /** Projected monthly readings at the current mix (steady state). */
  monthly: MeterReadings;
  /** Projected daily readings at the current mix. */
  daily: MeterReadings;
}

export function zeroByClass(): Record<RequestClass, number> {
  return { human: 0, googlebot: 0, "ai-crawler": 0, scraper: 0, botnet: 0 };
}
