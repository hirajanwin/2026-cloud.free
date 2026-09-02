/**
 * The inspector: the selected node's product on the current provider, its
 * knobs, and the numbers flowing through it. With nothing selected it shows
 * the document's summary and the template's lesson.
 */
import { ArrowLeft, Copy, Pencil, Save, Trash2 } from "lucide-react";
import { blueprints, useBlueprints } from "@/state/blueprints";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { useEffect, useState } from "react";
import { KINDS, PRODUCTS, isProductKind, type ProductKind } from "@/engine/catalog";
import { applyPatch } from "@/engine/dsl";
import { PRICING } from "@/engine/pricing";
import { defaultProtection } from "@/engine/sim";
import { templateById } from "@/engine/templates";
import {
  PROTECTION_MODES,
  PROTECTION_MODE_LABEL,
  REQUEST_CLASSES,
  REQUEST_CLASS_LABEL,
  type ProtectionMode,
} from "@/engine/types";
import { formatCount } from "@/lib/format";
import { studio, useStudio } from "@/state/store";
import { Glyph } from "./Glyph";

const ATTR_HELP: Record<string, string> = {
  hit: "Cache hit rate for humans (0..1). Crawlers and bots hit less.",
  cpuMs:
    "CPU milliseconds per request. Wall time waiting on I/O is not billed.",
  bytesKb: "Response size in KB, for data transfer meters.",
  rowsRead: "Rows scanned per query. Indexes make this small.",
  rowsWritten: "Rows written per write query.",
  writeShare: "Share of operations that are writes (0..1).",
  limitRps: "Requests per second allowed per class before shedding.",
  neurons: "Workers AI neurons per request; depends on model and tokens.",
  dims: "Vector dimensions.",
  indexVectors: "Vectors in the index (queried dims = dims × vectors).",
  durationMs: "Active time per request for GB-second billing.",
  memGb: "Memory in GB for GB-second billing.",
  steps: "Steps per workflow run.",
  runsPerDay: "Scheduled runs per day.",
  opsPerMessage: "Queue operations per message (write + read + ack).",
  queryMs: "Database compute time per query (Neon bills compute hours).",
};

export function Inspector() {
  const selectedId = useStudio((s) => s.selectedId);
  const node = useStudio((s) =>
    s.diagram.nodes.find((n) => n.id === s.selectedId),
  );
  const group = useStudio((s) =>
    s.diagram.groups.find((g) => g.id === s.selectedId),
  );
  if (!selectedId || (!node && !group)) return <Overview />;
  if (group) return <GroupView id={group.id} label={group.label} />;
  return <NodeView id={node!.id} />;
}

