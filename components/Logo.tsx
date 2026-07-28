/**
 * App logo — three columns of decreasing height, one per bucket, tinted
 * with each bucket's accent color (rose = Now, sky = Next, violet = Later).
 * The tapering shape visually echoes the "priority tapers as it moves out
 * in time" idea the app is built around.
 */
interface Props {
  className?: string;
  /** Pixel size (square). Default renders inline with an h1. */
  size?: number;
}

export function Logo({ className, size = 36 }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 36 36"
      className={className}
      aria-label="Now / Next / Later"
      role="img"
    >
      {/* Now — rose, tallest, opaque */}
      <rect x="3" y="6" width="7" height="26" rx="2" className="fill-rose-500" />
      {/* Next — sky, medium */}
      <rect x="14" y="12" width="7" height="20" rx="2" className="fill-sky-500" />
      {/* Later — violet, shortest */}
      <rect x="25" y="18" width="7" height="14" rx="2" className="fill-violet-500" />
    </svg>
  );
}
