# code/format.py
# Plain text formatter. Standalone: no app, no server, no imports from
# the rest of the repo.
#
#   python code/format.py <path> --chat "pdf low punct" [--sep blank|newline]
#
#       File   -> writes <stem>_chat.txt beside it.
#       Folder -> writes a mirrored <name>_chat/ next to the folder,
#                 with every inner .txt formatted into a matching
#                 _chat.txt.
#
#       --chat  space-separated list of ops, applied left to right:
#                 pdf   reassemble PDF-wrapped lines
#                 low   lowercase, straighten curly quotes
#                 punct split on punctuation, keep the punctuation
#                 rem   remove punctuation only
#                 lines split on newlines
#                 line  collapse everything to one line
#                 sent  split on sentence endings
#                 chunk N  split into blocks of N words
#
#       --sep blank    (default)  \n\n between blocks
#       --sep newline             \n  between blocks
#
# Source files are never modified.

import io
import os
import re
import shutil
import sys
import unicodedata

# Block separator used by apply_ops when the caller doesn't pick one.
# This file's ops never emit ---; that string belongs to the telegram
# importer, which passes its own sep.
SEP = "\n\n"


# ---------- op helpers ----------

def __blocks(s, sep=SEP):
    return [b.strip() for b in s.split(sep) if b.strip()]


def __join(arr, sep=SEP):
    return sep.join(arr)


# ---------- ops ----------

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


# ---------- file / folder driver ----------

SEP_CHOICES = {
    "blank":   "\n\n",
    "newline": "\n",
}


def _format_one(src, chat_ops, sep):
    """Format one .txt. Returns (ok, out_path_or_err)."""
    with io.open(src, "r", encoding="utf-8", errors="replace") as f:
        text = f.read()
    try:
        text = apply_ops(text, chat_ops, sep)
    except SystemExit as e:
        return False, str(e)
    stem, ext = os.path.splitext(src)
    out = stem + "_chat" + ext
    with io.open(out, "w", encoding="utf-8") as f:
        f.write(text)
    return True, out


def do_format(src, chat_ops, sep_name):
    """Format a file or a folder.

    File: writes <stem>_chat.txt beside it.
    Folder: writes a mirrored <foldername>_chat/ next to the folder,
            containing _chat.txt versions of every .txt inside it.

    sep_name is 'blank' or 'newline'. No --- is ever emitted."""
    if not src:
        print("usage: format <path> --chat \"...\" [--sep blank|newline]"); return
    if not chat_ops:
        print('format needs --chat "..."'); return

    sep_name = (sep_name or "blank").lower()
    if sep_name not in SEP_CHOICES:
        print("unknown --sep: " + sep_name + "  (use blank | newline)"); return
    sep = SEP_CHOICES[sep_name]

    src = os.path.abspath(src)
    if not os.path.exists(src):
        print("not found: " + src); return

    if os.path.isfile(src):
        ok, res = _format_one(src, chat_ops, sep)
        if not ok:
            print("FAILED (chat ops): " + res); return
        print("wrote " + res)
        return

    parent = os.path.dirname(src)
    name   = os.path.basename(src)
    out_root = os.path.join(parent, name + "_chat")
    os.makedirs(out_root, exist_ok=True)

    n_ok = 0
    n_fail = 0
    for dirpath, _dirs, files in os.walk(src):
        rel = os.path.relpath(dirpath, src)
        if rel == ".": rel = ""
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


# ---------- split ----------

MARKER_RE = re.compile(r"<<<(.+?)>>>")


def _safe_name(s, cap=80):
    s = (s or "").strip()
    for c in '<>:"/\\|?*':
        s = s.replace(c, "_")
    s = s.strip().rstrip(".")
    if len(s) > cap:
        s = s[:cap].rstrip()
    return s or "chunk"


