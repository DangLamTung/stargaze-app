"""Route registry — maps URL path patterns to handler functions.
Each handler receives (self, path) where self is the CORSRequestHandler instance.
Add new routes by appending to ROUTES list.
"""
import urllib.parse

from .api import (
    handle_api_geocode_logic,
    handle_api_reverse_geocode_logic,
    handle_api_nearby_logic,
    handle_api_bortle_logic,
    handle_api_famous_spots,
    handle_api_satellite_cloud_logic,
    handle_api_tide_logic,
    handle_api_tide_curve,
    handle_api_tide_search_logic,
    handle_api_accuweather_current,
    handle_api_weatherapi_current,
    handle_api_weatherapi_forecast,
    handle_api_owm_current,
    handle_api_metar_proxy,
    handle_api_tile_logic,
    handle_api_tile_proxy_logic,
)


def _json(self, status, data):
    self.send_response(status)
    self.send_header("Content-Type", "application/json")
    self.send_header("Access-Control-Allow-Origin", "*")
    self.end_headers()
    import json
    self.wfile.write(json.dumps(data).encode("utf-8"))


def _health(self):
    import os, time
    self._json(200, {
        "status": "ok",
        "uptime": time.time() - self.server._start_time if hasattr(self.server, '_start_time') else 0,
        "google_key_set": bool(os.environ.get("GOOGLE_MAPS_API_KEY", "")),
        "accuweather_key_set": bool(os.environ.get("ACCUWEATHER_KEY", "")),
    })


def _geocode(self):
    try:
        data = handle_api_geocode_logic(self.path)
        self._json(200, data)
    except Exception as e:
        self._json(500, {"error": str(e)})


def _reverse_geocode(self):
    try:
        data = handle_api_reverse_geocode_logic(self.path)
        self._json(200, data)
    except Exception as e:
        self._json(500, {"error": str(e)})


def _nearby(self):
    try:
        places = handle_api_nearby_logic(self.path)
        self._json(200, places)
    except ValueError:
        self._json(400, {"error": "Invalid parameters"})


def _bortle(self):
    try:
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        lat = float(q.get("lat", ["0"])[0])
        lon = float(q.get("lon", ["0"])[0])
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValueError("Invalid coordinates")
        data = handle_api_bortle_logic(lat, lon)
        self._json(200, data)
    except ValueError:
        self._json(400, {"error": "Invalid parameters"})


def _famous_spots(self):
    try:
        data = handle_api_famous_spots()
        self._json(200, data)
    except Exception:
        self._json(500, {"error": "Failed"})


def _satellite_cloud(self):
    try:
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        data = handle_api_satellite_cloud_logic(float(q.get("lat", ["0"])[0]), float(q.get("lon", ["0"])[0]))
        self._json(200, data)
    except Exception as e:
        self._json(500, {"error": str(e)})


def _tide(self):
    try:
        data = handle_api_tide_logic(self.path)
        self._json(200, data)
    except ValueError:
        self._json(400, {"error": "Invalid parameters"})


def _tide_curve(self):
    try:
        data = handle_api_tide_curve(self.path)
        self._json(200, data)
    except Exception as e:
        self._json(500, {"error": str(e)})


def _accuweather(self):
    try:
        data = handle_api_accuweather_current(self.path)
        self._json(200, data)
    except Exception as e:
        import traceback
        self._json(500, {"error": str(e), "trace": traceback.format_exc()})


def _weatherapi(self):
    try:
        data = handle_api_weatherapi_current(self.path)
        self._json(200, data)
    except Exception:
        self._json(500, {"error": "Failed"})


def _owm(self):
    try:
        data = handle_api_owm_current(self.path)
        self._json(200, data)
    except Exception:
        self._json(500, {"error": "Failed"})

# ─── Favorites (stateful — reads/writes files) ───

def _favorites_get(self):
    import os
    try:
        data = "[]"
        if os.path.exists("backend/data/favorites.json"):
            with open("backend/data/favorites.json", "r") as f:
                data = f.read()
        self._json(200, json.loads(data) if isinstance(data, str) else data)
    except Exception:
        self._json(500, {"error": "Failed to read"})


