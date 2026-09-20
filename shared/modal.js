// shared/modal.js — one window at a time, close returns to previous.
//
// Behaviour is driven by the DOM, not by callers: whenever a .modal becomes
// .active, the previously-active modal is hidden and remembered. Whenever one
// loses .active, the remembered one is shown again. Every existing click
// handler, ESC, backdrop click, and cancel button therefore "just works".
//
// Enter (not in TEXTAREA) clicks the top modal's save/copy button:
//   id "modal"     -> #modalSave
//   id "clipModal" -> #clipCopy
//   id "botModal"  -> #botSave

(function () {
    var KNOWN_SAVE = {
        'modal':     'modalSave',
        'clipModal': 'clipCopy',
        'botModal':  'botSave',
    };
    var history = [];       // ids of modals that were active, oldest first
    var suppress = false;   // ignore our own class toggles

    function activeIds() {
        var out = [];
        var els = document.querySelectorAll('.modal.active');
        for (var i = 0; i < els.length; i++) out.push(els[i].id);
        return out;
    }

    function show(id) {
        var el = document.getElementById(id);
        if (!el) return;
        suppress = true;
        el.classList.add('active');
        suppress = false;
    }
    function hide(id) {
        var el = document.getElementById(id);
        if (!el) return;
        suppress = true;
        el.classList.remove('active');
        suppress = false;
    }

    // Whenever any modal's class changes, sync the state.
    function sync() {
        if (suppress) return;

        var now = activeIds();

        // If more than one modal is active at once, the newest (last in
        // DOM order that we didn't already have) is the "top".
        // We want: hide everything except the newest, keep the rest in history.
        if (now.length > 1) {
            // Find which of these are new (not the last seen).
            var last = history[history.length - 1];
            var newest = now[now.length - 1];
            if (newest === last) newest = now[0];

            // Push all-but-newest onto history in the order they appear.
            for (var i = 0; i < now.length; i++) {
                if (now[i] === newest) continue;
                if (history.indexOf(now[i]) === -1) history.push(now[i]);
                hide(now[i]);
            }
            // Ensure newest is on top of history
            var idx = history.indexOf(newest);
            if (idx !== -1) history.splice(idx, 1);
            history.push(newest);
            return;
        }

        if (now.length === 1) {
            var only = now[0];
            if (history[history.length - 1] !== only) {
                var ix = history.indexOf(only);
                if (ix !== -1) history.splice(ix, 1);
                history.push(only);
            }
            return;
        }

        // now.length === 0: something closed. If history has an entry, that
        // means a modal was closed via .classList.remove('active'). Pop and
        // restore the previous one.
        if (history.length > 1) {
            history.pop();
            show(history[history.length - 1]);
        } else if (history.length === 1) {
            // The one active thing was closed, nothing to restore.
            history.pop();
        }
    }

    var observer = new MutationObserver(sync);
    function watchAll() {
        var modals = document.querySelectorAll('.modal');
        for (var i = 0; i < modals.length; i++) {
            observer.observe(modals[i], { attributes: true, attributeFilter: ['class'] });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            watchAll();
            sync();
        });
    } else {
        watchAll();
        sync();
    }

    // Public API (kept for compatibility; going through classList is fine).
    window.openModal = function (id) { show(id); sync(); };
    window.closeModal = function (id) {
        if (id) hide(id);
        else {
            var top = history[history.length - 1];
            if (top) hide(top);
        }
        sync();
    };
    window.closeAllModals = function () {
        while (history.length) hide(history.pop());
        sync();
    };
    window.modalInitStack = function () { watchAll(); sync(); };
    window.modalRegisterDynamic = function (el) {
        if (el) observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    };

    // ESC -> close top modal
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' && e.key !== 'Esc' && e.keyCode !== 27) return;
        var top = history[history.length - 1];
        if (!top) return;
        e.preventDefault();
        e.stopPropagation();
        hide(top);
        sync();
    }, true);

    // Enter -> click save/copy of top modal (not inside a textarea)
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        if (e.target && e.target.tagName === 'TEXTAREA') return;
        for (var i = history.length - 1; i >= 0; i--) {
            var el = document.getElementById(history[i]);
            if (!el) continue;
            var btnId = KNOWN_SAVE[el.id];
            if (btnId) {
                var btn = document.getElementById(btnId);
                if (btn) {
                    e.preventDefault();
                    btn.click();
                    return;
                }
            }
        }
    });
})();
