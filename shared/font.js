// shared/font.js — font size for message/text areas. Used by telegram, subtitles, led, discord.
// applyFontSize(el, size, opts)
//   el:   target element (message container, subtitle display, led line, ...)
//   size: number, px
//   opts: { cssVar: '--messages-text-size' } -> set CSS var instead of inline font-size
//         { labelId: 'sizeLabel' }            -> id of the label to update (default 'sizeLabel')
function applyFontSize(el, size, opts) {
    if (!el) return;
    opts = opts || {};
    if (opts.cssVar) el.style.setProperty(opts.cssVar, size + 'px');
    else el.style.fontSize = size + 'px';
    var labelId = opts.labelId || 'sizeLabel';
    var lbl = document.getElementById(labelId);
    if (lbl) lbl.textContent = size + 'px';
}

function fontIncrease(app) {
    app.state.fontSize = Math.min(app.state.fontSize + 2, 60);
    applyFontSize(app.el || app.msgs, app.state.fontSize, app.fontOpts);
    app.saveState();
}

function fontDecrease(app) {
    app.state.fontSize = Math.max(app.state.fontSize - 2, 10);
    applyFontSize(app.el || app.msgs, app.state.fontSize, app.fontOpts);
    app.saveState();
}
