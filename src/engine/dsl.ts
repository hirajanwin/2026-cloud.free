/**
 * The diagram DSL. This text is the document: the canvas, the simulator, the
 * exports and every agent tool read and write it. Nothing else is the source
 * of truth.
 *
 * Grammar (one statement per line, `//` comments allowed):
 *
 *   direction right | down | left | up
 *   title "Granola on Cloudflare"
 *   provider cloudflare | vercel
 *
 *   id [kind: compute, label: "API", key: value]     a node
 *   groupId "Label" {                                  a group (nestable)
 *     ...nodes / groups...
 *   }
 *   a > b: "label" [ops: 3]                            an edge
 *   a > b, c, d                                        one-to-many
 *
 * Connectors:  >  <  <>  -  --  -->
 *
 * `kind` is the generic product kind (see catalog.ts). If omitted and the id
 * itself is a kind name, that is used. Attribute values are bare words,
 * numbers or double-quoted strings. The printer emits a canonical form so
 * parse(print(parse(x))) is stable; that property is tested.
 */

export type Direction = "right" | "down" | "left" | "up";
export type Provider = "cloudflare" | "vercel";
export type EdgeStyle =
  "arrow" | "back" | "both" | "line" | "dotted" | "dotted-arrow";

export type AttrValue = string | number | boolean;
export type Attrs = Record<string, AttrValue>;

export interface DiagramNode {
  id: string;
  /** Generic product kind. Validated against the catalog by callers, not here. */
  kind: string;
  label?: string;
  /** Enclosing group id, if any. */
  group?: string;
  attrs: Attrs;
}

export interface DiagramGroup {
  id: string;
  label?: string;
  parent?: string;
  attrs: Attrs;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
  style: EdgeStyle;
  attrs: Attrs;
}

export interface Diagram {
  direction: Direction;
  title?: string;
  provider?: Provider;
  nodes: DiagramNode[];
  groups: DiagramGroup[];
  edges: DiagramEdge[];
}

export interface ParseError {
  line: number;
  message: string;
}

export interface ParseResult {
  diagram: Diagram;
  errors: ParseError[];
}

const CONNECTORS: ReadonlyArray<[token: string, style: EdgeStyle]> = [
  // Longest first so `-->` is not read as `--` + `>`.
  ["-->", "dotted-arrow"],
  ["<>", "both"],
  ["--", "dotted"],
  [">", "arrow"],
  ["<", "back"],
  ["-", "line"],
];

const CONNECTOR_TOKEN: Record<EdgeStyle, string> = {
  arrow: ">",
  back: "<",
  both: "<>",
  line: "-",
  dotted: "--",
  "dotted-arrow": "-->",
};

const ID_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

export function emptyDiagram(): Diagram {
  return { direction: "right", nodes: [], groups: [], edges: [] };
}

/* ------------------------------------------------------------------ *
 * Parser
 * ------------------------------------------------------------------ */

