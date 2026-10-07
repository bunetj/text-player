# readings.py
# Two verbs. File management for readings/.
# Knows about chatify/ for --chat. Never knows about apps.
#
#   python importer/readings.py add <path> [--recursive]
#       Any format -> readings/<mirror of rel path>/<stem>.txt
#       Idempotent: skips if the .txt already exists.
#
#   python importer/readings.py format <path> --chat "pdf low punct" [--sep newline|blank|none]
#       File   -> writes <stem>_chat.txt beside it.
#       Folder -> writes a mirrored <name>_chat/ next to the folder.
#
#   --chat ops from chatify/ops.py, applied left to right.

import io, os, re, sys, shutil, zipfile, subprocess

HERE      = os.path.dirname(os.path.abspath(__file__))
_ROOT     = os.path.dirname(HERE)
READINGS  = os.path.join(_ROOT, "readings")

sys.path.insert(0, os.path.join(_ROOT, "chatify"))
from ops import apply_ops  # noqa: E402

add_EXTS = (".txt", ".md", ".epub", ".pdf", ".docx")

SEP_CHOICES = {
    "newline": "\n",
    "blank":   "\n\n",
    "none":    None,
}


# ---------- extractors ----------

def add_txt(path):
    with io.open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def add_epub(path):
    with zipfile.ZipFile(path) as z:
        opf = None
        for n in z.namelist():
            if n.endswith(".opf"):
                opf = n
                break
        order = []
        if opf:
            txt = z.read(opf).decode("utf-8", "replace")
            ids = re.findall(r'<itemref[^>]*idref="([^"]+)"', txt)
            idmap = dict(re.findall(r'<item[^>]*id="([^"]+)"[^>]*href="([^"]+)"', txt))
            base = os.path.dirname(opf)
            for i in ids:
                href = idmap.get(i)
                if href:
                    order.append(os.path.normpath(os.path.join(base, href)).replace("\\", "/"))
        if not order:
            order = [n for n in z.namelist() if n.endswith((".xhtml", ".html", ".htm"))]
        parts = []
        for name in order:
            try:
                raw = z.read(name).decode("utf-8", "replace")
            except KeyError:
                continue
            raw = re.sub(r"<script[\s\S]*?</script>", " ", raw, flags=re.I)
            raw = re.sub(r"<style[\s\S]*?</style>",   " ", raw, flags=re.I)
            raw = re.sub(r"<[^>]+>", " ", raw)
            for a, b in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"')):
                raw = raw.replace(a, b)
            raw = re.sub(r"[ \t]+", " ", raw)
            raw = re.sub(r"\n\s*\n\s*\n+", "\n\n", raw).strip()
            if raw:
                parts.append(raw)
        return "\n\n".join(parts)


def add_pdf(path):
    exe = shutil.which("pdftotext")
    if not exe:
        raise RuntimeError("pdftotext not on PATH (install Poppler)")
    r = subprocess.run([exe, "-layout", "-enc", "UTF-8", path, "-"],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0:
        raise RuntimeError("pdftotext failed: " + r.stderr.decode("utf-8", "replace")[:200])
    return r.stdout.decode("utf-8", "replace")


def add_docx(path):
    with zipfile.ZipFile(path) as z:
        try:
            xml = z.read("word/document.xml").decode("utf-8", "replace")
        except KeyError:
            raise RuntimeError("docx: word/document.xml missing")
    paras = re.split(r"</w:p\s*>", xml)
    out = []
    for p in paras:
        runs = re.findall(r"<w:t[^>]*>([\s\S]*?)</w:t>", p)
        if not runs:
            continue
        txt = "".join(runs)
        for a, b in (("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&apos;", "'")):
            txt = txt.replace(a, b)
        txt = txt.strip()
        if txt:
            out.append(txt)
    return "\n\n".join(out)


adderS = {
    ".txt": add_txt, ".md": add_txt,
    ".epub": add_epub, ".pdf": add_pdf, ".docx": add_docx,
}




# ---------- web ----------

import subprocess as _sp
import time as _time
import urllib.parse as _up

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"


def _slug_from_url(u, cap=60):
    try:
        p = _up.urlparse(u)
        raw = (p.netloc + p.path).strip("/")
    except Exception:
        raw = u
    raw = re.sub(r"[^A-Za-z0-9]+", "_", raw).strip("_")
    if not raw:
        raw = "page"
    return raw[:cap]


def _fetch(url, socks5=None, timeout=30):
    """Fetch URL as text. Uses curl.exe if present, else urllib."""
    curl = shutil.which("curl") or shutil.which("curl.exe")
    if curl:
        cmd = [curl, "-sL", "--max-time", str(timeout), "-A", UA]
        if socks5:
            cmd += ["--socks5-hostname", socks5]
        cmd.append(url)
        r = _sp.run(cmd, stdout=_sp.PIPE, stderr=_sp.PIPE)
        if r.returncode != 0:
            raise RuntimeError("curl %s: %s" % (r.returncode, r.stderr.decode("utf-8", "replace")[:200]))
        return r.stdout.decode("utf-8", "replace")
    import urllib.request as _ur
    req = _ur.Request(url, headers={"User-Agent": UA})
    with _ur.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def _html_to_text(html):
    s = html
    s = re.sub(r"<!--[\s\S]*?-->", " ", s)
    s = re.sub(r"<script[\s\S]*?</script>", " ", s, flags=re.I)
    s = re.sub(r"<style[\s\S]*?</style>",   " ", s, flags=re.I)
    s = re.sub(r"<nav[\s\S]*?</nav>",       " ", s, flags=re.I)
    s = re.sub(r"<header[\s\S]*?</header>", " ", s, flags=re.I)
    s = re.sub(r"<footer[\s\S]*?</footer>", " ", s, flags=re.I)
    s = re.sub(r"<aside[\s\S]*?</aside>",   " ", s, flags=re.I)
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"</p\s*>", "\n\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    for a, b in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"),
                 ("&quot;", '"'), ("&#39;", "'"), ("&apos;", "'")):
        s = s.replace(a, b)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def _links_folder():
    stamp = _time.strftime("%Y%m%d%H%M")
    d = os.path.join(READINGS, "links_" + stamp)
    os.makedirs(d, exist_ok=True)
    return d


