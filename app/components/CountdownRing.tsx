// A ring that drains over `durationMs` (pure CSS, no timers), with whatever
// you put inside it in the middle.
export default function CountdownRing({
  durationMs,
  size = 44,
  color = "#ffb547",
  children,
}: {
  durationMs: number;
  size?: number;
  color?: string;
  children?: React.ReactNode;
}) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="22" cy="22" r="20" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2.5" />
        <circle
          cx="22"
          cy="22"
          r="20"
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          pathLength={100}
          className="countdown-ring"
          style={{ "--countdown-ms": `${durationMs}ms` } as React.CSSProperties}
        />
      </svg>
      {children}
    </span>
  );
}
