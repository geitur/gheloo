(function() {
  if (document.getElementById('__ws_panel')) return;

  // Walk Sync — broadcasts your own outgoing walk clicks to other tabs over a dedicated
  // BroadcastChannel, so a tab that's "following" you walks to the same tile plus a fixed
  // offset the instant you click to walk — no waiting for the server to broadcast your move
  // back into the room (which is what extensions/fun/mimic.js's Follow toggle does instead).
  // See docs/superpowers/specs/2026-08-23-walk-sync-design.md.

  let TAB_ID;
  try {
    if (!window.top.__nitro_tab_id) window.top.__nitro_tab_id = Math.random().toString(36).slice(2, 8);
    TAB_ID = window.top.__nitro_tab_id;
  } catch (e) { TAB_ID = Math.random().toString(36).slice(2, 8); }

  const BC = new BroadcastChannel('nitro_walksync');
  const _peers = {}; // tabId -> { user, lastSeen }
  let _followingTabId = null; // tabId currently being followed, or null
  let _dx = 0, _dy = 0; // offset applied to whoever we're following

  // Pre-staged for the follow-reaction MoveAvatar send added in a later task.
  function _outId(name) {
    if (!window.PKT || !window.PKT.OUT) return null;
    for (const id in window.PKT.OUT) {
      if (window.shortName(window.PKT.OUT[id], 'OUT') === name) return parseInt(id);
    }
    return null;
  }

  // ── Peer discovery — own lightweight registry, separate from multitab.js's own (which is
  // private to that file's closure, not exposed on window). Reuses the same TAB_ID though. ──
  function _announce() {
    BC.postMessage({ type: 'hello', tabId: TAB_ID, user: window._selfName || '' });
  }
  window.addEventListener('__ws_connect', _announce);
  if (window.onPacket) window.onPacket('UserObject', function() { setTimeout(_announce, 200); });
  setInterval(_announce, 4000);
  setTimeout(_announce, 300);
  window.addEventListener('beforeunload', function() { BC.postMessage({ type: 'bye', tabId: TAB_ID }); });

  let _renderPeers = function() {}; // replaced once the panel exists

  function _handleWalkMessage(msg) {
    if (msg.tabId !== _followingTabId) return;
    if (!window.Room || msg.roomId !== window.Room.id) return;
    const maId = _outId('MoveAvatar');
    if (maId === null) return;
    const x = msg.x + _dx, y = msg.y + _dy;
    _lastSynthetic = { x: x, y: y, ts: Date.now() };
    window.sendPacket('OUT', maId, '{i:' + x + '}{i:' + y + '}');
  }

  BC.onmessage = function(ev) {
    const msg = ev.data;
    if (!msg || msg.tabId === TAB_ID) return;
    if (msg.type === 'hello') {
      const prev = _peers[msg.tabId];
      const isNew = !prev;
      _peers[msg.tabId] = { user: msg.user || (prev && prev.user) || '', lastSeen: Date.now() };
      if (isNew) _announce();
      _renderPeers();
    } else if (msg.type === 'bye') {
      delete _peers[msg.tabId];
      if (_followingTabId === msg.tabId) _followingTabId = null;
      _renderPeers();
    } else if (msg.type === 'walk') {
      _handleWalkMessage(msg);
    }
  };

  setInterval(function() {
    const now = Date.now();
    let changed = false;
    Object.keys(_peers).forEach(function(id) {
      if (now - _peers[id].lastSeen > 60000) {
        delete _peers[id];
        if (_followingTabId === id) _followingTabId = null;
        changed = true;
      }
    });
    if (changed) _renderPeers();
  }, 4000);

  // ── Leader side: broadcast our own walk clicks. ──
  // _lastSynthetic is set right before we send a follow-triggered move (a later task), so
  // this listener can recognize the echo of our OWN synthetic send and skip re-broadcasting
  // it. Without this, two tabs following each other would ping-pong forever, each hop adding
  // the offset again — this guard makes that impossible regardless of whether OUT-packet
  // dispatch happens synchronously or via the worker-socket path (core/ws.js has both).
  let _lastSynthetic = null; // { x, y, ts }
  if (window.onPacket) {
    window.onPacket('MoveAvatar', function(p) {
      if (p.direction !== 'OUT' || !p.raw) return;
      const r = window.makeReader(p.raw);
      if (!r) return;
      let x, y;
      try { x = r.int(); y = r.int(); } catch (e) { return; }
      if (!window.Room) return;
      if (_lastSynthetic && _lastSynthetic.x === x && _lastSynthetic.y === y && Date.now() - _lastSynthetic.ts < 2000) {
        _lastSynthetic = null;
        return;
      }
      BC.postMessage({ type: 'walk', tabId: TAB_ID, roomId: window.Room && window.Room.id, x: x, y: y });
    });
  }

  function init() {
    const style = document.createElement('style');
    style.textContent = [
      '#__ws_panel{position:fixed;top:16px;right:16px;width:280px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__ws_panel *{box-sizing:border-box}',
      '.__ws_card_wrap{display:flex;flex-direction:column;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb}',
      '.__ws_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__ws_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}',
      '.__ws_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__ws_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__ws_close:hover{color:#eceefb}',
      '#__ws_body{padding:12px;display:flex;flex-direction:column;gap:10px}',
      '.__ws_card{background:#1c1e2a;border:1px solid #23252f;border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:8px}',
      '.__ws_card h4{margin:0;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#82849a}',
      '.__ws_desc{font-size:9px;color:#5c5e6b;line-height:1.5}',
      '.__ws_row{display:flex;gap:6px;align-items:center;justify-content:space-between}',
      '.__ws_row input{font-size:11px;padding:5px 7px;border:1px solid #23252f;border-radius:6px;background:#0A0B10;color:#eceefb;outline:none;box-sizing:border-box;width:60px}',
      '.__ws_row input:focus{border-color:#6C7CFF}',
      '.__ws_peer_name{font-size:11px;color:#eceefb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.__ws_btn{font-size:11px;font-weight:600;padding:5px 10px;border-radius:8px;border:none;cursor:pointer;color:#0A0B10;background:#A6B0FF;flex-shrink:0}',
      '.__ws_btn:hover{filter:brightness(1.08)}',
      '.__ws_btn.secondary{background:#23252f;color:#eceefb}',
      '.__ws_btn.secondary.active{background:rgba(108,124,255,0.16);color:#A6B0FF;border:1px solid #6C7CFF}',
      '.__ws_btn.small{padding:3px 8px;font-size:10px}',
    ].join('');
    document.head.appendChild(style);

    const p = document.createElement('div');
    p.id = '__ws_panel';
    p.innerHTML =
      '<div class="__ws_card_wrap">' +
        '<div class="__ws_hdr" id="__ws_hdr">' +
          '<span class="__ws_eyebrow">Gheloo</span>' +
          '<span class="__ws_title">Walk Sync</span>' +
          '<span class="__ws_close" id="__ws_close">&times;</span>' +
        '</div>' +
        '<div id="__ws_body">' +

          '<div class="__ws_card">' +
            '<h4>Offset</h4>' +
            '<div class="__ws_desc">Applied to whoever you follow below — e.g. dx=1, dy=0 walks one tile east of them.</div>' +
            '<div class="__ws_row">' +
              '<span>dx</span><input type="number" id="__ws_dx" value="0" step="1">' +
              '<span>dy</span><input type="number" id="__ws_dy" value="0" step="1">' +
            '</div>' +
          '</div>' +

          '<div class="__ws_card">' +
            '<h4>Other tabs</h4>' +
            '<div id="__ws_peers"><div class="__ws_desc">No other tabs detected.</div></div>' +
          '</div>' +

        '</div>' +
      '</div>';
    document.body.appendChild(p);
    p.style.display = 'none';

    window.__ghk_makeDraggable(p, p.querySelector('#__ws_hdr'), '__ghk_ws_pos', function(e) {
      return e.target.id === '__ws_close';
    });
    p.querySelector('#__ws_close').addEventListener('click', function() { p.style.display = 'none'; });

    p.querySelector('#__ws_dx').addEventListener('input', function() { _dx = parseInt(this.value, 10) || 0; });
    p.querySelector('#__ws_dy').addEventListener('input', function() { _dy = parseInt(this.value, 10) || 0; });

    _renderPeers = function() {
      const peersEl = p.querySelector('#__ws_peers');
      const ids = Object.keys(_peers).filter(function(id) { return _peers[id].user; });
      if (!ids.length) { peersEl.innerHTML = '<div class="__ws_desc">No other tabs detected.</div>'; return; }
      peersEl.innerHTML = ids.map(function(id) {
        const peer = _peers[id];
        const active = _followingTabId === id;
        return '<div class="__ws_row">' +
          '<span class="__ws_peer_name">' + peer.user + '</span>' +
          '<button class="__ws_btn secondary small' + (active ? ' active' : '') + '" data-peer="' + id + '">' + (active ? 'Following' : 'Follow') + '</button>' +
        '</div>';
      }).join('');
      peersEl.querySelectorAll('button[data-peer]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          const id = this.getAttribute('data-peer');
          _followingTabId = (_followingTabId === id) ? null : id;
          _renderPeers();
        });
      });
    };
    _renderPeers();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(init); });
  } else {
    window.__ghk_ready(init);
  }
})();
