/**
 * The in-page architect. A chat over HTTP streaming to an Agent on a Durable
 * Object whose tools are the page's WebMCP tools, executed here in the
 * browser. Tool calls render as thinking steps so a person can see what the
 * agent did to the canvas.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import { ChatMessage } from "@/components/ui/chat-message";
import { InputMessage } from "@/components/ui/input-message";
import { ThinkingIndicator } from "@/components/ui/thinking-indicator";
import {
  ThinkingStep,
  ThinkingSteps,
  ThinkingStepsContent,
  ThinkingStepsHeader,
} from "@/components/ui/thinking-steps";
import { Button } from "@/components/ui/button";
import { tools, toolByName } from "@/tools";
import { toClientTools } from "@/tools/define";
import { routeToolCall } from "@/tools/webmcp";
import { useStudio } from "@/state/store";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

const SUGGESTIONS = [
  "Analyse https://www.granola.ai and propose how to build it on Cloudflare",
  "Why is my bill this high? Explain the top charges",
  "Switch to Vercel and compare the two bills",
  "Block AI crawlers but keep Googlebot, then show what changed",
  "Raise traffic to 2M/day with a 30% botnet and tell me what breaks on the free plan",
];

function sessionName(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    const key = "blueprint.session";
    let v = window.localStorage.getItem(key);
    if (!v) {
      v = Math.random().toString(36).slice(2, 10);
      window.localStorage.setItem(key, v);
    }
    return v;
  } catch {
    return "anon";
  }
}

type AddToolOutput = (o: {
  toolCallId: string;
  output?: unknown;
  state?: "output-error";
  errorText?: string;
}) => void;

export function Chat() {
  const [draft, setDraft] = useState("");
  const [name] = useState(sessionName);
  const webmcp = useStudio((s) => s.webmcp);

  // One schema set for both agents: the browser agent gets it via WebMCP,
  // this one gets it in the request body.
  const clientToolSchemas = useMemo(() => {
    const out: Record<
      string,
      { description: string; parameters: Record<string, unknown> }
    > = {};
    for (const [n, t] of Object.entries(toClientTools(tools, routeToolCall)))
      out[n] = { description: t.description, parameters: t.parameters };
    return out;
  }, []);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/agents/architect-agent/${name}`,
        body: { clientTools: clientToolSchemas },
      }),
    [name, clientToolSchemas],
  );

  // addToolOutput comes back from useChat but is needed inside onToolCall;
  // a ref closes the loop without re-creating the hook options.
  const addOutputRef = useRef<AddToolOutput | null>(null);

  const { messages, sendMessage, status, stop, setMessages, error, addToolOutput } =
    useChat({
      transport,
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
      onToolCall: ({ toolCall }) => {
        const def = toolByName.get(toolCall.toolName);
        if (!def) {
          addOutputRef.current?.({
            toolCallId: toolCall.toolCallId,
            state: "output-error",
            errorText: `Unknown tool ${toolCall.toolName}`,
          });
          return;
        }
        // Not awaited on purpose (AI SDK guidance); resolve then report.
        void routeToolCall(def, toolCall.input).then(
          (output) =>
            addOutputRef.current?.({ toolCallId: toolCall.toolCallId, output }),
          (err) =>
            addOutputRef.current?.({
              toolCallId: toolCall.toolCallId,
              state: "output-error",
              errorText: err instanceof Error ? err.message : String(err),
            }),
        );
      },
    });
  addOutputRef.current = addToolOutput as unknown as AddToolOutput;

  const streaming = status === "streaming" || status === "submitted";

  useEffect(() => {
    const el = document.getElementById("chat-scroll");
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        id="chat-scroll"
        className="scroll-fade min-h-0 flex-1 overflow-y-auto px-1 pb-2"
      >
        {messages.length === 0 && (
          <div className="flex flex-col gap-2 pt-2">
            <p className="text-caption text-muted-foreground">
              The architect edits the canvas through the same {tools.length}{" "}
              tools the browser agent sees
              {webmcp.supported ? ", routed through document.modelContext" : ""}
              .
            </p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => sendMessage({ text: s })}
                className="rounded-lg bg-surface-2 px-3 py-2 text-left text-body text-foreground shadow-surface-1 transition-colors hover:bg-hover"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-3 pt-2">
          {messages.map((m) => (
            <Message key={m.id} message={m} />
          ))}
          {streaming && messages[messages.length - 1]?.role !== "assistant" && (
            <ThinkingIndicator />
          )}
          {error && (
            <div className="rounded-lg bg-destructive-light px-3 py-2 text-caption text-destructive">
              The architect could not answer: {error.message}
            </div>
          )}
        </div>
      </div>
      <div className="pt-2">
        <InputMessage
          value={draft}
          onValueChange={setDraft}
          onSend={(text) => {
            if (!text.trim()) return;
            sendMessage({ text });
            setDraft("");
          }}
          status={streaming ? "streaming" : "idle"}
          onStop={() => void stop()}
          placeholder="Ask the architect…"
          minRows={1}
          maxRows={5}
          size="compact"
        />
        {messages.length > 0 && (
          <div className="mt-1 flex justify-end">
            <Button
              variant="ghost"
              size="compact"
              onClick={() => setMessages([])}
            >
              Clear conversation
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

type Part = UIMessage["parts"][number];

function isToolPart(p: Part): p is Part & {
  type: `tool-${string}` | "dynamic-tool";
  state?: string;
  input?: unknown;
  output?: unknown;
  toolName?: string;
  errorText?: string;
} {
  return (
    typeof p.type === "string" &&
    (p.type.startsWith("tool-") || p.type === "dynamic-tool")
  );
}

function Message({ message }: { message: UIMessage }) {
  const text = message.parts
    .filter(
      (p): p is Part & { type: "text"; text: string } => p.type === "text",
    )
    .map((p) => p.text)
    .join("");
  const toolParts = message.parts.filter(isToolPart);

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-2">
      {toolParts.length > 0 && (
        <ThinkingSteps defaultOpen={false} size="compact">
          <ThinkingStepsHeader>
            {toolParts.length} tool call{toolParts.length > 1 ? "s" : ""}
          </ThinkingStepsHeader>
          <ThinkingStepsContent>
            {toolParts.map((p, i) => {
              const name =
                p.type === "dynamic-tool"
                  ? (p.toolName ?? "tool")
                  : p.type.slice(5);
              const state = p.state ?? "";
              const status =
                state === "output-available" || state === "output-error"
                  ? "complete"
                  : state === "input-streaming"
                    ? "pending"
                    : "active";
              const detail =
                p.errorText ?? (p.input ? shortJson(p.input) : undefined);
              return (
                <ThinkingStep
                  key={i}
                  label={name}
                  description={detail}
                  status={status}
                  isLast={i === toolParts.length - 1}
                />
              );
            })}
          </ThinkingStepsContent>
        </ThinkingSteps>
      )}
      {text && (
        <ChatMessage
          from={message.role === "user" ? "user" : "assistant"}
          size="compact"
        >
          {message.role === "user" ? (
            <span className="whitespace-pre-wrap">{text}</span>
          ) : (
            <div className="prose-chat">
              <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
            </div>
          )}
        </ChatMessage>
      )}
    </div>
  );
}

function shortJson(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s.length > 140 ? `${s.slice(0, 140)}…` : s;
  } catch {
    return "";
  }
}
