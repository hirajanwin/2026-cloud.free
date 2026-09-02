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
  getSmoothStepPath,
  useReactFlow,
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
  const mode =
    role === "gate" ? (protection ?? defaultProtection(data.kind)) : null;

  return (
    <div
      className={[
        "group/node relative flex h-[60px] w-[172px] items-center gap-2.5 rounded-xl bg-surface-3 px-3 text-left shadow-surface-2 transition-[box-shadow,background-color] duration-150",
        selected
          ? "ring-1 ring-foreground/60 shadow-surface-4"
          : "hover:shadow-surface-3",
        gap?.severity === "missing"
          ? "outline outline-1 outline-dashed outline-destructive/60"
          : "",
      ].join(" ")}
      style={{ width: NODE_W, height: NODE_H }}
    >
      <Handle
        type="target"
        position={pos.target}
        className="!h-2 !w-2 !border !border-foreground/40 !bg-surface-1"
      />
      <Handle
        type="source"
        position={pos.source}
        className="!h-2 !w-2 !border !border-foreground/40 !bg-surface-1"
      />
      <div
        className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${role === "gate" ? "bg-info-light text-info" : role === "cache" ? "bg-success-light text-success" : role === "store" ? "bg-muted text-foreground" : "bg-muted text-foreground"}`}
      >
        <Glyph kind={data.kind} size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div
          className="truncate text-[12.5px] font-medium leading-4 text-foreground"
          style={{ fontVariationSettings: "'wght' 550, 'opsz' 18" }}
        >
          {data.label ?? product?.name ?? data.kind}
        </div>
        <div className="truncate text-[11px] leading-4 text-muted-foreground">
          {product?.name ?? data.kind}
        </div>
        {role !== "source" && (
          <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] leading-3 text-numeric text-muted-foreground">
            <span>{formatCount(arrivals)}/d</span>
            {blocked > 0 && (
              <span className="text-destructive">−{formatCount(blocked)}</span>
            )}
            {dropped > 0 && (
              <span className="text-warning">✕{formatCount(dropped)}</span>
            )}
            {role === "cache" && answered > 0 && arrivals > 0 && (
              <span className="text-success">
                {Math.round((answered / arrivals) * 100)}% hit
              </span>
            )}
          </div>
        )}
        {role === "source" && rates && (
          <div className="mt-0.5 text-[10.5px] leading-3 text-numeric text-muted-foreground">
            {formatCount(arrivals)} req/day
          </div>
        )}
      </div>
      {mode && (
        <span
          className={`absolute -top-2 right-2 rounded-full px-1.5 py-px text-[9.5px] leading-3 shadow-surface-1 ${mode === "off" ? "bg-surface-2 text-muted-foreground" : "bg-info-light text-info"}`}
          title={PROTECTION_MODE_LABEL[mode]}
        >
          {mode === "off" ? "off" : mode}
        </span>
      )}
      {cap && (
        <span
          className="absolute -bottom-2 right-2 rounded-full bg-warning-light px-1.5 py-px text-[9.5px] leading-3 text-warning shadow-surface-1"
          title={`Free plan cap: ${Math.round(cap.fraction * 100)}% served`}
        >
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
}: NodeProps<Node<GroupNodeData, "group">>) {
  return (
    <div
      className="h-full w-full rounded-2xl border border-dashed border-foreground/15 bg-surface-2/60"
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
  human: "var(--foreground)",
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
      ? 1
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
        style={{
          stroke,
          strokeWidth: width,
          opacity: isAnnotation ? 0.5 : total > 0 ? 0.8 : 0.35,
          strokeDasharray: isAnnotation ? "3 4" : undefined,
        }}
      />
      {!isAnnotation && total > 0 && (
        <path
          d={path}
          fill="none"
          stroke={stroke}
          strokeWidth={width}
          strokeDasharray="6 10"
          className="flow-dash"
          style={{ animationDuration: `${duration}s`, opacity: 0.9 }}
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
const edgeTypes = { flow: FlowEdge };

/* ------------------------------------------------------------------ */

function CanvasInner() {
  const diagram = useStudio((s) => s.diagram);
  const revision = useStudio((s) => s.revision);
  const selectedId = useStudio((s) => s.selectedId);
  const [nodes, setNodes] = useState<RFNode[]>([]);
  const [edges, setEdges] = useState<RFEdge[]>([]);
  const { fitView } = useReactFlow();
  const layoutRun = useRef(0);

  const refit = useCallback(() => {
    // Two frames: one for React to commit the nodes, one for React Flow to measure them.
    requestAnimationFrame(() => requestAnimationFrame(() => fitView({ padding: 0.12, duration: 250 })));
    // First paint: React Flow may not have measured the viewport yet.
    setTimeout(() => fitView({ padding: 0.12, duration: 200 }), 400);
  }, [fitView]);

  useEffect(() => {
    const run = ++layoutRun.current;
    layoutDiagram(diagram).then((layout) => {
      if (run !== layoutRun.current) return;
      const byId = new Map(layout.nodes.map((n) => [n.id, n]));
      const next: RFNode[] = [];
      // Groups first so React Flow has parents before children.
      for (const g of diagram.groups) {
        const l = byId.get(g.id);
        if (!l) continue;
        next.push({
          id: g.id,
          type: "group",
          position: { x: l.x, y: l.y },
          width: l.width,
          height: l.height,
          parentId: l.parentId,
          data: { id: g.id, label: g.label },
          selectable: true,
          draggable: false,
          zIndex: -1,
        });
      }
      for (const n of diagram.nodes) {
        const l = byId.get(n.id);
        if (!l) continue;
        next.push({
          id: n.id,
          type: "product",
          position: { x: l.x, y: l.y },
          width: NODE_W,
          height: NODE_H,
          parentId: l.parentId,
          extent: l.parentId ? "parent" : undefined,
          data: { id: n.id, kind: n.kind, label: n.label, direction: diagram.direction },
        });
      }
      setNodes(next);
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
          },
        })),
      );
      refit();
    });
  }, [diagram, revision, refit]);

  // Refit when the canvas itself changes size (panel toggles, window resize).
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let last = 0;
    const ro = new ResizeObserver(() => {
      const now = performance.now();
      if (now - last < 200) return;
      last = now;
      refit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [refit]);

  const withSelection = useMemo(
    () => nodes.map((n) => ({ ...n, selected: n.id === selectedId })),
    [nodes, selectedId],
  );

  return (
    <div ref={containerRef} className="h-full w-full">
      <ReactFlow
        nodes={withSelection}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={() => refit()}
        onNodesChange={(changes) => {
          for (const c of changes) {
            if (c.type === "select") studio.select(c.selected ? c.id : studio.get().selectedId === c.id ? null : studio.get().selectedId);
          }
          // Allow dragging for manual nudges; layout re-runs on document change.
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
        onPaneClick={() => studio.select(null)}
        minZoom={0.2}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        deleteKeyCode={null}
        className="bg-surface-1"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls showInteractive={false} className="!shadow-surface-2" />
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
