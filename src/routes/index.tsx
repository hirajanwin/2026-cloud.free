import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Tabs, TabItem, TabPanel, TabsList } from "@/components/ui/tabs";
import { Canvas } from "@/components/app/Canvas";
import { Meters } from "@/components/app/Meters";
import { Inspector } from "@/components/app/Inspector";
import { TrafficPanel } from "@/components/app/TrafficPanel";
import { BillPanel } from "@/components/app/BillPanel";
import { Chat } from "@/components/app/Chat";
import { DslEditor } from "@/components/app/DslEditor";
import { ActivityPanel } from "@/components/app/ActivityPanel";

export const Route = createFileRoute("/")({
  component: Studio,
  head: () => ({ meta: [{ title: "Blueprint · Studio" }] }),
});

const TABS = [
  { value: "inspect", label: "Inspect" },
  { value: "traffic", label: "Traffic" },
  { value: "bill", label: "Bill" },
  { value: "chat", label: "Architect" },
  { value: "code", label: "DSL" },
  { value: "activity", label: "Tools" },
] as const;

function Studio() {
  const [tab, setTab] = useState<string>("inspect");
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-h-[60vh] min-w-0 flex-col lg:min-h-0">
        <div className="relative min-h-0 flex-1">
          <ClientOnly
            fallback={
              <div className="flex h-full items-center justify-center text-caption text-muted-foreground">
                Loading canvas…
              </div>
            }
          >
            <Canvas />
          </ClientOnly>
        </div>
        <Meters />
      </div>
      <aside className="flex min-h-0 flex-col border-t border-border bg-surface-2 lg:border-l lg:border-t-0">
        <div className="px-3 pt-3">
          <Tabs value={tab} onValueChange={setTab} size="compact">
            <TabsList className="w-full">
              {TABS.map((t) => (
                <TabItem key={t.value} value={t.value} label={t.label} />
              ))}
            </TabsList>
            {TABS.map((t) => (
              <TabPanel key={t.value} value={t.value} className="hidden" />
            ))}
          </Tabs>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-3">
          {tab === "inspect" && <Inspector />}
          {tab === "traffic" && <TrafficPanel />}
          {tab === "bill" && <BillPanel />}
          {/* Kept mounted so the conversation survives switching tabs. */}
          <div hidden={tab !== "chat"} className="h-[calc(100vh-9rem)] min-h-[320px]">
            <ClientOnly fallback={null}>
              <Chat />
            </ClientOnly>
          </div>
          <div hidden={tab !== "code"} className="h-[calc(100vh-9rem)] min-h-[320px]">
            <DslEditor />
          </div>
          {tab === "activity" && <ActivityPanel />}
        </div>
      </aside>
    </div>
  );
}
