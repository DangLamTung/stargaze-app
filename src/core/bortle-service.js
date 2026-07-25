/**
 * Fetch Bortle scale from the backend scraper (clearoutside.com)
 */
export async function estimateBortleClass(lat, lon) {
  try {
    const res = await fetch(`/api/bortle?lat=${lat}&lon=${lon}`);
    if (!res.ok) throw new Error('Bortle API failed');
    const data = await res.json();
    if (data.bortle && data.bortle !== 'Unknown') return parseInt(data.bortle, 10);
    // API returned no data — default to 7 (bright suburban) as neutral estimate
    return 7;
  } catch (err) {
    console.warn('Bortle estimation failed, defaulting to 5', err);
    return 5;
  }
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
    if (!res.ok) throw new Error('Batch bortle failed');
    const data = await res.json();
    return data.map(d => {
      const b = parseInt(d.bortle, 10);
      return isNaN(b) ? 7 : b;
    });
  } catch (err) {
    console.warn('Batch bortle failed, defaulting all to 5', err);
    return places.map(() => 7);
  }
}
