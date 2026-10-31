"use client";

import { useEffect, useRef, useState } from "react";
import EntryGate from "./components/EntryGate";
import WorldMap from "./components/WorldMap";
import ConnectionPrompt from "./components/ConnectionPrompt";
import ChatPanel, { type ChatMessage } from "./components/ChatPanel";
import VideoPanel from "./components/VideoPanel";
import RequestingBar from "./components/RequestingBar";
import IncomingRequest from "./components/IncomingRequest";
import { dotColor } from "@/lib/colors";
import { playChime } from "@/lib/chime";
import { join, leave, poll, sendSignal } from "@/lib/api";
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
  const [sessionId] = useState(() => crypto.randomUUID());
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

  function teardown(message?: string, keepChat = false) {
    if (requestTimer.current) clearTimeout(requestTimer.current);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    peerRef.current?.close();
    peerRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setVideo("none");
    setPeerTyping(false);
    if (!keepChat) setMessages([]);
    setConn({ kind: "idle" });
    if (message) showNotice(message);
  }

  // The other side ended things. Mid-chat, keep the conversation on screen with
  // a closing note instead of snapping straight back to the map.
  function peerLeft(peerId: string, reason: string) {
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
    const ps = new PeerSession(initiator, {
      onSignal: (type: DescType, payload: string) => {
        void sendSignal(sessionId, peerId, type, payload);
      },
      onChat: (text) => {
        setPeerTyping(false);
        addMessage(false, text);
      },
      onTyping: () => {
        setPeerTyping(true);
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setPeerTyping(false), TYPING_SHOW_MS);
      },
      onControl: (ctrl) => handleControl(ctrl),
      onRemoteStream: (stream) => setRemoteStream(stream),
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
      void sendSignal(sessionId, peerId, "end");
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
        ps?.stopVideo();
        setLocalStream(null);
        setRemoteStream(null);
        setVideo("none");
        break;
    }
  }

  function requestConnection(peerId: string) {
    if (connRef.current.kind !== "idle") return;
    dismissEndedChat();
    setConn({ kind: "requesting", peerId });
    void sendSignal(sessionId, peerId, "request");
    requestTimer.current = setTimeout(() => {
      if (
        connRef.current.kind === "requesting" &&
        connRef.current.peerId === peerId
      ) {
        void sendSignal(sessionId, peerId, "end");
        teardown("No answer.");
      }
    }, REQUEST_TIMEOUT_MS);
  }

  function cancelRequest() {
    if (connRef.current.kind === "requesting") {
      void sendSignal(sessionId, connRef.current.peerId, "end");
    }
    teardown();
  }

  function acceptIncoming() {
    if (connRef.current.kind !== "incoming") return;
    const peerId = connRef.current.peerId;
    startPeer(peerId, false);
    void sendSignal(sessionId, peerId, "accept");
    setConn({ kind: "connecting", peerId });
  }

  function declineIncoming() {
    if (connRef.current.kind !== "incoming") return;
    void sendSignal(sessionId, connRef.current.peerId, "decline");
    setConn({ kind: "idle" });
  }

  function endConnection() {
    const c = connRef.current;
    if (c.kind === "connecting" || c.kind === "connected") {
      void sendSignal(sessionId, c.peerId, "end");
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
    const ps = peerRef.current;
    ps?.stopVideo();
    ps?.sendControl("video-end");
    setLocalStream(null);
    setRemoteStream(null);
    setVideo("none");
  }

  function processSignal(sig: SignalMsg) {
    switch (sig.type) {
      case "request": {
        if (connRef.current.kind === "idle") {
          setConn({ kind: "incoming", peerId: sig.fromId });
          playChime();
        } else {
          void sendSignal(sessionId, sig.fromId, "decline");
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
    if (!sessionId) return;
    const live = phase === "live";
    const interval = live ? POLL_INTERVAL_MS : GATE_POLL_INTERVAL_MS;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const data = await poll(sessionId);
        if (!active) return;
        setPeers(data.peers);
        if (live) {
          // Our row was reaped — put the dot back. Any live P2P chat is unaffected.
          if (!data.present && myLocationRef.current) {
            const { lat, lng } = myLocationRef.current;
            await join(sessionId, lat, lng);
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
  }, [phase, sessionId]);

  useEffect(() => {
    if (!sessionId || phase !== "live") return;
    const onLeave = () => {
      const c = connRef.current;
      leave(sessionId, c.kind === "idle" ? undefined : c.peerId);
    };
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [sessionId, phase]);

  async function handleReady(lat: number, lng: number) {
    setMyLocation({ lat, lng });
    await join(sessionId, lat, lng);
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
        showHud={phase === "live"}
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
          durationMs={REQUEST_TIMEOUT_MS}
          color={dotColor(conn.peerId)}
          onCancel={cancelRequest}
        />
      )}

      {conn.kind === "incoming" && (
        <IncomingRequest
          peer={peers.find((p) => p.id === conn.peerId)}
          me={myLocation}
          color={dotColor(conn.peerId)}
          durationMs={REQUEST_TIMEOUT_MS}
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
        />
      )}

      {video === "requesting" && (
        <div className="absolute bottom-24 left-1/2 z-30 -translate-x-1/2 rounded-full bg-zinc-800/90 px-4 py-2 text-sm text-zinc-100 shadow-lg backdrop-blur">
          Waiting for stranger to accept video…
        </div>
      )}

      {video === "incoming" && (
        <ConnectionPrompt
          title="Start video call?"
          subtitle="The stranger wants to turn on video."
          acceptLabel="Accept"
          declineLabel="Decline"
          onAccept={acceptVideo}
          onDecline={declineVideo}
        />
      )}

      {video === "active" && (
        <VideoPanel
          localStream={localStream}
          remoteStream={remoteStream}
          onEnd={endVideo}
        />
      )}
    </main>
  );
}
