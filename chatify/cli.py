# cli.py
# chatify - convert plain text to chat style

import io
import os
import shutil
import sys

from chatify.ops import apply_ops

SEP_CHOICES = {
    "blank":   "\n\n",
    "newline": "\n",
    "none":    None,
}


def _extract_sep(ops, default_name):
    """If ops contains ["sep", X], return (ops_without_sep, X).
    Otherwise return (ops, default_name)."""
    out = []
    name = default_name
    i = 0
    while i < len(ops):
        if ops[i].lower() == "sep" and i + 1 < len(ops):
            name = ops[i+1].lower()
            i += 2
        else:
            out.append(ops[i])
            i += 1
    return out, name



def _split(text, sep):
    if sep is None:
        return [text]
    return [b.strip() for b in text.split(sep) if b.strip()]


def _join(blocks, sep):
    if sep is None:
        return "".join(blocks)
    return sep.join(blocks)


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
        print("usage: format <path> --chat \"...\" [--sep blank|newline|none]"); return
    if not chat_ops:
        print('format needs --chat "..."'); return

    chat_ops, sep_name = _extract_sep(chat_ops, sep_name)
    sep_name = (sep_name or "none").lower()
    if sep_name not in SEP_CHOICES:
        print("unknown --sep: " + sep_name + "  (use blank | newline | none)"); return
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


def main():
    argv = sys.argv[1:]
    if argv and argv[0] in ("-h", "--help", "help"):
        print("usage: python chatify/cli.py <path> --chat \"pdf low punct sep blank\"")
        print("")
        print("ops")
        print("  pdf         reassemble PDF-wrapped lines")
        print("  low         lowercase")
        print("  punct       split on punctuation")
        print("  rem         remove punctuation")
        print("  lines       split on newlines")
        print("  line        collapse to one line")
        print("  sent        split on sentence endings")
        print("  chunk N     split into blocks of N words")
        print("  short       shorthand (en, ru)")
        print("  typo N      insert typos, N = drunkness 0..10")
        print("  sep X       blank | newline | none (default none)")
        return
    if not argv:
        print("usage:")
        print('  python chatify/cli.py <path> --chat "pdf low punct rem" [--sep newline|blank|none]')
        sys.exit(1)
    chat_ops = []; sep_name = None; target = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--chat":
            if i+1 >= len(argv): print("--chat needs a value"); sys.exit(1)
            chat_ops = argv[i+1].split(); i += 2
        elif a == "--sep":
            if i+1 >= len(argv): print("--sep needs a value (blank | newline | none)"); sys.exit(1)
            sep_name = argv[i+1].lower(); i += 2
        else:
            target = a; i += 1
    do_format(target, chat_ops, sep_name)


if __name__ == "__main__":
    main()
