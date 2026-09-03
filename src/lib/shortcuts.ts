/**
 * Keyboard shortcuts for the studio. One table drives the key handler, the
 * help sheet and describe_studio, so they can never disagree.
 *
 * Single keys only fire when nothing editable has focus. The sidebar toggles
 * ("[" and "]") and search ("/") are owned by the Fluid Functionalism
 * components and listed here for the help sheet.
 */
import { blueprints } from "@/state/blueprints";
import { studio, type Period } from "@/state/store";

export interface Shortcut {
  /** Display form, e.g. "Space", "Shift+P", "⌘S". */
  keys: string;
  label: string;
  group: "Simulation" | "Canvas" | "Panels" | "Design" | "App";
  /** Omitted for shortcuts handled elsewhere (FF components). */
  run?: () => void;
}

/** Ask the canvas to frame everything; Canvas listens for this. */
export const FIT_EVENT = "freenet:fit";
export const HELP_EVENT = "freenet:shortcuts";

const EDGE_ORDER = ["curved", "step", "straight"] as const;

export const SHORTCUTS: Shortcut[] = [
  { keys: "Space", label: "Play or pause the simulation", group: "Simulation", run: () => studio.setRunning(!studio.get().running) },
  { keys: "R", label: "Reset the clock", group: "Simulation", run: () => { studio.resetClock(); studio.setRunning(false); } },
  { keys: "1 / 2 / 3", label: "Simulate a day, a month, a year", group: "Simulation" },
  { keys: "P", label: "Switch provider (Cloudflare ↔ Vercel)", group: "Design", run: () => studio.setProvider(studio.get().provider === "cloudflare" ? "vercel" : "cloudflare") },
  { keys: "Shift+P", label: "Switch plan (free ↔ paid)", group: "Design", run: () => studio.setPlan(studio.get().plan === "free" ? "paid" : "free") },
  { keys: "S / V / H", label: "Snake, vertical or horizontal layout", group: "Canvas" },
  { keys: "E", label: "Cycle edge style", group: "Canvas", run: () => { const i = EDGE_ORDER.indexOf(studio.get().edgeStyle); studio.setEdgeStyle(EDGE_ORDER[(i + 1) % EDGE_ORDER.length]); } },
  { keys: "L", label: "Reset positions (re-run auto layout)", group: "Canvas", run: () => studio.relayout() },
  { keys: "F", label: "Fit the whole design in view", group: "Canvas", run: () => window.dispatchEvent(new CustomEvent(FIT_EVENT)) },
  { keys: "Esc", label: "Clear the selection", group: "Canvas", run: () => studio.select(null) },
  { keys: "I / B / A", label: "Inspect, Bill or AI panel", group: "Panels" },
  { keys: "T", label: "Tools log in the AI panel", group: "Panels", run: () => studio.setChatTab("activity") },
  { keys: "[ / ]", label: "Toggle left or right sidebar", group: "Panels" },
  { keys: "/", label: "Search the sidebar", group: "Panels" },
  { keys: "N", label: "New freenet", group: "App", run: () => { blueprints.create(); studio.setPanel("inspect"); } },
  { keys: "⌘S", label: "Save the canvas as a freenet (or save the open one)", group: "App", run: () => { const s = studio.get(); if (s.blueprintId) blueprints.saveOpen(); else blueprints.saveCurrent(); } },
  { keys: "?", label: "Show this list", group: "App", run: () => window.dispatchEvent(new CustomEvent(HELP_EVENT)) },
];

const PERIODS: Period[] = ["day", "month", "year"];

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.closest("[role=textbox]") !== null;
}

/** Install the global key handler. Returns the cleanup. */
export function installShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    const meta = e.metaKey || e.ctrlKey;
    // ⌘S saves even while typing; everything else yields to editable fields.
    if (meta && e.key.toLowerCase() === "s" && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      SHORTCUTS.find((s) => s.keys === "⌘S")?.run?.();
      return;
    }
    if (meta || e.altKey || isEditable(e.target)) return;
    if (e.key === "Escape") {
      SHORTCUTS.find((s) => s.keys === "Esc")?.run?.();
      return;
    }
    const k = e.key;
    let handled = true;
    if (k === " ") SHORTCUTS.find((s) => s.keys === "Space")?.run?.();
    else if (k === "?") SHORTCUTS.find((s) => s.keys === "?")?.run?.();
    else if (k === "1" || k === "2" || k === "3") studio.setPeriod(PERIODS[Number(k) - 1]);
    else if (e.shiftKey && k.toLowerCase() === "p") SHORTCUTS.find((s) => s.keys === "Shift+P")?.run?.();
    else if (e.shiftKey) handled = false;
    else if (k === "p") SHORTCUTS.find((s) => s.keys === "P")?.run?.();
    else if (k === "r") SHORTCUTS.find((s) => s.keys === "R")?.run?.();
    else if (k === "e") SHORTCUTS.find((s) => s.keys === "E")?.run?.();
    else if (k === "l") SHORTCUTS.find((s) => s.keys === "L")?.run?.();
    else if (k === "f") SHORTCUTS.find((s) => s.keys === "F")?.run?.();
    else if (k === "n") SHORTCUTS.find((s) => s.keys === "N")?.run?.();
    else if (k === "t") SHORTCUTS.find((s) => s.keys === "T")?.run?.();
    else if (k === "i") studio.setPanel("inspect");
    else if (k === "b") studio.setPanel("bill");
    else if (k === "a") studio.setChatTab("chat");
    else if (k === "s") { if (studio.get().diagram.direction !== "right") studio.setDirection("right"); studio.setViewLayout("snake"); }
    else if (k === "v") { studio.setViewLayout("flow"); studio.setDirection("down"); }
    else if (k === "h") { studio.setViewLayout("flow"); studio.setDirection("right"); }
    else handled = false;
    if (handled) e.preventDefault();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
