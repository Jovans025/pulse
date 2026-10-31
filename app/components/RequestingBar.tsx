"use client";

import CountdownRing from "./CountdownRing";

// Shown while your request is waiting on the stranger. The ring drains over
// the same window after which the request gives up.
export default function RequestingBar({
  durationMs,
  color,
  onCancel,
}: {
  durationMs: number;
  color: string;
  onCancel: () => void;
}) {
  return (
    <div className="animate-pop-in absolute left-1/2 top-5 z-30 flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 items-center gap-3 rounded-full border border-white/10 bg-[#0b0f1d]/80 py-2 pl-2 pr-2 text-white shadow-[0_20px_50px_-12px_rgba(0,0,0,0.9)] backdrop-blur-xl">
      <CountdownRing durationMs={durationMs} size={40}>
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: color, boxShadow: `0 0 10px 2px ${color}` }}
        />
      </CountdownRing>
      <div className="min-w-0 flex-1" role="status">
        <p className="truncate text-sm font-medium">Reaching out…</p>
        <p className="truncate text-xs text-white/50">
          Waiting for them to say hello back
        </p>
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
