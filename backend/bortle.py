import colorsys
import io
import math
import ssl
import urllib.request

from PIL import Image

from .utils import bortle_cache


def get_color_class(r, g, b):
    """Map VIIRS pixel RGB to Bortle class — calibrated to lightpollutionmap.info color scale.
    
    Color scale: black → dark blue → blue → green → yellow → orange → red → pink → white
    Based on Falchi et al. (2016) radiance-to-Bortle mapping.
    """
    lum = max(r, g, b)
    
    if lum <= 2:  return 1   # black — pristine
    if lum <= 5:  return 2   # very dark blue
    if lum <= 10: return 3   # dark blue
    if lum <= 25: return 4   # blue-green transition
    if lum <= 50: return 5   # green-yellow (suburban)
    if lum <= 80: return 6   # yellow-orange
    if lum <= 130: return 7  # orange-red (bright suburb/small city)
    if lum <= 200: return 8  # red (city)
    return 9                  # pink-white (city center)


def get_bortle_class(lat, lon):
    zoom = 8  # Higher zoom = ~600m/pixel (was zoom 6 = ~2.4km/pixel)
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

        # Sample a 5×5 pixel region, take MAX brightness
        max_bortle = 0
        for dx in range(-2, 3):
            for dy in range(-2, 3):
                px = max(0, min(255, xpixel + dx))
                py = max(0, min(255, ypixel + dy))
                try:
                    pixel_val = img.getpixel((px, py))
                    r, g, b = pixel_val[0], pixel_val[1], pixel_val[2]
                    bclass = get_color_class(r, g, b)
                    if bclass > max_bortle:
                        max_bortle = bclass
                except Exception:
                    pass

        # If no data at this point (all black pixels = Bortle 1),
        # do a quick expanding search to find nearest non-zero pixel
        if max_bortle <= 1:
            for radius in range(5, 128, 10):  # reduced range for speed
                found = False
                step = max(2, radius // 5)
                for dx in range(-radius, radius + 1, step):
                    for dy in range(-radius, radius + 1, step):
                        px = max(0, min(255, xpixel + dx))
                        py = max(0, min(255, ypixel + dy))
                        try:
                            pixel_val = img.getpixel((px, py))
                            r, g, b = pixel_val[0], pixel_val[1], pixel_val[2]
                            bclass = get_color_class(r, g, b)
                            if bclass > 1:
                                dist_km = max(abs(dx), abs(dy)) * 0.6
                                discount = int(dist_km / 15)
                                max_bortle = max(1, bclass - discount)
                                found = True
                                break
                        except Exception:
                            pass
                    if found:
                        break
                if found:
                    break

        bortle_int = max_bortle if max_bortle > 0 else 5

        # Distance-based city light dome boost
        from .utils import geonames_cities, haversine
        for city in geonames_cities:
            dist = haversine(lat, lon, city["latitude"], city["longitude"])
            if city["population"] > 500000:
                if dist < 8:
                    bortle_int = max(bortle_int, 9)
                elif dist < 15:
                    bortle_int = max(bortle_int, 8)
                elif dist < 25:
                    bortle_int = max(bortle_int, 7)
                elif dist < 40:
                    bortle_int = max(bortle_int, 6)
            elif city["population"] > 100000:
                if dist < 5:
                    bortle_int = max(bortle_int, 7)
                elif dist < 12:
                    bortle_int = max(bortle_int, 6)
                elif dist < 20:
                    bortle_int = max(bortle_int, 5)

        return str(bortle_int)

    except Exception as e:
        print("Failed to read dataset tile:", e)

    return "Unknown"


def bortle_to_sqm(bortle_class):
    """Convert Bortle class to approximate SQM (mag/arcsec²).
    Based on the standard Bortle-to-SQM conversion table.
    """
    mapping = {
        1: 21.9,  # pristine dark sky
        2: 21.6,
        3: 21.4,
        4: 20.9,
        5: 20.4,
        6: 19.5,
        7: 18.5,
        8: 17.5,
        9: 16.5,  # inner city
    }
    return mapping.get(bortle_class, 18.0)
