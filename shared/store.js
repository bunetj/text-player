// shared/store.js — in-memory only. No localStorage. Nothing survives reload.
var __STORE = (typeof __STORE !== 'undefined') ? __STORE : {};

function saveAppState(key, data) { __STORE[key] = data; }
function loadAppState(key) {
    return Object.prototype.hasOwnProperty.call(__STORE, key) ? __STORE[key] : null;
}
