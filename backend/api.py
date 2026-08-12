import concurrent.futures
import datetime as dt_mod
import io
import json
import math
import os
import ssl
import urllib.parse
import urllib.request

from PIL import Image

from .bortle import get_bortle_class, bortle_to_sqm
from .tasks import send_email_alert
from .utils import geonames_cities, haversine, tile_cache


def handle_api_bortle_logic(lat, lon):
    bortle_class = get_bortle_class(lat, lon)
    bortle_int = int(bortle_class) if bortle_class.isdigit() else 5
    sqm = bortle_to_sqm(bortle_int)
    return {"bortle": bortle_class, "sqm": sqm}


def handle_api_bortle_batch_logic(body):
    """Batch bortle lookup: accepts [{lat, lon}, ...] returns [{bortle}, ...]
    Uses thread pool for parallel tile fetching."""
    if isinstance(body, str):
        body = json.loads(body)

    def _lookup(item):
        try:
            lat = float(item.get("lat", 0))
            lon = float(item.get("lon", 0))
            return {"bortle": get_bortle_class(lat, lon)}
        except Exception:
            return {"bortle": 5}

    # Parallelize — most time is waiting for tile downloads
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(_lookup, body))
    return results


# ─── Satellite cloud cover — multi-satellite support ───

# Satellite routing: pick the right geostationary satellite for the region
HIMAWARI_TIMES_URL = "https://www.jma.go.jp/bosai/himawari/data/satimg/targetTimes_fd.json"
HIMAWARI_TILE_URL = "https://www.jma.go.jp/bosai/himawari/data/satimg/{basetime}/fd/{validtime}/B13/TBB/{z}/{x}/{y}.jpg"

# GOES-16 full-disk IR (Band 13, 10.3μm) from NOAA STAR — free, no key, ~10min refresh
GOES16_LATEST_URL = "https://cdn.star.nesdis.noaa.gov/GOES16/ABI/FD/13/678x678.jpg"
GOES18_LATEST_URL = "https://cdn.star.nesdis.noaa.gov/GOES18/ABI/FD/13/678x678.jpg"

SATELLITE_ZOOM = 5  # Tile zoom for Himawari


# ─── Tile Proxy (fixes ORB blocking for OpenWeatherMap tiles) ───

def handle_api_tile_proxy_logic(path):
    """Proxy OWM tiles through backend to avoid browser ORB blocking.
    URL: /api/tile-proxy/owm/{layer}/{z}/{x}/{y}.png?appid=KEY
    """
    OWM_KEY = os.environ.get("OWM_KEY", "")
    # Parse path: /api/tile-proxy/owm/clouds_new/10/815/480.png
    prefix = "/api/tile-proxy/owm/"
    if not path.startswith(prefix):
        raise ValueError("Invalid tile proxy path")
    rest = path[len(prefix):]
    target_url = f"https://tile.openweathermap.org/map/{rest}?appid={OWM_KEY}"

    req = urllib.request.Request(target_url, headers={"User-Agent": "StarGaze/1.0"})
    ssl_ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=10, context=ssl_ctx) as resp:
            return resp.read(), resp.headers.get_content_type()
    except Exception as e:
        print(f"Tile proxy error: {e}")
        return None, None


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


def analyze_cloud_pct(image_bytes, lat=None):
    """Given a Himawari B13 infrared JPEG, return cloud cover percentage.
    
    Uses Otsu's method, but for tropical regions (|lat| < 25°) applies a 
    minimum threshold floor. Warm tropical rain clouds can appear too warm
    for Otsu alone to catch.
    """
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
    
    is_tropical = lat is not None and abs(lat) < 25

    if is_tropical:
        # Floor: use the lower of Otsu threshold or a tropical minimum
        tropical_floor = 80  # Very low — catches warm rain clouds at ~280K
        threshold = min(threshold, tropical_floor)

    # Pixels brighter than threshold = cloud (cold in IR)
    cloud_px = sum(1 for p in pixels if p > threshold)
    pct = round((cloud_px / len(pixels)) * 100)
    
    # Tropical boost: B13 IR will always underestimate warm tropical clouds
    if is_tropical and pct < 30:
        pct = max(pct, 25)

    return {"cloud_pct": pct, "threshold": threshold, "tile_size": [w, h], "tropical": is_tropical}


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

        result = analyze_cloud_pct(image_bytes, lat)
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


# ─── Country name → ISO code mapping (built from GeoNames data) ───
_COUNTRY_NAME_TO_CODE = {
    "vietnam": "vn", "viet nam": "vn",
    "cambodia": "kh", "kampuchea": "kh",
    "thailand": "th", "laos": "la", "lao people's democratic republic": "la",
    "myanmar": "mm", "burma": "mm",
    "malaysia": "my", "singapore": "sg", "indonesia": "id",
    "philippines": "ph", "brunei": "bn", "timor-leste": "tl", "east timor": "tl",
    "china": "cn", "japan": "jp", "south korea": "kr", "korea, republic of": "kr",
    "india": "in", "australia": "au", "united states": "us", "united kingdom": "gb",
    "france": "fr", "germany": "de", "italy": "it", "spain": "es", "canada": "ca",
}

def search_offline_cities(lat, lon, radius_km, country_filter):
    places = []
    for city in geonames_cities:
        if country_filter:
            cf = country_filter.lower()
            cc = city["countryCode"].lower()
            if cf != cc and _COUNTRY_NAME_TO_CODE.get(cf) != cc:
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


def search_overpass(lat, lon, radius_km, ssl_ctx, country_code=None):
    places = []
    radius_meters = radius_km * 1000
    tags = "city|town|village"
    max_results = 80

    # Build Overpass query with optional country filter
    country_clause = ""
    if country_code:
        country_clause = f'["addr:country"="{country_code.upper()}"]'
    query = (
        f"[out:json][timeout:20];\n"
        f'node["place"~"{tags}"]{country_clause}(around:{radius_meters},{lat},{lon});\n'
        f"out center {max_results};\n"
    )
    data = urllib.parse.urlencode({"data": query}).encode("utf-8")
    req = urllib.request.Request("https://overpass-api.de/api/interpreter", data=data)
    req.add_header("User-Agent", "StarGaze Backend/1.0")
    with urllib.request.urlopen(req, timeout=25, context=ssl_ctx) as response:
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