export function parse(source: string): ParseResult {
  const diagram = emptyDiagram();
  const errors: ParseError[] = [];
  const groupStack: string[] = [];
  const lines = source.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const raw = stripComment(lines[i] ?? "").trim();
    if (raw === "") continue;

    if (raw === "}") {
      if (groupStack.length === 0)
        errors.push({ line: lineNo, message: "Unmatched `}`" });
      else groupStack.pop();
      continue;
    }

    const keyword = raw.match(/^(direction|title|provider)\s+(.+)$/);
    if (keyword) {
      const [, key, value] = keyword;
      if (key === "direction") {
        if (isDirection(value)) diagram.direction = value;
        else
          errors.push({
            line: lineNo,
            message: `Unknown direction "${value}"`,
          });
      } else if (key === "title") {
        diagram.title = unquote(value.trim());
      } else if (key === "provider") {
        const p = value.trim();
        if (p === "cloudflare" || p === "vercel") diagram.provider = p;
        else errors.push({ line: lineNo, message: `Unknown provider "${p}"` });
      }
      continue;
    }

    // Group open:  id "Label" [attrs] {
    if (raw.endsWith("{")) {
      const head = raw.slice(0, -1).trim();
      const parsed = parseHead(head, lineNo, errors);
      if (parsed) {
        const parent = groupStack[groupStack.length - 1];
        diagram.groups.push({
          id: parsed.id,
          label: parsed.label,
          parent,
          attrs: parsed.attrs,
        });
        groupStack.push(parsed.id);
      } else {
        // Keep nesting balanced so a bad header does not swallow the file.
        groupStack.push(`__bad_${lineNo}`);
      }
      continue;
    }

    // Edge: contains a connector token surrounded by whitespace.
    const edge = findConnector(raw);
    if (edge) {
      parseEdge(raw, edge, lineNo, diagram, errors);
      continue;
    }

    // Node: id [attrs]
    const node = parseHead(raw, lineNo, errors);
    if (!node) continue;
    const kindAttr = node.attrs["kind"];
    const kind = typeof kindAttr === "string" ? kindAttr : node.id;
    delete node.attrs["kind"];
    if (diagram.nodes.some((n) => n.id === node.id)) {
      errors.push({ line: lineNo, message: `Duplicate node id "${node.id}"` });
      continue;
    }
    diagram.nodes.push({
      id: node.id,
      kind,
      label: node.label,
      group: groupStack[groupStack.length - 1],
      attrs: node.attrs,
    });
  }

  if (groupStack.length > 0) {
    errors.push({
      line: lines.length,
      message: `Unclosed group "${groupStack[groupStack.length - 1]}"`,
    });
  }

  // Edges may reference nodes declared later, so validate after the walk.
  const known = new Set([
    ...diagram.nodes.map((n) => n.id),
    ...diagram.groups.map((g) => g.id),
  ]);
  for (const e of diagram.edges) {
    if (!known.has(e.from))
      errors.push({
        line: 0,
        message: `Edge references unknown node "${e.from}"`,
      });
    if (!known.has(e.to))
      errors.push({
        line: 0,
        message: `Edge references unknown node "${e.to}"`,
      });
  }

  return { diagram, errors };
}

interface Head {
  id: string;
  label?: string;
  attrs: Attrs;
}

/** `id "Label" [k: v, k2: v2]` — label and attrs both optional. */
function parseHead(
  text: string,
  lineNo: number,
  errors: ParseError[],
): Head | null {
  let rest = text.trim();
  let attrs: Attrs = {};

  const bracket = rest.lastIndexOf("[");
  if (bracket !== -1) {
    if (!rest.endsWith("]")) {
      errors.push({ line: lineNo, message: "Unterminated `[`" });
      return null;
    }
    attrs = parseAttrs(rest.slice(bracket + 1, -1), lineNo, errors);
    rest = rest.slice(0, bracket).trim();
  }

  let label: string | undefined;
  const quoted = rest.match(/^(\S+)\s+"((?:[^"\\]|\\.)*)"$/);
  if (quoted) {
    rest = quoted[1];
    label = unescape(quoted[2]);
  }

  if (!ID_RE.test(rest)) {
    errors.push({ line: lineNo, message: `Invalid identifier "${rest}"` });
    return null;
  }

  const labelAttr = attrs["label"];
  if (typeof labelAttr === "string") {
    label = labelAttr;
    delete attrs["label"];
  }

  return { id: rest, label, attrs };
}

function parseAttrs(body: string, lineNo: number, errors: ParseError[]): Attrs {
  const attrs: Attrs = {};
  for (const part of splitTopLevel(body, ",")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) {
      // Bare flag: `[gate]`
      if (ID_RE.test(trimmed)) attrs[trimmed] = true;
      else errors.push({ line: lineNo, message: `Bad attribute "${trimmed}"` });
      continue;
    }
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    if (!ID_RE.test(key)) {
      errors.push({ line: lineNo, message: `Bad attribute key "${key}"` });
      continue;
    }
    attrs[key] = parseValue(value);
  }
  return attrs;
}

function parseValue(value: string): AttrValue {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return unquote(value);
}

