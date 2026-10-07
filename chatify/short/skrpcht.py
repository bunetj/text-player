# skrpcht — cyrillic shorthand.
# dict + syllable rules. Loads ru.tsv next to this file.
#
#   matches(word)  -> True if word has a Cyrillic letter
#   shorten(word)  -> shorthand form (dict hit, else rule)

import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
DICT_PATH = os.path.join(HERE, "ru.tsv")

RU_VOWELS = set("аеёиоуыэюяАЕЁИОУЫЭЮЯ")

_ENTRIES = []   # ("exact", key, short) | ("re", compiled, short)


def _load():
    global _ENTRIES
    _ENTRIES = []
    if not os.path.isfile(DICT_PATH):
        return
    with open(DICT_PATH, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line or "\t" not in line:
                continue
            short, full = line.split("\t", 1)
            short = short.strip()
            full = full.strip()
            if full.startswith("re:"):
                try:
                    _ENTRIES.append(("re", re.compile(full[3:]), short))
                except re.error:
                    pass
            else:
                _ENTRIES.append(("exact", full.lower(), short))


_load()


def matches(word):
    return bool(re.search(r"[А-Яа-яЁё]", word))


def _lookup(word):
    low = word.lower()
    for kind, key, short in _ENTRIES:
        if kind == "exact" and key == low:
            return short
    for kind, pat, short in _ENTRIES:
        if kind == "re" and pat.search(low):
            return pat.sub(short, low)
    return None


def _is_vowel(ch):
    return ch in RU_VOWELS


def _split_syllables(word):
    syls = []
    cur = ""
    i = 0
    n = len(word)
    while i < n:
        while i < n and not _is_vowel(word[i]):
            cur += word[i]; i += 1
        if i < n and _is_vowel(word[i]):
            while i < n and _is_vowel(word[i]):
                cur += word[i]; i += 1
            while i < n and not _is_vowel(word[i]):
                j = i
                while j < n and not _is_vowel(word[j]):
                    j += 1
                if j < n:
                    cons = word[i:j]
                    if len(cons) > 1:
                        cur += cons[:-1]
                        i = j - 1
                    break
                else:
                    cur += word[i:j]; i = j
            syls.append(cur); cur = ""
        else:
            if cur:
                syls.append(cur); cur = ""
    if cur:
        syls.append(cur)
    return syls


def _middle_reduce(s):
    return "".join(ch for ch in s if not _is_vowel(ch))


def _rule(word):
    if len(word) <= 4:
        return word
    syls = _split_syllables(word)
    if len(syls) <= 2:
        return word
    first = syls[0]
    last = syls[-1]
    middle = _middle_reduce("".join(syls[1:-1]))
    return first + middle + last


def shorten(word):
    hit = _lookup(word)
    if hit is not None:
        return hit
    return _rule(word)


def collisions():
    exact = {}
    for kind, key, short in _ENTRIES:
        if kind == "exact":
            exact.setdefault(key, []).append(short)
    return {k: v for k, v in exact.items() if len(v) > 1}
