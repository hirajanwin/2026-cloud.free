/**
 * Declarative WebMCP: the same tools, also announced as annotated forms.
 *
 * Chrome's imperative API (document.modelContext.registerTool) only exists
 * once our JavaScript has run, and some agent runtimes cannot list imperative
 * tools at all. Forms with `toolname` / `tooldescription` are discoverable
 * from the server-rendered HTML before hydration and by agents that only read
 * the declarative surface. Each form's submit handler runs the identical tool
 * definition and answers the agent with `event.respondWith`.
 *
 * Visually hidden, but kept in the accessibility tree on purpose: an agent
 * that fills a form is doing what a person could do.
 */
import { useEffect, useRef } from "react";
import { toolByName } from "@/tools";
import { runTool } from "@/tools/define";
import { toolLog } from "@/state/toollog";

type AgentSubmitEvent = SubmitEvent & {
  agentInvoked?: boolean;
  respondWith?: (p: Promise<unknown>) => void;
};

interface Field {
  name: string;
  description: string;
  type?: "text" | "number" | "url";
  options?: string[];
  required?: boolean;
}

/** The subset of tools that make sense as forms, with their inputs spelled out. */
const FORMS: { tool: string; fields: Field[] }[] = [
  {
    tool: "load_template",
    fields: [
      {
        name: "id",
        description:
          "Template id: static-plus-api, saas-sql, media-pipeline, realtime-rooms, ai-rag or granola",
        options: [
          "static-plus-api",
          "saas-sql",
          "media-pipeline",
          "realtime-rooms",
          "ai-rag",
          "granola",
        ],
        required: true,
      },
    ],
  },
  {
    tool: "set_provider",
    fields: [
      {
        name: "provider",
        description: "cloudflare or vercel",
        options: ["cloudflare", "vercel"],
        required: true,
      },
    ],
  },
  {
    tool: "set_plan",
    fields: [
      {
        name: "plan",
        description:
          "free (Cloudflare Free / Vercel Hobby) or paid (Workers Paid / Vercel Pro)",
        options: ["free", "paid"],
        required: true,
      },
    ],
  },
  {
    tool: "set_traffic_mix",
    fields: [
      {
        name: "perDay",
        description: "Total requests per day, e.g. 100000",
        type: "number",
      },
      { name: "human", description: "Share of humans, 0 to 1", type: "number" },
      {
        name: "googlebot",
        description: "Share of search crawlers, 0 to 1",
        type: "number",
      },
      {
        name: "ai-crawler",
        description: "Share of AI crawlers, 0 to 1",
        type: "number",
      },
      {
        name: "scraper",
        description: "Share of scrapers, 0 to 1",
        type: "number",
      },
      {
        name: "botnet",
        description: "Share of botnet traffic, 0 to 1",
        type: "number",
      },
    ],
  },
  {
    tool: "set_protection",
    fields: [
      {
        name: "nodeId",
        description:
          "Id of a gate node on the canvas, e.g. shield, waf or limiter",
        required: true,
      },
      {
        name: "mode",
        description: "off, bots, bots+ai or all-bots",
        options: ["off", "bots", "bots+ai", "all-bots"],
        required: true,
      },
    ],
  },
  {
    tool: "analyze_product",
    fields: [
      {
        name: "url",
        description: "Public URL of the product to analyse",
        type: "url",
      },
      {
        name: "description",
        description: "Or describe the product in a sentence or two",
      },
    ],
  },
  {
    tool: "propose_architecture",
    fields: [
      {
        name: "provider",
        description: "Optional provider to build for: cloudflare or vercel",
        options: ["", "cloudflare", "vercel"],
      },
    ],
  },
  {
    tool: "get_bill",
    fields: [
      {
        name: "provider",
        description: "Optional: cloudflare or vercel",
        options: ["", "cloudflare", "vercel"],
      },
      {
        name: "plan",
        description: "Optional: free or paid",
        options: ["", "free", "paid"],
      },
    ],
  },
  {
    tool: "set_simulation_period",
    fields: [
      {
        name: "period",
        description: "day, month or year",
        options: ["day", "month", "year"],
        required: true,
      },
    ],
  },
  {
    tool: "control_timeline",
    fields: [
      {
        name: "action",
        description: "play, pause, reset, seek or status",
        options: ["status", "play", "pause", "reset", "seek"],
        required: true,
      },
      {
        name: "at",
        description: "For seek: position in the period from 0 (start) to 1 (end)",
        type: "number",
      },
    ],
  },
  {
    tool: "set_view",
    fields: [
      {
        name: "layout",
        description: "snake, vertical or horizontal",
        options: ["", "snake", "vertical", "horizontal"],
      },
      {
        name: "edgeStyle",
        description: "curved, step or straight",
        options: ["", "curved", "step", "straight"],
      },
    ],
  },
  {
    tool: "focus_node",
    fields: [
      {
        name: "id",
        description: "Node id from get_diagram, e.g. worker, db or cache",
        required: true,
      },
    ],
  },
  {
    tool: "open_panel",
    fields: [
      {
        name: "panel",
        description: "inspect, traffic, bill or chat",
        options: ["inspect", "traffic", "bill", "chat"],
        required: true,
      },
    ],
  },
  {
    tool: "save_blueprint",
    fields: [{ name: "name", description: "Optional name for the saved blueprint" }],
  },
  { tool: "describe_studio", fields: [] },
  { tool: "get_layers", fields: [] },
  { tool: "list_blueprints", fields: [] },
  { tool: "compare_providers", fields: [] },
  { tool: "get_snapshot", fields: [] },
  { tool: "get_diagram", fields: [] },
  {
    tool: "export_config",
    fields: [
      {
        name: "provider",
        description: "Optional: cloudflare or vercel",
        options: ["", "cloudflare", "vercel"],
      },
    ],
  },
];

