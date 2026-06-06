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

    url = f"https://api.open-meteo.com/v1/forecast?lat={lat}&lon={lon}&hourly=cloudcover,visibility,relative_humidity_2m,precipitation_probability,dew_point_2m&daily=moon_phase&timezone=auto&forecast_days=1"
    req = urllib.request.Request(url, headers={"User-Agent": "StarGaze-Background/1.0"})
    with urllib.request.urlopen(req, timeout=10, context=ctx) as res:
        data = json.loads(res.read())

    cc_list = data.get("hourly", {}).get("cloudcover", [])
    vis_list = data.get("hourly", {}).get("visibility", [])
    hum_list = data.get("hourly", {}).get("relative_humidity_2m", [])
    precip_list = data.get("hourly", {}).get("precipitation_probability", [])
    dew_list = data.get("hourly", {}).get("dew_point_2m", [])
    moon_phase = data.get("daily", {}).get("moon_phase", [0.5])[0]

    if len(cc_list) > 21:
        cc = cc_list[21]
        vis = vis_list[21] if len(vis_list) > 21 else 10000
        hum = hum_list[21] if len(hum_list) > 21 else 50
        precip = precip_list[21] if len(precip_list) > 21 else 0
        dew = dew_list[21] if len(dew_list) > 21 else 0

        score = (
            score_cloud(cc) * 0.35
            + score_moon_phase(moon_phase) * 0.20
            + 50 * 0.20
            + score_humidity(hum) * 0.10
            + score_visibility(vis) * 0.10
            + score_precip(precip) * 0.05
        )

        if score >= 40:
            subject = f"⭐ StarGaze Alert for {name}"
            msg = (
                f"Good news! Conditions are great for stargazing at {name} tonight.\n\n"
                f"⭐ Score: {int(score)}/100\n"
                f"☁️ Cloud Cover: {int(cc)}%\n"
                f"👁️ Visibility: {int(vis/1000)} km\n"
                f"💧 Humidity: {int(hum)}%\n"
                f"🌡️ Dew Point: {dew}°C"
            )
            print(f"BACKGROUND NOTIFICATION TRIGGERED: {subject}")
            try:
                send_email_alert(email_addr, email_pass, subject, msg)
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
