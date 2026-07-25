import http.server
import os
import socketserver

PORT = int(os.environ.get("PORT", 3000))

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/health":
            self.send_response(200)
            self.send_header("Content-type","application/json")
            self.send_header("Access-Control-Allow-Origin","*")
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
            return
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control","no-store")
        super().end_headers()

if __name__ == "__main__":
    print(f"StarGaze AR server on http://0.0.0.0:{PORT}")
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("", PORT), Handler) as httpd:
        httpd.serve_forever()
