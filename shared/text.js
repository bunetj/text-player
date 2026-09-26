// shared/text.js — shared text helpers (extracted verbatim from apps)
// Apps must NOT redefine these locally.

function splitByBlankLines(text) {
    return text.split(/\n\s*\n/).filter(s => s.trim() !== '');
}

function splitBySeparator(text, sep) {
    // sep is a string like '\n---\n'; kept explicit so Telegram and
    // Subtitles/LED can use different delimiters without forking logic.
    return text.split(sep).filter(s => s.trim() !== '');
}

function splitWords(text, n) {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const chunks = [];
    for (let i = 0; i < words.length; i += n) {
        chunks.push(words.slice(i, i + n).join(' '));
    }
    return chunks;
}

function toLower(text) {
    let output = text.replace(/—/g, '-').replace(/–/g, '-').replace(/ -- /g, ' - ');
    output = output.replace(/[""]/g, '"').replace(/['']/g, "'").replace(/[‚‛]/g, "'")
        .replace(/[„“”]/g, '"').replace(/[’‘]/g, "'").replace(/[‹›]/g, "'")
        .replace(/[«»]/g, '"');
    const parts = output.split(/(\s+)/);
    const result = [];
    for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (!/[a-zA-Zа-яА-Я]/.test(p)) { result.push(p); continue; }
        const latinOnly = p.replace(/[^a-zA-Z]/g, '');
        const isLatinCaps = latinOnly.length >= 2 && latinOnly === latinOnly.toUpperCase();
        const cyrOnly = p.replace(/[^а-яА-Я]/g, '');
        const isCyrCaps = cyrOnly.length >= 2 && cyrOnly === cyrOnly.toUpperCase();
        if (isLatinCaps || isCyrCaps) { result.push(p); continue; }
        result.push(p.toLowerCase());
    }
    return result.join('');
}

// removePunctuation(text)
// Smart removal: drops punctuation, BUT keeps a mark when it sits
// between two letters (so "i.e.", "10:30", "U.S.A.", "don't" survive).
// This is the app-family canonical algorithm, promoted from telegram's
// /chat rem.
function removePunctuation(text) {
    var src = String(text == null ? '' : text);
    var out = '';
    for (var i = 0; i < src.length; i++) {
        var ch = src[i];
        if (/\p{P}/u.test(ch)) {
            var prev = i > 0 ? src[i - 1] : '';
            var next = i + 1 < src.length ? src[i + 1] : '';
            if (/\p{L}/u.test(prev) && /\p{L}/u.test(next)) {
                out += ch;
            }
            // else: drop
        } else {
            out += ch;
        }
    }
    return out;
}

// Normalize curly quotes / apostrophes to plain ASCII forms.
// Runs inside applyLow, always (not gated on lowercase).
function normalizeQuotes(text) {
    return text
        .replace(/[\u201C\u201D\u201E\u201F\u00AB\u00BB\u2039\u203A]/g, '"')
        .replace(/[\u2018\u2019\u201A\u201B\u2032\u02BC\u02B9]/g, "'");
}

// splitPunct(text, opts)
//   opts.strip === true  -> remove trailing punct marks from each piece
//   opts.strip === false -> keep them attached
// Rules:
//   * split on . , ! ? ; : only when followed by whitespace or EOL
//   * never split at ' or at quote chars
//   * never split when the punct is between two non-space chars (i.e. / 10:30)
function splitPunct(text, opts) {
    opts = opts || {};
    var strip = (opts.strip !== false); // default true
    var punctClass = '.!?;:,';
    var quoteClass = '\'"\u201C\u201D\u2018\u2019\u00AB\u00BB\u2039\u203A';
    var pieces = [];
    var current = '';
    var i = 0;
    while (i < text.length) {
        var c = text[i];
        current += c;
        if (punctClass.indexOf(c) !== -1) {
            var prev = i > 0 ? text[i - 1] : '';
            var next = text[i + 1];
            var nextOk = (next === undefined) || /\s/.test(next);
            // between-two-symbols guard: if prev is a non-space, non-quote,
            // non-punct letter/digit AND next is a non-space letter/digit,
            // do not split (covers i.e. , 10:30 , 1.5 , urls).
            var betweenSymbols = false;
            if (prev && next &&
                !/\s/.test(prev) && !/\s/.test(next) &&
                quoteClass.indexOf(prev) === -1 &&
                quoteClass.indexOf(next) === -1 &&
                punctClass.indexOf(prev) === -1) {
                betweenSymbols = true;
            }
            // apostrophe / quote as the punct char itself: never a split trigger
            var isQuote = quoteClass.indexOf(c) !== -1;
            if (!isQuote && nextOk && !betweenSymbols) {
                pieces.push(current);
                current = '';
            }
        }
        i++;
    }
    if (current) pieces.push(current);

    var out = [];
    for (var k = 0; k < pieces.length; k++) {
        var p = pieces[k];
        if (strip) {
            // strip trailing punct marks and surrounding whitespace
            p = p.replace(/[.!?;:,]+$/g, '').trim();
        } else {
            p = p.replace(/\s+$/g, '').replace(/^\s+/g, '');
        }
        if (p) out.push(p);
    }
    return out;
}