def _write_one(out_dir, idx, url, text):
    slug = _slug_from_url(url)
    name = "%02d_%s.txt" % (idx, slug)
    p = os.path.join(out_dir, name)
    with io.open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write("url: " + url + "\n\n" + text + "\n")
    print("  wrote " + os.path.relpath(p, HERE))
    return p


def do_links_file(path, socks5):
    if not os.path.isfile(path):
        print("not found: " + path); return
    with io.open(path, "r", encoding="utf-8", errors="replace") as f:
        urls = [ln.strip() for ln in f if ln.strip() and not ln.strip().startswith("#")]
    if not urls:
        print("no urls in " + path); return
    out_dir = _links_folder()
    print("into " + os.path.relpath(out_dir, HERE))
    for i, u in enumerate(urls, 1):
        try:
            print("fetching %s" % u)
            html = _fetch(u, socks5)
            text = _html_to_text(html)
            if not text:
                print("  empty after strip"); continue
            _write_one(out_dir, i, u, text)
        except Exception as e:
            print("  FAILED: " + str(e))
    print("done -> " + os.path.relpath(out_dir, HERE))


def do_links_paste(socks5):
    print("paste URLs, one per line. blank line to finish.")
    urls = []
    while True:
        try:
            ln = input()
        except EOFError:
            break
        if not ln.strip():
            break
        urls.append(ln.strip())
    if not urls:
        print("no urls"); return
    out_dir = _links_folder()
    print("into " + os.path.relpath(out_dir, HERE))
    for i, u in enumerate(urls, 1):
        try:
            print("fetching %s" % u)
            html = _fetch(u, socks5)
            text = _html_to_text(html)
            if not text:
                print("  empty after strip"); continue
            _write_one(out_dir, i, u, text)
        except Exception as e:
            print("  FAILED: " + str(e))
    print("done -> " + os.path.relpath(out_dir, HERE))


def do_url(url, socks5):
    out_dir = _links_folder()
    try:
        html = _fetch(url, socks5)
        text = _html_to_text(html)
        if not text:
            print("empty after strip"); return
        _write_one(out_dir, 1, url, text)
    except Exception as e:
        print("FAILED: " + str(e))
        return
    print("done -> " + os.path.relpath(out_dir, HERE))


# ---------- helpers ----------

def safe_stem(stem, cap=80):
    for c in '<>:"/\\|?*':
        stem = stem.replace(c, "_")
    stem = stem.strip().rstrip(".")
    if len(stem) > cap:
        stem = stem[:cap].rstrip()
    return stem or "book"


def _split(text, sep):
    if sep is None:
        return [text]
    return [b.strip() for b in text.split(sep) if b.strip()]


def _join(blocks, sep):
    if sep is None:
        return "".join(blocks)
    return sep.join(blocks)


# ---------- add ----------

def do_add(path, recursive):
    path = os.path.abspath(path)
    if not os.path.exists(path):
        print("not found: " + path)
        return
    os.makedirs(READINGS, exist_ok=True)
    root_dir = path if os.path.isdir(path) else os.path.dirname(path)

    def one(fp):
        rel_dir = os.path.relpath(os.path.dirname(os.path.abspath(fp)), root_dir)
        if rel_dir == ".":
            rel_dir = ""
        stem = os.path.splitext(os.path.basename(fp))[0]
        safe = safe_stem(stem)
        out_dir = os.path.join(READINGS, rel_dir) if rel_dir else READINGS
        out = os.path.join(out_dir, safe + ".txt")
        if os.path.isfile(out):
            print("skip (exists): " + os.path.relpath(out, HERE))
            return
        ext = os.path.splitext(fp)[1].lower()
        fn = adderS.get(ext)
        if not fn:
            print("skip (unsupported): " + fp)
            return
        print("adding: " + stem)
        try:
            text = fn(fp)
        except Exception as e:
            print("  FAILED: " + str(e))
            return
        if not text.strip():
            print("  FAILED: empty")
            return
        os.makedirs(out_dir, exist_ok=True)
        with io.open(out, "w", encoding="utf-8") as f:
            f.write(text)
        print("  wrote " + os.path.relpath(out, HERE))

    if os.path.isfile(path):
        one(path)
    else:
        if recursive:
            for dirpath, _dirs, files in os.walk(path):
                for n in sorted(files):
                    if n.lower().endswith(add_EXTS):
                        one(os.path.join(dirpath, n))
        else:
            for n in sorted(os.listdir(path)):
                full = os.path.join(path, n)
                if os.path.isfile(full) and full.lower().endswith(add_EXTS):
                    one(full)
    print("done.")


