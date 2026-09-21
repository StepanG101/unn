#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Локальный сервер PetLife MVP: статика + погода + анализ фото + заявки."""

from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
SIGNUPS_FILE = DATA_DIR / "signups.json"
PORT = int(os.environ.get("PETLIFE_PORT", "8765"))
HOST = "127.0.0.1"

WEATHER_CODES = {
    0: "ясно",
    1: "преимущественно ясно",
    2: "переменная облачность",
    3: "пасмурно",
    45: "туман",
    48: "изморозь",
    51: "лёгкая морось",
    53: "морось",
    55: "сильная морось",
    56: "ледяная морось",
    57: "сильная ледяная морось",
    61: "небольшой дождь",
    63: "дождь",
    65: "сильный дождь",
    66: "ледяной дождь",
    67: "сильный ледяной дождь",
    71: "небольшой снег",
    73: "снег",
    75: "сильный снег",
    77: "снежные зёрна",
    80: "небольшой ливень",
    81: "ливень",
    82: "сильный ливень",
    85: "небольшой снегопад",
    86: "сильный снегопад",
    95: "гроза",
    96: "гроза с градом",
    99: "сильная гроза с градом",
}


def read_config():
    text = (ROOT / "js" / "config.js").read_text(encoding="utf-8")

    def grab(name):
        match = re.search(rf'{name}:\s*"([^"]*)"', text)
        return match.group(1) if match else ""

    return {
        "openweather": grab("OPENWEATHER_API_KEY"),
        "openrouter": grab("OPENROUTER_API_KEY"),
        "model": grab("OPENROUTER_MODEL") or "meta-llama/llama-3.2-11b-vision-instruct:free",
    }


def is_placeholder(value):
    return (not value) or value.startswith("YOUR_")


