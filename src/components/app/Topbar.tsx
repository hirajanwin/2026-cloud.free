/**
 * The top bar: sidebar triggers at both ends, the live traffic strip with the
 * clock controls, and the provider / plan switches.
 */
import { RollingNumber } from "@/components/ui/rolling-number";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tabs, TabItem, TabsList } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { REQUEST_CLASSES, REQUEST_CLASS_LABEL, REQUEST_CLASS_DESCRIPTION, type RequestClass } from "@/engine/types";
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

/** A thin donut of the request mix. Arcs are stroke-dasharray segments on one circle, so it costs nothing to animate. */
function Donut({ shares, total }: { shares: { key: string; value: number; color: string; dim?: boolean }[]; total: number }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden className="shrink-0 -rotate-90">
      <circle cx="20" cy="20" r={r} fill="none" stroke="var(--muted)" strokeWidth="6" />
      {total > 0 &&
        shares.map((s) => {
          const frac = s.value / total;
          const dash = frac * c;
          const el = (
            <circle
              key={s.key}
              cx="20"
              cy="20"
              r={r}
              fill="none"
              stroke={s.color}
              strokeOpacity={s.dim ? 0.6 : 1}
              strokeWidth="6"
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-acc}
              className="transition-[stroke-dasharray,stroke-dashoffset] duration-300"
            />
          );
          acc += dash;
          return el;
        })}
    </svg>
  );
}

// Log scale: 0..100 → 100 .. 100M requests per day.
const toPerDay = (v: number) => Math.round(10 ** (2 + (v / 100) * 6));
const fromPerDay = (n: number) => Math.max(0, Math.min(100, ((Math.log10(Math.max(100, n)) - 2) / 6) * 100));

/** A compact labelled range: label and value on one line, the track beneath. */
function MixRange({ label, value, display, color, title, onChange }: { label: string; value: number; display: string; color: string; title: string; onChange: (v: number) => void }) {
  return (
    <label className="mix-range flex w-[96px] shrink-0 flex-col gap-0.5" title={title} style={{ ["--mix-color" as string]: color }}>
      <span className="flex items-baseline justify-between whitespace-nowrap text-[10.5px] leading-3 text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="inline-block size-1.5 rounded-full" style={{ background: color }} />{label}</span>
        <span className="text-numeric text-foreground">{display}</span>
      </span>
      <input type="range" min={0} max={100} step={1} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function TrafficStrip() {
  const snapshot = useStudio((s) => s.snapshot);
  const mix = useStudio((s) => s.mix);
  const offered = REQUEST_CLASSES.reduce((s, c) => s + snapshot.offered[c], 0);
  const shown = useGlide(offered);
  const shareTotal = REQUEST_CLASSES.reduce((s, c) => s + mix.shares[c], 0) || 1;
  const setShare = (c: RequestClass, pct: number) => {
    // Keep the others in proportion so the total stays 100%.
    const others = REQUEST_CLASSES.filter((k) => k !== c);
    const otherTotal = others.reduce((s, k) => s + mix.shares[k], 0) || 1;
    const shares = { ...mix.shares, [c]: pct };
    for (const k of others) shares[k] = ((1 - pct) * mix.shares[k]) / otherTotal;
    studio.setMix({ shares });
  };

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-6 bg-surface-2 px-4 py-2">

      {/* headline number */}
      <div className="min-w-[132px]">
        <div className="text-numeric text-[18px] leading-6 text-foreground" style={{ fontVariationSettings: "'wght' 550, 'opsz' 18" }}>
          <RollingNumber value={formatCount(shown)} />
        </div>
        <div className="whitespace-nowrap text-[11px] leading-4 text-muted-foreground">
          requests · <span className="text-numeric text-foreground">{formatElapsed(snapshot.elapsedS)}</span>
        </div>
      </div>

      {/* mix donut + the controls that drive it */}
      <div className="flex min-w-0 items-center gap-3 overflow-x-auto scrollbar-hide">
        <Donut shares={REQUEST_CLASSES.map((c) => ({ key: c, value: snapshot.offered[c], color: CLASS_TONE[c], dim: c === "botnet" }))} total={offered} />
        <MixRange
          label="Per day"
          title="Total requests per day across every class. Monthly figures use 30 days."
          value={fromPerDay(mix.perDay)}
          display={formatCount(mix.perDay)}
          color="var(--muted-foreground)"
          onChange={(v) => studio.setMix({ perDay: toPerDay(v) })}
        />
        {REQUEST_CLASSES.map((c) => (
          <MixRange
            key={c}
            label={REQUEST_CLASS_LABEL[c]}
            title={REQUEST_CLASS_DESCRIPTION[c]}
            value={Math.round((mix.shares[c] / shareTotal) * 100)}
            display={`${Math.round((mix.shares[c] / shareTotal) * 100)}%`}
            color={CLASS_TONE[c]}
            onChange={(v) => setShare(c, v / 100)}
          />
        ))}
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
  const webmcp = useStudio((s) => s.webmcp);

  return (
    <header className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center px-1.5 pr-2">
      <div className="flex items-center gap-2">
        <SidebarTrigger />
        <Tabs value={provider} onValueChange={(v) => studio.setProvider(v as typeof provider)} size="compact" aria-label="Provider">
          <TabsList>
            <TabItem value="cloudflare" label="Cloudflare" />
            <TabItem value="vercel" label="Vercel" />
          </TabsList>
        </Tabs>
      </div>

      <Tabs value={plan} onValueChange={(v) => studio.setPlan(v as typeof plan)} size="compact" aria-label="Plan">
        <TabsList>
          <TabItem value="free" label={provider === "cloudflare" ? "Free" : "Hobby"} />
          <TabItem value="paid" label={provider === "cloudflare" ? "Workers Paid" : "Pro"} />
        </TabsList>
      </Tabs>

      <div className="flex items-center justify-end gap-2">
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
