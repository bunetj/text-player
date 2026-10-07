// shared/text.js — helpers only. Ops live in ops.py, on the server.
// JS calls /ops/apply (see applyOpsRemote below). No op bodies here.

function splitByBlankLines(text) {
    return text.split(/\n\s*\n/).filter(function (s) { return s.trim() !== ''; });
}

function splitBySeparator(text, sep) {
    return text.split(sep).filter(function (s) { return s.trim() !== ''; });
}

// Split on a dash acting as a message separator.
// Recognized: ' - ', ' – ', ' — ', and bare '—' / '–' (no surrounding spaces).
function splitOnDashes(text) {
    var parts = text.split(/\s*[\u2014\u2013]\s*|\s+-\s+/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
        var p = parts[i].replace(/^\s+|\s+$/g, '');
        if (p) out.push(p);
    }
    return out;
}

function joinBySeparator(arr, sep) {
    return (arr || []).join(sep);
}

// getDelaySimple(text, wpm) — primitive char-based delay.
function getDelaySimple(text, wpm) {
    var chars = (text || '').length || 1;
    var ms = Math.round((60 / (wpm || 200)) * (chars / 5) * 1000);
    if (!isFinite(ms) || ms < 100) ms = 800;
    return ms;
}

// textColorForBg(hex) — pick black or white for a colored background.
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

// ===== remote ops =====
// Send text to the server. The server runs ops.py. JS does no
// conversion of its own.
async function applyOpsRemote(text, ops, sep) {
    var r = await fetch('/ops/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text, ops: ops, sep: sep || '\n\n' })
    });
    if (!r.ok) throw new Error('ops/apply ' + r.status);
    var j = await r.json();
    return j.text;
}
