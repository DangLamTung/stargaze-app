import datetime
import http.server
import json
import os
import socketserver
import sys
import threading
import urllib.parse

from .api import (
    handle_api_bortle_logic,
    handle_api_nearby_logic,
    handle_api_satellite_cloud_logic,
    handle_api_tile_logic,
    handle_test_notification,
)
from .tasks import favorites_background_task
from .utils import load_cities

PORT = int(os.environ.get("PORT", 3000))


class CORSRequestHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/api/nearby"):
            try:
                places = handle_api_nearby_logic(self.path)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(places).encode("utf-8"))
            except ValueError:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'{"error": "Invalid parameters"}')
        elif self.path.startswith("/api/bortle"):
            try:
                query_components = urllib.parse.parse_qs(
                    urllib.parse.urlparse(self.path).query
                )
                lat = float(query_components.get("lat", ["0"])[0])
                lon = float(query_components.get("lon", ["0"])[0])
                data = handle_api_bortle_logic(lat, lon)
                self.send_response(200)
                self.send_header("Content-type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps(data).encode("utf-8"))
            except ValueError:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'{"error": "Invalid parameters"}')
        elif self.path.startswith("/api/satellite-cloud"):
            try:
                query_components = urllib.parse.parse_qs(
                    urllib.parse.urlparse(self.path).query
                )
                lat = float(query_components.get("lat", ["0"])[0])
                lon = float(query_components.get("lon", ["0"])[0])
                data = handle_api_satellite_cloud_logic(lat, lon)
                self.send_response(200)
                self.send_header("Content-type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps(data).encode("utf-8"))
            except ValueError:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'{"error": "Invalid parameters"}')
        elif self.path.startswith("/api/tile/"):
            try:
                img_data = handle_api_tile_logic(self.path)
                self.send_response(200)
                self.send_header("Content-type", "image/png")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cache-Control", "public, max-age=86400")
                self.end_headers()
                self.wfile.write(img_data)
            except Exception as e:
                print("Proxy failed:", e)
                self.send_response(404)
                self.end_headers()
        elif self.path == "/api/favorites":
            try:
                data = "[]"
                if os.path.exists("favorites.json"):
                    with open("favorites.json", "r") as f:
                        data = f.read()
                self.send_response(200)
                self.send_header("Content-type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(data.encode("utf-8"))
            except Exception:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(b'{"error": "Failed to read"}')
        elif self.path == "/api/curated_spots":
            try:
                data = "[]"
                if os.path.exists("backend/curated_spots.json"):
                    with open("backend/curated_spots.json", "r") as f:
                        data = f.read()
                self.send_response(200)
                self.send_header("Content-type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(data.encode("utf-8"))
            except Exception:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(b'{"error": "Failed to read"}')
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == "/api/favorites":
            content_length = int(self.headers["Content-Length"])
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
                self.end_headers()
                self.wfile.write(b'{"error": "Failed to save"}')
        elif self.path == "/api/settings":
            content_length = int(self.headers["Content-Length"])
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode("utf-8"))
                with open("settings.json", "w") as f:
                    json.dump(data, f)
                self.send_response(200)
                self.send_header("Content-type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b'{"success": true}')
            except Exception:
                self.send_response(500)
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
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header(
            "Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate"
        )
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
