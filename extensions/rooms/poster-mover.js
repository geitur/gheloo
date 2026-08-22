(function() {
  if (document.getElementById('__pm_panel')) return;

  // Poster Mover — nudges a wall item's tile position (w1,w2) and pixel offset (l1,l2)
  // after it's been dragged once by hand. Ported from G-BuildTools' "Poster Mover" panel
  // (sirjonasxx/G-BuildTools, GBuildTools.java) onto this repo's own MoveWallItem/
  // ItemUpdate plumbing — see docs/superpowers/specs/2026-08-13-poster-mover-design.md.
  //
  // Location string format (already confirmed elsewhere in this repo — photo-library.js's
  // WALL_RE, room-clone.js's wall item replay): ":w=W1,W2 l=L1,L2 dir", dir is 'l' or 'r'.
  const WALL_RE = /:w=(-?\d+),(-?\d+)\s+l=(-?\d+),(-?\d+)\s+([lr])/;

  function _outId(name) {
    if (!window.PKT || !window.PKT.OUT) return null;
    for (const id in window.PKT.OUT) {
      if (window.shortName(window.PKT.OUT[id], 'OUT') === name) return parseInt(id);
    }
    return null;
  }

  function _parseLocation(str) {
    const m = WALL_RE.exec(str);
    if (!m) return null;
    return { w1: parseInt(m[1], 10), w2: parseInt(m[2], 10), l1: parseInt(m[3], 10), l2: parseInt(m[4], 10), dir: m[5] };
  }
  function _formatLocation(loc) {
    return ':w=' + loc.w1 + ',' + loc.w2 + ' l=' + loc.l1 + ',' + loc.l2 + ' ' + loc.dir;
  }
  function _typeName(typeId) {
    const entry = window.FurniData && window.FurniData.wall && window.FurniData.wall[typeId];
    return (entry && entry.name) ? entry.name : ('type ' + typeId);
  }

  // ── State — one tracked wall item at a time, replaced whenever a new MoveWallItem
  // capture comes in (Task 2). ──
  let _furniId = null;   // int, or null when nothing selected yet
  let _furniName = null; // display name, or null
  let _loc = null;       // { w1, w2, l1, l2, dir }, or null
  let _locStep = 1;      // 1 | 3 | 9 — tile step for Location nudges
  let _offStep = 1;      // 1 | 3 | 9 — pixel step for Offset nudges

  function _send() {
    if (_furniId === null || !_loc) return;
    const mwiId = _outId('MoveWallItem');
    if (mwiId === null) { console.warn('[PosterMover] MoveWallItem not found in PKT.'); return; }
    window.sendPacket('OUT', mwiId, '{i:' + _furniId + '}{s:"' + _formatLocation(_loc).replace(/"/g, '\\"') + '"}');
  }

  function init() {
    const style = document.createElement('style');
    style.textContent = [
      '#__pm_panel{position:fixed;top:16px;right:16px;width:300px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__pm_panel *{box-sizing:border-box}',
      '.__pm_card_wrap{display:flex;flex-direction:column;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb}',
      '.__pm_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__pm_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}',
      '.__pm_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__pm_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__pm_close:hover{color:#eceefb}',
      '#__pm_body{padding:12px;display:flex;flex-direction:column;gap:10px}',
      '.__pm_card{background:#1c1e2a;border:1px solid #23252f;border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:8px}',
      '.__pm_card h4{margin:0;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#82849a}',
      '.__pm_desc{font-size:9px;color:#5c5e6b;line-height:1.5}',
      '.__pm_selected{font-size:11px;color:#eceefb}',
      '.__pm_grid{display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);gap:4px;width:120px;height:120px;margin:0 auto}',
      '.__pm_btn{font-size:11px;font-weight:600;padding:7px 10px;border-radius:8px;border:none;cursor:pointer;color:#0A0B10;background:#A6B0FF}',
      '.__pm_btn:hover{filter:brightness(1.08)}',
      '.__pm_btn.secondary{background:#23252f;color:#eceefb}',
      '.__pm_btn.secondary.active{background:rgba(108,124,255,0.16);color:#A6B0FF;border:1px solid #6C7CFF}',
      '.__pm_btn.small{padding:3px 8px;font-size:10px}',
      '.__pm_btn:disabled{opacity:0.45;cursor:not-allowed;filter:none}',
      '.__pm_arrow{grid-column:2;grid-row:1}',
      '.__pm_arrow.__pm_left{grid-column:1;grid-row:2}',
      '.__pm_arrow.__pm_right{grid-column:3;grid-row:2}',
      '.__pm_arrow.__pm_down{grid-column:2;grid-row:3}',
      '.__pm_steps{display:flex;gap:4px;justify-content:center}',
      '.__pm_row{display:flex;gap:6px;align-items:center}',
      '.__pm_row input{font-size:11px;padding:5px 7px;border:1px solid #23252f;border-radius:6px;background:#0A0B10;color:#eceefb;outline:none;box-sizing:border-box;flex:1}',
      '.__pm_row input:focus{border-color:#6C7CFF}',
      '.__pm_err{font-size:9px;color:#e74c3c;display:none}',
    ].join('');
    document.head.appendChild(style);

    const p = document.createElement('div');
    p.id = '__pm_panel';
    p.innerHTML =
      '<div class="__pm_card_wrap">' +
        '<div class="__pm_hdr" id="__pm_hdr">' +
          '<span class="__pm_eyebrow">Gheloo</span>' +
          '<span class="__pm_title">Poster Mover</span>' +
          '<span class="__pm_close" id="__pm_close">&times;</span>' +
        '</div>' +
        '<div id="__pm_body">' +

          '<div class="__pm_card">' +
            '<h4>Selected</h4>' +
            '<div class="__pm_row" style="justify-content:space-between">' +
              '<div class="__pm_selected" id="__pm_selected">&mdash;</div>' +
              '<button class="__pm_btn secondary small" id="__pm_clear" disabled>Clear</button>' +
            '</div>' +
            '<div class="__pm_desc">Drag a wall item once in-game to select it here.</div>' +
          '</div>' +

          '<div class="__pm_card">' +
            '<h4>Location</h4>' +
            '<div class="__pm_grid">' +
              '<button class="__pm_btn secondary small __pm_arrow" id="__pm_loc_up" disabled>&uarr;</button>' +
              '<button class="__pm_btn secondary small __pm_arrow __pm_left" id="__pm_loc_left" disabled>&larr;</button>' +
              '<button class="__pm_btn secondary small __pm_arrow __pm_right" id="__pm_loc_right" disabled>&rarr;</button>' +
              '<button class="__pm_btn secondary small __pm_arrow __pm_down" id="__pm_loc_down" disabled>&darr;</button>' +
            '</div>' +
            '<div class="__pm_steps" id="__pm_loc_steps">' +
              '<button class="__pm_btn secondary small active" data-step="1" disabled>1</button>' +
              '<button class="__pm_btn secondary small" data-step="3" disabled>3</button>' +
              '<button class="__pm_btn secondary small" data-step="9" disabled>9</button>' +
            '</div>' +
          '</div>' +

          '<div class="__pm_card">' +
            '<h4>Offset</h4>' +
            '<div class="__pm_grid">' +
              '<button class="__pm_btn secondary small __pm_arrow" id="__pm_off_up" disabled>&uarr;</button>' +
              '<button class="__pm_btn secondary small __pm_arrow __pm_left" id="__pm_off_left" disabled>&larr;</button>' +
              '<button class="__pm_btn secondary small __pm_arrow __pm_right" id="__pm_off_right" disabled>&rarr;</button>' +
              '<button class="__pm_btn secondary small __pm_arrow __pm_down" id="__pm_off_down" disabled>&darr;</button>' +
            '</div>' +
            '<div class="__pm_steps" id="__pm_off_steps">' +
              '<button class="__pm_btn secondary small active" data-step="1" disabled>1</button>' +
              '<button class="__pm_btn secondary small" data-step="3" disabled>3</button>' +
              '<button class="__pm_btn secondary small" data-step="9" disabled>9</button>' +
            '</div>' +
          '</div>' +

          '<div class="__pm_card">' +
            '<h4>Rotation</h4>' +
            '<div class="__pm_row">' +
              '<button class="__pm_btn secondary active" id="__pm_rot_l" disabled style="flex:1">Left wall</button>' +
              '<button class="__pm_btn secondary" id="__pm_rot_r" disabled style="flex:1">Right wall</button>' +
            '</div>' +
          '</div>' +

          '<div class="__pm_card">' +
            '<h4>Location code</h4>' +
            '<div class="__pm_row">' +
              '<input type="text" id="__pm_loc_txt" disabled placeholder=":w=0,0 l=0,0 l">' +
            '</div>' +
            '<div class="__pm_err" id="__pm_loc_err"></div>' +
          '</div>' +

        '</div>' +
      '</div>';
    document.body.appendChild(p);
    p.style.display = 'none';

    window.__ghk_makeDraggable(p, p.querySelector('#__pm_hdr'), '__ghk_pm_pos', function(e) {
      return e.target.id === '__pm_close';
    });
    p.querySelector('#__pm_close').addEventListener('click', function() { p.style.display = 'none'; });

    // ── POSTER MOVER LOGIC ──
    function _render() {
      if (errEl) errEl.style.display = 'none';

      const selEl = p.querySelector('#__pm_selected');
      selEl.textContent = (_furniId !== null && _loc)
        ? (_furniName || ('type ' + _furniId)) + ' (#' + _furniId + ')'
        : '—';

      const enabled = _furniId !== null && !!_loc;
      ['__pm_loc_up', '__pm_loc_down', '__pm_loc_left', '__pm_loc_right',
       '__pm_off_up', '__pm_off_down', '__pm_off_left', '__pm_off_right',
       '__pm_rot_l', '__pm_rot_r', '__pm_clear'].forEach(function(id) {
        const el = p.querySelector('#' + id);
        if (el) el.disabled = !enabled;
      });
      p.querySelectorAll('#__pm_loc_steps button, #__pm_off_steps button').forEach(function(btn) {
        btn.disabled = !enabled;
      });
      const txt = p.querySelector('#__pm_loc_txt');
      txt.disabled = !enabled;
      txt.value = enabled ? _formatLocation(_loc) : '';

      p.querySelector('#__pm_rot_l').classList.toggle('active', !!_loc && _loc.dir === 'l');
      p.querySelector('#__pm_rot_r').classList.toggle('active', !!_loc && _loc.dir === 'r');
    }

    // Lets the player deselect without dragging a different item — e.g. to stop keyboard
    // arrows from nudging anything while they walk around.
    function _clearSelection() {
      _furniId = null;
      _furniName = null;
      _loc = null;
      _render();
    }
    p.querySelector('#__pm_clear').addEventListener('click', _clearSelection);

    // Captures the target: fires when the player drags a wall item natively, which sends
    // this same OUT packet. Replaces whatever was tracked before.
    window.onPacket('MoveWallItem', function(pkt) {
      if (pkt.direction !== 'OUT' || !pkt.raw) return;
      const r = window.makeReader(pkt.raw);
      if (!r) return;
      let id, str;
      try { id = r.int(); str = r.str(); } catch (e) { return; }
      const parsed = _parseLocation(str);
      if (!parsed) return;
      _furniId = id;
      _loc = parsed;
      const item = window.Room && window.Room.wallItems && window.Room.wallItems[id];
      _furniName = item ? _typeName(item.typeId) : null;
      _render();
    });

    // Resyncs to the server's authoritative location after every move (ours or the game's
    // own drag) — avoids drift if a move is rejected or clamped server-side.
    window.onPacket('ItemUpdate', function(pkt) {
      if (!pkt.parsed || _furniId === null || pkt.parsed.id !== _furniId) return;
      const parsed = _parseLocation(pkt.parsed.location);
      if (!parsed) return;
      _loc = parsed;
      _render();
    });

    function _nudge(axis, delta) {
      if (!_loc) return;
      _loc = Object.assign({}, _loc, { [axis]: _loc[axis] + delta });
      _render();
      _send();
    }

    p.querySelector('#__pm_loc_up').addEventListener('click', function() { _nudge('w2', -_locStep); });
    p.querySelector('#__pm_loc_down').addEventListener('click', function() { _nudge('w2', _locStep); });
    p.querySelector('#__pm_loc_left').addEventListener('click', function() { _nudge('w1', -_locStep); });
    p.querySelector('#__pm_loc_right').addEventListener('click', function() { _nudge('w1', _locStep); });

    p.querySelector('#__pm_off_up').addEventListener('click', function() { _nudge('l2', -_offStep); });
    p.querySelector('#__pm_off_down').addEventListener('click', function() { _nudge('l2', _offStep); });
    p.querySelector('#__pm_off_left').addEventListener('click', function() { _nudge('l1', -_offStep); });
    p.querySelector('#__pm_off_right').addEventListener('click', function() { _nudge('l1', _offStep); });

    function _wireSteps(containerId, setStep) {
      const container = p.querySelector('#' + containerId);
      container.querySelectorAll('button').forEach(function(btn) {
        btn.addEventListener('click', function() {
          setStep(parseInt(btn.getAttribute('data-step'), 10));
          container.querySelectorAll('button').forEach(function(b) { b.classList.toggle('active', b === btn); });
        });
      });
    }
    _wireSteps('__pm_loc_steps', function(v) { _locStep = v; });
    _wireSteps('__pm_off_steps', function(v) { _offStep = v; });

    p.querySelector('#__pm_rot_l').addEventListener('click', function() {
      if (!_loc) return;
      _loc = Object.assign({}, _loc, { dir: 'l' });
      _render();
      _send();
    });
    p.querySelector('#__pm_rot_r').addEventListener('click', function() {
      if (!_loc) return;
      _loc = Object.assign({}, _loc, { dir: 'r' });
      _render();
      _send();
    });

    const txtEl = p.querySelector('#__pm_loc_txt');
    const errEl = p.querySelector('#__pm_loc_err');
    txtEl.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter') return;
      if (_furniId === null) return;
      const parsed = _parseLocation(txtEl.value);
      if (!parsed) {
        errEl.textContent = 'Invalid format — expected ":w=W,W l=O,O l" or "...r"';
        errEl.style.display = 'block';
        return;
      }
      _loc = parsed;
      _render();
      _send();
    });

    // Arrow keys nudge Location by _locStep. Offset has no keybind — buttons only. Only
    // active while this panel is visible and something is selected — otherwise arrow keys
    // fall through to native avatar walking as normal. Typing in the location-code field
    // is left alone so caret navigation still works there.
    function _keyHandler(e) {
      if (p.style.display === 'none') return;
      if (_furniId === null || !_loc) return;
      const ae = document.activeElement;
      if (ae && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName)) return;
      let axis = null, sign = 0;
      if (e.key === 'ArrowUp')         { axis = 'w2'; sign = -1; }
      else if (e.key === 'ArrowDown')  { axis = 'w2'; sign = 1; }
      else if (e.key === 'ArrowLeft')  { axis = 'w1'; sign = -1; }
      else if (e.key === 'ArrowRight') { axis = 'w1'; sign = 1; }
      else return;
      e.preventDefault();
      e.stopPropagation();
      _nudge(axis, sign * _locStep);
    }
    document.addEventListener('keydown', _keyHandler, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(init); });
  } else {
    window.__ghk_ready(init);
  }
})();
