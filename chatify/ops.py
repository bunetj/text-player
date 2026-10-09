# ops.py
# Pure text ops on lists of blocks. No separator inside.
# The caller splits and joins.

import os
import random
import re
import unicodedata


from chatify.typo import make_typos, preset


# ---------- short ----------
# Dispatches by script: skrpcht for Cyrillic, bref for Latin.
# Each tool is its own module under chatify/short/.

from chatify.short import skrpcht, bref

SHORT_WORD_RE = re.compile(r"[А-Яа-яЁёA-Za-z0-9]+")


def _short_text(s):
    def rep(m):
        t = m.group(0)
        if skrpcht.matches(t):
            return skrpcht.shorten(t)
        if bref.matches(t):
            return bref.shorten(t)
        return t
    return SHORT_WORD_RE.sub(rep, s)


def short_collisions():
    """Return (cyr_dupes, lat_dupes)."""
    return skrpcht.collisions(), bref.collisions()


def op_short(blocks):
    return [_short_text(b) for b in blocks]


def op_typo(blocks, args):
    if not args:
        raise SystemExit("typo needs a level 0..10")
    try:
        drunk = int(args[0])
    except ValueError:
        raise SystemExit("typo N: bad N")
    if drunk not in range(11):
        raise SystemExit("typo N: 0..10 only")
    rng = random.Random(0)
    opts = preset(drunk)
    return [make_typos(b, rng, opts) for b in blocks]


def op_pdf(blocks):
    out = []
    for b in blocks:
        paras = re.split(r"\n\s*\n", b)
        for para in paras:
            lines = para.split("\n"); buf = ""
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
    return out


def normalize_quotes(s):
    out = s
    for ch in "\u201c\u201d\u201e\u201f\u00ab\u00bb\u2039\u203a":
        out = out.replace(ch, '"')
    for ch in "\u2018\u2019\u201a\u201b\u2032\u02bc\u02b9":
        out = out.replace(ch, "'")
    return out


def _is_all_caps_alpha(word):
    latin = "".join(c for c in word if ("a" <= c <= "z") or ("A" <= c <= "Z"))
    cyr   = "".join(c for c in word if "\u0400" <= c <= "\u04ff")
    if len(latin) >= 2 and latin == latin.upper():
        return True
    if len(cyr) >= 2 and cyr == cyr.upper():
        return True
    return False


def to_lower_smart(s):
    s = normalize_quotes(s)
    parts = re.split(r"(\s+)", s)
    out = []
    for p in parts:
        if not re.search(r"[A-Za-z\u0400-\u04ff]", p):
            out.append(p); continue
        if _is_all_caps_alpha(p):
            out.append(p); continue
        out.append(p.lower())
    return "".join(out)


def op_low(blocks):
    return [to_lower_smart(b) for b in blocks]


PUNCT_SPLIT = ".!?;:,"


def _strip_trailing_punct(s):
    return re.sub(r"[.!?;:,]+$", "", s)


def op_punct(blocks):
    out = []
    for b in blocks:
        buf = ""; i = 0; n = len(b)
        while i < n:
            ch = b[i]
            if ch in PUNCT_SPLIT:
                prev = b[i-1] if i > 0 else ""
                nxt  = b[i+1] if i+1 < n else ""
                if prev.isalpha() and nxt.isalpha():
                    buf += ch; i += 1; continue
                buf += ch
                t = _strip_trailing_punct(buf.strip())
                if t: out.append(t)
                buf = ""
                while i+1 < n and b[i+1].isspace(): i += 1
            else:
                buf += ch
            i += 1
        t = _strip_trailing_punct(buf.strip())
        if t: out.append(t)
    return out


def remove_punctuation(s):
    out = []
    for i, ch in enumerate(s):
        if unicodedata.category(ch).startswith("P"):
            prev = s[i-1] if i > 0 else ""
            nxt  = s[i+1] if i+1 < len(s) else ""
            if prev.isalpha() and nxt.isalpha():
                out.append(ch)
        else:
            out.append(ch)
    return "".join(out)


def op_rem(blocks):
    out = []
    for b in blocks:
        t = remove_punctuation(b).strip()
        if t: out.append(t)
    return out


def op_lines(blocks):
    out = []
    for b in blocks:
        for p in re.split(r"\n+", b):
            p = p.strip()
            if p: out.append(p)
    return out


def op_line(blocks):
    return [" ".join(b.strip() for b in blocks if b.strip())]


def split_sentences(text):
    return [p for p in re.split(r'(?<=[\.\!\?\u2026])\s+', text) if p]


def op_sent(blocks):
    out = []
    for b in blocks:
        for piece in split_sentences(b):
            piece = piece.strip()
            if piece: out.append(piece)
    return out


def op_chunk(blocks, n):
    out = []
    for b in blocks:
        words = [w for w in re.split(r"\s+", b) if w]
        for i in range(0, len(words), n):
            out.append(" ".join(words[i:i+n]))
    return out


def apply_ops(blocks, ops):
    blocks = list(blocks)
    i = 0
    while i < len(ops):
        op = ops[i].lower()
        if op == "pdf":   blocks = op_pdf(blocks)
        elif op == "short": blocks = op_short(blocks)
        elif op == "typo":
            if i+1 >= len(ops): raise SystemExit("typo needs N")
            blocks = op_typo(blocks, ops[i+1:i+2]); i += 1
        elif op == "low": blocks = op_low(blocks)
        elif op == "punct": blocks = op_punct(blocks)
        elif op == "rem": blocks = op_rem(blocks)
        elif op == "lines": blocks = op_lines(blocks)
        elif op == "line": blocks = op_line(blocks)
        elif op == "sent": blocks = op_sent(blocks)
        elif op == "chunk":
            if i+1 >= len(ops): raise SystemExit("chunk needs N")
            try: n = int(ops[i+1])
            except: raise SystemExit("chunk N: bad N")
            blocks = op_chunk(blocks, n); i += 1
        else:
            raise SystemExit("unknown op: " + op)
        i += 1
    return blocks


def _cli():
    import sys
    args = sys.argv[1:]
    if args and args[0] == "collisions":
        d, _ = short_collisions()
        if not d:
            print("no collisions.")
            return
        for word, shorts in sorted(d.items()):
            print("%s <- %s" % (word, shorts))
        return
    print("usage: python ops.py collisions")


if __name__ == "__main__":
    _cli()
