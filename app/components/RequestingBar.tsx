"use client";

import CountdownRing from "./CountdownRing";

// Shown while a request is waiting on the stranger. With `durationMs` the ring
// drains over the window after which the request gives up; without one (video
// requests don't expire) it just spins.
export default function RequestingBar({
  title,
  subtitle,
  durationMs,
  color,
  onCancel,
}: {
  title: string;
  subtitle: string;
  durationMs?: number;
  color: string;
  onCancel: () => void;
}) {
  const dot = (
    <span
      className="h-2.5 w-2.5 rounded-full"
      style={{ background: color, boxShadow: `0 0 10px 2px ${color}` }}
    />
  );
  return (
    <div className="animate-pop-in absolute left-1/2 top-5 z-40 flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 items-center gap-3 rounded-full border border-white/10 bg-[#0b0f1d]/80 py-2 pl-2 pr-2 text-white shadow-[0_20px_50px_-12px_rgba(0,0,0,0.9)] backdrop-blur-xl">
      {durationMs ? (
        <CountdownRing durationMs={durationMs} size={40}>
          {dot}
        </CountdownRing>
      ) : (
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center">
          <span className="absolute inset-0.5 animate-spin rounded-full border-[2.5px] border-white/10 border-t-amber-300 motion-reduce:animate-none" />
          {dot}
        </span>
      )}
      <div className="min-w-0 flex-1" role="status">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-white/50">{subtitle}</p>
      </div>
      <button
        onClick={onCancel}
        className="rounded-full bg-white/10 px-4 py-2 text-xs font-medium text-white/80 transition hover:bg-white/15 hover:text-white"
      >
        Cancel
      </button>
    </div>
  );
}
