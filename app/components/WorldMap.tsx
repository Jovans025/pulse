"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Map as MapboxMap, Marker } from "mapbox-gl";
import type { PeerDot } from "@/lib/types";
import PeerCard from "./PeerCard";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "pk.eyJ1IjoicHVsc2UtbWFwIiwiYSI6ImNrMDBkZW1vMDAwMDAwMDAifQ.AAAAAAAAAAAAAAAAAAAAAA";

// Warm "city light" hues (coral → amber → gold), stable per user.
function dotColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return `hsl(${12 + (Math.abs(hash) % 40)}, 95%, 66%)`;
}

// Idle spin speed for the pre-entry globe.
const DEG_PER_SEC = 4;

export default function WorldMap({
  peers,
  me,
  onPeerClick,
  canConnect,
  showHud = true,
}: {
  peers: PeerDot[];
  me: { lat: number; lng: number } | null;
  onPeerClick: (id: string) => void;
  canConnect: boolean;
  showHud?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const meMarkerRef = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);
  // Spin only while we don't know where the user is (the entry screen).
  const spinRef = useRef(!me);

  // The dot whose card is open. If that peer goes offline it simply drops out
  // of `peers`, which closes the card.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = me ? peers.find((p) => p.id === selectedId) : undefined;
  // Mapbox owns this element's position; React renders the card into it.
  const [cardEl] = useState(() => {
    if (typeof document === "undefined") return null;
    const el = document.createElement("div");
    el.style.zIndex = "10"; // above the dots
    return el;
  });

  // Initialise the map once.
  useEffect(() => {
    if (!TOKEN || !containerRef.current) return;
    let cancelled = false;
    const markers = markersRef.current;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled || !containerRef.current) return;
      mapboxgl.accessToken = TOKEN;
      const narrow = window.innerWidth < 640;
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/dark-v11",
        projection: "globe",
        // Open centered on the user if we know where they are, else world view.
        center: me ? [me.lng, me.lat] : [-30, 25],
        zoom: me ? 4 : narrow ? 0.9 : 1.6,
        attributionControl: true,
      });
      // On phones the entry card docks to the bottom: lift the globe above it.
      if (!me && narrow) {
        map.setPadding({ top: 0, left: 0, right: 0, bottom: window.innerHeight * 0.45 });
      }
      map.on("style.load", () => {
        // Night-side atmosphere: thin blue limb fading into a starfield.
        map.setFog({
          color: "rgb(14, 20, 40)",
          "high-color": "rgb(40, 62, 140)",
          "horizon-blend": 0.06,
          "space-color": "rgb(3, 5, 12)",
          "star-intensity": 0.55,
        });
      });
      map.on("load", () => {
        if (!cancelled) setReady(true);
      });
      // Tapping empty map closes the card (but not taps on the card itself).
      map.on("click", (e) => {
        const target = e.originalEvent.target as Node | null;
        if (!(target && cardEl?.contains(target))) setSelectedId(null);
      });

      // Slow idle spin until the user enters (or grabs the globe).
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      let grabbing = false;
      const spin = () => {
        if (reducedMotion || grabbing || !spinRef.current) return;
        const center = map.getCenter();
        center.lng -= DEG_PER_SEC;
        map.easeTo({ center, duration: 1000, easing: (t) => t });
      };
      map.on("mousedown", () => (grabbing = true));
      map.on("touchstart", () => (grabbing = true));
      map.on("mouseup", () => (grabbing = false));
      map.on("touchend", () => (grabbing = false));
      map.on("dragend", spin);
      map.on("moveend", spin);
      map.on("load", spin);
      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      markers.forEach((m) => m.remove());
      markers.clear();
      meMarkerRef.current?.remove();
      meMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
    // `me` is only read for the initial center; we don't want to re-init on change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once the user enters, stop spinning and fly down to their region.
  const flewRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !me || flewRef.current) return;
    flewRef.current = true;
    spinRef.current = false;
    map.stop();
    // Not `essential`, so Mapbox skips the flight under reduced motion.
    map.flyTo({
      center: [me.lng, me.lat],
      zoom: 4,
      duration: 3200,
      curve: 1.6,
      padding: { top: 0, left: 0, right: 0, bottom: 0 },
    });
  }, [me, ready]);

  // Show / move the user's own "you are here" pin.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !me) return;
    let cancelled = false;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled) return;
      if (!meMarkerRef.current) {
        const el = document.createElement("div");
        el.className = "pulse-me";
        el.title = "You are here";
        el.innerHTML = `<span class="pulse-me-label">Me</span>📍`;
        // anchor "bottom" → the pin's tip sits on the exact coordinate.
        meMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([me.lng, me.lat])
          .addTo(map);
      } else {
        meMarkerRef.current.setLngLat([me.lng, me.lat]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [me, ready]);

  // Reconcile markers whenever the peer list changes (or the map becomes ready).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let cancelled = false;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled) return;
      const markers = markersRef.current;
      const seen = new Set<string>();

      for (const peer of peers) {
        seen.add(peer.id);
        let marker = markers.get(peer.id);
        if (!marker) {
          const el = document.createElement("button");
          el.className = "pulse-dot";
          el.style.color = dotColor(peer.id);
          el.title = "A stranger";
          el.setAttribute("aria-label", "A stranger. Open details");
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            setSelectedId(peer.id);
          });
          marker = new mapboxgl.Marker({ element: el })
            .setLngLat([peer.lng, peer.lat])
            .addTo(map);
          markers.set(peer.id, marker);
        }
        marker.getElement().style.opacity = peer.busy ? "0.35" : "1";
      }

      // Drop markers for peers that went offline / got filtered out.
      for (const [id, marker] of markers) {
        if (!seen.has(id)) {
          marker.remove();
          markers.delete(id);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [peers, ready]);

  // Mark the selected dot.
  useEffect(() => {
    for (const [id, marker] of markersRef.current) {
      marker.getElement().classList.toggle("is-selected", id === selected?.id);
    }
  }, [selected?.id, peers]);

  // Anchor the card above the selected dot, and nudge the camera so the dot
  // sits below centre — the card then always has room above it.
  const selLng = selected?.lng;
  const selLat = selected?.lat;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !cardEl || selLng === undefined || selLat === undefined)
      return;
    let marker: Marker | null = null;
    let cancelled = false;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled) return;
      marker = new mapboxgl.Marker({
        element: cardEl,
        anchor: "bottom",
        offset: [0, -16],
      })
        .setLngLat([selLng, selLat])
        .addTo(map);
      map.easeTo({ center: [selLng, selLat], offset: [0, 110], duration: 600 });
    })();

    return () => {
      cancelled = true;
      marker?.remove();
    };
  }, [ready, cardEl, selLng, selLat]);

  // Keep map gestures (pan, zoom) from starting on the card, and close it
  // with Esc. `click` must still bubble: React handles it at the app root.
  useEffect(() => {
    if (!cardEl) return;
    const stop = (e: Event) => e.stopPropagation();
    const events = ["mousedown", "touchstart", "dblclick", "wheel"];
    for (const ev of events) cardEl.addEventListener(ev, stop);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      for (const ev of events) cardEl.removeEventListener(ev, stop);
      window.removeEventListener("keydown", onKey);
    };
  }, [cardEl]);

  return (
    <div className="absolute inset-0">
      {cardEl &&
        selected &&
        me &&
        createPortal(
          <PeerCard
            peer={selected}
            me={me}
            color={dotColor(selected.id)}
            canConnect={canConnect}
            onConnect={() => {
              setSelectedId(null);
              onPeerClick(selected.id);
            }}
            onClose={() => setSelectedId(null)}
          />,
          cardEl,
        )}
      <div ref={containerRef} className="h-full w-full bg-zinc-900" />

      {!TOKEN && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <p className="max-w-md rounded-lg bg-zinc-800 p-4 text-sm text-zinc-200">
            Set{" "}
            <code className="text-emerald-400">NEXT_PUBLIC_MAPBOX_TOKEN</code> in{" "}
            <code>.env</code> to load the map.
          </p>
        </div>
      )}

      {/* Online count */}
      {showHud && (
        <div className="absolute bottom-4 left-4 rounded-full bg-zinc-900/80 px-3 py-1.5 text-xs text-zinc-300 backdrop-blur">
          {peers.length} online
        </div>
      )}
    </div>
  );
}
