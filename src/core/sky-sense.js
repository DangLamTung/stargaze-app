/**
 * SkySense — Camera-based Bortle estimation.
 *
 * The Bortle Dark-Sky Scale (John E. Bortle, Sky & Telescope, Feb 2001)
 * defines 9 classes based on NELM (Naked Eye Limiting Magnitude) and
 * SQM (Sky Quality Meter) readings:
 *
 *   Class 1: NELM 7.6–8.0 | SQM 21.76–22.00 | Excellent dark-sky site
 *   Class 2: NELM 7.1–7.5 | SQM 21.60–21.75 | Typical truly dark site
 *   Class 3: NELM 6.6–7.0 | SQM 21.30–21.60 | Rural sky
 *   Class 4: NELM 6.3–6.5 | SQM 20.80–21.30 | Brighter rural
 *   Class 5: NELM 5.6–6.0 | SQM 19.25–20.30 | Suburban sky
 *   Class 6: NELM 5.1–5.5 | SQM 18.50–19.25 | Bright suburban sky
 *   Class 7: NELM 4.6–5.0 | SQM 18.00–18.50 | Suburban/urban transition
 *   Class 8: NELM 4.1–4.5 | SQM < 18.00     | City sky
 *   Class 9: NELM ≤ 4.0  | —                 | Inner-city sky
 *
 * Source: https://en.wikipedia.org/wiki/Bortle_scale
 * Original: Bortle, John E. (Feb 2001). Sky & Telescope.
 *
 * Camera heuristic: we sample video frame luminance and map it to Bortle
 * classes using thresholds calibrated against the descriptive criteria.
 * This is inherently approximate — for authoritative values, the backend
 * lightpollutionmap.info VIIRS satellite API should be used.
 */

var offscreenCanvas = null;
var offscreenCtx = null;
var lastBortleEstimate = null;
var sampleBuffer = [];
var MAX_SAMPLES = 10;

/**
 * Analyze a single video frame and return brightness metrics.
 * Call this periodically (e.g., every 30 render frames).
 */
export function analyzeFrame(videoEl) {
  if (!videoEl || videoEl.readyState < 2) return lastBortleEstimate;
  try {
    if (!offscreenCanvas) {
      offscreenCanvas = document.createElement('canvas');
      offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
    }
    // Downscale to 80×60 for fast pixel reading
    var w = 80,
      h = 60;
    offscreenCanvas.width = w;
    offscreenCanvas.height = h;
    offscreenCtx.drawImage(videoEl, 0, 0, w, h);

    var imgData = offscreenCtx.getImageData(0, 0, w, h);
    var pixels = imgData.data;
    var totalLum = 0,
      darkCount = 0,
      pixelCount = w * h;

    for (var i = 0; i < pixels.length; i += 4) {
      var r = pixels[i],
        g = pixels[i + 1],
        b = pixels[i + 2];
      // Perceived luminance (ITU BT.601)
      var lum = 0.299 * r + 0.587 * g + 0.114 * b;
      totalLum += lum;
      if (lum < 30) darkCount++;
    }

    var avgLum = totalLum / pixelCount;
    var darkPct = (darkCount / pixelCount) * 100;

    return { avgLum: avgLum, darkPct: darkPct, timestamp: Date.now() };
  } catch (e) {
    return lastBortleEstimate ? lastBortleEstimate.raw : null;
  }
}

/**
 * Map camera brightness + phone altitude to Bortle class.
 * altitudeDeg: phone tilt angle (0 = horizon, 90 = straight up)
 */
export function estimateBortleFromCamera(videoEl, altitudeDeg) {
  var raw = analyzeFrame(videoEl);
  if (!raw) return lastBortleEstimate || { bortle: 5, label: 'Unknown', confidence: 0 };

  // Clamp altitude
  var alt = Math.max(0, Math.min(90, altitudeDeg || 45));

  // Base Bortle from camera luminance.
  // Thresholds calibrated against Bortle's descriptive criteria:
  //   Class 1-2: sky appears truly dark; camera sees mostly black pixels
  //   Class 3-4: some skyglow at horizon; camera sees dark with slight glow
  //   Class 5-6: skyglow obvious in most directions; camera moderately bright
  //   Class 7-8: entire sky gray/orange; camera bright, few dark pixels
  //   Class 9:   sky glows white/orange; camera almost entirely saturated
  var avgLum = raw.avgLum;
  var bortle;
  // Realistic thresholds for phone cameras (auto-exposed):
  // B1: truly dark rural (camera sees very dark, almost black)
  // B5: suburban (moderate skyglow)
  // B9: inner-city (bright, few dark pixels)
  if (avgLum < 20) bortle = 1;
  else if (avgLum < 42) bortle = 2;
  else if (avgLum < 68) bortle = 3;
  else if (avgLum < 95) bortle = 4;
  else if (avgLum < 120) bortle = 5;
  else if (avgLum < 148) bortle = 6;
  else if (avgLum < 180) bortle = 7;
  else if (avgLum < 215) bortle = 8;
  else bortle = 9;

  // Altitude adjustment: pointing straight up sees less light pollution
  if (alt > 65) bortle = Math.max(1, bortle - 1);
  else if (alt < 15) bortle = Math.min(9, bortle + 1);

  // Dark pixel %: many dark pixels = likely dark site
  if (raw.darkPct > 60) bortle = Math.max(1, bortle - 1);
  else if (raw.darkPct < 8) bortle = Math.min(9, bortle + 1);

  // Rolling average to smooth out jitter
  sampleBuffer.push(bortle);
  if (sampleBuffer.length > MAX_SAMPLES) sampleBuffer.shift();
  var avgBortle = Math.round(
    sampleBuffer.reduce(function (a, b) {
      return a + b;
    }, 0) / sampleBuffer.length,
  );

  var labels = [
    '',
    'Excellent dark-sky site',
    'Typical truly dark site',
    'Rural sky',
    'Brighter rural',
    'Suburban sky',
    'Bright suburban sky',
    'Suburban/urban transition',
    'City sky',
    'Inner-city sky',
  ];

  var result = {
    bortle: avgBortle,
    label: labels[avgBortle] || 'Unknown',
    confidence: Math.min(100, Math.round((1 - Math.abs(bortle - avgBortle) / 9) * 100)),
    raw: raw,
  };

  lastBortleEstimate = result;
  return result;
}

/**
 * Reset the sample buffer (call when AR mode restarts)
 */
export function resetCameraBortle() {
  sampleBuffer = [];
  lastBortleEstimate = null;
}
