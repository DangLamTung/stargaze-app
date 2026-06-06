import colorsys
import io
import math
import ssl
import urllib.request

from PIL import Image

from .utils import bortle_cache


def get_color_class(r, g, b):
    if max(r, g, b) == 0:
        return "1"
    elif max(r, g, b) < 15:
        return "2"

    h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
    h_deg = h * 360

    if v < 0.2 and h_deg > 200:
        return "3"
    elif h_deg > 200:
        return "4"
    elif h_deg > 120:
        return "4"
    elif h_deg > 60:
        return "5"
    elif h_deg > 30:
        return "6"
    elif h_deg > 10:
        return "7"
    elif s < 0.5:
        return "9"
    return "8"


def get_bortle_class(lat, lon):
    zoom = 6
    lat_rad = math.radians(lat)
    n = 2.0**zoom
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n

    xtile = int(x)
    ytile = int(y)
    xpixel = int((x - xtile) * 256)
    ypixel = int((y - ytile) * 256)

    cache_key = f"{zoom}_{xtile}_{ytile}"
    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE

    try:
        if cache_key not in bortle_cache:
            url = (
                f"https://www.lightpollutionmap.info/geoserver/gwc/service/wmts?layer=PostGIS:VIIRS_2025"
                f"&style=&tilematrixset=EPSG:900913&Service=WMTS&Request=GetTile&Version=1.0.0"
                f"&Format=image/png&TileMatrix=EPSG:900913:{zoom}&TileCol={xtile}&TileRow={ytile}"
            )
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=5, context=ssl_ctx) as response:
                bortle_cache[cache_key] = response.read()

        img = Image.open(io.BytesIO(bortle_cache[cache_key])).convert("RGBA")
        pixel_val = img.getpixel((xpixel, ypixel))

        r, g, b = pixel_val[0], pixel_val[1], pixel_val[2]
        bortle = get_color_class(r, g, b)
        
        # Distance-based light dome adjustment
        if bortle in ["1", "2", "3"]:
            from .utils import geonames_cities, haversine
            for city in geonames_cities:
                if city["population"] > 500000:
                    dist = haversine(lat, lon, city["latitude"], city["longitude"])
                    if dist < 25:
                        return "6"
                    elif dist < 45:
                        return "5"
                    elif dist < 65:
                        return "4"
                elif city["population"] > 100000:
                    dist = haversine(lat, lon, city["latitude"], city["longitude"])
                    if dist < 15:
                        return "5"
                    elif dist < 25:
                        return "4"
                    elif dist < 35:
                        return "3"
        return bortle

    except Exception as e:
        print("Failed to read dataset tile:", e)

    return "Unknown"
