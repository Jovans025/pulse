"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "mapbox-gl/dist/mapbox-gl.css";
import type {
  GeoJSONSource,
  ImageSource,
  Map as MapboxMap,
  Marker,
} from "mapbox-gl";
import type { PeerDot } from "@/lib/types";
import { dotColor } from "@/lib/colors";
import { greatCircle } from "@/lib/geo";
import {
  MERC_MAX_LAT,
  renderSunlightImage,
  subsolarPoint,
  sunElevation,
} from "@/lib/sun";
import PeerCard from "./PeerCard";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "pk.eyJ1IjoicHVsc2UtbWFwIiwiYSI6ImNrMDBkZW1vMDAwMDAwMDAifQ.AAAAAAAAAAAAAAAAAAAAAA";

// Idle spin speed for the pre-entry globe.
const DEG_PER_SEC = 4;

// The night side is redrawn this often, so the terminator visibly creeps
// west over a session (the Earth turns 0.25° a minute).
const NIGHT_REFRESH_MS = 60_000;
const NIGHT_IMAGE_SIZE = 512;

// How long a newcomer's arrival ripple plays (matches the CSS animation).
const ARRIVAL_MS = 2600;

export default function WorldMap({
  peers,
  me,
  onPeerClick,
  canConnect,
  link = null,
  peersLoaded = true,
}: {
  peers: PeerDot[];
  me: { lat: number; lng: number } | null;
  onPeerClick: (id: string) => void;
  canConnect: boolean;
  // The stranger you're connecting with, if any. `pending` = not yet
  // accepted; `incoming` = they reached out, so the arc draws from them.
  link?: { peerId: string; pending: boolean; incoming: boolean } | null;
  // Whether `peers` reflects a real poll yet (vs the initial empty list).
  peersLoaded?: boolean;
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
        addNightLayer(map);
        addLinkLayers(map);
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
        el.innerHTML = `<span class="pulse-me-label">You</span><span class="pulse-me-ring"></span><span class="pulse-me-core"></span>`;
        meMarkerRef.current = new mapboxgl.Marker({ element: el })
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

  // Dots present on the first draw are already "here"; only later arrivals
  // ripple.
  const populatedRef = useRef(false);

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
      const sun = subsolarPoint(new Date());

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
          // Someone just arrived: send a ripple out across the globe.
          if (populatedRef.current) {
            el.classList.add("is-arriving");
            window.setTimeout(() => el.classList.remove("is-arriving"), ARRIVAL_MS);
          }
        }
        // A class, not inline opacity: on the globe Mapbox drives each
        // marker's opacity itself (fading dots round the far side).
        marker.getElement().classList.toggle("is-busy", peer.busy);
        // Lights on the dark side burn brighter.
        marker
          .getElement()
          .classList.toggle("is-night", sunElevation(peer.lat, peer.lng, sun) < -6);
      }

      // Everyone in the first real poll was already here: no ripple for them.
      if (peersLoaded) populatedRef.current = true;

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
  }, [peers, ready, peersLoaded]);

  // Keep the day/night line moving.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const timer = window.setInterval(() => {
      const source = map.getSource("night") as ImageSource | undefined;
      source?.updateImage({ url: nightImageUrl() });
    }, NIGHT_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [ready]);

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

  // The arc between you and the stranger you're connecting with. While the
  // request is pending it keeps drawing itself out towards them; once they
  // accept it stays lit.
  const linkPeer = link && me ? peers.find((p) => p.id === link.peerId) : undefined;
  const linkLng = linkPeer?.lng;
  const linkLat = linkPeer?.lat;
  const linkPending = link?.pending ?? false;
  const linkIncoming = link?.incoming ?? false;
  const meLng = me?.lng;
  const meLat = me?.lat;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource("link") as GeoJSONSource | undefined;
    if (!source) return;
    if (
      meLng === undefined ||
      meLat === undefined ||
      linkLng === undefined ||
      linkLat === undefined
    ) {
      source.setData(EMPTY_LINE);
      return;
    }

    const mine = { lat: meLat, lng: meLng };
    const theirs = { lat: linkLat, lng: linkLng };
    // Draw from whoever reached out; keep white at your end, amber at theirs.
    const coords = linkIncoming ? greatCircle(theirs, mine) : greatCircle(mine, theirs);
    const [startColor, endColor] = linkIncoming
      ? [THEIR_COLOR, MY_COLOR]
      : [MY_COLOR, THEIR_COLOR];
    map.setPaintProperty("link-line", "line-gradient", [
      "interpolate",
      ["linear"],
      ["line-progress"],
      0,
      startColor,
      1,
      endColor,
    ]);
    // Reveal the first `revealed` (0–1) of the arc. Done by feeding a growing
    // slice of the line rather than line-trim-offset, which didn't render.
    const setTrim = (revealed: number) => {
      const n = Math.max(2, Math.ceil(revealed * coords.length));
      source.setData({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: coords.slice(0, n) },
      });
    };
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (!linkPending || reducedMotion) {
      setTrim(1);
      map.setPaintProperty("link-glow", "line-opacity", linkPending ? 0.25 : 0.5);
      return;
    }

    // Pending: draw out over ~1.3s, hold, repeat; the glow breathes.
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = ((now - t0) % 2000) / 2000;
      const p = Math.min(1, t / 0.65);
      setTrim(1 - (1 - p) ** 3); // ease-out
      map.setPaintProperty(
        "link-glow",
        "line-opacity",
        0.2 + 0.15 * Math.sin(((now - t0) / 1000) * Math.PI),
      );
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [ready, meLng, meLat, linkLng, linkLat, linkPending, linkIncoming]);

  // Frame both ends of a new link so you can see the arc you just started.
  const linkPeerId = linkPeer?.id;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !linkPeerId) return;
    if (meLng === undefined || meLat === undefined) return;
    if (linkLng === undefined || linkLat === undefined) return;
    const coords = greatCircle({ lat: meLat, lng: meLng }, { lat: linkLat, lng: linkLng });
    const lngs = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      // Extra room top and bottom for the request bar / incoming card.
      { padding: { top: 140, bottom: 280, left: 100, right: 100 }, maxZoom: 6, duration: 1200 },
    );
    // Only when a new link starts, not every time a dot shifts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, linkPeerId]);

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

    </div>
  );
}

