"use client";

import { useEffect, useRef, useState } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Map as MapboxMap, Marker } from "mapbox-gl";
import type { PeerDot } from "@/lib/types";

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

  // Marker click handlers are bound once, so read the live click handler +
  // connectability through refs (synced in an effect, never during render).
  const onPeerClickRef = useRef(onPeerClick);
  const canConnectRef = useRef(canConnect);
  useEffect(() => {
    onPeerClickRef.current = onPeerClick;
    canConnectRef.current = canConnect;
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
          el.title = "Tap to connect";
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            if (canConnectRef.current) onPeerClickRef.current(peer.id);
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

  return (
    <div className="absolute inset-0">
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
