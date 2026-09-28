// shared/persist.js
//
// Disk is the only store. localStorage is dead: wiped once on load, never
// read, never written. On a host with no server every pLoad returns null
// and pSave/pDelete resolve false — the app renders empty and does not
// persist. That is intentional.

(function () {
    // One-shot wipe.
    try {
        localStorage.clear();
        localStorage.removeItem('__has_server');
        localStorage.removeItem('__persist_cleaned_v1');
    } catch (e) {}

    function dataUrl(app, path) {
        return '/data/' + app + '/' + path;
    }

    // ---- dev mode -----------------------------------------------------
    // Enabled by ?dev=1 in the URL. When off, everything below behaves
    // exactly as before. When on, every call is logged to window.__ioLog
    // (bounded to the last 500 entries) and failures are console.warned.
    var DEV = (function () {
        try { return /[?&]dev=1\b/.test(location.search); } catch (e) { return false; }
    })();

    function __ioLogPush(entry) {
        if (!window.__ioLog) window.__ioLog = [];
        window.__ioLog.push(entry);
        if (window.__ioLog.length > 500) window.__ioLog.shift();
        if (DEV) {
            try { console.log('[io]', entry.kind, entry.app + '/' + entry.path,
                               entry.ok === false ? 'FAIL' : (entry.bytes + 'b')); } catch (e) {}
        }
    }

    function __wrap(orig, kind) {
        if (!DEV) return orig;
        return function (app, key, path, obj) {
            var t0 = performance.now();
            var bytes = (kind === 'save' && obj !== undefined) ? JSON.stringify(obj).length : 0;
            var p = orig.apply(null, arguments);
            return p.then(function (ok) {
                __ioLogPush({
                    t: Math.round(performance.now()),
                    dt: +(performance.now() - t0).toFixed(1),
                    kind: kind, app: app, key: key, path: path,
                    bytes: bytes, ok: ok
                });
                if (ok === false) {
                    try { console.warn('[io] ' + kind + ' failed:', app + '/' + path); } catch (e) {}
                }
                return ok;
            });
        };
    }

    window.pSave = function (app, key, path, obj) {
        return fetch(dataUrl(app, path), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(obj)
        }).then(function (r) { return r.ok; })
          .catch(function () { return false; });
    };

    window.pLoad = function (app, key, path) {
        return fetch(dataUrl(app, path), { cache: 'no-store' })
            .then(function (r) {
                if (!r.ok) return null;
                return r.json().catch(function () { return null; });
            })
            .catch(function () { return null; });
    };

    window.pDelete = function (app, key, path) {
        return fetch(dataUrl(app, path), { method: 'DELETE' })
            .then(function (r) { return r.ok; })
            .catch(function () { return false; });
    };

    // Install the dev wrappers over the real functions. When DEV is off
    // these are no-ops.
    var __pSaveOrig = window.pSave;
    var __pLoadOrig = window.pLoad;
    var __pDeleteOrig = window.pDelete;
    window.pSave   = __wrap(__pSaveOrig,   'save');
    window.pLoad   = __wrap(__pLoadOrig,   'load');
    window.pDelete = __wrap(__pDeleteOrig, 'delete');

    window.persistIsLocal = function () { return true; };
    window.persistHasServer = function () { return Promise.resolve(true); };
    window.__dev = DEV;
    window.__flushIoLog = function () { window.__ioLog = []; return 'cleared'; };
})();
