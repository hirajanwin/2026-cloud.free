/**
 * The canvas: React Flow rendering the diagram, laid out by ELK, with live
 * numbers from the store. Nodes subscribe to their own slice so a 10 Hz
 * snapshot does not re-render the graph structure.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useReactFlow,
  useNodesInitialized,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  ControlButton,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { KINDS, PRODUCTS, isProductKind } from "@/engine/catalog";
import { resolveService } from "@/engine/services";
import { FIT_EVENT } from "@/lib/shortcuts";
import type { Direction } from "@/engine/dsl";
import { layoutDiagram, NODE_H, NODE_W } from "@/engine/layout";
import { defaultProtection, edgeKey } from "@/engine/sim";
import {PROTECTION_MODE_LABEL } from "@/engine/types";
import { formatCount } from "@/lib/format";
import { studio, useStudio } from "@/state/store";
import { applyPatch } from "@/engine/dsl";
import { useResolvedTheme } from "@/lib/use-resolved-theme";
import { type Connection, type IsValidConnection } from "@xyflow/react";
import { Glyph } from "./Glyph";
import { toneAt, toneFor } from "@/lib/tones";
import { } from "lucide-react";

type ProductNodeData = {
  id: string;
  kind: string;
  label?: string;
  direction: Direction;
  tone: string;
  service?: unknown;
};
type GroupNodeData = { id: string; label?: string; tone: string };
type FlowEdgeData = { key: string; label?: string; style: string; outIndex: number; tone?: string; toTone?: string };

type RFNode = Node<ProductNodeData, "product"> | Node<GroupNodeData, "group">;
type RFEdge = Edge<FlowEdgeData, "flow">;

const sum = (r: Record<string, number>) =>
  Object.values(r).reduce((s, v) => s + v, 0);

function handlePositions(direction: Direction): {
  target: Position;
  source: Position;
} {
  switch (direction) {
    case "down":
      return { target: Position.Top, source: Position.Bottom };
    case "up":
      return { target: Position.Bottom, source: Position.Top };
    case "left":
      return { target: Position.Right, source: Position.Left };
    default:
      return { target: Position.Left, source: Position.Right };
  }
}

/* ------------------------------------------------------------------ */

