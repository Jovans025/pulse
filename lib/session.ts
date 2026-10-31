// Server-side session identity.
//
// Each browser session holds a random 256-bit secret token and sends it with
// every request. Other users only ever see the *public* id derived from it,
// sha256(token). The token has far too much entropy to brute-force, so a
// public id (which /api/poll shares with everyone) can't be used to act as
// someone. The server always derives the caller's id from the token — it
// never trusts an id the client claims.
import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

const TOKEN_RE = /^[0-9a-f]{64}$/;
const PUBLIC_ID_RE = /^[0-9a-f]{32}$/;

export function publicIdFor(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 32);
}

export function isPublicId(value: unknown): value is string {
  return typeof value === "string" && PUBLIC_ID_RE.test(value);
}

function isToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}

// The caller's public id from `Authorization: Bearer <token>`, or from a
// `token` field in the body (sendBeacon can't set headers). Null if absent or
// malformed.
export function callerId(
  request: NextRequest,
  bodyToken?: unknown,
): string | null {
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : bodyToken;
  return isToken(token) ? publicIdFor(token) : null;
}

export function unauthorized() {
  return Response.json({ error: "missing or invalid session" }, { status: 401 });
}
