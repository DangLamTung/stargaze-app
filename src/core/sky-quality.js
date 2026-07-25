/**
 * SkyQuality — Advanced astronomical sky quality metrics.
 *
 * Tier 2 metrics:
 *   1. Aerosol Optical Depth (AOD) — from Open-Meteo Air Quality
 *   2. Astronomical Seeing (Cₙ², r₀) — from pressure-level wind shear
 *   3. PM2.5 light scattering penalty
 *   4. Lunar sky brightness model (Krisciunas & Schaefer 1991)
 *   5. Atmospheric extinction coefficient
 *
 * All computations are pure JS — no new API keys needed beyond
 * the free Open-Meteo endpoints already in use.
 */

// ─── Constants ───

// Rayleigh optical depth at sea level (550nm)
const RAYLEIGH_OD = 0.145;

// Typical effective turbulence height (km)
const EFFECTIVE_TURB_HEIGHT = 7.0;

// Reference wavelength for seeing (nm)
const REF_WAVELENGTH = 550;

// ─── Aerosol Optical Depth (AOD) ───

/**
 * AOD from PM2.5 using empirical relationship.
 * PM2.5 (μg/m³) → AOD at 550nm.
 * Based on: AOD ≈ α × PM2.5^β where α ≈ 0.001–0.003, β ≈ 0.7–0.9
 * Uses the Wang & Christopher (2003) regression.
 */
export function estimateAODFromPM25(pm25) {
  if (pm25 == null) return null;
  // Clamp to realistic range
  const p = Math.max(0, Math.min(500, pm25));
  // Piecewise: low PM2.5 → near-linear, high PM2.5 → saturating
  if (p <= 10) return p * 0.008;
  if (p <= 50) return 0.08 + (p - 10) * 0.006;
  if (p <= 150) return 0.32 + (p - 50) * 0.004;
  return 0.72 + (p - 150) * 0.002;
}

/**
 * AOD quality rating.
 */
export function getAODRating(aod) {
  if (aod == null) return { label: 'Unknown', color: '#888' };
  if (aod <= 0.05) return { label: 'Crystal', color: '#00e5ff' };
  if (aod <= 0.15) return { label: 'Clear', color: '#00e676' };
  if (aod <= 0.3) return { label: 'Hazy', color: '#ffea00' };
  if (aod <= 0.5) return { label: 'Dusty', color: '#ff9100' };
  return { label: 'Opaque', color: '#ff1744' };
}

// ─── PM2.5 Light Scattering ───

/**
 * PM2.5 scatters artificial light upward, brightening the sky.
 * Returns a penalty factor (0–1) where 1 = no penalty.
 *
 * Based on Garstang light pollution model: scattered light ∝ aerosol density.
 * PM2.5 > 0 adds to the natural Rayleigh + aerosol background.
 */
export function pm25ScatterPenalty(pm25) {
  if (pm25 == null) return 1.0;
  // Baseline PM2.5 ≈ 5 μg/m³ (clean air)
  // Each 10 μg/m³ above baseline adds ~15% to sky brightness
  const excess = Math.max(0, pm25 - 5);
  // Exponential decay: the more particles, the more saturation
  const penalty = Math.exp(-excess / 55);
  return Math.max(0.3, penalty);
}

/**
 * PM2.5 quality label.
 */
export function getPM25Rating(pm25) {
  if (pm25 == null) return { label: 'N/A', color: '#888' };
  if (pm25 <= 12) return { label: 'Clean', color: '#00e676' };
  if (pm25 <= 35) return { label: 'Moderate', color: '#ffea00' };
  if (pm25 <= 55) return { label: 'Hazy', color: '#ff9100' };
  if (pm25 <= 150) return { label: 'Poor', color: '#ff5722' };
  return { label: 'Severe', color: '#ff1744' };
}

// ─── Astronomical Seeing (Fried parameter r₀) ───

/**
 * Estimate the Fried parameter r₀ (cm) from vertical wind shear.
 *
 * Uses Hufnagel-Valley 5/7 model simplified:
 *   r₀ ≈ 0.114 × (λ/550nm)^(6/5) × (5500/V_jet) × cos(zenith)^(3/5)
 *
 * Where V_jet is the wind speed at 200 hPa (jet stream level).
 *
 * @param {number|null} wind200hPa - Wind speed at 200 hPa in m/s
 * @param {number} zenithAngleDeg - Zenith angle in degrees (0 = overhead)
 * @returns {{ r0cm: number, seeingArcsec: number, rating: object }}
 */