// Split on a dash acting as message separator.
// Recognized: ' - ', ' – ', ' — ', and bare '—' / '–' (no surrounding spaces).
// The dash is removed.
function splitOnDashes(text) {
    // order matters: em/en dash first (they may appear without spaces),
    // then space-hyphen-space.
    var parts = text.split(/\s*[\u2014\u2013]\s*|\s+-\s+/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
        var p = parts[i].replace(/^\s+|\s+$/g, '');
        if (p) out.push(p);
    }
    return out;
}

function splitSentences(text) {
    const result = [];
    let start = 0;
    let i = 0;
    while (i < text.length) {
        if (text[i] === '…' || (text[i] === '.' && text[i + 1] === '.' && text[i + 2] === '.')) {
            const len = text[i] === '…' ? 1 : 3;
            const next = text[i + len] || '';
            if (next === ' ' || next === '\n' || next === '\t' || !next) {
                result.push(text.slice(start, i + len));
                start = i + len;
                i += len;
                continue;
            }
        }
        if (text[i] === '.' || text[i] === '!' || text[i] === '?') {
            const next = text[i + 1] || '';
            if (next === ' ' || next === '\n' || next === '\t' || !next) {
                result.push(text.slice(start, i + 1));
                start = i + 1;
            }
        }
        i++;
    }
    if (start < text.length) result.push(text.slice(start));
    return result.length ? result : [text];
}

function applyLow(text, settings) {
    let result = text;
    // quote normalization always runs when LOW is applied
    result = normalizeQuotes(result);
    if (settings.lowercase) result = toLower(result);
    if (settings.noPunct) result = removePunctuation(result);
    if (settings.oneLine) result = result.replace(/\s+/g, ' ').trim();
    return result;
}


function joinBySeparator(arr, sep) {
    return (arr || []).join(sep);
}


// getDelaySimple(text, wpm) — primitive char-based delay.
// Apps with their own timing algorithm should NOT use this.
function getDelaySimple(text, wpm) {
    var chars = (text || '').length || 1;
    var ms = Math.round((60 / (wpm || 200)) * (chars / 5) * 1000);
    if (!isFinite(ms) || ms < 100) ms = 800;
    return ms;
}


// textColorForBg(hex) — pick black or white for a colored background.
// Uses sRGB relative luminance (WCAG-ish). Returns '#000000' or '#ffffff'.
function textColorForBg(hex) {
    if (!hex) return '#ffffff';
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    var r = parseInt(h.substr(0,2), 16) / 255;
    var g = parseInt(h.substr(2,2), 16) / 255;
    var b = parseInt(h.substr(4,2), 16) / 255;
    function lin(c){ return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); }
    var L = 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b);
    return L > 0.5 ? '#000000' : '#ffffff';
}


// ===== merged from shared/pdf.js =====
(function () {
    function formatAsPdf(text) {
        if (typeof text !== 'string') return text;

        // normalize line endings
        text = text.replace(/\r\n?/g, '\n');

        // 1) newline + optional leading spaces + uppercase  ->  blank line + uppercase
        //    \s* between is safe here: no \n can be consumed because [\n] is
        //    matched first and \s* is anchored right after a newline.
        text = text.replace(/\n[ \t]*(\p{Lu})/gu, '\n\n$1');

        // 2) single newline NOT followed by another newline and NOT followed
        //    by an uppercase letter  ->  single space.
        //    The (?<!\n) and (?!\n) guards keep paragraph breaks intact, so
        //    running the function twice is a no-op on already-formatted text.
        text = text.replace(/(?<!\n)\n(?!\n)(?!\p{Lu})/gu, ' ');

        // 3) collapse runs of blank lines: 3+ newlines in a row -> 2.
        //    (2 newlines = one blank line, which is the separator we want.)
        text = text.replace(/\n{3,}/g, '\n\n');

        return text;
    }

    window.formatAsPdf = formatAsPdf;
})();
