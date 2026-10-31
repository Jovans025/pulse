import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { callerId, isPublicId, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/leave — body { token, peerId? } (the token rides in the body because
// sendBeacon can't set headers). Removes the presence row and any
// pending signals to/from this user. If they were mid-connection, `peerId` is
// the other side: they get an `end` and are freed so their chat closes too.
// Called via navigator.sendBeacon on tab close, so the body may arrive as
// text — parse defensively.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown> | undefined;
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }

  const id = callerId(request, body?.token);
  if (!id) return unauthorized();
  const peerId = isPublicId(body?.peerId) ? body.peerId : undefined;

  // Independent cleanup deletes — no atomicity needed (and interactive
  // transactions are unreliable over a PgBouncer pooler).
  await prisma.signal.deleteMany({
    where: { OR: [{ toId: id }, { fromId: id }] },
  });
  await prisma.presence.deleteMany({ where: { id } });

  // Sent after the cleanup above, which would otherwise delete it.
  if (peerId && peerId !== id) {
    await prisma.presence.updateMany({
      where: { id: peerId },
      data: { busy: false },
    });
    await prisma.signal.create({
      data: { fromId: id, toId: peerId, type: "end", payload: null },
    });
  }

  return Response.json({ ok: true });
}
