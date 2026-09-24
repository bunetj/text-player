// shared/persist.js — local-file mirror for localStorage blobs.
// Works with server.py (POST/GET /data/<app>/<path>).
// On GitHub Pages (no server), the fetch silently no-ops.

(function () {
    var HAS_SERVER = null;
    var PING_PROMISE = null;

    function isLocal() {
        var h = location.hostname;
        return h === 'localhost' || h === '127.0.0.1'
            || h === '' || h === '0.0.0.0';
    }

    function ping() {
        if (PING_PROMISE) return PING_PROMISE;

        // On GitHub Pages (or any non-local host) there is no server.py.
        if (!isLocal()) {
            HAS_SERVER = false;
            PING_PROMISE = Promise.resolve(false);
            return PING_PROMISE;
        }

        // Locally: remember a previous "no server" verdict so a refresh
        // doesn't re-hit /data/ping.
        var cached = null;
        try { cached = localStorage.getItem('__has_server'); } catch (e) {}
        if (cached === '0') {
            HAS_SERVER = false;
            PING_PROMISE = Promise.resolve(false);
            return PING_PROMISE;
        }

        PING_PROMISE = fetch('/data/ping', { method: 'GET' })
            .then(function (r) {
                HAS_SERVER = r.ok;
                try { localStorage.setItem('__has_server', r.ok ? '1' : '0'); } catch (e) {}
                return HAS_SERVER;
            })
            .catch(function () {
                HAS_SERVER = false;
                try { localStorage.setItem('__has_server', '0'); } catch (e) {}
                return false;
            });
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
