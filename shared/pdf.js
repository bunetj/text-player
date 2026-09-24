// shared/pdf.js — turn PDF-paste text into normal chat-style text.
//
// PDFs copied to the clipboard produce lines broken at the *page* width,
// not at sentence or paragraph boundaries. This normalizes them:
//
//   1. newline before an uppercase letter  ->  blank line  (paragraph break)
//   2. remaining newlines                  ->  single space
//
// Rules:
//   - case sensitive (\p{Lu} = Unicode uppercase)
//   - idempotent: running twice does not eat paragraph breaks
//   - CRLF normalized to LF first
//
// Exposes: formatAsPdf(text) -> text

(function () {
    function formatAsPdf(text) {
        if (typeof text !== 'string') return text;

        // normalize line endings
        text = text.replace(/\r\n?/g, '\n');

        // 1) newline + optional leading spaces + uppercase  ->  blank line + uppercase
        //    \s* between is safe here: no \n can be consumed because [\n] is
        //    matched first and \s* is anchored right after a newline.
        text = text.replace(/\n[ \t]*(\p{Lu})/gu, '\n\n$1');

        // 2) single newline NOT followed by another newline and NOT followed
        //    by an uppercase letter  ->  single space.
        //    The (?<!\n) and (?!\n) guards keep paragraph breaks intact, so
        //    running the function twice is a no-op on already-formatted text.
        text = text.replace(/(?<!\n)\n(?!\n)(?!\p{Lu})/gu, ' ');

        return text;
    }

    window.formatAsPdf = formatAsPdf;
})();