export function estimateSeeing(wind200hPa, zenithAngleDeg = 0) {
  if (wind200hPa == null) {
    return { r0cm: null, seeingArcsec: null, rating: { label: 'N/A', color: '#888' } };
  }

  const V = Math.max(5, wind200hPa); // minimum 5 m/s
  const zRad = (zenithAngleDeg * Math.PI) / 180;
  const cosZ = Math.cos(zRad);

  // r₀ at zenith, at 550nm
  const r0Zenith = 0.114 * Math.pow(REF_WAVELENGTH / REF_WAVELENGTH, 1.2) * (5500 / V);
  // Correct for zenith angle (worse near horizon)
  const r0 = r0Zenith * Math.pow(Math.max(0.05, cosZ), 0.6);

  // Convert r₀ (cm) to seeing FWHM (arcsec)
  // θ ≈ 0.98 × λ / r₀  (λ=550nm, r₀ in cm)
  // θ_arcsec ≈ 0.98 × (550e-9 / (r₀ × 0.01)) × 206265
  // Simplified: θ ≈ 11.2 / r₀
  const seeingArcsec = r0 > 0 ? 11.2 / r0 : 10;

  let rating;
  if (seeingArcsec <= 0.5) rating = { label: 'Superb', color: '#00e5ff' };
  else if (seeingArcsec <= 1.0) rating = { label: 'Excellent', color: '#00e676' };
  else if (seeingArcsec <= 2.0) rating = { label: 'Good', color: '#76ff03' };
  else if (seeingArcsec <= 3.0) rating = { label: 'Fair', color: '#ffea00' };
  else if (seeingArcsec <= 5.0) rating = { label: 'Poor', color: '#ff9100' };
  else rating = { label: 'Terrible', color: '#ff1744' };

  return {
    r0cm: Math.round(r0 * 10) / 10,
    seeingArcsec: Math.round(seeingArcsec * 10) / 10,
    rating,
  };
}

/**
 * Estimate Cₙ² (refractive index structure constant) from wind shear.
 * More advanced than r₀ alone — gives vertical profile.
 *
 * Cₙ² ∝ (wind_shear)²  where shear = |V(200hPa) − V(850hPa)|
 *
 * Returns: { cn2: number, turbulence: string }
 */
export function estimateTurbulence(wind200hPa, wind850hPa) {
  if (wind200hPa == null || wind850hPa == null) {
    return { cn2Log: null, turbulence: 'unknown' };
  }

  const shear = Math.abs(wind200hPa - wind850hPa);
  // Cₙ² scale: log₁₀(Cₙ²) typically ranges from -17 (calm) to -12 (stormy)
  const cn2Log = -17 + (shear / 60) * 5;

  let turbulence;
  if (cn2Log < -16) turbulence = 'calm';
  else if (cn2Log < -15) turbulence = 'light';
  else if (cn2Log < -14) turbulence = 'moderate';
  else if (cn2Log < -13) turbulence = 'strong';
  else turbulence = 'severe';

  return { cn2Log: Math.round(cn2Log * 10) / 10, turbulence };
}

// ─── Lunar Sky Brightness Model ───

/**
 * Krisciunas & Schaefer (1991) lunar sky brightness model.
 *
 * Computes the increase in sky background (mag/arcsec²) due to moonlight.
 *
 * @param {number} moonPhase - 0=new, 0.5=full, 1=new
 * @param {number} moonAltDeg - Moon altitude in degrees
 * @param {number} targetMoonSepDeg - Angular separation between target and moon (degrees)
 * @param {number} extinctionCoeff - Atmospheric extinction coefficient (mag/airmass), default 0.3
 * @returns {{ deltaB: number, skyBrightness: number, rating: object }}
 */
