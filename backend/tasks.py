import json
import os
import smtplib
import ssl
import time
import urllib.request
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText


def send_email_alert(to_email, password, subject, body):
    msg = MIMEMultipart()
    msg["From"] = to_email
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain"))

    server = smtplib.SMTP("smtp.gmail.com", 587)
    server.starttls()
    server.login(to_email, password)
    server.send_message(msg)
    server.quit()


def score_cloud(pct):
    return max(0, min(100, 100 - (pct or 50)))


def score_moon_phase(phase):
    return 100 - (phase * 100)


def score_humidity(h):
    if h is None:
        return 50
    if h <= 40:
        return 100
    if h >= 90:
        return 0
    return ((90 - h) / 50) * 100


def score_visibility(v):
    if v is None:
        return 50
    if v >= 24000:
        return 100
    if v <= 1000:
        return 0
    return ((v - 1000) / 23000) * 100


def score_precip(p):
    if p is None:
        return 75
    if p <= 0:
        return 100
    if p >= 50:
        return 0
    return ((50 - p) / 50) * 100


def process_favorite(fav, email_addr, email_pass):
    lat = fav.get("latitude")
    lon = fav.get("longitude")
    name = fav.get("name")

    ctx = ssl._create_unverified_context()

    url = (
        f"https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lon}"
        f"&hourly=cloud_cover,visibility,relative_humidity_2m,precipitation_probability,dew_point_2m"
        f"&daily=moon_phase"
        f"&timezone=auto"
        f"&forecast_days=1"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "StarGaze-Background/1.0"})
    with urllib.request.urlopen(req, timeout=10, context=ctx) as res:
        data = json.loads(res.read())

    cc_list = data.get("hourly", {}).get("cloud_cover", [])
    vis_list = data.get("hourly", {}).get("visibility", [])
    hum_list = data.get("hourly", {}).get("relative_humidity_2m", [])
    precip_list = data.get("hourly", {}).get("precipitation_probability", [])
    dew_list = data.get("hourly", {}).get("dew_point_2m", [])
    moon_phase = data.get("daily", {}).get("moon_phase", [0.5])[0]

    hourly = data.get("hourly", {})
    times = hourly.get("time", [])
    if not times or not cc_list:
        return

    # Find the evening hour (~21:00 local) instead of hardcoded index
    evening_idx = None
    for i, t in enumerate(times):
        if "T21:00" in t or "T20:00" in t or "T22:00" in t:
            evening_idx = i
            break
    if evening_idx is None and len(cc_list) > 21:
        evening_idx = 21  # fallback
    if evening_idx is None or evening_idx >= len(cc_list):
        return

    cc = cc_list[evening_idx]
    vis = vis_list[evening_idx] if evening_idx < len(vis_list) else 10000
    hum = hum_list[evening_idx] if evening_idx < len(hum_list) else 50
    precip = precip_list[evening_idx] if evening_idx < len(precip_list) else 0
    dew = dew_list[evening_idx] if evening_idx < len(dew_list) else 0

    # Match frontend scoring weights
    score = (
        score_cloud(cc) * 0.45
        + score_moon_phase(moon_phase) * 0.20
        + score_humidity(hum) * 0.08
        + score_visibility(vis) * 0.07
        + score_precip(precip) * 0.05
        + 50 * 0.15  # Bortle unknown in background, assume average
    )

    if score >= 40:
        rating = "Excellent" if score >= 80 else "Good" if score >= 60 else "Fair"
        subject = f"⭐ StarGaze: {rating} stargazing tonight at {name}"
        msg = (
            f"Conditions look {rating.lower()} for stargazing at {name} tonight!\n\n"
            f"⭐ Score: {int(score)}/100\n"
            f"☁️ Cloud Cover: {int(cc) if cc is not None else '?'}%\n"
            f"👁️ Visibility: {int(vis/1000) if vis else '?'} km\n"
            f"💧 Humidity: {int(hum) if hum is not None else '?'}%\n"
            f"🌡️ Dew Point: {int(dew) if dew is not None else '?'}°C\n"
            f"🌙 Moon Phase: {moon_phase*100:.0f}%\n\n"
            f"— StarGaze"
        )
        print(f"BACKGROUND NOTIFICATION: {subject}")
        try:
            send_email_alert(email_addr, email_pass, subject, msg)
            print(f"Email sent to {email_addr}")
        except Exception as em_err:
            print("Email send failed:", em_err)


def favorites_background_task():
    while True:
        try:
            interval = 14400
            email_addr = None
            email_pass = None
            if os.path.exists("settings.json"):
                with open("settings.json", "r") as f:
                    settings = json.load(f)
                    interval = int(settings.get("interval", 14400))
                    email_addr = settings.get("email")
                    email_pass = settings.get("password")
        except Exception:
            interval = 14400

        time.sleep(interval)
        try:
            if not email_addr or not email_pass:
                continue
            if not os.path.exists("favorites.json"):
                continue
            with open("favorites.json", "r") as f:
                favorites = json.load(f)
            if not favorites:
                continue

            for fav in favorites:
                process_favorite(fav, email_addr, email_pass)
        except Exception as e:
            print("Background task error:", e)
