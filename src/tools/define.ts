/**
 * One tool definition, three consumers.
 *
 *   defineTool(...)  →  toWebMcpTool()   document.modelContext.registerTool
 *                    →  toClientTools()  useAgentChat({ tools })  (Agents SDK)
 *                    →  execute()        direct call, for tests and fallbacks
 *
 * The schema is zod; JSON Schema is derived once so the browser agent and
 * the chat model see byte-identical tool surfaces.
 */
import { z } from "zod";

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
}

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  annotations?: ToolAnnotations;
  /** Ask the person before running (destructive rewrites). */
  needsApproval?: boolean;
  execute: (input: z.output<S>) => Promise<unknown> | unknown;
}

export function defineTool<S extends z.ZodType>(def: ToolDef<S>): ToolDef<S> {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(def.name))
    throw new Error(`Invalid tool name "${def.name}"`);
  return def;
}

export type JsonSchema = Record<string, unknown>;

export function toJsonSchema(schema: z.ZodType): JsonSchema {
  const js = z.toJSONSchema(schema, {
    target: "draft-7",
    io: "input",
  }) as JsonSchema;
  delete js["$schema"];
  return js;
}

/** Run a tool with validation; errors come back as data, never thrown at the agent. */
export async function runTool(def: ToolDef, input: unknown): Promise<unknown> {
  const parsed = def.schema.safeParse(input ?? {});
  if (!parsed.success) {
    return {
      error: "invalid_input",
      issues: parsed.error.issues.map(
        (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
      ),
    };
  }
  try {
    return (await def.execute(parsed.data)) ?? { ok: true };
  } catch (err) {
    return {
      error: "tool_failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** The shape `document.modelContext.registerTool` expects. */
export function toWebMcpTool(def: ToolDef): WebMCP.ModelContextTool {
  return {
    name: def.name,
    description: def.description,
    inputSchema: toJsonSchema(
      def.schema,
    ) as WebMCP.ModelContextTool["inputSchema"],
    annotations: def.annotations,
    execute: async (input) => {
      const result = await runTool(def, input);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  };
}

/**
 * The shape `useAgentChat({ tools })` sends to the server. `execute` is what
 * the browser runs when the model calls the tool; pass a router so the call
 * can go through WebMCP when it is available.
 */
export interface ClientTool {
  description: string;
  parameters: JsonSchema;
  execute: (input: unknown) => Promise<unknown>;
}

export function toClientTools(
  defs: ToolDef[],
  route: (def: ToolDef, input: unknown) => Promise<unknown>,
): Record<string, ClientTool> {
  const out: Record<string, ClientTool> = {};
  for (const def of defs) {
    out[def.name] = {
      description: def.description,
      parameters: toJsonSchema(def.schema),
      execute: (input) => route(def, input),
    };
  }
  return out;
}