export function lunarSkyBrightness(moonPhase, moonAltDeg, targetMoonSepDeg, extinctionCoeff = 0.3) {
  if (moonPhase == null) moonPhase = 0;

  const illumination = (1 - Math.cos(moonPhase * 2 * Math.PI)) / 2;

  // Moon below horizon or new moon → no effect
  if (moonAltDeg <= 0 || illumination < 0.01) {
    return { deltaB: 0, skyBrightness: 22.0, rating: { label: 'No moon', color: '#00e676' } };
  }

  const moonAltRad = (moonAltDeg * Math.PI) / 180;
  const rho = targetMoonSepDeg; // angular separation
  const alpha = moonPhase * 360; // phase angle in degrees (0=full, 180=new)

  // Moon magnitude (approximate, Allen 1976)
  const V_moon = -12.73 + 0.026 * Math.abs(alpha) + 4e-9 * Math.pow(alpha, 4);

  // Airmass of moon
  const X_moon = 1 / (Math.sin(moonAltRad) + 0.15 * Math.pow((moonAltRad * 180) / Math.PI + 3.885, -1.253));

  // Scattering function f(ρ) — Krisciunas & Schaefer Table 5
  let f_rho;
  const r = Math.max(1, rho);
  if (r < 5) f_rho = 3.8e5 * Math.pow(r, -2.5);
  else if (r < 20) f_rho = 3.9e3 * Math.pow(r, -1.8);
  else if (r < 60) f_rho = 4.1e2 * Math.pow(r, -1.1);
  else if (r < 100) f_rho = 14.0 * Math.pow(r, -0.65);
  else f_rho = 0.7;

  // Rayleigh scattering
  const B_ray = f_rho * Math.pow(10, -0.4 * (V_moon + extinctionCoeff * X_moon));

  // Mie (aerosol) scattering — dominates at small angular separations
  const B_mie = 1.2e6 * Math.pow(r, -1.7) * Math.pow(10, -0.4 * (V_moon + extinctionCoeff * X_moon));

  // Total added brightness in nanoLamberts
  const B_total = B_ray + B_mie;

  // Convert to mag/arcsec²
  // μ = 22.0 − 2.5×log₁₀(1 + B_total/34.08)  (34.08 nL ≈ 22.0 mag/arcsec²)
  const deltaB = 2.5 * Math.log10(1 + B_total / 34.08);
  const skyBrightness = 22.0 - deltaB;

  let rating;
  if (deltaB < 0.1) rating = { label: 'Dark', color: '#00e5ff' };
  else if (deltaB < 0.5) rating = { label: 'Slight glow', color: '#00e676' };
  else if (deltaB < 1.5) rating = { label: 'Moonlit', color: '#ffea00' };
  else if (deltaB < 3.0) rating = { label: 'Bright moon', color: '#ff9100' };
  else rating = { label: 'Washed out', color: '#ff1744' };

  return {
    deltaB: Math.round(deltaB * 100) / 100,
    skyBrightness: Math.round(skyBrightness * 10) / 10,
    moonAltDeg,
    moonPhase,
    illumination: Math.round(illumination * 100),
    rating,
  };
}

// ─── Atmospheric Extinction ───

/**
 * Compute atmospheric extinction coefficient (mag/airmass).
 *
 * k = k_rayleigh + k_aerosol + k_ozone
 *
 * k_rayleigh ≈ 0.145 × exp(-h/8)  (h = elevation in km)
 * k_aerosol ≈ AOD × 1.1  (Ångström conversion)
 * k_ozone ≈ 0.016 (typical)
 *
 * @param {number|null} aod - Aerosol optical depth at 550nm
 * @param {number} elevationM - Site elevation in meters
 * @returns {number} Extinction coefficient in mag/airmass
 */
export function estimateExtinction(aod, elevationM = 0) {
  const h = elevationM / 1000;
  const k_ray = RAYLEIGH_OD * Math.exp(-h / 8);
  const k_aer = (aod != null ? aod : 0.05) * 1.1;
  const k_ozone = 0.016;
  return Math.round((k_ray + k_aer + k_ozone) * 1000) / 1000;
}

/**
 * Extinction quality rating.
 */
export function getExtinctionRating(k) {
  if (k == null) return { label: 'N/A', color: '#888' };
  if (k <= 0.15) return { label: 'Photometric', color: '#00e5ff' };
  if (k <= 0.25) return { label: 'Excellent', color: '#00e676' };
  if (k <= 0.4) return { label: 'Good', color: '#76ff03' };
  if (k <= 0.6) return { label: 'Average', color: '#ffea00' };
  if (k <= 0.8) return { label: 'Poor', color: '#ff9100' };
  return { label: 'Very poor', color: '#ff1744' };
}

// ─── Precipitable Water Vapor (PWV) ───

/**
 * Estimate PWV from surface dew point temperature.
 * Smith (1966) empirical formula.
 *
 * @param {number|null} dewPointC - Dew point temperature in °C
 * @returns {number} PWV in mm
 */
export function estimatePWV(dewPointC) {
  if (dewPointC == null) return null;
  // Smith 1966: PWV ≈ exp(0.0698 × T_dew) mm
  // Clamped to realistic range
  const pwv = Math.exp(0.0698 * dewPointC);
  return Math.round(Math.max(1, Math.min(80, pwv)));
}

/**
 * PWV quality rating.
 */
