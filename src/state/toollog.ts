/**
 * A ring buffer of tool invocations, so the Activity panel can show what the
 * agents did and which path each call took. Separate from the studio store
 * because it changes on every tool call and nothing in the canvas depends
 * on it.
 */
import { useSyncExternalStore } from "react";

export interface ToolEvent {
  name: string;
  input: unknown;
  via: "webmcp" | "direct";
  /** Who asked: the browser agent (Gemini in Chrome etc.) or the in-page assistant. */
  caller: "browser-agent" | "assistant" | "ui";
  at: number;
  durationMs: number;
}

const MAX = 60;
let events: ToolEvent[] = [];
const listeners = new Set<() => void>();

export const toolLog = {
  push(e: ToolEvent) {
    events = [e, ...events].slice(0, MAX);
    for (const l of listeners) l();
  },
  clear() {
    events = [];
    for (const l of listeners) l();
  },
  get: () => events,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

const EMPTY: ToolEvent[] = [];

export function useToolLog(): ToolEvent[] {
  return useSyncExternalStore(toolLog.subscribe, toolLog.get, () => EMPTY);
}
