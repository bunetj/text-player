# typos.py — one knob: --drunk 0..10. Space typos included in common pool.

import argparse
import random
import re
import sys

LATIN = "abcdefghijklmnopqrstuvwxyz0123456789"
CYR   = "абвгдеёжзийклмнопрстуфхцчшщъыьэюя0123456789"
VOWELS_EN = set("aeiouy")
VOWELS_RU = set("аеёиоуыэюя")

QWERTY = {
    'q': 'wa', 'w': 'qeas', 'e': 'wrsd', 'r': 'etdf', 't': 'ryfg',
    'y': 'tugh', 'u': 'yihj', 'i': 'uojk', 'o': 'ipkl', 'p': 'ol',
    'a': 'qwsz', 's': 'awedxz', 'd': 'serfcx', 'f': 'drtgvc', 'g': 'ftyhbv',
    'h': 'gyujnb', 'j': 'huikm', 'k': 'jiol', 'l': 'kop',
    'z': 'asx', 'x': 'zsdc', 'c': 'xdfv', 'v': 'cfgb', 'b': 'vghn',
    'n': 'bhjm', 'm': 'njk',
    '1': '2', '2': '13', '3': '24', '4': '35', '5': '46',
    '6': '57', '7': '68', '8': '79', '9': '80', '0': '9',
}
YTS = {
    'й': 'цук', 'ц': 'йуке', 'у': 'цке', 'к': 'уен', 'е': 'кнг', 'н': 'егш',
    'г': 'ншщ', 'ш': 'гщз', 'щ': 'шзх', 'з': 'щхъ', 'х': 'зъ', 'ъ': 'х',
    'ф': 'ыва', 'ы': 'фвал', 'в': 'ыапр', 'а': 'впр', 'п': 'аро', 'р': 'пол',
    'о': 'рлд', 'л': 'одж', 'д': 'лжэ', 'ж': 'дэ', 'э': 'ж',
    'я': 'чс', 'ч': 'ясм', 'с': 'чми', 'м': 'сит', 'и': 'мть', 'т': 'иьб',
    'ь': 'тбю', 'б': 'ью', 'ю': 'б',
}


def _script(word):
    if re.search(r"[А-Яа-яЁё]", word):
        return "ru"
    return "en"


def _layout(word):
    return YTS if _script(word) == "ru" else QWERTY


def _pool(word):
    return CYR if _script(word) == "ru" else LATIN


def _vowels(word):
    return VOWELS_RU if _script(word) == "ru" else VOWELS_EN


def _inner(word, rng):
    if len(word) < 3:
        return None
    return rng.randrange(1, len(word) - 1)


# ---------- word rules ----------

def r_swap_adjacent(word, rng, opts):
    if len(word) < 2:
        return word
    for _ in range(6):
        i = rng.randrange(0, len(word) - 1)
        if word[i] != word[i+1]:
            return word[:i] + word[i+1] + word[i] + word[i+2:]
    return word


def r_swap_nonadjacent(word, rng, opts):
    if len(word) < 5:
        return word
    i = rng.randrange(1, len(word) - 1)
    j = rng.randrange(1, len(word) - 1)
    if abs(i - j) < 2:
        return word
    ch = list(word)
    ch[i], ch[j] = ch[j], ch[i]
    return "".join(ch)


def r_miss_mid(word, rng, opts):
    if len(word) < 2:
        return word
    i = rng.randrange(0, len(word))
    return word[:i] + word[i+1:]


def r_miss_first(word, rng, opts):
    return word[1:] if len(word) >= 4 else word


def r_vowel_swap_adjacent(word, rng, opts):
    if len(word) < 4:
        return word
    vowels = _vowels(word)
    low = word.lower()
    cands = [i for i in range(1, len(word) - 2)
             if low[i] in vowels and low[i+1] in vowels]
    if not cands:
        return word
    i = rng.choice(cands)
    return word[:i] + word[i+1] + word[i] + word[i+2:]


def r_vowel_miss(word, rng, opts):
    if len(word) < 5:
        return word
    vowels = _vowels(word)
    low = word.lower()
    cands = [i for i in range(1, len(word) - 1) if low[i] in vowels]
    if not cands:
        return word
    i = rng.choice(cands)
    return word[:i] + word[i+1:]


def r_wrong_key_near(word, rng, opts):
    if len(word) < 1:
        return word
    layout = _layout(word)
    low = word.lower()
    cands = [i for i in range(len(word)) if low[i] in layout]
    if not cands:
        return word
    i = rng.choice(cands)
    t = rng.choice(layout[low[i]])
    return word[:i] + (t.upper() if word[i].isupper() else t) + word[i+1:]