export function getPWVRating(pwv) {
  if (pwv == null) return { label: 'N/A', color: '#888' };
  if (pwv <= 5) return { label: 'Desert dry', color: '#00e5ff' };
  if (pwv <= 15) return { label: 'Dry', color: '#00e676' };
  if (pwv <= 30) return { label: 'Humid', color: '#ffea00' };
  if (pwv <= 50) return { label: 'Very humid', color: '#ff9100' };
  return { label: 'Tropical', color: '#ff1744' };
}

// ─── Cirrus Warning ───

/**
 * Check for thin high cirrus that's invisible to naked eye
 * but devastating for astrophotography.
 *
 * @param {number|null} cloudCoverHigh - High cloud cover %
 * @param {number|null} cloudCoverTotal - Total cloud cover %
 * @returns {{ warning: boolean, message: string }}
 */
export function cirrusWarning(cloudCoverHigh, cloudCoverTotal) {
  if (cloudCoverHigh == null) return { warning: false, message: '' };
  const totalLow = cloudCoverTotal != null ? cloudCoverTotal : 0;

  // High clouds present but total cloud is low → invisible cirrus
  if (cloudCoverHigh > 30 && totalLow < 30) {
    return { warning: true, message: 'Invisible cirrus detected — astrophotography not recommended' };
  }
  if (cloudCoverHigh > 15 && totalLow < 15) {
    return { warning: true, message: 'Thin cirrus may reduce contrast' };
  }
  return { warning: false, message: '' };
}

// ─── Comprehensive Sky Quality Report ───

/**
 * Build a complete sky quality report from all available data.
 *
 * @param {object} params
 * @param {number|null} params.pm25 - PM2.5 in μg/m³
 * @param {number|null} params.wind200hPa - Wind at 200hPa in m/s
 * @param {number|null} params.wind850hPa - Wind at 850hPa in m/s
 * @param {number} params.moonPhase - 0=new, 0.5=full
 * @param {number} params.moonAltDeg - Moon altitude in degrees
 * @param {number|null} params.dewPointC - Dew point in °C
 * @param {number|null} params.cloudCoverHigh - High cloud %
 * @param {number|null} params.cloudCoverTotal - Total cloud %
 * @param {number} params.elevationM - Site elevation in meters
 */
export function buildSkyQualityReport(params) {
  const {
    pm25 = null,
    wind200hPa = null,
    wind850hPa = null,
    moonPhase = 0,
    moonAltDeg = -90,
    dewPointC = null,
    cloudCoverHigh = null,
    cloudCoverTotal = null,
    elevationM = 0,
  } = params;

  // AOD from PM2.5
  const aod = estimateAODFromPM25(pm25);

  // Seeing
  const seeing = estimateSeeing(wind200hPa);
  const turbulence = estimateTurbulence(wind200hPa, wind850hPa);

  // Extinction
  const extinction = estimateExtinction(aod, elevationM);

  // PWV
  const pwv = estimatePWV(dewPointC);

  // PM2.5 scatter
  const scatterPenalty = pm25ScatterPenalty(pm25);

  // Lunar brightness (worst case: target 90° from moon at zenith)
  const lunarWorst = lunarSkyBrightness(moonPhase, moonAltDeg, 30, extinction);

  // Cirrus
  const cirrus = cirrusWarning(cloudCoverHigh, cloudCoverTotal);

  // Combined seeing quality score (0–100)
  let seeingScore = 100;
  if (seeing.seeingArcsec != null) {
    if (seeing.seeingArcsec > 5) seeingScore = 10;
    else if (seeing.seeingArcsec > 3) seeingScore = 35;
    else if (seeing.seeingArcsec > 2) seeingScore = 55;
    else if (seeing.seeingArcsec > 1) seeingScore = 75;
    else if (seeing.seeingArcsec > 0.5) seeingScore = 90;
  }

  // Combined transparency score (0–100)
  let transparencyScore = 100;
  if (aod != null) {
    if (aod > 0.5) transparencyScore = 20;
    else if (aod > 0.3) transparencyScore = 45;
    else if (aod > 0.15) transparencyScore = 70;
    else if (aod > 0.05) transparencyScore = 90;
  }
  transparencyScore = Math.round(transparencyScore * scatterPenalty);

  return {
    aod,
    aodRating: getAODRating(aod),
    pm25,
    pm25Rating: getPM25Rating(pm25),
    scatterPenalty: Math.round(scatterPenalty * 100) / 100,
    seeing,
    turbulence,
    seeingScore,
    extinction,
    extinctionRating: getExtinctionRating(extinction),
    pwv,
    pwvRating: getPWVRating(pwv),
    lunarBrightness: lunarWorst,
    cirrus,
    transparencyScore,
  };
}
