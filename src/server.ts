/**
 * Worker entry point.
 *
 * Order matters: the Agents SDK router must see the request first. If the
 * TanStack Start handler ran first it would 404 the agent's WebSocket paths.
 * The agent response is returned untouched; wrapping it in a new Response
 * breaks the WebSocket upgrade.
 *
 * Everything else gets the platform hygiene a public site should have:
 * one canonical host, security headers on documents, and Cloudflare Web
 * Analytics injected at the edge when a token is configured.
 */
import handler from "@tanstack/react-start/server-entry";
import { routeAgentRequest } from "agents";

export { ArchitectAgent } from "./agents/architect";

const CANONICAL_HOST = "freenet.free";

const DOCUMENT_HEADERS: Record<string, string> = {
  "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "x-frame-options": "SAMEORIGIN",
  "cross-origin-opener-policy": "same-origin",
};

/** Appends the Web Analytics beacon to documents. Runs at the edge, so the app never sees the token. */
class Beacon {
  constructor(private token: string) {}
  element(el: Element) {
    el.append(
      `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${this.token}"}'></script>`,
      { html: true },
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // www → apex, permanently. Only for the production zone; workers.dev and localhost pass through.
    if (url.hostname === `www.${CANONICAL_HOST}`) {
      url.hostname = CANONICAL_HOST;
      return Response.redirect(url.toString(), 301);
    }

    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    let response = await handler.fetch(request);
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("text/html")) return response;

    const token = env.CF_WEB_ANALYTICS_TOKEN;
    if (token) response = new HTMLRewriter().on("body", new Beacon(token)).transform(response);

    const out = new Response(response.body, response);
    for (const [k, v] of Object.entries(DOCUMENT_HEADERS)) out.headers.set(k, v);
    return out;
  },
} satisfies ExportedHandler<Env>;
