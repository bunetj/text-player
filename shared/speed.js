// shared/speed.js — one numeric speed widget, used by all apps.
//
// Replaces per-app range sliders + labels with a plain <input type="number">
// that snaps to `step`, clamps to [min,max], and commits on Enter/blur.
// Apps pass in the element, the numbers, and get/set callbacks; nothing
// about state lives here.
//
//   makeSpeedInput({
//     input,             // the <input type="number"> element
//     min, max, step,    // numbers
//     get,               // () => current value
//     set,               // (n) => void  (app writes state + saveState)
//     onCommit           // optional; called after set(), for extra UI sync
//   })
//
// Returns { refresh, commit, step }.

(function () {
    function snapClamp(n, min, max, step) {
        if (!isFinite(n)) return null;
        var snapped = Math.round(n / step) * step;
        if (snapped < min) snapped = min;
        if (snapped > max) snapped = max;
        return snapped;
    }

    window.makeSpeedInput = function (opts) {
        var input = opts.input;
        if (!input) return null;

        function readCurrent() {
            var v = opts.get();
            return (typeof v === 'number' && isFinite(v)) ? v : opts.min;
        }

        function writeInput(n) { input.value = n; }

        function refresh() { writeInput(readCurrent()); }

        function commit(raw) {
            var n = snapClamp(parseInt(raw, 10), opts.min, opts.max, opts.step);
            if (n === null) n = readCurrent();
            opts.set(n);
            writeInput(n);
            if (typeof opts.onCommit === 'function') opts.onCommit(n);
            return n;
        }

        function step(delta) {
            var n = snapClamp(readCurrent() + delta, opts.min, opts.max, opts.step);
            if (n === null) return;
            opts.set(n);
            writeInput(n);
            if (typeof opts.onCommit === 'function') opts.onCommit(n);
        }

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                commit(this.value);
                this.blur();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                refresh();
                this.blur();
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                setTimeout(function () { commit(input.value); }, 0);
            }
        });

        input.addEventListener('blur', function () { commit(this.value); });

        input.addEventListener('input', function () {
            this.value = this.value.replace(/[^\d]/g, '');
        });

        refresh();
        return { refresh: refresh, commit: commit, step: step };
    };
})();