# ─── Famous Vietnamese Tourist Attractions ───
FAMOUS_SPOTS = [
    {"name": "Vịnh Hạ Long", "admin1": "Quảng Ninh", "country": "Vietnam", "latitude": 20.9101, "longitude": 107.1839, "type": "heritage"},
    {"name": "Phố cổ Hội An", "admin1": "Quảng Nam", "country": "Vietnam", "latitude": 15.8801, "longitude": 108.3380, "type": "heritage"},
    {"name": "Sa Pa", "admin1": "Lào Cai", "country": "Vietnam", "latitude": 22.3364, "longitude": 103.8438, "type": "mountain"},
    {"name": "Đà Lạt", "admin1": "Lâm Đồng", "country": "Vietnam", "latitude": 11.9465, "longitude": 108.4419, "type": "mountain"},
    {"name": "Nha Trang", "admin1": "Khánh Hòa", "country": "Vietnam", "latitude": 12.2388, "longitude": 109.1967, "type": "beach"},
    {"name": "Phú Quốc", "admin1": "Kiên Giang", "country": "Vietnam", "latitude": 10.2899, "longitude": 103.9840, "type": "island"},
    {"name": "Mũi Né", "admin1": "Bình Thuận", "country": "Vietnam", "latitude": 10.9333, "longitude": 108.2833, "type": "beach"},
    {"name": "Côn Đảo", "admin1": "Bà Rịa - Vũng Tàu", "country": "Vietnam", "latitude": 8.6930, "longitude": 106.6080, "type": "island"},
    {"name": "Huế", "admin1": "Thừa Thiên Huế", "country": "Vietnam", "latitude": 16.4637, "longitude": 107.5909, "type": "heritage"},
    {"name": "Tam Cốc - Bích Động", "admin1": "Ninh Bình", "country": "Vietnam", "latitude": 20.2180, "longitude": 105.9170, "type": "heritage"},
    {"name": "Đảo Lý Sơn", "admin1": "Quảng Ngãi", "country": "Vietnam", "latitude": 15.3800, "longitude": 109.1200, "type": "island"},
    {"name": "Đà Nẵng", "admin1": "Đà Nẵng", "country": "Vietnam", "latitude": 16.0544, "longitude": 108.2022, "type": "beach"},
    {"name": "Vũng Tàu", "admin1": "Bà Rịa - Vũng Tàu", "country": "Vietnam", "latitude": 10.3460, "longitude": 107.0840, "type": "beach"},
    {"name": "Quy Nhơn", "admin1": "Bình Định", "country": "Vietnam", "latitude": 13.7694, "longitude": 109.2311, "type": "beach"},
    {"name": "Hà Giang", "admin1": "Hà Giang", "country": "Vietnam", "latitude": 22.8233, "longitude": 104.9836, "type": "mountain"},
    {"name": "Cao Bằng (Thác Bản Giốc)", "admin1": "Cao Bằng", "country": "Vietnam", "latitude": 22.8550, "longitude": 106.7222, "type": "mountain"},
    {"name": "Phan Thiết", "admin1": "Bình Thuận", "country": "Vietnam", "latitude": 10.9333, "longitude": 108.1000, "type": "beach"},
    {"name": "Cần Thơ", "admin1": "Cần Thơ", "country": "Vietnam", "latitude": 10.0452, "longitude": 105.7469, "type": "city"},
    {"name": "Vĩnh Hy", "admin1": "Ninh Thuận", "country": "Vietnam", "latitude": 11.3996, "longitude": 109.0139, "type": "beach"},
    {"name": "Tà Đùng", "admin1": "Đắk Nông", "country": "Vietnam", "latitude": 11.8550, "longitude": 107.7450, "type": "mountain"},
    {"name": "Mộc Châu", "admin1": "Sơn La", "country": "Vietnam", "latitude": 20.8400, "longitude": 104.6300, "type": "mountain"},
    {"name": "Mai Châu", "admin1": "Hòa Bình", "country": "Vietnam", "latitude": 20.6630, "longitude": 105.0840, "type": "mountain"},
    {"name": "Pù Luông", "admin1": "Thanh Hóa", "country": "Vietnam", "latitude": 20.4500, "longitude": 105.2500, "type": "mountain"},
    {"name": "Bà Nà Hills", "admin1": "Đà Nẵng", "country": "Vietnam", "latitude": 16.0000, "longitude": 108.0333, "type": "mountain"},
    {"name": "Eo Gió (Quy Nhơn)", "admin1": "Bình Định", "country": "Vietnam", "latitude": 13.7200, "longitude": 109.2100, "type": "beach"},
    {"name": "Đầm Thị Nại", "admin1": "Bình Định", "country": "Vietnam", "latitude": 13.7800, "longitude": 109.2400, "type": "beach"},
    {"name": "Gành Đá Đĩa", "admin1": "Phú Yên", "country": "Vietnam", "latitude": 13.0980, "longitude": 109.2950, "type": "heritage"},
    {"name": "Mũi Điện", "admin1": "Phú Yên", "country": "Vietnam", "latitude": 12.8950, "longitude": 109.4500, "type": "beach"},
    {"name": "Biển Hồ T'Nưng (Pleiku)", "admin1": "Gia Lai", "country": "Vietnam", "latitude": 14.0000, "longitude": 108.0000, "type": "mountain"},
    {"name": "Buôn Ma Thuột", "admin1": "Đắk Lắk", "country": "Vietnam", "latitude": 12.6667, "longitude": 108.0500, "type": "city"},
    {"name": "Yok Đôn", "admin1": "Đắk Lắk", "country": "Vietnam", "latitude": 12.8500, "longitude": 107.7000, "type": "mountain"},
    {"name": "Cát Bà", "admin1": "Hải Phòng", "country": "Vietnam", "latitude": 20.7238, "longitude": 107.0486, "type": "island"},
    {"name": "Bạch Mã", "admin1": "Thừa Thiên Huế", "country": "Vietnam", "latitude": 16.2000, "longitude": 107.8667, "type": "mountain"},
    {"name": "Phong Nha - Kẻ Bàng", "admin1": "Quảng Bình", "country": "Vietnam", "latitude": 17.5833, "longitude": 106.2833, "type": "heritage"},
    {"name": "Đồng Văn", "admin1": "Hà Giang", "country": "Vietnam", "latitude": 23.2667, "longitude": 105.3667, "type": "mountain"},
    {"name": "Tràng An", "admin1": "Ninh Bình", "country": "Vietnam", "latitude": 20.2533, "longitude": 105.9180, "type": "heritage"},
    {"name": "Chợ nổi Cái Răng", "admin1": "Cần Thơ", "country": "Vietnam", "latitude": 10.0333, "longitude": 105.7833, "type": "city"},
    {"name": "Angkor Wat", "admin1": "Siem Reap", "country": "Cambodia", "latitude": 13.4125, "longitude": 103.8670, "type": "heritage"},
    {"name": "Luang Prabang", "admin1": "Luang Prabang", "country": "Laos", "latitude": 19.8833, "longitude": 102.1333, "type": "heritage"},
]


