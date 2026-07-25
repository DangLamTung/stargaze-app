import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))
# Hack: run the api module standalone by fixing imports
import importlib.util
spec = importlib.util.spec_from_file_location("api", "backend/api.py")
api = importlib.util.module_from_spec(spec)

# Before executing, mock the relative imports
import backend.bortle as bortle
import backend.tasks as tasks
import backend.utils as utils
sys.modules['.bortle'] = bortle
sys.modules['.tasks'] = tasks
sys.modules['.utils'] = utils

spec.loader.exec_module(api)

# Test
name, dist = api._get_nearest_tf_station(10.35, 107.08)
print('Nearest station:', name, 'dist:', dist)

if name:
    tides, actual = api._scrape_tide_forecast(name)
    print('Scraped:', len(tides) if tides else 'None', 'actual:', actual)
    if tides:
        for t in tides[:6]:
            print(f"  {t['type']:4s} {t['height']:.2f}m  {t['time'][:16]}")
