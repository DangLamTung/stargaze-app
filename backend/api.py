import concurrent.futures
import io
import json
import math
import os
import ssl
import urllib.parse
import urllib.request

from PIL import Image

from .bortle import get_bortle_class
from .tasks import send_email_alert
from .utils import geonames_cities, haversine, tile_cache


def handle_api_bortle_logic(lat, lon):
    bortle_class = get_bortle_class(lat, lon)
    return {"bortle": bortle_class}


# ─── Satellite cloud cover — multi-satellite support ───

# Satellite routing: pick the right geostationary satellite for the region
HIMAWARI_TIMES_URL = "https://www.jma.go.jp/bosai/himawari/data/satimg/targetTimes_fd.json"
HIMAWARI_TILE_URL = "https://www.jma.go.jp/bosai/himawari/data/satimg/{basetime}/fd/{validtime}/B13/TBB/{z}/{x}/{y}.jpg"

# GOES-16 full-disk IR (Band 13, 10.3μm) from NOAA STAR — free, no key, ~10min refresh
GOES16_LATEST_URL = "https://cdn.star.nesdis.noaa.gov/GOES16/ABI/FD/13/678x678.jpg"
GOES18_LATEST_URL = "https://cdn.star.nesdis.noaa.gov/GOES18/ABI/FD/13/678x678.jpg"

SATELLITE_ZOOM = 5  # Tile zoom for Himawari


def pick_satellite(lon):
    """Return the best geostationary satellite for a given longitude."""
    lon = ((lon + 180) % 360) - 180
    if -160 <= lon <= -20:
        return "goes16", GOES16_LATEST_URL
    if -20 < lon <= 40:
        return "meteosat", None  # Meteosat-11 at 0° — needs EUMETSAT registration
    if 40 < lon <= 80:
        return "meteosat", None  # Meteosat-9 at 45.5°E (Indian Ocean)
    if 80 < lon <= 180:
        # GK-2A at 128.2°E covers Korea/East Asia better, but needs KMA API key.
        # Falls back to Himawari-8 (140.7°E) which covers the same region for free.
        return "himawari", HIMAWARI_TIMES_URL
    return "himawari", HIMAWARI_TIMES_URL


def lat_lon_to_tile_xy(lat, lon, zoom):
    """Convert lat/lon to tile x/y (no fractional part needed for tile fetch)."""
    n = 2**zoom
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def otsu_threshold(pixels):
    """Find optimal threshold separating dark (warm/surface) from bright (cold/cloud)."""
    hist = [0] * 256
    for p in pixels:
        hist[min(255, max(0, p))] += 1

    total = len(pixels)
    sum_all = sum(i * hist[i] for i in range(256))

    best_thresh = 128
    best_between = 0
    w_bg = 0
    sum_bg = 0

    for t in range(256):
        w_bg += hist[t]
        if w_bg == 0:
            continue
        w_fg = total - w_bg
        if w_fg == 0:
            break

        sum_bg += t * hist[t]
        mean_bg = sum_bg / w_bg
        mean_fg = (sum_all - sum_bg) / w_fg

        between = w_bg * w_fg * (mean_bg - mean_fg) ** 2
        if between > best_between:
            best_between = between
            best_thresh = t

    return best_thresh


def analyze_cloud_pct(image_bytes):
    """Given a Himawari B13 infrared JPEG, return cloud cover percentage."""
    img = Image.open(io.BytesIO(image_bytes)).convert("L")
    w, h = img.size

    # Sample center region (avoid edge artifacts from full-disk projection)
    left = w // 4
    top = h // 4
    right = w - w // 4
    bottom = h - h // 4
    crop = img.crop((left, top, right, bottom))
    pixels = list(crop.getdata())

    threshold = otsu_threshold(pixels)

    # Pixels brighter than threshold = cloud (cold in IR)
    cloud_px = sum(1 for p in pixels if p > threshold)
    pct = round((cloud_px / len(pixels)) * 100)

    return {"cloud_pct": pct, "threshold": threshold, "tile_size": [w, h]}


