/**
 * Pricing data and the bill.
 *
 * Every price, quota and limit is loaded from pricing.<provider>.json, each
 * entry carrying a source URL and an as-of date. Nothing here invents a
 * number; if a value is unknown the JSON says null and the UI says so.
 */
import { z } from "zod";
import type { Provider } from "./dsl";
import type { MeterReadings, Plan } from "./types";
import { serviceMeter, unitSize } from "./services";
import cloudflareRaw from "./pricing.cloudflare.json";
import vercelRaw from "./pricing.vercel.json";

const Period = z.enum(["day", "month"]);

const MeterSchema = z.object({
  label: z.string(),
  unit: z.string(),
  free: z.object({
    quota: z.number().nullable(),
    period: Period,
    overage: z.enum(["drop", "block", "none"]),
    note: z.string().optional(),
  }),
  paid: z.object({
    included: z.number().nullable(),
    period: Period,
    pricePer: z.number().nullable(),
    per: z.number(),
    note: z.string().optional(),
  }),
  source: z.string(),
  unverified: z.boolean().optional(),
});

const PlanSchema = z.object({
  label: z.string(),
  monthlyUsd: z.number(),
  source: z.string(),
  /** A shared usage credit included in the plan fee (Vercel Pro). */
  creditUsd: z.number().optional(),
  note: z.string().optional(),
});

const PricingSchema = z.object({
  provider: z.enum(["cloudflare", "vercel"]),
  asOf: z.string(),
  plans: z.object({ free: PlanSchema, paid: PlanSchema }),
  meters: z.record(z.string(), MeterSchema),
  notes: z.array(z.string()),
});

export type MeterPricing = z.infer<typeof MeterSchema>;
export type PlanPricing = z.infer<typeof PlanSchema>;
export type Pricing = z.infer<typeof PricingSchema>;

export const PRICING: Record<Provider, Pricing> = {
  cloudflare: PricingSchema.parse(cloudflareRaw),
  vercel: PricingSchema.parse(vercelRaw),
};

/** Days in the projected month. Stated once so every panel agrees. */
export const DAYS_PER_MONTH = 30;

export type LineStatus =
  /** Within the free quota or the paid allowance. */
  | "ok"
  /** Over the free quota; the JSON says what the platform does then. */
  | "over-free"
  /** Over the paid allowance; charged at the listed rate. */
  | "charged"
  /** No metering for this line (included, or partner-billed). */
  | "unmetered";

export interface BillLine {
  meter: string;
  label: string;
  unit: string;
  daily: number;
  monthly: number;
  /** Free quota or paid allowance, in the meter's unit, normalised to month. */
  allowanceMonthly: number | null;
  allowancePeriod: "day" | "month";
  /** Amount over the allowance, in the meter's unit, per month. */
  overMonthly: number;
  costUsd: number;
  status: LineStatus;
  /** What the platform does when a free quota is exceeded. */
  overage: "drop" | "block" | "none";
  unverified: boolean;
  note?: string;
  source: string;
}

export interface Bill {
  provider: Provider;
  plan: Plan;
  planLabel: string;
  asOf: string;
  lines: BillLine[];
  /** Sum of metered overage before any credit. */
  usageUsd: number;
  creditUsd: number;
  planFeeUsd: number;
  /** What you would actually pay this month. */
  totalUsd: number;
  /** Free-plan breaches: meters whose quota is exceeded and what happens. */
  breaches: BillLine[];
  /** Meters that are unverified or partner-billed, so the reader knows. */
  caveats: string[];
}

/**
 * Price a set of daily meter readings.
 *
 * `daily` is the steady-state daily reading per meter. Monthly is daily × 30.
 * Quotas with `period: "day"` are compared against the daily figure, which
 * is how the free plans actually enforce them.
 */
