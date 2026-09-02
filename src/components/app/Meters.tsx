/**
 * The strip under the canvas: where requests went, and the meters closest
 * to their quota. Live totals from the clock; rates from the engine.
 */
import { useMemo } from "react";
import { computeBill } from "@/engine/pricing";
import { REQUEST_CLASSES, REQUEST_CLASS_LABEL } from "@/engine/types";
import { formatCount, formatUnit } from "@/lib/format";
import { useStudio } from "@/state/store";

const CLASS_TONE: Record<string, string> = {
  human: "var(--foreground)",
  googlebot: "var(--info)",
  "ai-crawler": "var(--warning)",
  scraper: "var(--destructive)",
  botnet: "var(--destructive)",
};

export function Meters() {
  const snapshot = useStudio((s) => s.snapshot);
  const rates = useStudio((s) => s.rates);
  const provider = useStudio((s) => s.provider);
  const plan = useStudio((s) => s.plan);
  const bill = useMemo(
    () => computeBill(provider, plan, rates.daily),
    [provider, plan, rates],
  );
  const offered = REQUEST_CLASSES.reduce((s, c) => s + snapshot.offered[c], 0);
  const top = bill.lines
    .filter((l) => l.allowanceMonthly !== null && l.monthly > 0)
    .sort(
      (a, b) =>
        b.monthly / (b.allowanceMonthly || 1) -
        a.monthly / (a.allowanceMonthly || 1),
    )
    .slice(0, 4);

  return (
    <div className="grid grid-cols-1 gap-3 border-t border-border bg-surface-2 px-3 py-2.5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)]">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between text-caption text-muted-foreground">
          <span>Requests so far</span>
          <span className="text-numeric text-foreground">
            {formatCount(offered)}
          </span>
        </div>
        <div
          className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
          aria-hidden
        >
          {REQUEST_CLASSES.map((c) => (
            <span
              key={c}
              title={REQUEST_CLASS_LABEL[c]}
              style={{
                width: `${offered > 0 ? (snapshot.offered[c] / offered) * 100 : 0}%`,
                background: CLASS_TONE[c],
                opacity: c === "botnet" ? 0.6 : 1,
              }}
            />
          ))}
        </div>
        <div className="flex gap-3 text-caption text-numeric">
          <span className="text-success">
            served {formatCount(snapshot.outcomes.served)}
          </span>
          <span className="text-destructive">
            blocked {formatCount(snapshot.outcomes.blocked)}
          </span>
          <span className="text-warning">
            dropped {formatCount(snapshot.outcomes.dropped)}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 lg:grid-cols-4">
        {top.map((l) => {
          const pct = Math.min(1, l.monthly / (l.allowanceMonthly || 1));
          const over = l.status === "over-free" || l.status === "charged";
          return (
            <div key={l.meter} className="min-w-0">
              <div className="flex items-baseline justify-between gap-2 text-[11px]">
                <span
                  className="truncate text-muted-foreground"
                  title={l.label}
                >
                  {l.label}
                </span>
                <span
                  className={`shrink-0 text-numeric ${over ? "text-destructive" : "text-foreground"}`}
                >
                  {Math.round(pct * 100)}%
                </span>
              </div>
              <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full transition-[width] duration-200"
                  style={{
                    width: `${pct * 100}%`,
                    background: over
                      ? "var(--destructive)"
                      : pct > 0.8
                        ? "var(--warning)"
                        : "var(--success)",
                  }}
                />
              </div>
              <div className="mt-0.5 truncate text-[10.5px] text-numeric text-muted-foreground">
                {formatUnit(l.monthly, l.unit)} /{" "}
                {formatUnit(l.allowanceMonthly ?? 0, l.unit)}
              </div>
            </div>
          );
        })}
        {top.length === 0 && (
          <div className="col-span-full text-caption text-muted-foreground">
            No metered usage against a quota yet.
          </div>
        )}
      </div>
    </div>
  );
}
