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

export type PanelId = "inspect" | "traffic" | "bill" | "chat" | "code" | "activity";

export interface StudioState {
  source: string;
  diagram: Diagram;
  parseErrors: ParseError[];
  provider: Provider;
  plan: Plan;
  mix: TrafficMix;
  protections: Protections;
  /** Simulated seconds per real second. */
  speed: number;
  running: boolean;
  snapshot: Snapshot;
  rates: Rates;
  selectedId: string | null;
  templateId: string | null;
  /** Saved blueprint this document belongs to, if any. */
  blueprintId: string | null;
  panel: PanelId;
  analysis: ProductAnalysis | null;
  /** WebMCP status for the badge. */
  webmcp: { supported: boolean; registered: number };
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
    speed: 3600, // one simulated hour per second
    running: true,
    snapshot: engine.snapshot(),
    rates: engine.currentRates,
    selectedId: null,
    templateId: DEFAULT_TEMPLATE.id,
    blueprintId: null,
    panel: "inspect",
    analysis: null,
    webmcp: { supported: false, registered: 0 },
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

  setPanel(panel: PanelId) {
    set({ panel });
  },

  setSpeed(speed: number) {
    set({ speed: Math.max(1, speed) });
  },

  setRunning(running: boolean) {
    set({ running });
  },

  resetClock() {
    engine.reset();
    set({ snapshot: engine.snapshot() });
  },

  /** Scrub the clock. Pauses so the reader can look. */
  seek(simSeconds: number) {
    engine.seek(simSeconds);
    set({ snapshot: engine.snapshot(), running: false });
  },

  setAnalysis(analysis: ProductAnalysis | null) {
    set({ analysis });
  },

  setWebmcp(webmcp: StudioState["webmcp"]) {
    set({ webmcp });
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
let lastT = 0;
let lastPublish = 0;
const PUBLISH_MS = 100;

export function startClock() {
  if (rafId !== null || typeof window === "undefined") return;
  lastT = performance.now();
  lastPublish = lastT;
  const frame = (t: number) => {
    const dt = Math.min(0.25, Math.max(0, (t - lastT) / 1000));
    lastT = t;
    if (state.running && document.visibilityState === "visible") engine.advance(dt * state.speed);
    if (t - lastPublish >= PUBLISH_MS) {
      lastPublish = t;
      set({ snapshot: engine.snapshot() });
    }
    rafId = requestAnimationFrame(frame);
  };
  rafId = requestAnimationFrame(frame);
}

export function stopClock() {
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = null;
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
