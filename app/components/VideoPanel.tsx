"use client";

import { useEffect, useRef, useState } from "react";

type Corner = "tl" | "tr" | "bl" | "br";

// Self-view resting spots: below the top bar, above the control bar.
const CORNER_CLASSES: Record<Corner, string> = {
  tl: "left-4 top-20",
  tr: "right-4 top-20",
  bl: "left-4 bottom-32",
  br: "right-4 bottom-32",
};

export default function VideoPanel({
  localStream,
  remoteStream,
  color,
  micOn,
  camOn,
  remoteMicOn,
  remoteCamOn,
  chatOpen,
  unread,
  onToggleMic,
  onToggleCam,
  onToggleChat,
  onEnd,
}: {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  color: string;
  micOn: boolean;
  camOn: boolean;
  remoteMicOn: boolean;
  remoteCamOn: boolean;
  chatOpen: boolean;
  unread: number;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onToggleChat: () => void;
  onEnd: () => void;
}) {
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localRef.current && localRef.current.srcObject !== localStream) {
      localRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteRef.current && remoteRef.current.srcObject !== remoteStream) {
      remoteRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // Draggable self-view that snaps to the nearest corner on release.
  const [corner, setCorner] = useState<Corner>("br");
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number; rect: DOMRect } | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      rect: e.currentTarget.getBoundingClientRect(),
    };
    setDrag({ dx: 0, dy: 0 });
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const s = dragStart.current;
    if (!s) return;
    setDrag({ dx: e.clientX - s.x, dy: e.clientY - s.y });
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const s = dragStart.current;
    dragStart.current = null;
    setDrag(null);
    if (!s) return;
    const cx = s.rect.left + s.rect.width / 2 + (e.clientX - s.x);
    const cy = s.rect.top + s.rect.height / 2 + (e.clientY - s.y);
    const v = cy < window.innerHeight / 2 ? "t" : "b";
    const h = cx < window.innerWidth / 2 ? "l" : "r";
    setCorner(`${v}${h}` as Corner);
  }

  const showRemote = !!remoteStream && remoteCamOn;

  return (
    <div className="absolute inset-0 z-30 overflow-hidden bg-[#05070f] text-white">
      {/* Remote video, full-bleed. */}
      <video
        ref={remoteRef}
        autoPlay
        playsInline
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${showRemote ? "opacity-100" : "opacity-0"}`}
      />

      {/* Waiting / camera-off states sit where their face would be. */}
      {!showRemote && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5">
          <span className="relative flex h-24 w-24 items-center justify-center">
            <span
              className="absolute inset-0 animate-ping rounded-full opacity-20 motion-reduce:animate-none"
              style={{ background: color }}
            />
            <span
              className="h-10 w-10 rounded-full"
              style={{ background: color, boxShadow: `0 0 40px 10px ${color}` }}
            />
          </span>
          <p className="text-sm text-white/60">
            {remoteStream ? "Their camera is off" : "Waiting for their video…"}
          </p>
        </div>
      )}

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 flex items-center gap-3 bg-gradient-to-b from-black/60 to-transparent px-5 pb-10 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <span
          aria-hidden
          className="h-3 w-3 rounded-full"
          style={{ background: color, boxShadow: `0 0 10px 2px ${color}` }}
        />
        <p className="font-semibold">A stranger</p>
        {!remoteMicOn && (
          <span className="flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5 text-xs text-white/70 backdrop-blur">
            <MicIcon off className="h-3 w-3" /> Muted
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-xs text-white/50">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Peer-to-peer
        </span>
      </div>

      {/* Self-view */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={drag ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : undefined}
        className={`absolute ${CORNER_CLASSES[corner]} aspect-[3/4] w-28 cursor-grab touch-none overflow-hidden rounded-2xl border border-white/15 bg-[#0d1222] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.9)] active:cursor-grabbing sm:aspect-video sm:w-60 ${drag ? "" : "transition-all duration-300 ease-out"}`}
      >
        <video
          ref={localRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full -scale-x-100 object-cover ${camOn ? "" : "invisible"}`}
        />
        {!camOn && (
          <span className="absolute inset-0 flex items-center justify-center text-xs text-white/50">
            Camera off
          </span>
        )}
      </div>

      {/* Controls */}
      <div className="absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-black/70 to-transparent px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-12">
        <div className="flex items-center gap-3 rounded-full border border-white/10 bg-[#0b0f1d]/70 p-2 backdrop-blur-xl">
          <Control label={micOn ? "Mute" : "Unmute"} off={!micOn} onClick={onToggleMic}>
            <MicIcon off={!micOn} />
          </Control>
          <Control label={camOn ? "Turn camera off" : "Turn camera on"} off={!camOn} onClick={onToggleCam}>
            <CamIcon off={!camOn} />
          </Control>
          <Control label={chatOpen ? "Hide chat" : "Show chat"} active={chatOpen} onClick={onToggleChat}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z" />
            </svg>
            {unread > 0 && !chatOpen && (
              <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-300 px-1 text-[11px] font-bold text-[#1a1206]">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Control>
          <button
            onClick={onEnd}
            aria-label="Hang up video"
            title="Hang up video"
            className="flex h-12 w-14 items-center justify-center rounded-full bg-rose-500 text-white transition hover:bg-rose-400 active:scale-95"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden>
              <path d="M12 9c-3.2 0-6.1 1-8.4 2.8-.6.5-.7 1.3-.3 1.9l1.3 1.8c.4.6 1.2.8 1.9.5l2.3-1c.6-.3 1-.9.9-1.6l-.1-1.2c1.5-.4 3.3-.4 4.8 0l-.1 1.2c-.1.7.3 1.3.9 1.6l2.3 1c.7.3 1.5.1 1.9-.5l1.3-1.8c.4-.6.3-1.4-.3-1.9C18.1 10 15.2 9 12 9z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function Control({
  label,
  off,
  active,
  onClick,
  children,
}: {
  label: string;
  off?: boolean;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  // "Off" (muted / camera off) flips to a white button, so it's obvious at a glance.
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={off ?? active}
      className={`relative flex h-12 w-12 items-center justify-center rounded-full transition active:scale-95 ${
        off
          ? "bg-white text-[#0b0f1d]"
          : active
            ? "bg-amber-300/20 text-amber-200"
            : "bg-white/10 text-white hover:bg-white/15"
      }`}
    >
      {children}
    </button>
  );
}

function MicIcon({ off, className = "h-5 w-5" }: { off?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

function CamIcon({ off }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="6" width="12.5" height="12" rx="2.5" />
      <path d="M15.5 10.5L21 7.5v9l-5.5-3" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}
