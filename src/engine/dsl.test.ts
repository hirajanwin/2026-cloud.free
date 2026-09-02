import { describe, expect, it } from "vitest";
import { applyPatch, parse, print, toEraser } from "./dsl";

const SAMPLE = `
// A comment
direction right
title "Granola on Cloudflare"
provider cloudflare

client [kind: client, label: "Browser"]
edge "Edge" {
  cache [kind: edge-cache, label: "Cache"]
  shield [kind: bot-shield]
  inner "Inner" {
    api [kind: compute, label: "API Worker", ops: 1]
  }
}
kv [kind: kv, label: "Sessions"]
db [kind: sql]

client > cache: "GET /"
cache > shield
shield > api
api > kv, db: "read" [ops: 3]
api <> kv
db -- kv
`;

describe("dsl parse", () => {
  it("parses nodes, nested groups and edges", () => {
    const { diagram, errors } = parse(SAMPLE);
    expect(errors).toEqual([]);
    expect(diagram.direction).toBe("right");
    expect(diagram.title).toBe("Granola on Cloudflare");
    expect(diagram.provider).toBe("cloudflare");
    expect(diagram.nodes.map((n) => n.id)).toEqual([
      "client",
      "cache",
      "shield",
      "api",
      "kv",
      "db",
    ]);
    expect(diagram.nodes.find((n) => n.id === "api")).toMatchObject({
      kind: "compute",
      label: "API Worker",
      group: "inner",
      attrs: { ops: 1 },
    });
    expect(diagram.groups).toEqual([
      { id: "edge", label: "Edge", parent: undefined, attrs: {} },
      { id: "inner", label: "Inner", parent: "edge", attrs: {} },
    ]);
    expect(diagram.edges).toHaveLength(7);
    expect(diagram.edges[3]).toMatchObject({
      from: "api",
      to: "kv",
      label: "read",
      attrs: { ops: 3 },
    });
    expect(diagram.edges[4]).toMatchObject({
      from: "api",
      to: "db",
      label: "read",
      attrs: { ops: 3 },
    });
    expect(diagram.edges[5].style).toBe("both");
    expect(diagram.edges[6].style).toBe("dotted");
  });

  it("uses the id as kind when kind is omitted", () => {
    const { diagram } = parse('kv\nsql [label: "Main"]');
    expect(diagram.nodes[0].kind).toBe("kv");
    expect(diagram.nodes[1]).toMatchObject({ kind: "sql", label: "Main" });
  });

  it("reports errors without throwing", () => {
    const { errors } = parse("a > b\nbad id here\n}\ngroup {\n");
    expect(errors.map((e) => e.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("unknown node"),
        expect.stringContaining("Invalid identifier"),
        expect.stringContaining("Unmatched"),
        expect.stringContaining("Unclosed group"),
      ]),
    );
  });
});

describe("dsl print", () => {
  it("round-trips: parse(print(parse(x))) equals parse(x)", () => {
    const first = parse(SAMPLE).diagram;
    const printed = print(first);
    const second = parse(printed);
    expect(second.errors).toEqual([]);
    expect(second.diagram).toEqual(first);
    // And printing is a fixed point.
    expect(print(second.diagram)).toBe(printed);
  });

  it("quotes labels that need it and leaves bare words alone", () => {
    const { diagram } = parse(
      'a [kind: compute, label: "Has: colon", note: plain]',
    );
    const out = print(diagram);
    expect(out).toContain('label: "Has: colon"');
    expect(out).toContain("note: plain");
  });
});

describe("applyPatch", () => {
  it("applies a sequence of ops and reports bad ones", () => {
    const { diagram } = parse("a [kind: compute]\nb [kind: kv]\na > b");
    const { diagram: next, errors } = applyPatch(diagram, [
      { op: "add_group", id: "g", label: "Edge" },
      { op: "set_node", id: "a", group: "g", label: "API" },
      { op: "add_node", id: "c", kind: "sql" },
      { op: "add_edge", from: "a", to: "c", label: "query", attrs: { ops: 2 } },
      { op: "remove_edge", from: "a", to: "b" },
      { op: "remove_node", id: "zzz" },
      { op: "set_direction", direction: "down" },
    ]);
    expect(errors).toEqual(['remove_node: unknown node "zzz"']);
    expect(next.direction).toBe("down");
    expect(next.nodes.find((n) => n.id === "a")).toMatchObject({
      group: "g",
      label: "API",
    });
    expect(next.edges).toEqual([
      { from: "a", to: "c", label: "query", style: "arrow", attrs: { ops: 2 } },
    ]);
    // Original untouched.
    expect(diagram.edges).toHaveLength(1);
  });

  it("removing a group lifts children to its parent", () => {
    const { diagram } = parse(
      'outer "O" {\n inner "I" {\n  x [kind: kv]\n }\n}',
    );
    const { diagram: next } = applyPatch(diagram, [
      { op: "remove_group", id: "inner" },
    ]);
    expect(next.nodes[0].group).toBe("outer");
  });
});

describe("toEraser", () => {
  it("emits Eraser-compatible syntax", () => {
    const { diagram } = parse(SAMPLE);
    const out = toEraser(diagram);
    expect(out).toContain("direction right");
    expect(out).toContain('api [icon: server, label: "API Worker"]');
    expect(out).toContain("client > cache: GET /");
    expect(out).not.toContain("kind:");
  });
});