const ProductNode = memo(function ProductNode({
  data,
  selected,
}: NodeProps<Node<ProductNodeData, "product">>) {
  const provider = useStudio((s) => s.provider);
  const rates = useStudio((s) => s.rates.nodes[data.id]);
  const cap = useStudio((s) => s.rates.caps[data.id]);
  const protection = useStudio((s) => s.protections[data.id]);
  const product = isProductKind(data.kind) ? PRODUCTS[provider][data.kind] : undefined;
  const role = isProductKind(data.kind) ? KINDS[data.kind].role : "compute";
  const pos = handlePositions(data.direction);

  const arrivals = rates ? sum(rates.arrivals) : 0;
  const blocked = rates ? sum(rates.blocked) : 0;
  const dropped = rates ? sum(rates.dropped) : 0;
  const answered = rates ? sum(rates.answeredHere) : 0;
  const gap = product?.gap;
  const mode = role === "gate" ? (protection ?? defaultProtection(data.kind)) : null;
  const svc = data.kind === "external" ? resolveService(data.service) : null;
  const title = data.label ?? svc?.product.name ?? product?.name ?? data.kind;
  const subtitle = svc ? svc.vendorName : data.label ? (product?.name ?? data.kind) : (isProductKind(data.kind) ? KINDS[data.kind].name : data.kind);


  return (
    <div
      className={[
        "node-in group/node relative grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-xl border bg-surface-3 px-3 shadow-surface-2 transition-[box-shadow,background-color,border-color] duration-150",
        selected ? "node-selected ring-2 ring-[color:var(--node-tone)] shadow-surface-5" : "hover:shadow-surface-3",
        gap?.severity === "missing" ? "outline outline-1 outline-dashed outline-destructive/60" : "",
      ].join(" ")}
      style={{ width: NODE_W, height: NODE_H, ["--node-tone" as string]: data.tone, borderColor: selected ? data.tone : `color-mix(in oklab, ${data.tone} 55%, transparent)` }}
    >
      <Handle type="target" position={pos.target} className="!h-2.5 !w-2.5 !border-2 !border-foreground/60 !bg-surface-1" />
      <Handle type="source" position={pos.source} className="!h-2.5 !w-2.5 !border-2 !border-foreground/60 !bg-surface-1" />

      <div className="flex size-9 items-center justify-center rounded-lg" style={{ background: `color-mix(in oklab, ${data.tone} 16%, transparent)`, color: `color-mix(in oklab, ${data.tone} 78%, var(--foreground))` }}>
        <Glyph kind={data.kind} size={20} provider={provider} />
      </div>

      <div className="min-w-0">
        <div className="truncate text-[13px] leading-[18px]" style={{ fontVariationSettings: "'wght' 550, 'opsz' 18", color: `color-mix(in oklab, ${data.tone} 62%, var(--foreground))` }} title={title}>
          <span key={title} className="text-in">{title}</span>
        </div>
        <div className="truncate text-[11px] leading-[16px] text-muted-foreground" title={subtitle}>
          <span key={subtitle} className="text-in">{subtitle}</span>
        </div>
      </div>

      <div className="flex flex-col items-end justify-center text-numeric leading-[16px]">
        {role === "source" ? (
          <>
            <span className="text-[12px] text-foreground">{formatCount(arrivals)}</span>
            <span className="text-[10px] text-muted-foreground">req/day</span>
          </>
        ) : (
          <>
            <span className="text-[12px] text-foreground">{formatCount(arrivals)}<span className="text-muted-foreground">/d</span></span>
            <span className="flex gap-1.5 text-[10px]">
              {blocked > 0 && <span className="text-destructive">⊘{formatCount(blocked)}</span>}
              {dropped > 0 && <span className="text-warning">✕{formatCount(dropped)}</span>}
              {role === "cache" && arrivals > 0 && <span className="text-success">{Math.round((answered / arrivals) * 100)}% hit</span>}
              {blocked === 0 && dropped === 0 && role !== "cache" && <span className="text-muted-foreground">&nbsp;</span>}
            </span>
          </>
        )}
      </div>

      {mode && (
        <span
          className={`absolute -top-2 right-3 rounded-full px-1.5 py-px text-[9.5px] leading-3 shadow-surface-1 ${mode === "off" ? "bg-surface-2 text-muted-foreground" : "bg-info-light text-info"}`}
          title={PROTECTION_MODE_LABEL[mode]}
        >
          {mode === "off" ? "protection off" : mode}
        </span>
      )}
      {cap && (
        <span className="absolute -bottom-2 right-3 rounded-full bg-warning-light px-1.5 py-px text-[9.5px] leading-3 text-warning shadow-surface-1" title={`Free plan cap: ${Math.round(cap.fraction * 100)}% served`}>
          cap {Math.round(cap.fraction * 100)}%
        </span>
      )}
    </div>
  );
});

