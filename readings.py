# code/readings.py
# Two verbs.
#
#   python code/readings.py convert <path> [--recursive]
#       Any format -> code/readings/<mirror of rel path>/<stem>.txt
#       Idempotent: skips if the .txt already exists.
#
#   python code/readings.py import --app tg|ds|st [--chat "pdf low punct"]
#       Walks code/readings/**. Each .txt becomes one item in the target.
#       Target folder / channel / playlist name = the .txt's relative
#       subfolder path under code/readings/, with "/" preserved.
#       Slug = same, "/" replaced by "_", lowercased.
#       Top-level .txt (no subfolder) -> name "readings", slug "readings".
#       Idempotent: skips if the title already exists in the target.
#
#   --chat ops applied in memory only; the .txt is never modified.

import io, os, re, sys, json, time, shutil, zipfile, subprocess, unicodedata

HERE      = os.path.dirname(os.path.abspath(__file__))     # code/
READINGS  = os.path.join(HERE, "readings")

TG_DATA   = os.path.join(HERE, "telegram", "data")
TG_CHATS  = os.path.join(TG_DATA, "chats")
TG_FEED   = os.path.join(TG_DATA, "feed.json")
TG_FOLDERS = os.path.join(TG_DATA, "folders.md")

DS_DATA   = os.path.join(HERE, "discord", "data")
DS_CHATS  = os.path.join(DS_DATA, "chats")
DS_FEED   = os.path.join(DS_DATA, "feed.json")

ST_DATA   = os.path.join(HERE, "subtitles", "data")
ST_PL_INDEX = os.path.join(ST_DATA, "playlists.json")
ST_PL_DIR   = os.path.join(ST_DATA, "playlists")

CONVERT_EXTS = (".txt", ".md", ".epub", ".pdf", ".docx")

DEFAULT_PEOPLE = {
    "own":   {"name":"Alex","emoji":"\U0001F642","avatarColor":"#2b5278",
              "myMsgColor":"#2b5278","theirMsgColor":"#2b3b4a"},
    "other": {"name":"Liza","emoji":"\U0001F464","avatarColor":"#3a5a2b",
              "myMsgColor":"#2b5278","theirMsgColor":"#2b3b4a"},
}
DEFAULT_BOT = {"active": False, "answers": [
    "ok","yes","idk","what","stop","real","lol","fuck","shit","wtf","mhm","fine",
    "\u043e\u043a","\u0434\u0430","\u043d\u0437","\u0447\u0442\u043e",
    "\u0445\u0432\u0430\u0442\u0438\u0442","\u0440\u0435\u0430\u043b\u044c\u043d\u043e",
    "\u043b\u043e\u043b","\u0431\u043b\u044f\u0434\u044c","\u0441\u0443\u043a\u0430",
    "\u0447\u0437\u0445","\u043f\u0437\u0434\u0446","\u043c\u0433\u043c","\u043b\u0430\u0434\u043d\u043e",
]}

# ---------- converters ----------

def convert_txt(path):
    with io.open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()

def convert_epub(path):
    with zipfile.ZipFile(path) as z:
        opf = None
        for n in z.namelist():
            if n.endswith(".opf"): opf = n; break
        order = []
        if opf:
            txt = z.read(opf).decode("utf-8", "replace")
            ids   = re.findall(r'<itemref[^>]*idref="([^"]+)"', txt)
            idmap = dict(re.findall(r'<item[^>]*id="([^"]+)"[^>]*href="([^"]+)"', txt))
            base  = os.path.dirname(opf)
            for i in ids:
                href = idmap.get(i)
                if href:
                    order.append(os.path.normpath(os.path.join(base, href)).replace("\\","/"))
        if not order:
            order = [n for n in z.namelist() if n.endswith((".xhtml",".html",".htm"))]
        parts = []
        for name in order:
            try: raw = z.read(name).decode("utf-8", "replace")
            except KeyError: continue
            raw = re.sub(r"<script[\s\S]*?</script>", " ", raw, flags=re.I)
            raw = re.sub(r"<style[\s\S]*?</style>",   " ", raw, flags=re.I)
            raw = re.sub(r"<[^>]+>", " ", raw)
            for a,b in (("&nbsp;"," "),("&amp;","&"),("&lt;","<"),("&gt;",">"),("&quot;",'"')):
                raw = raw.replace(a,b)
            raw = re.sub(r"[ \t]+", " ", raw)
            raw = re.sub(r"\n\s*\n\s*\n+", "\n\n", raw).strip()
            if raw: parts.append(raw)
        return "\n\n".join(parts)

