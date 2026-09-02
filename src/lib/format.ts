export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return "–";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}k`;
  if (abs >= 100) return n.toFixed(0);
  if (abs >= 10) return n.toFixed(1);
  if (abs === 0) return "0";
  return n.toFixed(2);
}

export function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return "–";
  if (Math.abs(n) >= 1000) return `$${Math.round(n).toLocaleString("en-US")}`;
  if (Math.abs(n) >= 100) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
}

export function formatPct(n: number): string {
  if (!Number.isFinite(n)) return "–";
  return `${Math.round(n * 100)}%`;
}

export function formatElapsed(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatUnit(n: number, unit: string): string {
  if (
    unit === "GB" ||
    unit === "GB-hours" ||
    unit === "hours" ||
    unit === "GB-s"
  )
    return `${n >= 100 ? n.toFixed(0) : n.toFixed(2)} ${unit}`;
  return `${formatCount(n)} ${unit}`;
}
