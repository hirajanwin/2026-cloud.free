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
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getSmoothStepPath,
  useReactFlow,
  useNodesInitialized,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { KINDS, PRODUCTS, isProductKind } from "@/engine/catalog";
import type { Direction } from "@/engine/dsl";
import { layoutDiagram, NODE_H, NODE_W } from "@/engine/layout";
import { defaultProtection, edgeKey } from "@/engine/sim";
import { PROTECTION_MODE_LABEL, REQUEST_CLASSES } from "@/engine/types";
import { formatCount } from "@/lib/format";
import { studio, useStudio } from "@/state/store";
import { applyPatch } from "@/engine/dsl";
import { useResolvedTheme } from "@/lib/use-resolved-theme";
import { type Connection, type IsValidConnection } from "@xyflow/react";
import { Glyph } from "./Glyph";

type ProductNodeData = {
  id: string;
  kind: string;
  label?: string;
  direction: Direction;
};
type GroupNodeData = { id: string; label?: string };
type FlowEdgeData = { key: string; label?: string; style: string };

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
  const title = data.label ?? product?.name ?? data.kind;
  const subtitle = data.label ? (product?.name ?? data.kind) : (isProductKind(data.kind) ? KINDS[data.kind].name : data.kind);

  const iconTone =
    role === "gate"
      ? "bg-info-light text-info"
      : role === "cache"
        ? "bg-success-light text-success"
        : role === "source"
          ? "bg-muted text-foreground"
          : "bg-muted text-foreground";

  return (
    <div
      className={[
        "node-in group/node relative grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-xl bg-surface-3 px-3 shadow-surface-2 transition-[box-shadow,background-color] duration-150",
        selected ? "ring-1 ring-foreground/70 shadow-surface-4" : "hover:shadow-surface-3",
        gap?.severity === "missing" ? "outline outline-1 outline-dashed outline-destructive/60" : "",
      ].join(" ")}
      style={{ width: NODE_W, height: NODE_H }}
    >
      <Handle type="target" position={pos.target} className="!h-2.5 !w-2.5 !border-2 !border-foreground/60 !bg-surface-1" />
      <Handle type="source" position={pos.source} className="!h-2.5 !w-2.5 !border-2 !border-foreground/60 !bg-surface-1" />

      <div className={`flex size-9 items-center justify-center rounded-lg ${iconTone}`}>
        <Glyph kind={data.kind} size={19} />
      </div>

      <div className="min-w-0">
        <div className="truncate text-[13px] leading-[18px] text-foreground" style={{ fontVariationSettings: "'wght' 550, 'opsz' 18" }} title={title}>
          {title}
        </div>
        <div className="truncate text-[11px] leading-[16px] text-muted-foreground" title={subtitle}>
          {subtitle}
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
      className={`group-shell h-full w-full rounded-2xl border border-dashed bg-surface-2/70 transition-[border-color,box-shadow] duration-150 ${selected ? "border-foreground/50 shadow-surface-3" : "border-foreground/20"}`}
      style={{ width, height }}
    >
      <div className="px-3 pt-2 text-caption font-medium text-muted-foreground">
        {data.label ?? data.id}
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */

const CLASS_COLOR: Record<string, string> = {
  human: "var(--success)",
  googlebot: "var(--info)",
  "ai-crawler": "var(--warning)",
  scraper: "var(--destructive)",
  botnet: "var(--destructive)",
};

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
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 10,
  });
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
  // Dominant class colours the edge so a botnet path reads red before you look at numbers.
  let dominant = "human";
  if (flow)
    for (const c of REQUEST_CLASSES)
      if (flow[c] > (flow[dominant as keyof typeof flow] ?? 0)) dominant = c;
  const stroke = isAnnotation
    ? "var(--muted-foreground)"
    : total > 0
      ? CLASS_COLOR[dominant]
      : "var(--muted-foreground)";

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={isAnnotation ? undefined : "url(#flow-arrow)"}
        style={{
          stroke: isAnnotation ? "var(--muted-foreground)" : "color-mix(in oklab, var(--foreground) 28%, transparent)",
          strokeWidth: width + 0.5,
          strokeDasharray: isAnnotation ? "3 4" : undefined,
        }}
      />
      {!isAnnotation && total > 0 && (
        <path
          d={path}
          fill="none"
          stroke={stroke}
          strokeWidth={width}
          strokeDasharray="7 11"
          className="flow-dash"
          style={{ animationDuration: `${duration}s`, opacity: 1 }}
        />
      )}
      {(data?.label || (total > 0 && selected)) && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded-md bg-surface-3 px-1.5 py-0.5 text-[10px] leading-3 text-muted-foreground shadow-surface-1"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
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

/** Horizontal, vertical, or snake. The first two write the DSL direction; snake is a view. */
function LayoutToggle() {
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
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-surface-3 p-0.5 shadow-surface-2" role="radiogroup" aria-label="Canvas layout">
      {(
        [
          ["horizontal", "Horizontal", "M4 12h16M14 6l6 6-6 6"],
          ["vertical", "Vertical", "M12 4v16M6 14l6 6 6-6"],
          ["snake", "Snake", "M4 6h12a3 3 0 0 1 0 6H8a3 3 0 0 0 0 6h12"],
        ] as const
      ).map(([m, label, d]) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          title={`${label} layout`}
          onClick={() => set(m)}
          className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] transition-colors ${mode === m ? "bg-surface-5 text-foreground shadow-surface-1" : "text-muted-foreground hover:bg-hover hover:text-foreground"}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={d} />
          </svg>
          {label}
        </button>
      ))}
    </div>
  );
}
const edgeTypes = { flow: FlowEdge };