def r_wrong_key_far(word, rng, opts):
    if len(word) < 1:
        return word
    layout = _layout(word)
    low = word.lower()
    cands = [i for i in range(len(word)) if low[i] in layout]
    if not cands:
        return word
    i = rng.choice(cands)
    near = set(layout[low[i]]) | {low[i]}
    pool = [c for c in layout if c not in near]
    if not pool:
        return word
    t = rng.choice(pool)
    return word[:i] + (t.upper() if word[i].isupper() else t) + word[i+1:]


def r_double_letter(word, rng, opts):
    if len(word) < 1:
        return word
    cands = [i for i in range(len(word))
             if i + 1 >= len(word) or word[i+1] != word[i]]
    if not cands:
        return word
    i = rng.choice(cands)
    return word[:i] + word[i] + word[i:]


def r_insert_near(word, rng, opts):
    if len(word) < 4:
        return word
    layout = _layout(word)
    low = word.lower()
    cands = [i for i in range(1, len(word) - 1) if low[i] in layout]
    if not cands:
        return word
    i = rng.choice(cands)
    c = rng.choice(layout[low[i]])
    return word[:i+1] + c + word[i+1:]


def r_insert_random(word, rng, opts):
    if len(word) < 1:
        return word
    i = rng.randrange(0, len(word))
    c = rng.choice(_pool(word))
    return word[:i] + c + word[i:]


# ---------- space rules ----------

def space_split(word, rng, opts):
    if len(word) < 4:
        return [word]
    i = rng.randrange(1, len(word))
    return [word[:i], " ", word[i:]]


# ---------- digit rules ----------

def r_digit_swap(word, rng, opts):
    if not word.isdigit() or len(word) < 2:
        return word
    for _ in range(6):
        i = rng.randrange(0, len(word) - 1)
        if word[i] != word[i+1]:
            return word[:i] + word[i+1] + word[i] + word[i+2:]
    return word


def r_digit_miss(word, rng, opts):
    if not word.isdigit() or len(word) < 2:
        return word
    i = rng.randrange(0, len(word))
    return word[:i] + word[i+1:]


def r_digit_double(word, rng, opts):
    if not word.isdigit() or len(word) < 1:
        return word
    i = rng.randrange(0, len(word))
    return word[:i] + word[i] + word[i:]


def r_digit_insert(word, rng, opts):
    if not word.isdigit() or len(word) < 1:
        return word
    i = rng.randrange(0, len(word) + 1)
    c = rng.choice("0123456789")
    return word[:i] + c + word[i:]


# ---------- pools ----------

COMMON = {
    "swap_adjacent":       (r_swap_adjacent,       5),
    "miss_mid":            (r_miss_mid,            3),
    "vowel_miss":          (r_vowel_miss,          2),
    "vowel_swap_adjacent": (r_vowel_swap_adjacent, 1),
    "double_letter":       (r_double_letter,       3),
    "wrong_key_near":      (r_wrong_key_near,      3),
    "digit_swap":          (r_digit_swap,          2),
    "digit_miss":          (r_digit_miss,          2),
    "digit_double":        (r_digit_double,        2),
    "digit_insert":        (r_digit_insert,        2),
}

RARE = {
    "wrong_key_far":       (r_wrong_key_far,       1),
    "insert_random":       (r_insert_random,       1),
    "swap_nonadjacent":    (r_swap_nonadjacent,    1),
    "miss_first":          (r_miss_first,          1),
    "insert_near":         (r_insert_near,         1),
}

WORD_RULES = {}
for k, v in COMMON.items():
    if v[0]: WORD_RULES[k] = v
for k, v in RARE.items():
    WORD_RULES[k] = v

SPACE_RULES = {"space_split", "space_join"}
ALL_RULES = dict(WORD_RULES)
ALL_RULES.update(COMMON)
ALL_RULES.update(RARE)


def _weighted(rng, pool):
    names = list(pool.keys())
    weights = [pool[n][1] for n in names]
    return rng.choices(names, weights=weights, k=1)[0]


def _pick_rule(rng, opts):
    if opts.get("only"):
        return opts["only"]
    r = rng.random()
    if r < opts["common"]:
        pool = COMMON if opts.get("digits") else {k: v for k, v in COMMON.items() if not k.startswith("digit_")}
        return _weighted(rng, pool)
    if r < opts["common"] + opts["space"]:
        return "space_split" if rng.random() < 0.33 else "space_join"
    return _weighted(rng, RARE)


def _apply_word(word, rng, opts, name):
    fn = WORD_RULES[name][0]
    return fn(word, rng, opts)


# ---------- text pass ----------

TOKEN_RE = re.compile(r"[A-Za-zА-Яа-яЁё0-9]+|[^A-Za-zА-Яа-яЁё0-9]+")


