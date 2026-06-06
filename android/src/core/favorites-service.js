const API_URL = 'http://localhost:3000/api/favorites';

let favorites = [];

export async function loadFavorites() {
  try {
    const res = await fetch(API_URL);
    if (res.ok) {
      favorites = await res.json();
    }
  } catch (err) {
    console.error('Failed to load favorites', err);
  }
  return favorites;
}

export function getFavorites() {
  return favorites;
}

export function isFavorite(lat, lon) {
  // Check if a location is within a ~5km radius to consider it the same place
  return favorites.some(f => Math.abs(f.latitude - lat) < 0.05 && Math.abs(f.longitude - lon) < 0.05);
}

async function getWikiImage(name) {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&format=json&piprop=thumbnail&pithumbsize=300&titles=${encodeURIComponent(name)}&origin=*`;
    const res = await fetch(url);
    const data = await res.json();
    const pages = data.query?.pages;
    if (pages) {
      const pageId = Object.keys(pages)[0];
      if (pageId !== "-1" && pages[pageId].thumbnail) {
        return pages[pageId].thumbnail.source;
      }
    }
  } catch (err) {
    console.error('Failed to fetch wiki image', err);
  }
  return null;
}

export async function toggleFavorite(location) {
  const existingIdx = favorites.findIndex(f => Math.abs(f.latitude - location.latitude) < 0.05 && Math.abs(f.longitude - location.longitude) < 0.05);
  
  if (existingIdx >= 0) {
    favorites.splice(existingIdx, 1);
  } else {
    const image = await getWikiImage(location.name);
    favorites.push({
      id: Date.now().toString(),
      name: location.name,
      country: location.country,
      latitude: location.latitude,
      longitude: location.longitude,
      image: image,
      addedAt: new Date().toISOString()
    });
  }
  
  try {
    await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(favorites)
    });
  } catch (err) {
    console.error('Failed to save favorites', err);
  }
  
  return existingIdx < 0; // returns true if added, false if removed
}
