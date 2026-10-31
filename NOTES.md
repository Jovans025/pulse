# Pulse — Notes

- **Live:** https://pulse-d3gi.vercel.app/
- **Repo:** https://github.com/Jovans025/pulse

Every fix and feature is its own commit, with the reasoning in the commit
message. These notes are the summary.

**How I tested.** Two browser windows by hand, plus a headless-Chrome script
that drives two real sessions over the Chrome DevTools Protocol (London on
desktop, Paris on an emulated phone, Chrome's fake camera and mic). It runs
the whole flow: connect, chat both ways, video both ways, mute/camera
signalling, hang up, a **second** video call in the same chat (WebRTC
renegotiation), and leaving mid-call. I ran it after every change that
touched connections, including once against the live Vercel deployment.

---

## Phase 1 — Make it run

Found by reading the code end to end, reproducing in two windows, and
querying the database and API with `curl` to confirm each cause before
fixing it.

| # | What was broken | Cause | Fix |
|---|---|---|---|
| 1 | Stuck on "Connecting…" forever | ICE candidates that arrived before the offer were queued, but the queue was flushed **before** `setRemoteDescription`. Adding a candidate then throws, an empty `catch {}` hid it, and the queue was never retried. With no candidates, ICE never connects. | Flush after `setRemoteDescription`. |
| 2 | Chat messages never arrive | The sender sends `{t:"msg"}`, the receiver only accepts `t === "chat"`. | Send `"chat"`. |
| 3 | Dots stay on the map after people leave (the README example) | The heartbeat was `updateMany({ where: {} })`, so any one poll refreshed **every** row's `lastSeen` and nobody ever went stale. | `where: { id }`. Verified a silent user disappears after 15s. |
| 4 | After a first chat, nobody can reach you again | `end` never cleared `busy`, so the server auto-declined every later request. | Clear `busy` on `end`. |
| 5 | Closing the tab leaves your partner hanging (~30s+) and stuck as busy | Leaving sent no `end`, and only the `failed` connection state was handled. | The leave beacon ends the session for the partner. A data-channel close is also treated as the peer leaving, as a backup when the beacon never arrives. |
| 6 | A user who goes 15s without polling vanishes for good | A throttled background tab, sleep or a network blip gets the row reaped, and polling never recreates it. | Poll reports `present: false`, and the client rejoins. |
| 7 | No way to end a video call | The video area's flexbox `min-height: auto` let the camera's native resolution push the End button below the screen (`overflow-hidden`). | `min-h-0` and an absolutely positioned video. |

## Phase 2 — Make it good

**Direction:** "a living night-side globe". The product pitch is *a living
globe of strangers*, so I made the globe the hero and carried one visual
language through every screen: deep navy, warm amber "city lights", glass
panels.

**Visual redesign**
- **Globe:** Mapbox globe projection, an atmosphere fading into a starfield, a
  slow idle spin, and a fly-in from space to your region when you enter.
- **Entry screen:** a glass card floating over the live, spinning globe,
  showing how many strangers are online right now, so the first thing you
  see is the product.
- **Every screen:** request bars, incoming prompts, chat and video share
  the same visual language. Geist font (the original CSS overrode it with
  Arial), reduced-motion support, and mobile-first layouts (bottom sheets
  on phones).

**New features** (beyond the redesign). These came out of using the app and
asking what was missing:
- **Peer card on tap:** tapping a dot used to send a request immediately, so
  one stray tap pinged a stranger. Now a card opens with rough distance and
  their local time, and you choose to say hello.
- **Requests you can see:** an animated great-circle arc between the two of
  you, countdown rings tied to the real 30s timeout, and a chime (made in
  code, no audio file) plus vibration for incoming requests.
- **Chat:** a typing indicator over the peer-to-peer channel (never touches
  the server), grouped bubbles, and an ending that stays on screen ("They
  left the conversation") instead of the chat vanishing.
- **Video:** mute and camera-off that the other side is told about ("Their
  camera is off" instead of a frozen frame), a draggable self-view, chat as
  a drawer during the call with an unread badge, cancellable video requests
  (they never expired), and the call length logged in the chat. The timer
  starts once video flows **both** ways, so both people see the same
  duration.
- **Empty globe:** "It's quiet right now" with an invite / share button, so
  testing alone doesn't look broken.

## Phase 3 — Make it secure

**Issues found, ranked:**

1. 🔴 **Session IDs worked as passwords, and the server published them.**
   Every endpoint trusted the client's `id` / `fromId`, and `/api/poll`
   returned every online user's ID to anyone. With someone's ID you could
   read and empty their signaling inbox, send requests or `end` as them,
   or remove them from the map.
2. 🔴 **Connection hijack:** combined with #1, an attacker could take the
   real WebRTC answer out of a victim's inbox and substitute their own, so
   the victim's browser connected to the attacker instead of the stranger.
   The server also never checked that two users had agreed to connect
   before relaying `accept` / `offer` / `ice` / `end`.
3. 🟠 **Locating someone's real position:** each join picked a fresh random
   1–3 km offset. Forcing a victim to rejoin repeatedly (via #1) and
   averaging the positions converges on where they really are.
4. 🟠 **No rate limiting:** fake-dot flooding, request harassment, and
   unbounded signal-table growth.
5. 🟡 **Weak input validation:** no format check on IDs, payloads accepted on
   every message type, no cap on queued messages per user.
6. 🟡 **`busy` race:** a `decline` freed *both* users, including one who was
   mid-call with someone else.
7. 🟡 **No security headers:** the site could be framed (clickjacking the
   Accept / camera prompts), and there was no Permissions-Policy.

**Fixed (the two critical issues, plus #6 and part of #5):**
- **Secret session tokens:** each tab holds a random 256-bit token. The server
  derives the public ID as `sha256(token)` and never trusts an ID from the
  client. The IDs other people see can't be turned back into the token.
  Verified: using a victim's public ID now gets **401** on poll, signal and
  leave.
- **Server-side pairing:** `Presence.requestedId` / `peerId` columns (an
  additive migration). You can only accept or decline a request actually
  sent to you, relay `offer` / `answer` / `ice` to your current partner,
  and `end` your own call. Every check is one conditional `updateMany`
  (atomic per row), so it holds under concurrency without interactive
  transactions over the Neon pooler. `decline` no longer touches `busy`.
  `leave` works out who to notify from the database. Verified with a
  logged-in third session: forged accept / offer / decline get **403**, and
  ending someone else's call does nothing.

## Phase 4 — Make it better: a living globe

**What:** the globe now follows the **real sun**.
- Real-time **day, twilight and night**, computed from the sun's actual
  position (standard low-precision solar formulas, checked against the
  declination for today and the June solstice), painted per pixel and
  laid under the map labels. The lit side gets a soft cool lift, a warm
  band follows dawn and dusk, and the night side is deep navy. It redraws
  every minute, so the line moves during a session.
- Strangers on the dark side **glow brighter**, and the online pill counts
  **night owls** (people where it's between midnight and 5 AM).
- **Arrival ripples:** when someone joins, rings spread out from their light.

**Why:** Pulse promises a *living* globe, but a static dark map with dots
doesn't feel alive. Real sunlight makes the planet itself feel present
("it's 3 AM there and they're still up"), it fits the night-owl mood of
talking to strangers, and it **works even when you're the only one online**.
That matters, because a reviewer often tests alone.