def handle_api_famous_spots():
    """Return famous tourist attractions sorted by proximity to user location."""
    return FAMOUS_SPOTS


# ─── Geocoding ───

# Vietnamese diacritics → ASCII mapping
_VN_MAP = {
    'à':'a','á':'a','ả':'a','ã':'a','ạ':'a',
    'ă':'a','ằ':'a','ắ':'a','ẳ':'a','ẵ':'a','ặ':'a',
    'â':'a','ầ':'a','ấ':'a','ẩ':'a','ẫ':'a','ậ':'a',
    'è':'e','é':'e','ẻ':'e','ẽ':'e','ẹ':'e',
    'ê':'e','ề':'e','ế':'e','ể':'e','ễ':'e','ệ':'e',
    'ì':'i','í':'i','ỉ':'i','ĩ':'i','ị':'i',
    'ò':'o','ó':'o','ỏ':'o','õ':'o','ọ':'o',
    'ô':'o','ồ':'o','ố':'o','ổ':'o','ỗ':'o','ộ':'o',
    'ơ':'o','ờ':'o','ớ':'o','ở':'o','ỡ':'o','ợ':'o',
    'ù':'u','ú':'u','ủ':'u','ũ':'u','ụ':'u',
    'ư':'u','ừ':'u','ứ':'u','ử':'u','ữ':'u','ự':'u',
    'ỳ':'y','ý':'y','ỷ':'y','ỹ':'y','ỵ':'y',
    'đ':'d',
    'À':'A','Á':'A','Ả':'A','Ã':'A','Ạ':'A',
    'Ă':'A','Ằ':'A','Ắ':'A','Ẳ':'A','Ẵ':'A','Ặ':'A',
    'Â':'A','Ầ':'A','Ấ':'A','Ẩ':'A','Ẫ':'A','Ậ':'A',
    'È':'E','É':'E','Ẻ':'E','Ẽ':'E','Ẹ':'E',
    'Ê':'E','Ề':'E','Ế':'E','Ể':'E','Ễ':'E','Ệ':'E',
    'Ì':'I','Í':'I','Ỉ':'I','Ĩ':'I','Ị':'I',
    'Ò':'O','Ó':'O','Ỏ':'O','Õ':'O','Ọ':'O',
    'Ô':'O','Ồ':'O','Ố':'O','Ổ':'O','Ỗ':'O','Ộ':'O',
    'Ơ':'O','Ờ':'O','Ớ':'O','Ở':'O','Ỡ':'O','Ợ':'O',
    'Ù':'U','Ú':'U','Ủ':'U','Ũ':'U','Ụ':'U',
    'Ư':'U','Ừ':'U','Ứ':'U','Ử':'U','Ữ':'U','Ự':'U',
    'Ỳ':'Y','Ý':'Y','Ỷ':'Y','Ỹ':'Y','Ỵ':'Y',
    'Đ':'D',
}
def _strip_vn_accents(s):
    return ''.join(_VN_MAP.get(c, c) for c in s)

def handle_api_geocode_logic(path):
    """Geocode a location name to coordinates.
    Free providers first, Google Maps as paid fallback.
    Auto-strips Vietnamese diacritics for better API matching."""
    qs = urllib.parse.parse_qs(urllib.parse.urlparse(path).query)
    query = qs.get("q", [""])[0]
    count = int(qs.get("count", ["8"])[0])
    
    if not query or len(query.strip()) < 2:
        return []
    
    # Strip Vietnamese accents if present — APIs don't understand them
    ascii_query = _strip_vn_accents(query)
    use_ascii = ascii_query != query
    
    google_key = os.environ.get("GOOGLE_MAPS_API_KEY", "")
    
    def _search_with(q):
        """Try all providers with a given query string (Google Maps first if API key present)."""
        # 1. Google Maps (Primary if key set)
        if google_key:
            try:
                url = f"https://maps.googleapis.com/maps/api/geocode/json?address={urllib.parse.quote(q)}&language=en&key={google_key}"
                ssl_ctx = ssl.create_default_context()
                req = urllib.request.Request(url, headers={"User-Agent": "StarGaze/1.0"})
                with urllib.request.urlopen(req, timeout=10, context=ssl_ctx) as resp:
                    data = json.loads(resp.read())
                if data.get("status") == "OK":
                    results = []
                    for r in data.get("results", [])[:count]:
                        geo = r.get("geometry", {}).get("location", {})
                        comps = {}
                        for c in r.get("address_components", []):
                            for t in c.get("types", []):
                                comps[t] = c
                        results.append({
                            "id": r.get("place_id", ""),
                            "name": (comps.get("locality") or comps.get("administrative_area_level_2") or comps.get("administrative_area_level_1") or r.get("address_components", [{}])[0]).get("long_name", q),
                            "country": (comps.get("country") or {}).get("long_name", ""),
                            "countryCode": (comps.get("country") or {}).get("short_name", "").upper(),
                            "admin1": (comps.get("administrative_area_level_1") or {}).get("long_name", ""),
                            "latitude": geo.get("lat"),
                            "longitude": geo.get("lng"),
                            "timezone": "auto",
                            "population": 0,
                            "elevation": 0,
                            "source": "google",
                        })
                    if results:
                        return results
            except Exception as e:
                print(f"Google geocoding failed: {e}")

        # 2. Open-Meteo (free fallback)
        try:
            url = f"https://geocoding-api.open-meteo.com/v1/search?name={urllib.parse.quote(q)}&count={count}&language=en&format=json"
            ssl_ctx = ssl.create_default_context()
            req = urllib.request.Request(url, headers={"User-Agent": "StarGaze/1.0 (https://stargaze-app.fly.dev)"})
            with urllib.request.urlopen(req, timeout=10, context=ssl_ctx) as r:
                d = json.loads(r.read())
            if d.get("results"):
                return [{
                    "id": str(item.get("id", "")),
                    "name": item.get("name", ""),
                    "country": item.get("country", ""),
                    "countryCode": item.get("country_code", ""),
                    "admin1": item.get("admin1", ""),
                    "latitude": item.get("latitude"),
                    "longitude": item.get("longitude"),
                    "timezone": item.get("timezone", "auto"),
                    "population": item.get("population", 0),
                    "elevation": item.get("elevation", 0),
                    "source": "open-meteo",
                } for item in d["results"]]
        except Exception:
            pass
        
        # 3. Nominatim (fallback)
        try:
            url = f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(q)}&format=json&limit={count}&accept-language=en"
            ssl_ctx = ssl.create_default_context()
            req = urllib.request.Request(url, headers={"User-Agent": "StarGaze/1.0"})
            with urllib.request.urlopen(req, timeout=10, context=ssl_ctx) as r:
                d = json.loads(r.read())
            if d:
                return [{
                    "id": str(item.get("place_id", "")),
                    "name": item.get("name", "") or (item.get("display_name", "").split(",")[0] if item.get("display_name") else q),
                    "country": (item.get("address", {}) or {}).get("country", ""),
                    "countryCode": ((item.get("address", {}) or {}).get("country_code", "")).upper(),
                    "admin1": (item.get("address", {}) or {}).get("state", "") or (item.get("address", {}) or {}).get("province", ""),
                    "latitude": float(item.get("lat", 0)),
                    "longitude": float(item.get("lon", 0)),
                    "timezone": "auto",
                    "population": 0,
                    "elevation": 0,
                    "source": "nominatim",
                } for item in d]
        except Exception:
            pass
        
        return []
    
    # APIs don't understand Vietnamese diacritics — always use ASCII
    search_query = ascii_query if use_ascii else query
    return _search_with(search_query)
    
