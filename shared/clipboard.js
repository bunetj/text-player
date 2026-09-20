// shared/clipboard.js — copy-to-clipboard with legacy fallback

function writeClipboard(text, onResult) {
    onResult = onResult || function () {};
    if (text == null) text = '';

    function tryLegacy() {
        var ok = fallbackCopy(text);
        onResult(ok ? 'ok' : 'fail');
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
            function () { onResult('ok'); },
            function (err) {
                console.warn('clipboard.writeText failed:', err);
                tryLegacy();
            }
        );
    } else {
        tryLegacy();
    }
}

function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.width = '2em';
    ta.style.height = '2em';
    ta.style.padding = '0';
    ta.style.border = 'none';
    ta.style.outline = 'none';
    ta.style.boxShadow = 'none';
    ta.style.background = 'transparent';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    var prevFocus = document.activeElement;
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    var ok = false;
    try { ok = document.execCommand('copy'); }
    catch (e) { console.warn('execCommand failed:', e); }
    document.body.removeChild(ta);
    if (prevFocus && prevFocus.focus) {
        try { prevFocus.focus(); } catch (e) {}
    }
    return ok;
}

function showClipToast(text) {
    /* disabled */
}
