"use client";

import { describeLocalTime, distanceKm, formatDistance } from "@/lib/geo";
import type { PeerDot } from "@/lib/types";
import CountdownRing from "./CountdownRing";

// Someone tapped your light. Docked to the bottom (a sheet on phones) so the
// arc to them stays visible on the globe above.
export default function IncomingRequest({
  peer,
  me,
  color,
  durationMs,
  onAccept,
  onDecline,
}: {
  peer: PeerDot | undefined;
  me: { lat: number; lng: number } | null;
  color: string;
  durationMs: number;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:bottom-6">
      <div
        role="alertdialog"
        aria-labelledby="incoming-title"
        className="animate-rise-in pointer-events-auto w-full max-w-sm rounded-3xl border border-white/10 bg-[#0b0f1d]/85 p-5 text-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl"
      >
        <div className="flex items-center gap-4">
          <CountdownRing durationMs={durationMs} size={52} color={color}>
            <span
              className="h-3.5 w-3.5 animate-pulse rounded-full motion-reduce:animate-none"
              style={{ background: color, boxShadow: `0 0 14px 3px ${color}` }}
            />
          </CountdownRing>
          <div className="min-w-0">
            <p id="incoming-title" className="font-semibold">
              A stranger wants to talk
            </p>
            {peer && me ? (
              <p className="mt-0.5 text-[13px] leading-snug text-white/55">
                {formatDistance(distanceKm(me, peer))}
                <br />
                {describeLocalTime(peer.lng)}
              </p>
            ) : (
              <p className="mt-0.5 text-[13px] text-white/55">
                Somewhere out there
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 flex gap-3">
          <button
            onClick={onDecline}
            className="flex-1 rounded-full border border-white/15 px-4 py-2.5 text-sm font-medium text-white/75 transition hover:border-white/30 hover:text-white"
          >
            Not now
          </button>
          <button
            onClick={onAccept}
            className="flex-1 rounded-full bg-gradient-to-r from-amber-300 to-orange-400 px-4 py-2.5 text-sm font-semibold text-[#1a1206] shadow-[0_6px_20px_-6px_rgba(255,170,80,0.6)] transition hover:brightness-110 active:scale-[0.98]"
          >
            Say hello
          </button>
        </div>
      </div>
    </div>
  );
}
