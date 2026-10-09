/** MEDGUARD mark: a guard shield framing two record lines (original artwork). */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect width="32" height="32" rx="8" fill="rgb(var(--brand))" />
      <path d="M16 6.2l7.6 2.9v5.9c0 5.1-3.3 8.9-7.6 10.8-4.3-1.9-7.6-5.7-7.6-10.8V9.1z" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
      <path d="M12.4 13.4h7.2M12.4 17.2h4.6" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}
