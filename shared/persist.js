// shared/persist.js — local-file mirror for localStorage blobs.
// Works with server.py (POST/GET /data/<app>/<path>).
// On GitHub Pages (no server), the fetch silently no-ops.

(function () {
    var HAS_SERVER = null;
    var PING_PROMISE = null;

    function ping() {
        if (PING_PROMISE) return PING_PROMISE;
        PING_PROMISE = fetch('/data/ping', { method: 'GET' })
            .then(function (r) { HAS_SERVER = r.ok; return HAS_SERVER; })
            .catch(function () { HAS_SERVER = false; return false; });
        return PING_PROMISE;
    }

    function dataUrl(app, path) {
        return '/data/' + app + '/' + path;
    }

    window.pSave = function (app, key, path, obj) {
        try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) {}
        return ping().then(function (has) {
            if (!has) return false;
            return fetch(dataUrl(app, path), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(obj)
            }).then(function (r) { return r.ok; })
              .catch(function () { return false; });
        });
    };

    window.pLoad = function (app, key, path) {
        var local = null;
        try {
            var raw = localStorage.getItem(key);
            if (raw) local = JSON.parse(raw);
        } catch (e) {}
        if (local !== null) return Promise.resolve(local);

        return ping().then(function (has) {
            if (!has) return null;
            return fetch(dataUrl(app, path), { cache: 'no-store' })
                .then(function (r) {
                    if (!r.ok) return null;
                    return r.json().then(function (obj) {
                        try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) {}
                        return obj;
                    });
                })
                .catch(function () { return null; });
        });
    };

    window.pDelete = function (app, key, path) {
        try { localStorage.removeItem(key); } catch (e) {}
        return ping().then(function (has) {
            if (!has) return false;
            return fetch(dataUrl(app, path), { method: 'DELETE' })
                .then(function (r) { return r.ok; })
                .catch(function () { return false; });
        });
    };
})();
