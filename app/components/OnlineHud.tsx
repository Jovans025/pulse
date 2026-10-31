"use client";

import { useState } from "react";
import type { PeerDot } from "@/lib/types";
import { localSolarHour } from "@/lib/geo";

// Bottom-left status: who's around, or — when you're the only light on — a
// nudge to invite someone, so an empty globe never feels like a broken one.
export default function OnlineHud({ peers }: { peers: PeerDot[] }) {
  const [copied, setCopied] = useState(false);
  const chatting = peers.filter((p) => p.busy).length;
  // Strangers where it's between midnight and 5 AM.
  const nightOwls = peers.filter((p) => localSolarHour(p.lng) < 5).length;

  async function invite() {
    const url = window.location.origin;
    try {
      // Phones get the native share sheet; desktops copy the link.
      if (navigator.share) {
        await navigator.share({ title: "Pulse", text: "Come say hi on Pulse", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Share sheet dismissed, or clipboard blocked — nothing to do.
    }
  }

  if (peers.length === 0) {
    return (
      <div className="animate-rise-in absolute bottom-9 left-4 z-10 w-[calc(100%-2rem)] max-w-xs rounded-2xl border border-white/10 bg-[#0b0f1d]/80 p-4 text-white shadow-[0_20px_50px_-12px_rgba(0,0,0,0.9)] backdrop-blur-xl">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <span className="h-2 w-2 rounded-full bg-white/30" />
          It&rsquo;s quiet right now
        </p>
        <p className="mt-1 text-[13px] leading-snug text-white/55">
          You&rsquo;re the only light on. Invite someone to drop in, or stay a
          while. New lights appear as people arrive.
        </p>
        <button
          onClick={invite}
          className="mt-3 w-full rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white/85 transition hover:bg-white/15 hover:text-white"
        >
          {copied ? "Link copied ✓" : "Invite someone"}
        </button>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="absolute bottom-9 left-4 z-10 flex items-center gap-2 rounded-full border border-white/10 bg-[#0b0f1d]/75 px-3.5 py-1.5 text-xs text-white/70 backdrop-blur-xl"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-300 opacity-60 motion-reduce:animate-none" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-300" />
      </span>
      <span>
        <span className="font-semibold text-white">{peers.length}</span>{" "}
        {peers.length === 1 ? "stranger" : "strangers"} online
        {chatting > 0 && <span className="text-white/45"> · {chatting} talking</span>}
        {nightOwls > 0 && (
          <span className="text-white/45">
            {" "}· {nightOwls} {nightOwls === 1 ? "night owl" : "night owls"} 🌙
          </span>
        )}
      </span>
    </div>
  );
}
