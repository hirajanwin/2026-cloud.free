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

export async function layoutDiagram(diagram: Diagram): Promise<Layout> {
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
  return { nodes, width: result.width ?? 0, height: result.height ?? 0 };
}