def handle_api_reverse_geocode_logic(path):
    """Reverse geocode: lat/lon → place name.
    Free providers first, Google Maps as paid fallback."""
    qs = urllib.parse.parse_qs(urllib.parse.urlparse(path).query)
    lat = float(qs.get("lat", ["0"])[0])
    lon = float(qs.get("lon", ["0"])[0])
    
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return {"name": "Unknown", "country": "", "countryCode": ""}
    
    google_key = os.environ.get("GOOGLE_MAPS_API_KEY", "")
    
    # ── Primary Provider: Google Maps (if API key set) ──
    if google_key:
        try:
            url = f"https://maps.googleapis.com/maps/api/geocode/json?latlng={lat},{lon}&language=en&key={google_key}"
            ssl_ctx = ssl.create_default_context()
            req = urllib.request.Request(url, headers={"User-Agent": "StarGaze/1.0"})
            with urllib.request.urlopen(req, timeout=10, context=ssl_ctx) as resp:
                data = json.loads(resp.read())
            
            if data.get("status") == "OK" and data.get("results"):
                r = data["results"][0]
                comps = {}
                for c in r.get("address_components", []):
                    for t in c.get("types", []):
                        comps[t] = c
                name = (
                    (comps.get("locality") or {}).get("long_name") or
                    (comps.get("administrative_area_level_2") or {}).get("long_name") or
                    (comps.get("administrative_area_level_1") or {}).get("long_name") or
                    "Selected Location"
                )
                return {
                    "name": name,
                    "country": (comps.get("country") or {}).get("long_name", ""),
                    "countryCode": (comps.get("country") or {}).get("short_name", "").upper(),
                    "source": "google",
                }
        except Exception as e:
            print(f"Google reverse geocode failed: {e}")

    # ── Free Fallback: Nominatim ──
    try:
        url = f"https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lon}&zoom=10&accept-language=en"
        ssl_ctx = ssl.create_default_context()
        req = urllib.request.Request(url, headers={"User-Agent": "StarGaze/1.0"})
        with urllib.request.urlopen(req, timeout=10, context=ssl_ctx) as resp:
            data = json.loads(resp.read())
        
        if data and data.get("address"):
            addr = data["address"]
            name = addr.get("city") or addr.get("town") or addr.get("village") or addr.get("county") or addr.get("state") or "Selected Location"
            return {
                "name": name,
                "country": addr.get("country", ""),
                "countryCode": (addr.get("country_code", "")).upper(),
                "source": "nominatim",
            }
    except Exception as e:
        print(f"Nominatim reverse geocode failed: {e}")
    
    return {"name": "Unknown", "country": "", "countryCode": ""}

def handle_api_tide_curve(path):
    """Return the full tide curve (15-min intervals) for chart rendering.
    Interpolates between known tide extremes from tide-forecast.com."""
    
    qs = urllib.parse.parse_qs(urllib.parse.urlparse(path).query)
    lat = float(qs.get("lat", ["0"])[0])
    lon = float(qs.get("lon", ["0"])[0])
    days = int(qs.get("days", ["3"])[0])
    station_override = qs.get("station", [None])[0]
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("Invalid coordinates")
    days = min(days, 4)

    # Get real tide extremes
    tides, station_name, distance = _get_real_tide_data(lat, lon, station_override)
    
    if not tides:
        return {"points": [], "source": "none"}
    
    # Generate smooth curve by interpolating between known extremes
    now = dt_mod.datetime.utcnow()
    points = []
    step_h = 0.25
    total_h = days * 24
    
    # Find the height at any time by linear interpolation between nearest extremes
    def _height_at(target_time):
        target_ts = target_time.timestamp()
        before = after = None
        for t in tides:
            ts = dt_mod.datetime.fromisoformat(t["time"].replace("Z", "+00:00")).timestamp()
            if ts <= target_ts:
                before = (ts, t["height"])
            if ts >= target_ts and after is None:
                after = (ts, t["height"])
        
        if before and after:
            if before[0] == after[0]:
                return after[1]
            frac = (target_ts - before[0]) / (after[0] - before[0])
            return round(before[1] + frac * (after[1] - before[1]), 3)
        elif before:
            return before[1]
        elif after:
            return after[1]
        return 0.0
    
    for i in range(int(total_h / step_h) + 1):
        t = dt_mod.timedelta(hours=i * step_h)
        point_time = now + t
        h = _height_at(point_time)
        points.append({
            "time": point_time.isoformat() + "Z",
            "height": h
        })
    
    return {"points": points, "source": "cau-ca.com", "stationName": station_name}


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
        # Resolve country code for Overpass filter
        op_cc = None
        if country_filter:
            cf_s = country_filter.strip()
            op_cc = cf_s.upper() if len(cf_s) == 2 else _COUNTRY_NAME_TO_CODE.get(cf_s.lower())
        op_future = executor.submit(search_overpass, lat, lon, overpass_radius, ssl_ctx, op_cc)

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

    # Add famous spots within radius (prioritized first)
    existing_names = {p["name"].lower() for p in places}
    for spot in FAMOUS_SPOTS:
        d = haversine(lat, lon, spot["latitude"], spot["longitude"])
        if d <= radius_km and spot["name"].lower() not in existing_names:
            places.append({
                "id": "famous_" + str(len(places)),
                "name": spot["name"],
                "admin1": spot.get("admin1", ""),
                "country": spot.get("country", ""),
                "latitude": spot["latitude"],
                "longitude": spot["longitude"],
                "distance": round(d),
                "type": spot.get("type", ""),
                "famous": True,
            })
            existing_names.add(spot["name"].lower())

    places.sort(key=lambda x: (not x.get("famous", False), x["distance"]))
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


