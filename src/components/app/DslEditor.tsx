/**
 * The document, editable. A plain textarea on purpose: the DSL is small and
 * the value of this panel is seeing exactly what the agents see.
 */
import { useEffect, useState } from "react";
import { studio, useStudio } from "@/state/store";
import { Button } from "@/components/ui/button";

export function DslEditor() {
  const source = useStudio((s) => s.source);
  const errors = useStudio((s) => s.parseErrors);
  const [draft, setDraft] = useState(source);
  const [copied, setCopied] = useState(false);
  const dirty = draft !== source;

  useEffect(() => setDraft(source), [source]);

  const apply = () => studio.setSource(draft);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") apply();
        }}
        spellCheck={false}
        className="min-h-0 flex-1 resize-none rounded-lg bg-surface-2 p-3 font-mono text-[12px] leading-5 text-foreground shadow-surface-1 outline-none focus-visible:outline-1"
        aria-label="Architecture DSL"
      />
      {errors.length > 0 && (
        <ul className="max-h-24 overflow-auto rounded-lg bg-destructive-light px-3 py-2 text-caption text-destructive">
          {errors.slice(0, 6).map((e, i) => (
            <li key={i}>
              {e.line > 0 ? `line ${e.line}: ` : ""}
              {e.message}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="compact"
          onClick={apply}
          disabled={!dirty}
        >
          Apply
        </Button>
        <Button
          variant="tertiary"
          size="compact"
          onClick={() => setDraft(source)}
          disabled={!dirty}
        >
          Revert
        </Button>
        <span className="ml-auto flex gap-1">
          <Button variant="ghost" size="compact" onClick={copy}>
            {copied ? "Copied" : "Copy DSL"}
          </Button>
        </span>
      </div>
      <p className="text-caption text-muted-foreground">
        ⌘↵ applies. Agents edit this same text through set_diagram and
        patch_diagram.
      </p>
    </div>
  );
}
