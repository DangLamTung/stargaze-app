/**
 * Fetch Bortle scale from the backend scraper (clearoutside.com)
 */
export async function estimateBortleClass(lat, lon) {
  try {
    const res = await fetch(`/api/bortle?lat=${lat}&lon=${lon}`);
    if (!res.ok) throw new Error('Bortle API failed');
    const data = await res.json();
    
    if (data.bortle && data.bortle !== "Unknown") {
      return parseInt(data.bortle, 10);
    }
    
    // Default fallback if scraper fails
    return 5;
  } catch (err) {
    console.warn('Bortle estimation failed, defaulting to 5', err);
    return 5;
  }
}
