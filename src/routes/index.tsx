import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { Canvas } from "@/components/app/Canvas";
import { Timeline } from "@/components/app/Timeline";

export const Route = createFileRoute("/")({
  component: Studio,
  head: () => ({ meta: [{ title: "freenet.free · Studio" }] }),
});

function Studio() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-[50vh] flex-1">
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
      <Timeline />
    </div>
  );
}
