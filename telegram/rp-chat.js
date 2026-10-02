// telegram/rp-chat.js
// RP chat half of the app. Owns: state, messages, saveState/loadState,
// openChat, autoplay, commands, modals. Talks to merged-shell.js only
// through the small API at the bottom of this file.
window.RPChat = (function () {
    'use strict';

        // ============================================================
        // RP CHAT — two people, one perspective at a time
        // ============================================================

        // chat id comes from location.hash. empty hash -> feed.
        var CHAT_ID = null;
        var STORE_KEY = null;
        function __hashId() {
            var h = (location.hash || '').replace(/^#/, '');
            if (!h) return null;
            try { return decodeURIComponent(h); } catch (e) { return h; }
        }

        // Intercept clicks on file:/// links (autolinked by __md, or
        // written as [x](file:///...)). The browser blocks file:/// from
        // http:// pages, so route them through the local server.
        (function () {
            document.addEventListener('click', function (e) {
                var a = e.target && e.target.closest ? e.target.closest('a') : null;
                if (!a) return;
                var href = a.getAttribute('href') || '';
                var filePath = a.getAttribute('data-file') || '';
                if (href.indexOf('file:///') === 0) filePath = href;
                if (!filePath || filePath.indexOf('file:///') !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                // file:///C:/Users/... -> C:/Users/...
                var p = decodeURIComponent(filePath.replace(/^file:\/\//, ''));
                fetch('/telegram/open', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: p })
                }).then(function (r) {
                    if (!r.ok) {
                        console.warn('[open] failed', r.status, p);
                    }
                }).catch(function (err) {
                    console.warn('[open] error', err);
                });
            }, true);
        })();

        // Any code that opens a context menu must call this first. Removes
        // every previously opened menu, regardless of which factory made it.
        // Active user folder id, or null if the current one is a system
        // folder (all / unfold / archived). New items created while a user
        // folder is selected get this id in their folderIds.
        function __activeUserFolderId() {
            try {
                if (!window.MergedShell) return null;
                var id = window.MergedShell.activeFolderId() || 'all';
                if (!id || id === 'all' || id === 'unfold' || id === 'archived') return null;
                return id;
            } catch (e) { return null; }
        }

        function __closeAllCtxMenus() {
            var nodes = document.querySelectorAll(
                '.ctx-menu, #__ctxMenu, [data-ctx-menu="1"]'
            );
            for (var i = 0; i < nodes.length; i++) {
                nodes[i].classList.remove('open');
                // Menus created by showFeedRowMenu / showPostMenu are
                // appended to <body> as standalone nodes. Remove them.
                if (nodes[i].getAttribute('data-ctx-menu') === '1') {
                    nodes[i].remove();
                }
            }
        }


        // ---- state ----
        // The live state belongs to exactly one chat: `__currentId`.
        // `freshState(id)` is the only constructor. `__cache` holds state
        // objects for chats loaded earlier in this page's lifetime; on
        // reload it's rebuilt from disk.
        // __cache maps chat id -> { state, msgs }, where msgs is the
        // serialized message array (same shape as blob.msgs). On a re-open
        // within this page's lifetime we repopulate the DOM from the cache
        // instead of re-fetching, so paint and state always agree.
        var __cache     = {};
        var __currentId = null;

        function freshState(id) {
            return {
                id: id,
                people: {
                    own: {
                        name: 'Alex',
                        emoji: '🙂',
                        avatarColor: '#2b5278',
                        myMsgColor: '#2b5278',
                        theirMsgColor: '#2b3b4a',
                    },
                    other: {
                        name: 'Liza',
                        emoji: '👤',
                        avatarColor: '#3a5a2b',
                        myMsgColor: '#2b5278',
                        theirMsgColor: '#2b3b4a',
                    },
                },
                currentPerspective: 'own',
                script: '',
                scriptIndex: 0,
                wpm: 200,
                awaitingText: false,
                awaitingBot: false,
                lastSource: 'text',
                fontSize: 14,
                userScrolledUp: false,
                isProgrammaticScroll: false,
                bot: {
                    active: false,
                    answers: [
                        'ok','yes','idk','what','stop','real','lol','fuck','shit','wtf','mhm','fine',
                        'ок','да','нз','что','хватит','реально','лол','блядь','сука','чзх','пздц','мгм','ладно'
                    ],
                },
            };
        }

        var state = freshState(null);

        // Frozen default persona. New chats must start from this, NOT from
        // whatever `state.people` happens to hold (that is the last opened
        // chat's persona). Use __defaultOther() anywhere a fresh chat row
        // or fresh blob is created.
        var __DEFAULT_OTHER = {
            name: 'Liza',
            emoji: '👤',
            avatarColor: '#3a5a2b',
            myMsgColor: '#2b5278',
            theirMsgColor: '#2b3b4a'
        };
        function __defaultOther() {
            return {
                name: __DEFAULT_OTHER.name,
                emoji: __DEFAULT_OTHER.emoji,
                avatarColor: __DEFAULT_OTHER.avatarColor,
                myMsgColor: __DEFAULT_OTHER.myMsgColor,
                theirMsgColor: __DEFAULT_OTHER.theirMsgColor
            };
        }

        // ---- DOM refs ----
        var msgs         = document.getElementById('msgs');
        var ownInput     = document.getElementById('ownInput');
        var chatName     = document.getElementById('chatName');
        var avatar       = document.getElementById('avatar');

        var modal             = document.getElementById('modal');
        var modalCancel       = document.getElementById('modalCancel');
        var modalSave         = document.getElementById('modalSave');

        // per-person fields in modal
        var mOwnName          = document.getElementById('mOwnName');
        var mOwnEmoji         = document.getElementById('mOwnEmoji');
        var mOwnAvatar        = document.getElementById('mOwnAvatar');
        var mOwnAvatarPreview = document.getElementById('mOwnAvatarPreview');
        var mOwnMy            = document.getElementById('mOwnMy');
        var mOwnMyPreview     = document.getElementById('mOwnMyPreview');
        var mOwnTheir         = document.getElementById('mOwnTheir');
        var mOwnTheirPreview  = document.getElementById('mOwnTheirPreview');

        var mOtherName          = document.getElementById('mOtherName');
        var mOtherEmoji         = document.getElementById('mOtherEmoji');
        var mOtherAvatar        = document.getElementById('mOtherAvatar');
        var mOtherAvatarPreview = document.getElementById('mOtherAvatarPreview');
        var mOtherMy            = document.getElementById('mOtherMy');
        var mOtherMyPreview     = document.getElementById('mOtherMyPreview');
        var mOtherTheir         = document.getElementById('mOtherTheir');
        var mOtherTheirPreview  = document.getElementById('mOtherTheirPreview');

        var clipModal  = document.getElementById('clipModal');
        var clipAll    = document.getElementById('clipAll');
        var clipOwn    = document.getElementById('clipOwn');
        var clipRecv   = document.getElementById('clipRecv');
        var clipReacted= document.getElementById('clipReacted');
        var clipCopy   = document.getElementById('clipCopy');
        var clipCancel = document.getElementById('clipCancel');


        // ============================================================
        // FONT
        // ============================================================

        // ============================================================
        // RENDER — re-derive classes + colors for every .msg from the
        // current perspective. Each msg carries data-author ('own'|'other').
        // ============================================================
        function refreshAllMsgStyles() {
            var p = state.currentPerspective;
            var me = state.people[p];
            var them = state.people[p === 'own' ? 'other' : 'own'];

            // CSS vars used by .msg.own / .msg.recv
            msgs.style.setProperty('--own-color',   me.myMsgColor);
            msgs.style.setProperty('--other-color', me.theirMsgColor); // how *I* see *them*
            msgs.style.setProperty('--react-color', me.myMsgColor);

            // walk messages, re-assign own/recv based on author vs perspective
            var nodes = msgs.querySelectorAll('.msg');
            for (var i = 0; i < nodes.length; i++) {
                var n = nodes[i];
                var author = n.getAttribute('data-author') || 'own';
                var isMine = (author === p);
                n.classList.toggle('own',  isMine);
                n.classList.toggle('recv', !isMine);
            }
            refreshBubbles();
        }

        // Set only the CSS vars that drive bubble colors. Does not touch
        // the header. Safe to call before the message nodes are appended,
        // so the first frame with nodes already has the right palette.
        function setMsgCssVars() {
            var p = state.currentPerspective;
            var me = state.people[p];
            msgs.style.setProperty('--own-color',   me.myMsgColor);
            msgs.style.setProperty('--other-color', me.theirMsgColor);
            msgs.style.setProperty('--react-color', me.myMsgColor);
        }

        // Set the header (name, avatar, input placeholder). Kept separate
        // so __applyStateBlob can avoid calling it before the messages are
        // in place.
        function setHeader() {
            var p = state.currentPerspective;
            var me = state.people[p];
            var them = state.people[p === 'own' ? 'other' : 'own'];
            chatName.textContent = them.name;
            avatar.textContent = them.emoji || '';
            avatar.style.background = them.avatarColor;
            avatar.style.color = textColorForBg(them.avatarColor);
            ownInput.placeholder = 'Message as ' + me.name + '…';
        }

        function updateModeUI() {
            setMsgCssVars();
            setHeader();
            refreshAllMsgStyles();
        }

        function togglePerspective() {
            state.currentPerspective = (state.currentPerspective === 'own') ? 'other' : 'own';
            updateModeUI();
            saveState();
            if (autoPlay.active) autoPlay.onPerspectiveChange();
        }


        // ============================================================
        // MESSAGES
        // ============================================================
        var _lastSendAt = 0;

        var _msgApp = { state: state, msgs: msgs, applyFontSize: applyFontSize,
                        saveState: saveState, refreshBubbles: refreshBubbles, applyFontSize: function () { applyFontSize(msgs, state.fontSize); },
                        autoPlay: null };
        function addMsg(text, author, delayOverride) {
            _msgApp._lastSendAt = _lastSendAt;
            chatAddMsg(_msgApp, text, author,
                       { delay: (typeof delayOverride === 'number') ? delayOverride : undefined });
            _lastSendAt = _msgApp._lastSendAt;
        }

        // ---- bubble side tagging ----
        function refreshBubbles() {
            refreshBubblesFor(msgs, state.currentPerspective);
        }

        function __scrollToBottom() {
    state.isProgrammaticScroll = true;
    msgs.scrollTop = msgs.scrollHeight;
    requestAnimationFrame(function () {
        requestAnimationFrame(function () {
            state.isProgrammaticScroll = true;
            msgs.scrollTop = msgs.scrollHeight;
        });
    });
}

function __readerPlayRemaining() {
    var all = __blocks(state.script || '');
    var idx = state.scriptIndex || 0;
    if (idx >= all.length) { __ph('no script left'); return; }
    __ph('playing');

    function step() {
        if (state.scriptIndex >= all.length) {
            if (autoPlay.timer) { clearTimeout(autoPlay.timer); autoPlay.timer = null; }
            __ph('script finished');
            saveState();
            return;
        }

        // (markers are inline; the line below plays with marker stripped)
        var line = all[state.scriptIndex];
        var d = getDelaySimple(line, state.wpm);
        addMsgSilent(line, 'other', d);
        state.scriptIndex++;
        state.userScrolledUp = false;
        __scrollToBottom();
        saveState();
        autoPlay.timer = setTimeout(step, d);
    }
    step();
}

function sendBotMessage() {
            var answers = state.bot.answers || [];
            if (!answers.length) return;
            var pick = answers[Math.floor(Math.random() * answers.length)];
            // Send as the OTHER person relative to current perspective.
            var themAuthor = (state.currentPerspective === 'own') ? 'other' : 'own';
            addMsg(pick, themAuthor);
            state.userScrolledUp = false;
            __scrollToBottom();
        }

        // LAYER 4: command parser.
        function __blocks(raw) {
            return splitBySeparator(raw, '\n---\n').map(function (s) { return s.trim(); })
                       .filter(function (s) { return s; });
        }
        function __join(arr) { return joinBySeparator(arr, '\n---\n'); }
        var __lastGo = null;
        var __lastGo = null;

        // PATCH #25/#FOCUS: silent feedback via placeholder.
        // Always return focus to the main textbox after commands/formatting.
        function __ph(msg) {
            ownInput.placeholder = msg;
            try {
                ownInput.focus();
            } catch (e) {}
        }

        function __cmd(line) {
            var parts = line.split(/\s+/);
            var cmd = parts[0];
            var args = parts.slice(1);

            if (cmd === '/auto') {
                var all = __blocks(state.script || '');
                var shown = msgs.querySelectorAll('.msg').length;
                if (shown >= all.length) return true;
                var rest = all.slice(shown);

                var seq = [];
                for (var ai = 0; ai < rest.length; ai++) {
                    seq.push({ text: rest[ai], author: 'other', delay: getDelaySimple(rest[ai], state.wpm) });
                }
                autoPlay.seq = seq;
                autoPlay.savedSnapshot = seq.slice();
                autoPlay.nextOwnIdx = 0;
                autoPlay.nextOtherIdx = 0;
                autoPlay.active = true;
                autoPlay.timer = null;
                autoPlay.pending = null;
                autoPlay.frozen = false;
                autoPlay.playbackDom = [];
                autoPlay.scheduleNext(true);
                saveState();
                __ph('auto');
                return true;
            }

            if (cmd === '/play') {
                if (autoPlay.active) { autoPlay.stop(); __ph('stopped'); return true; }
                var all = __blocks(state.script || '');
                if ((state.scriptIndex || 0) < all.length) {
                    // script still has lines: reader-play next, schedule rest
                    __readerPlayRemaining();
                    return true;
                }
                // script exhausted (or empty): replay the recorded chat
                autoPlay.start();
                __ph('playing');
                return true;
            }

            if (cmd === '/stop') {
                if (autoPlay.active) {
                    autoPlay.stop();
                } else {
                    if (autoPlay.timer) { clearTimeout(autoPlay.timer); autoPlay.timer = null; }
                    autoPlay.pending = null;
                    autoPlay.frozen = false;
                    hideTyping();
                    saveState();
                }
                __ph('stopped');
                return true;
            }

            if (cmd === '/help') {
                var lines = [
                    'send empty to receive',
                    '',
                    'replies',
                    '  /bot            randomized replies',
                    '',
                    '  /script         sequenced replies',
                    '  /chat punct     split on punctuation, keep punctuation',
                    '  /chat rem       remove punctuation only',
                    '  /chat low       lowercase the script',
                    '  /chat lines     split on newlines',
                    '  /chat line      collapse into one message',
                    '  /chat sent      split on periods',
                    '  /chat chunk N   split into messages of N words each',
                    '  /chat pdf       unwrap PDF-paste line breaks',
                    '',
                    'play',
                    '  /go "text"   jump to first message containing text',
                    '  /play       play the loaded script; replay the chat',
                    '  /stop       stop playback',
                    '  /cpm N      set script speed to N characters per minute',
                    '',
                    'meta',
                    '  /help       show this',
                ];
                var hb = document.getElementById('helpBody');
                if (hb) hb.textContent = lines.join('\n');
                openModal('helpModal');
                return true;
            }

            if (cmd === '/script') {
                state.mode = 'reader';
                state.awaitingText = true;
                saveState();
                ownInput.value = state.script || '';
                ownInput.placeholder = 'Paste script with --- between messages';
                ownInput.style.height = '160px';
                ownInput.focus();
                ownInput.scrollTop = 0;
                return true;
            }

            if (cmd === '/cpm') {
                var n = parseInt(args[0]);
                if (isFinite(n) && n > 0) state.wpm = n;
                saveState();
                __ph('cpm = ' + state.wpm);
                return true;
            }

            if (cmd === '/go') {
                var rawArg = (line.slice(cmd.length) || '').trim();
                if (!rawArg) {
                    if (!__lastGo) { __ph('no last search'); return true; }
                    rawArg = __lastGo;
                }
                if (rawArg.length >= 2 &&
                    ((rawArg[0] === '"' && rawArg[rawArg.length-1] === '"') ||
                     (rawArg[0] === "'" && rawArg[rawArg.length-1] === "'"))) {
                    rawArg = rawArg.slice(1, -1);
                }
                var allGo = __blocks(state.script || '');
                var needle = rawArg.toLowerCase();
                var target = -1;
                for (var gi = 0; gi < allGo.length; gi++) {
                    if (allGo[gi].toLowerCase().indexOf(needle) !== -1) { target = gi; break; }
                }
                if (target === -1) { __ph('no match: ' + rawArg); return true; }
                state.scriptIndex = target;
                __lastGo = rawArg;
                saveState();
                __ph('at "' + rawArg + '" (' + target + '/' + allGo.length + ')');
                return true;
            }

            
            
            
            if (cmd === '/chat') {
                var chatOps = args.slice();
                var chatIndex = 0;

                function finishChatOps() {
                    state.scriptIndex = 0;
                    saveState();
                    __ph('chat applied');
                }

                function runNextChatOp() {
                    if (chatIndex >= chatOps.length) {
                        finishChatOps();
                        return;
                    }

                    var op = (chatOps[chatIndex] || '').toLowerCase();

                    // ------------------------------------------------
                    // /chat low
                    // ------------------------------------------------
                    if (op === 'low') {
                        state.script = toLower(state.script || '');
                        chatIndex++;
                        runNextChatOp();
                        return;
                    }

                    // ------------------------------------------------
                    // /chat rem
                    // Remove punctuation only.
                    // ------------------------------------------------
                    if (op === 'rem') {
                        var remBlocks = __blocks(state.script || '');
                        var remOut = [];
                        for (var ri = 0; ri < remBlocks.length; ri++) {
                            var remBuf = removePunctuation(remBlocks[ri]).trim();
                            if (remBuf) remOut.push(remBuf);
                        }
                        state.script = __join(remOut);
                        chatIndex++;
                        runNextChatOp();
                        return;
                    }

                    // ------------------------------------------------
                    // /chat newline
                    // ------------------------------------------------
                    if (op === 'lines') {
                        var lineBlocks = __blocks(state.script || '');
                        var lineOut = [];
                        for (var li2 = 0; li2 < lineBlocks.length; li2++) {
                            var lineParts = lineBlocks[li2]
                                .split(/\n+/)
                                .map(function (s) {
                                    return s.trim();
                                })
                                .filter(function (s) {
                                    return s;
                                });
                            for (var lj2 = 0; lj2 < lineParts.length; lj2++) {
                                lineOut.push(lineParts[lj2]);
                            }
                        }
                        state.script = __join(lineOut);

                        chatIndex++;
                        runNextChatOp();
                        return;
                    }

                    // ------------------------------------------------
                    // /chat oneline
                    // ------------------------------------------------
                    if (op === 'line') {
                        var oneParts = __blocks(state.script || '')
                            .map(function (s) {
                                return s.trim();
                            })
                            .filter(function (s) {
                                return s;
                            });

                        state.script = oneParts.join(' ');

                        chatIndex++;
                        runNextChatOp();
                        return;
                    }

                    // ------------------------------------------------
                    // /chat sent
                    // ------------------------------------------------
                    if (op === 'sent') {
                        if (typeof splitSentences !== 'function') {
                            __ph('chat sent: unavailable');
                            return;
                        }

                        var sentOut = [];
                        var sentBlocks = __blocks(state.script || '');

                        for (var si = 0; si < sentBlocks.length; si++) {
                            var sentParts = splitSentences(sentBlocks[si]);

                            for (var sk = 0; sk < sentParts.length; sk++) {
                                if (sentParts[sk] && sentParts[sk].trim()) {
                                    sentOut.push(sentParts[sk].trim());
                                }
                            }
                        }

                        state.script = __join(sentOut);

                        chatIndex++;
                        runNextChatOp();
                        return;
                    }

                    // ------------------------------------------------
                    // /chat chunks N
                    // ------------------------------------------------
                    if (op === 'chunk') {
                        var chunkN = parseInt(chatOps[chatIndex + 1], 10) || 3;

                        var chunkOut = [];
                        var chunkBlocks = __blocks(state.script || '');

                        for (var ci = 0; ci < chunkBlocks.length; ci++) {
                            var words = chunkBlocks[ci]
                                .split(/\s+/)
                                .filter(function (w) {
                                    return w;
                                });

                            for (var ck = 0; ck < words.length; ck += chunkN) {
                                chunkOut.push(
                                    words.slice(ck, ck + chunkN).join(' ')
                                );
                            }
                        }

                        state.script = __join(chunkOut);

                        chatIndex += 2;
                        runNextChatOp();
                        return;
                    }

                    // ------------------------------------------------
                    // /chat pdf
                    // Whole-script transform: no block splitting.
                    // ------------------------------------------------
                    if (op === 'pdf') {
                        if (typeof formatAsPdf !== 'function') {
                            __ph('chat pdf: unavailable');
                            return;
                        }
                        state.script = formatAsPdf(state.script || '');
                        chatIndex++;
                        runNextChatOp();
                        return;
                    }

                    // ------------------------------------------------
                    // /chat punct
                    //
                    // This is the only asynchronous operation.
                    // Everything before it has already been applied.
                    // When the popup closes, continue with the
                    // remaining commands.
                    // ------------------------------------------------
                    if (op === 'punct') {
                        var punctOut = [];
                        var punctBlocks = __blocks(state.script || '');

                        for (var pbi = 0; pbi < punctBlocks.length; pbi++) {
                            var parts = splitPunct(punctBlocks[pbi], { strip: true });
                            for (var pi = 0; pi < parts.length; pi++) {
                                if (parts[pi]) punctOut.push(parts[pi]);
                            }
                        }

                        state.script = __join(punctOut);

                        chatIndex++;
                        runNextChatOp();
                        return;
                    }

                    // Unknown operation
                    __ph('chat: unknown "' + op + '"');
                }

                if (!chatOps.length) {
                    __ph('chat: low | punct | rem | lines | line | sent | chunk N | pdf');
                    return true;
                }

                runNextChatOp();
                return true;
            }

            if (cmd === '/lines') {
                var lineBlocks = __blocks(state.script || '');
                var lineOut = [];

                for (var li = 0; li < lineBlocks.length; li++) {
                    var lineParts = lineBlocks[li]
                        .split(/\n+/)
                        .map(function (s) { return s.trim(); })
                        .filter(function (s) { return s; });

                    for (var lj = 0; lj < lineParts.length; lj++) {
                        lineOut.push(lineParts[lj]);
                    }
                }

                state.script = __join(lineOut);
                saveState();
                __ph('lines applied');
                return true;
            }


                        // BOT EDITOR: /bot opens the bot replies for editing.
            if (cmd === '/bot') {
                state.awaitingBot = true;
                state.awaitingText = false;

                ownInput.value = (state.bot.answers || []).join('\n');
                ownInput.placeholder = 'Bot replies — one message per line';
                ownInput.style.height = '160px';
                ownInput.focus();

                saveState();
                return true;
            }

__ph('unknown command: ' + cmd);
            return false;
        }

        function handleSend() {
            var raw = ownInput.value;

            // Any send clears whatever transient placeholder was set by a
            // command (e.g. /go). Restore the canonical one first; the
            // send paths below may overwrite it again with a fresh hint.
            function __resetPlaceholder() {
                ownInput.placeholder = 'Message as ' +
                    state.people[state.currentPerspective].name + '…';
            }
            if (ownInput.placeholder && ownInput.placeholder.indexOf('Message as ') !== 0) {
                __resetPlaceholder();
            }

            // BOT EDITOR: /bot armed. Save --- separated replies.
            if (state.awaitingBot) {
                if (raw.trim().charAt(0) === '/') {
                    state.awaitingBot = false;
                    updateModeUI();
                    __cmd(raw.trim());
                    ownInput.value = '';
                    ownInput.focus();
                    return;
                }

                var __botBlocks = raw.split(/\r?\n/).map(function(s){ return s.trim(); }).filter(Boolean);

                state.bot.answers = __botBlocks;
                state.bot.active = __botBlocks.length > 0;
                state.awaitingBot = false;
                state.lastSource = 'bot';

                ownInput.value = '';
                ownInput.style.height = '';
                updateModeUI();
                saveState();
                __ph('bot replies updated');
                return;
            }


            // /help is only the initial page-load hint.
            // Any first interaction with the input restores the normal placeholder.
            if (ownInput.placeholder === '/help') {
                ownInput.placeholder =
                    'Message as ' + state.people[state.currentPerspective].name + '…';
            }

            // PATCH #29: /text armed. If a command is typed, cancel awaiting and dispatch it.
            if (state.awaitingText) {
                if (raw.trim().charAt(0) === '/') {
                    state.awaitingText = false;

                    var __textCommandToRemember = raw.trim();
                    __rememberCommand(__textCommandToRemember);

                    updateModeUI();
                    __cmd(__textCommandToRemember);
                    ownInput.value = '';
                    ownInput.focus();
                    return;
                }
                state.script = raw;
                state.scriptIndex = 0;
                state.awaitingText = false;
                state.lastSource = 'text';
                ownInput.value = '';
                ownInput.style.height = '';
                updateModeUI();
                saveState();
                __ph('script updated');
                return;
            }

            // PATCH #34: commands are silent. Don't clear input if /text just filled it.
            if (raw.trim().charAt(0) === '/') {
                var __commandToRemember = raw.trim();

                __rememberCommand(__commandToRemember);
                __cmd(__commandToRemember);

                if (!state.awaitingText && !state.awaitingBot) ownInput.value = '';
                ownInput.focus();
                return;
            }

            if (!raw.trim()) {
                // 1) RP autoplay running -> flush the pending message now
                if (autoPlay.active) {
                    autoPlay.flush();
                    return;
                }
                // 2) deliver by lastSource
                if (state.lastSource === 'text') {
                    var blocks = __blocks(state.script || '');
                    var idx = state.scriptIndex || 0;
                    if (idx < blocks.length) {
                        var line = blocks[idx];
                        var d = getDelaySimple(line, state.wpm);
                        addMsgSilent(line, 'other', d);
                        state.scriptIndex = idx + 1;
                        state.userScrolledUp = false;
                        __scrollToBottom();
                        saveState();
                        return;
                    }
                    // fall through to bot
                }
                if (state.bot.active) {
                    sendBotMessage();
                    state.userScrolledUp = false;
                    __scrollToBottom();
                    return;
                }
                return;
            }

            if (autoPlay.active) {
                addMsgSilent(raw, state.currentPerspective, 0);
                autoPlay.kick();
            } else {
                addMsg(raw, state.currentPerspective);
            }

            state.userScrolledUp = false;
            __scrollToBottom();
            ownInput.value = '';
        }


        // ============================================================
        // NAMES MODAL
        // ============================================================
        function fillModal() {
            var o = state.people.own;
            var t = state.people.other;

            mOwnName.value = o.name;
            mOwnEmoji.value = o.emoji;
            mOwnAvatar.value = o.avatarColor;
            mOwnAvatarPreview.style.background = o.avatarColor;
            mOwnMy.value = o.myMsgColor;
            mOwnMyPreview.style.background = o.myMsgColor;
            mOwnTheir.value = o.theirMsgColor;
            mOwnTheirPreview.style.background = o.theirMsgColor;

            mOtherName.value = t.name;
            mOtherEmoji.value = t.emoji;
            mOtherAvatar.value = t.avatarColor;
            mOtherAvatarPreview.style.background = t.avatarColor;
            mOtherMy.value = t.myMsgColor;
            mOtherMyPreview.style.background = t.myMsgColor;
            mOtherTheir.value = t.theirMsgColor;
            mOtherTheirPreview.style.background = t.theirMsgColor;
        }

        function wireColorPair(hiddenEl, previewEl) {
            previewEl.onclick = function () { hiddenEl.click(); };
            hiddenEl.oninput = function () { previewEl.style.background = hiddenEl.value; };
        }

        wireColorPair(mOwnAvatar, mOwnAvatarPreview);
        wireColorPair(mOwnMy,     mOwnMyPreview);
        wireColorPair(mOwnTheir,  mOwnTheirPreview);
        wireColorPair(mOtherAvatar, mOtherAvatarPreview);
        wireColorPair(mOtherMy,     mOtherMyPreview);
        wireColorPair(mOtherTheir,  mOtherTheirPreview);

        var resetLink = document.getElementById('resetColorsLink');
        if (resetLink) {
            resetLink.onclick = function (e) {
                e.preventDefault();
                resetMsgColors();
            };
        }

                function resetMsgColors() {
            state.people.own.myMsgColor = '#2b5278';
            state.people.own.theirMsgColor = '#2b3b4a';
            state.people.other.myMsgColor = '#2b5278';
            state.people.other.theirMsgColor = '#2b3b4a';
            fillModal();      // repaint pickers + previews
            updateModeUI();   // repaint bubbles
            saveState();      // persist
        }

        modalCancel.onclick = function () { closeModal('modal'); };
        modalSave.onclick = function () {
            var o = state.people.own;
            var t = state.people.other;

            o.name         = mOwnName.value.trim()  || 'Alex';
            o.emoji        = mOwnEmoji.value.trim();
            o.avatarColor  = mOwnAvatar.value       || o.avatarColor;
            o.myMsgColor   = mOwnMy.value           || o.myMsgColor;
            o.theirMsgColor= mOwnTheir.value        || o.theirMsgColor;

            t.name         = mOtherName.value.trim()  || 'Liza';
            t.emoji        = mOtherEmoji.value.trim();
            t.avatarColor  = mOtherAvatar.value       || t.avatarColor;
            t.myMsgColor   = mOtherMy.value           || t.myMsgColor;
            t.theirMsgColor= mOtherTheir.value        || t.theirMsgColor;

            updateModeUI();
            saveState();
            modal.classList.remove('active');
        };
        modal.onclick = function (e) { if (e.target === modal) closeModal('modal'); };


        // ============================================================
        // CLIPBOARD / EXPORT
        // ============================================================

        function exportChat(opts) {
            var res = exportChatShared(msgs, opts, function (isOwn) {
                var a = isOwn ? state.currentPerspective
                              : (state.currentPerspective === 'own' ? 'other' : 'own');
                return state.people[a].name;
            });
            if (!res) { showClipToast('Nothing matched'); return; }
            writeClipboard(res.payload, function (status) {
                showClipToast(status === 'ok' ? ('Copied ' + res.count) : 'Copy blocked');
            });
        }

        initClipModal({ onCopy: exportChat });


        // ---- dev-mode timer helper -----------------------------------
        // Enabled when window.__dev is true (?dev=1 in the URL).
        function __devTime(label, fn) {
            if (!window.__dev) return fn();
            var t0 = performance.now();
            var r = fn();
            var dt = +(performance.now() - t0).toFixed(1);
            try { console.log('[time] ' + label + ' ' + dt + 'ms'); } catch (e) {}
            return r;
        }

        // ============================================================
        // PURE HELPERS — computation only, no I/O, no globals written.
        // These are the testable core of persistence: they take data in
        // and return data out. saveState() orchestrates them and does the
        // I/O (pSave, upsertFeedEntry, renderUnifiedFeed).
        // ============================================================

        // snapshotFromDOM(msgsEl, state, autoPlayState)
        //   Reads the message DOM and the autoplay cursors, returns the
        //   wire-format array of messages. No side effects.
        //   When autoplay is active the DOM holds only the playback view;
        //   the original conversation lives in autoPlay.savedSnapshot.
        function snapshotFromDOM(msgsEl, st, ap) {
            var arr = [];
            var useSnapshot = (ap && ap.active &&
                               ap.savedSnapshot &&
                               ap.savedSnapshot.length);
            if (useSnapshot) {
                for (var si = 0; si < ap.savedSnapshot.length; si++) {
                    var sm = ap.savedSnapshot[si];
                    arr.push({
                        t: sm.text,
                        a: sm.author,
                        r: !!sm.reacted,
                        d: sm.delay || 0,
                    });
                }
                return arr;
            }
            var nodes = msgsEl.querySelectorAll('.msg');
            for (var i = 0; i < nodes.length; i++) {
                var n = nodes[i];
                var raw = n.getAttribute('data-raw');
                if (raw == null) raw = n.textContent;
                arr.push({
                    t: raw,
                    a: n.getAttribute('data-author') || 'own',
                    r: n.classList.contains('reacted'),
                    d: parseInt(n.getAttribute('data-delay') || '0', 10) || 0,
                });
            }
            return arr;
        }

        // autoplayFromState(ap)
        //   Serialize the autoplay cursors for the blob, or null.
        function autoplayFromState(ap) {
            if (!ap || !ap.active) return null;
            return {
                active: true,
                seq: ap.seq,
                nextOwnIdx: ap.nextOwnIdx,
                nextOtherIdx: ap.nextOtherIdx,
                savedSnapshot: ap.savedSnapshot,
                playbackDom: ap.playbackDom || [],
                firstPendingDone: !ap.firstPending,
                pending: ap.pending ? {
                    idx: ap.pending.idx,
                    side: ap.pending.side,
                    frozen: ap.frozen,
                    hasTimer: (ap.timer !== null),
                } : null,
            };
        }

        // feedEntryFrom(state, arr, chatId)
        //   Builds the feed row for the currently-open chat. Pure.
        function feedEntryFrom(st, arr, chatId) {
            var __last = arr.length ? String(arr[arr.length - 1].t || '') : '';
            var __lastClean = __last.replace(/\s+/g, ' ').slice(0, 80);
            var meSide = st.currentPerspective || 'own';
            var themSide = (meSide === 'own') ? 'other' : 'own';
            var them = st.people[themSide] || {};
            return {
                id: chatId,
                title: (them.name || '').trim() || chatId,
                emoji: (them.emoji || '').trim() || '👤',
                avatarColor: them.avatarColor || '#2b5278',
                preview: __lastClean,
                lastLen: arr.length,
                updatedAt: Date.now(),
            };
        }

        // blobFrom(state, arr, ap)
        //   Builds the on-disk blob for the currently-open chat. Pure.
        function blobFrom(st, arr, ap) {
            return {
                msgs: arr,
                people: st.people,
                currentPerspective: st.currentPerspective,
                script: st.script,
                scriptIndex: st.scriptIndex,
                awaitingText: st.awaitingText,
                awaitingBot: st.awaitingBot,
                wpm: st.wpm,
                lastSource: st.lastSource,
                fontSize: st.fontSize,
                autoPlay: ap,
                bot: {
                    active: st.bot.active,
                    answers: st.bot.answers,
                },
            };
        }

        // ============================================================
        // PERSISTENCE
        // ============================================================
        function saveState() {
            var __t0 = (window.__dev && performance) ? performance.now() : 0;
            try {
                var arr = snapshotFromDOM(msgs, state, autoPlay);
                var ap  = autoplayFromState(autoPlay);

                // Feed touch: bump the row for the currently-open chat.
                try {
                    var __touch = feedEntryFrom(state, arr, CHAT_ID);
                    upsertFeedEntry(__touch);
                } catch (e) {}

                var __blob = blobFrom(state, arr, ap);

                // Cache the live state and its DOM snapshot under its own
                // id, then write to disk.
                if (state.id) __cache[state.id] = { state: state, msgs: arr };
                pSave('telegram', STORE_KEY, 'chats/' + CHAT_ID + '.json', __blob);
                if (window.MergedShell) window.MergedShell.renderUnifiedFeed();
            } catch (e) {}
            if (window.__dev) {
                try { console.log('[time] saveState '
                                  + +(performance.now() - __t0).toFixed(1) + 'ms'); } catch (e) {}
            }
        }

        function loadState(onDone) {
            // Always fetch through pLoad. In local mode, that's the disk
            // file; on Pages, it's localStorage. No caching in between.
            pLoad('telegram', STORE_KEY, 'chats/' + CHAT_ID + '.json').then(function (d) {
                if (!d) { if (typeof onDone === 'function') onDone(false); return; }
                __applyStateBlob(d);
                if (typeof onDone === 'function') onDone(true);
            });
            return false;
        }

        function __applyStateBlob(d) {

            if (d.people && d.people.own && d.people.other) {
                state.people = d.people;
            }
            if (d.lastSource === 'text' || d.lastSource === 'bot') state.lastSource = d.lastSource;

if (d.currentPerspective === 'own' || d.currentPerspective === 'other') {
                state.currentPerspective = d.currentPerspective;
            }
            if (typeof d.fontSize === 'number') state.fontSize = d.fontSize;
            if (typeof d.script === 'string') state.script = d.script;
            if (typeof d.scriptIndex === 'number') state.scriptIndex = d.scriptIndex;   // LAYER 2
            if (typeof d.awaitingText === 'boolean') state.awaitingText = d.awaitingText;  // PATCH #49
            if (typeof d.awaitingBot === 'boolean') state.awaitingBot = d.awaitingBot;
                        if (typeof d.wpm === 'number') state.wpm = d.wpm;             // LAYER 4

            // If autoplay is active, the stored `msgs` is the PRE-PLAY chat
            // (kept for the ⏸ restore). We do NOT want it on screen during
            // playback — resume() will rebuild the playback screen from
            // playbackDom instead.
            var apActive = !!(d.autoPlay && d.autoPlay.active);

            // Bot state.
            if (d.bot) {
                if (typeof d.bot.active === 'boolean') state.bot.active = d.bot.active;
                if (Array.isArray(d.bot.answers) && d.bot.answers.length) {
                    state.bot.answers = d.bot.answers;
                }
            }

            // Stash autoplay resume data for boot() to use.
            if (apActive) {
                window.__resumeAutoPlay = d.autoPlay;
            }

            // Set the CSS vars BEFORE appending message nodes, so the
            // first frame with nodes already has the right palette.
            // Do NOT touch the header here; the header is set after the
            // messages are in place, so we never render "new header, no
            // messages" for one frame.
            setMsgCssVars();

            if (!apActive && d.msgs && d.msgs.length) {
                var p = state.currentPerspective;
                for (var i = 0; i < d.msgs.length; i++) {
                    var m = d.msgs[i];
                    var author = m.a || 'own';
                    var el = createMsgNode(m.t, author, m.d || 0, !!m.r, p, (state.people[author]||{}).avatarColor||null);
                    msgs.appendChild(el);
                }
            }

            // Messages in place: now the header can safely update.
            setHeader();
            refreshBubbles();
            // Land on the bottom immediately so the viewport never shows
            // the top of the list for a frame. __scrollToBottom re-scrolls
            // on the next two frames too, which catches late layout.
            __scrollToBottom();
            return true;
        }


        // ============================================================
        // SCROLL + REACTIONS
        // ============================================================
        msgs.addEventListener('scroll', function () {
            if (state.isProgrammaticScroll) { state.isProgrammaticScroll = false; return; }
            state.userScrolledUp = (msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight) >= 10;
        });

        msgs.addEventListener('dblclick', function (e) {
            var msg = e.target.closest('.msg');
            if (!msg) return;
            msg.classList.toggle('reacted');
            saveState();
        });


        // ============================================================
        // COMMAND HISTORY
        // ============================================================

        var __commandHistoryKey = 'tg-rp-command-history';
        var __commandHistory = [];
        var __commandHistoryIndex = -1;
        var __commandHistoryDraft = '';

        // Command history is per page load only.
        function __saveCommandHistory() {}

        function __rememberCommand(command) {
            command = (command || '').trim();

            if (!command || command.charAt(0) !== '/') return;

            if (
                __commandHistory.length &&
                __commandHistory[__commandHistory.length - 1] === command
            ) {
                __commandHistoryIndex = -1;
                __commandHistoryDraft = '';
                return;
            }

            __commandHistory.push(command);

            if (__commandHistory.length > 100) {
                __commandHistory.shift();
            }

            __commandHistoryIndex = -1;
            __commandHistoryDraft = '';

            __saveCommandHistory();
        }

        function __historyUp() {
            if (!__commandHistory.length) return;

            if (__commandHistoryIndex === -1) {
                __commandHistoryDraft = ownInput.value;
                __commandHistoryIndex = __commandHistory.length - 1;
            } else if (__commandHistoryIndex > 0) {
                __commandHistoryIndex--;
            }

            ownInput.value = __commandHistory[__commandHistoryIndex];

            requestAnimationFrame(function () {
                ownInput.selectionStart =
                    ownInput.selectionEnd =
                    ownInput.value.length;
            });
        }

        function __historyDown() {
            if (__commandHistoryIndex === -1) return;

            if (__commandHistoryIndex < __commandHistory.length - 1) {
                __commandHistoryIndex++;
                ownInput.value =
                    __commandHistory[__commandHistoryIndex];
            } else {
                __commandHistoryIndex = -1;
                ownInput.value = __commandHistoryDraft;
                __commandHistoryDraft = '';
            }

            requestAnimationFrame(function () {
                ownInput.selectionStart =
                    ownInput.selectionEnd =
                    ownInput.value.length;
            });
        }

        // ============================================================
        // KEYBOARD
        // ============================================================
        ownInput.addEventListener('keydown', function (e) {
            // history navigation only when the textbox starts with '/'
            var __startsWithSlash = ownInput.value.charAt(0) === '/';

            if (__startsWithSlash && e.key === 'ArrowUp') {
                e.preventDefault();
                __historyUp();
                return;
            }

            if (__startsWithSlash && e.key === 'ArrowDown') {
                e.preventDefault();
                __historyDown();
                return;
            }

            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
                return;
            }

            // PATCH #36: Esc cancels /text view without saving.
            // BOT EDITOR: Esc cancels /bot view without saving.
            if (e.key === 'Escape' && state.awaitingBot) {
                e.preventDefault();
                state.awaitingBot = false;
                ownInput.value = '';
                ownInput.style.height = '';
                updateModeUI();
                saveState();
                return;
            }


            if (e.key === 'Escape' && state.awaitingText) {
                e.preventDefault();
                state.awaitingText = false;
                ownInput.value = '';
                ownInput.style.height = '';
                updateModeUI();
                saveState();
            }
        });
        // mobile send button
        var __sendBtn = document.getElementById('sendBtn');
        if (__sendBtn) {
            __sendBtn.addEventListener('click', function (e) {
                e.preventDefault();
                handleSend();
            });
        }


        // === BOT MODE v1.2 ===

        // --- typing indicator ---
        function showTyping(author) {
            var el = document.getElementById('chatStatus');
            if (!el) return;
            el.textContent = 'typing…';
            el.classList.add('typing');
        }

        function hideTyping() {
            var el = document.getElementById('chatStatus');
            if (!el) return;
            el.textContent = 'online';
            el.classList.remove('typing');
        }

        // ---- BOT DOM (created programmatically) ----
        var botModal = document.createElement('div');
        botModal.className = 'modal';
        botModal.id = 'botModal';
        botModal.innerHTML =
            '<div class="modal-box">' +
            '   <h3>Bot answers</h3>' +
            '   <label class="sub">One answer per line.</label>' +
            '   <textarea id="botTextarea" rows="12" ' +
            '       style="width:100%;padding:8px 12px;background:#333;border:none;' +
            '       border-radius:8px;color:#e0e0e0;font-size:13px;font-family:inherit;' +
            '       resize:vertical;"></textarea>' +
            '   <div class="btn-row">' +
            '       <button class="btn-cancel" id="botCancel">Cancel</button>' +
            '       <button class="btn-save"   id="botSave">Save</button>' +
            '   </div>' +
            '</div>';
        document.body.appendChild(botModal);

        var botTextarea = document.getElementById('botTextarea');
        var botCancel   = document.getElementById('botCancel');
        var botSave     = document.getElementById('botSave');

        botCancel.onclick = function () { closeModal('botModal'); };
        botModal.onclick = function (e) { if (e.target === botModal) closeModal('botModal'); };
        botSave.onclick = function () {
            var lines = botTextarea.value.split(/\r?\n/).map(function (s) { return s.trim(); })
                              .filter(function (s) { return s.length; });
            state.bot.answers = lines.length ? lines : state.bot.answers;
            saveState();
            closeModal('botModal');
        };

        var autoPlay = {
            active: false,
            seq: [],
            nextOwnIdx: 0,
            nextOtherIdx: 0,
            pending: null,
            timer: null,
            pendingDelay: 0,
            frozen: false,     // true => waiting for a user send to start timer
            savedSnapshot: null,
            playbackDom: [],   // [{text, author, delay}] shown during playback

            start: function () {
                var nodes = msgs.querySelectorAll('.msg');
                this.seq = [];
                for (var i = 0; i < nodes.length; i++) {
                    var n = nodes[i];
                    this.seq.push({
                        text:   n.getAttribute('data-raw')    || n.textContent,
                        author: n.getAttribute('data-author') || 'own',
                        delay:  parseInt(n.getAttribute('data-delay') || '0', 10) || 0,
                    });
                }
                if (!this.seq.length) return;

                this.savedSnapshot = [];
                for (var j = 0; j < nodes.length; j++) {
                    var nn = nodes[j];
                    this.savedSnapshot.push({
                        text:    nn.getAttribute('data-raw')    || nn.textContent,
                        author:  nn.getAttribute('data-author') || 'own',
                        delay:   parseInt(nn.getAttribute('data-delay') || '0', 10) || 0,
                        reacted: nn.classList.contains('reacted'),
                    });
                }

                this.nextOwnIdx = 0;
                while (this.nextOwnIdx < this.seq.length &&
                       this.seq[this.nextOwnIdx].author !== 'own') this.nextOwnIdx++;
                this.nextOtherIdx = 0;
                while (this.nextOtherIdx < this.seq.length &&
                       this.seq[this.nextOtherIdx].author !== 'other') this.nextOtherIdx++;

                this.active = true;
                this.timer = null;
                this.pending = null;
                this.frozen = false;

                msgs.innerHTML = '';
                state.userScrolledUp = false;
                this.playbackDom = [];

                this.scheduleNext(true);   // true == this is the first pending
                saveState();
            },

            // Determine the next pending incoming message and set its gate state.
            // isFirst: if true, use the 2s warmup regardless of gate rules.
            scheduleNext: function (isFirst) {
                if (!this.active) return;

                var sideIsOwn = (state.currentPerspective === 'own');
                var idx = sideIsOwn ? this.nextOtherIdx : this.nextOwnIdx;

                if (idx >= this.seq.length) {
                    this.pending = null;
                    this.frozen = false;
                    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
                    return;
                }

                var m = this.seq[idx];

                // Decide gate:
                //   first pending     -> 2s warmup, no gate, runs immediately
                //   prev == myAuthor  -> gated (frozen until send)
                //   else              -> runs immediately
                var prevAuthor = (idx > 0) ? this.seq[idx - 1].author : null;
                var myAuthor   = state.currentPerspective;

                this.pending = {
                    text:   m.text,
                    author: m.author,
                    idx:    idx,
                    side:   sideIsOwn ? 'other' : 'own',
                    delay:  m.delay || 500,
                };
                this.pendingDelay = this.pending.delay;

                if (this.timer) { clearTimeout(this.timer); this.timer = null; }

                if (isFirst && idx === 0) {
                    // 2s warmup: only when the first pending IS the very
                    // first message of the recording.
                    this.frozen = false;
                    showTyping(this.pending.author);
                    var self = this;
                    this.timer = setTimeout(function () {
                        self.timer = null;
                        self.deliver();
                    }, 2000);
                } else if (prevAuthor === myAuthor) {
                    // gated: wait for user's send
                    this.frozen = true;
                } else {
                    // runs immediately
                    this.frozen = false;
                    showTyping(this.pending.author);
                    var self2 = this;
                    this.timer = setTimeout(function () {
                        self2.timer = null;
                        self2.deliver();
                    }, this.pendingDelay);
                }
            },

            deliver: function () {
                if (!this.active) return;
                if (!this.pending) return;

                hideTyping();
                addMsgSilent(this.pending.text, this.pending.author, this.pending.delay || 0);

                if (this.pending.side === 'other') {
                    this.nextOtherIdx = this.pending.idx + 1;
                    while (this.nextOtherIdx < this.seq.length &&
                           this.seq[this.nextOtherIdx].author !== 'other') this.nextOtherIdx++;
                } else {
                    this.nextOwnIdx = this.pending.idx + 1;
                    while (this.nextOwnIdx < this.seq.length &&
                           this.seq[this.nextOwnIdx].author !== 'own') this.nextOwnIdx++;
                }

                this.pending = null;
                this.timer = null;
                this.frozen = false;
                this.scheduleNext(false);
                saveState();
            },

            // Called on every user send during playback.
            // Only affects REPLIES (pending whose recorded predecessor was
            // authored by the current perspective).
            // Continuations are left alone — their timing is not ours to
            // change.
            kick: function () {
                if (!this.active) return;
                if (!this.pending) return;

                var i = this.pending.idx;
                var prevAuthor = (i > 0) ? this.seq[i - 1].author : null;
                var isReply = (prevAuthor === state.currentPerspective);

                if (!isReply) return;   // continuation — leave the timer alone

                if (this.timer) { clearTimeout(this.timer); this.timer = null; }

                var self = this;
                this.frozen = false;
                showTyping(this.pending.author);
                this.timer = setTimeout(function () {
                    self.timer = null;
                    self.deliver();
                }, this.pendingDelay);
                saveState();
            },

            // Empty Enter during playback: if a countdown is running,
            // deliver the pending message immediately. If the pending is
            // frozen or absent, do nothing.
            flush: function () {
                if (!this.active) return;
                if (!this.pending) return;
                if (this.timer === null) return;   // frozen or idle
                clearTimeout(this.timer);
                this.timer = null;
                this.frozen = false;
                this.deliver();
            },

            onPerspectiveChange: function () {
                if (!this.active) return;
                hideTyping();
                if (this.timer) { clearTimeout(this.timer); this.timer = null; }
                this.pending = null;
                this.frozen = false;
                this.scheduleNext(false);
            },

            stop: function () {
                this.active = false;
                hideTyping();
                if (this.timer) { clearTimeout(this.timer); this.timer = null; }

                if (this.savedSnapshot) {
                    msgs.innerHTML = '';
                    for (var i = 0; i < this.savedSnapshot.length; i++) {
                        var m = this.savedSnapshot[i];
                        var el = createMsgNode(m.text, m.author, m.delay || 0, !!m.reacted, state.currentPerspective, (state.people[m.author]||{}).avatarColor||null);
                        msgs.appendChild(el);
                    }
                    applyFontSize(msgs, state.fontSize);
                    state.isProgrammaticScroll = true;
                    msgs.scrollTop = msgs.scrollHeight;
                }

                refreshBubbles();
                this.seq = [];
                this.savedSnapshot = null;
                this.playbackDom = [];
                this.pending = null;
                this.pendingDelay = 0;
                this.frozen = false;
                saveState();
            },

            // Restore playback state from a saved payload.
            // Called from boot() if window.__resumeAutoPlay is set.
            resume: function (d) {
                if (!d || !d.seq || !d.seq.length) return false;

                this.seq = d.seq;
                this.nextOwnIdx = d.nextOwnIdx || 0;
                this.nextOtherIdx = d.nextOtherIdx || 0;
                this.savedSnapshot = d.savedSnapshot || null;
                this.firstPending = !d.firstPendingDone;
                this.active = true;
                this.timer = null;
                this.pending = null;
                this.frozen = false;

                // Rebuild the playback screen from playbackDom.
                msgs.innerHTML = '';
                state.userScrolledUp = false;
                this.playbackDom = d.playbackDom || [];

                for (var pi = 0; pi < this.playbackDom.length; pi++) {
                    var pm = this.playbackDom[pi];
                    // addMsgSilent would append to playbackDom again, so
                    // build the DOM node manually here.
                    var pEl = createMsgNode(pm.text, pm.author, pm.delay || 0, false, state.currentPerspective, (state.people[pm.author]||{}).avatarColor||null);
                    msgs.appendChild(pEl);
                }
                applyFontSize(msgs, state.fontSize);
                state.isProgrammaticScroll = true;
                msgs.scrollTop = msgs.scrollHeight;

                // Re-arm the pending.
                if (d.pending) {
                    // Re-derive pending from the cursors (the saved pending
                    // descriptor carries idx/side/frozen/hasTimer).
                    var sideIsOwn = (state.currentPerspective === 'own');
                    var idx = sideIsOwn ? this.nextOtherIdx : this.nextOwnIdx;
                    if (idx < this.seq.length) {
                        var m = this.seq[idx];
                        this.pending = {
                            text:   m.text,
                            author: m.author,
                            idx:    idx,
                            side:   sideIsOwn ? 'other' : 'own',
                            delay:  m.delay || 500,
                        };
                        this.pendingDelay = this.pending.delay;

                        if (d.pending.frozen) {
                            this.frozen = true;
                            // no timer
                        } else {
                            this.frozen = false;
                            showTyping(this.pending.author);
                            var self = this;
                            this.timer = setTimeout(function () {
                                self.timer = null;
                                self.deliver();
                            }, this.pendingDelay);
                        }
                    } else {
                        // Nothing to arm — idle.
                        this.pending = null;
                        this.frozen = false;
                    }
                } else {
                    // No pending at time of save. Schedule the next one
                    // normally (this may set it as frozen or running).
                    this.scheduleNext(this.firstPending);
                }

                saveState();
                return true;
            },
        };


        // addMsg variant used during playback: doesn't touch _lastSendAt,
        // doesn't saveState, doesn't disturb autoplay.
        function addMsgSilent(text, author, delay) {
            _msgApp.autoPlay = autoPlay;
            chatAddMsg(_msgApp, text, author,
                       { silent: true, delay: delay || 0, trackPlayback: true });
        }

        // ============================================================
        // BOOT
        // ============================================================
        // ============================================================
        // FEED — directory of chats
        // ============================================================
        var FEED_KEY = 'tg_feed_v1';

        // In-memory cache, refreshed from disk on boot. Nothing persists
        // across reload on the client; feed.json on disk is the store.
        var __FEED_CACHE = [];

        function loadFeed() {
            return Array.isArray(__FEED_CACHE) ? __FEED_CACHE : [];
        }

        function saveFeed(arr) {
            arr = arr || [];
            __FEED_CACHE = arr;
            pSave('telegram', FEED_KEY, 'feed.json', arr);
        }

        // One-shot boot sync: fetch feed.json from the server, merge rows
        // whose ids aren't in localStorage, pull in each new chat's blob.
        function syncFeedFromDisk(onDone) {
            var host = location.hostname;
            var isLocal = (host === 'localhost' || host === '127.0.0.1'
                        || host === '' || host === '0.0.0.0');
            if (!isLocal) { if (onDone) onDone(); return; }

            fetch('/data/telegram/feed.json', { cache: 'no-store' })
              .then(function (r) { return r.ok ? r.json() : null; })
              .then(function (fileArr) {
                  __FEED_CACHE = Array.isArray(fileArr) ? fileArr : [];
                  if (window.MergedShell) window.MergedShell.renderUnifiedFeed();
                  if (onDone) onDone();
              })
              .catch(function () { if (onDone) onDone(); });
        }

        // Seed from any existing chat_rp_v1_* keys.
        // Also: if the legacy 'default' chat exists and has no feed
        // entry, promote it to a generated id so it has a real URL.
        // seeding from localStorage is dead. Nothing to migrate.
        function seedFeedFromStorage() { return loadFeed(); }

        function findFeedEntry(id) {
            var feed = loadFeed();
            for (var i = 0; i < feed.length; i++) if (feed[i].id === id) return feed[i];
            return null;
        }

        function upsertFeedEntry(entry) {
            var feed = loadFeed();
            var idx = -1;
            for (var i = 0; i < feed.length; i++) if (feed[i].id === entry.id) { idx = i; break; }
            if (idx === -1) feed.push(entry);
            else feed[idx] = Object.assign({}, feed[idx], entry);
            saveFeed(feed);
        }

        function deleteFeedEntry(id) {
            var feed = loadFeed().filter(function (f) { return f.id !== id; });
            saveFeed(feed);
        }

        // Preview = last message's raw text.
        function chatPreview(id) {
            var f = findFeedEntry(id);
            return (f && f.preview) ? String(f.preview) : '';
        }

        function __newChat() {
            var id = 'c' + Date.now();
            var __defOther = __defaultOther();
            var fids = ['all'];
            var af = (typeof __activeUserFolderId === 'function') ? __activeUserFolderId() : null;
            if (af) fids.push(af);
            upsertFeedEntry({
                id: id,
                title: __defOther.name,
                emoji: __defOther.emoji,
                avatarColor: __defOther.avatarColor,
                updatedAt: Date.now(),
                preview: '',
                lastLen: -1,
                folderIds: fids
            });
            // Open the new chat, and remember the folder so back returns
            // there.
            location.hash = '#' + encodeURIComponent(id);
        }

        function showFeed() {
            // Feed view is owned by merged-shell; just hide the chat.
            var cv = document.getElementById('chatView');
            if (cv) cv.style.display = 'none';
        }
        function showChat(id) {
            var __fv = document.getElementById('feedView');
            if (__fv) __fv.style.display = 'none';
            var cv = document.getElementById('chatView');
            cv.style.display = 'flex';
            cv.classList.add('ready');
        }

        // ============================================================
        // ROUTER
        // ============================================================
        function __route() {
            var id = __hashId();
            if (!id) { showFeed(); return; }
            // (re)boot the chat for this id, unless already booted
            if (window.__bootedFor === id) { showChat(id); return; }
            window.__bootedFor = id;
        }

        // Called by the single Router (in merged-shell) when the hash is
        // a plain chat id. `raw` is the hash without '#', e.g. "c1790…".
        function handleHash(raw) {
            var id = null;
            try { id = decodeURIComponent(raw || ''); } catch (e) { id = raw; }
            if (!id) { return; }
            if (window.__bootedFor === id) { showChat(id); return; }
            openChat(id);
        }

        // ============================================================

        function openChat(id) {
          var __t0 = (window.__dev && performance) ? performance.now() : 0;
          try {
            CHAT_ID = id;
            STORE_KEY = 'chat_rp_v1_' + CHAT_ID;
            window.__bootedFor = CHAT_ID;
            // Hide the message area while we clear and repopulate it.
            // Clearing a scrolled container momentarily resets scrollTop
            // to 0, and if the browser paints in that window the user sees
            // the top of the list for one frame. Invisible is one frame
            // nobody notices; wrong scroll is.
            msgs.style.visibility = 'hidden';
            msgs.innerHTML = '';
            var __cv = document.getElementById('chatView');
            if (__cv) __cv.classList.remove('ready');
            // Ensure feed has an entry for this chat.
            // Title/emoji/color: the other persona (the one you talk to).
            if (!findFeedEntry(CHAT_ID)) {
                var __defOther2 = __defaultOther();
                var __fids2 = ['all'];
                var __af2 = (typeof __activeUserFolderId === 'function') ? __activeUserFolderId() : null;
                if (__af2) __fids2.push(__af2);
                upsertFeedEntry({
                    id: CHAT_ID,
                    title: __defOther2.name,
                    emoji: __defOther2.emoji,
                    avatarColor: __defOther2.avatarColor,
                    updatedAt: Date.now(),
                    preview: '',
                    lastLen: -1,
                    folderIds: __fids2
                });
            }
            var __fv = document.getElementById('feedView');
            if (__fv) __fv.style.display = 'none';

            // Back button -> clear hash (feed).
            var backBtn = document.getElementById('chatBackBtn');
            if (backBtn) backBtn.addEventListener('click', function () {
                var af = (typeof __activeUserFolderId === 'function')
                    ? __activeUserFolderId() : null;
                if (af) {
                    location.hash = '#f/' + encodeURIComponent(af);
                } else {
                    location.hash = '';
                }
            });

            // Initial page-load hint only.
            ownInput.placeholder = '/help';
            // LAYER 3b: real context menu (anchored dropdown).
            (function () {
                var menu = document.createElement('div');
                menu.className = 'ctx-menu';
                menu.id = '__ctxMenu';
                menu.innerHTML =
                    '<button class="ctx-item" data-act="profiles">Profiles</button>' +
                    '<button class="ctx-item" data-act="export">Export</button>' +
                    '<button class="ctx-item" data-act="clear">Clear</button>';
                document.body.appendChild(menu);

                function close() { menu.classList.remove('open'); }

                function open(anchorEl) {
                    __closeAllCtxMenus();
                    var r = anchorEl.getBoundingClientRect();
                    menu.classList.add('open');
                    // measure
                    var mw = menu.offsetWidth, mh = menu.offsetHeight;
                    var left = Math.min(r.right - mw, window.innerWidth - mw - 8);
                    if (left < 8) left = 8;
                    var top = r.bottom + 6;
                    if (top + mh > window.innerHeight - 8) top = r.top - mh - 6;
                    menu.style.left = left + 'px';
                    menu.style.top  = top + 'px';
                }

                var dots = document.getElementById('dotsBtn');
                dots.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (menu.classList.contains('open')) close();
                    else open(dots);
                });

                menu.addEventListener('click', function (e) {
                    var b = e.target.closest('.ctx-item');
                    if (!b) return;
                    var act = b.getAttribute('data-act');
                    close();
                    if (act === 'profiles') {
                        fillModal();
                        openModal('modal');
                        setTimeout(function () { mOwnName.focus(); }, 50);
                    } else if (act === 'export') {
                        openModal('clipModal');
                    } else if (act === 'clear') {
                        if (!confirm('Clear chat?')) return;
                        msgs.innerHTML = '';
                        _lastSendAt = 0;
                        if (autoPlay) {
                            autoPlay.savedSnapshot = null;
                            autoPlay.playbackDom = [];
                        }
                        saveState();
                    }
                });

                document.addEventListener('click', function (e) {
                    if (!menu.classList.contains('open')) return;
                    if (e.target.closest('#__ctxMenu')) return;
                    if (e.target === dots) return;
                    close();
                });

                document.addEventListener('keydown', function (e) {
                    if (e.key === 'Escape') close();
                });
            })();

            // Build menu AFTER loadState so state.mode is final.
            //
            // Paint the chat only after the blob has been applied. Otherwise
            // the first frame uses default people/perspective and then
            // visibly jerks when the real data lands.
            //
            // Bounce rules:
            //   * new id (no feed row yet)  -> file is legitimately absent
            //     until the first save; keep the chat open.
            //   * existing feed row, 404    -> row is stale; bounce to feed.
            // A row we just created in this same call has no file on disk
            // yet. Don't treat that as a stale row; only bounce if the row
            // pre-existed AND had real history (lastLen >= 0).
            var __rowBefore = findFeedEntry(CHAT_ID);
            var __wasReal = !!(__rowBefore && typeof __rowBefore.lastLen === 'number' && __rowBefore.lastLen >= 0);

            // Adopt the cached state if we've already loaded this chat in
            // this page's lifetime. Repopulate the DOM from the cached
            // snapshot, so the first visible frame already has the right
            // messages and sides. No fetch.
            if (__cache[CHAT_ID]) {
                var __c = __cache[CHAT_ID];
                state = __c.state;
                __currentId = CHAT_ID;
                msgs.innerHTML = '';
                // Set CSS vars first, then append. Same reason as
                // __applyStateBlob above.
                updateModeUI();
                var __p = state.currentPerspective;
                for (var __i = 0; __i < __c.msgs.length; __i++) {
                    var __m = __c.msgs[__i];
                    var __author = __m.a || 'own';
                    msgs.appendChild(
                        createMsgNode(__m.t, __author, __m.d || 0, !!__m.r, __p, (state.people[__author]||{}).avatarColor||null)
                    );
                }
                // Land on the bottom before painting, same as the fetch
                // path. Otherwise the cached path can also show the top
                // for a frame.
                __scrollToBottom();
                afterOpenChatPaint();
                return;
            }

            // Not cached: adopt a fresh state NOW, before painting, so the
            // first frame can't show the previous chat's persona or the
            // wrong bubble sides. When the fetch lands, __applyStateBlob
            // overwrites this with the file's data.
            state = freshState(CHAT_ID);
            __currentId = CHAT_ID;

            loadState(function (found) {
                if (window.__bootedFor !== CHAT_ID) return; // a newer chat won
                if (!found && __wasReal) {
                    location.hash = '';
                    if (typeof showFeed === 'function') showFeed();
                    return;
                }
                if (!found) {
                    // Fresh chat: build a state from scratch. No field can
                    // leak from the previous chat because nothing is reused.
                    state = freshState(CHAT_ID);
                    var __row = findFeedEntry(CHAT_ID);
                    if (__row && __row.title) {
                        state.people.other.name = __row.title;
                        if (__row.emoji)       state.people.other.emoji = __row.emoji;
                        if (__row.avatarColor) state.people.other.avatarColor = __row.avatarColor;
                    }
                    __currentId = CHAT_ID;
                    // Write it now so disk and memory agree. saveState()
                    // also caches the {state, msgs} pair.
                    saveState();
                } else {
                    __currentId = CHAT_ID;
                    // Cache the state with the current DOM snapshot, so a
                    // later re-open repaints identically.
                    __cache[CHAT_ID] = {
                        state: state,
                        msgs: snapshotFromDOM(msgs, state, autoPlay)
                    };
                }
                afterOpenChatPaint();
            });

            // Do NOT show the chat or paint the header here. Show the
            // view only from afterOpenChatPaint() once the persona and
            // messages are final, so there is no wrong-then-right frame.
            // showChat() covers the "re-click same row" case.
            // perspective toggle: always available
            var _av = document.getElementById('avatar');
            if (_av) _av.style.cursor = 'pointer';
            if (_av) _av.addEventListener('click', function () { togglePerspective(); });
            if (!window.__altMWired) {
                window.__altMWired = true;
                document.addEventListener('keydown', function (e) {
                    if (e.altKey && e.code === 'KeyM') {
                        e.preventDefault();
                        togglePerspective();
                    }
                });
            }
          } finally {
            if (window.__dev) {
              try { console.log('[time] openChat(' + id + ') sync '
                                + +(performance.now() - __t0).toFixed(1) + 'ms'); } catch (e) {}
            }
          }
        }

        // Runs once loadState has resolved and the blob is applied.
        // Everything that paints the chat and wires one-time modals
        // belongs here so the first visible frame already has the
        // loaded people, perspective, colors and messages.
        function afterOpenChatPaint() {
            applyFontSize(msgs, state.fontSize);
            updateModeUI();

            // PATCH #49: restore /text view after reload.
            if (state.awaitingText) {
                ownInput.value = state.script || '';
                ownInput.placeholder = 'Paste script with --- between messages';
                ownInput.style.height = '160px';
                ownInput.focus();
                ownInput.scrollTop = 0;
            }

            if (window.__resumeAutoPlay) {
                autoPlay.resume(window.__resumeAutoPlay);
                window.__resumeAutoPlay = null;
            }

            var helpModalEl = document.getElementById('helpModal');
            var helpCloseEl = document.getElementById('helpClose');
            if (helpCloseEl) helpCloseEl.onclick = function () { closeModal('helpModal'); };
            if (helpModalEl) helpModalEl.onclick = function (e) { if (e.target === helpModalEl) closeModal('helpModal'); };

            modalInitStack(['clipModal', 'modal', 'botModal', 'helpModal']);

            // Hide is set in openChat. Here: scroll, then wait one
            // frame, scroll again, and only then reveal. The reveal must
            // come after the browser has laid out the appended nodes,
            // otherwise the first visible frame is at scrollTop=0.
            __scrollToBottom();
            requestAnimationFrame(function () {
                msgs.scrollTop = msgs.scrollHeight;
                msgs.style.visibility = '';
            });

            try {
                if (!ownInput.placeholder || ownInput.placeholder === 'Message as Alex…') {
                    ownInput.placeholder = '/help';
                }
                ownInput.focus();
            } catch (e) {}
            var __cv2 = document.getElementById('chatView');
            if (__cv2) { __cv2.style.display = 'flex'; __cv2.classList.add('ready'); }
        }



        function boot() {
            var __id = __hashId();
            syncFeedFromDisk(function () {
                if (!__id) {
                    seedFeedFromStorage();
                    // TGC owns the empty-hash view. Do not paint RP's feed.
                    return;
                }
                // c/ and f/ hashes belong to the merged router.
                if (__id.indexOf('c/') === 0 || __id.indexOf('f/') === 0) return;
                openChat(__id);
            });
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', boot);
        } else {
            boot();
        }
    
    return {
        showChat:        showChat,
        showFeed:        showFeed,
        handleHash:      handleHash,
        loadFeed:        loadFeed,
        saveFeed:        saveFeed,
        findFeedEntry:   findFeedEntry,
        upsertFeedEntry: upsertFeedEntry,
        deleteFeedEntry: deleteFeedEntry,
        openChat:        openChat,

        // ---- debug / testing surface ----------------------------------
        // These are pure; they don't touch the network or the app's DOM.
        // Call them from the console to check the shape of feed rows and
        // blobs without opening a chat.
        freshState:      freshState,
        snapshotFromDOM: snapshotFromDOM,
        feedEntryFrom:   feedEntryFrom,
        blobFrom:        blobFrom,
        autoplayFromState: autoplayFromState,
        __defaultOther:  __defaultOther,

        // _fixture() returns a plausible { state, msgs } pair so you don't
        // have to build them by hand in the console.
        // _dump() returns a JSON-friendly snapshot of the app right now:
        // state, messages, hash, the cache keys, and the io log if dev
        // mode is on. Paste the result when reporting a bug.
        _dump: function () {
            return {
                chatId: CHAT_ID,
                hash: location.hash,
                state: state,
                msgs: (function () {
                    var out = [];
                    var nodes = msgs.querySelectorAll('.msg');
                    for (var i = 0; i < nodes.length; i++) {
                        out.push({
                            t: nodes[i].getAttribute('data-raw'),
                            a: nodes[i].getAttribute('data-author'),
                            cls: nodes[i].className
                        });
                    }
                    return out;
                })(),
                cacheKeys: Object.keys(__cache),
                ioLog: window.__ioLog || [],
                dev: !!window.__dev
            };
        },

        _fixture: function () {
            var st = freshState('cDEBUG');
            st.people.own.name   = 'Alex';
            st.people.other.name = 'Liza';
            var arr = [
                { t: 'hi',  a: 'own',   r: false, d: 0 },
                { t: 'hey', a: 'other', r: false, d: 800 },
                { t: 'ok',  a: 'own',   r: true,  d: 400 }
            ];
            return { state: st, msgs: arr };
        }
    };
})();
