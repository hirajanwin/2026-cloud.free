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
import { ThinkingOrb } from "thinking-orbs";
import { BorderBeam } from "border-beam";
import {
  ThinkingStep,
  ThinkingSteps,
  ThinkingStepsContent,
  ThinkingStepsHeader,
} from "@/components/ui/thinking-steps";
import { Button } from "@/components/ui/button";
import { AskUserQuestions } from "@/components/ui/ask-user-questions";
import type { ToolDef } from "@/tools/define";
import { tools, toolByName } from "@/tools";
import { toClientTools } from "@/tools/define";
import { routeToolCall } from "@/tools/webmcp";
import Markdown from "react-markdown";
import { CyclingText } from "@/components/ui/cycling-text";
import { useToolLog, type ToolEvent } from "@/state/toollog";
import remarkGfm from "remark-gfm";

const SUGGESTIONS = [
  "Analyse https://linear.app and propose how to build it on Cloudflare",
  "Why is my bill this high? Explain the top charges",
  "Switch to Vercel and compare the two bills",
  "Block AI crawlers but keep Googlebot, then show what changed",
  "Raise traffic to 2M/day with a 30% botnet and tell me what breaks on the free plan",
];

const HINTS = [
  "will the free tier hold at 1M requests a day?",
  "what happens when botnet traffic triples?",
  "block AI crawlers but keep search",
  "price this on Vercel instead",
  "why is KV the biggest line on the bill?",
  "analyse a product URL and build it",
];

/** One row in the transcript: a chat message or a burst of tool calls made from outside the chat. */
type Row =
  | { kind: "message"; at: number; message: UIMessage }
  | { kind: "activity"; at: number; caller: ToolEvent["caller"]; events: ToolEvent[] };

