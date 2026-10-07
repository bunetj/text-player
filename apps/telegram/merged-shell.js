// telegram/merged-shell.js
// Merged shell: sidebar, folders, unified feed, channels. Owns the router
// and the "which folder am I in" state. Talks to rp-chat.js only through
// window.RPChat.
window.MergedShell = (function () {
    'use strict';

/* ============================================================================
   __TGC_MERGE__ — folders + channels layered onto the RP chat.

   Storage:
     data/folders.md          — YAML list of folders
     data/feed.json           — RP chat index (unchanged)
     data/chats/<id>.json     — RP chat blobs (unchanged)
     data/channels/<slug>/    — one dir per channel
        meta.md
        N.md
     data/media/avatars/<id>.jpg

   Routing (hash):
     (empty)          -> unified feed
     #f/<folderId>    -> unified feed, folder filter
     #c/<slug>        -> channel view
     #<chatId>        -> RP chat view (existing behavior)

   Server routes (added to code/server.py):
     GET    /telegram/data-bundle
     GET    /telegram/data/<path>
     POST   /telegram/data/<path>
     DELETE /telegram/data/<path>
     POST   /telegram/open
     POST   /telegram/upload
     POST   /telegram/delete-avatar
     POST   /telegram/export
   ============================================================================ */

  // ---- paths (server prefix) ----
  var API = '/telegram';

  // Close every open context menu. Same logic as rp-chat.js has in its
  // own scope; duplicated here because the two modules don't share
  // internals. Called before opening any menu.
  function __closeAllCtxMenus() {
    var nodes = document.querySelectorAll(
      '.ctx-menu, #__ctxMenu, [data-ctx-menu="1"]'
    );
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.remove('open');
      if (nodes[i].getAttribute('data-ctx-menu') === '1') {
        nodes[i].remove();
      }
    }
  }

  // ---- state ----
  var TGC = {
    folders: [],           // [{id,name,icon,color}]  (user folders only; system are synthetic)
    channels: [],          // [{id,slug,title,emoji,avatarColor,avatarPath,desc,folderIds,pinned,posts:[]}]
    activeFolderId: 'all',
    loaded: false,
  };

  // synthetic system folders, always present, in this order
  function systemFolders() {
    return [
      { id: 'all',    name: '',            icon: '📁', isAll: true,  isSystem: true, folderIds: [] },
      { id: 'unfold', name: 'No folder',icon: '📭', isSystem: true, folderIds: [] },
      { id: 'archived', name: 'Archived',  icon: '📦', isSystem: true, folderIds: [] },
    ];
  }

  // ---- tiny helpers ----
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }
  function isLightColor(hex) {
    if (!hex) return false;
    var c = String(hex).replace('#','');
    if (c.length !== 6) return false;
    var r = parseInt(c.slice(0,2),16), g = parseInt(c.slice(2,4),16), b = parseInt(c.slice(4,6),16);
    return ((r*299 + g*587 + b*114)/1000) >= 150;
  }
  function slugify(s) {
    return String(s || '').toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '_')
      .replace(/^_+|_+$/g, '') || 'channel';
  }
  function nowId(prefix) { return (prefix || 'id') + Date.now() + Math.floor(Math.random()*1000); }

  // ---- IO: folders.md ----
  function parseFoldersMd(text) {
    var out = [];
    if (!text) return out;
    var lines = text.replace(/\r\n/g,'\n').split('\n');
    var cur = null;
    function flush() {
      if (cur && cur.id) out.push({
        id: cur.id, name: cur.name || cur.id,
        icon: cur.icon || '📁', color: cur.color || null,
        slug: cur.slug || null
      });
      cur = null;
    }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/\t/g,'    ').trim();
      if (!line || line.charAt(0) === '#' || line === '---') continue;
      var m = line.match(/^-\s+id\s*:\s*(.*)$/);
      if (m) { flush(); cur = { id: stripQuotes(m[1]) }; continue; }
      if (!cur) continue;
      m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
      if (!m) continue;
      var k = m[1], v = stripQuotes(m[2]);
      if (k === 'name') cur.name = v;
      else if (k === 'icon') cur.icon = v;
      else if (k === 'color') cur.color = v || null;
      else if (k === 'slug') cur.slug = v || null;
      else if (k === 'createdAt') {
        var n = parseInt(v, 10);
        if (isFinite(n)) cur.createdAt = n;
      }
    }
    flush();
    var SYS = { all:1, unfold:1, archived:1 };
    return out.filter(function (f) { return !SYS[f.id]; });
  }
  function stripQuotes(s) {
    s = String(s == null ? '' : s).trim();
    if ((s.charAt(0) === '"' && s.charAt(s.length-1) === '"') ||
        (s.charAt(0) === "'" && s.charAt(s.length-1) === "'")) {
      return s.slice(1, -1);
    }
    return s;
  }
  function yamlQuote(s) {
    s = String(s == null ? '' : s);
    if (s === '') return '""';
    if (/[:#\-\{\}\[\],&*?|<>=!%@`"'\n]/.test(s) || /^\s|\s$/.test(s)) {
      return '"' + s.replace(/\\/g,'\\\\').replace(/"/g,'\\"') + '"';
    }
    return s;
  }
  function serializeFoldersMd(folders) {
    var user = folders.filter(function (f) { return !f.isAll && !f.isSystem; });
    var out = ['---','folders:'];
    user.forEach(function (f) {
      out.push('  - id: ' + yamlQuote(f.id));
      if (f.slug) out.push('    slug: ' + yamlQuote(f.slug));
      out.push('    name: ' + yamlQuote(f.name || f.id));
      out.push('    icon: ' + yamlQuote(f.icon || '📁'));
      if (f.color) out.push('    color: ' + yamlQuote(f.color));
      if (typeof f.createdAt !== 'number') f.createdAt = Date.now();
      out.push('    createdAt: ' + f.createdAt);
    });
    out.push('---');
    return out.join('\n') + '\n';
  }

  // ---- IO: channel meta.md ----
  function parseChannelMeta(text, fallbackTitle) {
    var meta = {
      id: '', slug: '', title: fallbackTitle || '', emoji: '', desc: '',
      avatarColor: '', avatar: '', folderIds: null, pinned: '',
      archived: false
    };
    if (!text) return meta;
    var lines = text.replace(/\r\n/g,'\n').split('\n');
    var i = 0;
    while (i < lines.length && lines[i].trim() === '') i++;
    if (lines[i] && lines[i].trim() === '---') i++;
    var listKey = null;
    for (; i < lines.length; i++) {
      var raw = lines[i];
      if (raw.trim() === '---') { i++; break; }
      var line = raw.trim();
      if (!line || line.charAt(0) === '#') continue;
      var lm = line.match(/^-\s+(.*)$/);
      if (lm && listKey) { meta[listKey].push(stripQuotes(lm[1])); continue; }
      var m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
      if (!m) continue;
      var k = m[1], v = stripQuotes(m[2]);
      if (v === '') { meta[k] = []; listKey = k; continue; }
      listKey = null;
      if (k === 'id' || k === 'slug' || k === 'title' || k === 'emoji' ||
          k === 'desc' || k === 'avatarColor' || k === 'color' ||
          k === 'avatar' || k === 'pinned') {
        meta[k] = v;
      } else if (k === 'updatedAt') {
        var n = parseInt(v, 10);
        if (isFinite(n)) meta.updatedAt = n;
      } else if (k === 'archived') {
        meta.archived = (v === 'true' || v === '1' || v === 'yes');
      }
    }
    if (!meta.desc && i < lines.length) meta.desc = lines.slice(i).join('\n').trim();
    if (!meta.avatarColor && meta.color) meta.avatarColor = meta.color;
    return meta;
  }
  function serializeChannelMeta(ch) {
    var out = ['---'];
    if (ch.id) out.push('id: ' + yamlQuote(ch.id));
    if (ch.title) out.push('title: ' + yamlQuote(ch.title));
    if (typeof ch.updatedAt === 'number') out.push('updatedAt: ' + ch.updatedAt);
    if (ch.slug) out.push('slug: ' + yamlQuote(ch.slug));
    if (ch.emoji) out.push('emoji: ' + yamlQuote(ch.emoji));
    if (ch.avatarColor) out.push('avatarColor: ' + yamlQuote(ch.avatarColor));
    if (ch.avatarPath) out.push('avatar: ' + yamlQuote(ch.avatarPath));
    if (ch.pinned) out.push('pinned: ' + yamlQuote(ch.pinned));
    if (ch.archived) out.push('archived: true');
    if (Array.isArray(ch.folderIds) && ch.folderIds.length) {
      out.push('folderIds:');
      ch.folderIds.forEach(function (fid) { out.push('  - ' + yamlQuote(fid)); });
    }
    out.push('---');
    if (ch.desc) out.push(ch.desc);
    return out.join('\n') + '\n';
  }

  // ---- IO: server calls ----
  function apiGet(rel) {
    return fetch(API + '/data/' + rel, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(rel + ' -> ' + r.status);
      return r.json().catch(function () { return r.text(); });
    });
  }
  function apiReadText(rel) {
    return fetch(API + '/data/' + rel, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(rel + ' -> ' + r.status);
      return r.text();
    });
  }
  function apiWriteText(rel, text) {
    return fetch(API + '/data/' + rel, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: text
    }).then(function (r) { if (!r.ok) throw new Error('write ' + rel + ' -> ' + r.status); });
  }
  function apiMkdir(relDir) {
    return fetch(API + '/data/' + relDir, { method: 'POST', body: '' })
      .then(function (r) { if (!r.ok) throw new Error('mkdir ' + relDir + ' -> ' + r.status); });
  }
  function apiDelete(rel) {
    return fetch(API + '/data/' + rel, { method: 'DELETE' })
      .then(function (r) { if (!r.ok) throw new Error('delete ' + rel + ' -> ' + r.status); });
  }

  // ---- localStorage store for the data-bundle ----
  // On GitHub Pages (or when the server is unreachable) this is the
  // ONLY persistent store. Locally, the server mirrors it on disk.
  var BUNDLE_KEY = 'tg_bundle_v1';

  function readBundle() {
    try {
      var raw = localStorage.getItem(BUNDLE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (obj && typeof obj === 'object' && Array.isArray(obj.channels)) return obj;
    } catch (e) {}
    return null;
  }
  function writeBundle(bundle) {
    try { localStorage.setItem(BUNDLE_KEY, JSON.stringify(bundle)); } catch (e) {}
  }

  // ---- load everything ----
  function applyBundle(bundle) {
    var foldersMdText = bundle.foldersMd || '';
    var userFolders = parseFoldersMd(foldersMdText);
    // Newest first for user folders; system folders keep their fixed order
    // (they are prepended, not sorted).
    userFolders.sort(function (a, b) {
      var ca = (typeof a.createdAt === 'number') ? a.createdAt : 0;
      var cb = (typeof b.createdAt === 'number') ? b.createdAt : 0;
      return cb - ca;
    });
    TGC.folders = systemFolders().concat(userFolders);

    var chans = (bundle.channels || []).map(function (rc) {
      var meta = parseChannelMeta(rc.meta || '', rc.slug);
      var posts = (rc.posts || []).map(function (p) {
        return { id: 'p' + p.number, number: p.number, body: p.body };
      });
      var folderIds = Array.isArray(meta.folderIds) ? meta.folderIds.slice() : ['all'];
      if (folderIds.indexOf('all') === -1) folderIds.unshift('all');
      return {
        id: meta.id || meta.slug || slugify(rc.slug),
        slug: meta.slug || rc.slug,
        title: meta.title || rc.slug,
        emoji: meta.emoji || '',
        avatarColor: meta.avatarColor || null,
        avatarPath: meta.avatar || null,
        desc: meta.desc || '',
        pinned: meta.pinned || '',
        archived: !!meta.archived,
        updatedAt: (typeof meta.updatedAt === 'number') ? meta.updatedAt : 0,
        folderIds: folderIds,
        posts: posts,
      };
    });
    TGC.channels = chans;
  }

  // Serialize current in-memory state back to the bundle shape.
  function currentBundle() {
    var channelsOut = TGC.channels.map(function (ch) {
      return {
        slug: ch.slug,
        meta: serializeChannelMeta(ch),
        posts: (ch.posts || []).slice().sort(function (a,b) {
          return (a.number||0)-(b.number||0);
        }).map(function (p) {
          return { number: p.number, body: p.body || '' };
        }),
      };
    });
    return { foldersMd: serializeFoldersMd(TGC.folders), channels: channelsOut };
  }

  // Load: try server first (local case). If it's unreachable (Pages),
  // fall back to localStorage. If neither, start empty.
  function loadAll() {
    return fetch(API + '/data-bundle', { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('bundle -> ' + r.status);
        return r.json();
      })
      .then(function (bundle) {
        applyBundle(bundle);
        writeBundle(bundle);
        TGC.loaded = true;
      })
      .catch(function (e) {
        console.warn('[tgc] bundle from server failed, using localStorage:', e);
        var local = readBundle();
        if (local) {
          applyBundle(local);
        } else {
          TGC.folders = systemFolders();
          TGC.channels = [];
        }
        TGC.loaded = true;
      });
  }

  // ---- save folders.md ----
  function saveFolders() {
    writeBundle(currentBundle());
    var md = serializeFoldersMd(TGC.folders);
    return apiWriteText('folders.md', md).catch(function (e) { /* no server, fine */ });
  }

  // ---- channel dir on disk ----
  function channelDir(ch) {
    return 'channels/' + (ch.slug || slugify(ch.title || ch.id));
  }
  function saveChannelMeta(ch) {
    writeBundle(currentBundle());
    var rel = channelDir(ch);
    return apiMkdir(rel + '/').then(function () {
      return apiWriteText(rel + '/meta.md', serializeChannelMeta(ch));
    }).catch(function (e) { /* no server, fine */ });
  }
  function saveChannelPost(ch, post) {
    writeBundle(currentBundle());
    var rel = channelDir(ch) + '/' + post.number + '.md';
    ch.updatedAt = Date.now();
    return apiWriteText(rel, (post.body || '') + '\n')
      .then(function () {
        // Persist the bump into meta.md so it survives reload.
        return saveChannelMeta(ch);
      })
      .then(function () {
        if (typeof renderUnifiedFeed === 'function') renderUnifiedFeed();
      })
      .catch(function (e) { /* no server, fine */ });
  }
  function deleteChannelPost(ch, number) {
    writeBundle(currentBundle());
    var rel = channelDir(ch) + '/' + number + '.md';
    return apiDelete(rel).catch(function (e) { /* no server, fine */ });
  }

  // =========================================================================
  // SIDEBAR
  // =========================================================================
  var sidebarEl = null;
  var feedTitleEl = null;
  var feedListEl = null;

  function renderSidebar() {
    if (!sidebarEl) return;
    sidebarEl.innerHTML = '';

    var add = document.createElement('div');
    add.className = 'folder-item add-folder';
    add.innerHTML = '<div class="folder-icon">＋</div><div class="folder-label">New</div>';
    add.addEventListener('click', function () { openFolderModal(null); });
    sidebarEl.appendChild(add);

    TGC.folders.forEach(function (f) {
      if (f.id === 'archived' && !hasArchived()) return;
      var el = document.createElement('div');
      el.className = 'folder-item' + (f.id === TGC.activeFolderId ? ' active' : '');
      el.dataset.folderId = f.id;
      el.innerHTML =
        (f.icon ? '<div class="folder-icon">' + escapeHtml(f.icon) + '</div>' : '') +
        (f.isAll ? '' : '<div class="folder-label">' + escapeHtml(f.name) + '</div>');
      el.addEventListener('click', function () { selectFolder(f.id); });
      el.addEventListener('contextmenu', function (e) {
        if (f.isAll || f.isSystem) return;
        e.preventDefault(); e.stopPropagation();
        openFolderModal(f.id);
      });
      sidebarEl.appendChild(el);
    });
  }

  function hasArchived() {
    try {
      var arr = chatList();
      for (var i = 0; i < arr.length; i++) if (arr[i].archived) return true;
    } catch (e) {}
    for (var j = 0; j < TGC.channels.length; j++) if (TGC.channels[j].archived) return true;
    return false;
  }

  function selectFolder(id) {
    TGC.activeFolderId = id || 'all';
    renderSidebar();
    renderUnifiedFeed();
    // Remember the folder in the hash. 'all' clears it, so the default
    // empty-hash route already renders All.
    var want = (TGC.activeFolderId === 'all')
      ? ''
      : '#f/' + encodeURIComponent(TGC.activeFolderId);
    if ((location.hash || '') !== want) {
      // avoid re-triggering route() in a loop: only set when different
      location.hash = want;
    }
  }

  // =========================================================================
  // UNIFIED FEED
  // =========================================================================
  function chatList() {
    // RP's in-memory feed cache.
    try {
      if (window.RPChat && window.RPChat.loadFeed) {
        var arr = window.RPChat.loadFeed();
        if (Array.isArray(arr)) return arr;
      }
    } catch (e) {}
    return [];
  }
  function chatPreview(id) {
    var arr = chatList();
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === id) return String(arr[i].preview || '');
    }
    return '';
  }

  function userFolderIds() {
    return TGC.folders
      .filter(function (f) { return !f.isAll && !f.isSystem; })
      .map(function (f) { return f.id; });
  }
  function itemInFolder(itemFolderIds, folderId, isArchived, userFids) {
    if (!Array.isArray(itemFolderIds)) itemFolderIds = ['all'];
    var arch = !!isArchived;
    userFids = userFids || userFolderIds();

    if (folderId === 'all') {
      // hide archived from All
      return !arch;
    }
    if (folderId === 'unfold') {
      if (arch) return false;                   // hide archived
      for (var i = 0; i < userFids.length; i++) {
        if (itemFolderIds.indexOf(userFids[i]) !== -1) return false;
      }
      return true;
    }
    if (folderId === 'archived') {
      return arch;
    }
    // user folder: show archived too
    return itemFolderIds.indexOf(folderId) !== -1;
  }

  function renderUnifiedFeed() {
    if (!feedListEl) return;
    var folder = TGC.folders.find(function (f) { return f.id === TGC.activeFolderId; }) ||
                 { id: 'all', name: '' };
    feedTitleEl.textContent = folder.isAll ? 'All chats' : (folder.name || 'Folder');

    feedListEl.innerHTML = '';

    // "+ New" row — always first
    (function () {
      var r = document.createElement('div');
      r.className = 'feed-row feed-row-new';
      r.innerHTML =
        '<div class="feed-avatar" style="background:rgba(82,136,193,.12);color:#5288c1;font-size:24px;font-weight:300;">+</div>' +
        '<div class="feed-info"><div class="feed-title" style="color:#5288c1;">New</div></div>';
      r.addEventListener('click', openChooser);
      feedListEl.appendChild(r);
    })();

    var uf = userFolderIds();
    var chats = chatList().filter(function (c) {
      return itemInFolder(c.folderIds || ['all'], TGC.activeFolderId, c.archived, uf);
    });
    var chans = TGC.channels.filter(function (c) {
      return itemInFolder(c.folderIds, TGC.activeFolderId, c.archived, uf);
    });

    var merged = [];
    chats.forEach(function (c) {
      merged.push({ kind: 'chat', id: c.id, updatedAt: c.updatedAt || 0, raw: c });
    });
    chans.forEach(function (c) {
      var lastPost = c.posts && c.posts.length ? c.posts[c.posts.length-1] : null;
      merged.push({
        kind: 'channel', id: c.id, updatedAt: c.updatedAt || (lastPost ? 1 : 0), raw: c
      });
    });
    merged.sort(function (a,b) { return (b.updatedAt||0) - (a.updatedAt||0); });

    if (!merged.length) {
      var empty = document.createElement('div');
      empty.style.cssText = 'padding:20px 14px;color:#708499;font-size:13px;';
      empty.textContent = 'Nothing here yet.';
      feedListEl.appendChild(empty);
      return;
    }

    merged.forEach(function (m) {
      if (m.kind === 'chat') feedListEl.appendChild(makeChatRow(m.raw));
      else                    feedListEl.appendChild(makeChannelRow(m.raw));
    });
  }

