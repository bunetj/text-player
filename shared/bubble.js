function bubbleMarkSides(container, authorPredicate) {
  if (!container) return;
  var nodes = container.children;
  var prevSide = null;
  var runStart = -1;

  function closeRun(endIdx) {
    if (runStart < 0) return;
    for (var k = runStart; k <= endIdx; k++) {
      var el = nodes[k];
      if (el && el.classList) el.classList.remove('is-group-first', 'is-group-last');
    }
    var first = nodes[runStart];
    var last  = nodes[endIdx];
    if (first && first.classList) first.classList.add('is-group-first');
    if (last  && last.classList)  last.classList.add('is-group-last');
    runStart = -1;
  }

  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    if (!n || !n.classList) continue;
    if (!n.classList.contains('msg')) continue;
    var side;
    try { side = authorPredicate(n); } catch (e) { side = 'b'; }
    n.classList.toggle('is-out', side === 'a');
    n.classList.toggle('is-in',  side !== 'a');
    n.classList.remove('can-have-tail');
    var t = n.querySelector(':scope > .bubble-content > .bubble-tail');
    if (t) t.remove();
  }

  for (var j = 0; j < nodes.length; j++) {
    var m = nodes[j];
    if (!m || !m.classList) continue;
    if (!m.classList.contains('msg')) continue;
    var s = m.classList.contains('is-out') ? 'a' : 'b';
    if (s !== prevSide) { closeRun(j - 1); runStart = j; prevSide = s; }
  }
  closeRun(nodes.length - 1);
}
