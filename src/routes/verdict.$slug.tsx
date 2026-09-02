import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TEMPLATES, templateById } from "@/engine/templates";
import { parse } from "@/engine/dsl";
import { PRODUCTS, isProductKind } from "@/engine/catalog";
import { studio } from "@/state/store";

export const Route = createFileRoute("/verdict/$slug")({
  loader: ({ params }) => {
    const t = templateById(params.slug);
    if (!t?.verdict) throw notFound();
    return { id: t.id };
  },
  head: ({ loaderData }) => {
    const t = loaderData ? templateById(loaderData.id) : undefined;
    return {
      meta: t?.verdict
        ? [
            { title: `Can I build ${t.verdict.product}? · Blueprint` },
            {
              name: "description",
              content: `${t.verdict.product}: ${t.tagline} How to rebuild the core loop on Cloudflare or Vercel, with a priced architecture.`,
            },
          ]
        : [],
    };
  },
  component: VerdictPage,
  notFoundComponent: () => (
    <div className="p-6 text-body">No verdict with that name.</div>
  ),
});

const CALL_LABEL = {
  yes: "Yes, build it",
  kinda: "Kinda",
  "not-really": "Not really",
} as const;
const CALL_COLOR = {
  yes: "green",
  kinda: "amber",
  "not-really": "red",
} as const;

function VerdictPage() {
  const { id } = Route.useLoaderData();
  const t = templateById(id)!;
  const v = t.verdict!;
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const diagram = parse(t.dsl).diagram;
  const kinds = [
    ...new Set(diagram.nodes.map((n) => n.kind).filter(isProductKind)),
  ];

  const open = () => {
    studio.loadTemplate(t.id);
    void navigate({ to: "/" });
  };

  return (
    <article className="mx-auto w-full max-w-3xl px-6 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-caption text-muted-foreground">
            Can I vibecode it on Cloudflare or Vercel?
          </div>
          <h1 className="mt-1 text-display font-medium tracking-tight">
            {v.product}
          </h1>
          <p className="mt-2 max-w-xl text-body text-muted-foreground">
            {t.tagline}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge color={CALL_COLOR[v.call]} size="default">
            {CALL_LABEL[v.call]}
          </Badge>
          <div className="text-caption text-muted-foreground">
            {v.priceNote}
          </div>
        </div>
      </header>

      <section className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl bg-surface-3 p-4 shadow-surface-2">
          <h2 className="text-subtitle font-medium">The core loop</h2>
          <p className="mt-1 text-caption text-muted-foreground">
            Buildable in a sitting.
          </p>
          <ul className="mt-3 flex flex-col gap-1.5 text-body">
            {v.core.map((c) => (
              <li key={c} className="flex gap-2">
                <span className="text-success">●</span>
                {c}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl bg-surface-3 p-4 shadow-surface-2">
          <h2 className="text-subtitle font-medium">Polish</h2>
          <p className="mt-1 text-caption text-muted-foreground">
            Nice, not the loop.
          </p>
          <ul className="mt-3 flex flex-col gap-1.5 text-body">
            {v.polish.map((c) => (
              <li key={c} className="flex gap-2">
                <span className="text-muted-foreground">○</span>
                {c}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mt-6 rounded-xl bg-surface-2 p-4 shadow-surface-1">
        <h2 className="text-subtitle font-medium">The architecture</h2>
        <p className="mt-1 text-body text-muted-foreground">{t.description}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {(["cloudflare", "vercel"] as const).map((p) => (
            <div
              key={p}
              className="rounded-lg bg-surface-3 p-3 shadow-surface-1"
            >
              <div className="text-caption font-medium">
                {p === "cloudflare" ? "On Cloudflare" : "On Vercel"}
              </div>
              <ul className="mt-1.5 flex flex-col gap-1 text-caption text-muted-foreground">
                {kinds
                  .filter((k) => k !== "client")
                  .map((k) => {
                    const prod = PRODUCTS[p][k];
                    return (
                      <li
                        key={k}
                        className={
                          prod.gap?.severity === "missing"
                            ? "text-destructive"
                            : ""
                        }
                      >
                        {prod.name}
                        {prod.gap ? ` · ${prod.gap.severity}` : ""}
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" onClick={open}>
            Open in the studio and price it
          </Button>
        </div>
        <p className="mt-2 text-caption text-muted-foreground">{t.lesson}</p>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <div>
          <h2 className="text-subtitle font-medium">Why people still pay</h2>
          <p className="mt-2 text-body text-muted-foreground">
            {v.whyPeoplePay}
          </p>
        </div>
        <div>
          <h2 className="text-subtitle font-medium">What you lose</h2>
          <ul className="mt-2 flex flex-col gap-1.5 text-body text-muted-foreground">
            {v.whatYouLose.map((c) => (
              <li key={c}>– {c}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-subtitle font-medium">The prompt</h2>
          <Button
            variant="tertiary"
            size="compact"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(v.prompt);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              } catch {
                /* ignore */
              }
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-surface-3 p-4 text-[12.5px] leading-5 text-foreground shadow-surface-1">
          {v.prompt}
        </pre>
        <p className="mt-2 text-caption text-muted-foreground">
          Paste into your coding agent. Then open the studio, set your traffic,
          and read the bill before you pick a provider.
        </p>
      </section>

      <footer className="mt-10 border-t border-border pt-4 text-caption text-muted-foreground">
        {v.product} is a trademark of its owner. This page describes how one
        could rebuild a similar core loop; it is not affiliated with {v.product}
        . Other verdicts:{" "}
        {TEMPLATES.filter((x) => x.verdict && x.id !== t.id)
          .map((x) => x.verdict!.product)
          .join(", ") || "more coming"}
        .
      </footer>
    </article>
  );
}
