// shared/markdown.js — tiny offline markdown -> html (shared by apps)

function __mdEsc(s) {
    return String(s).replace(/[&<>"']/g, function (m) {
        return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[m];
    });
}

function __md(md) {
    md = String(md == null ? '' : md);
    var ph = [];
    function stash(x) { ph.push(x); return '\u0000' + (ph.length - 1) + '\u0000'; }
    md = md.replace(/```([\s\S]*?)```/g, function (_, c) {
        return stash('<pre><code>' + __mdEsc(c.replace(/^\n/, '')) + '</code></pre>');
    });
    md = md.replace(/`([^`\n]+)`/g, function (_, c) {
        return stash('<code>' + __mdEsc(c) + '</code>');
    });
    md = __mdEsc(md);
    md = md.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, t, u) {
        return '<a href="' + u + '" target="_blank" rel="noopener">' + t + '</a>';
    });
    md = md.replace(/(^|[^"'>])(https?:\/\/[^\s<]+)/g, function (_, p, u) {
        return p + '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>';
    });
    // file:/// links: mark with data-file so the click handler can route them
    // through the local server instead of letting the browser block them.
    md = md.replace(/(^|[^"'>])(file:\/\/[^\s<]+)/g, function (_, p, u) {
        return p + '<a href="' + u + '" data-file="' + u + '">' + u + '</a>';
    });
    md = md.replace(/^### (.*)$/gm, '<h3>$1</h3>');
    md = md.replace(/^## (.*)$/gm,  '<h2>$1</h2>');
    md = md.replace(/^# (.*)$/gm,   '<h1>$1</h1>');
    md = md.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    md = md.replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, '$1<i>$2</i>');
    md = md.replace(/^\s*[-*] (.*)$/gm, '<li>$1</li>');
    md = md.replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>');
    md = md.replace(/<\/ul>\s*<ul>/g, '');
    md = md.replace(/\n{2,}/g, '</p><p>');
    md = md.replace(/\n/g, '<br>');
    md = '<p>' + md + '</p>';
    md = md.replace(/\u0000(\d+)\u0000/g, function (_, i) { return ph[+i]; });
    return md;
}
