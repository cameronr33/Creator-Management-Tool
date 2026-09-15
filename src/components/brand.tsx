import { useId } from "react";

/**
 * The Sentic mark — three translucent rounded tiles stepping from sky (top
 * right) through blue to lime (bottom left), with the overlaps drawn in the
 * exact colours the logo produces (#4B87BD where blue meets sky, #51889C
 * where blue meets lime). Pure SVG so it stays crisp at 16px and 160px.
 */
export function BrandMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  const id = useId();
  const sky = `${id}-sky`;
  const lime = `${id}-lime`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={sky}>
          <rect x="11" y="1" width="20" height="12" rx="2.5" />
        </clipPath>
        <clipPath id={lime}>
          <rect x="1" y="14" width="20" height="17" rx="2.5" />
        </clipPath>
      </defs>
      <rect x="11" y="1" width="20" height="12" rx="2.5" fill="#8BC1E3" />
      <rect x="1" y="14" width="20" height="17" rx="2.5" fill="#ABD044" />
      <rect x="5" y="6" width="20" height="17" rx="2.5" fill="#6093C5" />
      <rect x="5" y="6" width="20" height="17" rx="2.5" fill="#4B87BD" clipPath={`url(#${sky})`} />
      <rect x="5" y="6" width="20" height="17" rx="2.5" fill="#51889C" clipPath={`url(#${lime})`} />
    </svg>
  );
}

/** Mark + name, for the sidebar and the login screen. */
export function BrandLockup({
  size = 28,
  inverted = false,
  tagline = "by Sentic",
}: {
  size?: number;
  /** White text for navy backgrounds. */
  inverted?: boolean;
  tagline?: string | null;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark size={size} />
      <div className="leading-tight">
        <div className={`text-sm font-semibold ${inverted ? "text-white" : "text-text"}`}>Creator Manager</div>
        {tagline && (
          <div className={`text-[11px] ${inverted ? "text-sidebar-muted" : "text-text-faint"}`}>{tagline}</div>
        )}
      </div>
    </div>
  );
}
