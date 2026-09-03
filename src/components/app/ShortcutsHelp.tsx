/**
 * Installs the global keyboard shortcuts and shows the cheat sheet on "?".
 */
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HELP_EVENT, installShortcuts, SHORTCUTS } from "@/lib/shortcuts";

const GROUPS = ["Simulation", "Design", "Canvas", "Panels", "App"] as const;

export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const stop = installShortcuts();
    const onHelp = () => setOpen((v) => !v);
    window.addEventListener(HELP_EVENT, onHelp);
    return () => {
      stop();
      window.removeEventListener(HELP_EVENT, onHelp);
    };
  }, []);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Single keys work whenever you are not typing. Press ? to close.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <section key={g}>
              <h3 className="mb-1.5 text-caption font-medium text-muted-foreground">{g}</h3>
              <ul className="flex flex-col gap-1">
                {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                  <li key={s.keys} className="flex items-baseline justify-between gap-3 text-body">
                    <span className="text-foreground">{s.label}</span>
                    <kbd className="shrink-0 rounded-md bg-surface-3 px-1.5 py-0.5 text-numeric text-[11px] text-muted-foreground shadow-surface-1">{s.keys}</kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
