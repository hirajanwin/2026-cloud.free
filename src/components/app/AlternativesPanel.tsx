/**
 * Every node on the canvas: what it is on this provider, what it would be on
 * the other, the gap if there is one, and the alternatives worth knowing.
 */
import { Badge } from "@/components/ui/badge";
import { PRODUCTS, alternativesFor, isProductKind } from "@/engine/catalog";
import { studio, useStudio } from "@/state/store";
import { toneFor } from "@/lib/tones";
import { Glyph } from "./Glyph";

export function AlternativesPanel() {
  const diagram = useStudio((s) => s.diagram);
  const provider = useStudio((s) => s.provider);
  const other = provider === "cloudflare" ? "vercel" : "cloudflare";
  const ids = diagram.nodes.map((n) => n.id);
  const nodes = diagram.nodes.filter((n) => n.kind !== "client" && isProductKind(n.kind));
  const otherName = other === "cloudflare" ? "Cloudflare" : "Vercel";
  return (
    <div className="flex flex-col gap-2 text-body">
      <div className="flex items-center justify-between text-caption text-muted-foreground">
        <span>
          On {provider === "cloudflare" ? "Cloudflare" : "Vercel"}, with the {otherName} counterpart
        </span>
        <button type="button" onClick={() => studio.setProvider(other)} className="text-info hover:underline">
          Switch to {otherName}
        </button>
      </div>
      {nodes.length === 0 && <p className="text-caption text-muted-foreground">Add products to the canvas to compare them.</p>}
      {nodes.map((n) => {
        const kind = n.kind as Parameters<typeof alternativesFor>[1];
        const here = isProductKind(n.kind) ? PRODUCTS[provider][n.kind] : undefined;
        const there = isProductKind(n.kind) ? PRODUCTS[other][n.kind] : undefined;
        const alts = alternativesFor(provider, kind);
        if (!here || !there) return null;
        return (
          <button
            key={n.id}
            type="button"
            onClick={() => studio.focus(n.id)}
            className="rounded-xl bg-surface-2 p-3 text-left shadow-surface-1 transition-colors hover:bg-hover"
          >
            <div className="flex items-center gap-2">
              <span className="inline-block size-2 rounded-full" style={{ background: toneFor(n.id, ids) }} aria-hidden />
              <span className="flex size-5 items-center justify-center text-muted-foreground">
                <Glyph kind={n.kind} size={14} provider={provider} />
              </span>
              <span className="min-w-0 flex-1 truncate text-body text-foreground">{n.label ?? here.name}</span>
              {here.gap && (
                <Badge color={here.gap.severity === "missing" ? "red" : "amber"} variant="dot" size="compact">
                  {here.gap.severity}
                </Badge>
              )}
            </div>
            <div className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-caption">
              <span className="text-muted-foreground">Here</span>
              <span className={here.gap?.severity === "missing" ? "text-destructive" : "text-foreground"}>{here.name}</span>
              <span className="text-muted-foreground">{otherName}</span>
              <span className={there.gap?.severity === "missing" ? "text-destructive" : "text-foreground"}>
                {there.name}
                {there.gap ? <span className="text-muted-foreground"> · {there.gap.severity}</span> : null}
              </span>
            </div>
            {here.gap && <p className="mt-1.5 text-caption text-muted-foreground">{here.gap.note}</p>}
            {alts.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {alts.map((a) => (
                  <Badge key={a} color="gray" variant="dot" size="compact">
                    {a}
                  </Badge>
                ))}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