function Overview() {
  const diagram = useStudio((s) => s.diagram);
  const warnings = useStudio((s) => s.rates.warnings);
  const templateId = useStudio((s) => s.templateId);
  const analysis = useStudio((s) => s.analysis);
  const provider = useStudio((s) => s.provider);
  const blueprintId = useStudio((s) => s.blueprintId);
  const saved = useBlueprints();
  const open = blueprintId ? saved.find((b) => b.id === blueprintId) : undefined;
  const t = templateId ? templateById(templateId) : undefined;
  const other = provider === "cloudflare" ? "vercel" : "cloudflare";
  const kinds = [...new Set(diagram.nodes.map((n) => n.kind).filter(isProductKind))].filter((k) => k !== "client") as ProductKind[];
  return (
    <div className="flex flex-col gap-4 text-body">
      <div>
        <RenameField
          value={open ? open.name : (diagram.title ?? "")}
          placeholder="Untitled architecture"
          onCommit={(name) => {
            if (open) blueprints.rename(open.id, name);
            studio.setTitle(name);
          }}
        />
        <div className="text-caption text-muted-foreground">
          {diagram.nodes.length} nodes · {diagram.edges.length} edges · {diagram.groups.length} groups
          {open ? " · saved blueprint" : t ? " · template" : ""}
          {open?.from ? ` · remixed from ${open.from.name}` : ""}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {open ? (
            <>
              <Button variant="tertiary" size="compact" leadingIcon={Copy} onClick={() => blueprints.remix(open.id)}>
                Remix
              </Button>
              <Button variant="ghost" size="compact" leadingIcon={Trash2} onClick={() => blueprints.remove(open.id)}>
                Delete
              </Button>
            </>
          ) : (
            <Button variant="tertiary" size="compact" leadingIcon={Save} onClick={() => blueprints.saveCurrent()}>
              Save as blueprint
            </Button>
          )}
        </div>
      </div>
      {t && (
        <div className="rounded-xl bg-surface-2 p-3 shadow-surface-1">
          <div className="text-caption font-medium text-muted-foreground">
            What to watch
          </div>
          <p className="mt-1 text-body">{t.lesson}</p>
        </div>
      )}
      {analysis && (
        <div className="rounded-xl bg-surface-2 p-3 shadow-surface-1">
          <div className="flex items-center justify-between">
            <div className="text-caption font-medium text-muted-foreground">
              Last analysis · {analysis.name}
            </div>
            <Badge
              color={
                analysis.call === "yes"
                  ? "green"
                  : analysis.call === "kinda"
                    ? "amber"
                    : "red"
              }
              size="compact"
            >
              {analysis.call}
            </Badge>
          </div>
          <p className="mt-1 text-body">{analysis.summary}</p>
          <div className="mt-2 text-caption text-muted-foreground">
            Core: {analysis.core.join(" · ")}
          </div>
          {analysis.source === "heuristic" && (
            <div className="mt-1 text-caption text-warning">
              Keyword-based guess; the model was unavailable.
            </div>
          )}
        </div>
      )}
      <LayerList />
      {kinds.length > 0 && (
        <div className="rounded-xl bg-surface-2 p-3 shadow-surface-1">
          <div className="text-caption font-medium text-muted-foreground">
            On {provider === "cloudflare" ? "Cloudflare" : "Vercel"} · switch to see {other === "cloudflare" ? "Cloudflare" : "Vercel"}
          </div>
          <ul className="mt-2 flex flex-col gap-1.5">
            {kinds.map((k) => {
              const here = PRODUCTS[provider][k];
              const there = PRODUCTS[other][k];
              return (
                <li key={k} className="flex items-start gap-2 text-caption">
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                    <Glyph kind={k} size={13} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={here.gap?.severity === "missing" ? "text-destructive" : "text-foreground"}>{here.name}</span>
                    {here.gap && <span className="text-muted-foreground"> · {here.gap.severity}</span>}
                    <span className="block truncate text-muted-foreground" title={there.name}>
                      {other === "cloudflare" ? "Cloudflare" : "Vercel"}: {there.name}
                      {there.gap ? ` (${there.gap.severity})` : ""}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <ul className="rounded-lg bg-warning-light px-3 py-2 text-caption text-foreground">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      <p className="text-caption text-muted-foreground">
        Select a node to see its product, knobs and traffic. Add products from
        the sidebar, or ask the assistant.
      </p>
    </div>
  );
}

function RenameField({ value, placeholder, onCommit }: { value: string; placeholder: string; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (!editing) {
    return (
      <div className="flex items-center gap-1">
        <div className="min-w-0 truncate text-title font-medium">{value || placeholder}</div>
        <Button variant="ghost" size="compact" aria-label="Rename" onClick={() => setEditing(true)}>
          <Pencil className="size-3.5" />
        </Button>
      </div>
    );
  }
  const commit = () => {
    setEditing(false);
    if (draft.trim() !== value) onCommit(draft.trim());
  };
  return (
    <input
      autoFocus
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
      aria-label="Name"
      className="w-full rounded-md bg-surface-2 px-2 py-1 text-title font-medium outline-none shadow-surface-1 focus-visible:outline-1"
    />
  );
}

/** Every node on the canvas, in document order, grouped like the canvas. Click one to inspect it. */
function LayerList() {
  const diagram = useStudio((s) => s.diagram);
  const provider = useStudio((s) => s.provider);
  const rates = useStudio((s) => s.rates);
  const rows = (scope: string | undefined, depth: number): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    const items: { key: number; node?: (typeof diagram.nodes)[number]; group?: (typeof diagram.groups)[number] }[] = [];
    diagram.nodes.forEach((n, i) => n.group === scope && items.push({ key: i, node: n }));
    diagram.groups.forEach((g, i) => {
      if (g.parent !== scope) return;
      const first = diagram.nodes.findIndex((n) => n.group === g.id);
      items.push({ key: first === -1 ? 1e6 + i : first, group: g });
    });
    items.sort((a, b) => a.key - b.key);
    for (const it of items) {
      if (it.group) {
        out.push(
          <li key={`g:${it.group.id}`} className="mt-1 first:mt-0">
            <button
              type="button"
              onClick={() => studio.select(it.group!.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-caption font-medium text-muted-foreground hover:bg-hover"
              style={{ paddingLeft: 8 + depth * 14 }}
            >
              <span className="inline-block size-2 rounded-sm border border-dashed border-foreground/40" aria-hidden />
              {it.group.label ?? it.group.id}
            </button>
            <ul className="flex flex-col">{rows(it.group.id, depth + 1)}</ul>
          </li>,
        );
      } else if (it.node) {
        const n = it.node;
        const product = isProductKind(n.kind) ? PRODUCTS[provider][n.kind] : undefined;
        const r = rates.nodes[n.id];
        const arrivals = r ? Object.values(r.arrivals).reduce((s, v) => s + v, 0) : 0;
        const blocked = r ? Object.values(r.blocked).reduce((s, v) => s + v, 0) : 0;
        out.push(
          <li key={n.id}>
            <button
              type="button"
              onClick={() => studio.select(n.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-hover"
              style={{ paddingLeft: 8 + depth * 14 }}
            >
              <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                <Glyph kind={n.kind} size={14} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-foreground">{n.label ?? product?.name ?? n.kind}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{product?.name ?? n.kind}</span>
              </span>
              <span className="shrink-0 text-right text-[11px] text-numeric text-muted-foreground">
                {n.kind === "client" ? `${formatCount(arrivals)}/d` : `${formatCount(arrivals)}/d`}
                {blocked > 0 && <span className="block text-destructive">⊘{formatCount(blocked)}</span>}
              </span>
            </button>
          </li>,
        );
      }
    }
    return out;
  };
  return (
    <div className="rounded-xl bg-surface-2 p-2 shadow-surface-1">
      <div className="px-2 pb-1 text-caption font-medium text-muted-foreground">Layers</div>
      <ul className="flex flex-col">{rows(undefined, 0)}</ul>
    </div>
  );
}

function BackToLayers() {
  return (
    <button type="button" onClick={() => studio.select(null)} className="inline-flex items-center gap-1 self-start text-caption text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-3.5" /> All layers
    </button>
  );
}

function GroupView({ id, label }: { id: string; label?: string }) {
  return (
    <div className="flex flex-col gap-3">
      <BackToLayers />
      <div className="text-title font-medium">{label ?? id}</div>
      <p className="text-caption text-muted-foreground">
        A group is a visual boundary. It carries no traffic and no cost.
      </p>
      <Button
        variant="tertiary"
        size="compact"
        leadingIcon={Trash2}
        onClick={() => {
          const { diagram } = applyPatch(studio.get().diagram, [
            { op: "remove_group", id },
          ]);
          studio.setDiagram(diagram);
          studio.select(null);
        }}
      >
        Remove group
      </Button>
    </div>
  );
}

function NodeView({ id }: { id: string }) {
  const node = useStudio((s) => s.diagram.nodes.find((n) => n.id === id))!;
  const provider = useStudio((s) => s.provider);
  const rates = useStudio((s) => s.rates.nodes[id]);
  const cap = useStudio((s) => s.rates.caps[id]);
  const protection = useStudio((s) => s.protections[id]);
  const spec = isProductKind(node.kind) ? KINDS[node.kind] : undefined;
  const product = isProductKind(node.kind) ? PRODUCTS[provider][node.kind] : undefined;
  const attrs = {
    ...(spec?.defaults ?? {}),
    ...Object.fromEntries(
      Object.entries(node.attrs).filter(([, v]) => typeof v === "number"),
    ),
  } as Record<string, number>;
  const mode =
    spec?.role === "gate" ? (protection ?? defaultProtection(node.kind)) : null;

  const setAttr = (key: string, value: number) => {
    const { diagram } = applyPatch(studio.get().diagram, [
      { op: "set_node", id, attrs: { [key]: value } },
    ]);
    studio.setDiagram(diagram);
  };
  const setLabel = (label: string) => {
    const { diagram } = applyPatch(studio.get().diagram, [
      { op: "set_node", id, label },
    ]);
    studio.setDiagram(diagram);
  };

  return (
    <div className="flex flex-col gap-4 text-body">
      <BackToLayers />
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
          <Glyph kind={node.kind} size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <input
            value={node.label ?? ""}
            placeholder={product?.name ?? node.kind}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full bg-transparent text-title font-medium outline-none placeholder:text-muted-foreground"
            aria-label="Node label"
          />
          <div className="text-caption text-muted-foreground">
            {product?.name ?? node.kind} · <code>{id}</code>
          </div>
        </div>
        <Button
          variant="ghost"
          size="compact"
          aria-label="Remove node"
          onClick={() => {
            const { diagram } = applyPatch(studio.get().diagram, [
              { op: "remove_node", id },
            ]);
            studio.setDiagram(diagram);
            studio.select(null);
          }}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {product && (
        <div className="rounded-xl bg-surface-2 p-3 shadow-surface-1">
          <p className="text-body">{product.tagline}</p>
          <p className="mt-2 text-caption text-muted-foreground">
            <span className="font-medium text-foreground">When to use.</span>{" "}
            {product.whenToUse}
          </p>
          {product.limits && (
            <p className="mt-1 text-caption text-muted-foreground">
              <span className="font-medium text-foreground">Limits.</span>{" "}
              {product.limits}
            </p>
          )}
          {product.stack && product.stack.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {product.stack.map((s) => (
                <Badge key={s} color="gray" variant="dot" size="compact">
                  {s}
                </Badge>
              ))}
            </div>
          )}
          {product.gap && (
            <div
              className={`mt-2 rounded-md px-2 py-1.5 text-caption ${product.gap.severity === "missing" ? "bg-destructive-light text-destructive" : "bg-warning-light text-warning"}`}
            >
              {product.gap.note}
            </div>
          )}
          {product.docs && (
            <a
              href={product.docs}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-caption text-info underline-offset-2 hover:underline"
            >
              Documentation
            </a>
          )}
        </div>
      )}

      {mode && (
        <div>
          <div className="mb-1 text-caption font-medium text-muted-foreground">
            Protection
          </div>
          <Select
            value={mode}
            onValueChange={(v) => studio.setProtection(id, v as ProtectionMode)}
            size="compact"
          >
            <SelectTrigger placeholder="Mode" />
            <SelectContent>
              {PROTECTION_MODES.map((m, i) => (
                <SelectItem key={m} index={i} value={m}>
                  {PROTECTION_MODE_LABEL[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-caption text-muted-foreground">
            {node.kind === "rate-limit"
              ? "Sheds scraper and botnet traffic above the per-class limit. Humans and verified crawlers are untouched."
              : node.kind === "waf"
                ? "Managed rules stop the botnet class. Everything else passes."
                : "Blocks the named classes before anything downstream is billed. Blocking search crawlers removes you from search."}
          </p>
        </div>
      )}

      {Object.keys(attrs).length > 0 && (
        <div>
          <div className="mb-1 text-caption font-medium text-muted-foreground">
            Knobs
          </div>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(attrs).map(([k, v]) => (
              <label
                key={k}
                className="flex flex-col gap-0.5 rounded-lg bg-surface-2 px-2.5 py-1.5 shadow-surface-1"
                title={ATTR_HELP[k]}
              >
                <span className="text-[11px] text-muted-foreground">{k}</span>
                <input
                  type="number"
                  value={v}
                  step={k === "hit" || k === "writeShare" ? 0.05 : 1}
                  min={0}
                  onChange={(e) => setAttr(k, Number(e.target.value))}
                  className="w-full bg-transparent text-numeric text-[13px] text-foreground outline-none"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {rates && (
        <div>
          <div className="mb-1 text-caption font-medium text-muted-foreground">
            Per day
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="arrive" value={sumOf(rates.arrivals)} />
            <Stat
              label="blocked"
              value={sumOf(rates.blocked)}
              tone="text-destructive"
            />
            <Stat
              label="dropped"
              value={sumOf(rates.dropped)}
              tone="text-warning"
            />
          </div>
          <div className="mt-2 flex flex-col gap-1">
            {REQUEST_CLASSES.filter((c) => rates.arrivals[c] > 0).map((c) => (
              <div
                key={c}
                className="flex items-center justify-between text-caption"
              >
                <span className="text-muted-foreground">
                  {REQUEST_CLASS_LABEL[c]}
                </span>
                <span className="text-numeric">
                  {formatCount(rates.arrivals[c])}
                  {rates.blocked[c] > 0 ? (
                    <span className="text-destructive">
                      {" "}
                      −{formatCount(rates.blocked[c])}
                    </span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
          {cap && (
            <div className="mt-2 rounded-md bg-warning-light px-2 py-1.5 text-caption text-warning">
              Free plan cap on{" "}
              {PRICING[provider].meters[cap.meter]?.label ?? cap.meter}: only{" "}
              {Math.round(cap.fraction * 100)}% of requests are served here.
            </div>
          )}
        </div>
      )}

      {rates && Object.keys(rates.meters).length > 0 && (
        <div>
          <div className="mb-1 text-caption font-medium text-muted-foreground">
            Meters this node drives (per day)
          </div>
          <div className="flex flex-col gap-1">
            {Object.entries(rates.meters)
              .sort((a, b) => b[1] - a[1])
              .map(([m, v]) => {
                const spec = PRICING[provider].meters[m];
                const use = product?.meters.find((u) => u.meter === m);
                return (
                  <div
                    key={m}
                    className="flex items-center justify-between gap-2 text-caption"
                  >
                    <span
                      className="truncate text-muted-foreground"
                      title={use?.note}
                    >
                      {spec?.label ?? m}
                      {use?.estimate ? " (est.)" : ""}
                    </span>
                    <span className="shrink-0 text-numeric">
                      {formatCount(v)}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

function sumOf(r: Record<string, number>) {
  return Object.values(r).reduce((s, v) => s + v, 0);
}

function Stat({
  label,
  value,
  tone = "text-foreground",
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div className="rounded-lg bg-surface-2 px-2 py-1.5 shadow-surface-1">
      <div className={`text-numeric text-[15px] font-medium ${tone}`}>
        {formatCount(value)}
      </div>
      <div className="text-[10.5px] text-muted-foreground">{label}</div>
    </div>
  );
}