export function computeBill(
  provider: Provider,
  plan: Plan,
  daily: MeterReadings,
): Bill {
  const pricing = PRICING[provider];
  const planInfo = pricing.plans[plan];
  const lines: BillLine[] = [];

  for (const [meter, d] of Object.entries(daily)) {
    // Third-party services bill the same on either plan; the platform never sees them.
    const svc = serviceMeter(meter);
    if (svc) {
      const m = d * DAYS_PER_MONTH;
      const size = unitSize(svc.meter.unit);
      const allowance = svc.meter.freeMonthly * size;
      const over = Math.max(0, m - allowance);
      const costUsd = svc.meter.pricePerUnitUsd > 0 ? (over / size) * svc.meter.pricePerUnitUsd : 0;
      lines.push({
        meter,
        label: `${svc.vendorName} · ${svc.meter.label}`,
        unit: svc.meter.unit,
        daily: d,
        monthly: m,
        allowanceMonthly: allowance > 0 ? allowance : null,
        allowancePeriod: "month",
        overMonthly: over,
        costUsd,
        status: svc.meter.pricePerUnitUsd > 0 ? (costUsd > 0 ? "charged" : "ok") : "unmetered",
        overage: "none",
        unverified: svc.meter.unverified === true,
        note: `Billed by ${svc.vendorName}, not by the platform. ${svc.meter.perRequestNote}.`,
        source: svc.meter.source,
      });
      continue;
    }
    const spec = pricing.meters[meter];
    if (!spec) continue;
    const m = d * DAYS_PER_MONTH;

    if (plan === "free") {
      const q = spec.free.quota;
      const compare = spec.free.period === "day" ? d : m;
      const allowanceMonthly =
        q === null ? null : spec.free.period === "day" ? q * DAYS_PER_MONTH : q;
      const overRaw = q === null ? 0 : Math.max(0, compare - q);
      const overMonthly =
        spec.free.period === "day" ? overRaw * DAYS_PER_MONTH : overRaw;
      const status: LineStatus =
        q === null ? "unmetered" : overRaw > 0 ? "over-free" : "ok";
      lines.push({
        meter,
        label: spec.label,
        unit: spec.unit,
        daily: d,
        monthly: m,
        allowanceMonthly,
        allowancePeriod: spec.free.period,
        overMonthly,
        costUsd: 0,
        status,
        overage: spec.free.overage,
        unverified: spec.unverified === true,
        note: spec.free.note,
        source: spec.source,
      });
    } else {
      const inc = spec.paid.included;
      const price = spec.paid.pricePer;
      const compare = spec.paid.period === "day" ? d : m;
      const allowanceMonthly =
        inc === null
          ? null
          : spec.paid.period === "day"
            ? inc * DAYS_PER_MONTH
            : inc;
      const overRaw =
        inc === null ? (price ? compare : 0) : Math.max(0, compare - inc);
      const overMonthly =
        spec.paid.period === "day" ? overRaw * DAYS_PER_MONTH : overRaw;
      const costUsd =
        price === null || price === 0
          ? 0
          : (overMonthly / spec.paid.per) * price;
      const status: LineStatus =
        price === null || price === 0
          ? "unmetered"
          : costUsd > 0
            ? "charged"
            : "ok";
      lines.push({
        meter,
        label: spec.label,
        unit: spec.unit,
        daily: d,
        monthly: m,
        allowanceMonthly,
        allowancePeriod: spec.paid.period,
        overMonthly,
        costUsd,
        status,
        overage: "none",
        unverified: spec.unverified === true,
        note: spec.paid.note,
        source: spec.source,
      });
    }
  }

  lines.sort((a, b) => b.costUsd - a.costUsd || b.monthly - a.monthly);

  // Vendor lines (OpenAI, Shopify, Netlify) are paid to the vendor: they are
  // never covered by the platform's plan credit and they cost money on the
  // free plan too.
  const vendorUsd = lines.filter((l) => serviceMeter(l.meter)).reduce((s, l) => s + l.costUsd, 0);
  const platformUsd = lines.reduce((s, l) => s + l.costUsd, 0) - vendorUsd;
  const usageUsd = platformUsd + vendorUsd;
  const creditUsd = plan === "paid" ? (planInfo.creditUsd ?? 0) : 0;
  const planFeeUsd = planInfo.monthlyUsd;
  const totalUsd =
    (plan === "free" ? 0 : planFeeUsd + Math.max(0, platformUsd - creditUsd)) + vendorUsd;
  const breaches = lines.filter((l) => l.status === "over-free");
  const caveats = lines
    .filter((l) => l.unverified)
    .map(
      (l) =>
        `${l.label}: ${l.note ?? "value not fully verified against the pricing page"}`,
    );

  return {
    provider,
    plan,
    planLabel: planInfo.label,
    asOf: pricing.asOf,
    lines,
    usageUsd,
    creditUsd,
    planFeeUsd,
    totalUsd,
    breaches,
    caveats,
  };
}

/**
 * For the free plan: the fraction of a meter's daily demand the platform will
 * actually serve before the quota cuts it off. 1 when there is no cap.
 * Only "drop" and "block" overage kinds cut traffic; "none" never does.
 */
export function freeServedFraction(
  provider: Provider,
  meter: string,
  daily: number,
): number {
  const spec = PRICING[provider].meters[meter];
  if (
    !spec ||
    spec.free.quota === null ||
    spec.free.overage === "none" ||
    daily <= 0
  )
    return 1;
  const q =
    spec.free.period === "day"
      ? spec.free.quota
      : spec.free.quota / DAYS_PER_MONTH;
  return Math.min(1, q / daily);
}

export function meterLabel(provider: Provider, meter: string): string {
  return PRICING[provider].meters[meter]?.label ?? meter;
}