/** Turn a submitted form into the tool's input object, coercing numbers and grouping traffic shares. */
function inputFrom(
  tool: string,
  form: HTMLFormElement,
): Record<string, unknown> {
  const fd = new FormData(form);
  const obj: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    const s = String(v).trim();
    if (s === "") continue;
    const field = FORMS.find((f) => f.tool === tool)?.fields.find(
      (x) => x.name === k,
    );
    obj[k] = field?.type === "number" ? Number(s) : s;
  }
  if (tool === "set_traffic_mix") {
    const shares: Record<string, number> = {};
    for (const c of ["human", "googlebot", "ai-crawler", "scraper", "botnet"]) {
      if (typeof obj[c] === "number") shares[c] = obj[c] as number;
      delete obj[c];
    }
    if (Object.keys(shares).length) obj.shares = shares;
  }
  return obj;
}

export function DeclarativeTools() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const onSubmit = (e: Event) => {
      const ev = e as AgentSubmitEvent;
      const form = ev.target as HTMLFormElement;
      const tool = form.getAttribute("toolname");
      if (!tool) return;
      ev.preventDefault();
      const def = toolByName.get(tool);
      if (!def) return;
      const started = performance.now();
      const input = inputFrom(tool, form);
      const result = runTool(def, input).finally(() =>
        toolLog.push({
          name: tool,
          input,
          via: "webmcp",
          caller: "browser-agent",
          at: Date.now(),
          durationMs: Math.round(performance.now() - started),
        }),
      );
      if (typeof ev.respondWith === "function") ev.respondWith(result);
    };
    root.addEventListener("submit", onSubmit);
    return () => root.removeEventListener("submit", onSubmit);
  }, []);

  return (
    <div
      ref={ref}
      className="sr-only"
      aria-label="Agent tools"
      data-webmcp-declarative
    >
      {FORMS.map(({ tool, fields }) => {
        const def = toolByName.get(tool);
        if (!def) return null;
        return (
          <form
            key={tool}
            {...({
              toolname: tool,
              tooldescription: def.description,
              toolautosubmit: "",
            } as Record<string, string>)}
            action="#"
            method="post"
          >
            {fields.map((f) =>
              f.options ? (
                <label key={f.name}>
                  {f.name}
                  <select
                    name={f.name}
                    required={f.required}
                    {...({ toolparamdescription: f.description } as Record<
                      string,
                      string
                    >)}
                    defaultValue=""
                  >
                    {f.options.map((o) => (
                      <option key={o} value={o}>
                        {o || "(any)"}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label key={f.name}>
                  {f.name}
                  <input
                    name={f.name}
                    type={f.type ?? "text"}
                    step={f.type === "number" ? "any" : undefined}
                    required={f.required}
                    {...({ toolparamdescription: f.description } as Record<
                      string,
                      string
                    >)}
                  />
                </label>
              ),
            )}
            <button type="submit">Run {tool}</button>
          </form>
        );
      })}
    </div>
  );
}
