"use client";

import { useEffect, useRef, useState } from "react";
import EntryGate from "./components/EntryGate";
import WorldMap from "./components/WorldMap";
import ChatPanel, { type ChatMessage } from "./components/ChatPanel";
import VideoPanel from "./components/VideoPanel";
import RequestingBar from "./components/RequestingBar";
import InviteCard from "./components/InviteCard";
import OnlineHud from "./components/OnlineHud";
import { dotColor } from "@/lib/colors";
import { describeLocalTime, distanceKm, formatDistance } from "@/lib/geo";
import { playChime } from "@/lib/chime";
import { join, leave, newSessionToken, poll, sendSignal } from "@/lib/api";
import { PeerSession, type DescType, type PeerControl } from "@/lib/webrtc";
import { POLL_INTERVAL_MS } from "@/lib/presence";
import { type PeerDot, type SignalMsg } from "@/lib/types";

type Conn =
  | { kind: "idle" }
  | { kind: "requesting"; peerId: string }
  | { kind: "incoming"; peerId: string }
  | { kind: "connecting"; peerId: string }
  | { kind: "connected"; peerId: string };

type VideoState = "none" | "requesting" | "incoming" | "active";

const REQUEST_TIMEOUT_MS = 30_000;
const TYPING_SHOW_MS = 3_000; // how long "typing…" lingers after the last ping
const TYPING_SEND_MS = 1_500; // min gap between our own typing pings
const GATE_POLL_INTERVAL_MS = 5_000;

