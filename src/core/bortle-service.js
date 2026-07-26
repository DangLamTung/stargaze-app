/**
 * Fetch Bortle scale from the backend scraper (clearoutside.com)
 */
export async function estimateBortleClass(lat, lon) {
  try {
    const res = await fetch(`/api/bortle?lat=${lat}&lon=${lon}`);
    if (res.ok) {
      const data = await res.json();
      if (data.bortle && data.bortle !== 'Unknown') return parseInt(data.bortle, 10);
    }
  } catch (err) {
    console.warn('Bortle API failed, using fallback estimate:', err);
  }
  return estimateFallbackBortle(lat, lon);
}

/**
 * Batch bortle lookup — 1 request for all places. Dramatically faster.
 * @param {Array<{latitude:number, longitude:number}>} places
 * @returns {Promise<number[]>} array of bortle values in same order
 */
export async function batchEstimateBortle(places) {
  try {
    const payload = places.map(p => ({ lat: p.latitude, lon: p.longitude }));
    const res = await fetch('/api/bortle-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = await res.json();
      return data.map((d, i) => {
        const b = parseInt(d.bortle, 10);
        return isNaN(b) ? estimateFallbackBortle(places[i].latitude, places[i].longitude) : b;
      });
    }
  } catch (err) {
    console.warn('Batch bortle failed, calculating fallback for all places:', err);
  }
  return places.map(p => estimateFallbackBortle(p.latitude, p.longitude));
}

function estimateFallbackBortle(lat, lon) {
  const hcmcDist = haversineKm(lat, lon, 10.7769, 106.7009);
  const hanoiDist = haversineKm(lat, lon, 21.0285, 105.8542);
  const minMegaDist = Math.min(hcmcDist, hanoiDist);

  if (minMegaDist < 8) return 8;
  if (minMegaDist < 20) return 6;
  if (minMegaDist < 40) return 5;
  if (minMegaDist < 70) return 4;
  if (minMegaDist < 110) return 3;
  if (minMegaDist < 160) return 2;
  return 1;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
