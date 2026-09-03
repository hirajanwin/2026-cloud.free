/**
 * The timeline: scrub through a simulated month and see exactly when each
 * quota is crossed. Because rates are linear, every meter's curve over the
 * month is known analytically: a monthly allowance is a straight line, a
 * daily cap is a sawtooth that clips at the cap and resets at midnight. The
 * Tracks view draws one row per layer, normalised to percent of allowance,
 * so the node that breaks first is the one whose line hits the 100% rule
 * first. Nothing here is sampled.
 */
import { RollingNumber } from "@/components/ui/rolling-number";
import { useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { computeBill, type BillLine } from "@/engine/pricing";
import { PRODUCTS, isProductKind } from "@/engine/catalog";
import { formatCount, formatUnit } from "@/lib/format";
import { PERIOD_DAYS, periodSeconds, studio, useStudio, type Period } from "@/state/store";
import { Tooltip } from "@/components/ui/tooltip";
import { toneFor } from "@/lib/tones";

const DAY = 86_400;
const MONTH_DAYS = 30;
/** One hue per meter so the legend and the markers read together. */
const METER_TONES = ["var(--info)", "var(--success)", "var(--warning)", "#a78bfa", "#f472b6", "#22d3ee", "#fb923c", "#34d399"];
const PERIODS: { value: Period; label: string; help: string }[] = [
  { value: "day", label: "Day", help: "Simulate one day. Daily caps show where in the day they hit." },
  { value: "month", label: "Month", help: "Simulate one billing month (30 days). Monthly allowances and daily caps both apply." },
  { value: "year", label: "Year", help: "Simulate a year. Monthly allowances reset twelve times; you see the steady-state rhythm." },
];
const SPANS_FOR: Record<Period, readonly number[]> = { day: [1, 0.5, 0.25], month: [30, 14, 7, 3, 1], year: [365, 180, 90, 30, 7] };
const MONTH_LEN = 365 / 12;
/** Vertical scale of a track, in percent of allowance. */
const Y_MAX = 160;

interface TrackLine extends BillLine {
  crossDay: number;
  isDaily: boolean;
}

export function Timeline() {
  const elapsed = useStudio((s) => s.snapshot.elapsedS);
  const running = useStudio((s) => s.running);
  const period = useStudio((s) => s.period);
  const periodDays = PERIOD_DAYS[period];
  const periodS = periodSeconds(period);
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
        return { id: n.id, label: n.label ?? product?.name ?? n.kind, product: product?.name ?? n.kind, line, tone: toneFor(n.id, diagram.nodes.map((x) => x.id)) };
      })
      // Metered rows first, tightest first; unmetered layers trail so the
      // rows that can break are the ones on screen.
      .sort((a, b) => (a.line?.crossDay ?? Infinity) - (b.line?.crossDay ?? Infinity));
  }, [diagram, rates, lines, provider]);

  const pos = Math.min(1, elapsed / periodS);
  const seekTo = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const k = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    studio.seek(k * periodS);
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
  const atEnd = elapsed >= periodS;

  return (
    <div className="bg-surface-2 px-4 py-2.5">
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
            {period === "day" ? (
              <>Hour <span className="text-numeric text-foreground">{((elapsed / DAY) * 24).toFixed(1)}</span> of 24</>
            ) : (
              <>Day <span className="text-numeric text-foreground">{(elapsed / DAY).toFixed(1)}</span> of {periodDays}</>
            )}
            {atEnd && !running ? ` · ${period} complete` : ""}
          </span>
          <span className="ml-1 inline-flex items-center gap-1 text-[10.5px]">
            <span className="hidden lg:inline">Simulate a</span>
          </span>
          <span className="inline-flex overflow-hidden rounded-md bg-muted p-0.5">
            {PERIODS.map((p) => (
              <Tooltip key={p.value} content={p.help}>
                <button
                  type="button"
                  onClick={() => studio.setPeriod(p.value)}
                  className={`rounded px-2 py-0.5 text-[10.5px] transition-colors ${period === p.value ? "bg-surface-4 text-foreground shadow-surface-1" : "text-muted-foreground hover:text-foreground"}`}
                  aria-pressed={period === p.value}
                >
                  {p.label}
                </button>
              </Tooltip>
            ))}
          </span>
        </span>
        <span className="inline-flex items-center gap-3">
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
        <BarView lines={lines} tone={tone} pos={pos} trackRef={trackRef} scrubHandlers={scrubHandlers} elapsed={elapsed} periodDays={periodDays} />
      ) : (
        <TracksView tracks={tracks} tone={tone} pos={pos} trackRef={trackRef} scrubHandlers={scrubHandlers} elapsed={elapsed} plan={plan} selectedId={selectedId} period={period} />
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
  periodDays,
}: {
  lines: TrackLine[];
  tone: Map<string, string>;
  pos: number;
  trackRef: React.RefObject<HTMLDivElement | null>;
  scrubHandlers: { onPointerDown: (e: React.PointerEvent<HTMLElement>) => void; onPointerMove: (e: React.PointerEvent<HTMLElement>) => void };
  elapsed: number;
  periodDays: number;
}) {
  const shown = lines.slice(0, 6);
  const MONTH_DAYS = periodDays;
  return (
    <>
      <div
        ref={trackRef}
        role="slider"
        aria-label="Simulated time"
        aria-valuemin={0}
        aria-valuemax={periodDays}
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
        {Array.from({ length: Math.min(periodDays, 30) + 1 }, (_, d) => (
          <span key={d} className="absolute top-1/2 h-1 w-px -translate-y-1/2 bg-foreground/15" style={{ left: `${(d / Math.min(periodDays, 30)) * 100}%` }} />
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
 * Tracks view: one row per layer, percent of allowance over a zoomable
 * window of the month, one continuous playhead, live readout while scrubbing.
 * ------------------------------------------------------------------ */


/**
 * Path for a meter's usage as percent of allowance over [start, start+span]
 * days, in a span × Y_MAX space (y grows downward). `resetDays` is how often
 * the allowance resets: 1 for daily caps, a month for monthly allowances
 * inside a year, Infinity when the period itself is the billing window.
 */
function trackPath(line: TrackLine, start: number, span: number, period: Period): { path: string; overPath: string } {
  const allowance = line.allowanceMonthly!;
  const y = (pct: number) => Y_MAX - Math.min(Y_MAX, pct);
  const X = (d: number) => d - start;
  const resetDays = line.isDaily ? 1 : period === "year" ? MONTH_LEN : Infinity;
  // percent of the allowance consumed per day
  const slope = line.isDaily ? (line.daily / (allowance / 30)) * 100 : (line.daily / allowance) * 100;
  if (!Number.isFinite(resetDays)) {
    const p0 = slope * start;
    const p1 = slope * (start + span);
    const path = `M0,${y(p0)} L${span},${y(p1)}`;
    if (p1 <= 100) return { path, overPath: "" };
    const xCross = Math.max(0, X(100 / slope));
    return { path, overPath: `M${xCross},${y(Math.max(100, p0))} L${span},${y(p1)} L${span},${y(100)} L${xCross},${y(100)} Z` };
  }
  const perReset = slope * resetDays; // percent reached by the end of one reset window
  const parts: string[] = [];
  const over: string[] = [];
  const first = Math.floor(start / resetDays);
  const last = Math.ceil((start + span) / resetDays);
  for (let k = first; k < last; k += 1) {
    const a = k * resetDays;
    const b = a + resetDays;
    if (perReset <= 100) {
      parts.push(`M${X(a)},${y(0)} L${X(b)},${y(perReset)}`);
    } else {
      const xHit = a + 100 / slope;
      parts.push(`M${X(a)},${y(0)} L${X(xHit)},${y(100)} L${X(b)},${y(100)}`);
      over.push(`M${X(xHit)},${y(100)} L${X(b)},${y(Math.min(Y_MAX, perReset))} L${X(b)},${y(100)} Z`);
    }
  }
  return { path: parts.join(" "), overPath: over.join(" ") };
}

function fmtDay(d: number, period: Period): string {
  const day = Math.floor(d);
  const h = Math.floor((d - day) * 24);
  const m = Math.floor(((d - day) * 24 - h) * 60);
  const hm = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  if (period === "day") return hm;
  if (period === "year") return `Month ${Math.floor(d / MONTH_LEN) + 1} · day ${Math.floor(d % MONTH_LEN) + 1}`;
  return `Day ${day} · ${hm}`;
}

function TracksView({
  tracks,
  pos,
  trackRef,
  elapsed,
  plan,
  selectedId,
  period,
}: {
  tracks: { id: string; label: string; product: string; line?: TrackLine; tone: string }[];
  tone: Map<string, string>;
  pos: number;
  trackRef: React.RefObject<HTMLDivElement | null>;
  scrubHandlers: unknown;
  elapsed: number;
  plan: "free" | "paid";
  selectedId: string | null;
  period: Period;
}) {
  const day = elapsed / DAY;
  const MONTH_DAYS = PERIOD_DAYS[period];
  const SPANS = SPANS_FOR[period];
  const snapshot = useStudio((s) => s.snapshot);
  const [span, setSpan] = useState<number>(MONTH_DAYS);
  const [start, setStart] = useState(0);
  // A new period resets the window to the whole period.
  const [seenPeriod, setSeenPeriod] = useState(period);
  if (seenPeriod !== period) {
    setSeenPeriod(period);
    setSpan(MONTH_DAYS);
    setStart(0);
  }
  const [hover, setHover] = useState<string | null>(null);
  void pos;

  // Follow the playhead when it leaves the window.
  const winStart = useMemo(() => {
    if (span >= MONTH_DAYS) return 0;
    if (day < start || day > start + span) return Math.min(MONTH_DAYS - span, Math.max(0, day - span * 0.2));
    return start;
  }, [day, start, span]);
  if (winStart !== start) setStart(winStart);

  const zoom = (dir: 1 | -1) => {
    const i = Math.max(0, SPANS.indexOf(span));
    const next = SPANS[Math.min(SPANS.length - 1, Math.max(0, i + dir))];
    setSpan(next);
    setStart(Math.min(MONTH_DAYS - next, Math.max(0, day - next / 2)));
  };
  const seekAt = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const k = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    studio.seek((start + k * span) * DAY);
  };
  const scrub = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      seekAt(e.clientX);
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (e.buttons & 1) seekAt(e.clientX);
    },
    onWheel: (e: React.WheelEvent<HTMLElement>) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && span < MONTH_DAYS) {
        setStart((v) => Math.min(MONTH_DAYS - span, Math.max(0, v + (e.deltaX / 400) * span)));
      }
    },
  };

  const valueAt = (l: TrackLine): number => {
    const allowance = l.allowanceMonthly!;
    const resetDays = l.isDaily ? 1 : period === "year" ? MONTH_LEN : Infinity;
    const slope = l.isDaily ? l.daily / (allowance / 30) : l.daily / allowance; // fraction per day
    const t = Number.isFinite(resetDays) ? day - Math.floor(day / resetDays) * resetDays : day;
    return Math.min(1, slope * t);
  };
  const overTone = plan === "free" ? "var(--destructive)" : "var(--warning)";
  const playX = Math.min(1, Math.max(0, (day - start) / span)) * 100;
  const inWindow = day >= start && day <= start + span;
  const ROW = 32;
  const offered = Object.values(snapshot.offered).reduce((a, b) => a + b, 0);

  // Ruler ticks: days when wide, hours when tight.
  const ticks: { x: number; label: string }[] = [];
  if (period === "year" && span > 60) {
    for (let mth = Math.ceil(start / MONTH_LEN); mth * MONTH_LEN <= start + span; mth += 1) ticks.push({ x: (mth * MONTH_LEN - start) / span, label: `M${mth + 1}` });
  } else if (span >= 7) for (let d = Math.ceil(start); d <= start + span; d += span >= 60 ? 10 : span >= 20 ? 5 : 1) ticks.push({ x: (d - start) / span, label: `${d}` });
  else {
    const stepH = span >= 3 ? 12 : 6;
    for (let h = Math.ceil(start * 24 / stepH) * stepH; h <= (start + span) * 24; h += stepH) ticks.push({ x: (h / 24 - start) / span, label: h % 24 === 0 ? `d${h / 24}` : `${h % 24}h` });
  }

  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center justify-between text-[10.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          Window
          <span className="inline-flex overflow-hidden rounded-md bg-muted p-0.5">
            <button type="button" aria-label="Zoom out" onClick={() => zoom(-1)} disabled={span >= MONTH_DAYS} className="rounded px-1.5 text-[11px] disabled:opacity-40 hover:text-foreground">−</button>
            <span className="px-1.5 text-numeric text-foreground">{span >= 1 ? `${span}d` : `${span * 24}h`}</span>
            <button type="button" aria-label="Zoom in" onClick={() => zoom(1)} disabled={span <= SPANS[SPANS.length - 1]} className="rounded px-1.5 text-[11px] disabled:opacity-40 hover:text-foreground">+</button>
          </span>
          {span < MONTH_DAYS && <span className="text-numeric">from day {start.toFixed(1)}</span>}
        </span>
      </div>

      {/* Fixed label/value widths so one playhead can span every row in the scroll area. */}
      <div className="relative" style={{ ["--label-w" as string]: "176px", ["--value-w" as string]: "72px", ["--gap" as string]: "12px" }}>
        {/* ruler */}
        <div className="grid grid-cols-[var(--label-w)_minmax(0,1fr)_var(--value-w)] gap-x-[var(--gap)]">
          <div className="h-4" />
          <div ref={trackRef} className="relative h-4 cursor-ew-resize select-none text-[9.5px] text-numeric text-muted-foreground" {...scrub} role="slider" aria-label="Simulated time" aria-valuemin={0} aria-valuemax={MONTH_DAYS} aria-valuenow={Number(day.toFixed(1))} tabIndex={0}>
            {ticks.map((t) => (
              <span key={t.label + t.x} className="absolute -translate-x-1/2" style={{ left: `${t.x * 100}%` }}>
                {t.label}
              </span>
            ))}
          </div>
          <div className="h-4" />
        </div>

        {/* rows: one scroll container for all three columns */}
        <div className="relative max-h-[168px] overflow-y-auto">
          <div className="grid grid-cols-[var(--label-w)_minmax(0,1fr)_var(--value-w)] gap-x-[var(--gap)]">
            {tracks.map((t) => {
              const l = t.line;
              const paths = l ? trackPath(l, start, span, period) : null;
              const over = l ? l.status === "over-free" || l.status === "charged" : false;
              return (
                <div key={t.id} className="contents">
                  <button
                    type="button"
                    onClick={() => studio.focus(t.id)}
                    onMouseEnter={() => setHover(t.id)}
                    onMouseLeave={() => setHover(null)}
                    style={{ height: ROW }}
                    className={`flex w-full min-w-0 items-center gap-2 rounded-md px-2 text-left leading-4 hover:bg-hover ${selectedId === t.id ? "bg-hover" : ""}`}
                    title={l ? `${l.label} · account total against its allowance` : "No metered quota"}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[11.5px]" style={{ color: `color-mix(in oklab, ${t.tone} 62%, var(--foreground))` }}>{t.label}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">{l ? l.label : `${t.product} · unmetered`}</span>
                    </span>
                  </button>
                  <div style={{ height: ROW }} className="cursor-ew-resize select-none py-0.5" {...scrub} onMouseEnter={() => setHover(t.id)} onMouseLeave={() => setHover(null)}>
                    <div className={`relative h-full rounded-md ${hover === t.id || selectedId === t.id ? "bg-surface-4/70" : "bg-surface-3/60"}`}>
                      <svg viewBox={`0 0 ${span} ${Y_MAX}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
                        <line x1="0" x2={span} y1={Y_MAX - 100} y2={Y_MAX - 100} stroke="color-mix(in oklab, var(--foreground) 28%, transparent)" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray="3 3" />
                        {paths && paths.overPath && <path d={paths.overPath} fill={overTone} fillOpacity="0.35" />}
                        {paths ? (
                          <path d={paths.path} fill="none" stroke={t.tone} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                        ) : (
                          <line x1="0" x2={span} y1={Y_MAX - 4} y2={Y_MAX - 4} stroke="var(--muted-foreground)" strokeOpacity="0.4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                        )}
                        {inWindow && <rect x={day - start} y="0" width={Math.max(0, span - (day - start))} height={Y_MAX} fill="var(--background)" fillOpacity="0.45" />}
                      </svg>
                    </div>
                  </div>
                  <div style={{ height: ROW }} className={`flex flex-col justify-center text-right text-[11px] text-numeric ${over ? "text-destructive" : "text-muted-foreground"}`}>
                    {l ? (
                      <>
                        <div className="text-foreground">{Math.round(valueAt(l) * 100)}%</div>
                        <div className="text-[9.5px]">{l.isDaily ? (Number.isFinite(l.crossDay) && l.crossDay < 1 ? `cap ${(l.crossDay * 24).toFixed(0)}h` : "daily") : Number.isFinite(l.crossDay) && l.crossDay <= MONTH_DAYS ? `day ${l.crossDay.toFixed(0)}` : "in budget"}</div>
                      </>
                    ) : (
                      <div className="text-[9.5px]">–</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {/* one playhead across every row, positioned in the middle column */}
          {inWindow && (
            <div
              className="pointer-events-none absolute bottom-0 top-0 w-px bg-foreground"
              style={{ left: `calc(var(--label-w) + var(--gap) + (100% - var(--label-w) - var(--value-w) - 2 * var(--gap)) * ${playX / 100})` }}
            />
          )}
        </div>

        {/* readout rides the playhead above the ruler */}
        {inWindow && (
          <div
            className="pointer-events-none absolute top-0 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-surface-4 px-2 py-0.5 text-[10.5px] text-numeric text-foreground shadow-surface-3"
            style={{ left: `calc(var(--label-w) + var(--gap) + (100% - var(--label-w) - var(--value-w) - 2 * var(--gap)) * ${playX / 100})` }}
          >
            <RollingNumber value={fmtDay(day, period)} /> · <RollingNumber value={formatCount(offered)} /> req · <span className="text-destructive"><RollingNumber value={formatCount(snapshot.outcomes.blocked)} /> blocked</span> · <span className="text-warning"><RollingNumber value={formatCount(snapshot.outcomes.dropped)} /> dropped</span>
            {hover && (() => { const t = tracks.find((x) => x.id === hover); return t?.line ? <> · {t.label} {Math.round(valueAt(t.line) * 100)}%</> : null; })()}
          </div>
        )}
      </div>
      {tracks.length === 0 && <div className="py-2 text-caption text-muted-foreground">Add nodes to see their quota tracks.</div>}
    </div>
  );
}