function findConnector(
  line: string,
): { index: number; token: string; style: EdgeStyle } | null {
  // Only match connectors that are delimited by whitespace so ids containing
  // `-` (allowed) are not split.
  for (const [token, style] of CONNECTORS) {
    const re = new RegExp(`\\s${escapeRegExp(token)}\\s`);
    const m = re.exec(line);
    if (m) return { index: m.index + 1, token, style };
  }
  return null;
}

function parseEdge(
  line: string,
  conn: { index: number; token: string; style: EdgeStyle },
  lineNo: number,
  diagram: Diagram,
  errors: ParseError[],
) {
  const left = line.slice(0, conn.index).trim();
  let right = line.slice(conn.index + conn.token.length).trim();

  let attrs: Attrs = {};
  const bracket = right.lastIndexOf("[");
  if (bracket !== -1 && right.endsWith("]")) {
    attrs = parseAttrs(right.slice(bracket + 1, -1), lineNo, errors);
    right = right.slice(0, bracket).trim();
  }

  let label: string | undefined;
  const colon = findLabelColon(right);
  if (colon !== -1) {
    label = unquote(right.slice(colon + 1).trim());
    right = right.slice(0, colon).trim();
  }

  if (!ID_RE.test(left)) {
    errors.push({ line: lineNo, message: `Invalid edge source "${left}"` });
    return;
  }
  const targets = right
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (targets.length === 0) {
    errors.push({ line: lineNo, message: "Edge has no target" });
    return;
  }
  for (const target of targets) {
    if (!ID_RE.test(target)) {
      errors.push({ line: lineNo, message: `Invalid edge target "${target}"` });
      continue;
    }
    diagram.edges.push({
      from: left,
      to: target,
      label,
      style: conn.style,
      attrs: { ...attrs },
    });
  }
}

/** The first `:` outside quotes; ids cannot contain `:` so this is safe. */
function findLabelColon(text: string): number {
  let inQuote = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"' && text[i - 1] !== "\\") inQuote = !inQuote;
    else if (ch === ":" && !inQuote) return i;
  }
  return -1;
}

function splitTopLevel(text: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"' && text[i - 1] !== "\\") inQuote = !inQuote;
    if (ch === sep && !inQuote) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function stripComment(line: string): string {
  let inQuote = false;
  for (let i = 0; i < line.length - 1; i += 1) {
    const ch = line[i];
    if (ch === '"' && line[i - 1] !== "\\") inQuote = !inQuote;
    else if (!inQuote && ch === "/" && line[i + 1] === "/")
      return line.slice(0, i);
  }
  return line;
}

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"'))
    return unescape(v.slice(1, -1));
  return v;
}

