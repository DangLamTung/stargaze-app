/**
 * BortlePresets — Recommended Stellarium engine settings per Bortle class.
 *
 * Based on the Bortle Dark-Sky Scale (John E. Bortle, 2001).
 * Source: https://en.wikipedia.org/wiki/Bortle_scale
 *
 * Each preset tunes star magnitude limit, milkyway, constellations, and
 * labels to match what the human eye can see under each sky darkness level
 * as defined by Bortle's original observational criteria.
 */

const PRESETS = {
  1: {
    bortle: 1,
    label: 'Excellent dark-sky site',
    nelm: '7.6–8.0',
    sqm: '21.76–22.00',
    desc: 'Zodiacal light colorful, gegenschein visible, Milky Way casts shadows',
    starMagLimit: 7.5,
    milkywayVisible: true,
    milkywayAlpha: 1.0,
    constellationsLines: true,
    constellationsLabels: true,
    starLabels: true,
    planetLabels: true,
    nebulaLabels: true,
    atmosphere: false,
    landscape: true,
    skyOpacity: 0.95,
    zodiacalLight: true,
  },
  2: {
    bortle: 2,
    label: 'Typical truly dark site',
    nelm: '7.1–7.5',
    sqm: '21.60–21.75',
    desc: 'Zodiacal light yellowish, Milky Way highly structured, gegenschein visible',
    starMagLimit: 7.0,
    milkywayVisible: true,
    milkywayAlpha: 1.0,
    constellationsLines: true,
    constellationsLabels: true,
    starLabels: true,
    planetLabels: true,
    nebulaLabels: true,
    atmosphere: false,
    landscape: true,
    skyOpacity: 0.92,
    zodiacalLight: true,
  },
  3: {
    bortle: 3,
    label: 'Rural sky',
    nelm: '6.6–7.0',
    sqm: '21.30–21.60',
    desc: 'Zodiacal light striking in spring/autumn, some light pollution at horizon',
    starMagLimit: 6.5,
    milkywayVisible: true,
    milkywayAlpha: 0.9,
    constellationsLines: true,
    constellationsLabels: true,
    starLabels: true,
    planetLabels: true,
    nebulaLabels: true,
    atmosphere: false,
    landscape: true,
    skyOpacity: 0.9,
    zodiacalLight: false,
  },
  4: {
    bortle: 4,
    label: 'Brighter rural',
    nelm: '6.3–6.5',
    sqm: '20.80–21.30',
    desc: 'Zodiacal light visible but not to zenith, light domes in several directions',
    starMagLimit: 6.0,
    milkywayVisible: true,
    milkywayAlpha: 0.7,
    constellationsLines: true,
    constellationsLabels: true,
    starLabels: true,
    planetLabels: true,
    nebulaLabels: false,
    atmosphere: false,
    landscape: true,
    skyOpacity: 0.85,
    zodiacalLight: false,
  },
  5: {
    bortle: 5,
    label: 'Suburban sky',
    nelm: '5.6–6.0',
    sqm: '19.25–20.30',
    desc: 'Only hints of zodiacal light, light pollution in most directions, Milky Way washed out',
    starMagLimit: 5.5,
    milkywayVisible: true,
    milkywayAlpha: 0.4,
    constellationsLines: true,
    constellationsLabels: true,
    starLabels: true,
    planetLabels: true,
    nebulaLabels: false,
    atmosphere: false,
    landscape: true,
    skyOpacity: 0.82,
    zodiacalLight: false,
  },
  6: {
    bortle: 6,
    label: 'Bright suburban sky',
    nelm: '5.1–5.5',
    sqm: '18.50–19.25',
    desc: 'Zodiacal light invisible, sky within 35° of horizon glows grayish white',
    starMagLimit: 5.0,
    milkywayVisible: false,
    milkywayAlpha: 0,
    constellationsLines: true,
    constellationsLabels: false,
    starLabels: true,
    planetLabels: true,
    nebulaLabels: false,
    atmosphere: false,
    landscape: true,
    skyOpacity: 0.78,
    zodiacalLight: false,
  },
  7: {
    bortle: 7,
    label: 'Suburban/urban transition',
    nelm: '4.6–5.0',
    sqm: '18.00–18.50',
    desc: 'Entire sky light gray, Milky Way nearly invisible',
    starMagLimit: 4.5,
    milkywayVisible: false,
    milkywayAlpha: 0,
    constellationsLines: true,
    constellationsLabels: false,
    starLabels: true,
    planetLabels: true,
    nebulaLabels: false,
    atmosphere: true,
    landscape: true,
    skyOpacity: 0.75,
    zodiacalLight: false,
  },
  8: {
    bortle: 8,
    label: 'City sky',
    nelm: '4.1–4.5',
    sqm: '< 18.00',
    desc: 'Sky light gray or orange, can read by it, only brightest stars',
    starMagLimit: 4.0,
    milkywayVisible: false,
    milkywayAlpha: 0,
    constellationsLines: false,
    constellationsLabels: false,
    starLabels: false,
    planetLabels: true,
    nebulaLabels: false,
    atmosphere: true,
    landscape: true,
    skyOpacity: 0.7,
    zodiacalLight: false,
  },
  9: {
    bortle: 9,
    label: 'Inner-city sky',
    nelm: '≤ 4.0',
    sqm: '—',
    desc: 'Only Moon, planets, and brightest stars visible, sky glows white/orange',
    starMagLimit: 3.5,
    milkywayVisible: false,
    milkywayAlpha: 0,
    constellationsLines: false,
    constellationsLabels: false,
    starLabels: false,
    planetLabels: true,
    nebulaLabels: false,
    atmosphere: true,
    landscape: true,
    skyOpacity: 0.65,
    zodiacalLight: false,
  },
};

/**
 * Get the preset for a given Bortle class (1-9)
 */
export function getBortlePreset(bortleClass) {
  var b = Math.round(bortleClass);
  if (b < 1) b = 1;
  if (b > 9) b = 9;
  return PRESETS[b];
}

/**
 * Get all 9 presets as an array
 */
export function getAllPresets() {
  return Object.values(PRESETS);
}

/**
 * Get the recommended Bortle — try camera first, fall back to API estimate
 */
export async function getRecommendedBortle(lat, lon, cameraBortle) {
  // If we have a camera estimate with decent confidence, use it
  if (cameraBortle != null && cameraBortle >= 1 && cameraBortle <= 9) {
    return cameraBortle;
  }
  // Fall back to the backend light-pollution-map scraper
  try {
    var mod = await import('../core/bortle-service.js');
    return await mod.estimateBortleClass(lat, lon);
  } catch (e) {
    return 5; // default suburban
  }
}
