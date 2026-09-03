/**
 * One consistent glyph per product kind. Drawn here rather than borrowed so
 * both providers share a visual family; official logos are used only for the
 * provider mark, never for products (see README on trademarks).
 */
import type { ProductKind } from "@/engine/catalog";
import type { SVGProps } from "react";

/**
 * Cloudflare's own product icons, from cloudflare/cloudflare-docs (CC BY 4.0).
 * They are monochrome paths, so they are inlined and take `currentColor`.
 * Used only when the canvas shows Cloudflare; Vercel and generic views use
 * the hand-drawn glyphs below so two icon families never mix on one canvas.
 */
const CF_ICON_FILES = import.meta.glob("/src/assets/cf/*.svg", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const cfIcon = (file: string) => CF_ICON_FILES[`/src/assets/cf/${file}.svg`];
export const CF_ICONS: Partial<Record<string, string | undefined>> = {
  "edge-cache": cfIcon("cache"),
  waf: cfIcon("waf"),
  "bot-shield": cfIcon("bots"),
  "rate-limit": cfIcon("rules"),
  static: cfIcon("pages"),
  ssr: cfIcon("workers"),
  compute: cfIcon("workers"),
  kv: cfIcon("kv"),
  sql: cfIcon("d1"),
  blob: cfIcon("r2"),
  queue: cfIcon("queues"),
  actor: cfIcon("durable-objects"),
  workflow: cfIcon("workflows"),
  vector: cfIcon("vectorize"),
  llm: cfIcon("workers-ai"),
  "ai-gateway": cfIcon("ai-gateway"),
  search: cfIcon("ai-search"),
  cron: cfIcon("workers"),
  realtime: cfIcon("realtime"),
  hyperdrive: cfIcon("hyperdrive"),
  images: cfIcon("images"),
  stream: cfIcon("stream"),
  browser: cfIcon("browser-run"),
  turnstile: cfIcon("turnstile"),
  email: cfIcon("email-routing"),
  "load-balancer": cfIcon("load-balancing"),
  zaraz: cfIcon("zaraz"),
  analytics: cfIcon("analytics"),
  access: cfIcon("access"),
  container: cfIcon("containers"),
};

/** Normalise a docs icon: size it, make it inherit colour, strip hard-coded black. */
function prepareSvg(raw: string, size: number): string {
  return raw
    .replace(/<svg([^>]*)>/, (_m, attrs: string) => {
      const cleaned = attrs.replace(/\s(width|height)="[^"]*"/g, "");
      return `<svg${cleaned} width="${size}" height="${size}" fill="currentColor" aria-hidden="true" focusable="false">`;
    })
    .replace(/fill="#000(000)?"/g, 'fill="currentColor"')
    .replace(/fill="#fff(fff)?"/g, 'fill="var(--surface-3)"');
}

export function Glyph({
  kind,
  size = 18,
  provider,
  ...rest
}: {
  kind: ProductKind | string;
  size?: number;
  provider?: "cloudflare" | "vercel";
} & SVGProps<SVGSVGElement>) {
  const cf = provider === "cloudflare" ? CF_ICONS[kind] : undefined;
  if (cf) {
    return (
      <span
        className="inline-flex text-current"
        style={{ width: size, height: size }}
        dangerouslySetInnerHTML={{ __html: prepareSvg(cf, size) }}
      />
    );
  }
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...rest,
  };
  switch (kind) {
    case "client":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
          <circle cx="17" cy="9" r="2.2" />
          <path d="M15.5 14.2a4 4 0 0 1 5 3.8" />
        </svg>
      );
    case "edge-cache":
      return (
        <svg {...common}>
          <path d="M7 18h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.2 9.3 4.4 4.4 0 0 0 7 18Z" />
          <path d="M9 14h6M10.5 11h3" />
        </svg>
      );
    case "waf":
      return (
        <svg {...common}>
          <path d="M12 3 4.5 6v5.5c0 4.4 3.2 7.6 7.5 9.5 4.3-1.9 7.5-5.1 7.5-9.5V6L12 3Z" />
          <path d="M8.5 12h7M12 8.5v7" />
        </svg>
      );
    case "bot-shield":
      return (
        <svg {...common}>
          <path d="M12 3 4.5 6v5.5c0 4.4 3.2 7.6 7.5 9.5 4.3-1.9 7.5-5.1 7.5-9.5V6L12 3Z" />
          <path d="m9 12 2 2 4-4.5" />
        </svg>
      );
    case "rate-limit":
      return (
        <svg {...common}>
          <path d="M4 16a8 8 0 0 1 16 0" />
          <path d="M12 16 15.5 10.5" />
          <circle cx="12" cy="16" r="1.2" />
          <path d="M4 19h16" />
        </svg>
      );
    case "static":
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M4 9h16M9 9v11" />
        </svg>
      );
    case "ssr":
      return (
        <svg {...common}>
          <rect x="3.5" y="4" width="17" height="12" rx="2" />
          <path d="M8 20h8M12 16v4M7 8h6M7 11h10" />
        </svg>
      );
    case "compute":
      return (
        <svg {...common}>
          <path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z" />
        </svg>
      );
    case "kv":
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="6" rx="1.5" />
          <rect x="3.5" y="13" width="17" height="6" rx="1.5" />
          <path d="M7 8h.01M7 16h.01" />
        </svg>
      );
    case "sql":
      return (
        <svg {...common}>
          <ellipse cx="12" cy="6" rx="7.5" ry="2.8" />
          <path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6" />
          <path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" />
        </svg>
      );
    case "blob":
      return (
        <svg {...common}>
          <path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z" />
          <path d="M4 8.5 12 13l8-4.5M12 13v7" />
        </svg>
      );
    case "queue":
      return (
        <svg {...common}>
          <rect x="3" y="9" width="4" height="6" rx="1" />
          <rect x="10" y="9" width="4" height="6" rx="1" />
          <rect x="17" y="9" width="4" height="6" rx="1" />
          <path d="M7 12h3M14 12h3" />
        </svg>
      );
    case "actor":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
        </svg>
      );
    case "workflow":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="6" height="5" rx="1" />
          <rect x="15" y="4" width="6" height="5" rx="1" />
          <rect x="9" y="15" width="6" height="5" rx="1" />
          <path d="M6 9v3h12V9M12 12v3" />
        </svg>
      );
    case "vector":
      return (
        <svg {...common}>
          <path d="M4 20 20 4M4 20l6-1M4 20l1-6" />
          <circle cx="15" cy="9" r="1.2" />
          <circle cx="18" cy="14" r="1.2" />
          <circle cx="9" cy="8" r="1.2" />
        </svg>
      );
    case "llm":
      return (
        <svg {...common}>
          <path d="M12 3c-3 0-5 2-5 4.5 0 1 .3 1.8.8 2.5C6.7 10.7 6 11.9 6 13.3 6 16 8.5 18 12 18s6-2 6-4.7c0-1.4-.7-2.6-1.8-3.3.5-.7.8-1.5.8-2.5C17 5 15 3 12 3Z" />
          <path d="M12 18v3M9.5 21h5" />
        </svg>
      );
    case "ai-gateway":
      return (
        <svg {...common}>
          <path d="M4 12h5M15 12h5M9 7h6v10H9z" />
          <path d="M12 4v3M12 17v3" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="10.5" cy="10.5" r="6" />
          <path d="m15 15 5 5" />
        </svg>
      );
    case "cron":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "realtime":
      return (
        <svg {...common}>
          <path d="M3 12c3-6 6-6 9 0s6 6 9 0" />
        </svg>
      );
    case "external":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17M12 3.5c3 3 3 14 0 17M12 3.5c-3 3-3 14 0 17" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="3" />
        </svg>
      );
  }
}

/** Small provider marks. Word marks are used in text; this is only a colour dot. */
export function ProviderDot({
  provider,
  className = "",
}: {
  provider: "cloudflare" | "vercel";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 rounded-full ${provider === "cloudflare" ? "bg-brand-cloudflare" : "bg-brand-vercel"} ${className}`}
    />
  );
}
