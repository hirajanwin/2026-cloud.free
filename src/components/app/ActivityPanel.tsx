/**
 * Every tool call, who made it, and which path it took. This is the proof
 * that the browser agent and the in-page assistant share one tool surface.
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { tools } from "@/tools";
import { toolLog, useToolLog } from "@/state/toollog";
import { useStudio } from "@/state/store";

export function ActivityPanel() {
  const events = useToolLog();
  const webmcp = useStudio((s) => s.webmcp);
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl bg-surface-2 p-3 text-caption text-muted-foreground shadow-surface-1">
        <div className="flex items-center justify-between">
          <span className="font-medium text-foreground">
            {tools.length} tools
          </span>
          <Badge
            color={webmcp.supported ? "green" : "gray"}
            variant="dot"
            size="compact"
          >
            {webmcp.supported
              ? `registered on document.modelContext`
              : "WebMCP unavailable"}
          </Badge>
        </div>
        <p className="mt-1">
          {webmcp.supported
            ? "The browser agent calls these directly. The in-page assistant's calls are routed through executeTool when the browser exposes it."
            : "Enable chrome://flags/#enable-webmcp-testing in Chrome 149+ and reload. Until then the assistant runs the same tools directly."}
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {tools.map((t) => (
            <code key={t.name} className="text-[10.5px]">
              {t.name}
            </code>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-caption text-muted-foreground">
          {events.length} calls this session
        </span>
        {events.length > 0 && (
          <Button
            variant="ghost"
            size="compact"
            onClick={() => toolLog.clear()}
          >
            Clear
          </Button>
        )}
      </div>
      <ol className="flex flex-col gap-1.5">
        {events.map((e, i) => (
          <li
            key={`${e.at}-${i}`}
            className="rounded-lg bg-surface-3 px-3 py-2 shadow-surface-1"
          >
            <div className="flex items-center gap-2 text-caption">
              <code className="text-foreground">{e.name}</code>
              <Badge
                color={e.via === "webmcp" ? "green" : "gray"}
                size="compact"
              >
                {e.via}
              </Badge>
              <span className="text-muted-foreground">
                {e.caller === "browser-agent" ? "browser agent" : e.caller}
              </span>
              <span className="ml-auto text-numeric text-muted-foreground">
                {e.durationMs} ms
              </span>
            </div>
            {e.input !== undefined &&
              Object.keys((e.input as object) ?? {}).length > 0 && (
                <pre className="mt-1 max-h-16 overflow-hidden text-[10.5px] leading-4 text-muted-foreground">
                  {JSON.stringify(e.input)}
                </pre>
              )}
          </li>
        ))}
      </ol>
    </div>
  );
}