# ---------- format ----------

def _format_one(src, chat_ops, sep):
    with io.open(src, "r", encoding="utf-8", errors="replace") as f:
        text = f.read()
    try:
        blocks = _split(text, sep)
        blocks = apply_ops(blocks, chat_ops)
        text = _join(blocks, sep)
    except SystemExit as e:
        return False, str(e)
    stem, ext = os.path.splitext(src)
    out = stem + "_chat" + ext
    with io.open(out, "w", encoding="utf-8") as f:
        f.write(text)
    return True, out


def do_format(src, chat_ops, sep_name):
    if not src:
        print("usage: format <path> --chat \"...\" [--sep newline|blank|none]")
        return
    if not chat_ops:
        print('format needs --chat "..."')
        return
    sep_name = (sep_name or "newline").lower()
    if sep_name not in SEP_CHOICES:
        print("unknown --sep: " + sep_name)
        return
    sep = SEP_CHOICES[sep_name]

    src = os.path.abspath(src)
    if not os.path.exists(src):
        print("not found: " + src)
        return

    if os.path.isfile(src):
        ok, res = _format_one(src, chat_ops, sep)
        if not ok:
            print("FAILED (chat ops): " + res)
            return
        print("wrote " + res)
        return

    parent = os.path.dirname(src)
    name = os.path.basename(src)
    out_root = os.path.join(parent, name + "_chat")
    os.makedirs(out_root, exist_ok=True)
    n_ok = 0
    n_fail = 0
    for dirpath, _dirs, files in os.walk(src):
        rel = os.path.relpath(dirpath, src)
        if rel == ".":
            rel = ""
        out_dir = os.path.join(out_root, rel) if rel else out_root
        os.makedirs(out_dir, exist_ok=True)
        for fn in sorted(files):
            if not fn.lower().endswith(".txt"):
                continue
            stem, ext = os.path.splitext(fn)
            out = os.path.join(out_dir, stem + "_chat" + ext)
            ok, res = _format_one(os.path.join(dirpath, fn), chat_ops, sep)
            if ok:
                try:
                    shutil.move(res, out)
                    n_ok += 1
                except Exception as e:
                    print("  move FAILED: " + str(e))
                    n_fail += 1
            else:
                print("  FAILED " + fn + ": " + res)
                n_fail += 1
    print("wrote %d file(s) -> %s" % (n_ok, out_root))
    if n_fail:
        print("failed: %d" % n_fail)


# ---------- main ----------

def main():
    argv = sys.argv[1:]
    if not argv or argv[0] in ("-h", "--help", "help"):
        print('usage:')
        print('  python importer/readings.py <path> [--chat "..."] [--sep newline|blank|none] [--recursive]')
        print('  python importer/readings.py links [other.txt] [--socks5 host:port]')
        print('  python importer/readings.py url https://... [--socks5 host:port]')
        print('  python importer/readings.py url            (paste URLs, blank line to finish)')
        return

    verb = argv[0]
    argv = argv[1:]

    socks5 = None
    chat_ops = []
    sep_name = None
    recursive = False
    target = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--chat":
            if i + 1 >= len(argv):
                print("--chat needs a value"); sys.exit(1)
            chat_ops = argv[i + 1].split(); i += 2
        elif a == "--sep":
            if i + 1 >= len(argv):
                print("--sep needs a value (newline | blank | none)"); sys.exit(1)
            sep_name = argv[i + 1].lower(); i += 2
        elif a == "--recursive":
            recursive = True; i += 1
        elif a == "--socks5":
            if i + 1 >= len(argv):
                print("--socks5 needs host:port"); sys.exit(1)
            socks5 = argv[i + 1]; i += 2
        else:
            target = a; i += 1

    if verb == "links":
        path = target or os.path.join(HERE, "links.txt")
        do_links_file(path, socks5)
        return
    if verb == "url":
        if target:
            do_url(target, socks5)
        else:
            do_links_paste(socks5)
        return

    # default: path form
    if not target:
        print("need a path"); sys.exit(1)
    _run(target, recursive, chat_ops, sep_name)


if __name__ == "__main__":
    main()
