# Based on Bref-Shorthand-Converter by i0Z3R0
# https://github.com/i0Z3R0/Bref-Shorthand-Converter
# MIT License
#
# bref — latin shorthand.
# dict lookup only. Loads en.csv next to this file.
#
#   matches(word)  -> True if word has a Latin letter
#   shorten(word)  -> shorthand form, or word unchanged if not in dict

import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
DICT_PATH = os.path.join(HERE, "en.csv")

_MAP = {}


def _load():
    global _MAP
    _MAP = {}
    if not os.path.isfile(DICT_PATH):
        return
    with open(DICT_PATH, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line or "," not in line:
                continue
            short, full = line.split(",", 1)
            short = short.strip()
            full = full.strip()
            if full:
                _MAP[full.lower()] = short


_load()


def matches(word):
    return bool(re.search(r"[A-Za-z]", word))


def shorten(word):
    low = word.lower()
    if low in _MAP:
        return _MAP[low]
    return word


def collisions():
    seen = {}
    for full, short in _MAP.items():
        seen.setdefault(short, []).append(full)
    return {k: v for k, v in seen.items() if len(v) > 1}
