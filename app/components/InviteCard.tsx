"use client";

import CountdownRing from "./CountdownRing";

// The stranger is asking for something (to connect, or to turn on video).
// Docked to the bottom (a sheet on phones) so the globe / chat stays visible.
export default function InviteCard({
  title,
  details,
  color,
  durationMs,
  declineLabel,
  acceptLabel,
  onAccept,
  onDecline,
}: {
  title: string;
  details: React.ReactNode;
  color: string;
  durationMs?: number;
  declineLabel: string;
  acceptLabel: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const dot = (
    <span
      className="h-3.5 w-3.5 animate-pulse rounded-full motion-reduce:animate-none"
      style={{ background: color, boxShadow: `0 0 14px 3px ${color}` }}
    />
  );
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:bottom-6">
      <div
        role="alertdialog"
        aria-labelledby="invite-title"
        className="animate-rise-in pointer-events-auto w-full max-w-sm rounded-3xl border border-white/10 bg-[#0b0f1d]/90 p-5 text-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl"
      >
        <div className="flex items-center gap-4">
          {durationMs ? (
            <CountdownRing durationMs={durationMs} size={52} color={color}>
              {dot}
            </CountdownRing>
          ) : (
            <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border-[2.5px] border-white/10">
              {dot}
            </span>
          )}
          <div className="min-w-0">
            <p id="invite-title" className="font-semibold">
              {title}
            </p>
            <div className="mt-0.5 text-[13px] leading-snug text-white/55">
              {details}
            </div>
          </div>
        </div>

        <div className="mt-5 flex gap-3">
          <button
            onClick={onDecline}
            className="flex-1 rounded-full border border-white/15 px-4 py-2.5 text-sm font-medium text-white/75 transition hover:border-white/30 hover:text-white"
          >
            {declineLabel}
          </button>
          <button
            onClick={onAccept}
            className="flex-1 rounded-full bg-gradient-to-r from-amber-300 to-orange-400 px-4 py-2.5 text-sm font-semibold text-[#1a1206] shadow-[0_6px_20px_-6px_rgba(255,170,80,0.6)] transition hover:brightness-110 active:scale-[0.98]"
          >
            {acceptLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
