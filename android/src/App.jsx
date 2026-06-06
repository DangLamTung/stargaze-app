import React, { useState } from 'react';
import './index.css';

import MapComponent from './components/MapComponent';
import Search from './components/Search';
import WeatherDashboard from './components/WeatherDashboard';

function App() {
  const [activeTab, setActiveTab] = useState('map');
  const [mapCenter, setMapCenter] = useState(null);

  return (
    <div className="app-container">
      <header className="top-bar">
        <div className="logo-container">
          <span className="logo-icon">🔭</span>
          <span className="logo-text">StarGaze React</span>
        </div>
        <div className="location-display">
          Global Coordinates
        </div>
      </header>

      <main className="main-content">
        <div className="map-container" style={{ position: 'relative', width: '100%', height: '100%' }}>
          <MapComponent center={mapCenter} />
          
          <div className="curated-spots-panel" style={{
            position: 'absolute',
            bottom: '20px',
            right: '20px',
            zIndex: 1000,
            background: 'rgba(30, 30, 54, 0.9)',
            padding: '15px',
            borderRadius: '12px',
            border: '1px solid #3a3a5c',
            maxWidth: '300px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            backdropFilter: 'blur(10px)'
          }}>
            <h4 style={{ margin: '0 0 10px 0', color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>✨</span> Curated Spots
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button onClick={() => setMapCenter([21.1396, 105.0211])} style={{ textAlign: 'left', background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', padding: '5px' }}>
                <strong>Long Cốc</strong> <span style={{fontSize:'12px', color:'#9ba1b9'}}>- Tea hills</span>
              </button>
              <button onClick={() => setMapCenter([11.5807, 108.9863])} style={{ textAlign: 'left', background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', padding: '5px' }}>
                <strong>Phan Rang</strong> <span style={{fontSize:'12px', color:'#9ba1b9'}}>- Hang Rái</span>
              </button>
              <button onClick={() => setMapCenter([11.9961, 107.6934])} style={{ textAlign: 'left', background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', padding: '5px' }}>
                <strong>Gia Nghĩa</strong> <span style={{fontSize:'12px', color:'#9ba1b9'}}>- Dark Skies</span>
              </button>
            </div>
          </div>
        </div>

        <aside className="sidebar">
          <div className="sidebar-tabs">
            <button 
              className={`tab-btn ${activeTab === 'map' ? 'active' : ''}`}
              onClick={() => setActiveTab('map')}
            >
              Sky Map
            </button>
            <button 
              className={`tab-btn ${activeTab === 'weather' ? 'active' : ''}`}
              onClick={() => setActiveTab('weather')}
            >
              Weather Charts
            </button>
            <button 
              className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              Settings
            </button>
          </div>

          <div className="tab-content">
            {activeTab === 'map' && (
              <div className="animate-in">
                <Search onLocationSelect={(loc) => setMapCenter([loc.latitude, loc.longitude])} />
                <div style={{ marginTop: '20px', color: '#9ba1b9' }}>
                  {mapCenter ? `Selected Coordinates: ${mapCenter[0].toFixed(2)}, ${mapCenter[1].toFixed(2)}` : 'Search for a location or tap the map!'}
                </div>
              </div>
            )}
            
            {activeTab === 'weather' && (
              <div className="animate-in">
                <WeatherDashboard center={mapCenter} />
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="animate-in">
                <h2>Settings</h2>
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}

export default App;