def _html_text(s):
    return (str(s or "")
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;"))


def _html_attr(s):
    return (str(s or "")
            .replace("&", "&amp;")
            .replace('"', "&quot;")
            .replace("<", "&lt;")
            .replace(">", "&gt;"))


def _split_one(src, out_root):
    """Split one .txt on <<<marker>>> occurrences, anywhere in the text.

    Only the <<< and >>> signs are removed from the chunk content;
    everything else (marker text, trailing text, body) stays in order.
    Text before the first marker is skipped.

    Writes one .txt per chunk plus index.html into out_root.
    Returns (ok, n_chunks, err).
    """
    with io.open(src, "r", encoding="utf-8", errors="replace") as f:
        text = f.read()

    matches = list(MARKER_RE.finditer(text))
    if not matches:
        return False, 0, "no <<<marker>>> found"

    os.makedirs(out_root, exist_ok=True)

    items = []
    seen = {}

    for idx, m in enumerate(matches):
        label = m.group(1).strip()
        start = m.start()
        end   = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        raw   = text[start:end]
        chunk = raw.replace("<<<", "").replace(">>>", "")
        chunk = chunk.rstrip("\n") + "\n"

        base = _safe_name(label)
        seen[base] = seen.get(base, 0) + 1
        fname = base + ".txt" if seen[base] == 1 else "%s-%d.txt" % (base, seen[base])
        out_path = os.path.join(out_root, fname)
        with io.open(out_path, "w", encoding="utf-8") as f:
            f.write(chunk)
        items.append((label, fname))

    lines = ['<!DOCTYPE html>', '<html>', '<head>', '<meta charset="UTF-8">',
             '<title>index</title>', '</head>', '<body>']
    for label, fname in items:
        lines.append('<a href="%s">%s</a><br>' % (_html_attr(fname), _html_text(label)))
    lines.append('</body>')
    lines.append('</html>')
    with io.open(os.path.join(out_root, "index.html"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    return True, len(items), None


def do_split(src):
    """Split a file or a folder on <<<marker>>> occurrences.

    File   -> <parent>/<stem>_split/, with one .txt per chunk + index.html.
    Folder -> <parent>/<name>_split/, mirroring subfolders; each .txt
              gets its own <stem>/ subfolder with its chunks.
    """
    if not src:
        print("usage: split <path>"); return

    src = os.path.abspath(src)
    if not os.path.exists(src):
        print("not found: " + src); return

    if os.path.isfile(src):
        parent = os.path.dirname(src)
        stem, _ext = os.path.splitext(os.path.basename(src))
        out_root = os.path.join(parent, stem + "_split")
        ok, n, err = _split_one(src, out_root)
        if not ok:
            print("FAILED: " + err); return
        print("wrote %d chunk(s) -> %s" % (n, out_root))
        return

    parent = os.path.dirname(src)
    name   = os.path.basename(src)
    root   = os.path.join(parent, name + "_split")
    os.makedirs(root, exist_ok=True)

    total = 0
    fails = 0
    for dirpath, _dirs, files in os.walk(src):
        rel = os.path.relpath(dirpath, src)
        if rel == ".": rel = ""
        for fn in sorted(files):
            if not fn.lower().endswith(".txt"):
                continue
            stem, _ext = os.path.splitext(fn)
            sub_root = os.path.join(root, rel, stem) if rel else os.path.join(root, stem)
            ok, n, err = _split_one(os.path.join(dirpath, fn), sub_root)
            if ok:
                total += n
                print("  %s -> %d chunk(s)" % (fn, n))
            else:
                fails += 1
                print("  %s: %s" % (fn, err))

    print("wrote %d chunk(s) under %s" % (total, root))
    if fails:
        print("failed: %d file(s)" % fails)


# ---------- main ----------

def main():
    argv = sys.argv[1:]
    if not argv:
        print("usage:")
        print('  python code/format.py <path> --chat "pdf low punct" [--sep blank|newline]')
        print('  python code/format.py split <path>')
        sys.exit(1)

    verb = "format"
    if argv[0] == "split":
        verb = "split"
        argv = argv[1:]

    chat_ops = []; sep_name = None; target = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--chat":
            if i+1 >= len(argv): print("--chat needs a value"); sys.exit(1)
            chat_ops = argv[i+1].split(); i += 2
        elif a == "--sep":
            if i+1 >= len(argv): print("--sep needs a value (blank | newline)"); sys.exit(1)
            sep_name = argv[i+1].lower(); i += 2
        else:
            target = a; i += 1

    if verb == "split":
        do_split(target)
    else:
        do_format(target, chat_ops, sep_name)


if __name__ == "__main__":
    main()