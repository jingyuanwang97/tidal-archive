/** The archive's mark: three eccentric co-range contours and a still point. */
export function Mark({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.3">
        <ellipse cx="16" cy="16.6" rx="13" ry="12.2" />
        <ellipse cx="14.9" cy="15.5" rx="8.2" ry="7.6" />
        <ellipse cx="14" cy="14.6" rx="3.7" ry="3.4" />
      </g>
      <circle cx="13.7" cy="14.3" r="1.35" fill="var(--accent)" />
    </svg>
  )
}
