/**
 * Registers the tool set with document.modelContext on mount and keeps the
 * store's WebMCP status current. Client-only: modelContext does not exist
 * during SSR.
 */
import { useEffect } from "react";
import { tools } from "@/tools";
import { activeCaller, registerTools, webmcpSupported } from "@/tools/webmcp";
import { studio } from "@/state/store";
import { toolLog } from "@/state/toollog";
import { toWebMcpTool } from "@/tools/define";

export function WebMcpBridge() {
  useEffect(() => {
    let cancelled = false;
    let unregister = () => {};
    const supported = webmcpSupported();
    studio.setWebmcp({ supported, registered: 0 });
    if (!supported) return;

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

    registerTools(logged).then(({ registered, unregister: un }) => {
      if (cancelled) {
        un();
        return;
      }
      unregister = un;
      studio.setWebmcp({ supported: true, registered });
    });
    return () => {
      cancelled = true;
      unregister();
    };
  }, []);
  return null;
}
