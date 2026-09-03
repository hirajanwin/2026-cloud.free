/**
 * Third-party services: OpenAI, Shopify, Netlify. They sit on any canvas as
 * `external` nodes with a `service` attr ("openai.gpt55_chat") and meter what
 * they do per request, priced from the vendor's own pricing page. The
 * platform (Cloudflare or Vercel) never bills these; the bill shows them as
 * their own lines so the total stays honest.
 */
import { z } from "zod";
import raw from "./services.json";

const MeterSchema = z.object({
  id: z.string(),
  label: z.string(),
  unit: z.string(),
  pricePerUnitUsd: z.number(),
  freeMonthly: z.number(),
  /** Consumption per end-user request that reaches the node, in base units. */
  defaultPerRequest: z.number(),
  perRequestNote: z.string(),
  source: z.string(),
  unverified: z.boolean().optional(),
});
const ProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  tagline: z.string(),
  category: z.string(),
  docs: z.string(),
  role: z.enum(["compute", "store", "sink", "gate", "cache"]),
  meters: z.array(MeterSchema),
});
const VendorSchema = z.object({
  name: z.string(),
  asOf: z.string(),
  freePlanNote: z.string().nullable(),
  products: z.array(ProductSchema),
});

export type ServiceMeter = z.infer<typeof MeterSchema>;
export type ServiceProduct = z.infer<typeof ProductSchema>;
export type ServiceVendor = z.infer<typeof VendorSchema>;
export type VendorId = "openai" | "shopify" | "netlify";
export const VENDOR_IDS: readonly VendorId[] = ["openai", "shopify", "netlify"];

export const SERVICES: Record<VendorId, ServiceVendor> = {
  openai: VendorSchema.parse((raw as Record<string, unknown>).openai),
  shopify: VendorSchema.parse((raw as Record<string, unknown>).shopify),
  netlify: VendorSchema.parse((raw as Record<string, unknown>).netlify),
};

export const SERVICE_PREFIX = "svc:";

/** "openai.gpt55_chat" → the vendor and product, or null. */
export function resolveService(ref: unknown): { vendor: VendorId; vendorName: string; product: ServiceProduct } | null {
  if (typeof ref !== "string") return null;
  const [v, id] = ref.split(".");
  if (!VENDOR_IDS.includes(v as VendorId)) return null;
  const vendor = SERVICES[v as VendorId];
  const product = vendor.products.find((p) => p.id === id);
  return product ? { vendor: v as VendorId, vendorName: vendor.name, product } : null;
}

export function serviceMeterId(vendor: VendorId, product: string, meter: string): string {
  return `${SERVICE_PREFIX}${vendor}.${product}.${meter}`;
}

/** Look a service meter up from its id ("svc:openai.gpt55_chat.output_tokens"). */
export function serviceMeter(meterId: string): { vendor: VendorId; vendorName: string; product: ServiceProduct; meter: ServiceMeter } | null {
  if (!meterId.startsWith(SERVICE_PREFIX)) return null;
  const [v, p, ...rest] = meterId.slice(SERVICE_PREFIX.length).split(".");
  const res = resolveService(`${v}.${p}`);
  if (!res) return null;
  const meter = res.product.meters.find((m) => m.id === rest.join("."));
  return meter ? { ...res, meter } : null;
}

/** "1M tokens" → 1e6, "1k requests" → 1e3, anything else → 1. */
export function unitSize(unit: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*([kKmM])\b/.exec(unit);
  if (!m) return 1;
  const n = Number(m[1]);
  return n * (m[2].toLowerCase() === "k" ? 1e3 : 1e6);
}

/** Every product across vendors, for palettes and tools. */
export function listServices(vendor?: VendorId) {
  const ids = vendor ? [vendor] : VENDOR_IDS;
  return ids.flatMap((v) =>
    SERVICES[v].products.map((p) => ({
      service: `${v}.${p.id}`,
      vendor: v,
      vendorName: SERVICES[v].name,
      ...p,
    })),
  );
}