function unescape(value: string): string {
  return value.replace(/\\(["\\])/g, "$1");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isDirection(v: string): v is Direction {
  return v === "right" || v === "down" || v === "left" || v === "up";
}

/* ------------------------------------------------------------------ *
 * Printer
 * ------------------------------------------------------------------ */

export function print(diagram: Diagram): string {
  const out: string[] = [];
  out.push(`direction ${diagram.direction}`);
  if (diagram.title) out.push(`title ${quote(diagram.title)}`);
  if (diagram.provider) out.push(`provider ${diagram.provider}`);
  out.push("");

  const byGroup = new Map<string | undefined, DiagramNode[]>();
  for (const n of diagram.nodes) {
    const list = byGroup.get(n.group) ?? [];
    list.push(n);
    byGroup.set(n.group, list);
  }
  const childGroups = new Map<string | undefined, DiagramGroup[]>();
  for (const g of diagram.groups) {
    const list = childGroups.get(g.parent) ?? [];
    list.push(g);
    childGroups.set(g.parent, list);
  }

  // Preserve document order. A group's position is that of its first
  // descendant node; groups with no nodes trail. This makes
  // parse(print(parse(x))) return nodes in the same order as parse(x).
  const nodeIndex = new Map(diagram.nodes.map((n, i) => [n.id, i] as const));
  const groupIndex = new Map(diagram.groups.map((g, i) => [g.id, i] as const));
  const parentOf = new Map(
    diagram.groups.map((g) => [g.id, g.parent] as const),
  );
  const firstNodeIn = (gid: string): number => {
    let best = Number.POSITIVE_INFINITY;
    for (const n of diagram.nodes) {
      let g = n.group;
      while (g) {
        if (g === gid) {
          best = Math.min(best, nodeIndex.get(n.id) ?? best);
          break;
        }
        g = parentOf.get(g);
      }
    }
    return best;
  };
  const groupKey = new Map(
    diagram.groups.map((g) => [g.id, firstNodeIn(g.id)] as const),
  );

  const emitScope = (scope: string | undefined, indent: string) => {
    type Item = {
      key: number;
      tie: number;
      node?: DiagramNode;
      group?: DiagramGroup;
    };
    const items: Item[] = [];
    for (const n of byGroup.get(scope) ?? [])
      items.push({ key: nodeIndex.get(n.id) ?? 0, tie: 0, node: n });
    for (const g of childGroups.get(scope) ?? [])
      items.push({
        key: groupKey.get(g.id) ?? Number.POSITIVE_INFINITY,
        tie: 1 + (groupIndex.get(g.id) ?? 0),
        group: g,
      });
    items.sort((a, b) => a.key - b.key || a.tie - b.tie);
    for (const it of items) {
      if (it.node) out.push(indent + printNode(it.node));
      else if (it.group) {
        out.push(indent + printGroupHead(it.group) + " {");
        emitScope(it.group.id, indent + "  ");
        out.push(indent + "}");
      }
    }
  };
  emitScope(undefined, "");

  if (diagram.edges.length > 0) out.push("");
  for (const e of diagram.edges) out.push(printEdge(e));

  return out.join("\n") + "\n";
}

function printNode(n: DiagramNode): string {
  const attrs: Attrs = {
    kind: n.kind,
    ...(n.label ? { label: n.label } : {}),
    ...n.attrs,
  };
  return `${n.id} ${printAttrs(attrs)}`;
}

function printGroupHead(g: DiagramGroup): string {
  const label = g.label ? ` ${quote(g.label)}` : "";
  const attrs =
    Object.keys(g.attrs).length > 0 ? ` ${printAttrs(g.attrs)}` : "";
  return `${g.id}${label}${attrs}`;
}

function printEdge(e: DiagramEdge): string {
  const label = e.label ? `: ${quote(e.label)}` : "";
  const attrs =
    Object.keys(e.attrs).length > 0 ? ` ${printAttrs(e.attrs)}` : "";
  return `${e.from} ${CONNECTOR_TOKEN[e.style]} ${e.to}${label}${attrs}`;
}

function printAttrs(attrs: Attrs): string {
  const parts = Object.entries(attrs).map(([k, v]) => {
    if (v === true) return k;
    if (typeof v === "number" || v === false) return `${k}: ${String(v)}`;
    return `${k}: ${printValue(v)}`;
  });
  return `[${parts.join(", ")}]`;
}

function printValue(v: string): string {
  // Bare words survive round-tripping; anything else is quoted.
  if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(v) && v !== "true" && v !== "false")
    return v;
  return quote(v);
}

function quote(s: string): string {
  return `"${s.replace(/(["\\])/g, "\\$1")}"`;
}

/* ------------------------------------------------------------------ *
 * Patch operations. Agents prefer small, named edits over re-emitting the
 * whole document; each op is validated against the current diagram.
 * ------------------------------------------------------------------ */

export type PatchOp =
  | {
      op: "add_node";
      id: string;
      kind: string;
      label?: string;
      group?: string;
      attrs?: Attrs;
    }
  | { op: "remove_node"; id: string }
  | {
      op: "set_node";
      id: string;
      kind?: string;
      label?: string;
      group?: string | null;
      attrs?: Attrs;
    }
  | { op: "add_group"; id: string; label?: string; parent?: string }
  | { op: "remove_group"; id: string }
  | {
      op: "add_edge";
      from: string;
      to: string;
      label?: string;
      style?: EdgeStyle;
      attrs?: Attrs;
    }
  | { op: "remove_edge"; from: string; to: string }
  | { op: "set_direction"; direction: Direction }
  | { op: "set_title"; title: string }
  | { op: "set_provider"; provider: Provider };

export function applyPatch(
  diagram: Diagram,
  ops: PatchOp[],
): { diagram: Diagram; errors: string[] } {
  const d: Diagram = structuredClone(diagram);
  const errors: string[] = [];
  const node = (id: string) => d.nodes.find((n) => n.id === id);
  const group = (id: string) => d.groups.find((g) => g.id === id);

  for (const op of ops) {
    switch (op.op) {
      case "add_node": {
        if (!ID_RE.test(op.id)) errors.push(`add_node: invalid id "${op.id}"`);
        else if (node(op.id) || group(op.id))
          errors.push(`add_node: "${op.id}" already exists`);
        else if (op.group && !group(op.group))
          errors.push(`add_node: unknown group "${op.group}"`);
        else
          d.nodes.push({
            id: op.id,
            kind: op.kind,
            label: op.label,
            group: op.group,
            attrs: { ...op.attrs },
          });
        break;
      }
      case "remove_node": {
        if (!node(op.id)) errors.push(`remove_node: unknown node "${op.id}"`);
        d.nodes = d.nodes.filter((n) => n.id !== op.id);
        d.edges = d.edges.filter((e) => e.from !== op.id && e.to !== op.id);
        break;
      }
      case "set_node": {
        const n = node(op.id);
        if (!n) {
          errors.push(`set_node: unknown node "${op.id}"`);
          break;
        }
        if (op.kind !== undefined) n.kind = op.kind;
        if (op.label !== undefined) n.label = op.label;
        if (op.group === null) n.group = undefined;
        else if (op.group !== undefined) {
          if (!group(op.group))
            errors.push(`set_node: unknown group "${op.group}"`);
          else n.group = op.group;
        }
        if (op.attrs) n.attrs = { ...n.attrs, ...op.attrs };
        break;
      }
      case "add_group": {
        if (!ID_RE.test(op.id)) errors.push(`add_group: invalid id "${op.id}"`);
        else if (node(op.id) || group(op.id))
          errors.push(`add_group: "${op.id}" already exists`);
        else if (op.parent && !group(op.parent))
          errors.push(`add_group: unknown parent "${op.parent}"`);
        else
          d.groups.push({
            id: op.id,
            label: op.label,
            parent: op.parent,
            attrs: {},
          });
        break;
      }
      case "remove_group": {
        if (!group(op.id))
          errors.push(`remove_group: unknown group "${op.id}"`);
        const g = group(op.id);
        d.groups = d.groups.filter((x) => x.id !== op.id);
        // Children move up one level rather than vanishing.
        for (const n of d.nodes) if (n.group === op.id) n.group = g?.parent;
        for (const x of d.groups) if (x.parent === op.id) x.parent = g?.parent;
        break;
      }
      case "add_edge": {
        if (!node(op.from) && !group(op.from))
          errors.push(`add_edge: unknown source "${op.from}"`);
        else if (!node(op.to) && !group(op.to))
          errors.push(`add_edge: unknown target "${op.to}"`);
        else if (d.edges.some((e) => e.from === op.from && e.to === op.to))
          errors.push(`add_edge: "${op.from} > ${op.to}" already exists`);
        else
          d.edges.push({
            from: op.from,
            to: op.to,
            label: op.label,
            style: op.style ?? "arrow",
            attrs: { ...op.attrs },
          });
        break;
      }
      case "remove_edge": {
        const before = d.edges.length;
        d.edges = d.edges.filter(
          (e) => !(e.from === op.from && e.to === op.to),
        );
        if (d.edges.length === before)
          errors.push(`remove_edge: no edge "${op.from} > ${op.to}"`);
        break;
      }
      case "set_direction":
        d.direction = op.direction;
        break;
      case "set_title":
        d.title = op.title;
        break;
      case "set_provider":
        d.provider = op.provider;
        break;
    }
  }
  return { diagram: d, errors };
}

