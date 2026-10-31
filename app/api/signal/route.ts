import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { SignalType } from "@/lib/types";
import { callerId, isPublicId, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TYPES: SignalType[] = [
  "request",
  "accept",
  "decline",
  "offer",
  "answer",
  "ice",
  "end",
];

const MAX_PAYLOAD = 64 * 1024; // SDP/ICE are small; cap to be safe.

// POST /api/signal — body { toId, type, payload? }. The sender is whoever owns
// the session token; a client can't claim to be someone else.
//
// Relaying is gated on server-side pairing (Presence.requestedId / peerId), so
// a session can only:
//   request  someone, when neither side is already in a connection
//   accept / decline  a request that was actually sent to it
//   offer / answer / ice  its current partner
//   end      its partner, or its own pending request
// Each check is a single conditional updateMany (atomic per row), so it holds
// under concurrency without interactive transactions over the pooler.
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const fromId = callerId(request);
  if (!fromId) return unauthorized();
  const { toId, type, payload } = (body ?? {}) as Record<string, unknown>;

  if (!isPublicId(toId) || toId === fromId) {
    return Response.json({ error: "invalid recipient" }, { status: 400 });
  }
  if (typeof type !== "string" || !VALID_TYPES.includes(type as SignalType)) {
    return Response.json({ error: "invalid type" }, { status: 400 });
  }
  if (
    payload !== undefined &&
    payload !== null &&
    (typeof payload !== "string" || payload.length > MAX_PAYLOAD)
  ) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }

  const signalType = type as SignalType;
  const payloadStr = typeof payload === "string" ? payload : null;

  switch (signalType) {
    case "request": {
      // Claim the outgoing slot: only if we're present and not connected.
      const claimed = await prisma.presence.updateMany({
        where: { id: fromId, peerId: null },
        data: { requestedId: toId },
      });
      if (claimed.count === 0) return conflict("already in a connection");

      const target = await prisma.presence.findUnique({
        where: { id: toId },
        select: { peerId: true },
      });
      // Offline or busy: give the slot back and auto-decline.
      if (!target || target.peerId !== null) {
        await prisma.presence.updateMany({
          where: { id: fromId, requestedId: toId },
          data: { requestedId: null },
        });
        await deliver(toId, fromId, "decline");
        return Response.json({ ok: true, autoDeclined: true });
      }
      break;
    }

    case "accept": {
      // Only a request that was really sent to us can be accepted.
      const requester = await prisma.presence.updateMany({
        where: { id: toId, requestedId: fromId, peerId: null },
        data: { requestedId: null, peerId: fromId, busy: true },
      });
      if (requester.count === 0) return forbidden();
      const me = await prisma.presence.updateMany({
        where: { id: fromId, peerId: null },
        data: { requestedId: null, peerId: toId, busy: true },
      });
      if (me.count === 0) {
        // We'd paired with someone else meanwhile: undo the requester side.
        await prisma.presence.updateMany({
          where: { id: toId, peerId: fromId },
          data: { peerId: null, busy: false },
        });
        return conflict("already in a connection");
      }
      break;
    }

    case "decline": {
      // Clears their pending request. Never touches `busy`: the decliner may
      // be mid-call with someone else.
      const cleared = await prisma.presence.updateMany({
        where: { id: toId, requestedId: fromId },
        data: { requestedId: null },
      });
      if (cleared.count === 0) return forbidden();
      break;
    }

    case "offer":
    case "answer":
    case "ice": {
      if (!payloadStr) {
        return Response.json({ error: "missing payload" }, { status: 400 });
      }
      const paired = await prisma.presence.count({
        where: { id: fromId, peerId: toId },
      });
      if (paired === 0) return forbidden();
      break;
    }

    case "end": {
      // Hang up on our partner…
      const hungUp = await prisma.presence.updateMany({
        where: { id: fromId, peerId: toId },
        data: { peerId: null, busy: false },
      });
      if (hungUp.count > 0) {
        await prisma.presence.updateMany({
          where: { id: toId, peerId: fromId },
          data: { peerId: null, busy: false },
        });
        break;
      }
      // …or withdraw our own pending request.
      const withdrawn = await prisma.presence.updateMany({
        where: { id: fromId, requestedId: toId },
        data: { requestedId: null },
      });
      if (withdrawn.count > 0) break;
      // Nothing to end (e.g. the other side already left and cleaned up).
      return Response.json({ ok: true, noop: true });
    }
  }

  // Signaling payloads only travel with offer / answer / ice.
  const carriesPayload =
    signalType === "offer" || signalType === "answer" || signalType === "ice";
  await deliver(fromId, toId, signalType, carriesPayload ? payloadStr : null);
  return Response.json({ ok: true });
}

async function deliver(
  fromId: string,
  toId: string,
  type: SignalType,
  payload: string | null = null,
) {
  await prisma.signal.create({ data: { fromId, toId, type, payload } });
}

function forbidden() {
  return Response.json({ error: "not allowed" }, { status: 403 });
}

function conflict(error: string) {
  return Response.json({ error }, { status: 409 });
}
