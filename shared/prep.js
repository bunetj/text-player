// shared/prep.js — shared Prep popup and chunking.
// Uses shared/modal.css classes so all apps look the same.

function __lowState(key, def) {
    try {
        var v = localStorage.getItem('low_cb_' + key);
        if (v === null) return def;
        return v === '1';
    } catch (e) { return def; }
}
function __lowSave(key, val) {
    try { localStorage.setItem('low_cb_' + key, val ? '1' : '0'); } catch (e) {}
}

function showLowPopup(inputEl, joinWith) {
    var existing = document.getElementById('__lowPopup');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = '__lowPopup';
    overlay.className = 'modal active';

    var box = document.createElement('div');
    box.className = 'modal-box';
    box.innerHTML =
        '<h3>Chat style</h3>' +
        '<label><input type="checkbox" id="lowLower"' + (__lowState('lower', true) ? ' checked' : '') + '> Lowercase</label>' +
        '<label><input type="checkbox" id="lowNoPunct"' + (__lowState('noPunct', false) ? ' checked' : '') + '> Remove punctuation</label>' +
        '<label><input type="checkbox" id="lowLines" checked> Split by lines</label>' +
                '<label><input type="checkbox" id="lowOneLine"' + (__lowState('oneLine', false) ? ' checked' : '') + '> One line</label>' +
        '<div class="btn-row">' +
        '   <button class="btn-cancel" id="lowCancel">Cancel</button>' +
        '   <button class="btn-save" id="lowApply">Apply</button>' +
        '</div>';
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function close() { if (overlay.parentNode) overlay.remove(); }

    function apply() {
        var settings = {
            lowercase: document.getElementById('lowLower').checked,
            noPunct: document.getElementById('lowNoPunct').checked,
            oneLine: document.getElementById('lowOneLine').checked,
            lines: document.getElementById('lowLines').checked,
        };
        __lowSave('lower', settings.lowercase);
        __lowSave('noPunct', settings.noPunct);
        __lowSave('lines', settings.lines);
        __lowSave('oneLine', settings.oneLine);
        var raw = inputEl.value;

        if (settings.lines) {
            var linesIn = raw.split(/\n+/).map(function (s) { return s.trim(); })
                             .filter(function (s) { return s; });
            raw = linesIn.join('\n---\n');
        }

        inputEl.value = applyLow(raw, settings);
        close();
    }

    box.querySelector('#lowCancel').onclick = close;
    box.querySelector('#lowApply').onclick = apply;
    overlay.onclick = function (e) { if (e.target === overlay) close(); };

    document.addEventListener('keydown', function onKey(e) {
        if (!document.getElementById('__lowPopup')) {
            document.removeEventListener('keydown', onKey);
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault(); close();
            document.removeEventListener('keydown', onKey);
        } else if (e.key === 'Enter') {
            if (e.target && e.target.tagName === 'TEXTAREA') return;
            e.preventDefault(); apply();
            document.removeEventListener('keydown', onKey);
        }
    });

    setTimeout(function () { document.getElementById('lowLower').focus(); }, 50);
}

// showPunctPopup(inputEl, joinWith, splitFn)
//   splitFn(raw) -> array of message strings (app-specific block splitter)
//   The modal lets the user toggle "Remove punctuation marks".
//   strip=true  -> split AND strip trailing marks
//   strip=false -> split only, marks stay attached
function showPunctPopup(inputEl, joinWith, splitFn) {
    var existing = document.getElementById('__punctPopup');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = '__punctPopup';
    overlay.className = 'modal active';

    var box = document.createElement('div');
    box.className = 'modal-box';
    box.innerHTML =
        '<h3>Punct</h3>' +
        '<div class="sub">Split into messages</div>' +
        '<label><input type="checkbox" id="punctStrip" checked> Remove punctuation marks</label>' +
        '<div class="btn-row">' +
        '   <button class="btn-cancel" id="punctCancel">Cancel</button>' +
        '   <button class="btn-save" id="punctApply">Apply</button>' +
        '</div>';
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function close() { if (overlay.parentNode) overlay.remove(); }

    function apply() {
        var strip = document.getElementById('punctStrip').checked;
        var raw = inputEl.value;
        var blocks = splitFn ? splitFn(raw) : splitByBlankLines(raw);
        var out = [];
        for (var b = 0; b < blocks.length; b++) {
            var parts = splitPunct(blocks[b], { strip: strip });
            for (var i = 0; i < parts.length; i++) {
                if (parts[i]) out.push(parts[i]);
            }
        }
        if (out.length) inputEl.value = out.join(joinWith);
        close();
    }

    box.querySelector('#punctCancel').onclick = close;
    box.querySelector('#punctApply').onclick = apply;
    overlay.onclick = function (e) { if (e.target === overlay) close(); };

    document.addEventListener('keydown', function onKey(e) {
        if (!document.getElementById('__punctPopup')) {
            document.removeEventListener('keydown', onKey);
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault(); close();
            document.removeEventListener('keydown', onKey);
        } else if (e.key === 'Enter') {
            if (e.target && e.target.tagName === 'TEXTAREA') return;
            e.preventDefault(); apply();
            document.removeEventListener('keydown', onKey);
        }
    });

    setTimeout(function () { document.getElementById('punctStrip').focus(); }, 50);
}

function applyChunking(inputEl, joinWith) {
    var inputElCount = document.getElementById('wordCountInput');
    var n = parseInt(inputElCount ? inputElCount.value : 3) || 3;
    var raw = inputEl.value;
    var blocks = splitByBlankLines(raw);
    if (!blocks.length) return;
    var result = [];
    for (var i = 0; i < blocks.length; i++) {
        var chunks = splitWords(blocks[i], n);
        for (var j = 0; j < chunks.length; j++) {
            if (chunks[j].trim()) result.push(chunks[j]);
        }
    }
    if (result.length) {
        inputEl.value = result.join(joinWith);
    }
}
