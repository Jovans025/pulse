"use client";

import { useEffect, useRef, useState } from "react";
import { describeLocalTime, distanceKm, formatDistance } from "@/lib/geo";
import type { PeerDot } from "@/lib/types";

export interface ChatMessage {
  id: number;
  mine: boolean;
  text: string;
  // Event lines in the conversation (e.g. a finished video call's length).
  system?: boolean;
}

export type ChatStatus = "connecting" | "connected" | "ended";

const MAX_MESSAGE_LENGTH = 1000;

// A floating glass panel on desktop (the globe and the lit arc stay visible
// beside it), a tall bottom sheet on phones.
export default function ChatPanel({
  messages,
  status,
  endedReason,
  peer,
  me,
  color,
  peerTyping,
  videoBusy,
  onSend,
  onTyping,
  onStartVideo,
  onEnd,
  onClose,
  overlay = false,
  hidden = false,
  onHide,
}: {
  messages: ChatMessage[];
  status: ChatStatus;
  endedReason?: string;
  peer: PeerDot | undefined;
  me: { lat: number; lng: number } | null;
  color: string;
  peerTyping: boolean;
  videoBusy: boolean;
  onSend: (text: string) => void;
  onTyping: () => void;
  onStartVideo: () => void;
  onEnd: () => void;
  onClose: () => void;
  // During video the chat floats over the call as a drawer; `hidden` keeps it
  // mounted (and your draft intact) while tucked away.
  overlay?: boolean;
  hidden?: boolean;
  onHide?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const connected = status === "connected";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, peerTyping, status]);

  // Jump straight into typing once the channel opens.
  useEffect(() => {
    if (connected) inputRef.current?.focus();
  }, [connected]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !connected) return;
    onSend(text);
    setDraft("");
  }

  const subtitle =
    status === "connecting"
      ? "Connecting peer-to-peer…"
      : status === "ended"
        ? "Conversation ended"
        : peer && me
          ? `${formatDistance(distanceKm(me, peer))} · ${describeLocalTime(peer.lng)}`
          : "Connected";

  return (
    <section
      aria-label="Chat with a stranger"
      className={`animate-rise-in absolute inset-x-0 bottom-0 ${overlay ? "z-40" : "z-20"} ${hidden ? "hidden" : "flex"} h-[88dvh] flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-[#0b0f1d]/85 text-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl sm:inset-x-auto sm:bottom-4 sm:right-4 sm:top-4 sm:h-auto sm:w-[380px] sm:rounded-3xl`}
    >
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <span
          aria-hidden
          className={`h-3 w-3 shrink-0 rounded-full ${status === "ended" ? "opacity-40" : ""}`}
          style={{ background: color, boxShadow: `0 0 10px 2px ${color}` }}
        />
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight">A stranger</p>
          <p className="truncate text-xs text-white/50">{subtitle}</p>
        </div>
        {status === "ended" ? (
          <IconButton label="Close" onClick={onClose}>
            <path d="M4 4l8 8M12 4l-8 8" />
          </IconButton>
        ) : (
          <>
            {onHide && (
              <IconButton label="Hide chat" onClick={onHide}>
                <path d="M4 6l4 4 4-4" />
              </IconButton>
            )}
            <IconButton
              label="Start video"
              onClick={onStartVideo}
              disabled={!connected || videoBusy}
            >
              <path d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h5a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5z" />
              <path d="M10.5 7l3-2v6l-3-2" />
            </IconButton>
            <button
              onClick={onEnd}
              className="rounded-full bg-rose-500/15 px-3.5 py-1.5 text-sm font-medium text-rose-300 transition hover:bg-rose-500/25 hover:text-rose-200"
            >
              End
            </button>
          </>
        )}
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
        <SystemLine>
          {status === "connecting" ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-white/20 border-t-white/70" />
              Opening a private line…
            </>
          ) : (
            <>
              <LockIcon />
              Peer-to-peer. Nothing is stored.
            </>
          )}
        </SystemLine>

        {connected && messages.length === 0 && !peerTyping && (
          <p className="mt-10 text-center text-sm text-white/40">
            You&rsquo;re connected. Say hello 👋
          </p>
        )}

        <ol className="mt-3 flex flex-col">
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const next = messages[i + 1];
            if (m.system) {
              return (
                <li key={m.id} className="animate-msg-in my-3 flex justify-center">
                  <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/55">
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h5a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5z" />
                      <path d="M10.5 7l3-2v6l-3-2" />
                    </svg>
                    {m.text}
                  </span>
                </li>
              );
            }
            // Bubbles from the same sender run together; event lines break a run.
            const grouped = !!prev && !prev.system && prev.mine === m.mine;
            const last = !next || !!next.system || next.mine !== m.mine;
            return (
              <li
                key={m.id}
                className={`animate-msg-in flex ${m.mine ? "justify-end" : "justify-start"} ${grouped ? "mt-1" : "mt-3"}`}
              >
                <span
                  className={`max-w-[80%] whitespace-pre-wrap break-words px-3.5 py-2 text-[15px] leading-snug ${
                    m.mine
                      ? `rounded-2xl bg-gradient-to-br from-amber-300 to-orange-400 text-[#1a1206] ${last ? "rounded-br-md" : ""}`
                      : `rounded-2xl border border-white/10 bg-white/[0.07] text-white/90 ${last ? "rounded-bl-md" : ""}`
                  }`}
                >
                  {m.text}
                </span>
              </li>
            );
          })}
        </ol>

        {peerTyping && status !== "ended" && (
          <div className="animate-msg-in mt-3 flex justify-start" aria-label="The stranger is typing">
            <span className="flex gap-1 rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.07] px-3.5 py-3">
              <span className="typing-dot" />
              <span className="typing-dot [animation-delay:150ms]" />
              <span className="typing-dot [animation-delay:300ms]" />
            </span>
          </div>
        )}

        {status === "ended" && (
          <SystemLine className="mt-5">{endedReason ?? "The conversation ended."}</SystemLine>
        )}
        <div ref={endRef} />
      </div>

      {/* Composer, or the way back once it's over */}
      <div className="border-t border-white/10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {status === "ended" ? (
          <button
            onClick={onClose}
            className="w-full rounded-full bg-gradient-to-r from-amber-300 to-orange-400 px-4 py-3 text-sm font-semibold text-[#1a1206] shadow-[0_6px_20px_-6px_rgba(255,170,80,0.6)] transition hover:brightness-110 active:scale-[0.98]"
          >
            Back to the globe
          </button>
        ) : (
          <form onSubmit={submit} className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (e.target.value) onTyping();
              }}
              placeholder={connected ? "Message" : "Connecting…"}
              disabled={!connected}
              maxLength={MAX_MESSAGE_LENGTH}
              aria-label="Message"
              className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2.5 text-[15px] text-white outline-none transition placeholder:text-white/35 focus:border-amber-300/50 focus:bg-white/[0.08] disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!connected || !draft.trim()}
              aria-label="Send"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-orange-400 text-[#1a1206] transition hover:brightness-110 active:scale-95 disabled:from-white/10 disabled:to-white/10 disabled:text-white/30"
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
              </svg>
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

function SystemLine({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`flex items-center justify-center gap-1.5 text-center text-xs text-white/40 ${className}`}
    >
      {children}
    </p>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-9 w-9 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30"
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}
