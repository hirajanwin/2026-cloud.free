/**
 * The studio's state: a tiny external store (no React inside) holding the
 * DSL document, the derived diagram, the simulation configuration and the
 * engine. React subscribes through useSyncExternalStore; the engine advances
 * on requestAnimationFrame and publishes a snapshot at 10 Hz.
 */
import { useSyncExternalStore } from "react";
import { parse, print, type Diagram, type ParseError, type Provider } from "@/engine/dsl";
import { Engine, computeRates, type Rates, type SimInput } from "@/engine/sim";
import { TEMPLATES, templateById } from "@/engine/templates";
import {
  DEFAULT_MIX,
  type Plan,
  type ProtectionMode,
  type Protections,
  type RequestClass,
  type Snapshot,
  type TrafficMix,
} from "@/engine/types";

export interface ProductAnalysis {
  name: string;
  url?: string;
  summary: string;
  core: string[];
  polish: string[];
  needs: Record<string, boolean>;
  call: "yes" | "kinda" | "not-really";
  whyPeoplePay: string;
  source: "ai" | "heuristic";
}

export type PanelId = "inspect" | "traffic" | "bill" | "chat";
export type ChatTab = "chat" | "code" | "activity" | "alternatives";
/** How long the simulation runs for. The timeline spans exactly this. */
export type Period = "day" | "month" | "year";
export const PERIOD_DAYS: Record<Period, number> = { day: 1, month: 30, year: 365 };
export const periodSeconds = (p: Period) => PERIOD_DAYS[p] * 86_400;
/** Real seconds a full period takes to play. */
const PLAY_SECONDS = 90;
/** How the canvas arranges nodes. "flow" follows the DSL direction; "snake" wraps the flow into rows. */
export type ViewLayout = "flow" | "snake";
export type EdgeStyleMode = "curved" | "step" | "straight";

export interface StudioState {
  source: string;
  diagram: Diagram;
  parseErrors: ParseError[];
  provider: Provider;
  plan: Plan;
  mix: TrafficMix;
  protections: Protections;
  /** Simulated seconds per real second (derived from the period). */
  speed: number;
  period: Period;
  running: boolean;
  snapshot: Snapshot;
  rates: Rates;
  selectedId: string | null;
  /** Bumped when a selection should also be framed on the canvas. */
  focusNonce: number;
  templateId: string | null;
  /** Saved blueprint this document belongs to, if any. */
  blueprintId: string | null;
  panel: PanelId;
  chatTab: ChatTab;
  viewLayout: ViewLayout;
  edgeStyle: EdgeStyleMode;
  analysis: ProductAnalysis | null;
  /** WebMCP status for the badge. */
  webmcp: { supported: boolean; registered: number; enabled: boolean };
  /** Monotonic revision, bumped on any document change. */
  revision: number;
}

type Listener = () => void;

const DEFAULT_TEMPLATE = TEMPLATES[1]; // SaaS app: the shape most people ask about.

export const EMPTY_DSL = `direction right
title "New blueprint"

client [kind: client, label: "Visitors"]
`;

function simInput(
  s: Pick<StudioState, "diagram" | "provider" | "mix" | "protections" | "plan">,
): SimInput {
  return { diagram: s.diagram, provider: s.provider, mix: s.mix, protections: s.protections, plan: s.plan };
}

function createInitial(): StudioState {
  const { diagram, errors } = parse(DEFAULT_TEMPLATE.dsl);
  const base = {
    diagram,
    provider: "cloudflare" as Provider,
    mix: DEFAULT_MIX,
    protections: {},
    plan: "free" as Plan,
  };
  const engine = new Engine(simInput(base));
  return {
    source: DEFAULT_TEMPLATE.dsl,
    parseErrors: errors,
    ...base,
    speed: periodSeconds("month") / PLAY_SECONDS,
    period: "month",
    running: true,
    snapshot: engine.snapshot(),
    rates: engine.currentRates,
    selectedId: null,
    focusNonce: 0,
    templateId: DEFAULT_TEMPLATE.id,
    blueprintId: null,
    panel: "inspect",
    chatTab: "chat",
    viewLayout: "snake",
    edgeStyle: "curved",
    analysis: null,
    webmcp: { supported: false, registered: 0, enabled: true },
    revision: 0,
  };
}

let state: StudioState = createInitial();
const engine = new Engine(simInput(state));
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

