import os
import socket
from http.server import SimpleHTTPRequestHandler, socketserver

class Handler(SimpleHTTPRequestHandler):
    def send_head(self):
        print("-" * 50)
        print(f"[*] Request received for: {self.path}")
        
        # 获取服务器当前工作目录
        server_cwd = os.getcwd()
        print(f"[*] Server CWD: {server_cwd}") # 打印服务器的当前工作目录

        # ---- JS ----
        if self.path.endswith(".js"):
            path = self.translate_path(self.path)
            br_path = path + ".br"
            print(f"[*] Checking JS.br path: {br_path}")
            print(f"[*] JS.br exists? {os.path.exists(br_path)}") # 打印文件是否存在
            if os.path.exists(br_path):
                print(f"[DEBUG] Serving JS Brotli: {br_path}")
                self.send_response(200)
                self.send_header("Content-Encoding", "br")
                self.send_header("Content-Type", "application/javascript")
                self.end_headers()
                return open(br_path, "rb")

        # ---- WASM ----
        if self.path.endswith(".wasm"):
            path = self.translate_path(self.path)
            br_path = path + ".br"
            print(f"[*] Checking WASM.br path: {br_path}")
            print(f"[*] WASM.br exists? {os.path.exists(br_path)}") # 打印文件是否存在
            if os.path.exists(br_path):
                print(f"[DEBUG] Serving WASM Brotli (fallback): {br_path}")
                self.send_response(200)
                self.send_header("Content-Encoding", "br")
                self.send_header("Content-Type", "application/wasm")
                self.end_headers()
                return open(br_path, "rb")

        # ---- WASM.BR ---- (这个块通常不会被 Emscripten 触发，但保留以防万一)
        if self.path.endswith(".wasm.br"):
            path = self.translate_path(self.path)
            print(f"[*] Checking direct WASM.br path: {path}")
            print(f"[*] Direct WASM.br exists? {os.path.exists(path)}")
            if os.path.exists(path):
                print(f"[DEBUG] Serving WASM Brotli (direct): {path}")
                self.send_response(200)
                self.send_header("Content-Encoding", "br")
                self.send_header("Content-Type", "application/wasm")
                self.end_headers()
                return open(path, "rb")

        print("[*] No custom Brotli handler matched. Falling back to SimpleHTTPRequestHandler.")
        print("-" * 50)
        return super().send_head()

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        super().end_headers()

def find_available_port(start_port=8080, max_tries=10):
    for port in range(start_port, start_port + max_tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("", port))
                return port
            except OSError:
                continue
    raise RuntimeError("No available ports found.")

PORT = find_available_port()

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"✅ Serving at http://localhost:{PORT}/ ...")
    httpd.serve_forever()