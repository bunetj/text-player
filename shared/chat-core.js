// shared/chat-core.js — shared message/export/clip helpers
// Used by CHEATREAD/telegram and SELF-PLAY/TELEGRAM.

// createMsgNode(text, author, delay, reacted)
//   author: 'own' | 'other' (absolute, never changes)
//   returns a <div class="msg bubble ..."> node, NOT attached.
//   author === 'other' -> rendered via __md(); else plain text.
function createMsgNode(text, author, delay, reacted, perspective) {
    var isMine = (author === perspective);
    var d = document.createElement('div');
    d.setAttribute('data-author', author);
    d.setAttribute('data-raw', text);
    d.setAttribute('data-delay', String(delay || 0));
    d.className = 'msg bubble ' + (isMine ? 'own' : 'recv');
    if (reacted) d.classList.add('reacted');
    var _w = document.createElement('div'); _w.className = 'bubble-content-wrapper';
    var _c = document.createElement('div'); _c.className = 'bubble-content';
    var _m = document.createElement('div'); _m.className = 'message';
    if (author === 'other') _m.innerHTML = __md(text);
    else                    _m.textContent = text;
    _c.appendChild(_m); _w.appendChild(_c); d.appendChild(_w);
    return d;
}

// exportChatShared(msgsEl, opts, nameFor)
//   msgsEl:  the .msgs container
//   opts:    { all, own, recv, reacted }
//   nameFor: function(isOwn) -> string, name to print in the [Name] header
//   returns: { payload: string, count: int } or null if nothing matched
function exportChatShared(msgsEl, opts, nameFor) {
    opts = opts || {};
    var wantAll     = !!opts.all;
    var wantOwn     = !!opts.own;
    var wantRecv    = !!opts.recv;
    var wantReacted = !!opts.reacted;

    if (wantAll) { wantOwn = true; wantRecv = true; }

    var speakerFilterActive = wantOwn || wantRecv;
    if (!speakerFilterActive && !wantReacted) return null;

    var speakerCount  = (wantOwn ? 1 : 0) + (wantRecv ? 1 : 0);
    var singleSpeaker = (speakerCount === 1 && !wantReacted);

    var items = msgsEl.querySelectorAll('.msg');
    var parts = [];
    for (var i = 0; i < items.length; i++) {
        var m = items[i];
        var isOwn     = m.classList.contains('own');
        var isReacted = m.classList.contains('reacted');

        var inSpeakerSet = speakerFilterActive &&
            ((isOwn && wantOwn) || (!isOwn && wantRecv));
        var inReactedSet = wantReacted && isReacted;
        if (!inSpeakerSet && !inReactedSet) continue;

        var text = m.textContent.trim();
        if (!text) continue;

        var heart = isReacted ? '\n❤' : '';
        if (singleSpeaker) {
            parts.push(text + heart);
        } else {
            parts.push('[' + nameFor(isOwn) + ']\n' + text + heart);
        }
    }

    if (!parts.length) return null;

    var payload;
    if (singleSpeaker) {
        var who = wantOwn ? nameFor(true) : nameFor(false);
        payload = '[' + who + ']\n' + parts.join('\n\n');
    } else {
        payload = parts.join('\n\n');
    }
    return { payload: payload, count: parts.length };
}

// initClipModal(opts)
//   opts.modalId     - id of the clip modal (default 'clipModal')
//   opts.copyId      - id of the Copy button (default 'clipCopy')
//   opts.cancelId    - id of the Cancel button (default 'clipCancel')
//   opts.checkAll    - id of "All" checkbox (default 'clipAll')
//   opts.checkOwn    - id of "Only me" checkbox (default 'clipOwn')
//   opts.checkRecv   - id of "Only they" checkbox (default 'clipRecv')
//   opts.checkReacted- id of "Reacted" checkbox (default 'clipReacted')
//   opts.onCopy      - function(opts) called with the checkbox states
function initClipModal(opts) {
    opts = opts || {};
    var modalId   = opts.modalId   || 'clipModal';
    var copyId    = opts.copyId    || 'clipCopy';
    var cancelId  = opts.cancelId  || 'clipCancel';
    var cbAll     = opts.checkAll  || 'clipAll';
    var cbOwn     = opts.checkOwn  || 'clipOwn';
    var cbRecv    = opts.checkRecv || 'clipRecv';
    var cbReacted = opts.checkReacted || 'clipReacted';

    var modal = document.getElementById(modalId);
    function close() { if (typeof closeModal === 'function') closeModal(modalId); else if (modal) modal.classList.remove('active'); }

    var copyBtn = document.getElementById(copyId);
    if (copyBtn) {
        copyBtn.onclick = function () {
            var state = {
                all:     (document.getElementById(cbAll)     || {}).checked || false,
                own:     (document.getElementById(cbOwn)     || {}).checked || false,
                recv:    (document.getElementById(cbRecv)    || {}).checked || false,
                reacted: (document.getElementById(cbReacted) || {}).checked || false
            };
            close();
            if (typeof opts.onCopy === 'function') opts.onCopy(state);
        };
    }
    var cancelBtn = document.getElementById(cancelId);
    if (cancelBtn) cancelBtn.onclick = close;
    if (modal) modal.onclick = function (e) { if (e.target === modal) close(); };

    return { close: close };
}


// chatAddMsg(app, text, author, opts)
//   app:  { state, msgs, applyFontSize, saveState, refreshBubbles, autoPlay }
//   opts: { silent, delay, trackPlayback, perspective }
//   perspective: 'own'|'other' — who is "me" right now. Defaults to app.state.currentPerspective
//                (CHEATREAD passes 'own' explicitly since it has no perspective concept).
//   silent:      if true, skip _lastSendAt bookkeeping, skip saveState
//   trackPlayback: if true, push into autoPlay.playbackDom
function chatAddMsg(app, text, author, opts) {
    opts = opts || {};
    var state   = app.state;
    var msgs    = app.msgs;
    var perspective = opts.perspective || state.currentPerspective || 'own';

    var delay;
    if (typeof opts.delay === 'number') {
        delay = opts.delay;
    } else if (opts.silent) {
        delay = 0;
    } else {
        var now = Date.now();
        delay = app._lastSendAt ? (now - app._lastSendAt) : 0;
        app._lastSendAt = now;
    }

    var node = createMsgNode(text, author, delay, false, perspective);
    msgs.appendChild(node);
    app.applyFontSize();

    if (!state.userScrolledUp) {
        if (opts.silent) {
            requestAnimationFrame(function () {
                state.isProgrammaticScroll = true;
                msgs.scrollTop = msgs.scrollHeight;
            });
        } else {
            state.isProgrammaticScroll = true;
            msgs.scrollTop = msgs.scrollHeight;
        }
    }

    if (!opts.silent) app.saveState();

    if (opts.trackPlayback && app.autoPlay && app.autoPlay.active) {
        if (!app.autoPlay.playbackDom) app.autoPlay.playbackDom = [];
        app.autoPlay.playbackDom.push({ text: text, author: author, delay: delay || 0 });
    }

    app.refreshBubbles();
}