const GroupNode = memo(function GroupNode({
  data,
  width,
  height,
  selected,
}: NodeProps<Node<GroupNodeData, "group">>) {
  return (
    <div
      className={`group-shell h-full w-full rounded-2xl border bg-surface-2 shadow-surface-1 transition-[border-color,box-shadow] duration-150 ${selected ? "shadow-surface-3" : ""}`}
      style={{ width, height, borderColor: `color-mix(in oklab, ${data.tone} ${selected ? 80 : 45}%, transparent)`, background: `color-mix(in oklab, ${data.tone} 6%, var(--surface-2))` }}
    >
      <div className="flex items-center gap-1.5 px-3 pt-2 text-caption font-medium text-muted-foreground">
        {data.label ?? data.id}
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */


const FlowEdge = memo(function FlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<RFEdge>) {
  const flow = useStudio((s) =>
    data ? s.rates.edges[data.key]?.flow : undefined,
  );
  // Labels sit on the first segment out of the source, stacked per sibling edge,
  // so fan-outs never pile their labels on one midpoint.
  const idx = data?.outIndex ?? 0;
  const horizontal = sourcePosition === Position.Left || sourcePosition === Position.Right;
  const dir = sourcePosition === Position.Left || sourcePosition === Position.Top ? -1 : 1;
  const anchor = horizontal
    ? { x: sourceX + dir * 44, y: sourceY - 12 - idx * 15, tx: dir > 0 ? "0, -100%" : "-100%, -100%" }
    : { x: sourceX + 10, y: sourceY + dir * (28 + idx * 15), tx: "0, -50%" };
  const edgeStyle = useStudio((s) => s.edgeStyle);
  const [path] =
    edgeStyle === "step"
      ? getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 12 })
      : edgeStyle === "straight"
        ? getStraightPath({ sourceX, sourceY, targetX, targetY })
        : getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.28 });
  const total = flow ? sum(flow) : 0;
  const isAnnotation = data?.style === "line" || data?.style === "dotted";
  const width = isAnnotation
    ? 1
    : total <= 0
      ? 1.25
      : Math.min(4, 1 + Math.log10(Math.max(1, total)) / 2);
  // Dash speed follows the log of traffic so a busy edge visibly moves faster.
  const duration =
    total <= 0 ? 0 : Math.max(0.6, 6 - Math.log10(Math.max(1, total)));
  // The line runs from the source node's colour to the target node's, so you can read which
  // pair it joins without following it. A userSpaceOnUse gradient keeps the ends pinned.
  const gradId = `edge-grad-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const from = data?.tone ?? "var(--muted-foreground)";
  const to = data?.toTone ?? from;

  return (
    <>
      {!isAnnotation && (
        <defs>
          <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}>
            <stop offset="0" stopColor={from} />
            <stop offset="1" stopColor={to} />
          </linearGradient>
        </defs>
      )}
      <BaseEdge
        id={id}
        path={path}
        markerEnd={isAnnotation ? undefined : "url(#flow-arrow)"}
        style={{
          stroke: isAnnotation ? "var(--muted-foreground)" : `url(#${gradId})`,
          opacity: isAnnotation ? 1 : 0.45,
          strokeWidth: width + 0.5,
          strokeDasharray: isAnnotation ? "3 4" : undefined,
        }}
      />
      {!isAnnotation && total > 0 && (
        <path
          d={path}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={width}
          strokeDasharray="7 11"
          className="flow-dash"
          style={{ animationDuration: `${duration}s`, opacity: 1 }}
        />
      )}
      {(data?.label || (total > 0 && selected)) && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute whitespace-nowrap rounded-md bg-surface-3 px-1.5 py-0.5 text-[10px] leading-3 text-muted-foreground shadow-surface-1"
            style={{
              transform: `translate(${anchor.tx}) translate(${anchor.x}px, ${anchor.y}px)`,
            }}
          >
            {data?.label}
            {data?.label && total > 0 ? " · " : ""}
            {total > 0 ? `${formatCount(total)}/d` : ""}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

const nodeTypes = { product: ProductNode, group: GroupNode };

function EdgeStyleControls() {
  const edgeStyle = useStudio((s) => s.edgeStyle);
  const items = [
    ["curved", "Curved", "M3 17c6 0 6-10 12-10h6"],
    ["step", "Step", "M3 17h7v-10h11"],
    ["straight", "Straight", "M3 17 21 7"],
  ] as const;
  return (
    <>
      {items.map(([m, label, d]) => (
        <ControlButton
          key={m}
          title={`${label} edges`}
          aria-label={`${label} edges`}
          aria-pressed={edgeStyle === m}
          onClick={() => studio.setEdgeStyle(m)}
          className={edgeStyle === m ? "!text-foreground edge-style-on" : "!text-muted-foreground"}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ fill: "none" }}>
            <path d={d} />
          </svg>
        </ControlButton>
      ))}
    </>
  );
}

