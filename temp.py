# code/temp.py
from pathlib import Path

OLD = "'Segoe UI', 'Segoe UI Emoji',"
NEW = "'Segoe UI Emoji', 'Segoe UI',"

FILES = ["index.html","subtitles/index.html","led/index.html",
         "shared/modal.css","shared/telegram.css","discord/index.html"]

for base in [Path(__file__).resolve().parent,
             Path(r"C:\Portable Apps\text player")]:
    if not base.exists():
        print("skip", base); continue
    for rel in FILES:
        p = base / rel
        if not p.exists(): continue
        txt = p.read_text(encoding="utf-8")
        n = txt.count(OLD)
        if not n:
            print("%-24s %s  no anchor" % (base.name, rel)); continue
        p.write_text(txt.replace(OLD, NEW), encoding="utf-8")
        print("%-24s %s  swapped" % (base.name, rel))