import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { applyPrivacyOffset, isValidLatLng } from "@/lib/geo";
import { callerId, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/join — body { lat, lng } (raw coords), session token in the
// Authorization header; the presence id is derived from it.
// Applies a 1–3 km privacy offset and upserts the presence row. Raw
// coordinates are never stored.
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const id = callerId(request);
  if (!id) return unauthorized();
  const { lat, lng } = (body ?? {}) as Record<string, unknown>;

  if (!isValidLatLng(lat, lng)) {
    return Response.json({ error: "invalid coordinates" }, { status: 400 });
  }

  const offset = applyPrivacyOffset(lat as number, lng as number);

  await prisma.presence.upsert({
    where: { id },
    create: {
      id,
      lat: offset.lat,
      lng: offset.lng,
      busy: false,
      lastSeen: new Date(),
    },
    update: {
      lat: offset.lat,
      lng: offset.lng,
      lastSeen: new Date(),
    },
  });

  // Re-joining mid-chat (our row was reaped while the P2P line stayed up):
  // restore the pairing our partner still holds, so signaling keeps working.
  const partner = await prisma.presence.findFirst({
    where: { peerId: id },
    select: { id: true },
  });
  if (partner) {
    await prisma.presence.updateMany({
      where: { id, peerId: null },
      data: { peerId: partner.id, busy: true },
    });
  }

  return Response.json({ ok: true });
}
