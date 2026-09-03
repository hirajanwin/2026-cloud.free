/** The freenet.free mark: three nodes, one net. Same drawing as public/favicon.svg. */
export function Logo({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden="true">
      <rect x="2" y="2" width="60" height="60" rx="16" fill="#101010" />
      <path d="M18 44 L32 20 L46 44 M18 44 L46 44" fill="none" stroke="#7dd3fc" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
      <circle cx="32" cy="20" r="5.5" fill="#101010" stroke="#c4b5fd" strokeWidth="3" />
      <circle cx="18" cy="44" r="5.5" fill="#101010" stroke="#6ee7b7" strokeWidth="3" />
      <circle cx="46" cy="44" r="5.5" fill="#101010" stroke="#fdba74" strokeWidth="3" />
    </svg>
  );
}
