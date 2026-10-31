// Privacy offset: move a real coordinate 1–3 km in a random direction so the
// dot is placed *near* the user, never at their exact location. A fresh random
// offset is generated each session (this runs once per join), so the same user
// lands somewhere different every time.

const KM_PER_DEG_LAT = 111.32;

export function applyPrivacyOffset(
  lat: number,
  lng: number,
): { lat: number; lng: number } {
  const distanceKm = 1 + Math.random() * 2; // 1–3 km
  const bearing = Math.random() * 2 * Math.PI; // random direction

  const dLat = (distanceKm * Math.cos(bearing)) / KM_PER_DEG_LAT;
  const latRad = (lat * Math.PI) / 180;
  const dLng =
    (distanceKm * Math.sin(bearing)) /
    (KM_PER_DEG_LAT * Math.cos(latRad) || KM_PER_DEG_LAT);

  return {
    lat: clamp(lat + dLat, -90, 90),
    lng: wrapLng(lng + dLng),
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function wrapLng(lng: number): number {
  // Keep longitude in [-180, 180].
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

// --- Display helpers for the peer card. Both are deliberately coarse: the
// input is already privacy-offset, and output is rounded further. ---

const EARTH_RADIUS_KM = 6371;

export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function formatDistance(km: number): string {
  if (km < 10) return "Right around you";
  const step = km < 100 ? 10 : km < 1000 ? 50 : 100;
  const rounded = Math.max(step, Math.round(km / step) * step);
  return `~${rounded.toLocaleString("en-US")} km away`;
}

// Solar time from longitude — no timezone lookup, so it's approximate (hence
// the "~"), but it never needs more than the dot's position.
export function describeLocalTime(lng: number, now = new Date()): string {
  const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
  const hour = Math.round((((utcHours + lng / 15) % 24) + 24) % 24) % 24;
  const label = `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "AM" : "PM"}`;
  const part =
    hour >= 5 && hour < 12
      ? "Morning"
      : hour >= 12 && hour < 17
        ? "Afternoon"
        : hour >= 17 && hour < 21
          ? "Evening"
          : "Night";
  // Non-breaking spaces keep "~10 AM" on one line.
  return `${part} there · ~${label.replace(" ", "\u00a0")}`;
}