def _favorites_post(self):
    import json as _json
    content_length = min(int(self.headers.get("Content-Length", 0)), 65536)
    post_data = self.rfile.read(content_length)
    try:
        data = _json.loads(post_data.decode("utf-8"))
        with open("backend/data/favorites.json", "w") as f:
            _json.dump(data, f)
        self._json(200, {"success": True})
    except Exception:
        self._json(500, {"error": "Failed to save"})


def _curated_spots(self):
    import os
    try:
        data = "[]"
        if os.path.exists("backend/curated_spots.json"):
            with open("backend/curated_spots.json", "r") as f:
                data = f.read()
        import json as _json
        self._json(200, _json.loads(data) if isinstance(data, str) else data)
    except Exception:
        self._json(500, {"error": "Failed to read"})


def _settings_get(self):
    import os
    try:
        data = "{}"
        if os.path.exists("settings.json"):
            with open("settings.json", "r") as f:
                data = f.read()
        import json as _json
        self._json(200, _json.loads(data) if isinstance(data, str) else data)
    except Exception:
        self._json(500, {"error": "Failed to read settings"})


# ─── Proxy routes ───

def _tile(self):
    try:
        data = handle_api_tile_logic(self.path)
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "public, max-age=86400")
        self.end_headers()
        self.wfile.write(data)
    except Exception:
        self._json(500, {"error": "Failed"})


def _tile_proxy(self):
    try:
        data = handle_api_tile_proxy_logic(self.path)
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)
    except Exception:
        self._json(500, {"error": "Failed"})


def _metar(self):
    try:
        data = handle_api_metar_proxy(self.path)
        self._json(200, data)
    except Exception:
        self._json(500, {"error": "Failed"})


def _weatherapi_forecast(self):
    try:
        data = handle_api_weatherapi_forecast(self.path)
        self._json(200, data)
    except Exception:
        self._json(500, {"error": "Failed"})


def _tide_search(self):
    try:
        data = handle_api_tide_search_logic(self.path)
        self._json(200, data)
    except Exception as e:
        self._json(500, {"error": str(e)})


# ─── Route table ───
# Format: (path_prefix, handler_function, methods)
# path_prefix matches if self.path starts with it
ROUTES = [
    ("/api/health",             _health,            ["GET"]),
    ("/api/geocode",            _geocode,           ["GET"]),
    ("/api/reverse-geocode",    _reverse_geocode,   ["GET"]),
    ("/api/nearby",             _nearby,            ["GET"]),
    ("/api/bortle",             _bortle,            ["GET"]),
    ("/api/famous-spots",       _famous_spots,      ["GET"]),
    ("/api/satellite-cloud",    _satellite_cloud,   ["GET"]),
    ("/api/tide-curve",         _tide_curve,        ["GET"]),
    ("/api/tide",               _tide,              ["GET"]),
    ("/api/accuweather/current",_accuweather,       ["GET"]),
    ("/api/weatherapi/current", _weatherapi,        ["GET"]),
    ("/api/owm/current",        _owm,               ["GET"]),
    ("/api/favorites",          _favorites_get,     ["GET"]),
    ("/api/favorites",          _favorites_post,    ["POST"]),
    ("/api/curated_spots",      _curated_spots,     ["GET"]),
    ("/api/settings",           _settings_get,      ["GET"]),

    # Proxy routes
    ("/api/tile/",              _tile,              ["GET"]),
    ("/api/tile-proxy/",        _tile_proxy,        ["GET"]),
    ("/api/metar/",             _metar,             ["GET"]),
    ("/api/weatherapi/forecast",_weatherapi_forecast,["GET"]),
    ("/api/tide-search",        _tide_search,       ["GET"]),
]


def find_route(path, method):
    """Find matching route handler for path+method. Returns handler or None."""
    for prefix, handler, methods in ROUTES:
        if path.startswith(prefix) and method in methods:
            return handler
    return None
