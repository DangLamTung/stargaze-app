import math
import os

# Globals loaded once
geonames_cities = []
tile_cache = {}
bortle_cache = {}


def load_cities():
    global geonames_cities
    if os.path.exists("cities5000.txt") and not geonames_cities:
        print("Loading Geonames cities5000 dataset into memory...")
        try:
            with open("cities5000.txt", "r", encoding="utf-8") as f:
                for line in f:
                    parts = line.split("\t")
                    if len(parts) > 14:
                        try:
                            geonames_cities.append(
                                {
                                    "id": f"geo_{parts[0]}",
                                    "name": parts[1],
                                    "type": parts[7],
                                    "population": int(parts[14]),
                                    "latitude": float(parts[4]),
                                    "longitude": float(parts[5]),
                                    "countryCode": parts[8],
                                    "admin1": parts[10],
                                }
                            )
                        except ValueError:
                            pass
            print(f"Loaded {len(geonames_cities)} cities for offline fast-search.")
        except Exception as e:
            print(f"Failed to load cities5000: {e}")


def haversine(lat1, lon1, lat2, lon2):
    R = 6371
    phi1 = lat1 * math.pi / 180
    phi2 = lat2 * math.pi / 180
    delta_phi = (lat2 - lat1) * math.pi / 180
    delta_lambda = (lon2 - lon1) * math.pi / 180
    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c