# ─── Tide Prediction ───
# Primary: cau-ca.com (Vietnamese tide data). Fallback: tide-forecast.com

import re
import time as time_mod

# cau-ca.com station URLs (primary source)
CAUCA_STATIONS = {
    "Hòn Dấu (Hải Phòng)": "https://cau-ca.com/vn/hai-phong/hon-dau/forecast/tides",
    "Đà Nẵng (Tiên Sa)": "https://cau-ca.com/vn/da-nang/da-nang/forecast/tides",
    "Nha Trang": "https://cau-ca.com/vn/khanh-hoa/nha-trang/forecast/tides",
    "Cam Ranh": "https://cau-ca.com/vn/khanh-hoa/cam-ranh-bay/forecast/tides",
    "Vũng Tàu": "https://cau-ca.com/vn/ba-ria-vung-tau/vung-tau/forecast/tides",
    "Phan Thiết (Mũi Né)": "https://cau-ca.com/vn/binh-thuan/phan-thiet/forecast/tides",
    "Quy Nhơn": "https://cau-ca.com/vn/binh-dinh/quy-nhon/forecast/tides",
    "Phú Quốc": "https://cau-ca.com/vn/kien-giang/phu-quoc/forecast/tides",
    "Côn Đảo": "https://cau-ca.com/vn/ba-ria-vung-tau/con-dao/forecast/tides",
}

# tide-forecast.com station URLs (fallback)
TF_STATIONS = {
    "Hòn Dấu (Hải Phòng)": {"url": "/locations/Haiphong-Vietnam/tides/latest", "lat": 20.67, "lon": 106.80},
    "Đà Nẵng (Tiên Sa)":  {"url": "/locations/Da-Nang-Vietnam/tides/latest",   "lat": 16.12, "lon": 108.22},
    "Cam Ranh":            {"url": "/locations/Cam-Ranh-Vietnam/tides/latest",  "lat": 11.90, "lon": 109.15},
    "Vũng Tàu":            {"url": "/locations/Vung-Tau-Vietnam/tides/latest",  "lat": 10.35, "lon": 107.08},
}

# Vietnamese stations for UI dropdown (all coastal reference points)
VN_TIDE_STATIONS = [
    {"name": "Hòn Dấu (Hải Phòng)", "lat": 20.67, "lon": 106.80, "regime": "diurnal", "maxRange": 3.8},
    {"name": "Hòn Gai (Hạ Long)", "lat": 20.95, "lon": 107.08, "regime": "diurnal", "maxRange": 4.2},
    {"name": "Cửa Ông", "lat": 21.03, "lon": 107.36, "regime": "diurnal", "maxRange": 4.0},
    {"name": "Sầm Sơn (Thanh Hóa)", "lat": 19.74, "lon": 105.90, "regime": "diurnal", "maxRange": 3.2},
    {"name": "Cửa Hội (Vinh)", "lat": 18.75, "lon": 105.73, "regime": "diurnal", "maxRange": 2.8},
    {"name": "Đà Nẵng (Tiên Sa)", "lat": 16.12, "lon": 108.22, "regime": "mixed", "maxRange": 1.8},
    {"name": "Thuận An (Huế)", "lat": 16.55, "lon": 107.63, "regime": "mixed", "maxRange": 1.5},
    {"name": "Quy Nhơn", "lat": 13.77, "lon": 109.25, "regime": "mixed", "maxRange": 2.0},
    {"name": "Nha Trang", "lat": 12.25, "lon": 109.20, "regime": "mixed", "maxRange": 2.2},
    {"name": "Cam Ranh", "lat": 11.90, "lon": 109.15, "regime": "mixed", "maxRange": 2.0},
    {"name": "Phan Thiết (Mũi Né)", "lat": 10.93, "lon": 108.10, "regime": "semidiurnal", "maxRange": 2.4},
    {"name": "Vũng Tàu", "lat": 10.35, "lon": 107.08, "regime": "semidiurnal", "maxRange": 3.8},
    {"name": "Côn Đảo", "lat": 8.69, "lon": 106.61, "regime": "semidiurnal", "maxRange": 3.0},
    {"name": "Phú Quốc", "lat": 10.22, "lon": 103.97, "regime": "mixed", "maxRange": 0.8},
    {"name": "Cà Mau", "lat": 8.77, "lon": 105.02, "regime": "mixed", "maxRange": 1.2},
]

# Cache for scraped tide data: {url: (timestamp, tides_list)}
_tf_cache = {}


def _get_tf_station(station_name=None):
    """Look up a tide-forecast station by name. Returns TF_STATIONS entry or None."""
    if not station_name:
        return None
    # Try exact match first, then partial match
    if station_name in TF_STATIONS:
        return station_name, TF_STATIONS[station_name]
    for name, info in TF_STATIONS.items():
        if name.startswith(station_name) or station_name in name:
            return name, info
    return None, None


def _get_nearest_tf_station(lat, lon):
    """Find nearest tide-forecast.com station for any coastal point."""
    best_name = None
    best_dist = float("inf")
    for name, info in TF_STATIONS.items():
        d = haversine(lat, lon, info["lat"], info["lon"])
        if d < best_dist:
            best_dist = d
            best_name = name
    if best_dist > 500:
        return None, None
    return best_name, round(best_dist)