def handle_api_satellite_cloud_logic(lat, lon):
    """Route to the right satellite for the region, fetch IR image, return cloud %."""
    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE

    sat_name, sat_url = pick_satellite(lon)

    try:
        if sat_name == "himawari":
            image_bytes = _fetch_himawari_tile(lat, lon, ssl_ctx)
        elif sat_name == "goes16":
            image_bytes = _fetch_goes_full_disk(sat_url, ssl_ctx)
        elif sat_name == "goes18":
            image_bytes = _fetch_goes_full_disk(sat_url, ssl_ctx)
        else:
            return {"error": f"Satellite {sat_name} not yet supported"}

        if image_bytes is None:
            return {"error": "Failed to fetch satellite image"}

        result = analyze_cloud_pct(image_bytes)
        result["satellite"] = sat_name
        return result
    except Exception as e:
        return {"error": f"Satellite analysis failed: {e}"}


def _fetch_himawari_tile(lat, lon, ssl_ctx):
    """Fetch a Himawari-8 tile for the given coordinates."""
    req = urllib.request.Request(HIMAWARI_TIMES_URL)
    with urllib.request.urlopen(req, timeout=10, context=ssl_ctx) as resp:
        times = json.loads(resp.read())
    if not times:
        return None
    latest = times[-1]
    x, y = lat_lon_to_tile_xy(lat, lon, SATELLITE_ZOOM)
    url = HIMAWARI_TILE_URL.format(
        basetime=latest["basetime"], validtime=latest["validtime"],
        z=SATELLITE_ZOOM, x=x, y=y,
    )
    req = urllib.request.Request(url, headers={"User-Agent": "StarGaze/1.0"})
    with urllib.request.urlopen(req, timeout=15, context=ssl_ctx) as resp:
        return resp.read()


def _fetch_goes_full_disk(url, ssl_ctx):
    """Fetch the latest GOES full-disk IR image (1808x1808, ~200KB)."""
    req = urllib.request.Request(url, headers={"User-Agent": "StarGaze/1.0"})
    with urllib.request.urlopen(req, timeout=30, context=ssl_ctx) as resp:
        return resp.read()


def handle_api_tile_logic(path):
    parsed = urllib.parse.urlparse(path)
    parts = parsed.path.split("/")
    if len(parts) >= 6:
        z = parts[3]
        x = parts[4]
        y = parts[5].split(".")[0]
        year = urllib.parse.parse_qs(parsed.query).get("year", ["2025"])[0]

        cache_key = f"{year}_{z}_{x}_{y}"
        ssl_ctx = ssl.create_default_context()
        ssl_ctx.check_hostname = False
        ssl_ctx.verify_mode = ssl.CERT_NONE

        if cache_key not in tile_cache:
            url = (
                f"https://www.lightpollutionmap.info/geoserver/gwc/service/wmts?layer=PostGIS:VIIRS_{year}"
                f"&style=&tilematrixset=EPSG:900913&Service=WMTS&Request=GetTile&Version=1.0.0"
                f"&Format=image/png&TileMatrix=EPSG:900913:{z}&TileCol={x}&TileRow={y}"
            )
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=5, context=ssl_ctx) as response:
                tile_cache[cache_key] = response.read()

        return tile_cache[cache_key]
    raise ValueError("Invalid path")


def search_offline_cities(lat, lon, radius_km, country_filter):
    places = []
    for city in geonames_cities:
        if country_filter and country_filter.lower() != city["countryCode"].lower():
            continue

        lat_diff = abs(city["latitude"] - lat)
        lon_diff = abs(city["longitude"] - lon)
        if lat_diff > (radius_km / 111.0) or lon_diff > (radius_km / 111.0):
            continue

        dist = haversine(lat, lon, city["latitude"], city["longitude"])
        if 5 < dist <= radius_km:
            c = dict(city)
            c["distance"] = dist
            places.append(c)
    return places


