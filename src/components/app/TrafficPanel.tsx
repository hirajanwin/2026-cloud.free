/**
 * The traffic mix: how many requests a day and who is sending them. These
 * sliders are the "load until it breaks" control, except the thing that
 * breaks here is a quota or a bill.
 */
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  REQUEST_CLASSES,
  REQUEST_CLASS_DESCRIPTION,
  REQUEST_CLASS_LABEL,
  type RequestClass,
} from "@/engine/types";
import { formatCount } from "@/lib/format";
import { studio, useStudio } from "@/state/store";

// Log scale: 0..100 → 100 .. 100M requests per day.
const toPerDay = (v: number) => Math.round(10 ** (2 + (v / 100) * 6));
const fromPerDay = (n: number) =>
  Math.max(0, Math.min(100, ((Math.log10(Math.max(100, n)) - 2) / 6) * 100));

const CLASS_TONE: Record<RequestClass, string> = {
  human: "var(--foreground)",
  googlebot: "var(--info)",
  "ai-crawler": "var(--warning)",
  scraper: "var(--destructive)",
  botnet: "var(--destructive)",
};

export function TrafficPanel() {
  const mix = useStudio((s) => s.mix);
  const speed = useStudio((s) => s.speed);
  const running = useStudio((s) => s.running);
  const shareTotal =
    REQUEST_CLASSES.reduce((s, c) => s + mix.shares[c], 0) || 1;

  return (
    <div className="flex flex-col gap-5">
      <section>
        <Slider
          label="Requests per day"
          value={fromPerDay(mix.perDay)}
          onChange={(v) =>
            studio.setMix({
              perDay: toPerDay(typeof v === "number" ? v : v[0]),
            })
          }
          min={0}
          max={100}
          step={1}
          showValue
          valuePosition="right"
          formatValue={(v) => formatCount(toPerDay(v))}
        />
        <p className="mt-1 text-caption text-muted-foreground">
          Total across every class. Monthly figures use 30 days.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <div
          className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
          aria-hidden
        >
          {REQUEST_CLASSES.map((c) => (
            <span
              key={c}
              style={{
                width: `${(mix.shares[c] / shareTotal) * 100}%`,
                background: CLASS_TONE[c],
                opacity: c === "botnet" ? 0.6 : 1,
              }}
            />
          ))}
        </div>
        {REQUEST_CLASSES.map((c) => (
          <div key={c}>
            <Slider
              label={REQUEST_CLASS_LABEL[c]}
              value={Math.round((mix.shares[c] / shareTotal) * 100)}
              onChange={(v) => {
                const pct = (typeof v === "number" ? v : v[0]) / 100;
                // Keep the others in proportion so the total stays 100%.
                const others = REQUEST_CLASSES.filter((k) => k !== c);
                const otherTotal =
                  others.reduce((s, k) => s + mix.shares[k], 0) || 1;
                const shares = { ...mix.shares, [c]: pct };
                for (const k of others)
                  shares[k] = ((1 - pct) * mix.shares[k]) / otherTotal;
                studio.setMix({ shares });
              }}
              min={0}
              max={100}
              step={1}
              showValue
              valuePosition="right"
              formatValue={(v) =>
                `${v}% · ${formatCount((mix.perDay * v) / 100)}/d`
              }
              fillStyle={{ background: CLASS_TONE[c] }}
            />
            <p className="mt-0.5 text-caption text-muted-foreground">
              {REQUEST_CLASS_DESCRIPTION[c]}
            </p>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3 border-t border-border pt-4">
        <Switch
          label="Clock running"
          checked={running}
          onToggle={() => studio.setRunning(!running)}
        />
        <Slider
          label="Clock speed"
          value={Math.log10(speed) * 25}
          onChange={(v) =>
            studio.setSpeed(
              Math.round(10 ** ((typeof v === "number" ? v : v[0]) / 25)),
            )
          }
          min={0}
          max={125}
          step={1}
          showValue
          valuePosition="right"
          formatValue={(v) => {
            const s = 10 ** (v / 25);
            return s >= 86400
              ? `${(s / 86400).toFixed(1)} days/s`
              : s >= 3600
                ? `${(s / 3600).toFixed(0)} h/s`
                : s >= 60
                  ? `${(s / 60).toFixed(0)} min/s`
                  : `${s.toFixed(0)} s/s`;
          }}
        />
        <p className="text-caption text-muted-foreground">
          The clock only accumulates totals. Rates are exact for the current
          mix, so nothing here is sampled.
        </p>
      </section>
    </div>
  );
}
