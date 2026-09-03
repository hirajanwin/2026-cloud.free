/**
 * The timeline: scrub through a simulated month and see exactly when each
 * quota is crossed. Because rates are linear, the crossing time of a meter
 * is allowance / rate, which makes the markers exact rather than sampled.
 */
import { useMemo, useRef } from "react";
import { computeBill } from "@/engine/pricing";
import { formatCount, formatUnit } from "@/lib/format";
import { studio, useStudio } from "@/state/store";
import { Tooltip } from "@/components/ui/tooltip";
import { Pause, Play, RotateCcw } from "lucide-react";

const DAY = 86_400;
/** One hue per meter so the legend and the markers read together. */
const METER_TONES = ["var(--info)", "var(--success)", "var(--warning)", "#a78bfa", "#f472b6", "#22d3ee"];
const MONTH_DAYS = 30;

export function Timeline() {
  const elapsed = useStudio((s) => s.snapshot.elapsedS);
  const running = useStudio((s) => s.running);
  const rates = useStudio((s) => s.rates);
  const provider = useStudio((s) => s.provider);
  const plan = useStudio((s) => s.plan);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const bill = useMemo(
    () => computeBill(provider, plan, rates.daily),
    [provider, plan, rates],
  );
  const lines = useMemo(
    () =>
      bill.lines
        .filter((l) => l.allowanceMonthly !== null && l.monthly > 0)
        .map((l) => {
          const dailyRate = l.daily;
          // Daily quotas reset every day: the cap hits at the same hour each day.
          const crossDay =
            l.allowancePeriod === "day"
              ? dailyRate > 0
                ? l.allowanceMonthly! / MONTH_DAYS / dailyRate
                : Infinity
              : dailyRate > 0
                ? l.allowanceMonthly! / dailyRate
                : Infinity;
          return { ...l, crossDay, daily: l.allowancePeriod === "day" };
        })
        .sort((a, b) => a.crossDay - b.crossDay)
        .slice(0, 6),
    [bill],
  );

  const pos = Math.min(1, elapsed / (MONTH_DAYS * DAY));
  const seekTo = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const k = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    studio.seek(k * MONTH_DAYS * DAY);
  };

  return (
    <div className="border-t border-border bg-surface-2 px-4 py-2.5">
      <div className="flex items-center justify-between gap-3 text-caption text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <button
            type="button"
            aria-label={running ? "Pause" : "Play"}
            title={running ? "Pause the clock" : "Resume the clock"}
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
          Timeline · day{" "}
          <span className="text-numeric text-foreground">
            {(elapsed / DAY).toFixed(1)}
          </span>{" "}
          of {MONTH_DAYS}
        </span>
        <span>
          Drag to scrub. Markers show when a quota is crossed at the current
          mix.
        </span>
      </div>
      <div
        ref={trackRef}
        role="slider"
        aria-label="Simulated time"
        aria-valuemin={0}
        aria-valuemax={MONTH_DAYS}
        aria-valuenow={Number((elapsed / DAY).toFixed(1))}
        tabIndex={0}
        className="relative mt-2 h-8 cursor-ew-resize select-none"
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          seekTo(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) seekTo(e.clientX);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") studio.seek(elapsed + DAY);
          if (e.key === "ArrowLeft") studio.seek(Math.max(0, elapsed - DAY));
        }}
      >
        {/* track */}
        <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
        <div
          className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-foreground/70 transition-[width] duration-100"
          style={{ width: `${pos * 100}%` }}
        />
        {/* day ticks */}
        {Array.from({ length: MONTH_DAYS + 1 }, (_, d) => (
          <span
            key={d}
            className="absolute top-1/2 h-1 w-px -translate-y-1/2 bg-foreground/15"
            style={{ left: `${(d / MONTH_DAYS) * 100}%` }}
          />
        ))}
        {/* quota crossings */}
        {lines.map((l, i) => {
          if (!Number.isFinite(l.crossDay)) return null;
          const within = l.crossDay <= MONTH_DAYS;
          const left = Math.min(1, l.crossDay / MONTH_DAYS) * 100;
          const over = l.status === "over-free" || l.status === "charged";
          return (
            <Tooltip
              key={l.meter}
              content={
                l.daily
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
                className={`absolute -translate-x-1/2 rounded-full transition-transform hover:scale-125 ${l.daily ? "top-[2px] size-2 rounded-sm" : "top-1/2 size-2.5 -translate-y-1/2"}`}
                style={{
                  left: `${left}%`,
                  background: METER_TONES[i % METER_TONES.length],
                  boxShadow: over ? "0 0 0 2px var(--destructive)" : undefined,
                  opacity: within || l.daily ? 1 : 0.5,
                  zIndex: 2 + i,
                }}
              />
            </Tooltip>
          );
        })}
        {/* playhead */}
        <div
          className="pointer-events-none absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow-surface-2 transition-[left] duration-100"
          style={{ left: `${pos * 100}%` }}
        />
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
        {lines.map((l, i) => (
          <span key={l.meter} className={`inline-flex items-center gap-1 ${l.status === "over-free" || l.status === "charged" ? "text-foreground" : ""}`}>
            <span
              className="inline-block size-1.5 rounded-full"
              style={{ background: METER_TONES[i % METER_TONES.length], boxShadow: l.status === "over-free" || l.status === "charged" ? "0 0 0 2px var(--destructive)" : undefined }}
            />
            {l.label}
            {Number.isFinite(l.crossDay) &&
              (l.daily
                ? ` · ${(l.crossDay * 24).toFixed(0)}h/day`
                : l.crossDay <= MONTH_DAYS
                  ? ` · day ${l.crossDay.toFixed(1)}`
                  : "")}
          </span>
        ))}
        {lines.length === 0 && <span>No quota in play at this traffic.</span>}
      </div>
    </div>
  );
}
