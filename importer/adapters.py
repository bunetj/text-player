# adapters.py
# Target adapters. Each takes (title, text, slug, group_name) and writes
# to its app's data folder. text is the joined block string.

import io
import json
import os
import time

HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(HERE)

TG_DATA   = os.path.join(_ROOT, "data", "telegram")
TG_CHATS  = os.path.join(TG_DATA, "chats")
TG_FEED   = os.path.join(TG_DATA, "feed.json")
TG_FOLDERS = os.path.join(TG_DATA, "folders.md")

DS_DATA   = os.path.join(_ROOT, "data", "discord")
DS_CHATS  = os.path.join(DS_DATA, "chats")
DS_FEED   = os.path.join(DS_DATA, "feed.json")

ST_DATA   = os.path.join(_ROOT, "data", "subtitles")
ST_PL_INDEX = os.path.join(ST_DATA, "playlists.json")
ST_PL_DIR   = os.path.join(ST_DATA, "playlists")


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


def now_ms():
    return int(time.time() * 1000)


def json_load(path):
    if not os.path.isfile(path):
        return None
    try:
        with io.open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def json_save(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with io.open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)


# ---------- tg folders.md ----------

def tg_parse_folders():
    out = []
    if not os.path.isfile(TG_FOLDERS):
        return out
    try:
        with io.open(TG_FOLDERS, "r", encoding="utf-8") as f:
            txt = f.read()
    except Exception:
        return out
    import re
    cur = None
    def flush():
        nonlocal cur
        if cur and cur.get("id"):
            out.append(cur)
        cur = None
    for raw in txt.replace("\r\n", "\n").split("\n"):
        line = raw.replace("\t", "    ").strip()
        if not line or line.startswith("#") or line == "---":
            continue
        m = re.match(r"^-\s+id\s*:\s*(.*)$", line)
        if m:
            flush(); cur = {"id": m.group(1).strip().strip("'\"")}; continue
        if cur is None:
            continue
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$", line)
        if not m:
            continue
        k, v = m.group(1), m.group(2).strip().strip("'\"")
        cur[k] = v
    flush()
    return out


def tg_write_folders(folders):
    out = ["---", "folders:"]
    for f in folders:
        out.append("  - id: " + f["id"])
        if f.get("slug"):
            out.append("    slug: " + f["slug"])
        out.append("    name: " + (f.get("name") or f["id"]))
        out.append("    icon: " + (f.get("icon") or "\U0001F4C1"))
        if f.get("color"):
            out.append("    color: " + f["color"])
    out.append("---")
    os.makedirs(os.path.dirname(TG_FOLDERS), exist_ok=True)
    with io.open(TG_FOLDERS, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")


def tg_find_or_create_folder(slug, name):
    folders = tg_parse_folders()
    for f in folders:
        if f.get("slug") == slug:
            return f["id"]
    fid = "f" + str(now_ms())
    folders.append({"id": fid, "slug": slug, "name": name, "icon": "\U0001F4C1"})
    tg_write_folders(folders)
    return fid


# ---------- shared import path ----------

class _GroupSpec:
    def __init__(self, name, index_path, blob_dir, group_kind, item_kind,
                 make_group, make_item):
        self.name       = name
        self.index_path = index_path
        self.blob_dir   = blob_dir
        self.group_kind = group_kind
        self.item_kind  = item_kind
        self.make_group = make_group
        self.make_item  = make_item


def _import_generic(spec, title, text, slug, group_name,
                    index, find_group, get_items, set_items, blob_path_for):
    group = find_group(index, slug)
    if group:
        gid = group.get("id")
        blob = json_load(blob_path_for(gid)) or {
            "id": gid, "name": group_name, "slug": slug,
            "items": [], "updatedAt": now_ms()
        }
    else:
        gid = spec.name + "_" + str(now_ms())
        index.append(spec.make_group(gid, slug, group_name))
        os.makedirs(spec.blob_dir, exist_ok=True)
        json_save(spec.index_path, index)
        blob = {"id": gid, "name": group_name, "slug": slug,
                "items": [], "updatedAt": now_ms()}

    items = get_items(blob) or []
    for it in items:
        if it.get("title") == title:
            print("  " + spec.name + " skip (exists): " + title)
            return
    items.append(spec.make_item(title, text))
    set_items(blob, items)
    blob["updatedAt"] = now_ms()
    os.makedirs(spec.blob_dir, exist_ok=True)
    json_save(blob_path_for(gid), blob)
    print("  " + spec.name + " " + spec.item_kind + " (" + title +
          ") -> " + spec.group_kind + " " + group_name)


# ---------- tg ----------

def import_tg(title, text, slug, group_name):
    feed = json_load(TG_FEED) or []
    if not isinstance(feed, list):
        feed = []
    for r in feed:
        if r.get("title") == title:
            print("  tg skip (exists): " + title); return
    folder_id = tg_find_or_create_folder(slug, group_name)
    chat_id = "c" + str(now_ms())
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


# ---------- ds ----------

def import_ds(title, text, slug, group_name):
    def find_group(idx, s):
        for r in idx:
            if r.get("slug") == s:
                return r
        return None
    def make_group(gid, s, gn):
        return {"id": gid, "name": gn, "slug": s,
                "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S")}
    def make_item(t, body):
        return {"id": "p" + str(now_ms()), "name": t,
                "color": "#5865f2", "symbol": "\U0001F4D6",
                "type": "speaker", "script": body, "scriptPos": 0}
    def get_items(blob): return blob.get("personas")
    def set_items(blob, items): blob["personas"] = items
    def blob_path_for(gid): return os.path.join(DS_CHATS, gid + ".json")

    spec = _GroupSpec(
        name="ds", index_path=DS_FEED, blob_dir=DS_CHATS,
        group_kind="channel", item_kind="persona",
        make_group=make_group, make_item=make_item,
    )
    index = json_load(DS_FEED) or []
    if not isinstance(index, list):
        index = []
    _import_generic(spec, title, text, slug, group_name,
                    index, find_group, get_items, set_items, blob_path_for)


# ---------- st ----------

def import_st(title, text, slug, group_name):
    def find_group(idx, s):
        for r in idx:
            if r.get("slug") == s:
                return r
        return None
    def make_group(gid, s, gn):
        return {"id": gid, "name": gn, "slug": s, "updatedAt": now_ms()}
    def make_item(t, body):
        return {"id": "s" + str(now_ms()), "title": t,
                "text": body, "updatedAt": now_ms()}
    def get_items(blob): return blob.get("items")
    def set_items(blob, items): blob["items"] = items
    def blob_path_for(gid): return os.path.join(ST_PL_DIR, gid + ".json")

    spec = _GroupSpec(
        name="st", index_path=ST_PL_INDEX, blob_dir=ST_PL_DIR,
        group_kind="playlist", item_kind="item",
        make_group=make_group, make_item=make_item,
    )
    index = json_load(ST_PL_INDEX) or []
    if not isinstance(index, list):
        index = []
    _import_generic(spec, title, text, slug, group_name,
                    index, find_group, get_items, set_items, blob_path_for)


ADAPTERS = {
    "tg": import_tg,
    "ds": import_ds,
    "st": import_st,
}