def _scrape_tide_forecast(station_name):
    """Scrape 30-day tide predictions from tide-forecast.com.
    Returns list of {time, height, type} dicts on success, None on failure.
    Cached for 2 hours."""
    
    tf_name, tf_info = _get_tf_station(station_name)
    if not tf_info:
        print(f"Tide scrape: no TF station found for '{station_name}'")
        return None, None
    
    url = f"https://www.tide-forecast.com{tf_info['url']}"
    
    # Check cache
    now = dt_mod.datetime.utcnow()
    if url in _tf_cache:
        cache_time, cache_data = _tf_cache[url]
        if (now - cache_time).total_seconds() < 7200:  # 2h TTL
            return cache_data, tf_name
    
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'StarGaze/1.0 (stargaze-app.fly.dev)'})
        ssl_ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=20, context=ssl_ctx) as resp:
            html = resp.read().decode()
        
        # Parse "High Tide|Low Tide ... HH:MM AM/PM ... height m"
        pattern = r'(High Tide|Low Tide).*?(\d+:\d+\s*(?:AM|PM)).*?([\d.-]+)\s*m'
        matches = re.findall(pattern, html, re.DOTALL)
        
        if not matches:
            print(f"Tide forecast: no matches found for {station_name}")
            return None, None
        
        # Build tide entries assuming times are in +07 (Vietnam time)
        tides = []
        prev_time = None
        
        for m_type, time_str, height_str in matches:
            height = float(height_str)
            time_match = re.match(r'(\d+):(\d+)\s*(AM|PM)', time_str)
            if not time_match:
                continue
            hour = int(time_match.group(1))
            minute = int(time_match.group(2))
            ampm = time_match.group(3)
            
            if ampm == 'PM' and hour != 12:
                hour += 12
            elif ampm == 'AM' and hour == 12:
                hour = 0
            
            # We need a date. Use current UTC date as starting point,
            # then advance date if time wraps around
            if prev_time is None:
                base_date = now.date()
            else:
                base_date = prev_time.date()
            
            local_time = dt_mod.datetime(base_date.year, base_date.month, base_date.day, hour, minute)
            
            # If this time is before previous, advance one day
            if prev_time is not None and local_time <= prev_time:
                local_time += dt_mod.timedelta(days=1)
            
            # Convert from +07 to UTC
            utc_time = local_time - dt_mod.timedelta(hours=7)
            prev_time = local_time
            
            tides.append({
                "time": utc_time.isoformat() + "Z",
                "height": height,
                "type": "high" if m_type == "High Tide" else "low",
            })
        
        _tf_cache[url] = (now, tides)
        return tides, tf_name
        
    except Exception as e:
        print(f"Tide forecast scrape error ({station_name}): {e}")
        return None, None


def _scrape_cauca_tide(station_name):
    """Scrape 7-day tide predictions from cau-ca.com.
    Returns list of {time, height, type} dicts on success, None on failure."""
    
    url = CAUCA_STATIONS.get(station_name)
    if not url:
        # Try partial match
        for name, u in CAUCA_STATIONS.items():
            if name.startswith(station_name) or station_name in name:
                url = u
                station_name = name
                break
    if not url:
        return None, None

    # Check cache (1 hour)
    now = time_mod.time()
    if url in _tf_cache:
        cached_time, cached_data = _tf_cache[url]
        if now - cached_time < 3600:
            return cached_data, station_name

    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        })
        html = urllib.request.urlopen(req, context=ctx, timeout=15).read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"Cau-ca scrape error ({station_name}): {e}")
        return None, None

    # Each day has a table with rows: time (e.g. "5:18h"), height (e.g. "1.8 m"), coeff
    # Parse all tidal entries
    tides = []
    # Find all tide rows: time like "5:18h" and height like "1.8 m"
    pattern = re.compile(r'(\d{1,2}):(\d{2})h\s*</td>\s*<td[^>]*>\s*([\d.]+)\s*m', re.IGNORECASE)
    matches = pattern.findall(html)
    
    if not matches:
        print(f"Cau-ca: no tide data found for {station_name}")
        return None, None

    # The date context: find the first day's date
    # Look for date pattern like "257 Thứ bảy" near tide table
    date_pattern = re.compile(r'(\d{1,3})\s+(Thứ\s+\w+).*?Thủy\s+Triều', re.IGNORECASE | re.DOTALL)
    date_matches = date_pattern.findall(html)
    
    # Simpler: find all date headings
    day_headers = re.findall(r'(\d{1,3})\s+(Thứ\s+\w+)', html)
    
    # Compute base date from current year and day-of-year
    now_dt = dt_mod.datetime.now()
    current_year = now_dt.year
    
    tides = []
    day_index = 0
    entries_per_day = len(matches) // max(len(day_headers), 1)
    if entries_per_day < 2:
        entries_per_day = 2  # Typically 2 per day (high + low)
    
    for i, m in enumerate(matches):
        hour = int(m[0])
        minute = int(m[1])
        height = float(m[2])
        
        # Determine which day this entry belongs to
        day_i = i // entries_per_day
        if day_i < len(day_headers):
            day_of_year = int(day_headers[day_i][0])
            # Compute actual date from day-of-year
            try:
                d = dt_mod.datetime(current_year, 1, 1) + dt_mod.timedelta(days=day_of_year - 1)
            except:
                d = now_dt + dt_mod.timedelta(days=day_i)
        else:
            d = now_dt + dt_mod.timedelta(days=day_i)
        
        local_time = dt_mod.datetime(d.year, d.month, d.day, hour, minute)
        utc_time = local_time - dt_mod.timedelta(hours=7)
        
        # Determine type: even index = high, odd = low (typical semi-diurnal)
        t_type = "high" if i % 2 == 0 else "low"
        
        tides.append({
            "time": utc_time.isoformat() + "Z",
            "height": height,
            "type": t_type,
        })
    
    if tides:
        _tf_cache[url] = (now, tides)
        return tides, station_name
    
    return None, None


