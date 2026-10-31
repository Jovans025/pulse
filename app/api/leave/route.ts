import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { callerId, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/leave — body { token } (in the body because sendBeacon can't set
// headers). Removes the presence row and any pending signals to/from this
// user, then tells everyone they were dealing with — their partner, whoever
// they'd asked, and anyone waiting on them — so those sessions close at once.
// Who that is comes from server-side pairing, never from the client.
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

  const me = await prisma.presence.findUnique({
    where: { id },
    select: { requestedId: true },
  });
  // Partners, and anyone with a pending request to us.
  const linked = await prisma.presence.findMany({
    where: { OR: [{ peerId: id }, { requestedId: id }] },
    select: { id: true },
  });

  // Independent cleanup writes — no atomicity needed (and interactive
  // transactions are unreliable over a PgBouncer pooler).
  await prisma.signal.deleteMany({
    where: { OR: [{ toId: id }, { fromId: id }] },
  });
  await prisma.presence.deleteMany({ where: { id } });
  await prisma.presence.updateMany({
    where: { peerId: id },
    data: { peerId: null, busy: false },
  });
  await prisma.presence.updateMany({
    where: { requestedId: id },
    data: { requestedId: null },
  });

  // Sent after the cleanup above, which would otherwise delete them.
  const notify = new Set(linked.map((p) => p.id));
  if (me?.requestedId) notify.add(me.requestedId);
  if (notify.size > 0) {
    await prisma.signal.createMany({
      data: [...notify].map((toId) => ({
        fromId: id,
        toId,
        type: "end",
        payload: null,
      })),
    });
  }

  return Response.json({ ok: true });
}
