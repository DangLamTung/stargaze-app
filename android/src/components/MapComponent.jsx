import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Sovereignty Overlays for Hoang Sa / Truong Sa
function SovereigntyOverlays() {
  const map = useMap();
  useEffect(() => {
    const hoangSaIcon = L.divIcon({
      className: 'sovereignty-label',
      html: '<div style="color: #ff3333; font-weight: bold; text-shadow: 1px 1px 0 #fff, -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff; font-size: 14px; white-space: nowrap;">Quần đảo Hoàng Sa (Việt Nam)</div>',
      iconSize: [200, 20],
      iconAnchor: [100, 10]
    });
    L.marker([16.5, 112.0], { icon: hoangSaIcon, zIndexOffset: 500 }).addTo(map);
    L.circle([16.5, 112.0], { radius: 100000, color: '#ff3333', weight: 2, fillOpacity: 0.1, dashArray: '5, 5' }).addTo(map);

    const truongSaIcon = L.divIcon({
      className: 'sovereignty-label',
      html: '<div style="color: #ff3333; font-weight: bold; text-shadow: 1px 1px 0 #fff, -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff; font-size: 14px; white-space: nowrap;">Quần đảo Trường Sa (Việt Nam)</div>',
      iconSize: [200, 20],
      iconAnchor: [100, 10]
    });
    L.marker([10.0, 114.0], { icon: truongSaIcon, zIndexOffset: 500 }).addTo(map);
    L.circle([10.0, 114.0], { radius: 150000, color: '#ff3333', weight: 2, fillOpacity: 0.1, dashArray: '5, 5' }).addTo(map);
  }, [map]);

  return null;
}

function CuratedSpotsOverlay() {
  const [spots, setSpots] = React.useState([]);

  useEffect(() => {
    fetch('/api/curated_spots')
      .then(res => res.json())
      .then(data => setSpots(data))
      .catch(err => console.error(err));
  }, []);

  const spotIcon = L.divIcon({
    className: 'custom-marker',
    html: `<div class="marker-pin" style="background:#fbbf24;box-shadow:0 0 12px #fbbf2460"><span class="marker-emoji">✨</span></div>`,
    iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -36],
  });

  return spots.map(spot => (
    <Marker key={spot.id} position={[spot.latitude, spot.longitude]} icon={spotIcon}>
      <Popup>
        <div style={{ color: '#1e1e36' }}>
          <strong style={{ fontSize: '16px' }}>{spot.name}</strong><br/>
          <span style={{ fontSize: '12px', color: '#666' }}>Bortle Class {spot.bortle}</span><br/>
          <p style={{ marginTop: '5px' }}>{spot.description}</p>
        </div>
      </Popup>
    </Marker>
  ));
}

export default function MapComponent({ center, onMapClick }) {
  return (
    <MapContainer 
      center={center || [16.0, 106.0]} 
      zoom={5} 
      style={{ height: '100%', width: '100%' }}
      zoomControl={false}
    >
      <TileLayer
        attribution='&copy; OpenStreetMap contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <TileLayer
        url="/api/tile/{z}/{x}/{y}.png?year=2023"
        opacity={0.6}
      />
      <SovereigntyOverlays />
      <CuratedSpotsOverlay />
      {center && (
        <Marker position={center}>
          <Popup>Selected Location</Popup>
        </Marker>
      )}
    </MapContainer>
  );
}
