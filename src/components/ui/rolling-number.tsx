/**
 * Odometer text. Digits roll vertically to their new value; everything else
 * (separators, suffixes, letters) stays put. Pass any already-formatted
 * string, so number formatting lives with the caller.
 */
import { cn } from "@/lib/utils";

const DIGITS = "0123456789";

export function RollingNumber({ value, className }: { value: string; className?: string }) {
  const chars = Array.from(value);
  return (
    <span className={cn("rolling", className)} aria-label={value}>
      {chars.map((ch, i) => {
        const d = DIGITS.indexOf(ch);
        // Key by position from the end so digits keep their column as the number grows.
        const key = `${chars.length - i}`;
        if (d < 0)
          return (
            <span key={key} className="rolling-static" aria-hidden="true">
              {ch}
            </span>
          );
        return (
          <span key={key} className="rolling-digit" aria-hidden="true">
            <span className="rolling-column" style={{ transform: `translateY(-${d}em)` }}>
              {Array.from(DIGITS).map((n) => (
                <span key={n}>{n}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
