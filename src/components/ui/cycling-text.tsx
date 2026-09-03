/**
 * One line of text that swaps through phrases with a small vertical slide.
 * Pauses when the tab is hidden and respects reduced motion (still swaps,
 * without the movement, via CSS).
 */
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export function CyclingText({ phrases, intervalMs = 2800, className }: { phrases: string[]; intervalMs?: number; className?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (phrases.length < 2) return;
    const id = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      setI((n) => (n + 1) % phrases.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [phrases, intervalMs]);
  return (
    <span className={cn("cycling", className)} aria-live="polite">
      <span key={i} className="cycling-item">
        {phrases[i]}
      </span>
    </span>
  );
}
