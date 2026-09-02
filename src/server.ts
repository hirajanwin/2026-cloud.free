/**
 * Worker entry point.
 *
 * Order matters: the Agents SDK router must see the request first. If the
 * TanStack Start handler ran first it would 404 the agent's WebSocket paths.
 * The agent response is returned untouched; wrapping it in a new Response
 * breaks the WebSocket upgrade.
 */
import handler from "@tanstack/react-start/server-entry";
import { routeAgentRequest } from "agents";

export { ArchitectAgent } from "./agents/architect";

export default {
  async fetch(
    request: Request,
    env: Env,
  ): Promise<Response> {
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;
    return handler.fetch(request);
  },
} satisfies ExportedHandler<Env>;