def http_json(url, timeout=20, headers=None, data=None):
    req = urllib.request.Request(url, data=data, headers=headers or {"User-Agent": "PetLife-MVP/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def fetch_weather(city):
    query = urllib.parse.urlencode(
        {"name": city, "count": 1, "language": "ru", "format": "json"}
    )
    geo = http_json("https://geocoding-api.open-meteo.com/v1/search?" + query)
    results = geo.get("results") or []
    if not results:
        raise LookupError("not-found")

    place = results[0]
    lat = place["latitude"]
    lon = place["longitude"]
    name = place.get("name") or city
    country = place.get("country") or ""
    admin = place.get("admin1") or ""
    label = name
    if admin and admin != name:
        label = f"{name}, {admin}"
    elif country:
        label = f"{name}, {country}"

    forecast_q = urllib.parse.urlencode(
        {
            "latitude": lat,
            "longitude": lon,
            "current": "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m",
            "wind_speed_unit": "ms",
            "timezone": "auto",
        }
    )
    forecast = http_json("https://api.open-meteo.com/v1/forecast?" + forecast_q)
    current = forecast.get("current") or {}
    if "temperature_2m" not in current:
        raise RuntimeError("api")

    code = int(current.get("weather_code") or 0)
    return {
        "cityName": label,
        "temp": float(current["temperature_2m"]),
        "description": WEATHER_CODES.get(code, "переменная погода"),
        "humidity": int(current.get("relative_humidity_2m") or 0),
        "wind": float(current.get("wind_speed_10m") or 0),
        "feelsLike": float(current.get("apparent_temperature") or current["temperature_2m"]),
    }


PROMPT = (
    "Ты — ветеринарный ассистент. Посмотри на фото питомца. Кратко опиши, что видишь. "
    "Если есть признаки проблем со здоровьем — укажи. Дай рекомендацию: наблюдать дома "
    "или обратиться к ветеринару. Отвечай на русском, дружелюбно, максимум 5 предложений."
)

VISION_MODELS = [
    "google/gemini-2.0-flash-exp:free",
    "meta-llama/llama-3.2-11b-vision-instruct:free",
    "qwen/qwen2.5-vl-7b-instruct:free",
]


def extract_ai_text(payload):
    choices = payload.get("choices") or []
    if not choices:
        return ""
    content = ((choices[0] or {}).get("message") or {}).get("content")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                parts.append(item.get("text") or "")
        return " ".join(parts).strip()
    return ""


def analyze_via_openrouter(data_url, config):
    key = config["openrouter"]
    if is_placeholder(key):
        return None, "local"

    models = [config["model"]] + [m for m in VISION_MODELS if m != config["model"]]
    last_error = "Что-то пошло не так. Попробуйте позже."
    last_status = 500

    body_base = {
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": PROMPT},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        ]
    }

    for model in models:
        payload = dict(body_base)
        payload["model"] = model
        raw = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            "https://openrouter.ai/api/v1/chat/completions",
            data=raw,
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer " + key,
                "HTTP-Referer": "http://127.0.0.1:8765",
                "X-Title": "PetLife MVP",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            text = extract_ai_text(data)
            if text:
                return text, "openrouter"
            last_error = "Модель не вернула текст анализа."
        except urllib.error.HTTPError as err:
            last_status = err.code
            detail = err.read().decode("utf-8", errors="ignore")
            try:
                parsed = json.loads(detail)
                last_error = (
                    ((parsed.get("error") or {}).get("message"))
                    or parsed.get("message")
                    or last_error
                )
            except json.JSONDecodeError:
                last_error = detail or last_error
            if err.code in (401, 429):
                return None, err.code
            continue
        except Exception:
            last_error = "Что-то пошло не так. Попробуйте позже."
            continue

    return None, last_status if last_status != 500 else last_error


def save_signup(entry):
    DATA_DIR.mkdir(exist_ok=True)
    items = []
    if SIGNUPS_FILE.exists():
        try:
            items = json.loads(SIGNUPS_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            items = []
    items.append(entry)
    SIGNUPS_FILE.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")


class PetLifeHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        sys.stdout.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def _send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > 8 * 1024 * 1024:
            raise ValueError("too-large")
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8"))

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/weather":
            params = urllib.parse.parse_qs(parsed.query)
            city = (params.get("city") or [""])[0].strip()
            if not city:
                self._send_json({"error": "empty"}, 400)
                return
            try:
                self._send_json(fetch_weather(city))
            except LookupError:
                self._send_json({"error": "not-found"}, 404)
            except Exception:
                self._send_json({"error": "api"}, 502)
            return
        if parsed.path in ("/", "/index.html", ""):
            self.path = "/index.html"
        return SimpleHTTPRequestHandler.do_GET(self)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/analyze":
            try:
                payload = self._read_json()
            except ValueError:
                self._send_json({"error": "Файл слишком большой (макс. 5 МБ)"}, 400)
                return
            except json.JSONDecodeError:
                self._send_json({"error": "Что-то пошло не так. Попробуйте позже."}, 400)
                return

            data_url = payload.get("image") or ""
            if not data_url.startswith("data:image/"):
                self._send_json({"error": "Загрузите изображение"}, 400)
                return

            text, status = analyze_via_openrouter(data_url, read_config())
            if text:
                self._send_json({"text": text, "source": "openrouter"})
                return
            if status == 401:
                self._send_json({"error": "Ошибка API-ключа. Проверьте ключ OpenRouter.", "source": "local"}, 200)
                return
            if status == 429:
                self._send_json({"error": "Слишком много запросов. Подождите минуту.", "source": "local"}, 200)
                return
            if status == "local":
                self._send_json({"source": "local"})
                return
            message = status if isinstance(status, str) else "Что-то пошло не так. Попробуйте позже."
            self._send_json({"error": message, "source": "local"})
            return

        if parsed.path == "/api/access":
            try:
                payload = self._read_json()
            except Exception:
                self._send_json({"error": "bad-request"}, 400)
                return
            name = str(payload.get("name") or "").strip()
            email = str(payload.get("email") or "").strip()
            breed = str(payload.get("breed") or "").strip()
            if len(name) < 2:
                self._send_json({"error": "name"}, 400)
                return
            if "@" not in email or "." not in email:
                self._send_json({"error": "email"}, 400)
                return
            save_signup(
                {
                    "name": name,
                    "email": email,
                    "breed": breed,
                    "createdAt": datetime.now(timezone.utc).isoformat(),
                }
            )
            self._send_json({"ok": True})
            return

        self.send_error(404)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()


def open_browser(url):
    time.sleep(0.6)
    webbrowser.open(url)


def main():
    os.chdir(ROOT)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    httpd = ThreadingHTTPServer((HOST, PORT), PetLifeHandler)
    url = f"http://{HOST}:{PORT}/"
    print("PetLife MVP: " + url)
    print("Stop: Ctrl+C")
    threading.Thread(target=open_browser, args=(url,), daemon=True).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        httpd.server_close()


if __name__ == "__main__":
    main()
