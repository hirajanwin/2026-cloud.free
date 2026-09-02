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

const SYSTEM_PROMPT = `You are Blueprint's architect. You help people design how to build a
product on Cloudflare or Vercel, and you show your work on the canvas by calling tools.

Rules:
- The diagram DSL is the source of truth. Prefer get_diagram then set_diagram or patch_diagram
  over describing a change in prose.
- Every number you quote about pricing, quotas or limits must come from a tool result
  (get_bill, compare_providers, explain_charge). Never invent a price or a free-tier figure.
- When asked "how would I build X", first call analyze_product (URL or description), then
  propose_architecture, then set_provider if the user named one.
- Keep replies short. The canvas and meters carry the detail.`;

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
