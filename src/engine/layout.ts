/**
 * Auto-layout with ELK (layered algorithm, compound nodes for groups).
 *
 * Returns positions in React Flow's model: children carry a `parentId` and a
 * position relative to their parent, which is exactly how ELK reports them.
 */
import ELK, {
  type ElkExtendedEdge,
  type ElkNode,
} from "elkjs/lib/elk.bundled.js";
import type { Diagram, Direction } from "./dsl";

export const NODE_W = 240;
export const NODE_H = 68;
const GROUP_PAD = { top: 44, left: 16, right: 16, bottom: 16 };

export interface LaidOutNode {
  id: string;
  /** Flow direction for this node's handles; snake rows alternate. */
  direction?: Direction;
  x: number;
  y: number;
  width: number;
  height: number;
  parentId?: string;
  isGroup: boolean;
}

export interface Layout {
  nodes: LaidOutNode[];
  width: number;
  height: number;
}

const ELK_DIRECTION: Record<Direction, string> = {
  right: "RIGHT",
  down: "DOWN",
  left: "LEFT",
  up: "UP",
};

let elk: InstanceType<typeof ELK> | null = null;
function getElk() {
  elk ??= new ELK();
  return elk;
}

export async function layoutDiagram(
  diagram: Diagram,
  mode: "flow" | "snake" = "flow",
  viewport?: { width: number; height: number },
): Promise<Layout> {
  const groupsById = new Map(diagram.groups.map((g) => [g.id, g] as const));

  const children = (scope: string | undefined): ElkNode[] => {
    const out: ElkNode[] = [];
    for (const g of diagram.groups) {
      if (g.parent !== scope) continue;
      out.push({
        id: g.id,
        layoutOptions: {
          "elk.padding": `[top=${GROUP_PAD.top},left=${GROUP_PAD.left},bottom=${GROUP_PAD.bottom},right=${GROUP_PAD.right}]`,
        },
        children: children(g.id),
      });
    }
    for (const n of diagram.nodes) {
      if (n.group !== scope) continue;
      out.push({ id: n.id, width: NODE_W, height: NODE_H });
    }
    return out;
  };

  const nodeIds = new Set(diagram.nodes.map((n) => n.id));
  const edges: ElkExtendedEdge[] = diagram.edges
    .filter(
      (e) =>
        (nodeIds.has(e.from) || groupsById.has(e.from)) &&
        (nodeIds.has(e.to) || groupsById.has(e.to)),
    )
    .map((e, i) => ({
      id: `e${i}`,
      sources: [e.style === "back" ? e.to : e.from],
      targets: [e.style === "back" ? e.from : e.to],
    }));

  const root: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": ELK_DIRECTION[diagram.direction],
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.layered.spacing.nodeNodeBetweenLayers": "56",
      "elk.spacing.nodeNode": "28",
      "elk.spacing.edgeNode": "24",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.edgeRouting": "ORTHOGONAL",
    },
    children: children(undefined),
    edges,
  };

  const result = await getElk().layout(root);
  const nodes: LaidOutNode[] = [];
  const visit = (n: ElkNode, parentId?: string) => {
    for (const c of n.children ?? []) {
      const isGroup = groupsById.has(c.id);
      nodes.push({
        id: c.id,
        x: c.x ?? 0,
        y: c.y ?? 0,
        width: c.width ?? NODE_W,
        height: c.height ?? NODE_H,
        parentId,
        isGroup,
      });
      if (isGroup) visit(c, c.id);
    }
  };
  visit(result);
  if (mode === "snake" && (diagram.direction === "right" || diagram.direction === "left")) return snake(nodes, viewport);
  return { nodes, width: result.width ?? 0, height: result.height ?? 0 };
}

/**
 * Wrap a left-to-right layered layout into a zigzag so a long chain fits a
 * wide-but-short canvas without zooming out. Top-level items (nodes and
 * whole groups) are clustered into columns by x, columns are dealt into rows
 * that fit the viewport width, and odd rows run right-to-left. Children keep
 * their positions relative to their group.
 */
function snake(all: LaidOutNode[], viewport?: { width: number; height: number }): Layout {
  const top = all.filter((n) => !n.parentId);
  if (top.length < 4) return { nodes: all, width: 0, height: 0 };
  const sorted = [...top].sort((a, b) => a.x - b.x);
  // Cluster into columns: a new column starts when x moves past the previous column's right edge.
  const columns: LaidOutNode[][] = [];
  let colRight = -Infinity;
  for (const n of sorted) {
    if (n.x >= colRight - 1 || columns.length === 0) {
      columns.push([n]);
      colRight = n.x + n.width;
    } else {
      columns[columns.length - 1].push(n);
      colRight = Math.max(colRight, n.x + n.width);
    }
  }
  const GAP_X = 72;
  const GAP_Y = 96;
  const colWidth = (c: LaidOutNode[]) => Math.max(...c.map((n) => n.width));
  const colHeight = (c: LaidOutNode[]) => {
    const minY = Math.min(...c.map((n) => n.y));
    const maxY = Math.max(...c.map((n) => n.y + n.height));
    return maxY - minY;
  };
  // Row capacity from the viewport aspect: aim for rows roughly as wide as the canvas at zoom 1.
  const targetWidth = Math.max(640, (viewport?.width ?? 1200) - 80);
  const rows: LaidOutNode[][][] = [];
  let row: LaidOutNode[][] = [];
  let rowW = 0;
  for (const c of columns) {
    const w = colWidth(c) + (row.length ? GAP_X : 0);
    if (row.length > 0 && rowW + w > targetWidth) {
      rows.push(row);
      row = [];
      rowW = 0;
    }
    row.push(c);
    rowW += w;
  }
  if (row.length) rows.push(row);
  if (rows.length < 2) return { nodes: all, width: 0, height: 0 };

  const out = new Map(all.map((n) => [n.id, { ...n }]));
  let y = 0;
  let totalW = 0;
  rows.forEach((cols, r) => {
    const reverse = r % 2 === 1;
    const rowH = Math.max(...cols.map(colHeight));
    const widths = cols.map(colWidth);
    const rowW = widths.reduce((s, w) => s + w, 0) + GAP_X * (cols.length - 1);
    totalW = Math.max(totalW, rowW);
    // Odd rows run right-to-left, aligned to the right edge so the chain bends back.
    let x = reverse ? rowW : 0;
    cols.forEach((c, i) => {
      const w = widths[i];
      const left = reverse ? x - w : x;
      const minY = Math.min(...c.map((n) => n.y));
      const h = colHeight(c);
      for (const n of c) {
        const o = out.get(n.id)!;
        o.x = left + (w - n.width) / 2;
        o.y = y + (rowH - h) / 2 + (n.y - minY);
        o.direction = reverse ? "left" : "right";
      }
      x = reverse ? left - GAP_X : x + w + GAP_X;
    });
    y += rowH + GAP_Y;
  });
  // Children inherit their group's direction so handles face the right way.
  for (const n of out.values()) if (n.parentId) n.direction = out.get(n.parentId)?.direction ?? n.direction;
  return { nodes: [...out.values()], width: totalW, height: y - GAP_Y };
}
