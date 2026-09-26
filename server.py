# code/server.py
# __TGC_MERGE__
# Static file server + local-file persistence for tg / ds.
# Serves code/ as root. Handles /data/<app>/<path> for GET/POST/DELETE.
# Port 8731.

import os
import re
from pathlib import Path
import sys
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_APPS = ("telegram", "discord", "subtitles")


# ============================================================
# __TGC_MERGE__ — routes for the merged telegram app
# ============================================================
import base64 as _b64
import shutil as _shutil
import urllib.parse as _up

_TG_ROOT   = Path(ROOT)
_TG_DIR    = _TG_ROOT / "telegram"
_TG_DATA   = _TG_DIR / "data"
_TG_MEDIA  = _TG_DIR / "media" / "avatars"
_TG_ROOTS  = _TG_DIR / "allowed_roots.txt"

def _tg_allowed_roots():
    roots = []
    if _TG_ROOTS.exists():
        for line in _TG_ROOTS.read_text(encoding="utf-8").splitlines():
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            try: roots.append(Path(s).resolve())
            except Exception: pass
    return roots

_TG_ALLOWED = _tg_allowed_roots()

def _tg_inside_allowed(p):
    try: rp = Path(p).resolve()
    except Exception: return False
    for r in _TG_ALLOWED:
        try:
            rp.relative_to(r); return True
        except ValueError: pass
    return False

def _tg_safe(rel):
    rel = rel.lstrip("/").replace("\\", "/")
    p = (_TG_DATA / rel).resolve()
    try:
        p.relative_to(_TG_DATA.resolve())
    except ValueError:
        return None
    return p

