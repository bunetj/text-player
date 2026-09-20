// shared/bridge.js
// Bridge between hub (parent) and app in iframe.

(function () {
    if (window.parent === window) return;

    var app = {
        post: function (msg) {
            try { window.parent.postMessage(msg, '*'); } catch (e) {}
        }
    };

    function snapshot() {
        var text = '';
        var ta = document.getElementById('inputText');
        if (ta) text = ta.value;

        var settings = {};
        var st = (typeof state !== 'undefined') ? state : (window.state || {});
        ['fontSize','speed','color','wpm','freezePause','loopCurrent'].forEach(function (k) {
            if (k in st) settings[k] = st[k];
        });
        var loop = document.getElementById('loopCheck');
        if (loop) settings.loopCurrent = loop.checked;
        var sp = document.getElementById('speedSlider');
        if (sp) settings.speed = parseInt(sp.value);
        if ('wpm' in st) settings.wpm = st.wpm;
        var cp = document.getElementById('colorPicker');
        if (cp) settings.color = cp.value;

        // names (telegram)
        if (st.ownName) settings.ownName = st.ownName;
        if (st.otherName) settings.otherName = st.otherName;

        return { text: text, settings: settings };
    }

    app.post({ type: 'ready' });

    // === ядро: применить операцию к тексту и вернуть результат ===
    function applyOp(op, args, text) {
        var inp = document.getElementById('inputText');
        if (!inp) return text;
        var saved = inp.value;
        inp.value = text;

        try {
            if (op === 'punct') {
                // повторяем логику punctBtn
                if (typeof punctSplit === 'function' && typeof tgJoin === 'function' && typeof splitPunct === 'function') {
                    // telegram
                    var blocks = punctSplit(text);
                    var out = [];
                    for (var b = 0; b < blocks.length; b++) {
                        var parts = splitPunct(blocks[b]);
                        for (var i = 0; i < parts.length; i++) {
                            if (parts[i].trim()) out.push(parts[i].trim());
                        }
                    }
                    inp.value = tgJoin(out);
                } else if (typeof splitPunct === 'function') {
                    // led / subtitles
                    var blocks2 = text.split(/\n\s*\n/).filter(function (s) { return s.trim(); });
                    var out2 = [];
                    if (blocks2.length <= 1) {
                        var parts2 = splitPunct(text);
                        for (var j = 0; j < parts2.length; j++) {
                            if (parts2[j].trim()) out2.push(parts2[j].trim());
                        }
                    } else {
                        for (var k = 0; k < blocks2.length; k++) {
                            var parts3 = splitPunct(blocks2[k]);
                            for (var m = 0; m < parts3.length; m++) {
                                if (parts3[m].trim()) out2.push(parts3[m].trim());
                            }
                        }
                    }
                    inp.value = out2.join('\n\n');
                }
            } else if (op === 'sent') {
                if (typeof tgSplit === 'function' && typeof tgJoin === 'function' && typeof splitSentences === 'function') {
                    var blocks3 = tgSplit(text);
                    var out3 = [];
                    for (var b3 = 0; b3 < blocks3.length; b3++) {
                        var parts4 = splitSentences(blocks3[b3]);
                        for (var i3 = 0; i3 < parts4.length; i3++) {
                            if (parts4[i3].trim()) out3.push(parts4[i3].trim());
                        }
                    }
                    inp.value = tgJoin(out3);
                } else if (typeof splitSentences === 'function') {
                    var parts5 = splitSentences(text);
                    var out5 = [];
                    for (var i5 = 0; i5 < parts5.length; i5++) {
                        if (parts5[i5].trim()) out5.push(parts5[i5].trim());
                    }
                    inp.value = out5.join('\n\n');
                }
            } else if (op === 'apply') {
                var n = parseInt(args.n) || 3;
                if (typeof tgSplit === 'function' && typeof tgJoin === 'function') {
                    var blocks6 = tgSplit(text);
                    var out6 = [];
                    for (var b6 = 0; b6 < blocks6.length; b6++) {
                        var words = blocks6[b6].split(/\s+/).filter(function (w) { return w; });
                        for (var i6 = 0; i6 < words.length; i6 += n) {
                            out6.push(words.slice(i6, i6 + n).join(' '));
                        }
                    }
                    inp.value = tgJoin(out6);
                } else {
                    var words2 = text.split(/\s+/).filter(function (w) { return w; });
                    var out7 = [];
                    for (var i7 = 0; i7 < words2.length; i7 += n) {
                        out7.push(words2.slice(i7, i7 + n).join(' '));
                    }
                    inp.value = out7.join('\n\n');
                }
            } else if (op === 'low') {
                if (typeof applyLow === 'function') {
                    var oneLine = !!args.oneLine;
                    var lower = !!args.lowercase;
                    var nop = !!args.noPunct;
                    var res = applyLow(text, {lowercase: lower, noPunct: nop, oneLine: oneLine});
                    if (typeof tgJoin === 'function' && typeof tgSplit === 'function') {
                        inp.value = tgJoin(tgSplit(res));
                    } else {
                        inp.value = res;
                    }
                }
            }
            return inp.value;
        } finally {
            inp.value = saved;
        }
    }

    // === приём команд от хаба ===
    window.addEventListener('message', function (e) {
        var msg = e.data;
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'init') {
            var ta = document.getElementById('inputText');
            if (ta && typeof msg.text === 'string') {
                ta.value = msg.text;
                ta.dispatchEvent(new Event('input', { bubbles: true }));
            }
            var s = msg.settings || {};
            if (typeof s.fontSize === 'number') {
                var st = (typeof state !== 'undefined') ? state : (window.state || {});
                if ('fontSize' in st) {
                    st.fontSize = s.fontSize;
                    if (typeof applyFontSize === 'function') applyFontSize();
                }
            }
            if (typeof s.speed === 'number') {
                var sp = document.getElementById('speedSlider');
                if (sp) { sp.value = s.speed; sp.dispatchEvent(new Event('input', { bubbles: true })); }
                var st2 = (typeof state !== 'undefined') ? state : (window.state || {});
                if ('speed' in st2) st2.speed = s.speed;
            }
            if (typeof s.wpm === 'number') {
                var st3 = (typeof state !== 'undefined') ? state : (window.state || {});
                if ('wpm' in st3) st3.wpm = s.wpm;
                var sv = document.getElementById('speedValue');
                if (sv) sv.textContent = s.wpm + ' WPM';
            }
            if (typeof s.color === 'string') {
                var cp = document.getElementById('colorPicker');
                if (cp) { cp.value = s.color; cp.dispatchEvent(new Event('input', { bubbles: true })); }
            }
            if (typeof s.loopCurrent === 'boolean') {
                var lc = document.getElementById('loopCheck');
                if (lc) { lc.checked = s.loopCurrent; lc.dispatchEvent(new Event('change', { bubbles: true })); }
            }
            // names (telegram)
            if (typeof s.ownName === 'string' && 'ownName' in st) {
                st.ownName = s.ownName;
                if (typeof updateChatName === 'function') updateChatName();
            }
            if (typeof s.otherName === 'string' && 'otherName' in st) {
                st.otherName = s.otherName;
                if (typeof updateChatName === 'function') updateChatName();
            }
        }

        if (msg.type === 'save') {
            var snap = snapshot();
            app.post({ type: 'state', text: snap.text, settings: snap.settings });
        }

        // === batch: хаб просит обработать текст ===
        if (msg.type === 'batch-apply') {
            var result = applyOp(msg.op, msg.args || {}, msg.text || '');
            app.post({
                type: 'batch-result',
                reqId: msg.reqId,
                text: result
            });
        }
    });

    function watchText() {
        var ta = document.getElementById('inputText');
        if (!ta) return;
        ta.addEventListener('input', function () {
            var snap = snapshot();
            app.post({ type: 'change', text: snap.text, settings: snap.settings });
        });
    }

    var _lastScrollY = 0;
    var _scrollTarget = null;
    var _scrollThrottle = 0;

    document.addEventListener('scroll', function (e) {
        var now = Date.now();
        if (now - _scrollThrottle < 80) return;
        _scrollThrottle = now;
        var t = e.target;
        if (t === document) t = document.scrollingElement || document.documentElement;
        if (_scrollTarget !== t) {
            _scrollTarget = t;
            _lastScrollY = t ? t.scrollTop : 0;
            return;
        }
        var y = t ? t.scrollTop : 0;
        var diff = y - _lastScrollY;
        if (Math.abs(diff) < 8) return;
        _lastScrollY = y;
        app.post({ type: 'scroll', dir: diff > 0 ? 'down' : 'up' });
    }, true);

    // === prep: следим за кликами по prep-кнопкам ===
    document.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.id) return;

        if (t.id === 'punctBtn') {
            app.post({ type: 'prep', op: 'punct', args: {} });
            return;
        }
        if (t.id === 'sentBtn') {
            app.post({ type: 'prep', op: 'sent', args: {} });
            return;
        }
        if (t.id === 'applyBtn') {
            var inp = document.getElementById('wordCountInput');
            var n = inp ? (parseInt(inp.value) || 3) : 3;
            app.post({ type: 'prep', op: 'apply', args: { n: n } });
            return;
        }
        if (t.id === 'lowApply') {
            var lower = document.getElementById('lowLower');
            var nop = document.getElementById('lowNoPunct');
            var one = document.getElementById('lowOneLine');
            app.post({ type: 'prep', op: 'low', args: {
                lowercase: lower ? lower.checked : false,
                noPunct: nop ? nop.checked : false,
                oneLine: one ? one.checked : false
            }});
            return;
        }
    }, true);

    var last = JSON.stringify(snapshot());
    setInterval(function () {
        var s = JSON.stringify(snapshot());
        if (s !== last) {
            last = s;
            var snap = snapshot();
            app.post({ type: 'change', text: snap.text, settings: snap.settings });
        }
    }, 500);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', watchText);
    } else {
        watchText();
    }
})();
