# 🔭 StarGaze — Stargazing & Sightseeing Planner

Find the best nights for stargazing with real-time weather data, cloud coverage analysis, interactive sky maps, and nearby sightseeing spots.

**Live**: [stargaze-app.fly.dev](https://stargaze-app.fly.dev)

## Features

### 🌌 Sky Condition Scoring
- Real-time stargazing score (0-100) based on cloud cover, humidity, visibility, wind, moon phase, and light pollution (Bortle scale)
- 7-night forecast with hourly breakdown
- Multi-model weather consensus (ECMWF, GFS, ICON, GEM)
- Cloud cover hard cap: >90% clouds = score near 0

### 🗺️ Interactive Map
- OpenStreetMap / CartoDB / ESRI Satellite basemaps
- Live satellite cloud overlay (Himawari/GOES)
- RainViewer precipitation radar with animation
- NASA GIBS historical cloud data
- Light pollution overlay (VIIRS radiance + Bortle scale)
- View angle/bearing indicator with FOV sector

### 🔮 AR Sky View
- Real-time augmented reality using device camera
- Stellarium Web Engine (WASM) rendering stars, planets, constellations
- Compass HUD with heading calibration
- Time/date transport controls with daylight slider
- Moon phase, rise/set markers
- Sky darkness (Bortle) estimation from camera
- Capture sky photos with lens overlay

### 🌊 Tide & Sea
- Tide predictions from cau-ca.com (Vietnamese source)
- Fallback to tide-forecast.com global model
- Interactive 24h tide chart with drag-to-pan
- Sea condition (mirror/calm/choppy/rough) based on wind + tide

### 🔔 Smart Notifications
- Background weather checks for favorite locations
- Configurable check interval (10s testing / 4h recommended)
- Email + browser push notifications
- Per-day cloud/rain/score breakdown

### ⭐ Curated Dark Sky Spots
- Pre-loaded Vietnamese stargazing locations with Bortle ratings
- Nearby clear-skies finder with filters (max Bortle, cloud %, distance)
- Batch weather scoring for best spot within radius

### 📊 Weather Charts
- Interactive Chart.js charts with zoom/pan
- Cloud cover, temperature, humidity, visibility
- +/-12h scrollable time window

## Tech Stack

- **Frontend**: Vanilla JS (ES modules), Chart.js, Leaflet, Stellarium Web Engine (WASM)
- **Backend**: Python HTTP server, Fly.io deployment
- **APIs**: Open-Meteo, OpenWeatherMap, AccuWeather, cau-ca.com, tide-forecast.com

## Deploy

```bash
flyctl deploy
```
