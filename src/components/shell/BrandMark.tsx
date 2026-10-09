/** CLINISCOPE mark: stacked record lines examined through a lens (original artwork). */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect width="32" height="32" rx="8" fill="rgb(var(--brand))" />
      <path d="M8 11h9M8 16h6M8 21h9" stroke="#fff" strokeOpacity=".55" strokeWidth="2" strokeLinecap="round" />
      <circle cx="20" cy="15" r="5.2" fill="none" stroke="#fff" strokeWidth="2.2" />
      <path d="M23.8 18.8l3.2 3.2" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
