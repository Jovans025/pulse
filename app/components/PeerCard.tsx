"use client";

import { describeLocalTime, distanceKm, formatDistance } from "@/lib/geo";
import type { PeerDot } from "@/lib/types";

// Small card anchored above a tapped dot (rendered into a Mapbox marker, so it
// tracks the globe). Tapping a dot opens this instead of sending a request
// straight away, so a stray tap never pings a stranger.
export default function PeerCard({
  peer,
  me,
  color,
  canConnect,
  onConnect,
  onClose,
}: {
  peer: PeerDot;
  me: { lat: number; lng: number };
  color: string;
  canConnect: boolean;
  onConnect: () => void;
  onClose: () => void;
}) {
  const disabledReason = peer.busy
    ? "In another conversation"
    : !canConnect
      ? "Finish your current chat first"
      : null;

  return (
    <div className="animate-pop-in relative w-64 rounded-2xl border border-white/10 bg-[#0d1222] p-4 text-left text-white shadow-[0_20px_50px_-12px_rgba(0,0,0,0.9)]">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-1 h-3 w-3 shrink-0 rounded-full"
          style={{ background: color, boxShadow: `0 0 10px 2px ${color}` }}
        />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">A stranger</p>
          <p className="mt-0.5 text-[13px] text-white/55">
            {formatDistance(distanceKm(me, peer))}
          </p>
          <p className="text-[13px] text-white/55">
            {describeLocalTime(peer.lng)}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="-mr-1 -mt-1 rounded-full p-1.5 text-white/40 transition hover:bg-white/10 hover:text-white"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <button
        onClick={onConnect}
        disabled={!!disabledReason}
        autoFocus
        className="mt-4 w-full rounded-full bg-gradient-to-r from-amber-300 to-orange-400 px-4 py-2.5 text-sm font-semibold text-[#1a1206] shadow-[0_6px_20px_-6px_rgba(255,170,80,0.6)] transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 active:scale-[0.98] disabled:bg-none disabled:bg-white/10 disabled:text-white/45 disabled:shadow-none"
      >
        {disabledReason ?? "Say hello"}
      </button>

      {/* Pointer down to the dot. */}
      <span
        aria-hidden
        className="absolute -bottom-[7px] left-1/2 h-3.5 w-3.5 -translate-x-1/2 rotate-45 border-b border-r border-white/10 bg-[#0d1222]"
      />
    </div>
  );
}