const MY_COLOR = "#ffffff";
const THEIR_COLOR = "#ffb547";

const EMPTY_LINE: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

// Real-time night side, draped over the globe as a Web Mercator image.
function nightImageUrl(): string {
  const canvas = document.createElement("canvas");
  canvas.width = NIGHT_IMAGE_SIZE;
  canvas.height = NIGHT_IMAGE_SIZE;
  canvas
    .getContext("2d")!
    .putImageData(renderSunlightImage(NIGHT_IMAGE_SIZE, NIGHT_IMAGE_SIZE, new Date()), 0, 0);
  return canvas.toDataURL();
}

function addNightLayer(map: MapboxMap) {
  if (map.getSource("night")) return;
  map.addSource("night", {
    type: "image",
    url: nightImageUrl(),
    coordinates: [
      [-180, MERC_MAX_LAT],
      [180, MERC_MAX_LAT],
      [180, -MERC_MAX_LAT],
      [-180, -MERC_MAX_LAT],
    ],
  });
  // Under the labels, so place names stay legible at night.
  const firstSymbol = map.getStyle().layers?.find((l) => l.type === "symbol")?.id;
  map.addLayer(
    {
      id: "night",
      type: "raster",
      source: "night",
      paint: { "raster-opacity": 1, "raster-fade-duration": 0, "raster-resampling": "linear" },
    },
    firstSymbol,
  );
}

// Glow + core line for the you ↔ stranger arc; data is set per connection.
function addLinkLayers(map: MapboxMap) {
  if (map.getSource("link")) return;
  // lineMetrics enables line-progress, needed for the gradient.
  map.addSource("link", { type: "geojson", data: EMPTY_LINE, lineMetrics: true });
  map.addLayer({
    id: "link-glow",
    type: "line",
    source: "link",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": THEIR_COLOR,
      "line-width": 12,
      "line-blur": 10,
      "line-opacity": 0.3,
    },
  });
  map.addLayer({
    id: "link-line",
    type: "line",
    source: "link",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-width": 2.5,
      // Set per link: white at your end, warm amber at theirs.
      "line-gradient": ["interpolate", ["linear"], ["line-progress"], 0, MY_COLOR, 1, THEIR_COLOR],
    },
  });
}
