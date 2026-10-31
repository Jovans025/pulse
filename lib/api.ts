// Client-side helpers for talking to the coordination API.
//
// Every call is made with this session's secret token; the server derives our
// public id from it. The token never leaves this tab except to our own API.
import type { PollResponse, SignalType } from "@/lib/types";

// 256 random bits, hex-encoded. One per page load = one session.
export function newSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function authHeaders(token: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export async function join(
  token: string,
  lat: number,
  lng: number,
): Promise<void> {
  await fetch("/api/join", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ lat, lng }),
  });
}

export async function poll(token: string): Promise<PollResponse> {
  const res = await fetch("/api/poll", {
    headers: authHeaders(token),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`poll failed: ${res.status}`);
  return res.json();
}

export async function sendSignal(
  token: string,
  toId: string,
  type: SignalType,
  payload?: string,
): Promise<void> {
  await fetch("/api/signal", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ toId, type, payload }),
  });
}

// Fire-and-forget leave that survives the tab closing. sendBeacon can't set
// headers, so the token rides in the body. Pass `peerId` when mid-connection
// so the server can end the session for the other side.
export function leave(token: string, peerId?: string): void {
  const body = JSON.stringify({ token, peerId });
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon("/api/leave", body);
  } else {
    void fetch("/api/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
  }
}