// Long-press helper for feed rows.
  function attachLongPress(el, handler) {
    var t = null;
    var fired = false;
    var MOVE = 10;
    var startX = 0, startY = 0;
    function clear() { if (t) { clearTimeout(t); t = null; } }
    el.addEventListener('touchstart', function (e) {
      if (!e.touches || !e.touches.length) return;
      fired = false;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      clear();
      t = setTimeout(function () {
        t = null; fired = true;
        var cx = startX, cy = startY;
        try { if (navigator.vibrate) navigator.vibrate(15); } catch (err) {}
        handler({ preventDefault: function(){}, clientX: cx, clientY: cy, target: el });
      }, 500);
    }, { passive: true });
    el.addEventListener('touchmove', function (e) {
      if (!t || !e.touches || !e.touches.length) return;
      var dx = e.touches[0].clientX - startX;
      var dy = e.touches[0].clientY - startY;
      if (dx*dx + dy*dy > MOVE*MOVE) clear();
    }, { passive: true });
    el.addEventListener('touchend', function () {
      clear();
    }, { passive: true });
    el.addEventListener('touchcancel', clear, { passive: true });
    // Swallow the click that follows a fired long-press.
    el.addEventListener('click', function (e) {
      if (fired) { e.stopPropagation(); e.preventDefault(); fired = false; }
    }, true);
  }

  function makeChatRow(entry) {
    var row = document.createElement('div');
    row.className = 'feed-row';
    var bg = entry.avatarColor || '#2b5278';
    var fg = isLightColor(bg) ? '#000' : '#fff';
    row.innerHTML =
      '<div class="feed-avatar" style="background:' + escapeAttr(bg) + ';color:' + escapeAttr(fg) + '">' +
        escapeHtml(entry.emoji || '👤') +
      '</div>' +
      '<div class="feed-info">' +
        '<div class="feed-title">' + escapeHtml(entry.title || entry.id) + '</div>' +
        '<div class="feed-sub">' + escapeHtml(chatPreview(entry.id) || 'no messages') + '</div>' +
      '</div>';
    row.addEventListener('click', function () {
      location.hash = '#' + encodeURIComponent(entry.id);
    });
    row.addEventListener('contextmenu', function (e) {
      e.preventDefault(); e.stopPropagation();
      showFeedRowMenu(e, 'chat', entry);
    });
    attachLongPress(row, function (e) { showFeedRowMenu(e, 'chat', entry); });
    return row;
  }

  function makeChannelRow(ch) {
    var row = document.createElement('div');
    row.className = 'feed-row';
    var av = '';
    if (ch.avatarPath) {
      av = '<img src="' + escapeAttr(ch.avatarPath) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;">';
    } else {
      av = escapeHtml(ch.emoji || '📢');
    }
    var bg = ch.avatarPath ? 'transparent' : (ch.avatarColor || '#2b3a4a');
    var fg = ch.avatarPath ? '#fff' : (isLightColor(ch.avatarColor||'') ? '#000' : '#fff');
    var lastPost = ch.posts && ch.posts.length ? ch.posts[ch.posts.length-1] : null;
    var preview = lastPost ? String(lastPost.body||'').replace(/\s+/g,' ').slice(0,80) : 'no posts';
    row.innerHTML =
      '<div class="feed-avatar" style="background:' + escapeAttr(bg) + ';color:' + escapeAttr(fg) + '">' +
        av +
      '</div>' +
      '<div class="feed-info">' +
        '<div class="feed-title">📢 ' + escapeHtml(ch.title || ch.slug) + '</div>' +
        '<div class="feed-sub">' + escapeHtml(preview) + '</div>' +
      '</div>';
    row.addEventListener('click', function () {
      location.hash = '#c/' + encodeURIComponent(ch.slug);
    });
    row.addEventListener('contextmenu', function (e) {
      e.preventDefault(); e.stopPropagation();
      showFeedRowMenu(e, 'channel', ch);
    });
    attachLongPress(row, function (e) { showFeedRowMenu(e, 'channel', ch); });
    return row;
  }

  // =========================================================================
  // FEED ROW MENU (archive / add-to-folder / delete)
  // =========================================================================
  function isArchived(item) {
    return !!item.archived;
  }

  function showFeedRowMenu(e, kind, item) {
    __closeAllCtxMenus();
    var menu = document.createElement('div');
    menu.setAttribute('data-ctx-menu', '1');
    menu.style.cssText =
      'position:fixed;background:#17212b;border:1px solid #22303d;z-index:3000;' +
      'padding:4px;min-width:180px;box-shadow:0 8px 32px rgba(0,0,0,.55);';
    var arch = isArchived(item) ? 'Unarchive' : 'Archive';
    menu.innerHTML =
      '<button data-act="archive" style="display:block;width:100%;text-align:left;padding:8px 14px;background:transparent;border:none;color:#c8d1da;cursor:pointer;font-size:13px;font-family:inherit;">' + arch + '</button>' +
      '<button data-act="folder" style="display:block;width:100%;text-align:left;padding:8px 14px;background:transparent;border:none;color:#c8d1da;cursor:pointer;font-size:13px;font-family:inherit;">Add to folder\u2026</button>' +
      '<button data-act="delete" style="display:block;width:100%;text-align:left;padding:8px 14px;background:transparent;border:none;color:#e57373;cursor:pointer;font-size:13px;font-family:inherit;">Delete</button>';
    document.body.appendChild(menu);
    var mw = menu.offsetWidth, mh = menu.offsetHeight;
    var x = Math.min(e.clientX, window.innerWidth - mw - 8);
    var y = Math.min(e.clientY, window.innerHeight - mh - 8);
    menu.style.left = Math.max(8,x) + 'px';
    menu.style.top = Math.max(8,y) + 'px';

    function close() { menu.remove(); document.removeEventListener('click', onDoc); }
    function onDoc(ev) { if (!menu.contains(ev.target)) close(); }
    document.addEventListener('click', onDoc);

    menu.querySelectorAll('button').forEach(function (b) {
      b.onclick = function () {
        var act = b.getAttribute('data-act');
        close();
        if (act === 'archive') {
          item.archived = !item.archived;
          if (kind === 'chat') {
            var arr = chatList().map(function (c) {
              if (c.id === item.id) c.archived = item.archived;
              return c;
            });
            if (window.RPChat) window.RPChat.saveFeed(arr);
            renderUnifiedFeed();
          } else {
            saveChannelMeta(item).then(renderUnifiedFeed);
          }
        } else if (act === 'folder') {
          openAddToFolderModal(kind, item);
        } else if (act === 'delete') {
          if (kind === 'chat') {
            if (!confirm('Delete chat "' + (item.title || item.id) + '"?')) return;
            var __arr2 = chatList().filter(function (c) { return c.id !== item.id; });
            if (window.RPChat) window.RPChat.saveFeed(__arr2);
            pDelete('telegram', 'chat_rp_v1_' + item.id, 'chats/' + item.id + '.json')
              .then(renderUnifiedFeed);
          } else {
            if (!confirm('Delete channel "' + (item.title || item.slug) + '"?')) return;
            apiDelete(channelDir(item) + '/').then(function () {
              TGC.channels = TGC.channels.filter(function (x) { return x.id !== item.id; });
              renderUnifiedFeed();
            });
          }
        }
      };
    });
  }

  function openAddToFolderModal(kind, item) {
    var userFolders = TGC.folders.filter(function (f) { return !f.isAll && !f.isSystem; });
    if (!userFolders.length) {
      alert('No folders yet. Create one with the + in the sidebar.');
      return;
    }
    var overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.85);display:flex;' +
      'align-items:center;justify-content:center;z-index:2200;';
    overlay.innerHTML =
      '<div class="tgc-modal">' +
        '<h3>Add to folder</h3>' +
        '<div class="tgc-check-list" id="atf-list"></div>' +
        '<div class="row-btns">' +
          '<button id="atf-cancel">Cancel</button>' +
          '<button id="atf-save" class="primary">Save</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    var list = overlay.querySelector('#atf-list');
    userFolders.forEach(function (f) {
      var lb = document.createElement('label');
      var on = item.folderIds && item.folderIds.indexOf(f.id) !== -1;
      lb.innerHTML = '<input type="checkbox" data-fid="' + escapeAttr(f.id) + '"' + (on ? ' checked' : '') +
        '><span>' + escapeHtml((f.icon || '📁') + ' ' + (f.name || f.id)) + '</span>';
      list.appendChild(lb);
    });
    function close() { overlay.remove(); }
    overlay.querySelector('#atf-cancel').onclick = close;
    overlay.addEventListener('click', function (ev) { if (ev.target === overlay) close(); });
    overlay.querySelector('#atf-save').onclick = function () {
      var picked = ['all'];
      overlay.querySelectorAll('#atf-list input:checked').forEach(function (i) {
        picked.push(i.getAttribute('data-fid'));
      });
      // preserve "all" plus any system ids already present (none for now)
      item.folderIds = picked;
      close();
      if (kind === 'chat') {
        var arr = chatList().map(function (c) {
          if (c.id === item.id) c.folderIds = picked;
          return c;
        });
        if (window.RPChat) window.RPChat.saveFeed(arr);
        renderUnifiedFeed();
      } else {
        saveChannelMeta(item).then(renderUnifiedFeed);
      }
    };
  }

  // =========================================================================
  // "+" CHOOSER
  // =========================================================================
  var chooserOverlay = null;
  function openChooser() {
    chooserOverlay.classList.add('open');
  }
  function closeChooser() { chooserOverlay.classList.remove('open'); }

  function createChat() {
    closeChooser();
    // Seed from the frozen default persona, not from whatever chat was
    // last open (state.people is stale across chats).
    var id = 'c' + Date.now();
    var arr = chatList();
    var __defOther = (typeof __defaultOther === 'function') ? __defaultOther()
                    : { name: 'Liza', emoji: '👤', avatarColor: '#3a5a2b' };
    var fids = ['all'];
    var af = (typeof __activeUserFolderId === 'function') ? __activeUserFolderId() : null;
    if (af) fids.push(af);
    arr.push({
      id: id,
      title: __defOther.name,
      emoji: __defOther.emoji,
      avatarColor: __defOther.avatarColor,
      updatedAt: Date.now(),
      preview: '',
      lastLen: -1,
      folderIds: fids
    });
    if (window.RPChat) window.RPChat.saveFeed(arr);
    location.hash = '#' + encodeURIComponent(id);
  }
  function createChannel() {
    closeChooser();
    openChannelModal(null);
  }

  // =========================================================================
  // FOLDER MODAL
  // =========================================================================
  var FOLDER_COLORS = ['#e57373','#ffb74d','#ffd54f','#81c784','#4fc3f7','#9575cd','#f06292','#a1887f'];
  var folderOverlay = null, folderModalEl = null;

  function openFolderModal(folderId) {
    var isNew = !folderId;
    var f = isNew
      ? { id: nowId('f'), name: '', icon: '📁', color: null, included: [] }
      : TGC.folders.find(function (x) { return x.id === folderId; });
    if (!f) return;

    if (isNew) {
      f.createdAt = Date.now();
      // Put new folders at the top of the user list. System folders are
      // the first three entries; insert right after them.
      var insertAt = 0;
      while (insertAt < TGC.folders.length && TGC.folders[insertAt].isSystem) insertAt++;
      TGC.folders.splice(insertAt, 0, f);
    }
    // Editing an existing folder: `f` is already in TGC.folders (found by
    // .find above). Do NOT push it again; mutating it in place is enough.

    folderModalEl.innerHTML =
      '<h3>' + (isNew ? 'New Folder' : 'Edit Folder') + '</h3>' +
      '<label>Icon</label>' +
      '<input type="text" id="fm-icon" maxlength="4" value="' + escapeAttr(f.icon || '') + '" style="width:80px;text-align:center;font-size:20px;">' +
      '<label>Folder name</label>' +
      '<input type="text" id="fm-name" value="' + escapeAttr(f.name || '') + '" placeholder="New folder">' +
      '<label>Folder color</label>' +
      '<div class="tgc-color-row" id="fm-colors"></div>' +
      '<label>Include (search)</label>' +
      '<input type="text" id="fm-search" placeholder="Search chats and channels\u2026" autocomplete="off">' +
      '<div class="tgc-check-list" id="fm-list"></div>' +
      '<div class="row-btns">' +
        (isNew ? '' : '<button id="fm-delete" class="danger" style="margin-right:auto;">Delete</button>') +
        '<button id="fm-cancel">Cancel</button>' +
        '<button id="fm-save" class="primary">Save</button>' +
      '</div>';

    var colorRow = folderModalEl.querySelector('#fm-colors');
    var noTag = document.createElement('div');
    noTag.className = 'tgc-color-swatch no-tag' + (f.color === null ? ' selected' : '');
    noTag.textContent = 'No Tag';
    noTag.onclick = function () {
      colorRow.querySelectorAll('.tgc-color-swatch').forEach(function (s) { s.classList.remove('selected'); });
      noTag.classList.add('selected');
      colorRow.dataset.selected = '';
    };
    colorRow.appendChild(noTag);
    colorRow.dataset.selected = f.color || '';
    FOLDER_COLORS.forEach(function (col) {
      var sw = document.createElement('div');
      sw.className = 'tgc-color-swatch' + (f.color === col ? ' selected' : '');
      sw.style.background = col;
      sw.onclick = function () {
        colorRow.querySelectorAll('.tgc-color-swatch').forEach(function (s) { s.classList.remove('selected'); });
        sw.classList.add('selected');
        colorRow.dataset.selected = col;
      };
      colorRow.appendChild(sw);
    });

    // ---- search + checkbox list of chats and channels ----
    // A chat is "in" the folder if its feed entry's folderIds includes f.id.
    // A channel is "in" if its folderIds includes f.id.
    function chatFolderIds(chatId) {
      var arr = chatList();
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === chatId) {
          return Array.isArray(arr[i].folderIds) ? arr[i].folderIds : ['all'];
        }
      }
      return ['all'];
    }
    // working set: item ids currently marked as belonging to f.
    // Seeded from disk, mutated by checkbox clicks, and used by Save.
    // Independent of what is currently rendered, so a new search doesn't
    // drop ticks you made before the search.
    var working = { chat: {}, channel: {} };
    (function seedWorking() {
      chatList().forEach(function (c) {
        var fids = Array.isArray(c.folderIds) ? c.folderIds : ['all'];
        if (fids.indexOf(f.id) !== -1) working.chat[c.id] = true;
      });
      TGC.channels.forEach(function (c) {
        if (Array.isArray(c.folderIds) && c.folderIds.indexOf(f.id) !== -1) {
          working.channel[c.id] = true;
        }
      });
    })();

    function renderFmList(q) {
      var box = folderModalEl.querySelector('#fm-list');
      if (!box) return;
      box.innerHTML = '';
      q = (q || '').toLowerCase().trim();

      var chats = chatList().map(function (c) {
        return { kind: 'chat', id: c.id, title: c.title || c.id, emoji: c.emoji || '\uD83D\uDC64', updatedAt: c.updatedAt || 0 };
      });
      var chans = TGC.channels.map(function (c) {
        return { kind: 'channel', id: c.id, slug: c.slug, title: c.title || c.slug, emoji: c.emoji || '\uD83D\uDCE2', updatedAt: c.updatedAt || 0 };
      });

      var all = chats.concat(chans);
      all.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
      if (q) all = all.filter(function (x) { return (x.title || '').toLowerCase().indexOf(q) !== -1; });

      if (!all.length) {
        var empty = document.createElement('div');
        empty.style.cssText = 'padding:8px;color:#5a6b7a;font-size:12px;';
        empty.textContent = 'No matches';
        box.appendChild(empty);
        return;
      }
      all.forEach(function (x) {
        var on = !!working[x.kind][x.id];

        var lb = document.createElement('label');
        lb.innerHTML =
          '<input type="checkbox" data-kind="' + x.kind + '" data-id="' + escapeAttr(x.id) + '"' +
          (on ? ' checked' : '') + '>' +
          '<span>' + escapeHtml((x.emoji || '') + ' ' + (x.title || x.id)) +
          (x.kind === 'channel' ? ' \uD83D\uDCE2' : '') + '</span>';
        box.appendChild(lb);
      });
    }
    // channel items need folderIds accessible for "on" check; build a lookup
    // (TGC.channels entries already have folderIds)
    (function attachChannelFolderIds() {
      // no-op; TGC.channels already carry .folderIds
    })();

    renderFmList('');
    var searchInput = folderModalEl.querySelector('#fm-search');
    if (searchInput) searchInput.addEventListener('input', function () { renderFmList(this.value); });

    // A checkbox click toggles working. Delegated to the list container
    // so it survives the wholesale re-render on each search.
    var fmList = folderModalEl.querySelector('#fm-list');
    if (fmList) fmList.addEventListener('change', function (e) {
      var inp = e.target;
      if (!inp || inp.tagName !== 'INPUT' || inp.type !== 'checkbox') return;
      var kind = inp.getAttribute('data-kind');
      var id = inp.getAttribute('data-id');
      if (!kind || !id) return;
      if (inp.checked) working[kind][id] = true;
      else            delete working[kind][id];
    });

    folderModalEl.querySelector('#fm-cancel').onclick = function () {
      if (isNew) TGC.folders = TGC.folders.filter(function (x) { return x.id !== f.id; });
      folderOverlay.classList.remove('open');
    };
    folderModalEl.querySelector('#fm-save').onclick = function () {
      f.name = (folderModalEl.querySelector('#fm-name').value || '').trim() || 'New folder';
      f.icon = (folderModalEl.querySelector('#fm-icon').value || '').trim();
      f.color = folderModalEl.querySelector('#fm-colors').dataset.selected || null;

      // apply include list to chats and channels from the working set,
      // not from the DOM. The list only shows the current search, so
      // reading input:checked would drop every tick made before the
      // search.
      var pickedChats = Object.keys(working.chat);
      var pickedChans = Object.keys(working.channel);

      // chats -> update feed.json
      var feedArr = chatList().map(function (c) {
        var on = pickedChats.indexOf(c.id) !== -1;
        var fids = Array.isArray(c.folderIds) ? c.folderIds.slice() : ['all'];
        var has = fids.indexOf(f.id) !== -1;
        if (on && !has) fids.push(f.id);
        if (!on && has) fids = fids.filter(function (x) { return x !== f.id; });
        c.folderIds = fids;
        return c;
      });
      if (window.RPChat) window.RPChat.saveFeed(feedArr);

      // channels -> mutate folderIds and save meta
      TGC.channels.forEach(function (ch) {
        var on = pickedChans.indexOf(ch.id) !== -1;
        var has = ch.folderIds.indexOf(f.id) !== -1;
        if (on && !has) ch.folderIds.push(f.id);
        if (!on && has) ch.folderIds = ch.folderIds.filter(function (x) { return x !== f.id; });
        if (on !== has) saveChannelMeta(ch);
      });

      folderOverlay.classList.remove('open');
      saveFolders().then(function () {
        renderSidebar();
        renderUnifiedFeed();
      });
    };
    var del = folderModalEl.querySelector('#fm-delete');
    if (del) del.onclick = function () {
      if (!confirm('Delete folder "' + f.name + '"?')) return;
      TGC.folders = TGC.folders.filter(function (x) { return x.id !== f.id; });
      TGC.channels.forEach(function (c) {
        c.folderIds = c.folderIds.filter(function (id) { return id !== f.id; });
      });
      folderOverlay.classList.remove('open');
      saveFolders().then(function () {
        renderSidebar();
        renderUnifiedFeed();
      });
    };

    folderOverlay.classList.add('open');
  }

  // =========================================================================
  // CHANNEL MODAL
  // =========================================================================
  var channelOverlay = null, channelModalEl = null;

  var channelBioOverlay = null, channelBioBox = null;

  function openChannelBio(ch) {
    if (!ch) return;
    var emojiHtml;
    if (ch.avatarPath) {
      emojiHtml = '<img src="' + escapeAttr(ch.avatarPath) + '">';
    } else {
      emojiHtml = escapeHtml(ch.emoji || '📢');
    }
    var descHtml = ch.desc ? __md(ch.desc) : '';
    channelBioBox.innerHTML =
      '<div class="bio-emoji">' + emojiHtml + '</div>' +
      '<div class="bio-title">' + escapeHtml(ch.title || ch.slug) + '</div>' +
      (descHtml ? '<div class="bio-desc">' + descHtml + '</div>' : '') +
      '<div class="row-btns">' +
        '<button id="bio-edit" class="primary">Edit</button>' +
        '<button id="bio-close">Close</button>' +
      '</div>';
    channelBioBox.querySelector('#bio-close').onclick = function () {
      channelBioOverlay.classList.remove('open');
    };
    channelBioBox.querySelector('#bio-edit').onclick = function () {
      channelBioOverlay.classList.remove('open');
      openChannelModal(ch.id);
    };
    channelBioOverlay.classList.add('open');
  }

  function openChannelModal(channelId) {
    var isNew = !channelId;
    var ch = isNew
      ? { id: nowId('c'), slug: '', title: '', emoji: '📢', desc: '',
          avatarColor: '#2b3a4a', avatarPath: null, folderIds: ['all'], pinned: '', posts: [] }
      : TGC.channels.find(function (x) { return x.id === channelId; });
    if (!ch) return;

    channelModalEl.innerHTML =
      '<h3>' + (isNew ? 'New Channel' : 'Edit Channel') + '</h3>' +
      '<label>Avatar</label>' +
      '<div class="tgc-avatar-edit">' +
        '<div class="tgc-avatar-preview" id="cm-av">' +
          '<span id="cm-av-emoji">' + escapeAttr(ch.emoji || '') + '</span>' +
          '<img id="cm-av-img" src="' + (ch.avatarPath ? escapeAttr(ch.avatarPath) + '?t=' + Date.now() : '') + '" style="display:' + (ch.avatarPath ? '' : 'none') + ';">' +
          '<div class="tgc-avatar-upload" id="cm-av-upload" title="Upload">📷</div>' +
        '</div>' +
        '<div style="display:flex; flex-direction:column; gap:6px;">' +
          '<input type="text" id="cm-emoji" maxlength="4" value="' + escapeAttr(ch.emoji || '') + '" placeholder="emoji" style="width:80px;text-align:center;font-size:20px;">' +
        '</div>' +
        '<input type="file" id="cm-av-file" accept="image/*" style="display:none;">' +
      '</div>' +
      '<label>Title</label>' +
      '<input type="text" id="cm-title" value="' + escapeAttr(ch.title || '') + '">' +
      '<label>Slug (URL)</label>' +
      '<input type="text" id="cm-slug" value="' + escapeAttr(ch.slug || '') + '" placeholder="channel">' +
      '<div class="hint">a-z, 0-9, dash, underscore. Empty = derived from title.</div>' +
      '<label>Description</label>' +
      '<textarea id="cm-desc" rows="2">' + escapeHtml(ch.desc || '') + '</textarea>' +
      '<label>Folders</label>' +
      '<div class="tgc-check-list" id="cm-folders"></div>' +
      '<div class="row-btns">' +
        (isNew ? '' : '<button id="cm-delete" class="danger" style="margin-right:auto;">Delete</button>') +
        '<button id="cm-cancel">Cancel</button>' +
        '<button id="cm-save" class="primary">Save</button>' +
      '</div>';

    var chosenAvatarPath = ch.avatarPath || null;
    var avImgEl = channelModalEl.querySelector('#cm-av-img');
    var avEmojiEl = channelModalEl.querySelector('#cm-av-emoji');
    function refreshAv() {
      if (chosenAvatarPath) {
        avImgEl.src = chosenAvatarPath + '?t=' + Date.now();
        avImgEl.style.display = '';
        avEmojiEl.style.display = 'none';
      } else {
        avImgEl.style.display = 'none';
        avEmojiEl.style.display = '';
      }
    }
    refreshAv();

    channelModalEl.querySelector('#cm-av-upload').onclick = function () {
      var f = channelModalEl.querySelector('#cm-av-file');
      f.value = ''; f.click();
    };
    channelModalEl.querySelector('#cm-av-file').onchange = function () {
      var f = this.files && this.files[0];
      if (!f) return;
      compressImage(f, 128, 0.85).then(function (dataUrl) {
        return fetch(API + '/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: ch.id, data: dataUrl })
        });
      }).then(function (r) {
        if (!r.ok) throw new Error('upload ' + r.status);
        return r.json();
      }).then(function (j) {
        chosenAvatarPath = j.path;
        refreshAv();
      }).catch(function (e) { alert('Upload failed: ' + e); });
    };
    channelModalEl.querySelector('#cm-emoji').addEventListener('input', function () {
      avEmojiEl.textContent = this.value || '';
    });

    // folders checkboxes
    var box = channelModalEl.querySelector('#cm-folders');
    TGC.folders.forEach(function (f) {
      if (f.isAll || f.isSystem) return;
      var lb = document.createElement('label');
      var checked = ch.folderIds.indexOf(f.id) !== -1;
      lb.innerHTML = '<input type="checkbox" data-folder-id="' + escapeAttr(f.id) + '"' + (checked ? ' checked' : '') + '><span>' + escapeHtml(f.icon + ' ' + f.name) + '</span>';
      box.appendChild(lb);
    });

    channelModalEl.querySelector('#cm-cancel').onclick = function () {
      channelOverlay.classList.remove('open');
    };
    channelModalEl.querySelector('#cm-save').onclick = function () {
      var title = (channelModalEl.querySelector('#cm-title').value || '').trim();
      var slugRaw = (channelModalEl.querySelector('#cm-slug').value || '').trim();
      var desc = (channelModalEl.querySelector('#cm-desc').value || '').trim();
      var emoji = (channelModalEl.querySelector('#cm-emoji').value || '').trim();

      // Fallbacks that don't leak the internal id.
      var baseTitle = title || 'Channel';
      var baseSlug  = slugRaw || slugify(title) || 'channel';
      var slug = baseSlug;
      // If the slug is taken by another channel, add a numeric suffix.
      var n = 2;
      while (TGC.channels.find(function (x) { return x.slug === slug && x.id !== ch.id; })) {
        slug = baseSlug + '-' + n;
        n++;
        if (n > 999) { alert('Slug already used.'); return; }
      }
      if (!/^[A-Za-z0-9_-]+$/.test(slug)) { alert('Bad slug.'); return; }

      var folderIds = ['all'];
      channelModalEl.querySelectorAll('#cm-folders input:checked').forEach(function (i) {
        folderIds.push(i.dataset.folderId);
      });
      // New channel created while a user folder is active: file it there
      // too, in addition to whatever the modal checkboxes picked.
      if (isNew) {
        var af = (typeof __activeUserFolderId === 'function') ? __activeUserFolderId() : null;
        if (af && folderIds.indexOf(af) === -1) folderIds.push(af);
      }

      ch.title = baseTitle;
      ch.slug = slug;
      ch.desc = desc;
      ch.emoji = emoji;
      ch.avatarPath = chosenAvatarPath;
      ch.folderIds = folderIds;

      if (isNew) TGC.channels.push(ch);

      saveChannelMeta(ch).then(function () {
        channelOverlay.classList.remove('open');
        renderUnifiedFeed();
        // Open the channel after save, new or existing.
        location.hash = '#c/' + encodeURIComponent(ch.slug);
      });
    };
    var del = channelModalEl.querySelector('#cm-delete');
    if (del) del.onclick = function () {
      if (!confirm('Delete channel "' + ch.title + '"?')) return;
      apiDelete(channelDir(ch) + '/').then(function () {
        TGC.channels = TGC.channels.filter(function (x) { return x.id !== ch.id; });
        channelOverlay.classList.remove('open');
        renderUnifiedFeed();
        location.hash = '';
      });
    };

    channelOverlay.classList.add('open');
  }

  // ---- image compress ----
  function compressImage(file, size, quality) {
    return new Promise(function (resolve, reject) {
      var rd = new FileReader();
      rd.onerror = function () { reject(new Error('read failed')); };
      rd.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('image load failed')); };
        img.onload = function () {
          var c = document.createElement('canvas');
          c.width = size; c.height = size;
          var ctx = c.getContext('2d');
          var sw = img.naturalWidth, sh = img.naturalHeight;
          var side = Math.min(sw, sh);
          ctx.drawImage(img, (sw-side)/2, (sh-side)/2, side, side, 0, 0, size, size);
          try { resolve(c.toDataURL('image/jpeg', quality || 0.85)); }
          catch (e) { reject(e); }
        };
        img.src = rd.result;
      };
      rd.readAsDataURL(file);
    });
  }

  // =========================================================================
  // CHANNEL VIEW
  // =========================================================================
  var channelViewEl = null;
  var channelPostsEl = null;
  var channelHeaderTitleEl = null;
  var channelHeaderEmojiEl = null;
  var channelHeaderInfoEl = null;
  var channelInputEl = null;
  var channelSendEl = null;
  var channelBackEl = null;
  var pinnedBarEl = null;

  var openedChannelSlug = null;
  var editingPostId = null;

  function getOpenedChannel() {
    return TGC.channels.find(function (c) { return c.slug === openedChannelSlug; }) || null;
  }

  function openChannelView(slug, opts) {
    var ch = TGC.channels.find(function (c) { return c.slug === slug; });
    if (!ch) { location.hash = ''; return; }
    openedChannelSlug = slug;
    editingPostId = null;

    document.body.classList.add('channel-open');
    document.body.classList.add('inner-view');
    channelViewEl.classList.add('open');

    // hide the RP chat surfaces so only the channel is visible
    var rpChat = document.getElementById('chatView');
    if (rpChat) rpChat.style.display = 'none';
    var rpFeed = document.getElementById('feedView');
    if (rpFeed) rpFeed.style.display = 'none';
    var fv = document.getElementById('feedViewUnified');
    if (fv) fv.classList.remove('open');

    renderChannelView();
    requestAnimationFrame(__autoResizeChannelInput);
    if (!opts || !opts.skipHash) {
      if (location.hash !== '#c/' + encodeURIComponent(slug)) {
        location.hash = '#c/' + encodeURIComponent(slug);
      }
    }
  }

  function closeChannelView() {
    openedChannelSlug = null;
    editingPostId = null;
    document.body.classList.remove('channel-open');
    document.body.classList.remove('inner-view');
    channelViewEl.classList.remove('open');
  }

  function renderChannelView() {
    var ch = getOpenedChannel();
    if (!ch) return;

    if (ch.avatarPath) {
      channelHeaderEmojiEl.innerHTML = '<img src="' + escapeAttr(ch.avatarPath) + '">';
      channelHeaderEmojiEl.style.background = 'transparent';
    } else {
      channelHeaderEmojiEl.textContent = ch.emoji || '';
      channelHeaderEmojiEl.style.background = ch.avatarColor || '';
    }
    channelHeaderTitleEl.textContent = ch.title || 'Channel';

    renderPinned(ch);

    channelPostsEl.innerHTML = '';
    if (!ch.posts || !ch.posts.length) {
      var e = document.createElement('div');
      e.className = 'post-empty';
      e.textContent = 'No posts yet.';
      channelPostsEl.appendChild(e);
    } else {
      ch.posts.slice().sort(function (a,b) { return (a.number||0)-(b.number||0); }).forEach(function (p) {
        var el = document.createElement('div');
        el.className = 'post' + (ch.pinned === p.id ? ' pinned' : '');
        el.dataset.postId = p.id;
        el.dataset.postNumber = p.number || '';

        var nameEl = document.createElement('span');
        nameEl.className = 'post-author';
        nameEl.textContent = ch.title || ch.slug || '';

        var bodyEl = document.createElement('span');
        bodyEl.className = 'post-body';
        // Posts are always authored by the channel, and they support the
        // same markdown as chat messages. Links autolink via __md.
        bodyEl.innerHTML = __md(p.body || '');

        el.appendChild(nameEl);
        el.appendChild(bodyEl);

        el.addEventListener('contextmenu', function (e) {
          // Only open on the bubble background. Ignore right-clicks on
          // links, on selected text, and inside interactive content.
          var t = e.target;
          if (t && t.closest && t.closest('a')) return;
          var sel = window.getSelection && window.getSelection();
          if (sel && !sel.isCollapsed && sel.toString().length) return;
          e.preventDefault(); e.stopPropagation();
          showPostMenu(e, ch, p);
        });
        channelPostsEl.appendChild(el);
      });
    }
  }

  function renderPinned(ch) {
    if (!ch.pinned) { pinnedBarEl.style.display = 'none'; pinnedBarEl.innerHTML = ''; return; }
    var p = (ch.posts || []).find(function (x) { return x.id === ch.pinned; });
    if (!p) { pinnedBarEl.style.display = 'none'; pinnedBarEl.innerHTML = ''; return; }
    var raw = String(p.body || '').replace(/[#*`>\[\]]/g,'').replace(/\s+/g,' ').trim().slice(0,80);
    pinnedBarEl.innerHTML =
      '<span class="pin-icon">📌</span>' +
      '<div class="pin-text"><span class="pin-label">Pinned</span><span>' + escapeHtml(raw) + '</span></div>';
    pinnedBarEl.style.display = 'flex';
    pinnedBarEl.onclick = function () {
      var el = channelPostsEl.querySelector('.post[data-post-id="' + p.id + '"]');
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
  }

  function showPostMenu(e, ch, post) {
    __closeAllCtxMenus();
    var menu = document.createElement('div');
    menu.setAttribute('data-ctx-menu', '1');
    menu.style.cssText = 'position:fixed;background:#17212b;border:1px solid #22303d;z-index:3000;padding:4px;min-width:160px;box-shadow:0 8px 32px rgba(0,0,0,.55);';
    menu.innerHTML =
      '<button data-act="edit" style="display:block;width:100%;text-align:left;padding:8px 14px;background:transparent;border:none;color:#c8d1da;cursor:pointer;font-size:13px;font-family:inherit;">Edit</button>' +
      '<button data-act="pin" style="display:block;width:100%;text-align:left;padding:8px 14px;background:transparent;border:none;color:#c8d1da;cursor:pointer;font-size:13px;font-family:inherit;">' + (ch.pinned === post.id ? 'Unpin' : 'Pin') + '</button>' +
      '<button data-act="delete" style="display:block;width:100%;text-align:left;padding:8px 14px;background:transparent;border:none;color:#e57373;cursor:pointer;font-size:13px;font-family:inherit;">Delete</button>';
    document.body.appendChild(menu);
    var mw = menu.offsetWidth, mh = menu.offsetHeight;
    var x = Math.min(e.clientX, window.innerWidth - mw - 8);
    var y = Math.min(e.clientY, window.innerHeight - mh - 8);
    menu.style.left = Math.max(8,x) + 'px';
    menu.style.top = Math.max(8,y) + 'px';

    function close() { menu.remove(); document.removeEventListener('click', onDoc); }
    function onDoc(ev) { if (!menu.contains(ev.target)) close(); }
    document.addEventListener('click', onDoc);

    menu.querySelectorAll('button').forEach(function (b) {
      b.onclick = function () {
        var act = b.getAttribute('data-act');
        close();
        if (act === 'edit') {
          editingPostId = post.id;
          channelInputEl.value = post.body || '';
          channelInputEl.focus();
          requestAnimationFrame(__autoResizeChannelInput);
        } else if (act === 'pin') {
          ch.pinned = (ch.pinned === post.id) ? '' : post.id;
          saveChannelMeta(ch).then(renderChannelView);
        } else if (act === 'delete') {
          if (!confirm('Delete post?')) return;
          ch.posts = ch.posts.filter(function (x) { return x.id !== post.id; });
          if (ch.pinned === post.id) ch.pinned = '';
          deleteChannelPost(ch, post.number).then(function () {
            saveChannelMeta(ch).then(renderChannelView);
          });
        }
      };
    });
  }

  function __autoResizeChannelInput() {
    if (!channelInputEl) return;
    channelInputEl.style.height = 'auto';
    channelInputEl.style.height = Math.min(channelInputEl.scrollHeight, 140) + 'px';
  }

  function submitPost() {
    var ch = getOpenedChannel();
    if (!ch) return;
    var body = (channelInputEl.value || '').trim();
    if (!body) return;

    if (editingPostId) {
      var p = ch.posts.find(function (x) { return x.id === editingPostId; });
      if (p) {
        p.body = body;
        saveChannelPost(ch, p).then(function () {
          editingPostId = null;
          channelInputEl.value = '';
          channelInputEl.style.height = '';
          __autoResizeChannelInput();
          renderChannelView();
        });
      }
      return;
    }
    var max = 0;
    ch.posts.forEach(function (p) { if (p.number > max) max = p.number; });
    var np = { id: 'p' + Date.now(), number: max + 1, body: body };
    ch.posts.push(np);
    saveChannelPost(ch, np).then(function () {
      channelInputEl.value = '';
      channelInputEl.style.height = '';
      renderChannelView();
      // Focus the newly added post: scroll the list to the bottom.
      requestAnimationFrame(function () {
        channelPostsEl.scrollTop = channelPostsEl.scrollHeight;
      });
    });
  }

  // =========================================================================
  // ROUTER — one dispatcher, one hashchange listener. Every destination
  // registers itself with a prefix; dispatch picks the longest match.
  //
  //   'c/...'  -> channel (opened by merged)
  //   'f/...'  -> folder filter (opened by merged)
  //   'chat'   -> a plain id -> RP chat (opened by rp-chat.js)
  //   ''       -> unified feed (opened by merged)
  //
  // Registration order matters only for ties. `dispatch` picks the
  // longest matching prefix, so 'c/' always beats '' for a hash that
  // starts with 'c/'.
  // =========================================================================
  var Router = {
    routes: [],
    register: function (prefix, handler) {
      this.routes.push({ prefix: prefix, handler: handler });
      // longest prefix first
      this.routes.sort(function (a, b) { return b.prefix.length - a.prefix.length; });
    },
    dispatch: function (hash) {
      var h = (hash || '').replace(/^#/, '');
      for (var i = 0; i < this.routes.length; i++) {
        var r = this.routes[i];
        if (r.prefix === '' || h.indexOf(r.prefix) === 0) {
          r.handler(h.slice(r.prefix.length), h);
          return;
        }
      }
    },
  };

  // Legacy route() kept for callers that still ask for it (boot, RP's
  // hashchange dispatch of empty hash). It now just defers to Router.
  function route() {
    Router.dispatch(location.hash);
  }

  // merged's own handlers
  function routeChannel(slug) {
    if (!TGC.channels.find(function (c) { return c.slug === slug; })) {
      location.hash = '';
      return;
    }
    closeChatView();
    openChannelView(slug, { skipHash: true });
  }
  function routeFolder(fid) {
    closeChannelView();
    closeChatView();
    var exists = TGC.folders.some(function (f) { return f.id === fid; });
    if (!exists) {
      TGC.activeFolderId = 'all';
      location.hash = '';
      renderSidebar();
      showUnifiedFeed();
      renderUnifiedFeed();
      return;
    }
    TGC.activeFolderId = fid;
    renderSidebar();
    showUnifiedFeed();
    renderUnifiedFeed();
  }
  function routeFeed() {
    closeChannelView();
    closeChatView();
    TGC.activeFolderId = 'all';
    renderSidebar();
    showUnifiedFeed();
    renderUnifiedFeed();
  }

  // Older bodies of route() kept as dead code would be confusing; skip
  // them entirely by jumping straight past the old function.
  function __unused_old_route() {
    if (!TGC.loaded) return;
    var h = (location.hash || '').replace(/^#/, '');
    if (h.indexOf('c/') === 0) {
      var slug = decodeURIComponent(h.slice(2));
      // ensure channel exists
      if (!TGC.channels.find(function (c) { return c.slug === slug; })) {
        location.hash = '';
        return;
      }
      closeChatView();
      openChannelView(slug, { skipHash: true });
      return;
    }
    if (h.indexOf('f/') === 0) {
      var fid = decodeURIComponent(h.slice(2));
      closeChannelView();
      closeChatView();
      // If the folder no longer exists, fall back to All (and clear hash).
      var exists = TGC.folders.some(function (f) { return f.id === fid; });
      if (!exists) {
        TGC.activeFolderId = 'all';
        location.hash = '';
        renderSidebar();
        showUnifiedFeed();
        renderUnifiedFeed();
        return;
      }
      TGC.activeFolderId = fid;
        renderSidebar();
      showUnifiedFeed();
      renderUnifiedFeed();
      return;
    }
    if (h) {
      // chat id — let RP chat handle it (its own boot() reloads on hashchange)
      closeChannelView();
      hideUnifiedFeed();
      var cv = document.getElementById('channelView');
      if (cv) cv.classList.remove('open');
      return;
    }
    // (a hash of the form "c/..." that isn't a known channel has already
    //  been cleared above; nothing else to do.)
    // empty hash -> unified feed
    closeChannelView();
    closeChatView();
    TGC.activeFolderId = 'all';
    renderSidebar();
    showUnifiedFeed();
    renderUnifiedFeed();
  }

  function showUnifiedFeed() {
    var fv = document.getElementById('feedViewUnified');
    if (fv) fv.classList.add('open');
    var rpFeed = document.getElementById('feedView');
    if (rpFeed) rpFeed.style.display = 'none';
    var rpChat = document.getElementById('chatView');
    if (rpChat) rpChat.style.display = 'none';
    document.body.classList.remove('inner-view');
  }
  function hideUnifiedFeed() {
    var fv = document.getElementById('feedViewUnified');
    if (fv) fv.classList.remove('open');
    document.body.classList.add('inner-view');
  }
  function closeChatView() {
    var rpChat = document.getElementById('chatView');
    if (rpChat) rpChat.style.display = 'none';
  }

  // =========================================================================
  // BOOT
  // =========================================================================
  function boot() {
    sidebarEl = document.getElementById('sidebar');
    feedTitleEl = document.getElementById('feedUnifiedTitle');
    feedListEl = document.getElementById('feedUnifiedList');
    chooserOverlay = document.getElementById('tgcChooserOverlay');
    folderOverlay = document.getElementById('tgcFolderOverlay');
    folderModalEl = document.getElementById('tgcFolderModal');
    channelOverlay = document.getElementById('tgcChannelOverlay');
    channelModalEl = document.getElementById('tgcChannelModal');
    channelBioOverlay = document.getElementById('tgcChannelBioOverlay');
    channelBioBox = document.getElementById('tgcChannelBioBox');

    channelViewEl = document.getElementById('channelView');
    channelPostsEl = document.getElementById('channelPosts');
    channelHeaderTitleEl = document.getElementById('channelHeaderTitle');
    channelHeaderEmojiEl = document.getElementById('channelHeaderEmoji');
    channelHeaderInfoEl = document.getElementById('channelHeaderInfo');
    channelInputEl = document.getElementById('channelInput');
    channelSendEl = document.getElementById('channelSend');
    channelBackEl = document.getElementById('channelBack');
    pinnedBarEl = document.getElementById('pinnedBar');

    // chooser
    document.getElementById('chooseChat').onclick = createChat;
    document.getElementById('chooseChannel').onclick = createChannel;
    document.getElementById('chooseCancel').onclick = closeChooser;
    // __TGC_FIX_ADD_BTN__  chooser is opened from the + feed row

    // channel view bindings
    channelSendEl.addEventListener('click', submitPost);
    channelBackEl.addEventListener('click', function () {
      closeChannelView();
      if (TGC.activeFolderId && TGC.activeFolderId !== 'all') {
        location.hash = '#f/' + encodeURIComponent(TGC.activeFolderId);
      } else {
        location.hash = '';
      }
    });
    channelInputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitPost();
        return;
      }
      if (e.key === 'Escape' && editingPostId) {
        editingPostId = null;
        channelInputEl.value = '';
        channelInputEl.style.height = '';
        __autoResizeChannelInput();
        return;
      }
      setTimeout(__autoResizeChannelInput, 0);
    });

    channelInputEl.addEventListener('input', __autoResizeChannelInput);

    // start with correct height for any prefilled content
    __autoResizeChannelInput();
    channelHeaderInfoEl.addEventListener('click', function () {
      var ch = getOpenedChannel();
      if (ch) openChannelBio(ch);
    });

    // click off overlays closes
    folderOverlay.addEventListener('click', function (e) { if (e.target === folderOverlay) folderOverlay.classList.remove('open'); });
    channelOverlay.addEventListener('click', function (e) { if (e.target === channelOverlay) channelOverlay.classList.remove('open'); });
    chooserOverlay.addEventListener('click', function (e) { if (e.target === chooserOverlay) chooserOverlay.classList.remove('open'); });
    if (channelBioOverlay) channelBioOverlay.addEventListener('click', function (e) { if (e.target === channelBioOverlay) channelBioOverlay.classList.remove('open'); });

    // initial load
    loadAll().then(function () {
      Router.dispatch(location.hash);
    });

    // Register routes with the dispatcher. Longest prefix wins.
    // RP registers 'chat' and '' itself, from rp-chat.js.
    Router.register('c/', routeChannel);
    Router.register('f/', routeFolder);
    // '' is the fallback for a plain chat id (which RP handles) or an
    // empty hash (which is the feed). RP registers 'chat' before merged
    // registers '', so RP sees non-empty plain ids first.
    Router.register('', function (rest, full) {
      // Full hash was non-empty -> RP chat. Full hash was empty -> feed.
      if (full) {
        if (window.RPChat) window.RPChat.handleHash(full);
      } else {
        routeFeed();
      }
    });

    // Single hashchange listener for the whole app.
    window.addEventListener('hashchange', function () {
      Router.dispatch(location.hash);
    });

    /* __TGC_V5__ */
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

    return {
        renderUnifiedFeed: renderUnifiedFeed,
        activeFolderId: function () { return TGC.activeFolderId; },
        route: route,
        Router: Router,

        // ---- debug / testing surface ----------------------------------
        // All pure: parse and serialize the on-disk formats without
        // touching the app's state.
        parseFoldersMd:      parseFoldersMd,
        serializeFoldersMd:  serializeFoldersMd,
        parseChannelMeta:    parseChannelMeta,
        serializeChannelMeta: serializeChannelMeta,
        slugify:             slugify,
        systemFolders:       systemFolders,

        // _fixture() returns sample markdown for the two on-disk formats,
        // so you can round-trip them in the console.
        _fixture: function () {
            return {
                foldersMd:
                    '---\nfolders:\n' +
                    '  - id: f1\n    name: Work\n    icon: \U0001F4C1\n' +
                    '  - id: f2\n    name: Home\n    icon: \U0001F3E0\n' +
                    '---\n',
                channelMeta:
                    '---\n' +
                    'id: c1\n' +
                    'title: Test Channel\n' +
                    'slug: test\n' +
                    'emoji: \U0001F4E2\n' +
                    'folderIds:\n  - all\n  - f1\n' +
                    '---\n' +
                    'description goes here\n'
            };
        }
    };
})();
