/** Shared view bearing (azimuth) in degrees: 0 = North, 90 = East */

let bearing = 0;
const listeners = new Set();

export function getBearing() {
  return bearing;
}

export function setBearing(degrees, source = 'app') {
  const next = ((Number(degrees) % 360) + 360) % 360;
  if (next === bearing) return;
  bearing = next;
  listeners.forEach(fn => fn(bearing, source));
}

export function onBearingChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function bearingToCardinal(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

export function formatBearingLabel(deg) {
  return `${Math.round(deg)}° ${bearingToCardinal(deg)}`;
}