def make_typos(text, rng, opts):
    tokens = TOKEN_RE.findall(text)
    every = opts["every"]
    min_len = opts["min_len"]

    marked = {}
    pos = 0
    next_at = 0
    for i, tok in enumerate(tokens):
        pos += len(tok)
        if not tok or not tok[0].isalnum() or len(tok) < min_len:
            continue
        if pos >= next_at:
            marked[i] = rng.randint(1, opts["max_per_word"])
            next_at += every

    out = []
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        if i not in marked:
            out.append(tok)
            i += 1
            continue

        if not opts.get("digits") and tok.isdigit():
            out.append(tok)
            i += 1
            continue

        n = marked[i]
        name = _pick_rule(rng, opts)

        if name == "space_split":
            parts = space_split(tok, rng, opts)
            out.extend(parts)
            i += 1
            continue

        if name == "space_join":
            if i + 2 < len(tokens) and tokens[i+1].isspace() and tokens[i+2] and tokens[i+2][0].isalpha():
                out.append(tok + tokens[i+2])
                i += 3
                continue
            # fallback: treat as a word rule
            name = "swap_adjacent"

        w = tok
        for _ in range(n):
            nm = _pick_rule(rng, opts)
            if nm in SPACE_RULES:
                if nm == "space_split":
                    out.extend(space_split(tok, rng, opts))
                else:
                    out.append(w)
                w = None
                break
            w = _apply_word(w, rng, opts, nm)

        if w is not None:
            if w == tok:
                # nothing landed; force
                fns = [r_swap_adjacent, r_insert_random, r_double_letter]
                if opts.get("digits"):
                    fns = [r_digit_double, r_digit_swap] + fns
                for fn in fns:
                    cand = fn(tok, rng, opts)
                    if cand != tok:
                        w = cand
                        break
            out.append(w)
        i += 1
    return "".join(out)


# ---------- drunk table ----------

# drunk -> (common, rare, every_chars, max_per_word)
# drunk -> (common, space, rare, every, max_per_word, min_len)
DRUNK = {
    0:  (1.00, 0.00, 0.00, 30, 1, 5, False),
    1:  (0.99, 0.005, 0.005, 20, 1, 5, False),
    2:  (0.98, 0.01, 0.01, 14, 1, 4, False),
    3:  (0.95, 0.02, 0.03,  9, 1, 4, False),
    4:  (0.90, 0.04, 0.06,  6, 1, 4, False),
    5:  (0.82, 0.06, 0.12,  4, 2, 3, False),
    6:  (0.70, 0.10, 0.20,  3, 2, 3, False),
    7:  (0.55, 0.15, 0.30,  2, 2, 2, False),
    8:  (0.40, 0.20, 0.40,  1, 3, 2, True),
    9:  (0.28, 0.22, 0.50,  1, 3, 1, True),
    10: (0.15, 0.25, 0.60,  1, 4, 1, True),
}


def preset(drunk):
    common, space, rare, every, cap, min_len, digits = DRUNK[drunk]
    return {"common": common, "space": space, "rare": rare,
            "every": every, "max_per_word": cap, "min_len": min_len,
            "digits": digits}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file", nargs="?")
    ap.add_argument("--drunk", type=int, choices=list(DRUNK.keys()), default=4)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--out")
    ap.add_argument("--min-len", type=int, default=None)
    ap.add_argument("--only", choices=list(ALL_RULES.keys()), default=None)
    ap.add_argument("--common", type=float, default=None)
    ap.add_argument("--rare",   type=float, default=None)
    ap.add_argument("--space",  type=float, default=None)
    ap.add_argument("--every",  type=int,   default=None)
    ap.add_argument("--max-per-word", type=int, default=None)
    ap.add_argument("--list-rules", action="store_true")
    args = ap.parse_args()

    if args.list_rules:
        for n in ALL_RULES:
            print(n)
        return

    if args.file:
        with open(args.file, encoding="utf-8") as f:
            text = f.read()
    else:
        text = sys.stdin.read()

    opts = preset(args.drunk)
    if args.common is not None:       opts["common"] = args.common
    if args.rare is not None:         opts["rare"] = args.rare
    if args.space is not None:        opts["space"] = args.space
    if args.every is not None:        opts["every"] = args.every
    if args.max_per_word is not None: opts["max_per_word"] = args.max_per_word
    opts["only"] = args.only
    if args.min_len is not None:
        opts["min_len"] = args.min_len

    rng = random.Random(args.seed)
    result = make_typos(text, rng, opts)

    if args.out:
        with open(args.out, "w", encoding="utf-8", newline="\n") as f:
            f.write(result)
        print("wrote " + args.out)
    else:
        print(result)


if __name__ == "__main__":
    main()