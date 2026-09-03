/**
 * The in-page architect.
 *
 * An Agent on a Durable Object that answers chat turns over HTTP streaming.
 * Its ONLY tools are the ones the browser declares in the request body: the
 * page's WebMCP tool schemas. The model sees them, the stream ends at each
 * tool call, and the browser executes the call (through
 * document.modelContext when available) and continues the conversation. The
 * agent never runs a tool itself, so WebMCP is the single execution path for
 * both the browser agent and this one.
 */
import { Agent, type Connection, type WSMessage } from "agents";
import {
  convertToModelMessages,
  jsonSchema,
  stepCountIs,
  streamText,
  tool,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { createWorkersAI } from "workers-ai-provider";

const SYSTEM_PROMPT = `You are Blueprint's architect. Blueprint is a studio where people design how to build a
product on Cloudflare or Vercel, then watch a daily mix of humans, search crawlers, AI crawlers, scrapers
and botnet traffic flow through the design and see what it meters and costs, including free-tier quotas.
You show your work on the canvas by calling tools; the person sees every call in the Tools tab.

Rules:
- If you are unsure how the studio works or what is currently on screen, call describe_studio first.
- The diagram DSL is the source of truth. Prefer get_diagram then patch_diagram (or set_diagram for a
  rewrite) over describing a change in prose.
- Every number you quote about pricing, quotas or limits must come from a tool result (get_bill,
  get_layers, compare_providers, explain_charge). Never invent a price or a free-tier figure.
- "How would I build X": analyze_product (URL or description), then propose_architecture, then
  set_provider if the user named one, then get_bill.
- "Will the free tier hold": set_traffic_mix, set_simulation_period month, control_timeline seek 1,
  then get_layers and get_bill; say which meters breach and what happens past the quota.
- Bots or cost problems: set_protection on a gate, or patch_diagram to raise cache hit rates or add a
  gate, then get_snapshot / get_bill to show the difference. Warn when blocking search crawlers.
- Point at things: focus_node to highlight a node, open_panel to show the bill, traffic or layers,
  set_view to change layout. Save work with save_blueprint when asked to keep it.
- Keep replies short. The canvas, layers, timeline and meters carry the detail.`;

interface ClientToolSchema {
  description?: string;
  parameters?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
}

interface ChatBody {
  messages: UIMessage[];
  clientTools?: Record<string, ClientToolSchema>;
}

const MAX_TOOLS = 40;

export class ArchitectAgent extends Agent<Env> {
  async onRequest(request: Request): Promise<Response> {
    if (request.method !== "POST")
      return new Response("Method not allowed", { status: 405 });
    let body: ChatBody;
    try {
      body = (await request.json()) as ChatBody;
    } catch {
      return new Response("Bad JSON", { status: 400 });
    }
    if (!Array.isArray(body.messages))
      return new Response("messages required", { status: 400 });

    // Tools are declared by the browser and executed there. No execute() here
    // on purpose: the stream stops at the tool call and the client resumes.
    const tools = Object.fromEntries(
      Object.entries(body.clientTools ?? {})
        .slice(0, MAX_TOOLS)
        .map(([name, t]) => [
          name,
          tool({
            description: t.description,
            inputSchema: jsonSchema(
              (t.parameters ??
                t.inputSchema ?? {
                  type: "object",
                  properties: {},
                }) as Parameters<typeof jsonSchema>[0],
            ),
          }),
        ]),
    );

    let messages: ModelMessage[];
    try {
      messages = await convertToModelMessages(body.messages);
    } catch (err) {
      return new Response(
        `Bad messages: ${err instanceof Error ? err.message : String(err)}`,
        { status: 400 },
      );
    }

    const workersai = createWorkersAI({ binding: this.env.AI });
    // Local development only: let a header pick the model so candidates can be
    // compared without redeploying. Production always uses the configured var.
    const url = new URL(request.url);
    const override = url.hostname === "localhost" ? request.headers.get("x-architect-model") : null;
    const modelId = (override ?? this.env.ARCHITECT_MODEL) as typeof this.env.ARCHITECT_MODEL;
    const result = streamText({
      model: workersai(modelId),
      system: SYSTEM_PROMPT,
      messages,
      tools,
      stopWhen: stepCountIs(1),
      onError: ({ error }) =>
        console.error("[architect] stream error", error),
    });
    return result.toUIMessageStreamResponse({
      onError: (error) => {
        console.error("[architect] response error", error);
        return error instanceof Error ? error.message : String(error);
      },
    });
  }

  /** The studio talks HTTP; keep the socket quiet if something connects. */
  onMessage(_connection: Connection, _message: WSMessage) {}
}
