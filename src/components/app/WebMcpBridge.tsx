/**
 * Registers the tool set with document.modelContext on mount and keeps the
 * store's WebMCP status current. Client-only: modelContext does not exist
 * during SSR.
 */
import { useEffect } from "react";
import { useStudio } from "@/state/store";
import { tools } from "@/tools";
import { activeCaller, registerTools, webmcpSupported } from "@/tools/webmcp";
import { studio } from "@/state/store";
import { toolLog } from "@/state/toollog";
import { runTool, toWebMcpTool } from "@/tools/define";
import "@/tools/early";

export function WebMcpBridge() {
  const enabled = useStudio((s) => s.webmcp.enabled);
  useEffect(() => {
    let cancelled = false;
    let unregister = () => {};
    const supported = webmcpSupported();
    studio.setWebmcp({ supported, registered: 0 });
    if (!supported || !enabled) return;

    // Wrap execute so calls made by the browser agent show up in the log too.
    const logged = tools.map((def) => ({
      ...def,
      execute: async (input: unknown) => {
        const started = performance.now();
        try {
          return await def.execute(input as never);
        } finally {
          toolLog.push({
            name: def.name,
            input,
            via: "webmcp",
            caller: activeCaller ?? "browser-agent",
            at: Date.now(),
            durationMs: Math.round(performance.now() - started),
          });
        }
      },
    }));
    // toWebMcpTool is referenced to keep the mapping in one place; registerTools does the conversion.
    void toWebMcpTool;

    // Hand the real runner to the early inline stubs, then retire them so the
    // full registrations below are the only ones the browser sees.
    const byName = new Map(logged.map((d) => [d.name, d]));
    window.__webmcpReady?.((name, input) => {
      const def = byName.get(name);
      if (!def) return Promise.reject(new Error(`Unknown tool ${name}`));
      return runTool(def, input);
    });
    window.__webmcpEarly?.abort();
    window.__webmcpEarly = undefined;

    registerTools(logged).then(({ registered, unregister: un }) => {
      if (cancelled) {
        un();
        return;
      }
      unregister = un;
      studio.setWebmcp({ registered });
    });
    return () => {
      cancelled = true;
      unregister();
      studio.setWebmcp({ registered: 0 });
    };
  }, [enabled]);
  return null;
}
