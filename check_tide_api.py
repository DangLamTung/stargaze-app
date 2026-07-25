import urllib.request, json

# Open-Meteo marine API
url = 'https://marine-api.open-meteo.com/v1/marine?latitude=10.35&longitude=107.08&hourly=wave_height'
try:
    req = urllib.request.Request(url)
    resp = urllib.request.urlopen(req, timeout=10)
    print('Marine API works:', resp.status)
    data = json.loads(resp.read())
    print('Available hourly vars:', list(data.get('hourly', {}).keys())[:15])
except Exception as e:
    print(f'Marine API: {e}')

# Check for tide/sea level params
print()
for param in ['tide', 'sea_level', 'sea_surface_height', 'storm_surge']:
    url = f'https://marine-api.open-meteo.com/v1/marine?latitude=10.35&longitude=107.08&hourly={param}'
    try:
        req = urllib.request.Request(url)
        resp = urllib.request.urlopen(req, timeout=10)
        if resp.status == 200:
            print(f'  {param}: AVAILABLE (200)')
        else:
            print(f'  {param}: {resp.status}')
    except Exception as e:
        print(f'  {param}: {e}')
