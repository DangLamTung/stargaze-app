import urllib.request, re

# Check all potential Vietnamese station names on tide-forecast
names = [
    "Vung-Tau", "Da-Nang", "Cam-Ranh", 
    "Nha-Trang", "Phan-Thiet", "Quy-Nhon",
    "Haiphong", "Hai-Phong", "Ha-Long", "Halong",
    "Ho-Chi-Minh", "Saigon", "Phu-Quoc",
    "Con-Dao", "Con-Son", "Rach-Gia",
    "Ca-Mau", "Thanh-Hoa", "Sam-Son",
    "Vinh", "Cua-Lo", "Dong-Hoi",
    "Hue", "Thuan-An", "Quang-Ngai",
    "Tuy-Hoa", "Phan-Rang", "Mui-Ne",
    "Binh-Thuan", "Ninh-Thuan",
]

for name in names:
    url = f'https://www.tide-forecast.com/locations/{name}-Vietnam/tides/latest'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        resp = urllib.request.urlopen(req, timeout=10)
        if resp.status == 200:
            html = resp.read().decode()
            pattern = r'(High Tide|Low Tide).*?(\d+:\d+\s*(?:AM|PM)).*?([\d.-]+)\s*m'
            matches = re.findall(pattern, html, re.DOTALL)
            print(f'{name:20s} ✓ {len(matches)} entries')
        else:
            print(f'{name:20s} {resp.status}')
    except urllib.error.HTTPError as e:
        if e.code == 404:
            pass  # skip 404s silently
        else:
            print(f'{name:20s} {e.code}')
    except Exception as e:
        print(f'{name:20s} ERR: {e}')