/** Horizontal, vertical, or snake, plus reset. The first two write the DSL direction; snake is a view. */
function LayoutControls() {
  const direction = useStudio((s) => s.diagram.direction);
  const viewLayout = useStudio((s) => s.viewLayout);
  const mode = viewLayout === "snake" ? "snake" : direction === "down" || direction === "up" ? "vertical" : "horizontal";
  const set = (m: "horizontal" | "vertical" | "snake") => {
    if (m === "snake") {
      if (direction !== "right") studio.setDirection("right");
      studio.setViewLayout("snake");
    } else {
      studio.setViewLayout("flow");
      studio.setDirection(m === "vertical" ? "down" : "right");
    }
  };
  const items = [
    ["snake", "Snake", "M4 6h12a3 3 0 0 1 0 6H8a3 3 0 0 0 0 6h12"],
    ["vertical", "Vertical", "M12 4v16M6 14l6 6 6-6"],
    ["horizontal", "Horizontal", "M4 12h16M14 6l6 6-6 6"],
  ] as const;
  return (
    <>
      {items.map(([m, label, d]) => (
        <ControlButton
          key={m}
          title={`${label} layout`}
          aria-label={`${label} layout`}
          aria-pressed={mode === m}
          onClick={() => set(m)}
          className={mode === m ? "!text-foreground edge-style-on" : "!text-muted-foreground"}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ fill: "none" }}>
            <path d={d} />
          </svg>
        </ControlButton>
      ))}
      <ControlButton title="Reset positions (re-run auto-layout)" aria-label="Reset positions" onClick={() => studio.relayout()} className="!text-muted-foreground">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ fill: "none" }}>
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </svg>
      </ControlButton>
    </>
  );
}
const edgeTypes = { flow: FlowEdge };

/* ------------------------------------------------------------------ */