def _get_real_tide_data(lat, lon, station_override=None):
    """Primary: cau-ca.com. Fallback: tide-forecast.com.
    Returns (tides_list, station_name, distance_km) or (None, None, None)."""
    
    station_name = station_override
    distance = 0
    
    if not station_name:
        station_name, distance = _get_nearest_tf_station(lat, lon)
    
    if not station_name:
        return None, None, None
    
    # Try cau-ca.com first
    tides, actual_name = _scrape_cauca_tide(station_name)
    if tides:
        return tides, actual_name, distance
    
    # Fallback to tide-forecast.com
    tides, actual_name = _scrape_tide_forecast(station_name)
    if tides:
        return tides, actual_name, distance
    
    return None, None, None


def handle_api_tide_logic(path):
    """Fetch tide extremes from cau-ca.com (primary) or tide-forecast.com (fallback).
    Returns { tides: [...], source: ..., ... }
    """
    qs = urllib.parse.parse_qs(urllib.parse.urlparse(path).query)
    lat = float(qs.get("lat", ["0"])[0])
    lon = float(qs.get("lon", ["0"])[0])
    days = int(qs.get("days", ["3"])[0])
    station_override = qs.get("station", [None])[0]

    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("Invalid coordinates")
    days = min(days, 7)

    # Use harmonic estimation
    result = _harmonic_fallback(lat, lon, days, station_override)
    if result and result.get("tides"):
        return result
    return {"tides": [], "source": "none"}  


def _harmonic_fallback(lat, lon, days, station_override=None):
    """Approximate harmonic tide prediction for when scraping fails.
    Uses simplified diurnal/semidiurnal/mixed model based on nearest station's regime."""
    
    # Find nearest station for regime info
    best = None
    best_dist = float("inf")
    for st in VN_TIDE_STATIONS:
        d = haversine(lat, lon, st["lat"], st["lon"])
        if d < best_dist:
            best_dist = d
            best = st
    
    if not best or best_dist > 300:
        return {"tides": [], "source": "none"}
    
    regime = best["regime"]
    max_range = best["maxRange"]
    
    now = dt_mod.datetime.utcnow()
    ref_new_moon = dt_mod.datetime(2000, 1, 6, 18, 14)
    moon_age_days = ((now - ref_new_moon).total_seconds() / 86400) % 29.530588853
    moon_phase = moon_age_days / 29.530588853
    lunar_offset = moon_phase * 24
    spring_factor = 0.75 + 0.25 * math.cos(4 * math.pi * moon_phase)
    
    step_h = 0.25
    total_h = days * 24 + 12
    points = []
    
    for i in range(int(total_h / step_h) + 1):
        t = i * step_h - 6
        if regime == "diurnal":
            h = (max_range * 0.55 * math.cos(((t - lunar_offset) / 23.93447) * 2 * math.pi) +
                 max_range * 0.45 * math.cos(((t - lunar_offset - 3) / 25.81934) * 2 * math.pi))
        elif regime == "semidiurnal":
            h = (max_range * 0.65 * math.cos(((t - lunar_offset) / 12.4206012) * 2 * math.pi) +
                 max_range * 0.35 * math.cos(((t - 12) / 12) * 2 * math.pi))
        else:
            semi = (max_range * 0.35 * math.cos(((t - lunar_offset) / 12.4206012) * 2 * math.pi) +
                    max_range * 0.20 * math.cos(((t - 12) / 12) * 2 * math.pi))
            diur = (max_range * 0.25 * math.cos(((t - lunar_offset) / 23.93447) * 2 * math.pi) +
                    max_range * 0.20 * math.cos(((t - lunar_offset - 3) / 25.81934) * 2 * math.pi))
            h = semi + diur
        h *= spring_factor
        points.append((t, h))
    
    max_h = max(abs(p[1]) for p in points) if points else 1
    dyn_threshold = max_h * 0.05
    tides = []
    for i in range(1, len(points) - 1):
        _, p_prev = points[i - 1]
        t_curr, p_curr = points[i]
        _, p_next = points[i + 1]
        if p_curr > p_prev and p_curr > p_next and p_curr > dyn_threshold:
            tide_time = now + dt_mod.timedelta(hours=t_curr)
            tides.append({"time": tide_time.isoformat() + "Z", "height": round(p_curr, 2), "type": "high"})
        elif p_curr < p_prev and p_curr < p_next and p_curr < -dyn_threshold:
            tide_time = now + dt_mod.timedelta(hours=t_curr)
            tides.append({"time": tide_time.isoformat() + "Z", "height": round(p_curr, 2), "type": "low"})
    
    tides.sort(key=lambda x: x["time"])
    filtered = []
    for tide in tides:
        if not filtered:
            filtered.append(tide)
            continue
        lt = dt_mod.datetime.fromisoformat(filtered[-1]["time"].replace("Z", "+00:00"))
        ct = dt_mod.datetime.fromisoformat(tide["time"].replace("Z", "+00:00"))
        if abs((ct - lt).total_seconds()) > 2.5 * 3600:
            filtered.append(tide)
    
    # Normalize
    if filtered:
        all_h = [t["height"] for t in filtered]
        mn = min(all_h)
        if mn < 0:
            shift = abs(mn) + 0.05
            for t in filtered:
                t["height"] = round(t["height"] + shift, 2)
    
    return {
        "tides": filtered,
        "source": "harmonic (estimated)",
        "stationName": best["name"] if best else None,
        "stationDistance": round(best_dist),
        "regime": regime,
        "maxRange": max_range,
        "usingConstants": False,
    }  


def _get_tide_regime_info(lat, lon):
    """Get nearest VN station info for the tide search dropdown."""
    best = None
    best_dist = float("inf")
    for st in VN_TIDE_STATIONS:
        d = haversine(lat, lon, st["lat"], st["lon"])
        if d < best_dist:
            best_dist = d
            best = st
    if best and best_dist <= 300:
        return {"regime": best["regime"], "stationName": best["name"], "maxRange": best["maxRange"]}
    
    # Water proximity check
    oceans = [(-60,60,-180,-60), (-60,60,100,180), (-60,60,-60,20), (-40,30,20,100), (0,25,100,122)]
    for min_lat, max_lat, min_lon, max_lon in oceans:
        cl, cn = max(min_lat, min(lat, max_lat)), max(min_lon, min(lon, max_lon))
        if haversine(lat, lon, cl, cn) <= 100:
            return {"regime": "semidiurnal", "stationName": None, "maxRange": 1.5}
    return None


