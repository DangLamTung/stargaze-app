import React, { useState, useEffect } from 'react';

export default function Search({ onLocationSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      return;
    }

    const delayDebounceFn = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en&format=json`);
        const data = await res.json();
        setResults(data.results || []);
      } catch (err) {
        console.error("Search failed", err);
      } finally {
        setLoading(false);
      }
    }, 400);

    return () => clearTimeout(delayDebounceFn);
  }, [query]);

  return (
    <div className="search-container" style={{ position: 'relative' }}>
      <div className="section-title">
        <span className="title-icon">🔍</span> Search
      </div>
      <input
        type="text"
        className="search-input"
        placeholder="Search location..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {results.length > 0 && (
        <div className="search-results visible" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000, background: '#1e1e36', border: '1px solid #3a3a5c', borderRadius: '8px' }}>
          {results.map((loc, i) => (
            <button
              key={i}
              className="search-item"
              type="button"
              onClick={() => {
                onLocationSelect(loc);
                setResults([]);
                setQuery(`${loc.name}, ${loc.country || ''}`);
              }}
              style={{ width: '100%', textAlign: 'left', padding: '10px', background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', borderBottom: '1px solid #3a3a5c' }}
            >
              <span className="search-item-name" style={{ fontWeight: 'bold', display: 'block' }}>{loc.name}</span>
              <span className="search-item-detail" style={{ fontSize: '12px', color: '#9ba1b9' }}>{loc.admin1}, {loc.country}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
