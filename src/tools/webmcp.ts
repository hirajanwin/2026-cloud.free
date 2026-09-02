/**
 * The WebMCP bridge.
 *
 * Registers every tool on `document.modelContext` so the browser's agent can
 * call them, and routes the in-page assistant's tool calls through the same
 * object when the browser exposes `executeTool`. Without WebMCP (any browser
 * today except Chrome with the flag) the tools run directly, and the badge
 * says so. Either way the tool code is identical.
 */
import { runTool, toWebMcpTool, type ToolDef } from "./define";
import { toolLog } from "@/state/toollog";

export type ToolRoute = "webmcp" | "direct";

/** Who is currently driving a WebMCP execution from inside the page. */
export let activeCaller: "assistant" | null = null;

type ExecuteCapable = WebMCP.ModelContext & {
  executeTool?: (
    tool: WebMCP.RegisteredTool | string,
    inputJSON: string,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown>;
};

export function getModelContext(): ExecuteCapable | null {
  if (typeof document === "undefined") return null;
  const mc = (document as Document & { modelContext?: WebMCP.ModelContext })
    .modelContext;
  return mc ? (mc as ExecuteCapable) : null;
}

export function webmcpSupported(): boolean {
  return getModelContext() !== null;
}

/** Register all tools. Returns an unregister function. */
export async function registerTools(
  defs: ToolDef[],
): Promise<{ registered: number; unregister: () => void }> {
  const mc = getModelContext();
  if (!mc) return { registered: 0, unregister: () => {} };
  const controller = new AbortController();
  let registered = 0;
  for (const def of defs) {
    try {
      await mc.registerTool(toWebMcpTool(def), { signal: controller.signal });
      registered += 1;
    } catch (err) {
      console.warn(`[webmcp] failed to register ${def.name}`, err);
    }
  }
  return { registered, unregister: () => controller.abort() };
}

/**
 * Execute a tool for the in-page assistant. Prefers the WebMCP path so the
 * browser sees (and can audit) every call; falls back to a direct run.
 */
export async function routeToolCall(
  def: ToolDef,
  input: unknown,
): Promise<unknown> {
  const started = performance.now();
  const mc = getModelContext();
  let via: ToolRoute = "direct";
  let result: unknown;
  try {
    if (mc && typeof mc.executeTool === "function") {
      const tools = await mc.getTools();
      const target = tools.find((t) => t.name === def.name);
      if (target) {
        via = "webmcp";
        activeCaller = "assistant";
        try {
          result = unwrap(await mc.executeTool(target, JSON.stringify(input ?? {})));
        } finally {
          activeCaller = null;
        }
      }
    }
    if (via === "direct") result = await runTool(def, input);
  } finally {
    // WebMCP-routed calls are logged by the registered wrapper with the right caller.
    if (via === "direct")
      toolLog.push({
        name: def.name,
        input,
        via,
        at: Date.now(),
        durationMs: Math.round(performance.now() - started),
        caller: "assistant",
      });
  }
  return result;
}

/** executeTool returns our `{ content: [{ type: "text", text }] }`; hand back the JSON inside. */
function unwrap(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "content" in raw) {
    const content = (
      raw as { content?: Array<{ type?: string; text?: string }> }
    ).content;
    const text = content?.find((c) => c.type === "text")?.text;
    if (typeof text === "string") {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
  }
  return raw;
}