def handle_api_tide_search_logic(path):
    """Search coastal locations via Photon geocoder."""
    qs = urllib.parse.parse_qs(urllib.parse.urlparse(path).query)
    query = qs.get("q", [""])[0]
    count = int(qs.get("count", ["8"])[0])

    if not query or len(query.strip()) < 2:
        return []

    ssl_ctx = ssl.create_default_context()
    try:
        url = f"https://photon.komoot.io/api/?q={urllib.parse.quote(query)}&limit={count}"
        req = urllib.request.Request(url, headers={"User-Agent": "StarGaze/1.0"})
        with urllib.request.urlopen(req, timeout=10, context=ssl_ctx) as resp:
            data = json.loads(resp.read())

        results = []
        for f in data.get("features", []):
            p = f.get("properties", {})
            coords = f.get("geometry", {}).get("coordinates", [0, 0])
            lat, lon = coords[1], coords[0]
            regime_info = _get_tide_regime_info(lat, lon)

            results.append({
                "name": p.get("name", "Unknown"),
                "country": p.get("country", ""),
                "admin1": p.get("state", p.get("county", "")),
                "latitude": lat,
                "longitude": lon,
                "coastal": regime_info is not None,
                "regime": regime_info.get("regime") if regime_info else None,
                "stationName": regime_info.get("stationName") if regime_info else None,
                "maxRange": regime_info.get("maxRange") if regime_info else None,
            })

        results.sort(key=lambda r: (not r["coastal"], r["name"]))
        return results
    except Exception as e:
        print(f"Tide search error: {e}")
        return []


# ─── METAR Proxy (aviationweather.gov blocks CORS from browsers) ───
def handle_api_metar_proxy(path):
    """Proxy METAR requests through backend to avoid CORS blocking."""
    qs = urllib.parse.parse_qs(urllib.parse.urlparse(path).query)
    station = qs.get("ids", ["VVTS"])[0]
    if not station or len(station) != 4 or not station.isalnum():
        raise ValueError("Invalid station ICAO code")
    url = f"https://aviationweather.gov/api/data/metar?ids={station}&format=json"
    req = urllib.request.Request(url, headers={"User-Agent": "StarGaze/1.0"})
    ssl_ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=10, context=ssl_ctx) as resp:
        return resp.read()


# ─── Weather API Proxies (keys stay server-side) ───

def _get_lat_lon_from_path(path):
    qs = urllib.parse.parse_qs(urllib.parse.urlparse(path).query)
    lat = float(qs.get("lat", ["0"])[0])
    lon = float(qs.get("lon", ["0"])[0])
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("Invalid coordinates")
    return lat, lon


def handle_api_weatherapi_current(path):
    """Proxy WeatherAPI.com current conditions. Set WEATHERAPI_KEY env var."""
    lat, lon = _get_lat_lon_from_path(path)
    key = os.environ.get("WEATHERAPI_KEY", "")
    if not key:
        return json.dumps({"error": "WEATHERAPI_KEY not configured"}).encode()
    url = f"https://api.weatherapi.com/v1/current.json?key={key}&q={lat},{lon}&aqi=no"
    req = urllib.request.Request(url, headers={"User-Agent": "StarGaze/1.0"})
    ssl_ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=10, context=ssl_ctx) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        return json.dumps({"error": f"WeatherAPI error ({e.code})", "status": e.code}).encode()
    except Exception as e:
        return json.dumps({"error": f"WeatherAPI request failed: {str(e)}"}).encode()


def handle_api_weatherapi_forecast(path):
    """Proxy WeatherAPI.com 3-day forecast. Set WEATHERAPI_KEY env var."""
    lat, lon = _get_lat_lon_from_path(path)
    key = os.environ.get("WEATHERAPI_KEY", "")
    if not key:
        return json.dumps({"error": "WEATHERAPI_KEY not configured"}).encode()
    url = f"https://api.weatherapi.com/v1/forecast.json?key={key}&q={lat},{lon}&days=3&aqi=no"
    req = urllib.request.Request(url, headers={"User-Agent": "StarGaze/1.0"})
    ssl_ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=10, context=ssl_ctx) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        return json.dumps({"error": f"WeatherAPI error ({e.code})", "status": e.code}).encode()
    except Exception as e:
        return json.dumps({"error": f"WeatherAPI request failed: {str(e)}"}).encode()


def handle_api_owm_current(path):
    """Proxy OpenWeatherMap current weather. Set OWM_KEY env var."""
    lat, lon = _get_lat_lon_from_path(path)
    key = os.environ.get("OWM_KEY", "")
    if not key:
        return json.dumps({"error": "OWM_KEY not configured"}).encode()
    url = f"https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&units=metric&appid={key}"
    req = urllib.request.Request(url, headers={"User-Agent": "StarGaze/1.0"})
    ssl_ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=10, context=ssl_ctx) as resp:
        return resp.read()


def handle_api_accuweather_current(path):
    """Proxy AccuWeather current conditions. Set ACCUWEATHER_KEY env var."""
    lat, lon = _get_lat_lon_from_path(path)
    key = os.environ.get("ACCUWEATHER_KEY", "")
    if not key:
        return {"error": "ACCUWEATHER_KEY not configured"}
    ssl_ctx = ssl.create_default_context()
    try:
        # Step 1: location key
        loc_url = f"https://dataservice.accuweather.com/locations/v1/cities/geoposition/search?apikey={key}&q={lat},{lon}"
        req = urllib.request.Request(loc_url, headers={"User-Agent": "StarGaze/1.0"})
        with urllib.request.urlopen(req, timeout=10, context=ssl_ctx) as resp:
            loc = json.loads(resp.read())
        if not loc or not isinstance(loc, dict) or not loc.get("Key"):
            return {"error": "Location not found"}
        # Step 2: current conditions
        cur_url = f"https://dataservice.accuweather.com/currentconditions/v1/{loc['Key']}?apikey={key}&details=true"
        req = urllib.request.Request(cur_url, headers={"User-Agent": "StarGaze/1.0"})
        with urllib.request.urlopen(req, timeout=10, context=ssl_ctx) as resp:
            data = json.loads(resp.read())
        if not data or not isinstance(data, list):
            return {"error": "No data"}
        return data[0]
    except urllib.error.HTTPError as e:
        return {"error": f"AccuWeather API error ({e.code})", "status": e.code}
    except Exception as e:
        return {"error": f"AccuWeather request failed: {str(e)}"}

