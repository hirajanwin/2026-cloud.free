# Roadmap

What freenet.free does today is in the README. This is what comes next, in rough order. Dates are intentions, not promises; the order reflects what people asked for first.

## Now (next few weeks)

- **Partner pricing.** Marketplace products that the platform does not meter (Neon, Upstash, Inngest, QStash) currently show as unmetered. Model them the way OpenAI, Shopify and Netlify are modelled: vendor lines on the bill with a source URL per meter.
- **Web Analytics on by default** in the production deployment, and an `explain_charge` view in the Bill panel so the tool's answer is visible without asking the architect.
- **More default nets.** An e-commerce storefront on Shopify with a headless front end, a Netlify-hosted marketing site with forms and functions, a mobile backend, and an AI agent product with tool calls and long-running jobs.
- **Free-tier alerts in the timeline.** A marker at the exact hour a daily cap is crossed, with the platform's behaviour spelled out on hover.

## Next

- **Shareable nets.** Publish a read-only copy of a design at a URL. The public page exposes a read-only WebMCP surface (`get_diagram`, `get_bill`, `get_layers`, `compare_providers`) so an agent can review a plan without being able to edit it.
- **Export to infrastructure as code.** Beyond `wrangler.jsonc` and `vercel.json`: Terraform and Pulumi for the resources on the canvas, and a checklist of the manual steps each provider still needs.
- **Import from a running project.** Read a `wrangler.jsonc`, `vercel.json` or repository and draw the canvas from it, so an existing product can be priced and stress-tested.
- **Traffic profiles.** Named mixes (indie launch, Hacker News front page, scraping wave, steady SaaS) and the ability to schedule spikes across the simulated month.
- **Team memory.** Optional sign-in so freenets sync across devices instead of living in one browser.

## Later

- **More platforms.** Fly.io, Railway, Supabase and AWS Amplify as first-class providers, with the same honesty about gaps and partners.
- **Declarative-only mode.** Every tool reachable through the server-rendered forms, so an agent can drive the studio with JavaScript disabled or from a runtime that only reads markup.
- **Latency and regions.** Model where compute and data live, and what a request costs in time as well as money.
- **Cost history.** Keep pricing snapshots so a saved net can show how its bill would have changed as providers changed their pages.

## Principles that will not change

- The DSL is the source of truth; every view derives from it.
- Every number on the bill comes from a source URL with an as-of date. Unverified values are marked.
- Anything a person can do, an agent can do through the same tools, and every agent call is visible.
- Gaps and partner dependencies are shown, never smoothed over.

Have a use case that is not here? Open an issue at https://github.com/hirajanwin/freenet.free/issues.
