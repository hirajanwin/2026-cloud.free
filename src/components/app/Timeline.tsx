/**
 * The timeline: scrub through a simulated month and see exactly when each
 * quota is crossed. Because rates are linear, every meter's curve over the
 * month is known analytically: a monthly allowance is a straight line, a
 * daily cap is a sawtooth that clips at the cap and resets at midnight. The
 * Tracks view draws one row per layer, normalised to percent of allowance,
 * so the node that breaks first is the one whose line hits the 100% rule
 * first. Nothing here is sampled.
 */
import { useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { computeBill, type BillLine } from "@/engine/pricing";
import { PRODUCTS, isProductKind } from "@/engine/catalog";
import { formatCount, formatUnit } from "@/lib/format";
import { MONTH_S, studio, useStudio } from "@/state/store";
import { Tooltip } from "@/components/ui/tooltip";

const DAY = 86_400;
const MONTH_DAYS = 30;
/** One hue per meter so the legend and the markers read together. */
const METER_TONES = ["var(--info)", "var(--success)", "var(--warning)", "#a78bfa", "#f472b6", "#22d3ee", "#fb923c", "#34d399"];
const SPEEDS: { label: string; value: number }[] = [
  { label: "1 h/s", value: 3600 },
  { label: "4 h/s", value: 4 * 3600 },
  { label: "1 d/s", value: DAY },
];
/** Vertical scale of a track, in percent of allowance. */
const Y_MAX = 160;

interface TrackLine extends BillLine {
  crossDay: number;
  isDaily: boolean;
}

export function Timeline() {
  const elapsed = useStudio((s) => s.snapshot.elapsedS);
  const running = useStudio((s) => s.running);
  const speed = useStudio((s) => s.speed);
  const rates = useStudio((s) => s.rates);
  const provider = useStudio((s) => s.provider);
  const plan = useStudio((s) => s.plan);
  const diagram = useStudio((s) => s.diagram);
  const selectedId = useStudio((s) => s.selectedId);
  const [view, setView] = useState<"bar" | "tracks">("tracks");
  const trackRef = useRef<HTMLDivElement | null>(null);

  const bill = useMemo(() => computeBill(provider, plan, rates.daily), [provider, plan, rates]);
  const lines = useMemo<TrackLine[]>(
    () =>
      bill.lines
        .filter((l) => l.allowanceMonthly !== null && l.monthly > 0)
        .map((l) => {
          const isDaily = l.allowancePeriod === "day";
          const allowance = l.allowanceMonthly!;
          const crossDay = isDaily ? (l.daily > 0 ? allowance / MONTH_DAYS / l.daily : Infinity) : l.daily > 0 ? allowance / l.daily : Infinity;
          return { ...l, crossDay, isDaily };
        })
        .sort((a, b) => a.crossDay - b.crossDay),
    [bill],
  );
  const tone = useMemo(() => new Map(lines.map((l, i) => [l.meter, METER_TONES[i % METER_TONES.length]] as const)), [lines]);

  /** One track per node: its tightest metered line, in layer order. */
  const tracks = useMemo(() => {
    const byMeter = new Map(lines.map((l) => [l.meter, l] as const));
    return diagram.nodes
      .filter((n) => n.kind !== "client")
      .map((n) => {
        const used = Object.keys(rates.nodes[n.id]?.meters ?? {});
        const candidates = used.map((m) => byMeter.get(m)).filter((l): l is TrackLine => !!l);
        candidates.sort((a, b) => a.crossDay - b.crossDay);
        const line = candidates[0];
        const product = isProductKind(n.kind) ? PRODUCTS[provider][n.kind] : undefined;
        return { id: n.id, label: n.label ?? product?.name ?? n.kind, product: product?.name ?? n.kind, line };
      })
      // Metered rows first, tightest first; unmetered layers trail so the
      // rows that can break are the ones on screen.
      .sort((a, b) => (a.line?.crossDay ?? Infinity) - (b.line?.crossDay ?? Infinity));
  }, [diagram, rates, lines, provider]);

  const pos = Math.min(1, elapsed / MONTH_S);
  const seekTo = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const k = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    studio.seek(k * MONTH_S);
  };
  const scrubHandlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      seekTo(e.clientX);
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (e.buttons & 1) seekTo(e.clientX);
    },
  };
  const atEnd = elapsed >= MONTH_S;

  return (
    <div className="border-t border-border bg-surface-2 px-4 py-2.5">
      {/* header: clock, position, speed, view */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-caption text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <button
            type="button"
            aria-label={running ? "Pause" : atEnd ? "Replay the month" : "Play"}
            title={running ? "Pause the clock" : atEnd ? "Replay the month" : "Play through the month"}
            onClick={() => studio.setRunning(!running)}
            className="flex size-7 items-center justify-center rounded-md bg-surface-3 text-foreground shadow-surface-1 transition-colors hover:bg-hover"
          >
            {running ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </button>
          <button
            type="button"
            aria-label="Reset clock"
            title="Reset to day 0"
            onClick={() => studio.resetClock()}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          >
            <RotateCcw className="size-3.5" />
          </button>
          <span>
            Day <span className="text-numeric text-foreground">{(elapsed / DAY).toFixed(1)}</span> of {MONTH_DAYS}
            {atEnd && !running ? " · month complete" : ""}
          </span>
          <span className="ml-1 inline-flex overflow-hidden rounded-md bg-muted p-0.5">
            {SPEEDS.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => studio.setSpeed(s.value)}
                className={`rounded px-1.5 py-0.5 text-[10.5px] text-numeric transition-colors ${speed === s.value ? "bg-surface-4 text-foreground shadow-surface-1" : "text-muted-foreground hover:text-foreground"}`}
                aria-pressed={speed === s.value}
              >
                {s.label}
              </button>
            ))}
          </span>
        </span>
        <span className="inline-flex items-center gap-3">
          <span className="hidden xl:inline">Drag anywhere on the track to scrub.</span>
          <span className="inline-flex overflow-hidden rounded-md bg-muted p-0.5">
            {(["bar", "tracks"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`rounded px-2 py-0.5 text-[10.5px] capitalize transition-colors ${view === v ? "bg-surface-4 text-foreground shadow-surface-1" : "text-muted-foreground hover:text-foreground"}`}
              >
                {v}
              </button>
            ))}
          </span>
        </span>
      </div>

      {view === "bar" ? (
        <BarView lines={lines} tone={tone} pos={pos} trackRef={trackRef} scrubHandlers={scrubHandlers} elapsed={elapsed} />
      ) : (
        <TracksView tracks={tracks} tone={tone} pos={pos} trackRef={trackRef} scrubHandlers={scrubHandlers} elapsed={elapsed} plan={plan} selectedId={selectedId} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Bar view: the compact scrubber with crossing markers
 * ------------------------------------------------------------------ */

function BarView({
  lines,
  tone,
  pos,
  trackRef,
  scrubHandlers,
  elapsed,
}: {
  lines: TrackLine[];
  tone: Map<string, string>;
  pos: number;
  trackRef: React.RefObject<HTMLDivElement | null>;
  scrubHandlers: { onPointerDown: (e: React.PointerEvent<HTMLElement>) => void; onPointerMove: (e: React.PointerEvent<HTMLElement>) => void };
  elapsed: number;
}) {
  const shown = lines.slice(0, 6);
  return (
    <>
      <div
        ref={trackRef}
        role="slider"
        aria-label="Simulated time"
        aria-valuemin={0}
        aria-valuemax={MONTH_DAYS}
        aria-valuenow={Number((elapsed / DAY).toFixed(1))}
        tabIndex={0}
        className="relative mt-2 h-8 cursor-ew-resize select-none"
        {...scrubHandlers}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") studio.seek(elapsed + DAY);
          if (e.key === "ArrowLeft") studio.seek(Math.max(0, elapsed - DAY));
        }}
      >
        <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
        <div className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-foreground/70 transition-[width] duration-100" style={{ width: `${pos * 100}%` }} />
        {Array.from({ length: MONTH_DAYS + 1 }, (_, d) => (
          <span key={d} className="absolute top-1/2 h-1 w-px -translate-y-1/2 bg-foreground/15" style={{ left: `${(d / MONTH_DAYS) * 100}%` }} />
        ))}
        {shown.map((l, i) => {
          if (!Number.isFinite(l.crossDay)) return null;
          const within = l.crossDay <= MONTH_DAYS;
          const left = Math.min(1, l.crossDay / MONTH_DAYS) * 100;
          const over = l.status === "over-free" || l.status === "charged";
          return (
            <Tooltip
              key={l.meter}
              content={
                l.isDaily
                  ? `${l.label}: daily cap of ${formatUnit(l.allowanceMonthly! / MONTH_DAYS, l.unit)} hits ${(l.crossDay * 24).toFixed(1)} h into each day${l.overage === "drop" ? "; requests fail after that" : l.overage === "block" ? "; blocked after that" : ""}`
                  : within
                    ? `${l.label}: ${formatCount(l.allowanceMonthly!)} ${l.unit} allowance crossed on day ${l.crossDay.toFixed(1)}`
                    : `${l.label}: stays under its allowance this month (${Math.round((l.monthly / l.allowanceMonthly!) * 100)}%)`
              }
            >
              <button
                type="button"
                aria-label={l.label}
                onClick={(e) => {
                  e.stopPropagation();
                  studio.seek(Math.min(MONTH_DAYS, l.crossDay) * DAY);
                }}
                className={`absolute -translate-x-1/2 rounded-full transition-transform hover:scale-125 ${l.isDaily ? "top-[2px] size-2 rounded-sm" : "top-1/2 size-2.5 -translate-y-1/2"}`}
                style={{ left: `${left}%`, background: tone.get(l.meter), boxShadow: over ? "0 0 0 2px var(--destructive)" : undefined, opacity: within || l.isDaily ? 1 : 0.5, zIndex: 2 + i }}
              />
            </Tooltip>
          );
        })}
        <div className="pointer-events-none absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow-surface-2 transition-[left] duration-100" style={{ left: `${pos * 100}%` }} />
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
        {shown.map((l) => (
          <span key={l.meter} className={`inline-flex items-center gap-1 ${l.status === "over-free" || l.status === "charged" ? "text-foreground" : ""}`}>
            <span className="inline-block size-1.5 rounded-full" style={{ background: tone.get(l.meter), boxShadow: l.status === "over-free" || l.status === "charged" ? "0 0 0 2px var(--destructive)" : undefined }} />
            {l.label}
            {Number.isFinite(l.crossDay) && (l.isDaily ? ` · ${(l.crossDay * 24).toFixed(0)}h/day` : l.crossDay <= MONTH_DAYS ? ` · day ${l.crossDay.toFixed(1)}` : "")}
          </span>
        ))}
        {shown.length === 0 && <span>No quota in play at this traffic.</span>}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Tracks view: one row per layer, percent of allowance over the month
 * ------------------------------------------------------------------ */

/** Path for a meter's usage as percent of allowance over 30 days, in a 30 × Y_MAX space (y grows downward). */
function trackPath(line: TrackLine): { path: string; overPath: string } {
  const allowance = line.allowanceMonthly!;
  const y = (pct: number) => Y_MAX - Math.min(Y_MAX, pct);
  if (!line.isDaily) {
    const endPct = (line.monthly / allowance) * 100;
    const path = `M0,${y(0)} L30,${y(endPct)}`;
    if (endPct <= 100) return { path, overPath: "" };
    const xCross = 100 / endPct * 30;
    // Region between the line and the 100% rule after the crossing.
    const overPath = `M${xCross},${y(100)} L30,${y(endPct)} L30,${y(100)} Z`;
    return { path, overPath };
  }
  // Daily: sawtooth. Each day climbs at the daily rate, clips at the cap, drops at midnight.
  const dailyPct = (line.daily / (allowance / MONTH_DAYS)) * 100;
  const parts: string[] = [];
  const over: string[] = [];
  for (let d = 0; d < MONTH_DAYS; d += 1) {
    if (dailyPct <= 100) {
      parts.push(`M${d},${y(0)} L${d + 1},${y(dailyPct)}`);
    } else {
      const xHit = d + 100 / dailyPct;
      parts.push(`M${d},${y(0)} L${xHit},${y(100)} L${d + 1},${y(100)}`);
      // The clipped stretch: demand kept climbing; the platform did not serve it.
      over.push(`M${xHit},${y(100)} L${d + 1},${y(Math.min(Y_MAX, dailyPct))} L${d + 1},${y(100)} Z`);
    }
  }
  return { path: parts.join(" "), overPath: over.join(" ") };
}

function TracksView({
  tracks,
  tone,
  pos,
  trackRef,
  scrubHandlers,
  elapsed,
  plan,
  selectedId,
}: {
  tracks: { id: string; label: string; product: string; line?: TrackLine }[];
  tone: Map<string, string>;
  pos: number;
  trackRef: React.RefObject<HTMLDivElement | null>;
  scrubHandlers: { onPointerDown: (e: React.PointerEvent<HTMLElement>) => void; onPointerMove: (e: React.PointerEvent<HTMLElement>) => void };
  elapsed: number;
  plan: "free" | "paid";
  selectedId: string | null;
}) {
  const day = elapsed / DAY;
  const valueAt = (l: TrackLine): number => {
    const allowance = l.allowanceMonthly!;
    if (!l.isDaily) return (l.daily * day) / allowance;
    const frac = day - Math.floor(day);
    const dailyPct = l.daily / (allowance / MONTH_DAYS);
    return Math.min(dailyPct * frac, Math.max(1, Math.min(dailyPct * frac, 1)));
  };
  const overTone = plan === "free" ? "var(--destructive)" : "var(--warning)";

  return (
    <div className="mt-2 grid grid-cols-[minmax(150px,200px)_minmax(0,1fr)_64px] gap-x-3">
      {/* rows */}
      <div className="contents">
        <div />
        <div ref={trackRef} className="relative cursor-ew-resize select-none" {...scrubHandlers} role="slider" aria-label="Simulated time" aria-valuemin={0} aria-valuemax={MONTH_DAYS} aria-valuenow={Number(day.toFixed(1))} tabIndex={0}>
          {/* day ruler */}
          <div className="relative h-4 text-[9.5px] text-numeric text-muted-foreground">
            {[0, 5, 10, 15, 20, 25, 30].map((d) => (
              <span key={d} className="absolute -translate-x-1/2" style={{ left: `${(d / MONTH_DAYS) * 100}%` }}>
                {d}
              </span>
            ))}
          </div>
        </div>
        <div />
      </div>
      <div className="col-span-3 max-h-[188px] overflow-y-auto">
        <div className="relative grid grid-cols-[minmax(150px,200px)_minmax(0,1fr)_64px] gap-x-3 gap-y-1">
          {tracks.map((t) => {
            const l = t.line;
            const selected = selectedId === t.id;
            const paths = l ? trackPath(l) : null;
            const now = l ? valueAt(l) : 0;
            const over = l ? l.status === "over-free" || l.status === "charged" : false;
            return (
              <div key={t.id} className="contents">
                <button
                  type="button"
                  onClick={() => studio.focus(t.id)}
                  className={`flex min-w-0 flex-col items-start rounded-md px-2 py-0.5 text-left leading-4 hover:bg-hover ${selected ? "bg-hover" : ""}`}
                  title={l ? `${l.label} · account total against its allowance` : "No metered quota"}
                >
                  <span className="w-full truncate text-[11.5px] text-foreground">{t.label}</span>
                  <span className="w-full truncate text-[10px] text-muted-foreground">{l ? l.label : `${t.product} · unmetered`}</span>
                </button>
                <div className={`relative cursor-ew-resize select-none rounded-md bg-surface-3/60 ${l ? "h-8" : "h-5"}`} {...scrubHandlers}>
                  <svg viewBox={`0 0 30 ${Y_MAX}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
                    {/* 100% rule */}
                    <line x1="0" x2="30" y1={Y_MAX - 100} y2={Y_MAX - 100} stroke="color-mix(in oklab, var(--foreground) 28%, transparent)" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray="3 3" />
                    {paths && paths.overPath && <path d={paths.overPath} fill={overTone} fillOpacity="0.35" />}
                    {paths ? (
                      <path d={paths.path} fill="none" stroke={tone.get(l!.meter)} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                    ) : (
                      <line x1="0" x2="30" y1={Y_MAX - 4} y2={Y_MAX - 4} stroke="var(--muted-foreground)" strokeOpacity="0.4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                    )}
                    {/* elapsed shade */}
                    <rect x={pos * 30} y="0" width={30 - pos * 30} height={Y_MAX} fill="var(--background)" fillOpacity="0.45" />
                  </svg>
                  <div className="pointer-events-none absolute inset-y-0 w-px bg-foreground" style={{ left: `${pos * 100}%` }} />
                </div>
                <div className={`self-center text-right text-[11px] text-numeric ${over ? "text-destructive" : "text-muted-foreground"}`}>
                  {l ? (
                    <>
                      <div className="text-foreground">{Math.round(now * 100)}%</div>
                      <div className="text-[9.5px]">{l.isDaily ? (Number.isFinite(l.crossDay) && l.crossDay < 1 ? `cap ${(l.crossDay * 24).toFixed(0)}h` : "daily") : Number.isFinite(l.crossDay) && l.crossDay <= MONTH_DAYS ? `day ${l.crossDay.toFixed(0)}` : "in budget"}</div>
                    </>
                  ) : (
                    <div className="text-[9.5px]">–</div>
                  )}
                </div>
              </div>
            );
          })}
          {tracks.length === 0 && <div className="col-span-3 py-2 text-caption text-muted-foreground">Add nodes to see their quota tracks.</div>}
        </div>
      </div>
    </div>
  );
}
