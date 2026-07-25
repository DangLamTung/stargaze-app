# 🔭 StarGaze — Stargazing & Sightseeing Planner

> Find the best nights for stargazing with real-time weather data, cloud coverage analysis, interactive WASM sky maps, light pollution layers, and WebGL Augmented Reality (AR) mode.

![License](https://img.shields.io/badge/License-MIT-blue.svg)
![Python](https://img.shields.io/badge/Python-3.10%2B-informational.svg)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6%2B-yellow.svg)

---

## ✨ Features

- **🌌 Interactive Sky Map & WebGL AR Mode**: Real-time planetarium rendering powered by Stellarium Web WASM engine with camera AR view, compass orientation tracking, and smooth opacity controls.
- **☁️ Real-time Weather & Satellite Overlays**: Live global satellite imagery (Himawari-9 / GOES), NASA GIBS historical cloud layers, and RainViewer precipitation radar animation.
- **🌌 Light Pollution Mapping**: Integrated Bortle scale overlays and VIIRS Radiance imagery for discovering dark sky locations.
- **🌊 Tide & Astronomical Data**: Coastal tide curves, moon phase calculations, moonlight brightness indicators, and twilight timing.
- **🗺️ Interactive Map & Location Search**: Instant place search with multi-provider geocoding (Google Maps, Open-Meteo, Nominatim), favorite location bookmarks, and curated dark-sky spots.

---

## 🛠️ Tech Stack

- **Backend**: Python (Threaded HTTP Server, REST API routing, caching, CORS headers)
- **Frontend**: Vanilla JavaScript (ES modules), HTML5, CSS3 Glassmorphism
- **Mapping & Rendering**: Leaflet.js, WebGL / WASM (Stellarium Web Engine)
- **Deployment**: Docker, Fly.io

---

## 🚀 Getting Started

### Prerequisites

- **Python**: `3.10` or higher
- **Node.js**: `18.0` or higher (for linting & formatting tooling)

### 1. Clone & Setup Environment

```bash
# Clone the repository
git clone https://github.com/your-username/stargaze.git
cd stargaze

# Copy the environment template
cp .env.example .env
```

Edit `.env` to configure your API keys (optional; free fallbacks like Open-Meteo and OpenStreetMap are used automatically if keys are omitted).

### 2. Install Dependencies

```bash
# Python dependencies
pip install -r requirements.txt

# Node.js development tools (ESLint, Prettier)
npm install
```

### 3. Run Locally

Start the local server:

```bash
python3 -m backend.main
```

Open your browser and navigate to:
👉 `http://localhost:3000/`

---

## 🧪 Code Quality & Formatting

Run code quality checks and formatting:

```bash
# Check code formatting and linting
npm run check

# Auto-format codebase with Prettier
npm run format
```

---

## ☁️ Deployment (Fly.io)

This project includes a ready-to-use `Dockerfile` and `fly.toml` for seamless deployment on Fly.io:

```bash
# Deploy to Fly.io
fly deploy
```

---

## 📜 License

This project is licensed under the [MIT License](LICENSE).
