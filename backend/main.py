import datetime
import gzip
import http.server
import io
import json
import os
import socketserver
import sys
import threading
import time
import urllib.parse

# Load .env file if present (no external deps needed)
def _load_env():
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, _, val = line.partition("=")
                    key = key.strip()
                    val = val.strip().strip('"').strip("'")
                    if key and key not in os.environ:
                        os.environ[key] = val
_load_env()

from .routes import find_route, _json as _route_json

from .api import (
    handle_api_bortle_batch_logic,
    handle_test_notification,
)
from .tasks import favorites_background_task
from .utils import load_cities

import mimetypes
mimetypes.add_type('application/wasm', '.wasm')

PORT = int(os.environ.get("PORT", 3000))
_server_start_time = time.time() if 'time' in dir() else 0

# ─── Simple in-memory rate limiter ───
_rate_limit_store = {}
_RATE_LIMIT_WINDOW = 60  # seconds
_RATE_LIMIT_MAX = 30     # max requests per window per IP

def _check_rate_limit(client_ip):
    now = time.time()
    entry = _rate_limit_store.get(client_ip)
    if entry and now - entry["start"] < _RATE_LIMIT_WINDOW:
        if entry["count"] >= _RATE_LIMIT_MAX:
            return False
        entry["count"] += 1
    else:
        _rate_limit_store[client_ip] = {"start": now, "count": 1}
    return True


class CORSRequestHandler(http.server.SimpleHTTPRequestHandler):
    # File extensions that should be cached aggressively
    _CACHEABLE_EXTS = {'.css', '.js', '.wasm', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.json'}
    # Content types worth compressing
    _COMPRESSIBLE_CTYPES = {'text/html', 'text/css', 'text/javascript', 'application/javascript',
                            'application/json', 'image/svg+xml', 'text/plain', 'application/wasm'}

    def do_GET(self):
        # Rate limit check
        if self.path.startswith("/api/"):
            client_ip = self.client_address[0]
            if not _check_rate_limit(client_ip):
                self.send_response(429)
                self.send_header("Content-type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b'{"error": "Too many requests. Slow down."}')
                return

        # Route API calls through the registry
        handler = find_route(self.path, "GET")
        if handler:
            handler(self)
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == "/api/favorites":
            content_length = min(int(self.headers.get("Content-Length", 0)), 65536)
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode("utf-8"))
                with open("favorites.json", "w") as f:
                    json.dump(data, f)
                self.send_response(200)
                self.send_header("Content-type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b'{"success": true}')
            except Exception:
                self.send_response(500)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b'{"error": "Failed to save"}')
        elif self.path == "/api/bortle-batch":
            content_length = min(int(self.headers.get("Content-Length", 0)), 65536)
            post_data = self.rfile.read(content_length)
            try:
                data = handle_api_bortle_batch_logic(post_data.decode("utf-8"))
                self.send_response(200)
                self.send_header("Content-type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps(data).encode("utf-8"))
            except Exception as e:
                print("Bortle batch error:", e)
                self.send_response(500)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b'{"error": "Batch bortle failed"}')
        elif self.path == "/api/settings":
            content_length = min(int(self.headers.get("Content-Length", 0)), 8192)
            post_data = self.rfile.read(content_length)
            try:
                new_data = json.loads(post_data.decode("utf-8"))
                # Merge into existing settings so we don't lose email/password/keys
                existing = {}
                if os.path.exists("settings.json"):
                    with open("settings.json", "r") as f:
                        existing = json.load(f)
                existing.update(new_data)
                with open("settings.json", "w") as f:
                    json.dump(existing, f)
                self.send_response(200)
                self.send_header("Content-type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b'{"success": true}')
            except Exception:
                self.send_response(500)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b'{"error": "Failed to save settings"}')
        elif self.path == "/api/test-notification":
            try:
                handle_test_notification()
                self.send_response(200)
                self.send_header("Content-type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b'{"success": true}')
            except Exception:
                self.send_response(500)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b'{"error": "Failed to trigger notification"}')
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def end_headers(self):
        # No caching — always fetch fresh from server
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        super().end_headers()

    def get_status_color(self, status_code):
        if status_code >= 500:
            return "\033[31m"
        elif status_code >= 400:
            return "\033[33m"
        elif status_code >= 300:
            return "\033[36m"
        return "\033[32m"

    def get_size_str(self, response_size, path):
        size_bytes = 0
        if response_size != "-" and str(response_size).isdigit():
            size_bytes = int(response_size)
        else:
            local_path = "." + path.split("?")[0]
            if local_path == "./" or local_path.endswith("/"):
                local_path = os.path.join(local_path, "index.html")
            try:
                if os.path.isfile(local_path):
                    size_bytes = os.path.getsize(local_path)
            except OSError:
                pass

        if size_bytes >= 1024 * 1024:
            return f"{size_bytes / (1024*1024):.2f} MB"
        elif size_bytes >= 1024:
            return f"{size_bytes / 1024:.2f} KB"
        elif size_bytes > 0:
            return f"{size_bytes} B"
        return "0 B"

    def log_message(self, format, *args):
        try:
            request_line = args[0]
            status_code = int(args[1])
            response_size = args[2]
        except (IndexError, ValueError):
            super().log_message(format, *args)
            return

        parts = request_line.split()
        method = parts[0] if len(parts) > 0 else "GET"
        path = parts[1] if len(parts) > 1 else "/"

        cyan = "\033[36m"
        reset = "\033[0m"
        bold = "\033[1m"
        dim = "\033[2m"

        status_color = self.get_status_color(status_code)
        time_str = datetime.datetime.now().strftime("%X")
        size_str = self.get_size_str(response_size, path)

        print(
            f"[{time_str}] {bold}{cyan}{method}{reset} {bold}{path}{reset} "
            f"→ {status_color}{status_code}{reset} ({dim}{size_str}{reset})"
        )


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


def start_server():
    global _server_start_time
    _server_start_time = time.time()
    # Attach _json helper to handler class for route functions
    CORSRequestHandler._json = _route_json
    load_cities()
    t = threading.Thread(target=favorites_background_task, daemon=True)
    t.start()

    try:
        socketserver.TCPServer.allow_reuse_address = True
        with ThreadedHTTPServer(("", PORT), CORSRequestHandler) as httpd:
            print("=" * 50)
            print("🚀 StarGaze Python Server started successfully!")
            print(f"👉 Server URL: http://localhost:{PORT}")
            print(f"Serving directory: {os.getcwd()}")
            print("Logging format: [Time] Method Path → Status (Size)")
            print("Background Notification Task: Running (every 4 hours)")
            print("=" * 50 + "\n")
            httpd.serve_forever()
    except OSError:
        red = "\033[31m"
        bold = "\033[1m"
        yellow = "\033[33m"
        reset = "\033[0m"
        print(f"\n{bold}{red}❌ Error: Port {PORT} is already in use.{reset}")
        print(
            f"{yellow}It looks like another server is running (e.g. Node server or another Python instance).{reset}"
        )
        print("\nTo resolve this, you can:")
        print(f"1. Kill the existing process running on port {PORT}:")
        print(f"   {bold}kill -9 $(lsof -t -i:{PORT}){reset}")
        print(
            f"2. Or run the server on a different port by modifying PORT in backend/main.py.{reset}\n"
        )
        sys.exit(1)
    except KeyboardInterrupt:
        print("\nShutting down server...")
        sys.exit(0)


if __name__ == "__main__":
    start_server()
