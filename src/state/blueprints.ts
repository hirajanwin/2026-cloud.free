/**
 * Saved blueprints: the documents a person keeps. Persisted in localStorage
 * (this is a studio, not an account), autosaved while a blueprint is open,
 * and remixable from any template or other blueprint.
 */
import { useSyncExternalStore } from "react";
import { parse } from "@/engine/dsl";
import { templateById } from "@/engine/templates";
import { studio, type StudioDocument } from "./store";

export interface Blueprint extends StudioDocument {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Where it came from, for the remix trail. */
  from?: { kind: "template" | "blueprint"; id: string; name: string };
}

const KEY = "blueprint.saved.v1";
let items: Blueprint[] = load();
const listeners = new Set<() => void>();

function load(): Blueprint[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Blueprint[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* storage full or unavailable */
  }
  for (const l of listeners) l();
}

function id(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function titleOf(source: string, fallback: string): string {
  return parse(source).diagram.title ?? fallback;
}

export const blueprints = {
  list: () => items,
  get: (bid: string) => items.find((b) => b.id === bid),
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  /** A new, nearly empty blueprint, opened in the studio. */
  create(name = "New blueprint"): Blueprint {
    const now = Date.now();
    studio.newDocument(null);
    const doc = studio.document();
    const b: Blueprint = {
      id: id(),
      name,
      ...doc,
      createdAt: now,
      updatedAt: now,
    };
    items = [b, ...items];
    studio.setBlueprintId(b.id);
    persist();
    return b;
  },

  /** Save whatever is on the canvas as a new blueprint. */
  saveCurrent(name?: string): Blueprint {
    const now = Date.now();
    const doc = studio.document();
    const s = studio.get();
    const from = s.templateId
      ? {
          kind: "template" as const,
          id: s.templateId,
          name: templateById(s.templateId)?.name ?? s.templateId,
        }
      : s.blueprintId
        ? {
            kind: "blueprint" as const,
            id: s.blueprintId,
            name:
              items.find((b) => b.id === s.blueprintId)?.name ?? "blueprint",
          }
        : undefined;
    const b: Blueprint = {
      id: id(),
      name: name ?? titleOf(doc.source, "Untitled"),
      ...doc,
      createdAt: now,
      updatedAt: now,
      from,
    };
    items = [b, ...items];
    studio.setBlueprintId(b.id);
    persist();
    return b;
  },

  /** Duplicate a template or blueprint into a new blueprint and open it. */
  remixTemplate(templateId: string): Blueprint | null {
    if (!studio.loadTemplate(templateId)) return null;
    const t = templateById(templateId)!;
    return blueprints.saveCurrent(`${t.name} (remix)`);
  },

  remix(bid: string): Blueprint | null {
    const src = items.find((b) => b.id === bid);
    if (!src) return null;
    const now = Date.now();
    const b: Blueprint = {
      ...src,
      id: id(),
      name: `${src.name} (remix)`,
      createdAt: now,
      updatedAt: now,
      from: { kind: "blueprint", id: src.id, name: src.name },
    };
    items = [b, ...items];
    persist();
    blueprints.open(b.id);
    return b;
  },

  open(bid: string): boolean {
    const b = items.find((x) => x.id === bid);
    if (!b) return false;
    studio.loadDocument(b, b.id);
    return true;
  },

  rename(bid: string, name: string) {
    items = items.map((b) =>
      b.id === bid ? { ...b, name, updatedAt: Date.now() } : b,
    );
    persist();
  },

  remove(bid: string) {
    items = items.filter((b) => b.id !== bid);
    if (studio.get().blueprintId === bid) studio.setBlueprintId(null);
    persist();
  },

  /** Write the studio's current document into its open blueprint. */
  saveOpen() {
    const s = studio.get();
    if (!s.blueprintId) return;
    const doc = studio.document();
    let changed = false;
    items = items.map((b) => {
      if (b.id !== s.blueprintId) return b;
      if (
        b.source === doc.source &&
        b.provider === doc.provider &&
        b.plan === doc.plan &&
        JSON.stringify(b.mix) === JSON.stringify(doc.mix) &&
        JSON.stringify(b.protections) === JSON.stringify(doc.protections)
      )
        return b;
      changed = true;
      return { ...b, ...doc, name: b.name, updatedAt: Date.now() };
    });
    if (changed) persist();
  },
};

/* Autosave: whenever the studio changes while a blueprint is open. */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
if (typeof window !== "undefined") {
  studio.subscribe(() => {
    if (!studio.get().blueprintId) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => blueprints.saveOpen(), 600);
  });
}

const EMPTY: Blueprint[] = [];
export function useBlueprints(): Blueprint[] {
  return useSyncExternalStore(
    blueprints.subscribe,
    blueprints.list,
    () => EMPTY,
  );
}