function set(patch: Partial<StudioState>) {
  state = { ...state, ...patch };
  emit();
}

function reconfigure(
  patch: Partial<Pick<StudioState, "diagram" | "provider" | "mix" | "protections" | "plan">>,
  opts: { keepClock?: boolean } = {},
) {
  const next = { ...state, ...patch };
  engine.configure(simInput(next));
  if (!opts.keepClock) engine.reset();
  set({ ...patch, rates: engine.currentRates, snapshot: engine.snapshot(), revision: state.revision + 1 });
}

export interface StudioDocument {
  source: string;
  provider: Provider;
  plan: Plan;
  mix: TrafficMix;
  protections: Protections;
}

export const studio = {
  get: () => state,
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  /** Replace the document. Returns parse errors; the document is applied even with warnings. */
  setSource(source: string): ParseError[] {
    const { diagram, errors } = parse(source);
    const fatal = errors.filter((e) => e.line === 0 || /Unclosed|Unmatched|Duplicate/.test(e.message));
    if (fatal.length > 0) {
      set({ parseErrors: errors });
      return errors;
    }
    const selectedId =
      state.selectedId &&
      (diagram.nodes.some((n) => n.id === state.selectedId) || diagram.groups.some((g) => g.id === state.selectedId))
        ? state.selectedId
        : null;
    const provider = diagram.provider ?? state.provider;
    state = { ...state, source, parseErrors: errors, selectedId, templateId: null };
    reconfigure({ diagram, provider }, { keepClock: true });
    return errors;
  },

  /** Replace the diagram object; the source is re-printed from it. */
  setDiagram(diagram: Diagram) {
    state = { ...state, source: print(diagram), parseErrors: [], templateId: null };
    reconfigure({ diagram, provider: diagram.provider ?? state.provider }, { keepClock: true });
  },

  setProvider(provider: Provider) {
    const diagram = { ...state.diagram, provider };
    state = { ...state, source: print(diagram) };
    reconfigure({ diagram, provider }, { keepClock: true });
  },

  setPlan(plan: Plan) {
    reconfigure({ plan }, { keepClock: true });
  },

  setMix(mix: { perDay?: number; shares?: Partial<Record<RequestClass, number>> }) {
    const next: TrafficMix = {
      perDay: mix.perDay ?? state.mix.perDay,
      shares: { ...state.mix.shares, ...(mix.shares ?? {}) },
    };
    reconfigure({ mix: next }, { keepClock: true });
  },

  setProtection(nodeId: string, mode: ProtectionMode) {
    reconfigure({ protections: { ...state.protections, [nodeId]: mode } }, { keepClock: true });
  },

  loadTemplate(id: string): boolean {
    const t = templateById(id);
    if (!t) return false;
    const { diagram, errors } = parse(t.dsl);
    state = { ...state, source: t.dsl, parseErrors: errors, selectedId: null, templateId: t.id, blueprintId: null, protections: {} };
    reconfigure({ diagram, provider: diagram.provider ?? state.provider, protections: {} });
    return true;
  },

  /** Load a whole document (a saved blueprint). */
  loadDocument(doc: StudioDocument, blueprintId: string | null) {
    const { diagram, errors } = parse(doc.source);
    state = { ...state, source: doc.source, parseErrors: errors, selectedId: null, templateId: null, blueprintId };
    reconfigure({ diagram, provider: doc.provider, plan: doc.plan, mix: doc.mix, protections: doc.protections });
  },

  /** Start from an (almost) empty canvas. */
  newDocument(blueprintId: string | null) {
    const { diagram, errors } = parse(EMPTY_DSL);
    state = { ...state, source: EMPTY_DSL, parseErrors: errors, selectedId: null, templateId: null, blueprintId, analysis: null };
    reconfigure({ diagram, protections: {} });
  },

  setBlueprintId(blueprintId: string | null) {
    set({ blueprintId });
  },

  document(): StudioDocument {
    return { source: state.source, provider: state.provider, plan: state.plan, mix: state.mix, protections: state.protections };
  },

  select(id: string | null) {
    set({ selectedId: id });
  },

  /** Select and ask the canvas to frame it. */
  focus(id: string) {
    set({ selectedId: id, focusNonce: state.focusNonce + 1 });
  },

  setPanel(panel: PanelId) {
    set({ panel });
  },

  setChatTab(chatTab: ChatTab) {
    set({ chatTab, panel: "chat" });
  },

  setEdgeStyle(edgeStyle: EdgeStyleMode) {
    set({ edgeStyle });
  },

  /** Re-run auto-layout, discarding manual nudges. */
  relayout() {
    set({ revision: state.revision + 1 });
  },

  setViewLayout(viewLayout: ViewLayout) {
    set({ viewLayout, revision: state.revision + 1 });
  },

  setTitle(title: string) {
    const diagram = { ...state.diagram, title: title.trim() || undefined };
    state = { ...state, source: print(diagram) };
    reconfigure({ diagram }, { keepClock: true });
  },

  setDirection(direction: Diagram["direction"]) {
    const diagram = { ...state.diagram, direction };
    state = { ...state, source: print(diagram) };
    reconfigure({ diagram }, { keepClock: true });
  },

  setSpeed(speed: number) {
    set({ speed: Math.max(1, speed) });
  },

  /** Choose the simulated period. The clock restarts and plays the whole period in ~90 s. */
  setPeriod(period: Period) {
    engine.reset();
    set({ period, speed: periodSeconds(period) / PLAY_SECONDS, snapshot: engine.snapshot(), running: true });
  },

  setRunning(running: boolean) {
    if (running && engine.snapshot().elapsedS >= periodSeconds(state.period)) engine.reset();
    set({ running, snapshot: engine.snapshot() });
  },

  resetClock() {
    engine.reset();
    set({ snapshot: engine.snapshot() });
  },

  /** Scrub the clock. Pauses so the reader can look. */
  seek(simSeconds: number) {
    engine.seek(Math.min(periodSeconds(state.period), simSeconds));
    set({ snapshot: engine.snapshot(), running: false });
  },

  setAnalysis(analysis: ProductAnalysis | null) {
    set({ analysis });
  },

  setWebmcp(webmcp: Partial<StudioState["webmcp"]>) {
    set({ webmcp: { ...state.webmcp, ...webmcp } });
  },

  /** Rates for another provider or plan, without changing the studio. */
  ratesFor(provider: Provider, plan: Plan): Rates {
    return computeRates({ ...simInput(state), provider, plan });
  },
};

