import React, { useState, useEffect } from 'react';
import { getWeatherData, calculateMoonPhase, getMoonPhaseName, getMoonPhaseIcon } from '../core/weather-service.js';
import { calculateAllScores } from '../core/stargazing-score.js';

export default function WeatherDashboard({ center }) {
  const [tide, setTide] = useState(null);
  const [weather, setWeather] = useState(null);
  const [bortle, setBortle] = useState(null);
  const [score, setScore] = useState(null);
  const [moon, setMoon] = useState({ name: '🌑', icon: 'New Moon' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!center) return;
    setLoading(true);
    
    // 1. Fetch Marine API for tides
    fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${center[0]}&longitude=${center[1]}&hourly=ocean_height&timezone=auto`)
      .then(res => res.json())
      .then(data => {
        if (data.hourly && data.hourly.ocean_height) {
          const currentHour = new Date().getHours();
          const height = data.hourly.ocean_height[currentHour];
          if (height !== null) {
            setTide(height.toFixed(2) + 'm');
          } else {
            setTide('Inland');
          }
        }
      })
      .catch(() => setTide('Unavailable'));

    // 2. Fetch Weather Data and Bortle
    Promise.all([
      getWeatherData(center[0], center[1], 'auto'),
      fetch(`/api/bortle?lat=${center[0]}&lon=${center[1]}`).then(r => r.json())
    ]).then(([wData, bData]) => {
      setWeather(wData);
      setBortle(bData.bortle);
      
      const scores = calculateAllScores(wData, bData.bortle);
      if (scores && scores.hourly && scores.hourly.length > 0) {
        // Find current hour score
        const nowHour = new Date().getHours();
        setScore(scores.hourly[0].score); // simplified for now
      }

      const mPhase = calculateMoonPhase(new Date());
      setMoon({
        name: getMoonPhaseName(mPhase),
        icon: getMoonPhaseIcon(mPhase)
      });
      
    }).catch(err => console.error(err))
      .finally(() => setLoading(false));

  }, [center]);

  if (!center) {
    return (
      <div style={{ textAlign: 'center', marginTop: '40px', color: '#9ba1b9' }}>
        Please search or select a location on the map first.
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', marginTop: '40px', color: '#9ba1b9' }}>
        Loading real-time weather data...
      </div>
    );
  }

  // Calculate current cloud cover from weather data
  let currentCloudCover = 0;
  if (weather && weather.hourly && weather.hourly.length > 0) {
    currentCloudCover = weather.hourly[0].cloud_cover;
  }

  return (
    <div className="weather-dashboard">
      <div className="section-title">
        <span className="title-icon">📊</span> Weather Dashboard
      </div>
      
      <div className="gauges-container" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginTop: '20px' }}>
        <div className="gauge-card" style={{ background: '#1e1e36', padding: '15px', borderRadius: '12px', textAlign: 'center' }}>
          <h4>StarGaze Score</h4>
          <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#34d399', margin: '10px 0' }}>{score || 0}/100</div>
          <small style={{ color: '#9ba1b9' }}>Current Hour</small>
        </div>
        
        <div className="gauge-card" style={{ background: '#1e1e36', padding: '15px', borderRadius: '12px', textAlign: 'center' }}>
          <h4>Bortle Class</h4>
          <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#60a5fa', margin: '10px 0' }}>Class {bortle || '?'}</div>
          <small style={{ color: '#9ba1b9' }}>Light Pollution</small>
        </div>
        
        <div className="gauge-card" style={{ background: '#1e1e36', padding: '15px', borderRadius: '12px', textAlign: 'center' }}>
          <h4>Cloud Cover</h4>
          <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#fbbf24', margin: '10px 0' }}>{currentCloudCover}%</div>
          <small style={{ color: '#9ba1b9' }}>Current Hour</small>
        </div>
        
        <div className="gauge-card" style={{ background: '#1e1e36', padding: '15px', borderRadius: '12px', textAlign: 'center' }}>
          <h4>Moon Phase</h4>
          <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#f8fafc', margin: '10px 0' }}>{moon.icon}</div>
          <small style={{ color: '#9ba1b9' }}>{moon.name}</small>
        </div>

        <div className="gauge-card" style={{ background: '#1e1e36', padding: '15px', borderRadius: '12px', textAlign: 'center' }}>
          <h4>Ocean Tide</h4>
          <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#38bdf8', margin: '10px 0' }}>
            {tide || 'Loading...'}
          </div>
          <small style={{ color: '#9ba1b9' }}>Current Height</small>
        </div>
      </div>
    </div>
  );
}
