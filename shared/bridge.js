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

    // === apply an op to text via the server ===
    function applyOp(op, args, text) {
        var inp = document.getElementById('inputText');
        if (!inp) return Promise.resolve(text);
        var ops;
        if (op === 'chunk' || op === 'apply') {
            var n = parseInt((args && args.n) || 3) || 3;
            ops = ['chunk', String(n)];
        } else {
            ops = [op];
        }
        return applyOpsRemote(text, ops, '\n\n').catch(function (e) {
            console.warn('[bridge] ops/apply failed:', e);
            return text;
        });
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
            applyOp(msg.op, msg.args || {}, msg.text || '').then(function (result) {
                app.post({
                    type: 'batch-result',
                    reqId: msg.reqId,
                    text: result
                });
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