/* ------------------------------------------------------------------ */

function CanvasInner() {
  const diagram = useStudio((s) => s.diagram);
  const revision = useStudio((s) => s.revision);
  const viewLayout = useStudio((s) => s.viewLayout);
  const selectedId = useStudio((s) => s.selectedId);
  const theme = useResolvedTheme();
  const [nodes, setNodes] = useState<RFNode[]>([]);
  const [edges, setEdges] = useState<RFEdge[]>([]);
  const { fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const layoutRun = useRef(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pendingFit = useRef(false);

  const refit = useCallback(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => fitView({ padding: 0.12, duration: 250 })));
    setTimeout(() => fitView({ padding: 0.12, duration: 200 }), 400);
    setTimeout(() => fitView({ padding: 0.12, duration: 200 }), 900);
  }, [fitView]);

  useEffect(() => {
    const run = ++layoutRun.current;
    const el = containerRef.current;
    layoutDiagram(diagram, viewLayout, el ? { width: el.clientWidth, height: el.clientHeight } : undefined).then((layout) => {
      if (run !== layoutRun.current) return;
      const byId = new Map(layout.nodes.map((n) => [n.id, n]));
      const next: RFNode[] = [];
      for (const g of diagram.groups) {
        const l = byId.get(g.id);
        if (!l) continue;
        next.push({ id: g.id, type: "group", position: { x: l.x, y: l.y }, width: l.width, height: l.height, parentId: l.parentId, data: { id: g.id, label: g.label }, selectable: true, draggable: false, connectable: false, zIndex: -1 });
      }
      for (const n of diagram.nodes) {
        const l = byId.get(n.id);
        if (!l) continue;
        next.push({ id: n.id, type: "product", position: { x: l.x, y: l.y }, width: NODE_W, height: NODE_H, parentId: l.parentId,  data: { id: n.id, kind: n.kind, label: n.label, direction: l.direction ?? diagram.direction } });
      }
      pendingFit.current = true;
      setNodes(next);
      setEdges(
        diagram.edges.map((e, i) => ({
          id: `${e.from}>${e.to}#${i}`,
          source: e.style === "back" ? e.to : e.from,
          target: e.style === "back" ? e.from : e.to,
          type: "flow",
          data: { key: edgeKey(e.style === "back" ? { ...e, from: e.to, to: e.from } : e), label: e.label, style: e.style },
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

  // Fit once React has committed a freshly laid-out node set (layout mode or
  // document change). Calling fitView before the commit measures stale nodes.
  useEffect(() => {
    if (!pendingFit.current || !nodesInitialized) return;
    pendingFit.current = false;
    // Two passes: once now that every node is measured, once after the
    // sidebars' width springs have settled.
    fitView({ padding: 0.12, duration: 250 });
    const t = setTimeout(() => fitView({ padding: 0.12, duration: 200 }), 500);
    return () => clearTimeout(t);
  }, [nodes, nodesInitialized, fitView]);

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
          for (const ms of [100, 400, 900, 1600]) setTimeout(() => fitView({ padding: 0.12, duration: 200 }), ms);
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
        onNodeDragStop={() => setNodes((prev) => fitGroups(prev))}
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
        <Controls showInteractive={false} className="!shadow-surface-2" />
        <Panel position="top-left">
          <LayoutToggle />
        </Panel>
        <MiniMap pannable zoomable className="!hidden lg:!block" nodeStrokeWidth={2} />
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
