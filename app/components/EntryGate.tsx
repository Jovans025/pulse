"use client";

import { useState } from "react";

// How long the card takes to fade away before the camera flies in.
const EXIT_MS = 450;

export default function EntryGate({
  onReady,
  onlineCount,
}: {
  onReady: (lat: number, lng: number) => void;
  onlineCount: number;
}) {
  const [status, setStatus] = useState<
    "idle" | "locating" | "entering" | "error"
  >("idle");
  const [error, setError] = useState<string>("");

  function enter() {
    if (!("geolocation" in navigator)) {
      setStatus("error");
      setError("Your browser doesn't support location access.");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Let the card fade out first, so the fly-in is the next thing you see.
        setStatus("entering");
        window.setTimeout(
          () => onReady(pos.coords.latitude, pos.coords.longitude),
          EXIT_MS,
        );
      },
      (err) => {
        setStatus("error");
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission is required to place you on the map."
            : "Couldn't get your location. Please try again.",
        );
      },
      // High accuracy + maximumAge:0 forces a fresh fix (Wi-Fi/GPS scan)
      // instead of reusing the browser's cached IP-based location.
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  const busy = status === "locating" || status === "entering";

  return (
    // The overlay lets clicks through, so the globe stays draggable around the card.
    <div
      className={`pointer-events-none absolute inset-0 z-40 flex items-end justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] transition-opacity sm:items-center duration-500 ${
        status === "entering" ? "opacity-0" : "opacity-100"
      }`}
    >
      {/* Vignette: keeps the card legible over bright parts of the globe. */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#05070f]/90 sm:bg-[radial-gradient(ellipse_at_center,rgba(5,7,15,0.15)_0%,rgba(5,7,15,0.75)_70%)]" />

      <div
        className={`animate-rise-in pointer-events-auto relative w-full max-w-sm rounded-3xl border border-white/10 bg-[#0b0f1d]/70 p-7 text-center shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] backdrop-blur-xl transition-transform duration-500 sm:p-8 ${
          status === "entering" ? "scale-95" : ""
        }`}
      >
        <LiveBadge count={onlineCount} />

        <h1 className="mt-5 bg-gradient-to-b from-white to-white/60 bg-clip-text text-5xl font-semibold tracking-tight text-transparent">
          Pulse
        </h1>
        <p className="mx-auto mt-3 max-w-[18rem] text-[15px] leading-relaxed text-white/60">
          A living globe of anonymous strangers. Drop in, tap a light, start
          talking.
        </p>

        <button
          onClick={enter}
          disabled={busy}
          className="group mt-7 flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-amber-300 to-orange-400 px-6 py-3.5 font-semibold text-[#1a1206] shadow-[0_8px_30px_-6px_rgba(255,170,80,0.6)] transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300 active:scale-[0.98] disabled:cursor-default disabled:brightness-90"
        >
          {busy ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#1a1206]/30 border-t-[#1a1206]" />
              Finding you…
            </>
          ) : (
            <>
              Enter Pulse
              <span
                aria-hidden
                className="transition-transform group-hover:translate-x-0.5"
              >
                →
              </span>
            </>
          )}
        </button>

        {status === "error" && (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-300"
          >
            {error}
          </p>
        )}

        <ul className="mt-7 space-y-2 border-t border-white/10 pt-5 text-left text-[13px] text-white/50">
          <Point>No sign-up, no profile, no history.</Point>
          <Point>Your light sits 1–3 km from where you really are.</Point>
          <Point>Chat and video go peer-to-peer. Nothing is stored.</Point>
        </ul>
      </div>
    </div>
  );
}

function LiveBadge({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/70">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-300 opacity-60 motion-reduce:animate-none" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-300" />
      </span>
      {count === 0
        ? "Quiet right now. Be the first light"
        : `${count} ${count === 1 ? "stranger" : "strangers"} online now`}
    </span>
  );
}

function Point({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-amber-300/70" />
      {children}
    </li>
  );
}