def search_overpass(lat, lon, radius_km, ssl_ctx):
    places = []
    radius_meters = radius_km * 1000
    # Include all place types for better coverage, regardless of radius
    tags = "city|town|village|hamlet|suburb|neighbourhood"
    query = (
        "[out:json][timeout:180];\n"
        f'node["place"~"{tags}"](around:{radius_meters},{lat},{lon});\n'
        "out center 200;\n"
    )
    data = urllib.parse.urlencode({"data": query}).encode("utf-8")
    req = urllib.request.Request("https://overpass-api.de/api/interpreter", data=data)
    req.add_header("User-Agent", "StarGaze Backend/1.0")
    with urllib.request.urlopen(req, timeout=200, context=ssl_ctx) as response:
        result = json.loads(response.read())

    seen = set()
    for el in result.get("elements", []):
        el_tags = el.get("tags", {})
        name = el_tags.get("name") or el_tags.get("name:en")
        if not name or name in seen:
            continue
        seen.add(name)

        center = el.get("center", {})
        pLat = el.get("lat", center.get("lat"))
        pLon = el.get("lon", center.get("lon"))

        if pLat is None or pLon is None:
            continue

        dist = haversine(lat, lon, pLat, pLon)
        if dist < 2:
            continue

        pop_str = el_tags.get("population", "0")
        places.append(
            {
                "id": el["id"],
                "name": name,
                "type": el_tags.get("place", "unknown"),
                "population": int(pop_str) if pop_str.isdigit() else 0,
                "latitude": pLat,
                "longitude": pLon,
                "distance": dist,
            }
        )
    return places


def fallback_remote_area(lat, lon, radius_km):
    places = []
    angles = [0, 45, 90, 135, 180, 225, 270, 315]
    directions = ["North", "NE", "East", "SE", "South", "SW", "West", "NW"]
    R = 6371
    d = (min(radius_km, 500) * 0.6) / R
    lat1 = lat * math.pi / 180
    lon1 = lon * math.pi / 180

    for i, angle in enumerate(angles):
        brng = angle * math.pi / 180
        lat2 = math.asin(
            math.sin(lat1) * math.cos(d) + math.cos(lat1) * math.sin(d) * math.cos(brng)
        )
        lon2 = lon1 + math.atan2(
            math.sin(brng) * math.sin(d) * math.cos(lat1),
            math.cos(d) - math.sin(lat1) * math.sin(lat2),
        )
        pLat = lat2 * 180 / math.pi
        pLon = lon2 * 180 / math.pi

        places.append(
            {
                "id": f"fallback_{i}",
                "name": f"Remote Area ({directions[i]})",
                "type": "isolated",
                "population": 0,
                "latitude": pLat,
                "longitude": pLon,
                "distance": haversine(lat, lon, pLat, pLon),
            }
        )
    return places


def find_nearest_town(curr_lat, curr_lon, country_filter):
    nearest_town = None
    min_t_dist = 50
    for city in geonames_cities:
        if country_filter and country_filter.lower() != city["countryCode"].lower():
            continue
        t_dist = haversine(curr_lat, curr_lon, city["latitude"], city["longitude"])
        if t_dist < min_t_dist:
            min_t_dist = t_dist
            nearest_town = city
    return nearest_town


