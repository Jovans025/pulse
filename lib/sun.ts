// Where the sun is right now, for lighting the globe: a lit day side, a warm
// twilight band and a dark night side, all in real time.
// Low-precision solar position (good to well under a degree), which is
// plenty for drawing a terminator.

const RAD = Math.PI / 180;

// The point on Earth where the sun is directly overhead.
export function subsolarPoint(date: Date): { lat: number; lng: number } {
  const d = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 86_400_000; // days since J2000
  const g = (357.529 + 0.98560028 * d) * RAD; // mean anomaly
  const q = 280.459 + 0.98564736 * d; // mean longitude (deg)
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD; // ecliptic longitude
  const e = (23.439 - 0.00000036 * d) * RAD; // obliquity
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD; // right ascension (deg)
  const dec = Math.asin(Math.sin(e) * Math.sin(L)) / RAD; // declination (deg)
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24; // sidereal time (hours)
  let lng = ra - gmst * 15;
  lng = ((((lng + 180) % 360) + 360) % 360) - 180;
  return { lat: dec, lng };
}

// Sun elevation in degrees at a place (negative = below the horizon).
export function sunElevation(
  lat: number,
  lng: number,
  sun: { lat: number; lng: number },
): number {
  const s =
    Math.sin(lat * RAD) * Math.sin(sun.lat * RAD) +
    Math.cos(lat * RAD) * Math.cos(sun.lat * RAD) * Math.cos((lng - sun.lng) * RAD);
  return Math.asin(Math.max(-1, Math.min(1, s))) / RAD;
}

// Mercator latitude limit Mapbox renders to.
export const MERC_MAX_LAT = 85.051129;

// Paint sunlight into an RGBA image in Web Mercator (draped over the map as an
// image source). Three layers, composited per pixel:
//   day      a soft cool lift, so the lit hemisphere reads as lit on a dark map
//   twilight a faint warm band just below the horizon (dawn / dusk)
//   night    deep navy once the sun is well down
export function renderSunlightImage(
  width: number,
  height: number,
  date: Date,
): ImageData {
  const sun = subsolarPoint(date);
  const img = new ImageData(width, height);
  const px = img.data;
  for (let y = 0; y < height; y++) {
    const my = Math.PI * (1 - (2 * (y + 0.5)) / height);
    const lat = Math.atan(Math.sinh(my)) / RAD;
    for (let x = 0; x < width; x++) {
      const lng = -180 + (360 * (x + 0.5)) / width;
      const el = sunElevation(lat, lng, sun);
      let rgba = over(DAY, smoothstep(-1, 10, el) * 0.13, [0, 0, 0, 0]);
      rgba = over(DUSK, Math.max(0, 1 - Math.abs(el + 1.5) / 4.5) * 0.2, rgba);
      rgba = over(NIGHT, smoothstep(0.5, -12, el) * 0.62, rgba);
      const i = (y * width + x) * 4;
      px[i] = rgba[0];
      px[i + 1] = rgba[1];
      px[i + 2] = rgba[2];
      px[i + 3] = rgba[3] * 255;
    }
  }
  return img;
}

type RGB = [number, number, number];
const DAY: RGB = [190, 210, 255];
const DUSK: RGB = [255, 165, 90];
const NIGHT: RGB = [4, 7, 22];

// Source-over compositing of a flat colour at `alpha` onto `dst` [r,g,b,a].
function over(
  color: RGB,
  alpha: number,
  dst: [number, number, number, number],
): [number, number, number, number] {
  const a = alpha + dst[3] * (1 - alpha);
  if (a <= 0) return [0, 0, 0, 0];
  const mix = (c: number, d: number) =>
    (c * alpha + d * dst[3] * (1 - alpha)) / a;
  return [mix(color[0], dst[0]), mix(color[1], dst[1]), mix(color[2], dst[2]), a];
}

function smoothstep(edge0: number, edge1: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
