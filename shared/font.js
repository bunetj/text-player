// shared/font.js — font size for message area. Used by telegram, subtitles, led, discord.
function applyFontSize(msgsEl, fontSize) {
    if (msgsEl) msgsEl.style.setProperty('--messages-text-size', fontSize + 'px');
    var lbl = document.getElementById('sizeLabel');
    if (lbl) lbl.textContent = fontSize + 'px';
}
function fontIncrease(app) {
    app.state.fontSize = Math.min(app.state.fontSize + 2, 40);
    applyFontSize(app.msgs, app.state.fontSize);
    app.saveState();
}
function fontDecrease(app) {
    app.state.fontSize = Math.max(app.state.fontSize - 2, 10);
    applyFontSize(app.msgs, app.state.fontSize);
    app.saveState();
}
