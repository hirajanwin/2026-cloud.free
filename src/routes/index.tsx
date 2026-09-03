import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@/components/app/Canvas";
import { Timeline } from "@/components/app/Timeline";
import { TrafficBar } from "@/components/app/Topbar";

export const Route = createFileRoute("/")({
  component: Studio,
  head: () => ({ meta: [{ title: "freenet.free · Studio" }] }),
});

const KEY = "freenet.timeline.h";
const MIN_H = 150;

/** Remembered height for the bottom dock (traffic bar + timeline). */
function useDockHeight(): [number, (h: number) => void] {
  const [h, setH] = useState(300);
  useEffect(() => {
    try {
      const v = Number(window.localStorage.getItem(KEY));
      if (v >= MIN_H) setH(v);
    } catch {
      /* no storage */
    }
  }, []);
  const set = useCallback((next: number) => {
    const clamped = Math.max(MIN_H, Math.min(Math.round(window.innerHeight * 0.7), Math.round(next)));
    setH(clamped);
    try {
      window.localStorage.setItem(KEY, String(clamped));
    } catch {
      /* no storage */
    }
  }, []);
  return [h, set];
}

function Studio() {
  const [dockH, setDockH] = useDockHeight();
  const drag = useRef<{ startY: number; startH: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = { startY: e.clientY, startH: dockH };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setDockH(drag.current.startH + (drag.current.startY - e.clientY));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-[160px] flex-1">
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
      {/* Drag handle: resize the bottom dock. */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize timeline"
        title="Drag to resize"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => setDockH(300)}
        className="dock-handle group relative z-10 h-2 shrink-0 cursor-row-resize touch-none bg-surface-2"
      >
        <span className="absolute left-1/2 top-1/2 h-1 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border transition-colors group-hover:bg-muted-foreground" />
      </div>
      <div className="flex shrink-0 flex-col overflow-hidden" style={{ height: dockH, ["--tl-h" as string]: `${dockH}px` }}>
        <TrafficBar />
        <Timeline />
      </div>
    </div>
  );
}
