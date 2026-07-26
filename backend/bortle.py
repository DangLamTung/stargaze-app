import colorsys
import io
import math
import ssl
import urllib.request

from PIL import Image

from .utils import bortle_cache


def get_color_class(r, g, b, a=255):
    """Map VIIRS 2025 tile RGBA pixel to Bortle class based on lightpollutionmap.info color scale.
    
    Data Source: NASA/NOAA Suomi-NPP VIIRS Day-Night Band via lightpollutionmap.info WMTS
    Color scale mapping (calibrated to Falchi 2016 World Atlas radiance):
    - Transparent / Black (0, 0, 0): Bortle 1 (Pristine dark sky)
    - Dark Blue / Cyan (b > 40): Bortle 2-3 (Dark / rural sky)
    - Green (18, 181, 81): Bortle 4 (Rural/suburban transition)
    - Yellow (244, 196, 11): Bortle 5 (Suburban sky)
    - Red / Orange (181, 21, 29): Bortle 6 (Suburban / city edge 20-30km out)
    - Deep Red (185, 41, 39): Bortle 7-8 (City center)
    - White / Magenta (235, 235, 235): Bortle 9 (Inner city core)
    """
    if a < 50 or (r < 10 and g < 10 and b < 10):
        return 1

    # 1. Pure White / Pink Magenta Core (Inner City Center - Bortle 9)
    if (r > 230 and g > 210 and b > 210) or (r > 220 and b > 200 and g < 100):
        return 9
    
    # 2. Deep Red / Magenta (City Center - Bortle 8)
    if r > 190 and g < 50 and b < 50:
        return 8

    # 3. Bright Red / Crimson (City Edge / Suburb 20-30km out - Bortle 6-7)
    if r > 160 and g < 80:
        return 6

    # 4. Orange / Amber (Suburban Sky - Bortle 6)
    if r > 200 and g >= 80 and g < 160:
        return 6

    # 5. Yellow (Suburban / Rural Edge - Bortle 5)
    if r > 180 and g >= 160:
        return 5

    # 6. Green (Rural / Suburban Transition - Bortle 4)
    if g > 100:
        return 4

    # 7. Blue / Cyan (Rural Sky - Bortle 3)
    if b > 60:
        return 3

    # 8. Dark Blue (Dark Sky - Bortle 2)
    if b > 15 or g > 15:
        return 2

    return 1


def get_bortle_class(lat, lon):
    zoom = 8  # ~600m per pixel resolution
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

        # Sample target pixel + 3x3 immediate neighborhood (take median/mode or exact pixel)
        bclasses = []
        for dx in range(-1, 2):
            for dy in range(-1, 2):
                px = max(0, min(255, xpixel + dx))
                py = max(0, min(255, ypixel + dy))
                try:
                    pixel_val = img.getpixel((px, py))
                    r, g, b, a = pixel_val[0], pixel_val[1], pixel_val[2], pixel_val[3]
                    bclasses.append(get_color_class(r, g, b, a))
                except Exception:
                    pass

        if bclasses:
            bclasses.sort()
            local_bortle = bclasses[len(bclasses) // 2]  # Median value to prevent point outlier noise
        else:
            local_bortle = 1

        # Garstang Atmospheric Light Dome Scattering Model for nearby major cities
        from .utils import geonames_cities, haversine, load_cities
        load_cities()

        light_dome_bortle = 1
        if geonames_cities:
            for city in geonames_cities:
                pop = city.get("population", 0)
                if pop < 100000:
                    continue

                dist = haversine(lat, lon, city["latitude"], city["longitude"])

                if pop >= 2000000:
                    if dist < 8:
                        light_dome_bortle = max(light_dome_bortle, 8)
                    elif dist < 20:
                        light_dome_bortle = max(light_dome_bortle, 6)
                    elif dist < 40:  # 20 - 40km: Suburban Light Dome (Bortle 5)
                        light_dome_bortle = max(light_dome_bortle, 5)
                    elif dist < 70:  # 40 - 70km: Rural/Suburban Transition (Bortle 4)
                        light_dome_bortle = max(light_dome_bortle, 4)
                    elif dist < 110:  # 70 - 110km: Rural Sky (Bortle 3)
                        light_dome_bortle = max(light_dome_bortle, 3)
                    elif dist < 160:  # 110 - 160km: Dark Sky (Bortle 2)
                        light_dome_bortle = max(light_dome_bortle, 2)
                elif pop >= 500000:
                    if dist < 6:
                        light_dome_bortle = max(light_dome_bortle, 7)
                    elif dist < 15:
                        light_dome_bortle = max(light_dome_bortle, 6)
                    elif dist < 30:
                        light_dome_bortle = max(light_dome_bortle, 5)
                    elif dist < 55:
                        light_dome_bortle = max(light_dome_bortle, 4)
                    elif dist < 90:
                        light_dome_bortle = max(light_dome_bortle, 3)
                    elif dist < 130:
                        light_dome_bortle = max(light_dome_bortle, 2)
                elif pop >= 100000:
                    if dist < 4:
                        light_dome_bortle = max(light_dome_bortle, 6)
                    elif dist < 10:
                        light_dome_bortle = max(light_dome_bortle, 5)
                    elif dist < 25:
                        light_dome_bortle = max(light_dome_bortle, 4)
                    elif dist < 45:
                        light_dome_bortle = max(light_dome_bortle, 3)
                    elif dist < 70:
                        light_dome_bortle = max(light_dome_bortle, 2)

        final_bortle = max(local_bortle, light_dome_bortle)
        return str(final_bortle)

    except Exception as e:
        print("Failed to read dataset tile, using distance scattering calculation:", e)
        try:
            from .utils import geonames_cities, haversine, load_cities
            load_cities()
            light_dome_bortle = 1
            if geonames_cities:
                for city in geonames_cities:
                    pop = city.get("population", 0)
                    if pop < 100000:
                        continue

                    dist = haversine(lat, lon, city["latitude"], city["longitude"])

                    if pop >= 2000000:
                        if dist < 6:
                            light_dome_bortle = max(light_dome_bortle, 8)
                        elif dist < 15:
                            light_dome_bortle = max(light_dome_bortle, 6)
                        elif dist < 30:
                            light_dome_bortle = max(light_dome_bortle, 4)
                        elif dist < 50:
                            light_dome_bortle = max(light_dome_bortle, 3)
                        elif dist < 80:
                            light_dome_bortle = max(light_dome_bortle, 2)
                    elif pop >= 500000:
                        if dist < 5:
                            light_dome_bortle = max(light_dome_bortle, 7)
                        elif dist < 12:
                            light_dome_bortle = max(light_dome_bortle, 5)
                        elif dist < 25:
                            light_dome_bortle = max(light_dome_bortle, 4)
                        elif dist < 40:
                            light_dome_bortle = max(light_dome_bortle, 3)
                    elif pop >= 100000:
                        if dist < 4:
                            light_dome_bortle = max(light_dome_bortle, 6)
                        elif dist < 10:
                            light_dome_bortle = max(light_dome_bortle, 5)
                        elif dist < 20:
                            light_dome_bortle = max(light_dome_bortle, 4)

            return str(light_dome_bortle)
        except Exception:
            return "2"


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
