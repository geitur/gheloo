(function() {
  if (document.getElementById('__am_panel')) return;

  // Area Mover — shifts a rectangular area of floor furni using the room editor's own
  // native "verplaats" (move stack) tool instead of buy/place reconstruction (Room
  // Clone's approach). Moves whatever's already on each tile as one native operation
  // per tile, stacking and all, exactly like using the in-game room editor by hand.
  //
  // Packet sequence confirmed from 4 real captures (all 47 bytes, same KamerConstructieTool
  // header — everything but the two flags below stays 0/false in every one):
  //   1. arm tile-select:      KCT(select=1, move=0)
  //   2. click origin tile:    MoveAvatar{x}{y}          — just picks the stack, no move yet
  //   3. press "verplaats":    KCT(select=1, move=1)  then  KCT(select=0, move=1)
  //   4. click dest tile:      MoveAvatar{x}{y}          — stack actually relocates here
  //   5. press "verplaats" again to finish: KCT(select=0, move=0)
  // The two flags live at byte offset 40 (as an int32, the field previously assumed
  // "unused" in the height/state KCT layout) and the middle one of the three trailing
  // bools (byte 45) — everything else in the packet is 0/false during a move.

  function _outId(name) {
    if (!window.PKT || !window.PKT.OUT) return null;
    for (const id in window.PKT.OUT) {
      if (window.shortName(window.PKT.OUT[id], 'OUT') === name) return parseInt(id);
    }
    return null;
  }
  function _inId(name) {
    if (!window.PKT || !window.PKT.IN) return null;
    for (const id in window.PKT.IN) {
      if (window.shortName(window.PKT.IN[id], 'IN') === name) return parseInt(id);
    }
    return null;
  }
  function _sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
  const MOVE_DELAY_MS = 65;
  const UNDO_DELAY_MS = 100;
  function _typeName(typeId) {
    const entry = window.FurniData && window.FurniData.floor && window.FurniData.floor[typeId];
    return (entry && entry.name) ? entry.name : ('type ' + typeId);
  }

  function _sendKCT(kctId, selectActive, moveActive) {
    window.sendPacket('OUT', kctId,
      '{i:0}{i:0}{i:0}{i:0}{i:0}{i:0}{i:0}{i:0}{i:0}{i:0}' +
      '{i:' + (selectActive ? 1 : 0) + '}' +
      '{b:false}{b:' + (moveActive ? 'true' : 'false') + '}{b:false}');
  }
  function _sendMoveAvatar(maId, x, y) {
    window.sendPacket('OUT', maId, '{i:' + x + '}{i:' + y + '}');
  }
  // KamerConstructieUndo — {out:KamerConstructieUndo}{s:"undo"}, header id 399 (now
  // registered by name in pkt.js). Sending it once reverts one KamerConstructieTool
  // "verplaats" move, same as clicking the room editor's own Undo button once.
  function _sendUndo(undoId) {
    window.sendPacket('OUT', undoId, '{s:"undo"}');
  }
  async function _moveStack(kctId, maId, fx, fy, tx, ty, delayMs) {
    _sendKCT(kctId, true, false);  await _sleep(delayMs);
    _sendMoveAvatar(maId, fx, fy); await _sleep(delayMs);
    _sendKCT(kctId, true, true);   await _sleep(delayMs);
    _sendKCT(kctId, false, true);  await _sleep(delayMs);
    _sendMoveAvatar(maId, tx, ty); await _sleep(delayMs);
    _sendKCT(kctId, false, false); await _sleep(delayMs);
  }

  function _occupiedTiles(x1, y1, x2, y2) {
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    const occupied = new Map(); // "x,y" -> [typeName,...] just for the log preview
    Object.values(window.Room.floorItems || {}).forEach(function(it) {
      const tx = Math.round(it.x), ty = Math.round(it.y);
      if (tx < minX || tx > maxX || ty < minY || ty > maxY) return;
      const key = tx + ',' + ty;
      if (!occupied.has(key)) occupied.set(key, []);
      occupied.get(key).push(it);
    });
    const tiles = [];
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const key = x + ',' + y;
        if (occupied.has(key)) tiles.push({ x: x, y: y, items: occupied.get(key) });
      }
    }
    return tiles;
  }
  // Process tiles furthest along the shift direction first, so a move never overwrites
  // a source tile that hasn't been read yet — same idea as shifting an array in place.
  function _orderForShift(tiles, dx, dy) {
    const sx = Math.sign(dx), sy = Math.sign(dy);
    return tiles.slice().sort(function(a, b) { return (b.x * sx + b.y * sy) - (a.x * sx + a.y * sy); });
  }

  // ── Client-side preview — spawns fake ObjectAdd ghosts at the destination tiles so
  // you can see the result and back out before any real MoveAvatar/KamerConstructieTool
  // packet gets sent. Field order confirmed from a real ObjectAdd capture: id, typeId,
  // x, y, facing, z(str), sizeZ(str), extra, stuffCategory, stuffState(str), expires,
  // usagePolicy, ownerId, ownerName. Everything but id/x/y is copied straight off the
  // real item (window.Room.floorItems already carries all of it, same fields furni-hider
  // uses to restore a hidden item) — z/sizeZ reuse the item's current height since the
  // server hasn't actually recomputed it for the new tile, so tall stacks may preview a
  // little off; good enough to judge layout before committing.
  let _ghostIdCounter = 2000000000;
  let _previewGhosts = []; // { ghostId, ownerId }
  const PKT_OBJ_REMOVE_IN = 2703; // same hardcoded id furni-hider.js uses to remove a floor item client-side
  function _buildGhostObjectAddExpr(ghostId, item, x, y) {
    let stuffCat = 0, stuffState = '0';
    if (item.stuff) {
      if (item.stuff.category !== undefined) stuffCat = item.stuff.category;
      if (item.stuff.state !== undefined) stuffState = String(item.stuff.state);
    }
    return '{i:' + ghostId + '}' +
      '{i:' + item.typeId + '}' +
      '{i:' + x + '}' +
      '{i:' + y + '}' +
      '{i:' + (item.facing || 0) + '}' +
      '{s:"' + String(item.z != null ? item.z : '0.0') + '"}' +
      '{s:"' + String(item.sizeZ != null ? item.sizeZ : '1.0') + '"}' +
      '{i:' + (item.extra || 0) + '}' +
      '{i:' + stuffCat + '}{s:"' + stuffState.replace(/"/g, '\\"') + '"}' +
      '{i:-1}{i:1}' +
      '{i:' + item.ownerId + '}{s:"' + (item.ownerName || '').replace(/"/g, '\\"') + '"}';
  }
  function _clearPreviewGhosts() {
    if (!_previewGhosts.length) return;
    const removeId = PKT_OBJ_REMOVE_IN;
    _previewGhosts.forEach(function(g) {
      window.sendPacket('IN', removeId, '{s:"' + g.ghostId + '"}{i:' + g.ownerId + '}{b:200}{i:0}');
    });
    _previewGhosts = [];
  }
  function _spawnPreview(tiles, dx, dy) {
    const addId = _inId('ObjectAdd');
    if (addId === null) return 0;
    _clearPreviewGhosts();
    let count = 0;
    tiles.forEach(function(t) {
      t.items.forEach(function(item) {
        const ghostId = ++_ghostIdCounter;
        const expr = _buildGhostObjectAddExpr(ghostId, item, t.x + dx, t.y + dy);
        if (window.sendPacket('IN', addId, expr)) {
          _previewGhosts.push({ ghostId: ghostId, ownerId: item.ownerId });
          count++;
        }
      });
    });
    return count;
  }

  // Freezes the player during a run: a full-viewport overlay (z-index below every
  // Gheloo panel, above the game) eats mouse clicks before they reach the game canvas,
  // and a capture-phase keydown listener eats arrow-key movement. Deliberately NOT done
  // via _blockOutgoingFilters on MoveAvatar — that would also block this script's own
  // tile-select/destination clicks, and in worker-socket mode the block is a single
  // static flag per packet id with no way to tell "our send" from "the player's click"
  // apart, so it can't be selective there at all.
  let _freezeOverlay = null;
  function _freezeKeyBlock(e) {
    if (e.target && e.target.closest && e.target.closest('#__am_panel')) return;
    e.stopPropagation();
    e.preventDefault();
  }
  function _setFrozen(on) {
    if (on) {
      if (_freezeOverlay) return;
      _freezeOverlay = document.createElement('div');
      _freezeOverlay.id = '__am_freeze';
      _freezeOverlay.style.cssText = 'position:fixed;inset:0;z-index:999;cursor:not-allowed';
      document.body.appendChild(_freezeOverlay);
      document.addEventListener('keydown', _freezeKeyBlock, true);
    } else {
      if (_freezeOverlay) { _freezeOverlay.remove(); _freezeOverlay = null; }
      document.removeEventListener('keydown', _freezeKeyBlock, true);
    }
  }

  let _aborted = false;
  let _running = false;
  // How many moves the last run actually sent (not just planned) — Undo All reverts
  // exactly this many, one RoomEditorUndo per move, since each undo only rewinds one.
  let _lastMoveCount = 0;
  async function _runMove(tiles, dx, dy, delayMs, logFn) {
    const kctId = _outId('KamerConstructieTool');
    const maId = _outId('MoveAvatar');
    if (kctId === null || maId === null) { logFn('KamerConstructieTool or MoveAvatar not found in PKT.'); return; }
    const ordered = _orderForShift(tiles, dx, dy);
    _aborted = false;
    _running = true;
    _lastMoveCount = 0;
    _setFrozen(true);
    try {
      for (let i = 0; i < ordered.length; i++) {
        if (_aborted) { logFn('Aborted at ' + i + '/' + ordered.length + '.'); return; }
        const t = ordered[i];
        logFn('Moving ' + (i + 1) + '/' + ordered.length + ': (' + t.x + ',' + t.y + ') -> (' + (t.x + dx) + ',' + (t.y + dy) + ') [' + t.items.map(function(it) { return _typeName(it.typeId); }).join(', ') + ']');
        await _moveStack(kctId, maId, t.x, t.y, t.x + dx, t.y + dy, delayMs);
        _lastMoveCount++;
      }
      logFn('Done — ' + ordered.length + ' stack(s) moved.');
    } finally {
      _running = false;
      _setFrozen(false);
    }
  }

  async function _undoAll(delayMs, logFn) {
    if (_lastMoveCount <= 0) { logFn('Nothing to undo.'); return; }
    const undoId = _outId('KamerConstructieUndo');
    if (undoId === null) { logFn('KamerConstructieUndo not found in PKT.'); return; }
    const total = _lastMoveCount;
    _running = true;
    _setFrozen(true);
    try {
      for (let i = 0; i < total; i++) {
        _sendUndo(undoId);
        logFn('Undo ' + (i + 1) + '/' + total + '...');
        await _sleep(delayMs);
      }
      _lastMoveCount = 0;
      logFn('Done — ' + total + ' move(s) undone.');
    } finally {
      _running = false;
      _setFrozen(false);
    }
  }

  // ── Destination capture — click a tile in-game while armed and its coordinates get
  // read straight off the outgoing MoveAvatar packet. The click itself is blocked from
  // reaching the server while armed (window._setOutgoingBlock, ws.js), so your avatar
  // doesn't visibly walk there. Just the one tile — source area picking is below, and
  // uses the native area-selection tool instead (see startSourceAreaSelect).
  let _moveAvatarId = null;
  function _setWalkBlocked(blocked) {
    if (_moveAvatarId === null) _moveAvatarId = _outId('MoveAvatar');
    if (_moveAvatarId === null || !window._setOutgoingBlock) return;
    window._setOutgoingBlock(_moveAvatarId, blocked);
  }

  let _pendingCapture = false; // destination only now
  let _ptA = null, _ptB = null, _dstPt = null;
  window.onPacket('RoomReady', function() {
    _setWalkBlocked(false);
    _pendingCapture = false;
    if (window.RoomEngine && window.RoomEngine.areaSelectionManager().areaSelectionState !== 0) {
      window.RoomEngine.areaSelectionManager().deactivate();
    }
    _clearSourceAreaLiveHighlight();
    _sourceAreaPicking = false;
  });
  window.onPacket('MoveAvatar', function(p) {
    if (!_pendingCapture || p.direction !== 'OUT' || !p.raw) return;
    const r = window.makeReader(p.raw);
    if (!r) return;
    let x, y;
    try { x = r.int(); y = r.int(); } catch (e) { return; }
    _dstPt = { x: x, y: y };
    _pendingCapture = false;
    // Deferred, not immediate — this runs from inside ws.js's addPacket(), which fires
    // BEFORE the block-check for this very packet (same send call, still in progress
    // further down the stack). Unblocking synchronously here would delete the filter
    // before that check ever runs, letting this click's own packet slip through anyway.
    setTimeout(function() { _setWalkBlocked(false); }, 0);
    _renderCaptureStatus();
  });
  function _renderCaptureStatus() {
    const src = document.querySelector('#__am_panel #__am_src_status');
    if (src) src.textContent = 'source area: ' + (_ptA && _ptB ? '(' + Math.min(_ptA.x, _ptB.x) + ',' + Math.min(_ptA.y, _ptB.y) + ') → (' + Math.max(_ptA.x, _ptB.x) + ',' + Math.max(_ptA.y, _ptB.y) + ')' : '—');
    const c = document.querySelector('#__am_panel #__am_dst_status');
    if (c) c.textContent = 'destination: ' + (_dstPt ? '(' + _dstPt.x + ',' + _dstPt.y + ')' : '—');
  }

  // ── Source area capture — drives the real client's own native area-selection tool
  // (RoomEngine._areaSelectionManager, exposed as window.RoomEngine by core/eval-hook.js),
  // same as Room Clone's Capture Area: activate()+startSelecting() arms it, the engine's
  // own mouse pipeline feeds every drag step into it automatically (dims other furni,
  // draws its own tile-grid highlight), and setHighlight(x,y,w,h) — called on every one
  // of those steps — is patched here to also keep window.__gh_FurniSelect's recolor in
  // sync live on whatever's currently inside the rectangle, not just once at the end.
  let _sourceAreaPicking = false;
  let _sourceAreaLiveHighlightedIds = [];
  let _sourceAreaColorMatched = false;
  function _matchSourceAreaHighlightColors() {
    if (_sourceAreaColorMatched || !window.__gh_FurniSelect || !window.__gh_FurniSelect._selectionShader) return;
    window.__gh_FurniSelect._selectionShader.color = 0x66CCFF;
    window.__gh_FurniSelect._selectionShader.lineColor = 0xFFFFFF;
    _sourceAreaColorMatched = true;
  }
  function _syncSourceAreaLiveHighlight(x, y, w, h) {
    if (!window.__gh_FurniSelect || !window.Room) return;
    _matchSourceAreaHighlightColors();
    const wantIds = (w && h) ? Object.values(window.Room.floorItems || {})
      .filter(function(it) { return it.x >= x && it.x <= x + w - 1 && it.y >= y && it.y <= y + h - 1; })
      .map(function(it) { return it.id; }) : [];
    const wantSet = new Set(wantIds);
    const haveSet = new Set(_sourceAreaLiveHighlightedIds);
    _sourceAreaLiveHighlightedIds.forEach(function(id) {
      if (!wantSet.has(id)) { try { window.__gh_FurniSelect.hide(id); } catch(_e) {} }
    });
    wantIds.forEach(function(id) {
      if (!haveSet.has(id)) { try { window.__gh_FurniSelect.show(id); } catch(_e) {} }
    });
    _sourceAreaLiveHighlightedIds = wantIds;
  }
  function _clearSourceAreaLiveHighlight() {
    if (window.__gh_FurniSelect) {
      _sourceAreaLiveHighlightedIds.forEach(function(id) { try { window.__gh_FurniSelect.hide(id); } catch(_e) {} });
    }
    _sourceAreaLiveHighlightedIds = [];
  }
  let _sourceAreaSetHighlightPatched = false;
  function _ensureSourceAreaSetHighlightPatched(mgr) {
    if (_sourceAreaSetHighlightPatched) return;
    const original = mgr.setHighlight.bind(mgr);
    mgr.setHighlight = function(x, y, w, h) {
      original(x, y, w, h);
      _syncSourceAreaLiveHighlight(x, y, w, h);
    };
    _sourceAreaSetHighlightPatched = true;
  }
  function startSourceAreaSelect(logFn) {
    if (!(window.Room && window.Room.id)) { logFn('Not in a room.'); return; }
    if (!window.RoomEngine) { logFn('Real room engine not detected yet — try again in a moment, or reload the page.'); return; }
    const mgr = window.RoomEngine.areaSelectionManager();
    if (mgr.areaSelectionState !== 0) return; // already active — ignore, not a fresh start
    _clearSourceAreaLiveHighlight();
    _ensureSourceAreaSetHighlightPatched(mgr);
    mgr.activate(function(x, y, w, h) {
      mgr.deactivate();
      _clearSourceAreaLiveHighlight();
      _sourceAreaPicking = false;
      // clearHighlight() (called by deactivate() above, but also independently by other
      // native UI sharing this same manager, e.g. Wired's own area-select screens)
      // invokes the callback with all-zeros when there's no real selection to report.
      if (w && h) {
        _ptA = { x: x, y: y };
        _ptB = { x: x + w - 1, y: y + h - 1 };
        _renderCaptureStatus();
      }
      logFn(w && h ? 'Source area set: ' + w + 'x' + h + ' tiles.' : 'Source area selection cancelled.');
    });
    mgr.startSelecting();
    _sourceAreaPicking = true;
    logFn('Click an empty tile and drag to the opposite corner, then release.');
  }

  function init() {
    const style = document.createElement('style');
    style.textContent = [
      '#__am_panel{position:fixed;top:16px;right:16px;width:340px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__am_panel *{box-sizing:border-box}',
      '.__am_card_wrap{display:flex;flex-direction:column;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb}',
      '.__am_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__am_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}',
      '.__am_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__am_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__am_close:hover{color:#eceefb}',
      '#__am_body{max-height:min(600px,calc(100vh - 90px));overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px}',
      '.__am_card{background:#1c1e2a;border:1px solid #23252f;border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:8px}',
      '.__am_card h4{margin:0;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#82849a}',
      '.__am_desc{font-size:9px;color:#5c5e6b;line-height:1.5}',
      '.__am_row{display:flex;gap:6px;align-items:center}',
      '.__am_row input{font-size:11px;padding:5px 7px;border:1px solid #23252f;border-radius:6px;background:#0A0B10;color:#eceefb;outline:none;box-sizing:border-box}',
      '.__am_row input:focus{border-color:#6C7CFF}',
      '.__am_btn{font-size:11px;font-weight:600;padding:7px 10px;border-radius:8px;border:none;cursor:pointer;color:#0A0B10;background:#A6B0FF}',
      '.__am_btn:hover{filter:brightness(1.08)}',
      '.__am_btn.secondary{background:#23252f;color:#eceefb}',
      '.__am_btn.danger{background:rgba(231,76,60,0.14);color:#e74c3c;border:1px solid rgba(231,76,60,0.3)}',
      '.__am_btn.small{padding:3px 8px;font-size:10px}',
      '.__am_btn:disabled{opacity:0.45;cursor:not-allowed;filter:none}',
      '.__am_status_line{font-size:9px;color:#5c5e6b;word-break:break-all}',
    ].join('');
    document.head.appendChild(style);

    const p = document.createElement('div');
    p.id = '__am_panel';
    p.innerHTML =
      '<div class="__am_card_wrap">' +
        '<div class="__am_hdr" id="__am_hdr">' +
          '<span class="__am_eyebrow">Gheloo</span>' +
          '<span class="__am_title">Area Mover</span>' +
          '<span class="__am_close" id="__am_close">&times;</span>' +
        '</div>' +
        '<div id="__am_body">' +

          '<div class="__am_card">' +
            '<h4>Source Area</h4>' +
            '<div class="__am_desc">Drag a rectangle over the room — other furni dims while you drag, matching furni recolor live, release to set the area.</div>' +
            '<button class="__am_btn secondary small" id="__am_cap_src">Select Source Area</button>' +
            '<div class="__am_status_line" id="__am_src_status">source area: —</div>' +
          '</div>' +

          '<div class="__am_card">' +
            '<h4>Destination</h4>' +
            '<div class="__am_desc">Where point A should end up — everything else in the area shifts by the same amount.</div>' +
            '<button class="__am_btn secondary small" id="__am_cap_dst">Capture Destination</button>' +
            '<div class="__am_status_line" id="__am_dst_status">destination: —</div>' +
          '</div>' +

          '<div class="__am_card">' +
            '<h4>Run</h4>' +
            '<div class="__am_row">' +
              '<button class="__am_btn secondary" id="__am_preview" disabled style="flex:1">Preview</button>' +
              '<button class="__am_btn secondary" id="__am_clear_preview" style="flex:1">Clear Preview</button>' +
            '</div>' +
            '<button class="__am_btn" id="__am_start" disabled>Start Moving</button>' +
            '<button class="__am_btn danger" id="__am_abort" style="display:none">Abort</button>' +
            '<button class="__am_btn secondary" id="__am_undo_all" disabled>Undo All</button>' +
          '</div>' +

        '</div>' +
      '</div>';
    document.body.appendChild(p);
    p.style.display = 'none';

    window.__ghk_makeDraggable(p, p.querySelector('#__am_hdr'), '__ghk_am_pos', function(e) {
      return e.target.id === '__am_close';
    });
    p.querySelector('#__am_close').addEventListener('click', function() { p.style.display = 'none'; });

    const bodyEl = p.querySelector('#__am_body');
    function log(msg) { console.log('[AreaMover]', msg); }

    const previewBtn = bodyEl.querySelector('#__am_preview');
    const clearPreviewBtn = bodyEl.querySelector('#__am_clear_preview');
    const startBtn = bodyEl.querySelector('#__am_start');
    const abortBtn = bodyEl.querySelector('#__am_abort');
    const undoAllBtn = bodyEl.querySelector('#__am_undo_all');

    function _ready() { return !!(_ptA && _ptB && _dstPt); }
    function _updateButtons() {
      previewBtn.disabled = !_ready() || _running;
      startBtn.disabled = !_ready() || _running;
      undoAllBtn.disabled = _lastMoveCount <= 0 || _running;
    }
    setInterval(_updateButtons, 400);

    // Shared by Preview and Start so they can never disagree on which tiles/offset a run covers.
    function _plan() {
      if (!_ready()) return null;
      const tiles = _occupiedTiles(_ptA.x, _ptA.y, _ptB.x, _ptB.y);
      if (!tiles.length) { log('No floor items found in that area.'); return null; }
      const dx = _dstPt.x - Math.min(_ptA.x, _ptB.x);
      const dy = _dstPt.y - Math.min(_ptA.y, _ptB.y);
      if (dx === 0 && dy === 0) { log('Destination is the same as the source — nothing to do.'); return null; }
      return { tiles: tiles, dx: dx, dy: dy };
    }

    bodyEl.querySelector('#__am_cap_src').addEventListener('click', function() {
      startSourceAreaSelect(log);
    });
    bodyEl.querySelector('#__am_cap_dst').addEventListener('click', function() {
      _pendingCapture = true;
      _setWalkBlocked(true);
      log('Armed — click the destination tile now...');
    });
    _renderCaptureStatus();

    previewBtn.addEventListener('click', function() {
      const plan = _plan();
      if (!plan) return;
      const count = _spawnPreview(plan.tiles, plan.dx, plan.dy);
      log('Preview: ' + count + ' ghost item(s) spawned at the destination (client-side only) — check how it looks, then Start Moving or Clear Preview.');
    });
    clearPreviewBtn.addEventListener('click', function() {
      _clearPreviewGhosts();
      log('Preview cleared.');
    });

    startBtn.addEventListener('click', function() {
      const plan = _plan();
      if (!plan) return;
      _clearPreviewGhosts();
      startBtn.style.display = 'none';
      abortBtn.style.display = '';
      _updateButtons();
      _runMove(plan.tiles, plan.dx, plan.dy, MOVE_DELAY_MS, log).finally(function() {
        startBtn.style.display = '';
        abortBtn.style.display = 'none';
        _updateButtons();
      });
    });
    abortBtn.addEventListener('click', function() { _aborted = true; });

    undoAllBtn.addEventListener('click', function() {
      undoAllBtn.disabled = true;
      _undoAll(UNDO_DELAY_MS, log).finally(_updateButtons);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(init); });
  } else {
    window.__ghk_ready(init);
  }
})();