/** Consecutive calls from the same caller within a few seconds read as one action. */
function groupActivity(events: ToolEvent[]): Row[] {
  const rows: Row[] = [];
  for (const e of [...events].reverse()) {
    if (e.caller === "assistant") continue;
    const last = rows[rows.length - 1];
    if (last && last.kind === "activity" && last.caller === e.caller && e.at - last.events[last.events.length - 1].at < 4000) {
      last.events.push(e);
    } else rows.push({ kind: "activity", at: e.at, caller: e.caller, events: [e] });
  }
  return rows;
}

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
  /** A destructive tool call waiting for the person's go-ahead. */
  const [pending, setPending] = useState<{ toolCallId: string; def: ToolDef; input: unknown } | null>(null);
  const runCall = (toolCallId: string, def: ToolDef, input: unknown) =>
    void routeToolCall(def, input).then(
      (output) => addOutputRef.current?.({ toolCallId, output }),
      (err) => addOutputRef.current?.({ toolCallId, state: "output-error", errorText: err instanceof Error ? err.message : String(err) }),
    );

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
        if (def.needsApproval) {
          setPending({ toolCallId: toolCall.toolCallId, def, input: toolCall.input });
          return;
        }
        runCall(toolCall.toolCallId, def, toolCall.input);
      },
    });
  addOutputRef.current = addToolOutput as unknown as AddToolOutput;

  const streaming = status === "streaming" || status === "submitted";

  // Everything the browser agent (or a declarative form) does through WebMCP
  // lands in the conversation too, in time order with the messages.
  const log = useToolLog();
  const firstSeen = useRef(new Map<string, number>());
  for (const m of messages) if (!firstSeen.current.has(m.id)) firstSeen.current.set(m.id, Date.now());
  const rows: Row[] = useMemo(() => {
    const msgRows: Row[] = messages.map((m) => ({ kind: "message", at: firstSeen.current.get(m.id) ?? 0, message: m }));
    return [...msgRows, ...groupActivity(log)].sort((a, b) => a.at - b.at);
  }, [messages, log]);
  const agentCalls = log.filter((e) => e.caller !== "assistant").length;
  // A browser agent counts as "live" for a few seconds after its last call.
  const lastAgentAt = log.find((e) => e.caller === "browser-agent")?.at ?? 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!lastAgentAt) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lastAgentAt]);
  const agentLive = now - lastAgentAt < 6000;

  useEffect(() => {
    const el = document.getElementById("chat-scroll");
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-1 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
          {agentLive && <ThinkingOrb state="connecting" size={20} theme="auto" aria-label="Browser agent working" />}
          {agentLive
            ? "Browser agent is driving the canvas"
            : messages.length === 0 && agentCalls === 0
            ? "The architect drives the canvas through the page's tools."
            : [messages.length ? `${messages.length} messages` : null, agentCalls ? `${agentCalls} agent action${agentCalls > 1 ? "s" : ""} via WebMCP` : null].filter(Boolean).join(" · ")}
        </span>
        {messages.length > 0 && (
          <Button variant="ghost" size="compact" onClick={() => setMessages([])}>
            Clear conversation
          </Button>
        )}
      </div>
      <div
        id="chat-scroll"
        className="scroll-fade min-h-0 flex-1 overflow-y-auto px-1 pb-2"
      >
        {messages.length === 0 && (
          <div className="flex flex-col gap-2 pt-2">
            <p className="px-1 text-caption text-muted-foreground">
              Ask the architect: <CyclingText phrases={HINTS} className="text-foreground" />
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
          {rows.map((r) =>
            r.kind === "message" ? (
              <Message key={r.message.id} message={r.message} />
            ) : (
              <Activity key={`act-${r.at}`} row={r} />
            ),
          )}
          {streaming && messages[messages.length - 1]?.role !== "assistant" && (
            <div className="flex items-center gap-2 px-1 text-caption text-muted-foreground">
              <ThinkingOrb state="working" size={20} theme="auto" aria-label="Architect thinking" />
              Thinking
            </div>
          )}
          {pending && (
            <div className="rounded-xl bg-surface-3 p-2 shadow-surface-2">
              <AskUserQuestions
                size="compact"
                questions={[
                  {
                    id: "approve",
                    title: `The architect wants to run ${pending.def.name}. This rewrites the canvas.`,
                    options: [
                      { id: "apply", title: "Apply it", description: "Replace the current architecture with the proposal." },
                      { id: "skip", title: "Keep mine", description: "Deny this call; the architect will be told." },
                    ],
                    nextLabel: "Continue",
                  },
                ]}
                onComplete={(answers) => {
                  const p = pending;
                  setPending(null);
                  if (!p) return;
                  if (answers.approve?.selectedIds.includes("apply")) runCall(p.toolCallId, p.def, p.input);
                  else addOutputRef.current?.({ toolCallId: p.toolCallId, state: "output-error", errorText: "The person declined this change. Keep their current architecture." });
                }}
              />
            </div>
          )}
          {error && (
            <div className="rounded-lg bg-destructive-light px-3 py-2 text-caption text-destructive">
              The architect could not answer: {error.message}
            </div>
          )}
        </div>
      </div>
      <div className="pt-2">
        <BorderBeam size="md" colorVariant="ocean" theme="auto" active={streaming || agentLive} strength={0.8} className="rounded-xl">
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
        </BorderBeam>
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

/** A burst of tool calls made from outside this chat: the browser's agent or a declarative form. */
function Activity({ row }: { row: Extract<Row, { kind: "activity" }> }) {
  const who = row.caller === "browser-agent" ? "Browser agent" : "You";
  const n = row.events.length;
  return (
    <div className="act-in flex min-w-0 flex-col gap-1 rounded-xl border border-dashed border-border bg-surface-2 px-3 py-2">
      <div className="flex items-center justify-between gap-2 text-caption">
        <span className="inline-flex items-center gap-1.5 text-foreground">
          <span className="inline-block size-1.5 rounded-full bg-focus-ring" />
          {who} ran {n} tool{n > 1 ? "s" : ""} via WebMCP
        </span>
        <span className="text-numeric text-muted-foreground">
          {new Date(row.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {row.events.map((e, i) => (
          <li key={i} className="flex min-w-0 items-baseline gap-2 text-caption">
            <code className="shrink-0 text-foreground">{e.name}</code>
            <span className="truncate text-muted-foreground" title={shortJson(e.input)}>
              {e.input && Object.keys(e.input as object).length ? shortJson(e.input) : "no input"}
            </span>
            <span className="ml-auto shrink-0 text-numeric text-muted-foreground">{e.durationMs} ms</span>
          </li>
        ))}
      </ul>
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
