// shared/store.js — localStorage glue. One key, one JSON blob.
function saveAppState(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {}
}
function loadAppState(key) {
    try {
        var raw = localStorage.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) { return null; }
}