def search_dark_sky_grid(lat, lon, radius_km, country_filter):
    places = []
    # Coarser grid for larger radius: 20km step up to 100km, 50km beyond
    grid_step = (20.0 if radius_km <= 100 else 50.0) / 111.0
    lat_min = lat - (radius_km / 111.0)
    lat_max = lat + (radius_km / 111.0)
    lon_scale = max(0.1, math.cos(math.radians(lat)))
    lon_step = grid_step / lon_scale
    lon_min = lon - ((radius_km / 111.0) / lon_scale)
    lon_max = lon + ((radius_km / 111.0) / lon_scale)

    best_spots = {}
    if geonames_cities:
        curr_lat = lat_min
        while curr_lat <= lat_max:
            curr_lon = lon_min
            while curr_lon <= lon_max:
                dist = haversine(lat, lon, curr_lat, curr_lon)
                if dist <= radius_km:
                    b_class = get_bortle_class(curr_lat, curr_lon)
                    if b_class in ["1", "2", "3", "4"]:
                        nearest_town = find_nearest_town(
                            curr_lat, curr_lon, country_filter
                        )

                        if nearest_town:
                            tid = nearest_town.get("name", "Unknown")
                            if tid not in best_spots or int(b_class) < int(
                                best_spots[tid]["bortle"]
                            ):
                                best_spots[tid] = {
                                    "id": f"ds_{curr_lat}_{curr_lon}",
                                    "name": f"Dark Sky near {tid}",
                                    "type": "dark_sky",
                                    "population": 0,
                                    "latitude": curr_lat,
                                    "longitude": curr_lon,
                                    "distance": dist,
                                    "bortle": b_class,
                                    "countryCode": nearest_town.get("countryCode", ""),
                                    "admin1": nearest_town.get("admin1", ""),
                                }
                curr_lon += lon_step
            curr_lat += grid_step

    for spot in best_spots.values():
        del spot["bortle"]
        places.append(spot)
    return places


def handle_api_nearby_logic(path):
    query_components = urllib.parse.parse_qs(urllib.parse.urlparse(path).query)
    lat = float(query_components.get("lat", ["0"])[0])
    lon = float(query_components.get("lon", ["0"])[0])
    radius_km = float(query_components.get("radius", ["100"])[0])
    country_filter = query_components.get("country", [None])[0]

    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE

    places = [
        {
            "id": "current",
            "name": "Current Search Location",
            "latitude": lat,
            "longitude": lon,
            "distance": 0,
        }
    ]

    # Run GeoNames (fast, offline) and Overpass (slow, network) in parallel
    overpass_radius = min(radius_km, 500)
    overpass_places = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        geo_future = None
        if geonames_cities:
            geo_future = executor.submit(search_offline_cities, lat, lon, radius_km, country_filter)
        op_future = executor.submit(search_overpass, lat, lon, overpass_radius, ssl_ctx)

        if geo_future:
            try:
                places.extend(geo_future.result())
            except Exception as e:
                print(f"GeoNames search error: {e}")

        try:
            overpass_places = op_future.result()
        except Exception as e:
            print(f"Overpass API error (non-fatal, using offline data): {e}")

    # Deduplicate Overpass results against GeoNames
    existing_names = {p["name"].lower() for p in places}
    for op in overpass_places:
        if op["name"].lower() not in existing_names:
            places.append(op)
            existing_names.add(op["name"].lower())

    # Only use directional fallback if we truly have nothing
    if len(places) <= 3:
        places.extend(fallback_remote_area(lat, lon, radius_km))

    # Dark-sky grid is skipped here — too slow (110 sequential Bortle API calls).
    # The frontend already scores every place individually with Bortle analysis.
    # Uncomment if you want grid-based dark sky suggestions at the cost of 2-3 min.
    # places.extend(search_dark_sky_grid(lat, lon, min(radius_km, 300), country_filter))

    places.sort(key=lambda x: x["distance"])
    return places


def handle_test_notification():
    email_addr = None
    email_pass = None
    if os.path.exists("settings.json"):
        with open("settings.json", "r") as f:
            settings = json.load(f)
            email_addr = settings.get("email")
            email_pass = settings.get("password")

    if not email_addr or not email_pass:
        raise Exception(
            "Email settings missing. Configure Email Address and App Password in Settings."
        )

    msg = "Score: 92/100 🌌 | Cloud: 5%, Vis: 24km, Hum: 38%, Dew: 12°C"
    subject = "⭐ StarGaze Alert for Mount Everest"
    print(f"TRIGGERING NOTIFICATION: {msg}")
    send_email_alert(email_addr, email_pass, subject, msg)