export default function Home() {
  const [phase, setPhase] = useState<"gate" | "live">("gate");
  // Secret for this session; the server derives our public id from it.
  const [sessionToken] = useState(() => newSessionToken());
  const [peers, setPeers] = useState<PeerDot[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const myLocationRef = useRef(myLocation);
  useEffect(() => {
    myLocationRef.current = myLocation;
  });

  const [conn, _setConn] = useState<Conn>({ kind: "idle" });
  const connRef = useRef<Conn>(conn);
  const setConn = (c: Conn) => {
    connRef.current = c;
    _setConn(c);
  };

  const [video, _setVideo] = useState<VideoState>("none");
  const videoRef = useRef<VideoState>(video);
  const setVideo = (v: VideoState) => {
    videoRef.current = v;
    _setVideo(v);
  };

  // In-call state: our mic/camera, what the other side told us about theirs,
  // and the chat drawer (with an unread count while it's tucked away).
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [remoteMicOn, setRemoteMicOn] = useState(true);
  const [remoteCamOn, setRemoteCamOn] = useState(true);
  const [chatOpen, _setChatOpen] = useState(false);
  const chatOpenRef = useRef(false);
  const setChatOpen = (open: boolean) => {
    chatOpenRef.current = open;
    _setChatOpen(open);
    if (open) setUnread(0);
  };
  const [unread, setUnread] = useState(0);

  const peerRef = useRef<PeerSession | null>(null);
  const msgId = useRef(0);
  const [peerTyping, setPeerTyping] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);
  // Set when the other side ends a chat: the conversation stays on screen with
  // a closing note until you dismiss it.
  const [chatEnded, setChatEnded] = useState<{
    peerId: string;
    reason: string;
  } | null>(null);
  const requestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showNotice(text: string) {
    setNotice(text);
    window.setTimeout(() => setNotice(null), 3500);
  }

  function addMessage(mine: boolean, text: string) {
    setMessages((prev) => [...prev, { id: msgId.current++, mine, text }]);
  }

  // When the call actually started, so its length can be logged in the chat.
  // That's once video flows both ways: we've received theirs, and they've
  // told us ("video-live") they received ours. Both sides hit that point
  // within a data-channel hop, so both show the same duration.
  const videoStartedAt = useRef<number | null>(null);
  const gotTheirVideo = useRef(false);
  const theyGotOurs = useRef(false);

  function maybeStartCallTimer() {
    if (
      gotTheirVideo.current &&
      theyGotOurs.current &&
      videoStartedAt.current === null
    ) {
      videoStartedAt.current = Date.now();
    }
  }

  function logCallDuration() {
    const started = videoStartedAt.current;
    videoStartedAt.current = null;
    gotTheirVideo.current = false;
    theyGotOurs.current = false;
    if (started === null) return;
    const text = `Video call · ${formatDuration(Date.now() - started)}`;
    setMessages((prev) => [
      ...prev,
      { id: msgId.current++, mine: false, text, system: true },
    ]);
  }

  function teardown(message?: string, keepChat = false) {
    if (requestTimer.current) clearTimeout(requestTimer.current);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    peerRef.current?.close();
    peerRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setVideo("none");
    resetCall();
    setPeerTyping(false);
    if (!keepChat) setMessages([]);
    setConn({ kind: "idle" });
    if (message) showNotice(message);
  }

  // Fresh in-call state for each video session.
  function resetCall() {
    setMicOn(true);
    setCamOn(true);
    setRemoteMicOn(true);
    setRemoteCamOn(true);
    setChatOpen(false);
  }

  // The other side ended things. Mid-chat, keep the conversation on screen with
  // a closing note instead of snapping straight back to the map.
  function peerLeft(peerId: string, reason: string) {
    logCallDuration();
    const wasChatting = connRef.current.kind === "connected";
    teardown(wasChatting ? undefined : reason, wasChatting);
    if (wasChatting) setChatEnded({ peerId, reason });
  }

  function dismissEndedChat() {
    setChatEnded(null);
    setMessages([]);
  }

  function notifyTyping() {
    const now = Date.now();
    if (now - lastTypingSent.current < TYPING_SEND_MS) return;
    lastTypingSent.current = now;
    peerRef.current?.sendTyping();
  }

  function startPeer(peerId: string, initiator: boolean) {
    setChatEnded(null);
    setMessages([]);
    videoStartedAt.current = null;
    gotTheirVideo.current = false;
    theyGotOurs.current = false;
    const ps = new PeerSession(initiator, {
      onSignal: (type: DescType, payload: string) => {
        void sendSignal(sessionToken, peerId, type, payload);
      },
      onChat: (text) => {
        setPeerTyping(false);
        addMessage(false, text);
        if (videoRef.current === "active" && !chatOpenRef.current) {
          setUnread((n) => n + 1);
        }
      },
      onTyping: () => {
        setPeerTyping(true);
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setPeerTyping(false), TYPING_SHOW_MS);
      },
      onControl: (ctrl) => handleControl(ctrl),
      onRemoteStream: (stream) => {
        if (stream && !gotTheirVideo.current) {
          gotTheirVideo.current = true;
          ps.sendControl("video-live");
          maybeStartCallTimer();
        }
        setRemoteStream(stream);
      },
      onConnectionState: (state) => {
        if (state === "failed") {
          peerLost(peerId, "The connection dropped.");
        }
      },
      onChannelOpen: () => {
        setConn({ kind: "connected", peerId });
      },
      onChannelClose: () => peerLost(peerId, "They left the conversation."),
    });
    peerRef.current = ps;
  }

  // The peer vanished without us receiving an `end` (tab closed, crash, network
  // drop). Send `end` ourselves so the server clears both busy flags.
  function peerLost(peerId: string, message: string) {
    const c = connRef.current;
    if (
      (c.kind === "connecting" || c.kind === "connected") &&
      c.peerId === peerId
    ) {
      void sendSignal(sessionToken, peerId, "end");
      peerLeft(peerId, message);
    }
  }

  function handleControl(ctrl: PeerControl) {
    const ps = peerRef.current;
    switch (ctrl) {
      case "video-request":
        if (videoRef.current === "none") setVideo("incoming");
        break;
      case "video-accept":
        if (videoRef.current === "requesting" && ps) {
          ps.startVideo()
            .then((stream) => {
              resetCall();
              setLocalStream(stream);
              setVideo("active");
            })
            .catch(() => {
              setVideo("none");
              ps.sendControl("video-end");
              showNotice("Camera unavailable.");
            });
        }
        break;
      case "video-decline":
        if (videoRef.current === "requesting") {
          setVideo("none");
          showNotice("Video declined.");
        }
        break;
      case "video-end":
        logCallDuration();
        ps?.stopVideo();
        setLocalStream(null);
        setRemoteStream(null);
        setVideo("none");
        resetCall();
        break;
      case "mic-on":
      case "mic-off":
        setRemoteMicOn(ctrl === "mic-on");
        break;
      case "cam-on":
      case "cam-off":
        setRemoteCamOn(ctrl === "cam-on");
        break;
      case "video-live":
        theyGotOurs.current = true;
        maybeStartCallTimer();
        break;
    }
  }

  function requestConnection(peerId: string) {
    if (connRef.current.kind !== "idle") return;
    dismissEndedChat();
    setConn({ kind: "requesting", peerId });
    void sendSignal(sessionToken, peerId, "request");
    requestTimer.current = setTimeout(() => {
      if (
        connRef.current.kind === "requesting" &&
        connRef.current.peerId === peerId
      ) {
        void sendSignal(sessionToken, peerId, "end");
        teardown("No answer.");
      }
    }, REQUEST_TIMEOUT_MS);
  }

  function cancelRequest() {
    if (connRef.current.kind === "requesting") {
      void sendSignal(sessionToken, connRef.current.peerId, "end");
    }
    teardown();
  }

  function acceptIncoming() {
    if (connRef.current.kind !== "incoming") return;
    const peerId = connRef.current.peerId;
    startPeer(peerId, false);
    void sendSignal(sessionToken, peerId, "accept");
    setConn({ kind: "connecting", peerId });
  }

  function declineIncoming() {
    if (connRef.current.kind !== "incoming") return;
    void sendSignal(sessionToken, connRef.current.peerId, "decline");
    setConn({ kind: "idle" });
  }

  function endConnection() {
    const c = connRef.current;
    if (c.kind === "connecting" || c.kind === "connected") {
      void sendSignal(sessionToken, c.peerId, "end");
    }
    teardown();
  }

  function startVideoRequest() {
    if (videoRef.current !== "none" || !peerRef.current) return;
    setVideo("requesting");
    peerRef.current.sendControl("video-request");
  }

  function acceptVideo() {
    const ps = peerRef.current;
    if (!ps) return;
    ps.startVideo()
      .then((stream) => {
        resetCall();
        setLocalStream(stream);
        ps.sendControl("video-accept");
        setVideo("active");
      })
      .catch(() => {
        ps.sendControl("video-decline");
        setVideo("none");
        showNotice("Camera unavailable.");
      });
  }

  function declineVideo() {
    peerRef.current?.sendControl("video-decline");
    setVideo("none");
  }

  function endVideo() {
    logCallDuration();
    const ps = peerRef.current;
    ps?.stopVideo();
    ps?.sendControl("video-end");
    setLocalStream(null);
    setRemoteStream(null);
    setVideo("none");
    resetCall();
  }

  // Video requests don't expire, so let the asker back out.
  function cancelVideoRequest() {
    if (videoRef.current !== "requesting") return;
    peerRef.current?.sendControl("video-end");
    setVideo("none");
  }

  function toggleMic() {
    const on = !micOn;
    setMicOn(on);
    peerRef.current?.setMicEnabled(on);
    peerRef.current?.sendControl(on ? "mic-on" : "mic-off");
  }

  function toggleCam() {
    const on = !camOn;
    setCamOn(on);
    peerRef.current?.setCameraEnabled(on);
    peerRef.current?.sendControl(on ? "cam-on" : "cam-off");
  }

  function processSignal(sig: SignalMsg) {
    switch (sig.type) {
      case "request": {
        if (connRef.current.kind === "idle") {
          setConn({ kind: "incoming", peerId: sig.fromId });
          playChime();
        } else {
          void sendSignal(sessionToken, sig.fromId, "decline");
        }
        break;
      }
      case "accept": {
        const c = connRef.current;
        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          if (requestTimer.current) clearTimeout(requestTimer.current);
          startPeer(sig.fromId, true);
          setConn({ kind: "connecting", peerId: sig.fromId });
        }
        break;
      }
      case "decline": {
        const c = connRef.current;
        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          if (requestTimer.current) clearTimeout(requestTimer.current);
          teardown("Request declined.");
        }
        break;
      }
      case "offer":
      case "answer":
      case "ice": {
        const c = connRef.current;
        const peerId =
          c.kind === "connecting" || c.kind === "connected" ? c.peerId : null;
        if (peerRef.current && peerId === sig.fromId) {
          void peerRef.current.handleSignal(
            sig.type as DescType,
            sig.payload ?? "",
          );
        }
        break;
      }
      case "end": {
        const c = connRef.current;
        if (c.kind !== "idle" && c.peerId === sig.fromId) {
          if (c.kind === "incoming") setConn({ kind: "idle" });
          else if (c.kind === "requesting") teardown("Stranger left.");
          else peerLeft(sig.fromId, "They left the conversation.");
        }
        break;
      }
    }
  }

  const processSignalRef = useRef(processSignal);
  useEffect(() => {
    processSignalRef.current = processSignal;
  });

  // Polls on the entry screen too (slower, read-only) so the globe behind it
  // already shows who's online.
  useEffect(() => {
    if (!sessionToken) return;
    const live = phase === "live";
    const interval = live ? POLL_INTERVAL_MS : GATE_POLL_INTERVAL_MS;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const data = await poll(sessionToken);
        if (!active) return;
        setPeers(data.peers);
        if (live) {
          // Our row was reaped — put the dot back. Any live P2P chat is unaffected.
          if (!data.present && myLocationRef.current) {
            const { lat, lng } = myLocationRef.current;
            await join(sessionToken, lat, lng);
          }
          for (const s of data.signals) processSignalRef.current(s);
        }
      } catch {}
      if (active) timer = setTimeout(tick, interval);
    };
    tick();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [phase, sessionToken]);

  useEffect(() => {
    if (!sessionToken || phase !== "live") return;
    const onLeave = () => {
      const c = connRef.current;
      leave(sessionToken, c.kind === "idle" ? undefined : c.peerId);
    };
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [sessionToken, phase]);

  async function handleReady(lat: number, lng: number) {
    setMyLocation({ lat, lng });
    await join(sessionToken, lat, lng);
    setPhase("live");
  }

  const inChat = conn.kind === "connecting" || conn.kind === "connected";
  const connPeerId = conn.kind === "idle" ? null : conn.peerId;
  // Whose chat is on screen: the live one, or one that just ended.
  const chatPeerId = inChat ? conn.peerId : (chatEnded?.peerId ?? null);

  return (
    <main className="fixed inset-0 overflow-hidden">
      <WorldMap
        peers={peers}
        me={myLocation}
        onPeerClick={requestConnection}
        canConnect={phase === "live" && conn.kind === "idle"}
        link={
          connPeerId
            ? {
                peerId: connPeerId,
                pending: conn.kind === "requesting" || conn.kind === "incoming",
                incoming: conn.kind === "incoming",
              }
            : null
        }
      />

      {phase === "live" && <OnlineHud peers={peers} />}

      {phase === "gate" && (
        <EntryGate onReady={handleReady} onlineCount={peers.length} />
      )}

      {notice && (
        <div
          role="status"
          className="animate-pop-in absolute left-1/2 top-5 z-40 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/10 bg-[#0b0f1d]/85 px-4 py-2 text-sm text-white/85 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.9)] backdrop-blur-xl"
        >
          {notice}
        </div>
      )}

      {conn.kind === "requesting" && (
        <RequestingBar
          title="Reaching out…"
          subtitle="Waiting for them to say hello back"
          durationMs={REQUEST_TIMEOUT_MS}
          color={dotColor(conn.peerId)}
          onCancel={cancelRequest}
        />
      )}

      {conn.kind === "incoming" && (
        <InviteCard
          title="A stranger wants to talk"
          details={<PeerDetails peer={peers.find((p) => p.id === conn.peerId)} me={myLocation} />}
          color={dotColor(conn.peerId)}
          durationMs={REQUEST_TIMEOUT_MS}
          declineLabel="Not now"
          acceptLabel="Say hello"
          onAccept={acceptIncoming}
          onDecline={declineIncoming}
        />
      )}

      {chatPeerId && (
        <ChatPanel
          messages={messages}
          status={
            !inChat ? "ended" : conn.kind === "connected" ? "connected" : "connecting"
          }
          endedReason={chatEnded?.reason}
          peer={peers.find((p) => p.id === chatPeerId)}
          me={myLocation}
          color={dotColor(chatPeerId)}
          peerTyping={peerTyping}
          videoBusy={video !== "none"}
          onSend={(text) => {
            peerRef.current?.sendChat(text);
            addMessage(true, text);
            // Receiving a message clears their "typing…", so let the next
            // keystroke ping straight away.
            lastTypingSent.current = 0;
          }}
          onTyping={notifyTyping}
          onStartVideo={startVideoRequest}
          onEnd={endConnection}
          onClose={dismissEndedChat}
          overlay={video === "active"}
          hidden={video === "active" && !chatOpen}
          onHide={video === "active" ? () => setChatOpen(false) : undefined}
        />
      )}

      {video === "requesting" && chatPeerId && (
        <RequestingBar
          title="Asking to turn on video…"
          subtitle="Your camera starts once they agree"
          color={dotColor(chatPeerId)}
          onCancel={cancelVideoRequest}
        />
      )}

      {video === "incoming" && chatPeerId && (
        <InviteCard
          title="Turn on video?"
          details="The stranger wants to see you. Your camera and mic will turn on."
          color={dotColor(chatPeerId)}
          declineLabel="Keep texting"
          acceptLabel="Turn on camera"
          onAccept={acceptVideo}
          onDecline={declineVideo}
        />
      )}

      {video === "active" && chatPeerId && (
        <VideoPanel
          localStream={localStream}
          remoteStream={remoteStream}
          color={dotColor(chatPeerId)}
          micOn={micOn}
          camOn={camOn}
          remoteMicOn={remoteMicOn}
          remoteCamOn={remoteCamOn}
          chatOpen={chatOpen}
          unread={unread}
          onToggleMic={toggleMic}
          onToggleCam={toggleCam}
          onToggleChat={() => setChatOpen(!chatOpen)}
          onEnd={endVideo}
        />
      )}
    </main>
  );
}

// 3:07, or 1:02:45 past an hour.
function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

// Rough distance + local time, as on the peer card.
function PeerDetails({
  peer,
  me,
}: {
  peer: PeerDot | undefined;
  me: { lat: number; lng: number } | null;
}) {
  if (!peer || !me) return <>Somewhere out there</>;
  return (
    <>
      {formatDistance(distanceKm(me, peer))}
      <br />
      {describeLocalTime(peer.lng)}
    </>
  );
}