/* ------------------------------------------------------------------ *
 * The clock. Client only; started once from the studio shell.
 * ------------------------------------------------------------------ */

let rafId: number | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;
let lastT = 0;
let lastPublish = 0;
const PUBLISH_MS = 100;
export const MONTH_S = 30 * 86_400;

function tick(nowMs: number) {
  const dt = Math.min(1, Math.max(0, (nowMs - lastT) / 1000));
  lastT = nowMs;
  if (state.running) {
    const before = engine.snapshot().elapsedS;
    const end = periodSeconds(state.period);
    if (before >= end) {
      // End of the simulated month: stop, so "play" reads as "run the month".
      set({ running: false });
    } else {
      engine.advance(Math.min(dt * state.speed, end - before));
    }
  }
  if (nowMs - lastPublish >= PUBLISH_MS) {
    lastPublish = nowMs;
    set({ snapshot: engine.snapshot() });
  }
}

export function startClock() {
  if (rafId !== null || typeof window === "undefined") return;
  lastT = performance.now();
  lastPublish = lastT;
  const frame = (t: number) => {
    tick(t);
    rafId = requestAnimationFrame(frame);
  };
  rafId = requestAnimationFrame(frame);
  // requestAnimationFrame pauses in background tabs; a coarse interval keeps
  // the simulated month moving so the clock is where you left it on return.
  intervalId = setInterval(() => {
    if (document.visibilityState === "hidden") tick(performance.now());
  }, 1000);
  // Handy for demos and debugging from the console.
  (window as unknown as { __blueprint?: typeof studio }).__blueprint = studio;
}

export function stopClock() {
  if (rafId !== null) cancelAnimationFrame(rafId);
  if (intervalId !== null) clearInterval(intervalId);
  rafId = null;
  intervalId = null;
}

/* ------------------------------------------------------------------ *
 * React binding
 * ------------------------------------------------------------------ */

const serverSnapshot = createInitial();

export function useStudio<T>(selector: (s: StudioState) => T): T {
  return useSyncExternalStore(
    studio.subscribe,
    () => selector(state),
    () => selector(serverSnapshot),
  );
}
