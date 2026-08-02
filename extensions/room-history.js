(function() {
  if (document.getElementById('__rh_panel')) return;

  // Room History — session-only list of rooms you've entered, newest first.
  // Populated from GetGuestRoomResult (fires on real room entry with the room's
  // flatId/roomName/ownerName already parsed — see parsers.js), not persisted
  // across reloads, capped at 8 entries same as re-visiting bumps the existing
  // entry to the top instead of duplicating it.
  const MAX_HISTORY = 3;
  let _history = []; // { roomId, roomName, ownerName, firstSeen, lastSeen }
  let _renderFn = null;

  window.onPacket('GetGuestRoomResult', function(p) {
    if (!p.parsed || !p.parsed.room) return;
    const room = p.parsed.room;
    if (!room.flatId) return;
    const now = Date.now();
    const existing = _history.find(function(h) { return h.roomId === room.flatId; });
    if (existing) {
      existing.lastSeen = now;
      if (room.roomName) existing.roomName = room.roomName;
      if (room.ownerName) existing.ownerName = room.ownerName;
      _history = [existing].concat(_history.filter(function(h) { return h !== existing; }));
    } else {
      _history.unshift({
        roomId: room.flatId,
        roomName: room.roomName || ('Room #' + room.flatId),
        ownerName: room.ownerName || '',
        firstSeen: now,
        lastSeen: now,
      });
      if (_history.length > MAX_HISTORY) _history.length = MAX_HISTORY;
    }
    if (_renderFn) _renderFn();
  });

  function relTime(ts) {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 10) return 'just now';
    if (s < 60) return s + 's ago';
    const m = Math.round(s / 60);
    if (m < 60) return m + 'm ago';
    const h = Math.round(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.round(h / 24) + 'd ago';
  }

  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function init() {
    const style = document.createElement('style');
    style.textContent = [
      '#__rh_panel{position:fixed;top:16px;right:16px;width:300px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__rh_panel *{box-sizing:border-box}',
      '.__rh_card_wrap{display:flex;flex-direction:column;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb}',
      '.__rh_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__rh_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}',
      '.__rh_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__rh_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__rh_close:hover{color:#eceefb}',
      '#__rh_list{max-height:340px;overflow-y:auto;padding:8px}',
      '.__rh_row{display:flex;align-items:center;gap:8px;padding:8px 9px;border-radius:9px;margin-bottom:5px;border-left:2px solid transparent}',
      '.__rh_row:last-child{margin-bottom:0}',
      '.__rh_row.current{background:rgba(108,124,255,0.12);border-left-color:#6C7CFF}',
      '.__rh_row[data-room-id]{cursor:pointer}',
      '.__rh_row[data-room-id]:hover{background:rgba(255,255,255,0.06)}',
      '.__rh_row_text{min-width:0;flex:1}',
      '.__rh_row_name{font:600 12px system-ui;color:#eceefb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.__rh_row_owner{font:400 10.5px system-ui;color:#82849a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px}',
      '.__rh_row_time{font:700 9px/1 monospace;color:#5c5e6b;flex-shrink:0;white-space:nowrap}',
      '.__rh_row.current .__rh_row_time{color:#A6B0FF}',
      '#__rh_empty{padding:24px 12px;font-size:11px;color:#5c5e6b;text-align:center;line-height:1.6}',
    ].join('');
    document.head.appendChild(style);

    const p = document.createElement('div');
    p.id = '__rh_panel';
    p.innerHTML =
      '<div class="__rh_card_wrap">' +
        '<div class="__rh_hdr" id="__rh_hdr">' +
          '<span class="__rh_title">Room History</span>' +
          '<span class="__rh_close" id="__rh_close">&times;</span>' +
        '</div>' +
        '<div id="__rh_list"></div>' +
      '</div>';
    document.body.appendChild(p);
    p.style.display = 'none';

    window.__ghk_makeDraggable(p, p.querySelector('#__rh_hdr'), '__ghk_rh_pos', e => e.target.id === '__rh_close');
    p.querySelector('#__rh_close').addEventListener('click', () => p.style.display = 'none');

    const listEl = p.querySelector('#__rh_list');

    function render() {
      if (!_history.length) {
        listEl.innerHTML = '<div id="__rh_empty">No rooms visited this session yet.</div>';
        return;
      }
      const curId = window.Room && window.Room.id;
      listEl.innerHTML = _history.map(function(h) {
        const isCurrent = h.roomId === curId;
        return '<div class="__rh_row' + (isCurrent ? ' current' : '') + '"' + (isCurrent ? '' : ' data-room-id="' + h.roomId + '"') + '>' +
          '<div class="__rh_row_text">' +
            '<div class="__rh_row_name">' + esc(h.roomName) + '</div>' +
            (h.ownerName ? '<div class="__rh_row_owner">by ' + esc(h.ownerName) + '</div>' : '') +
          '</div>' +
          '<div class="__rh_row_time">' + (isCurrent ? 'Here' : esc(relTime(h.lastSeen))) + '</div>' +
        '</div>';
      }).join('');
    }
    _renderFn = render;
    render();

    // Click a past room to rejoin it — OpenFlatConnection{i:roomId}{b:false}{b:false}
    // (confirmed from a real capture). Current room's row has no data-room-id so it's
    // not clickable.
    function _outId(name) {
      if (!window.PKT || !window.PKT.OUT) return null;
      for (const id in window.PKT.OUT) {
        if (window.shortName(window.PKT.OUT[id], 'OUT') === name) return parseInt(id);
      }
      return null;
    }
    listEl.addEventListener('click', function(e) {
      const row = e.target.closest('.__rh_row[data-room-id]');
      if (!row) return;
      const roomId = parseInt(row.dataset.roomId, 10);
      if (!Number.isFinite(roomId)) return;
      const id = _outId('OpenFlatConnection');
      if (id === null) return;
      window.sendPacket('OUT', id, '{i:' + roomId + '}{b:false}{b:false}');
      p.style.display = 'none';
    });

    window.__rh_render = render;
    window.__rh_toggle = function() {
      const willShow = p.style.display === 'none';
      p.style.display = willShow ? '' : 'none';
      if (willShow) render();
    };

    // Room tools toolbar icon — .nitro-room-tools always has icon-cog/icon-zoom-less
    // etc, but the whole toolbar node gets re-rendered on room change (and
    // icon-room-construction-tool / icon-like-room only exist when you have rights
    // in that room), so this can't just inject once. Re-check on every DOM mutation
    // and re-add if our icon isn't there anymore.
    const ICON_STORAGE_KEY = '__ghk_roomhistory_icon_settings';
    let _iconEnabled = true;
    try {
      const _savedIcon = JSON.parse(localStorage.getItem(ICON_STORAGE_KEY) || '{}');
      if (_savedIcon.on === false) _iconEnabled = false;
    } catch(_) {}

    function ensureToolbarIcon() {
      if (!_iconEnabled) return;
      const toolsBox = document.querySelector('.nitro-room-tools-container .nitro-room-tools');
      if (!toolsBox || toolsBox.querySelector('.__rh_toolbar_icon')) return;
      const btn = document.createElement('div');
      btn.className = 'cursor-pointer icon __rh_toolbar_icon';
      btn.title = 'Room History';
      btn.style.cssText = 'display:flex;align-items:center;justify-content:center;background-image:none;';
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>';
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const willShow = p.style.display === 'none';
        if (willShow) {
          const r = btn.getBoundingClientRect();
          const panelW = 300, gap = 8;
          let left = r.left - panelW - gap; // open toward the room, to the icon's left
          if (left < 8) left = Math.max(8, Math.min(r.right + gap, window.innerWidth - panelW - 8));
          p.style.right = 'auto';
          p.style.left = left + 'px';
          p.style.top = 'auto';
          p.style.bottom = (window.innerHeight - r.top - 16) + 'px'; // open upward, above the icon
        }
        window.__rh_toggle();
      });
      toolsBox.appendChild(btn);
    }

    window.__rh_setIconEnabled = function(v) {
      _iconEnabled = !!v;
      try { localStorage.setItem(ICON_STORAGE_KEY, JSON.stringify({ on: _iconEnabled })); } catch(_) {}
      if (_iconEnabled) ensureToolbarIcon();
      else document.querySelectorAll('.__rh_toolbar_icon').forEach(function(el) { el.remove(); });
    };

    ensureToolbarIcon();
    if (document.body && typeof MutationObserver !== 'undefined') {
      let scheduled = false;
      new MutationObserver(function() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(function() { scheduled = false; ensureToolbarIcon(); });
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      window.__ghk_ready(init);
    });
  } else {
    window.__ghk_ready(init);
  }
})();