function CanvasInner() {
  const diagram = useStudio((s) => s.diagram);
  const revision = useStudio((s) => s.revision);
  const viewLayout = useStudio((s) => s.viewLayout);
  const selectedId = useStudio((s) => s.selectedId);
  const focusNonce = useStudio((s) => s.focusNonce);
  const theme = useResolvedTheme();
  const [nodes, setNodes] = useState<RFNode[]>([]);
  const [edges, setEdges] = useState<RFEdge[]>([]);
  const { fitBounds, setCenter } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const nodesRef = useRef<RFNode[]>([]);
  const layoutRun = useRef(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pendingFit = useRef(false);

  /** Bounds from our own geometry: measurement-independent, so the fit is exact on first paint. */
  const fitAll = useCallback(
    (duration = 200) => {
      const all = nodesRef.current;
      if (all.length === 0) return;
      const byId = new Map(all.map((n) => [n.id, n]));
      const abs = (n: RFNode): { x: number; y: number } => {
        const p = n.parentId ? byId.get(n.parentId) : undefined;
        if (!p) return n.position;
        const pp = abs(p);
        return { x: pp.x + n.position.x, y: pp.y + n.position.y };
      };
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of all) {
        const { x, y } = abs(n);
        const w = n.width ?? NODE_W;
        const h = n.height ?? NODE_H;
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
      }
      fitBounds({ x: minX, y: minY, width: maxX - minX, height: maxY - minY }, { padding: 0.12, duration });
    },
    [fitBounds],
  );

  const refit = useCallback(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => fitAll(250)));
    setTimeout(() => fitAll(200), 400);
  }, [fitAll]);

  // "F" and the fit shortcut.
  useEffect(() => {
    const onFit = () => fitAll(250);
    window.addEventListener(FIT_EVENT, onFit);
    return () => window.removeEventListener(FIT_EVENT, onFit);
  }, [fitAll]);

  useEffect(() => {
    const run = ++layoutRun.current;
    const el = containerRef.current;
    layoutDiagram(diagram, viewLayout, el ? { width: el.clientWidth, height: el.clientHeight } : undefined).then((layout) => {
      if (run !== layoutRun.current) return;
      const byId = new Map(layout.nodes.map((n) => [n.id, n]));
      const ids = diagram.nodes.map((n) => n.id);
      const next: RFNode[] = [];
      for (const g of diagram.groups) {
        const l = byId.get(g.id);
        if (!l) continue;
        next.push({ id: g.id, type: "group", position: { x: l.x, y: l.y }, width: l.width, height: l.height, parentId: l.parentId, data: { id: g.id, label: g.label, tone: toneAt(diagram.nodes.length + diagram.groups.indexOf(g)) }, selectable: true, draggable: false, connectable: false, zIndex: -1 });
      }
      for (const n of diagram.nodes) {
        const l = byId.get(n.id);
        if (!l) continue;
        next.push({ id: n.id, type: "product", position: { x: l.x, y: l.y }, width: NODE_W, height: NODE_H, parentId: l.parentId,  data: { id: n.id, kind: n.kind, label: n.label, direction: l.direction ?? diagram.direction, tone: toneFor(n.id, ids), service: n.attrs["service"] } });
      }
      pendingFit.current = true;
      nodesRef.current = next;
      setNodes(next);
      const outSeen = new Map<string, number>();
      setEdges(
        diagram.edges.map((e, i) => ({
          id: `${e.from}>${e.to}#${i}`,
          source: e.style === "back" ? e.to : e.from,
          target: e.style === "back" ? e.from : e.to,
          type: "flow",
          data: {
            key: edgeKey(e.style === "back" ? { ...e, from: e.to, to: e.from } : e),
            label: e.label,
            style: e.style,
            tone: toneFor(e.style === "back" ? e.to : e.from, diagram.nodes.map((n) => n.id)),
            toTone: toneFor(e.style === "back" ? e.from : e.to, diagram.nodes.map((n) => n.id)),
            outIndex: (() => {
              const src = e.style === "back" ? e.to : e.from;
              const n = outSeen.get(src) ?? 0;
              outSeen.set(src, n + 1);
              return n;
            })(),
          },
        })),
      );
      refit();
    });
  }, [diagram, revision, viewLayout, refit]);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // Trailing debounce: the sidebars animate their width, so wait for the last size.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => refit(), 180);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [refit]);

  const fitGroups = useCallback((all: RFNode[]): RFNode[] => {
    const PAD = { top: 40, left: 16, right: 16, bottom: 16 };
    const byId = new Map(all.map((n) => [n.id, n]));
    let changed = false;
    const next = new Map(byId);
    for (const g of all) {
      if (g.type !== "group") continue;
      const kids = all.filter((n) => n.parentId === g.id);
      if (kids.length === 0) continue;
      const minX = Math.min(...kids.map((k) => k.position.x)) - PAD.left;
      const minY = Math.min(...kids.map((k) => k.position.y)) - PAD.top;
      const maxX = Math.max(...kids.map((k) => k.position.x + (k.width ?? NODE_W))) + PAD.right;
      const maxY = Math.max(...kids.map((k) => k.position.y + (k.height ?? NODE_H))) + PAD.bottom;
      const dx = Math.min(0, minX);
      const dy = Math.min(0, minY);
      const w = Math.max(maxX, g.width ?? 0) - dx;
      const h = Math.max(maxY, g.height ?? 0) - dy;
      if (dx !== 0 || dy !== 0 || w !== g.width || h !== g.height) {
        changed = true;
        next.set(g.id, { ...g, position: { x: g.position.x + dx, y: g.position.y + dy }, width: w, height: h } as RFNode);
        if (dx !== 0 || dy !== 0)
          for (const k of kids) next.set(k.id, { ...k, position: { x: k.position.x - dx, y: k.position.y - dy } } as RFNode);
      }
    }
    return changed ? [...next.values()] : all;
  }, []);

  // Centre on a node when the layer list (or a tool) asks for focus. Uses our
  // own geometry (absolute position from the parent chain) so it is exact.
  useEffect(() => {
    if (!focusNonce || !selectedId) return;
    const all = nodesRef.current;
    const byId = new Map(all.map((n) => [n.id, n]));
    const target = byId.get(selectedId);
    if (!target) return;
    const abs = (n: RFNode): { x: number; y: number } => {
      const p = n.parentId ? byId.get(n.parentId) : undefined;
      if (!p) return n.position;
      const pp = abs(p);
      return { x: pp.x + n.position.x, y: pp.y + n.position.y };
    };
    const { x, y } = abs(target);
    const w = target.width ?? NODE_W;
    const h = target.height ?? NODE_H;
    const t = setTimeout(() => setCenter(x + w / 2, y + h / 2, { zoom: target.type === "group" ? 0.8 : 1.1, duration: document.visibilityState === "visible" ? 350 : 0 }), 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  // Fit once React has committed a freshly laid-out node set (layout mode or
  // document change). Calling fitView before the commit measures stale nodes.
  useEffect(() => {
    if (!pendingFit.current || !nodesInitialized) return;
    pendingFit.current = false;
    // Two passes: once now that every node is measured, once after the
    // sidebars' width springs have settled.
    fitAll(250);
    const t = setTimeout(() => fitAll(200), 500);
    return () => clearTimeout(t);
  }, [nodes, nodesInitialized, fitAll]);

  const withSelection = useMemo(() => nodes.map((n) => ({ ...n, selected: n.id === selectedId })), [nodes, selectedId]);

  const isValidConnection: IsValidConnection = useCallback(
    (c) => {
      if (!c.source || !c.target || c.source === c.target) return false;
      const d = studio.get().diagram;
      return !d.edges.some((e) => e.from === c.source && e.to === c.target);
    },
    [],
  );

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target) return;
    const { diagram: d, errors } = applyPatch(studio.get().diagram, [{ op: "add_edge", from: c.source, to: c.target }]);
    if (errors.length === 0) studio.setDiagram(d);
  }, []);

  const onNodesDelete = useCallback((deleted: Node[]) => {
    const d0 = studio.get().diagram;
    const ops = deleted.map((n) => (d0.groups.some((g) => g.id === n.id) ? ({ op: "remove_group", id: n.id } as const) : ({ op: "remove_node", id: n.id } as const)));
    const { diagram: d } = applyPatch(d0, ops);
    studio.setDiagram(d);
    studio.select(null);
  }, []);

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    const ops = deleted.map((e) => ({ op: "remove_edge", from: e.source, to: e.target }) as const);
    const { diagram: d } = applyPatch(studio.get().diagram, ops);
    studio.setDiagram(d);
  }, []);

  return (
    <div ref={containerRef} className="h-full w-full">
      <ReactFlow
        colorMode={theme}
        nodes={withSelection}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={() => {
          // First paint: the sidebars are still springing to their width, so fit
          // a few times while the container settles.
          for (const ms of [100, 400, 900, 1600]) setTimeout(() => fitAll(200), ms);
        }}
        onNodesChange={(changes) => {
          for (const c of changes) {
            if (c.type === "select") studio.select(c.selected ? c.id : studio.get().selectedId === c.id ? null : studio.get().selectedId);
          }
          setNodes((prev) => {
            let changed = false;
            const map = new Map(prev.map((n) => [n.id, n]));
            for (const c of changes) {
              if (c.type === "position" && c.position) {
                const n = map.get(c.id);
                if (n) {
                  map.set(c.id, { ...n, position: c.position } as RFNode);
                  changed = true;
                }
              }
            }
            return changed ? [...map.values()] : prev;
          });
        }}
        onNodeDoubleClick={(_, n) => {
          studio.select(n.id);
          studio.setPanel("inspect");
        }}
        onPaneClick={() => studio.select(null)}
        onNodeDragStop={() => setNodes((prev) => { const next = fitGroups(prev); nodesRef.current = next; return next; })}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        deleteKeyCode={["Backspace", "Delete"]}
        nodesConnectable
        connectionRadius={28}
        minZoom={0.2}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        className="bg-surface-1"
        style={{ background: "var(--surface-1)" }}
      >
        <svg style={{ position: "absolute", width: 0, height: 0 }} aria-hidden>
          <defs>
            <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="color-mix(in oklab, var(--foreground) 45%, transparent)" />
            </marker>
          </defs>
        </svg>
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--muted-foreground)" style={{ opacity: 0.35 }} />
        <Controls showInteractive={false} className="!shadow-surface-2">
          <LayoutControls />
          <EdgeStyleControls />
        </Controls>
        <MiniMap position="top-right" pannable zoomable className="!hidden lg:!block" nodeStrokeWidth={2} style={{ width: 140, height: 90 }} />
      </ReactFlow>
    </div>
  );
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
