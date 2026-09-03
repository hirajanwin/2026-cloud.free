/**
 * Early WebMCP registration.
 *
 * The React bridge registers tools after hydration, which on a cold dev load
 * can be many seconds after first paint. An agent that lists tools before then
 * sees the bridge with nothing on it. This renders the tool surface (names,
 * descriptions, JSON Schemas) into an inline script in <head>, so the tools
 * exist from the first moment `document.modelContext` does. Their execute()
 * waits for the app to hand over the real runner; when the bridge mounts it
 * takes the runner, removes these stubs and registers the full versions.
 */
import { toWebMcpTool, type ToolDef } from "./define";

declare global {
  interface Window {
    __webmcpEarly?: { abort: () => void; count: number };
    /** Called by the app once the real tool runner exists. */
    __webmcpReady?: (run: (name: string, input: unknown) => Promise<unknown>) => void;
  }
}

export function earlyRegistrationScript(defs: ToolDef[]): string {
  const surface = defs.map((d) => {
    const t = toWebMcpTool(d);
    return { name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations };
  });
  const json = JSON.stringify(surface).replace(/</g, "\\u003c");
  return `(function(){var mc=document.modelContext;if(!mc||typeof mc.registerTool!=='function')return;var defs=${json};var ac=new AbortController();var run=null;var waiters=[];window.__webmcpReady=function(r){run=r;waiters.splice(0).forEach(function(w){w(r)})};window.__webmcpEarly={abort:function(){ac.abort()},count:defs.length};function ready(){return run?Promise.resolve(run):new Promise(function(res){waiters.push(res)})}defs.forEach(function(d){try{mc.registerTool({name:d.name,description:d.description,inputSchema:d.inputSchema,annotations:d.annotations,execute:function(input){return ready().then(function(r){return r(d.name,input)}).then(function(out){return {content:[{type:'text',text:JSON.stringify(out)}]}})}},{signal:ac.signal})}catch(e){}})})();`;
}
