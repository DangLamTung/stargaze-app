from backend.main import api as app_module
# Use the underlying Flask/Werkzeug app
from backend.main import app
import json

# Find the Flask app
import backend.main
flask_app = None
for attr in dir(backend.main):
    obj = getattr(backend.main, attr, None)
    if hasattr(obj, 'test_client'):
        flask_app = obj
        break

if flask_app:
    with flask_app.test_client() as c:
        r = c.get('/api/tide?lat=10.35&lon=107.08&days=1')
        print('Status:', r.status_code)
        if r.status_code != 200:
            print('Error:', r.data.decode()[:500])
        else:
            d = json.loads(r.data)
            print('station:', d.get('stationName'))
            print('tides count:', len(d.get('tides', [])))
            for t in d.get('tides', [])[:4]:
                print(f"  {t['type']:4s} {t['height']:.2f}m  {t['time'][:16]}")
else:
    print('No Flask app found')
    print(dir(backend.main))