def _safe_join(base, *parts):
    p = os.path.normpath(os.path.join(base, *parts))
    if not p.startswith(base):
        raise ValueError("path escapes base")
    return p

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def _send_json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _parse_data_path(self):
        parsed = urlparse(self.path)
        parts = [unquote(p) for p in parsed.path.split("/") if p]
        if len(parts) < 3 or parts[0] != "data":
            return None
        app = parts[1]
        if app not in DATA_APPS:
            return None
        rel = "/".join(parts[2:])
        if not rel or ".." in rel.split("/"):
            return None
        data_dir = os.path.join(ROOT, app, "data")
        os.makedirs(data_dir, exist_ok=True)
        return _safe_join(data_dir, *rel.split("/"))

    def do_GET(self):
        if self.path == "/data/ping":
            self._send_json(200, {"ok": True})
            return
        # __TGC_MERGE__ routes
        if self.path == "/telegram/data-bundle":
            return self._tg_handle_data_bundle()
        if self.path.startswith("/telegram/data"):
            return self._tg_handle_data_get(self.path)
        target = self._parse_data_path()
        if target is None:
            return super().do_GET()
        if not os.path.isfile(target):
            self._send_json(404, {"error": "not found"})
            return
        try:
            with open(target, "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            self._send_json(500, {"error": str(e)})

    def do_POST(self):
        # __TGC_MERGE__ routes
        if self.path.startswith("/telegram/data"):
            return self._tg_handle_data_post(self.path)
        if self.path == "/telegram/upload":
            return self._tg_handle_upload()
        if self.path == "/telegram/delete-avatar":
            return self._tg_handle_delete_avatar()
        if self.path == "/telegram/open":
            return self._tg_handle_open()
        if self.path == "/telegram/export":
            return self._tg_handle_export()
        target = self._parse_data_path()
        if target is None:
            self._send_json(404, {"error": "bad path"})
            return
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length) if length else b""
        try:
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, "wb") as f:
                f.write(body)
            self._send_json(200, {"ok": True})
        except Exception as e:
            self._send_json(500, {"error": str(e)})

    def do_DELETE(self):
        # __TGC_MERGE__ routes
        if self.path.startswith("/telegram/data"):
            return self._tg_handle_data_delete(self.path)
        target = self._parse_data_path()
        if target is None:
            self._send_json(404, {"error": "bad path"})
            return
        try:
            if os.path.isfile(target):
                os.remove(target)
            self._send_json(200, {"ok": True})
        except Exception as e:
            self._send_json(500, {"error": str(e)})


    # ---- __TGC_MERGE__: telegram channels/folders routes ----
    def _tg_send_json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _tg_send_text(self, code, text):
        body = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _tg_handle_data_bundle(self):
        data_root = _TG_DATA
        if not data_root.exists():
            return self._tg_send_json(200, {"foldersMd": "", "channels": []})
        folders_md = ""
        fp = data_root / "folders.md"
        if fp.exists():
            try: folders_md = fp.read_text(encoding="utf-8")
            except Exception: folders_md = ""
        channels = []
        chroot = data_root / "channels"
        if chroot.is_dir():
            try:
                for d in sorted(chroot.iterdir(), key=lambda p: p.name):
                    if not d.is_dir(): continue
                    meta_text = ""
                    mp = d / "meta.md"
                    if mp.exists():
                        try: meta_text = mp.read_text(encoding="utf-8")
                        except Exception: meta_text = ""
                    posts = []
                    try:
                        for f in sorted(d.iterdir(), key=lambda p: p.name):
                            m = re.match(r"^(\d+)\.md$", f.name)
                            if not m: continue
                            num = int(m.group(1))
                            try: body = f.read_text(encoding="utf-8")
                            except Exception: body = ""
                            posts.append({"number": num, "body": body.rstrip("\n")})
                    except Exception: pass
                    channels.append({"slug": d.name, "meta": meta_text, "posts": posts})
            except Exception: pass
        return self._tg_send_json(200, {"foldersMd": folders_md, "channels": channels})

    def _tg_handle_data_get(self, path):
        rel = path[len("/telegram/data"):]
        if rel.startswith("/"): rel = rel[1:]
        rel = _up.unquote(rel)
        target = _tg_safe(rel)
        if target is None: return self._tg_send_text(400, "bad path")
        if target.is_dir():
            try: names = sorted(x.name for x in target.iterdir())
            except Exception as e: return self._tg_send_text(500, f"list err: {e}")
            return self._tg_send_json(200, {"dir": True, "entries": names})
        if target.is_file():
            try: return self._tg_send_text(200, target.read_text(encoding="utf-8"))
            except Exception as e: return self._tg_send_text(500, f"read err: {e}")
        return self._tg_send_text(404, "not found")

    def _tg_handle_data_post(self, path):
        rel = path[len("/telegram/data"):]
        if rel.startswith("/"): rel = rel[1:]
        rel = _up.unquote(rel)
        target = _tg_safe(rel)
        if target is None: return self._tg_send_text(400, "bad path")
        length = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(length) if length else b""
        if rel.endswith("/") or rel == "":
            try:
                target.mkdir(parents=True, exist_ok=True)
                return self._tg_send_json(200, {"ok": True})
            except Exception as e:
                return self._tg_send_text(500, f"mkdir err: {e}")
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
            return self._tg_send_json(200, {"ok": True})
        except Exception as e:
            return self._tg_send_text(500, f"write err: {e}")

    def _tg_handle_data_delete(self, path):
        rel = path[len("/telegram/data"):]
        if rel.startswith("/"): rel = rel[1:]
        rel = _up.unquote(rel)
        target = _tg_safe(rel)
        if target is None: return self._tg_send_text(400, "bad path")
        try:
            if target.is_dir(): _shutil.rmtree(target)
            elif target.exists(): target.unlink()
            return self._tg_send_json(200, {"ok": True})
        except Exception as e:
            return self._tg_send_text(500, f"delete err: {e}")

    def _tg_handle_upload(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            req = json.loads(raw.decode("utf-8"))
            cid = req.get("id", "")
            data_url = req.get("data", "")
        except Exception as e:
            return self._tg_send_json(400, {"error": f"bad json: {e}"})
        if not cid or not re.fullmatch(r"[A-Za-z0-9_\-]+", cid):
            return self._tg_send_json(400, {"error": "bad id"})
        if not data_url.startswith("data:image/"):
            return self._tg_send_json(400, {"error": "bad data url"})
        try:
            head, b64 = data_url.split(",", 1)
            img = _b64.b64decode(b64)
        except Exception as e:
            return self._tg_send_json(400, {"error": f"bad b64: {e}"})
        _TG_MEDIA.mkdir(parents=True, exist_ok=True)
        out = _TG_MEDIA / f"{cid}.jpg"
        try: out.write_bytes(img)
        except Exception as e:
            return self._tg_send_json(500, {"error": f"write: {e}"})
        rel = f"telegram/media/avatars/{cid}.jpg"
        return self._tg_send_json(200, {"path": "/" + rel})

    def _tg_handle_delete_avatar(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            req = json.loads(raw.decode("utf-8"))
            cid = req.get("id", "")
        except Exception as e:
            return self._tg_send_json(400, {"error": f"bad json: {e}"})
        if not cid or not re.fullmatch(r"[A-Za-z0-9_\-]+", cid):
            return self._tg_send_json(400, {"error": "bad id"})
        f = _TG_MEDIA / f"{cid}.jpg"
        try:
            if f.exists(): f.unlink()
        except Exception as e:
            return self._tg_send_json(500, {"error": f"delete: {e}"})
        return self._tg_send_json(200, {"ok": True})

    def _tg_handle_open(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            req = json.loads(raw.decode("utf-8"))
            raw_path = req.get("path", "")
        except Exception as e:
            return self._tg_send_json(400, {"error": f"bad json: {e}"})
        if not raw_path:
            return self._tg_send_json(400, {"error": "missing path"})
        p = Path(raw_path)
        if not p.is_absolute():
            return self._tg_send_json(400, {"error": "must be absolute"})
        if not p.exists():
            return self._tg_send_json(404, {"error": "not found"})
        try:
            import os as _os
            _os.startfile(str(p))
        except Exception as e:
            return self._tg_send_json(500, {"error": f"open: {e}"})
        return self._tg_send_json(200, {"ok": True})

    def _tg_handle_export(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            req = json.loads(raw.decode("utf-8"))
            out_path = req.get("path", "")
        except Exception as e:
            return self._tg_send_json(400, {"error": f"bad json: {e}"})
        if not out_path:
            return self._tg_send_json(400, {"error": "missing path"})
        target = Path(out_path)
        try: target.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            return self._tg_send_json(500, {"error": f"mkdir: {e}"})

        # export chats
        chats_file = _TG_DATA / "chats"
        n_chats = 0
        if chats_file.is_dir():
            for f in sorted(chats_file.glob("*.json")):
                try:
                    d = json.loads(f.read_text(encoding="utf-8"))
                except Exception: continue
                msgs = d.get("msgs") or []
                lines = []
                for m in msgs:
                    who = m.get("a", "")
                    lines.append(f"[{who}] {m.get('t','')}")
                (target / (f.stem + ".md")).write_text("\n\n".join(lines), encoding="utf-8")
                n_chats += 1

        # export channels
        chroot = _TG_DATA / "channels"
        n_posts = 0
        if chroot.is_dir():
            for d in sorted(chroot.iterdir(), key=lambda p: p.name):
                if not d.is_dir(): continue
                outdir = target / d.name
                outdir.mkdir(parents=True, exist_ok=True)
                for f in sorted(d.glob("[0-9]*.md")):
                    try:
                        (outdir / f.name).write_text(f.read_text(encoding="utf-8"), encoding="utf-8")
                        n_posts += 1
                    except Exception: pass
        return self._tg_send_json(200, {"ok": True, "chats": n_chats, "posts": n_posts})

def main():
    port = 8731
    os.chdir(ROOT)
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print("Serving from: %s" % ROOT)
    print("  App:  http://localhost:%d/telegram/index.html" % port)
    print("  Data: http://localhost:%d/data/<app>/<path>" % port)
    print("Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass

if __name__ == "__main__":
    main()
