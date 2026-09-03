/**
 * The bill. Every line links to the pricing page it came from, shows the
 * as-of date, and flags anything the data file could not verify.
 */
import { RollingNumber } from "@/components/ui/rolling-number";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { computeBill, type BillLine } from "@/engine/pricing";
import { gapsIn } from "@/engine/catalog";
import type { Provider } from "@/engine/dsl";
import { formatCount, formatUnit, formatUsd } from "@/lib/format";
import { studio, useStudio } from "@/state/store";
import { ProviderDot } from "./Glyph";

export function BillPanel() {
  const provider = useStudio((s) => s.provider);
  const plan = useStudio((s) => s.plan);
  const rates = useStudio((s) => s.rates);
  const diagram = useStudio((s) => s.diagram);

  const bill = useMemo(
    () => computeBill(provider, plan, rates.daily),
    [provider, plan, rates],
  );
  const other: Provider = provider === "cloudflare" ? "vercel" : "cloudflare";
  const otherBill = useMemo(
    () => computeBill(other, plan, studio.ratesFor(other, plan).daily),
    [other, plan, rates],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const otherGaps = useMemo(() => gapsIn(diagram.nodes, other), [diagram, other]);

  const lines = bill.lines.filter((l) => l.monthly > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl bg-surface-3 p-4 shadow-surface-2">
        <div className="flex items-baseline justify-between">
          <div className="text-caption text-muted-foreground">
            <ProviderDot provider={provider} className="mr-1.5" />
            {bill.planLabel} · projected month
          </div>
          <div className="text-caption text-muted-foreground">
            prices as of {bill.asOf}
          </div>
        </div>
        <div className="mt-1 text-numeric text-[28px] font-medium leading-8">
          <RollingNumber value={formatUsd(bill.totalUsd)} />
        </div>
        {plan === "paid" ? (
          <div className="mt-1 text-caption text-muted-foreground">
            {formatUsd(bill.planFeeUsd)} plan
            {bill.creditUsd > 0
              ? ` incl. ${formatUsd(bill.creditUsd)} credit`
              : ""}{" "}
            · {formatUsd(bill.usageUsd)} metered
          </div>
        ) : bill.breaches.length === 0 ? (
          <div className="mt-1 text-caption text-success">
            Fits in the free tier at this traffic.
          </div>
        ) : (
          <div className="mt-1 text-caption text-destructive">
            {bill.breaches.length} quota{bill.breaches.length > 1 ? "s" : ""}{" "}
            exceeded. Read what breaks below.
          </div>
        )}
      </div>

      {bill.breaches.length > 0 && (
        <div className="flex flex-col gap-2">
          {bill.breaches.map((l) => (
            <div
              key={l.meter}
              className="rounded-lg bg-destructive-light px-3 py-2 text-caption text-foreground"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-destructive">{l.label}</span>
                <span className="text-numeric text-destructive">
                  {formatUnit(l.monthly, l.unit)} /{" "}
                  {l.allowanceMonthly === null
                    ? "–"
                    : formatUnit(l.allowanceMonthly, l.unit)}
                </span>
              </div>
              <div className="mt-0.5 text-muted-foreground">
                {l.overage === "drop"
                  ? "Past the quota, requests fail."
                  : l.overage === "block"
                    ? "Past the quota, the feature is blocked."
                    : "No enforcement."}{" "}
                {l.note}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {lines.map((l) => (
          <Line key={l.meter} line={l} />
        ))}
        {lines.length === 0 && (
          <p className="text-caption text-muted-foreground">
            Nothing is metered yet. Add traffic or nodes.
          </p>
        )}
      </div>

      <div className="rounded-xl bg-surface-2 p-3 shadow-surface-1">
        <div className="flex items-baseline justify-between text-caption">
          <span className="text-muted-foreground">
            <ProviderDot provider={other} className="mr-1.5" />
            Same design on {other === "cloudflare"
              ? "Cloudflare"
              : "Vercel"} · {otherBill.planLabel}
          </span>
          <span className="text-numeric font-medium text-foreground">
            {plan === "paid"
              ? formatUsd(otherBill.totalUsd)
              : otherBill.breaches.length === 0
                ? "fits free tier"
                : `${otherBill.breaches.length} over`}
          </span>
        </div>
        {otherGaps.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 text-caption text-muted-foreground">
            {otherGaps.map((g) => (
              <li key={g.id}>
                <Badge
                  color={g.severity === "missing" ? "red" : "amber"}
                  variant="dot"
                  size="compact"
                  className="mr-1.5"
                >
                  {g.severity}
                </Badge>
                {g.id}: {g.note}
              </li>
            ))}
          </ul>
        )}
      </div>

      {bill.caveats.length > 0 && (
        <details className="text-caption text-muted-foreground">
          <summary className="cursor-pointer">
            Unverified figures ({bill.caveats.length})
          </summary>
          <ul className="mt-1 flex flex-col gap-1 pl-3">
            {bill.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Line({ line: l }: { line: BillLine }) {
  const pct =
    l.allowanceMonthly && l.allowanceMonthly > 0
      ? Math.min(1, l.monthly / l.allowanceMonthly)
      : null;
  const tone =
    l.status === "over-free"
      ? "var(--destructive)"
      : l.status === "charged"
        ? "var(--warning)"
        : l.status === "unmetered"
          ? "var(--muted-foreground)"
          : "var(--success)";
  return (
    <div className="rounded-lg bg-surface-3 px-3 py-2 shadow-surface-1">
      <div className="flex items-center justify-between gap-2 text-caption">
        <a
          href={l.source}
          target="_blank"
          rel="noreferrer"
          className="truncate text-foreground underline-offset-2 hover:underline"
          title="Open the pricing page"
        >
          {l.label}
        </a>
        <span className="shrink-0 text-numeric text-foreground">
          {l.costUsd > 0
            ? formatUsd(l.costUsd)
            : l.status === "unmetered"
              ? "included"
              : "$0"}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-numeric text-muted-foreground">
        <span>
          {formatCount(l.monthly)} {l.unit}/mo
          {l.allowanceMonthly !== null
            ? ` of ${formatCount(l.allowanceMonthly)}`
            : ""}
          {l.unverified ? " · unverified" : ""}
        </span>
        {pct !== null && <span>{Math.round(pct * 100)}%</span>}
      </div>
      {pct !== null && (
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full transition-[width] duration-200"
            style={{ width: `${pct * 100}%`, background: tone }}
          />
        </div>
      )}
    </div>
  );
}
