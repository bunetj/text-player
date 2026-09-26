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

    window.persistIsLocal = function () { return true; };
    window.persistHasServer = function () { return Promise.resolve(true); };
})();
