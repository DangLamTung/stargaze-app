"""Geo routes: geocode, reverse geocode, nearby, bortle, curated spots."""
from .. import api


def register(handler):
    """Register geo-related routes on the handler class."""
    cls = handler

    def geo_geocode(self):
        try:
            data = api.handle_api_geocode_logic(self.path)
            self._json(200, data)
        except Exception as e:
            self._json(500, {"error": str(e)})

    def geo_reverse(self):
        try:
            data = api.handle_api_reverse_geocode_logic(self.path)
            self._json(200, data)
        except Exception as e:
            self._json(500, {"error": str(e)})

    def geo_nearby(self):
        try:
            places = api.handle_api_nearby_logic(self.path)
            self._json(200, places)
        except ValueError:
            self._json(400, {"error": "Invalid parameters"})

    def geo_bortle(self):
        import urllib.parse
        try:
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            lat = float(q.get("lat", ["0"])[0])
            lon = float(q.get("lon", ["0"])[0])
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                raise ValueError("Invalid coordinates")
            data = api.handle_api_bortle_logic(lat, lon)
            self._json(200, data)
        except ValueError:
            self._json(400, {"error": "Invalid parameters"})

    def geo_famous_spots(self):
        try:
            data = api.handle_api_famous_spots()
            self._json(200, data)
        except Exception:
            self._json(500, {"error": "Failed"})

    cls._routes["/api/geocode"] = geo_geocode
    cls._routes["/api/reverse-geocode"] = geo_reverse
    cls._routes["/api/nearby"] = geo_nearby
    cls._routes["/api/bortle"] = geo_bortle
    cls._routes["/api/famous-spots"] = geo_famous_spots