def convert_pdf(path):
    exe = shutil.which("pdftotext")
    if not exe:
        raise RuntimeError("pdftotext not on PATH (install Poppler)")
    r = subprocess.run([exe, "-layout", "-enc", "UTF-8", path, "-"],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0:
        raise RuntimeError("pdftotext failed: " + r.stderr.decode("utf-8","replace")[:200])
    return r.stdout.decode("utf-8", "replace")

def convert_docx(path):
    with zipfile.ZipFile(path) as z:
        try:
            xml = z.read("word/document.xml").decode("utf-8", "replace")
        except KeyError:
            raise RuntimeError("docx: word/document.xml missing")
    paras = re.split(r"</w:p\s*>", xml)
    out = []
    for p in paras:
        runs = re.findall(r"<w:t[^>]*>([\s\S]*?)</w:t>", p)
        if not runs: continue
        txt = "".join(runs)
        for a, b in (("&amp;","&"),("&lt;","<"),("&gt;",">"),("&quot;",'"'),("&apos;","'")):
            txt = txt.replace(a, b)
        txt = txt.strip()
        if txt: out.append(txt)
    return "\n\n".join(out)

converterS = {".txt": convert_txt, ".md": convert_txt,
              ".epub": convert_epub, ".pdf": convert_pdf,
              ".docx": convert_docx}

# ---------- /chat ops ----------

SEP = "\n---\n"

def __blocks(s, sep=SEP):
    return [b.strip() for b in s.split(sep) if b.strip()]
def __join(arr, sep=SEP):
    return sep.join(arr)

def op_pdf(s):
    lines = s.split("\n"); out = []; buf = ""
    for ln in lines:
        if ln.strip() == "":
            if buf.strip(): out.append(buf.strip())
            buf = ""
        else:
            if buf:
                if buf.endswith(("-", "\u2013", "\u2014")):
                    buf = buf[:-1] + ln.lstrip()
                else:
                    buf = buf + " " + ln.strip()
            else:
                buf = ln.strip()
    if buf.strip(): out.append(buf.strip())
    return "\n\n".join(out)

def op_low(s):
    s = s.replace("\u201c", '"').replace("\u201d", '"').replace("\u201e", '"')
    s = s.replace("\u2018", "'").replace("\u2019", "'")
    return s.lower()

PUNCT_SPLIT = ".!?;:,"

def op_punct(s, sep=SEP):
    out = []
    for b in __blocks(s, sep):
        buf = ""; i = 0; n = len(b)
        while i < n:
            ch = b[i]
            if ch in PUNCT_SPLIT:
                prev = b[i-1] if i > 0 else ""
                nxt  = b[i+1] if i+1 < n else ""
                if prev.isalpha() and nxt.isalpha():
                    buf += ch; i += 1; continue
                buf += ch
                if buf.strip(): out.append(buf.strip())
                buf = ""
                while i+1 < n and b[i+1].isspace(): i += 1
            else:
                buf += ch
            i += 1
        if buf.strip(): out.append(buf.strip())
    return __join(out, sep)

def op_rem(s, sep=SEP):
    out = []
    for b in __blocks(s, sep):
        t = "".join(c for c in b if not unicodedata.category(c).startswith("P")).strip()
        if t: out.append(t)
    return __join(out, sep)

def op_lines(s, sep=SEP):
    parts = [p.strip() for p in re.split(r"\n+", s) if p.strip()]
    return __join(parts, sep)

def op_line(s, sep=SEP):
    parts = [p.strip() for p in __blocks(s, sep) if p.strip()]
    return " ".join(parts)

def split_sentences(text):
    return [p for p in re.split(r'(?<=[\.\!\?\u2026])\s+', text) if p]

def op_sent(s, sep=SEP):
    out = []
    for b in __blocks(s, sep):
        for piece in split_sentences(b):
            piece = piece.strip()
            if piece: out.append(piece)
    return __join(out, sep)

def op_chunk(s, n, sep=SEP):
    out = []
    for b in __blocks(s, sep):
        words = [w for w in re.split(r"\s+", b) if w]
        for i in range(0, len(words), n):
            out.append(" ".join(words[i:i+n]))
    return __join(out, sep)

def apply_ops(text, ops, sep=SEP):
    i = 0
    while i < len(ops):
        op = ops[i].lower()
        if op == "pdf":   text = op_pdf(text)
        elif op == "low": text = op_low(text)
        elif op == "punct": text = op_punct(text, sep)
        elif op == "rem": text = op_rem(text, sep)
        elif op == "lines": text = op_lines(text, sep)
        elif op == "line": text = op_line(text, sep)
        elif op == "sent": text = op_sent(text, sep)
        elif op == "chunk":
            if i+1 >= len(ops): raise SystemExit("chunk needs N")
            try: n = int(ops[i+1])
            except: raise SystemExit("chunk N: bad N")
            text = op_chunk(text, n, sep); i += 1
        else:
            raise SystemExit("unknown op: " + op)
        i += 1
    return text

# ---------- helpers ----------

def safe_stem(stem, cap=80):
    bad = '<>:"/\\|?*'
    for c in bad:
        stem = stem.replace(c, "_")
    stem = stem.strip().rstrip(".")
    if len(stem) > cap: stem = stem[:cap].rstrip()
    return stem or "book"

def now_ms(): return int(time.time() * 1000)

def json_load(path):
    if not os.path.isfile(path): return None
    try:
        with io.open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def json_save(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with io.open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)

def slugify_path(rel):
    # rel is like "phil/notes" or "" for top-level
    if not rel: return "readings"
    return rel.replace("/", "_").lower()

def folder_name_for(rel):
    if not rel: return "readings"
    return rel

# ---------- convert ----------

def do_convert(path, recursive):
    path = os.path.abspath(path)
    if not os.path.exists(path):
        print("not found: " + path); return
    os.makedirs(READINGS, exist_ok=True)

    root_dir = path if os.path.isdir(path) else os.path.dirname(path)

    def one(fp):
        rel_dir = os.path.relpath(os.path.dirname(os.path.abspath(fp)), root_dir)
        if rel_dir == ".": rel_dir = ""
        stem = os.path.splitext(os.path.basename(fp))[0]
        safe = safe_stem(stem)
        out_dir = os.path.join(READINGS, rel_dir) if rel_dir else READINGS
        out = os.path.join(out_dir, safe + ".txt")
        if os.path.isfile(out):
            print("skip (exists): " + os.path.relpath(out, HERE)); return
        ext = os.path.splitext(fp)[1].lower()
        fn = converterS.get(ext)
        if not fn:
            print("skip (unsupported): " + fp); return
        print("converting: " + stem)
        try: text = fn(fp)
        except Exception as e:
            print("  FAILED: " + str(e)); return
        if not text.strip():
            print("  FAILED: empty"); return
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
                    if n.lower().endswith(CONVERT_EXTS):
                        one(os.path.join(dirpath, n))
        else:
            for n in sorted(os.listdir(path)):
                full = os.path.join(path, n)
                if os.path.isfile(full) and full.lower().endswith(CONVERT_EXTS):
                    one(full)
    print("done.")

# ---------- folders.md (python side, telegram) ----------

def tg_parse_folders():
    out = []
    if not os.path.isfile(TG_FOLDERS): return out
    try:
        with io.open(TG_FOLDERS, "r", encoding="utf-8") as f:
            txt = f.read()
    except Exception:
        return out
    cur = None
    def flush():
        nonlocal cur
        if cur and cur.get("id"): out.append(cur)
        cur = None
    for raw in txt.replace("\r\n", "\n").split("\n"):
        line = raw.replace("\t", "    ").strip()
        if not line or line.startswith("#") or line == "---": continue
        m = re.match(r"^-\s+id\s*:\s*(.*)$", line)
        if m:
            flush(); cur = {"id": m.group(1).strip().strip("'\"")}; continue
        if cur is None: continue
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$", line)
        if not m: continue
        k, v = m.group(1), m.group(2).strip().strip("'\"")
        cur[k] = v
    flush()
    return out

def tg_write_folders(folders):
    out = ["---", "folders:"]
    for f in folders:
        out.append("  - id: " + f["id"])
        if f.get("slug"): out.append("    slug: " + f["slug"])
        out.append("    name: " + (f.get("name") or f["id"]))
        out.append("    icon: " + (f.get("icon") or "\U0001F4C1"))
        if f.get("color"): out.append("    color: " + f["color"])
    out.append("---")
    os.makedirs(os.path.dirname(TG_FOLDERS), exist_ok=True)
    with io.open(TG_FOLDERS, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")

def tg_find_or_create_folder(slug, name):
    folders = tg_parse_folders()
    for f in folders:
        if f.get("slug") == slug: return f["id"]
    fid = "f" + str(now_ms())
    folders.append({"id": fid, "slug": slug, "name": name, "icon": "\U0001F4C1"})
    tg_write_folders(folders)
    return fid

# ---------- importers ----------

def import_tg(title, text, slug, group_name):
    folder_id = tg_find_or_create_folder(slug, group_name)
    chat_id = "c" + str(now_ms())
    feed = json_load(TG_FEED) or []
    if not isinstance(feed, list): feed = []

    # skip if already there
    for r in feed:
        if r.get("title") == title:
            print("  tg skip (exists): " + title); return

    people = json.loads(json.dumps(DEFAULT_PEOPLE))
    people["other"]["name"] = title
    people["other"]["emoji"] = "\U0001F4D6"
    people["other"]["avatarColor"] = "#2b5278"
    blob = {
        "msgs": [], "people": people,
        "currentPerspective": "own",
        "script": text, "scriptIndex": 0,
        "awaitingText": False, "awaitingBot": False,
        "wpm": 200, "lastSource": "text", "fontSize": 14,
        "autoPlay": None, "bot": DEFAULT_BOT,
    }
    os.makedirs(TG_CHATS, exist_ok=True)
    json_save(os.path.join(TG_CHATS, chat_id + ".json"), blob)
    feed.append({
        "id": chat_id, "title": title,
        "emoji": "\U0001F4D6", "avatarColor": "#2b5278",
        "updatedAt": now_ms(), "preview": "", "lastLen": 0,
        "folderIds": ["all", folder_id],
    })
    json_save(TG_FEED, feed)
    print("  tg chat " + chat_id + " (" + title + ") -> folder " + group_name)


def import_ds(title, text, slug, group_name):
    feed = json_load(DS_FEED) or []
    if not isinstance(feed, list): feed = []

    chat_id = None
    for r in feed:
        if r.get("slug") == slug: chat_id = r.get("id"); break

    if not chat_id:
        chat_id = "chat_" + str(now_ms())
        feed.append({
            "id": chat_id,
            "name": group_name,
            "slug": slug,
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        })
        json_save(DS_FEED, feed)

    blob_path = os.path.join(DS_CHATS, chat_id + ".json")
    blob = json_load(blob_path) or {"messages": [], "personas": [], "activePersonaId": None}
    personas = blob.get("personas") or []

    for p in personas:
        if p.get("name") == title:
            print("  ds skip (exists): " + title); return

    personas.append({
        "id": "p" + str(now_ms()),
        "name": title,
        "color": "#5865f2",
        "symbol": "\U0001F4D6",
        "type": "speaker",
        "script": text,
        "scriptPos": 0,
    })
    blob["personas"] = personas
    os.makedirs(DS_CHATS, exist_ok=True)
    json_save(blob_path, blob)
    print("  ds persona in " + chat_id + " (" + title + ") -> channel " + group_name)


def import_st(title, text, slug, group_name):
    pl_index = json_load(ST_PL_INDEX) or []
    if not isinstance(pl_index, list): pl_index = []

    pid = None
    for p in pl_index:
        if p.get("slug") == slug: pid = p.get("id"); break

    if not pid:
        pid = "pl" + str(now_ms())
        pl_index.append({
            "id": pid, "name": group_name, "slug": slug,
            "updatedAt": now_ms(),
        })
        json_save(ST_PL_INDEX, pl_index)

    blob_path = os.path.join(ST_PL_DIR, pid + ".json")
    blob = json_load(blob_path) or {"id": pid, "name": group_name, "slug": slug, "items": [], "updatedAt": now_ms()}
    items = blob.get("items") or []

    for it in items:
        if it.get("title") == title:
            print("  st skip (exists): " + title); return

    items.append({
        "id": "s" + str(now_ms()),
        "title": title,
        "text": text,
        "updatedAt": now_ms(),
    })
    blob["items"] = items
    blob["updatedAt"] = now_ms()
    os.makedirs(ST_PL_DIR, exist_ok=True)
    json_save(blob_path, blob)
    print("  st item (" + title + ") -> playlist " + group_name)


# ---------- walk readings tree ----------

def walk_readings():
    if not os.path.isdir(READINGS): return []
    out = []
    for dirpath, _dirs, files in os.walk(READINGS):
        for n in sorted(files):
            if not n.lower().endswith(".txt"): continue
            full = os.path.join(dirpath, n)
            rel_dir = os.path.relpath(dirpath, READINGS)
            if rel_dir == ".": rel_dir = ""
            rel_dir = rel_dir.replace("\\", "/")
            out.append((full, rel_dir))
    return out

def do_import(app, chat_ops):
    if not app:
        print("need --app tg|ds|st"); return
    entries = walk_readings()
    if not entries:
        print("no .txt files under " + READINGS); return

    for full, rel_dir in entries:
        title = os.path.splitext(os.path.basename(full))[0]
        group_name = folder_name_for(rel_dir)
        slug = slugify_path(rel_dir)

        text = ""
        with io.open(full, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()
        if not text.strip():
            print("empty reading: " + full); continue

        if chat_ops:
            sep = "\n---\n" if app == "tg" else "\n\n"
            try: text = apply_ops(text, chat_ops, sep)
            except SystemExit as e:
                print("FAILED (chat ops): " + str(e)); continue

        if   app == "tg": import_tg(title, text, slug, group_name)
        elif app == "ds": import_ds(title, text, slug, group_name)
        elif app == "st": import_st(title, text, slug, group_name)
        else:
            print("unknown app: " + app); return
    print("done.")


# ---------- main ----------

def main():
    argv = sys.argv[1:]
    if not argv:
        print("usage:")
        print('  python code/readings.py convert <path> [--recursive]')
        print('  python code/readings.py import --app tg|ds|st [--chat "pdf low punct"]')
        sys.exit(1)

    verb = argv[0]; argv = argv[1:]
    recursive = False; chat_ops = []; app = None; target = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--recursive":
            recursive = True; i += 1
        elif a == "--chat":
            if i+1 >= len(argv): print("--chat needs a value"); sys.exit(1)
            chat_ops = argv[i+1].split(); i += 2
        elif a == "--app":
            if i+1 >= len(argv): print("--app needs a value"); sys.exit(1)
            app = argv[i+1].lower(); i += 2
        else:
            target = a; i += 1

    if verb == "convert":
        if not target: print("usage: convert <path> [--recursive]"); sys.exit(1)
        do_convert(target, recursive)
    elif verb == "import":
        do_import(app, chat_ops)
    else:
        print("unknown verb: " + verb); sys.exit(1)


if __name__ == "__main__":
    main()
