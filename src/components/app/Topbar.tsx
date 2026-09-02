/**
 * The top bar: sidebar triggers at both ends, the live traffic strip with the
 * clock controls, and the provider / plan switches.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tabs, TabItem, TabsList } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { REQUEST_CLASSES, REQUEST_CLASS_LABEL } from "@/engine/types";
import { formatCount, formatElapsed } from "@/lib/format";
import { studio, useStudio } from "@/state/store";

const CLASS_TONE: Record<string, string> = {
  human: "var(--foreground)",
  googlebot: "var(--info)",
  "ai-crawler": "var(--warning)",
  scraper: "var(--destructive)",
  botnet: "var(--destructive)",
};

/** Tween a number towards its target so counters glide instead of jumping. */
function useGlide(target: number, ms = 220): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  const start = useRef(0);
  useEffect(() => {
    from.current = value;
    start.current = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start.current) / ms);
      const eased = 1 - (1 - k) * (1 - k);
      setValue(from.current + (target - from.current) * eased);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ms]);
  return value;
}

export function TrafficStrip() {
  const snapshot = useStudio((s) => s.snapshot);
  const offered = REQUEST_CLASSES.reduce((s, c) => s + snapshot.offered[c], 0);
  const shown = useGlide(offered);

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-6 border-b border-border bg-surface-2 px-4 py-2">

      {/* headline number */}
      <div className="min-w-[132px]">
        <div className="text-numeric text-[18px] leading-6 text-foreground" style={{ fontVariationSettings: "'wght' 550, 'opsz' 18" }}>
          {formatCount(shown)}
        </div>
        <div className="whitespace-nowrap text-[11px] leading-4 text-muted-foreground">
          requests · <span className="text-numeric text-foreground">{formatElapsed(snapshot.elapsedS)}</span>
        </div>
      </div>

      {/* mix bar + legend */}
      <div className="min-w-0">
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
          {REQUEST_CLASSES.map((c) => (
            <span
              key={c}
              title={REQUEST_CLASS_LABEL[c]}
              className="transition-[width] duration-200"
              style={{ width: `${offered > 0 ? (snapshot.offered[c] / offered) * 100 : 0}%`, background: CLASS_TONE[c], opacity: c === "botnet" ? 0.6 : 1 }}
            />
          ))}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] leading-4 text-numeric text-muted-foreground">
          {REQUEST_CLASSES.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 whitespace-nowrap">
              <span className="inline-block size-1.5 rounded-full" style={{ background: CLASS_TONE[c], opacity: c === "botnet" ? 0.6 : 1 }} />
              {REQUEST_CLASS_LABEL[c]} <span className="text-foreground">{formatCount(snapshot.offered[c])}</span>
            </span>
          ))}
        </div>
      </div>

      {/* outcomes */}
      <div className="grid grid-cols-3 gap-x-4 text-numeric">
        {(
          [
            ["served", snapshot.outcomes.served, "text-success", "Served"],
            ["blocked", snapshot.outcomes.blocked, "text-destructive", "Blocked by gates"],
            ["dropped", snapshot.outcomes.dropped, "text-warning", "Dropped by free-plan caps"],
          ] as const
        ).map(([k, v, tone, title]) => (
          <div key={k} className="text-right" title={title}>
            <div className={`text-[13px] leading-5 ${tone}`}>{formatCount(v)}</div>
            <div className="text-[10.5px] leading-3 text-muted-foreground">{k}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Topbar({ rightTrigger }: { rightTrigger?: ReactNode }) {
  const provider = useStudio((s) => s.provider);
  const plan = useStudio((s) => s.plan);
  const title = useStudio((s) => s.diagram.title);
  const webmcp = useStudio((s) => s.webmcp);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-1.5 pr-2">
      <SidebarTrigger />
      <div
        className="min-w-0 max-w-[320px] truncate text-subtitle font-medium"
        title={title}
      >
        {title ?? "Untitled"}
      </div>


      <div className="ml-auto flex items-center gap-2">
        <Tabs
          value={provider}
          onValueChange={(v) => studio.setProvider(v as typeof provider)}
          size="compact"
          aria-label="Provider"
        >
          <TabsList>
            <TabItem value="cloudflare" label="Cloudflare" />
            <TabItem value="vercel" label="Vercel" />
          </TabsList>
        </Tabs>
        <Tabs
          value={plan}
          onValueChange={(v) => studio.setPlan(v as typeof plan)}
          size="compact"
          aria-label="Plan"
        >
          <TabsList>
            <TabItem
              value="free"
              label={provider === "cloudflare" ? "Free" : "Hobby"}
            />
            <TabItem
              value="paid"
              label={provider === "cloudflare" ? "Paid" : "Pro"}
            />
          </TabsList>
        </Tabs>
        <Tooltip
          content={
            webmcp.supported
              ? `Expose the ${webmcp.registered || 18} tools on document.modelContext for your browser's agent.`
              : "No WebMCP in this browser. Enable chrome://flags/#enable-webmcp-testing in Chrome 149+. The in-page architect still works; its tools run directly."
          }
        >
          <div className="flex items-center gap-2 rounded-lg bg-surface-3 px-2.5 py-1 shadow-surface-1">
            <Switch
              size="compact"
              label={webmcp.supported ? `WebMCP${webmcp.enabled && webmcp.registered ? ` · ${webmcp.registered}` : ""}` : "WebMCP unavailable"}
              checked={webmcp.supported && webmcp.enabled}
              disabled={!webmcp.supported}
              onToggle={() => studio.setWebmcp({ enabled: !webmcp.enabled })}
            />
            <span className={`inline-block size-1.5 rounded-full ${webmcp.supported && webmcp.enabled && webmcp.registered ? "bg-success" : "bg-muted-foreground/50"}`} aria-hidden />
          </div>
        </Tooltip>
        {rightTrigger}
      </div>
    </header>
  );
}
