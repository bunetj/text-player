# driver.py
# Loop over readings/ (or a single file), apply chat ops, hand blocks to an adapter.

import io
import os
import sys

import adapters

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
sys.path.insert(0, os.path.join(_ROOT, "chatify"))
from ops import apply_ops  # noqa: E402

READINGS = os.path.join(_ROOT, "readings")
SEP = "\n---\n"


def slugify_path(rel):
    if not rel:
        return "readings"
    return rel.replace("/", "_").lower()


def folder_name_for(rel):
    if not rel:
        return "readings"
    return rel


def walk_readings():
    if not os.path.isdir(READINGS):
        return []
    out = []
    for dirpath, _dirs, files in os.walk(READINGS):
        for n in sorted(files):
            if not n.lower().endswith(".txt"):
                continue
            full = os.path.join(dirpath, n)
            rel_dir = os.path.relpath(dirpath, READINGS)
            if rel_dir == ".":
                rel_dir = ""
            rel_dir = rel_dir.replace("\\", "/")
            out.append((full, rel_dir))
    return out


def _apply(text, chat_ops):
    if not chat_ops:
        return text
    blocks = [b.strip() for b in text.split(SEP) if b.strip()]
    blocks = apply_ops(blocks, chat_ops)
    return SEP.join(blocks)


def _import_one(app, full, rel_dir, chat_ops):
    title = os.path.splitext(os.path.basename(full))[0]
    group_name = folder_name_for(rel_dir)
    slug = slugify_path(rel_dir)

    with io.open(full, "r", encoding="utf-8", errors="replace") as f:
        text = f.read()
    if not text.strip():
        print("empty: " + full)
        return
    try:
        text = _apply(text, chat_ops)
    except SystemExit as e:
        print("FAILED (chat ops): " + str(e))
        return
    adapters.ADAPTERS[app](title, text, slug, group_name)


def do_import(app, chat_ops):
    if not app:
        print("need --app tg|ds|st"); return
    if app not in adapters.ADAPTERS:
        print("unknown app: " + app); return
    entries = walk_readings()
    if not entries:
        print("no .txt files under " + READINGS); return
    for full, rel_dir in entries:
        _import_one(app, full, rel_dir, chat_ops)
    print("done.")


def do_import_files(app, files, chat_ops):
    if not app:
        print("need --app tg|ds|st"); return
    if app not in adapters.ADAPTERS:
        print("unknown app: " + app); return
    if not files:
        print("no files given"); return
    for full in files:
        full = os.path.abspath(full)
        if not os.path.isfile(full):
            print("not found: " + full); continue
        rel_dir = os.path.relpath(os.path.dirname(full), READINGS)
        if rel_dir == ".":
            rel_dir = ""
        rel_dir = rel_dir.replace("\\", "/")
        _import_one(app, full, rel_dir, chat_ops)
    print("done.")
