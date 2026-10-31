-- Server-side pairing for signaling authorization.
ALTER TABLE "Presence" ADD COLUMN "requestedId" TEXT;
ALTER TABLE "Presence" ADD COLUMN "peerId" TEXT;

CREATE INDEX "Presence_requestedId_idx" ON "Presence"("requestedId");
CREATE INDEX "Presence_peerId_idx" ON "Presence"("peerId");
