(function() {
  if (document.getElementById('__rd_panel')) return;

  // Room Deleter — loads every room owned by the logged-in user and, after an explicit
  // confirmation, deletes them all via DeleteRoom (confirmed wire shape:
  // {out:DeleteRoom}{i:<roomId>}).
  //
  // Room listing reuses rare-item-scanner.js's OUT 381 / IN 385 protocol (both unregistered
  // in this hotel's pkt.js, sent/read via raw wire ids) — {s:"<username>"} out, room list
  // back — just passing our OWN username instead of someone else's. Confirmed via a live
  // capture: a native "My Rooms" click sends the exact same OUT 381 with the logged-in
  // user's own name, not a navigator-search composer as first assumed. IN 385's per-record
  // layout: roomId(int), name(str), a second str field, then 10 trailing bytes (byte-exact
  // verified — the second field isn't a fixed-width skip, see rare-item-scanner.js).

  function _outId(name) {
    if (!window.PKT || !window.PKT.OUT) return null;
    for (const id in window.PKT.OUT) {
      if (window.shortName(window.PKT.OUT[id], 'OUT') === name) return parseInt(id);
    }
    return null;
  }
  function _sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

  function _typeName(typeId) {
    const fd = window.FurniData;
    const entry = fd && ((fd.floor && fd.floor[typeId]) || (fd.wall && fd.wall[typeId]));
    return (entry && entry.name) ? entry.name : ('type ' + typeId);
  }
  // Same tag set as rare-item-scanner.js's TAG_RE.
  const RARE_TAG_RE = /\((LTD|Rare|SS|Club Cadeau|BC Shop)\)/i;

  // ── Place every (LTD)/(Rare)/(SS)/(Club Cadeau)/(BC Shop) item from inventory onto a
  // 1..32 x 1..32 grid in the room you're currently standing in, wrapping back to (1,1)
  // and continuing if there are more items than tiles, until inventory is empty.
  //
  // KamerConstructieTool "height active, height 0" is sent once first — byte-exact
  // confirmed against a live capture, and structurally identical to room-clone.js's own
  // already-confirmed _sendConstructionTool(0, null) call (same 47-byte layout, same
  // token stream, just heightActive=1/heightScaled=0/stateActive=0/stateVal=0 here).
  // Without it, placing onto a tile that already has something on it stacks upward or
  // gets rejected; with it, every placement forces height 0 so the grid can be filled
  // solid regardless of what's already on each tile.
  //
  // PlaceObject wire format ({s:"<placementId> <x> <y> <facing>"}) confirmed working
  // already in room-clone.js's own placement loop — reused verbatim here.
  //
  // window.Inventory can be stale/partial — Habbo sends it as paginated FurniList packets,
  // and window.Inventory.loaded just means "at least one page has ever arrived," not "the
  // full inventory is current." Same problem room-clone.js's applyFloorProperties() already
  // solved: force a fresh RequestFurniInventory and wait for the LAST FurniList page before
  // trusting window.Inventory.items. Without this, only whatever happened to already be
  // cached (sometimes just 1 item) gets scanned — explains "places 1 item then stops," and
  // the next click seeing "no items found" once that cached item is gone.
  let _pendingInventoryResolve = null;
  window.onPacket('FurniList', function(p) {
    if (!_pendingInventoryResolve || !p.parsed) return;
    if ((p.parsed.pageIndex + 1) < p.parsed.totalPages) return;
    const resolve = _pendingInventoryResolve;
    _pendingInventoryResolve = null;
    resolve();
  });
  function _refreshInventory() {
    return new Promise(function(resolve) {
      const reqId = _outId('RequestFurniInventory');
      if (reqId === null) { resolve(); return; }
      let settled = false;
      _pendingInventoryResolve = function() {
        if (settled) return;
        settled = true;
        resolve();
      };
      window.sendPacket('OUT', reqId, '');
      setTimeout(function() {
        if (settled) return;
        settled = true;
        _pendingInventoryResolve = null;
        resolve(); // timed out — proceed with whatever's cached rather than hang
      }, 6000);
    });
  }
  // ── Placement watchdog — FurniListRemove (IN, parsed as {itemId}) fires when an item
  // leaves your INVENTORY, which is exactly what happens the moment a PlaceObject actually
  // succeeds (the item moves from inventory into the room). No FurniListRemove for a given
  // placementId within the grace window means the server didn't accept that placement — it's
  // still sitting in your inventory. core/parsers.js already registers its own
  // window.onPacket('FurniListRemove', ...) listener (deletes from window.Inventory.items);
  // this adds a second, independent listener — window.onPacket supports multiple per name,
  // same pattern already used elsewhere (e.g. ExtendedProfile in both user-database.js and
  // core/supabase.js).
  let _pendingPlacements = null; // Map<placementId, true> while a placement run is active
  window.onPacket('FurniListRemove', function(p) {
    if (!_pendingPlacements || !p.parsed) return;
    _pendingPlacements.delete(p.parsed.itemId);
  });
  const PLACEMENT_CONFIRM_GRACE_MS = 2500; // extra wait after the loop for trailing confirmations
  const PLACEMENT_RETRY_GRACE_MS   = 1500; // shorter wait after each retry round
  const PLACEMENT_MAX_RETRIES      = 2;

  async function _placeRareItems(onProgress, shouldStop) {
    await _refreshInventory();
    if (!window.Inventory || !window.Inventory.loaded) {
      return { ok: false, reason: 'Inventory not loaded yet — open your Inventory panel in-game first, then try again.' };
    }
    const pid = _outId('PlaceObject');
    if (pid === null) return { ok: false, reason: 'PlaceObject not found in PKT.' };
    const kctId = _outId('KamerConstructieTool');
    _pendingPlacements = new Map();

    const items = Object.values(window.Inventory.items || {}).filter(function(it) {
      return it.type === 'S' && RARE_TAG_RE.test(_typeName(it.typeId));
    });
    const wallItems = Object.values(window.Inventory.items || {}).filter(function(it) {
      return it.type !== 'S' && RARE_TAG_RE.test(_typeName(it.typeId));
    });
    if (!items.length && !wallItems.length) {
      return { ok: false, reason: 'No (LTD)/(Rare)/(SS)/(Club Cadeau)/(BC Shop) items found in your inventory.' };
    }

    if (kctId !== null) {
      window.sendPacket('OUT', kctId,
        '{b:1}{i:0}' +
        '{i:0}{b:0}' +
        '{b:0}{b:0}{b:0}{b:0}{b:0}' +
        '{i:0}{i:0}{i:0}{i:0}{i:0}{i:0}{i:0}{b:0}{b:0}' +
        '{b:false}{b:false}');
    }

    const total = items.length + wallItems.length;
    let placed = 0;

    let x = 1, y = 1;
    for (let i = 0; i < items.length; i++) {
      if (shouldStop()) break;
      const it = items[i];
      const px = x, py = y;
      const send = function() { window.sendPacket('OUT', pid, '{s:"' + it.placementId + ' ' + px + ' ' + py + ' 0"}'); };
      _pendingPlacements.set(it.placementId, send);
      send();
      placed++;
      onProgress(placed, total);
      x++;
      if (x > 32) { x = 1; y++; if (y > 32) y = 1; }
      await _sleep(200);
    }

    // Wall items — same PlaceObject composer, but the payload is a placement string
    // ({s:"<placementId> :w=W1,W2 l=L1,L2 dir"}) instead of x/y/facing ints. Confirmed
    // against room-clone.js's own wall-placement code. Own independent 1..32 grid,
    // wrapping the same way, dir 'l' fixed (matches poster-mover.js's own default).
    let wx = 1, wy = 1;
    for (let i = 0; i < wallItems.length; i++) {
      if (shouldStop()) break;
      const it = wallItems[i];
      const pwx = wx, pwy = wy;
      const send = function() { window.sendPacket('OUT', pid, '{s:"' + it.placementId + ' :w=' + pwx + ',' + pwy + ' l=0,0 l"}'); };
      _pendingPlacements.set(it.placementId, send);
      send();
      placed++;
      onProgress(placed, total);
      wx++;
      if (wx > 32) { wx = 1; wy++; if (wy > 32) wy = 1; }
      await _sleep(200);
    }

    if (onProgress) onProgress(placed, total, 'Waiting for placement confirmations…');
    await _sleep(PLACEMENT_CONFIRM_GRACE_MS);

    // Anything still unconfirmed gets resent to the SAME tile it was originally placed on
    // — a few rounds, spaced out, before giving up on it.
    let retryRound = 0;
    while (_pendingPlacements.size && retryRound < PLACEMENT_MAX_RETRIES) {
      retryRound++;
      const toRetry = Array.from(_pendingPlacements.values());
      if (onProgress) onProgress(placed, total, 'Retrying ' + toRetry.length + ' unconfirmed placement(s) (' + retryRound + '/' + PLACEMENT_MAX_RETRIES + ')…');
      toRetry.forEach(function(send) { send(); });
      await _sleep(PLACEMENT_RETRY_GRACE_MS);
    }

    const unconfirmed = _pendingPlacements.size;
    const confirmed = placed - unconfirmed;
    _pendingPlacements = null;

    return { ok: true, placed: placed, total: total, confirmed: confirmed, unconfirmed: unconfirmed, retries: retryRound };
  }

  // ── "My World" navigator search — separate from the OUT381/IN385 own-rooms fetch above.
  // This walks a NavigatorSearchResultBlocks reply (header 0x0a82/2690) to get room TAGS
  // (e.g. "with_rare_items") that IN 385 never carries. core/parsers.js already registers
  // a parser for this packet name, but it assumes a wrapper shape (str, int, int(blockCount))
  // that doesn't match this hotel's real bytes — a live capture decoded blockCount as
  // 196610 and blew up. Rather than pin down that wrapper's exact fields (score/ranking/
  // categoryId/etc. — none of which this feature needs), this scans for the two things that
  // ARE reliably self-describing on the wire: length-prefixed ASCII strings. A room record
  // is any (nameStr, ownerStr) pair where ownerStr starts exactly 4 bytes (an int32 ownerId)
  // after nameStr ends — validated against a real capture (49 rooms decoded cleanly, byte-
  // exact, including the two duplicated/near-duplicate entries the game itself sent). A
  // room's tags are then just whatever printable strings sit between the end of that pair
  // and the start of the NEXT room's flatId (4 bytes before the next nameStr) — confirmed
  // against the same capture: room "grrrr" (owner kadet) carried tag "with_rare_items" in
  // exactly that gap, immediately before the following room's flatId began.
  function _findPrintableStrings(bytes) {
    const out = [];
    for (let i = 0; i < bytes.length - 2; i++) {
      const n = (bytes[i] << 8) | bytes[i + 1];
      if (n > 0 && n < 60 && i + 2 + n <= bytes.length) {
        let ok = true;
        for (let j = 0; j < n; j++) {
          const c = bytes[i + 2 + j];
          if (c < 32 || c >= 127) { ok = false; break; }
        }
        if (ok) {
          let text = '';
          for (let j = 0; j < n; j++) text += String.fromCharCode(bytes[i + 2 + j]);
          out.push({ off: i, len: n, text: text });
        }
      }
    }
    return out;
  }
  function _parseMyWorldRooms(raw) {
    if (!raw || raw.byteLength < 20) return [];
    const bytes = new Uint8Array(raw);
    const dv = new DataView(raw);
    const strs = _findPrintableStrings(bytes);

    const anchors = [];
    for (let i = 0; i < strs.length - 1; i++) {
      const a = strs[i], b = strs[i + 1];
      if (b.off !== a.off + 2 + a.len + 4) continue;
      const flatIdOff = a.off - 4;
      if (flatIdOff < 0) continue;
      anchors.push({
        flatIdOff: flatIdOff,
        flatId: dv.getInt32(flatIdOff),
        name: a.text,
        ownerId: dv.getInt32(b.off - 4),
        owner: b.text,
        recordEnd: b.off + 2 + b.len,
      });
    }

    // A tag sitting in the gap between one room's ownerName and the next room's flatId
    // belongs to the FOLLOWING room, not the preceding one — confirmed against live
    // ground truth (2026-08-28): a "with_rare_items" tag physically sitting in the gap
    // right before room 5055990 (azdqs/Kalkoentje1) actually described THAT room, not the
    // "grrrr"/kadet room whose own trailer preceded the gap. Read as a prefix, not a suffix.
    return anchors.map(function(r, idx) {
      const prevEnd = idx > 0 ? anchors[idx - 1].recordEnd : 0;
      const tags = [];
      for (let s = 0; s < strs.length; s++) {
        const t = strs[s];
        if (t.off >= prevEnd && t.off < r.flatIdOff) tags.push(t.text);
      }
      return { roomId: r.flatId, name: r.name, ownerId: r.ownerId, owner: r.owner, tags: tags };
    });
  }

  // Trigger for the packet _parseMyWorldRooms reads. The server only answers
  // NewNavigatorSearch once an actual navigator "window" session exists, so this clicks
  // the taskbar's Rooms icon first (opening the real Navigator UI, same as a user would)
  // before sending the search — confirmed via a live inspect-element capture (2026-08-28):
  // {out:NewNavigatorSearch}{s:"myworld_view"}{b:false}{b:false} (single string arg + two
  // bools — not the two-string NewNavigatorSearchComposer shape guessed earlier, which
  // never got a reply). _closeNavigatorWindow below closes the UI back up afterward so
  // this stays invisible to the player.
  function _requestMyWorldRooms() {
    const navIcon = document.querySelector('.navigation-item.icon.icon-rooms');
    if (navIcon) navIcon.click();
    const sid = _outId('NewNavigatorSearch');
    if (sid === null) return false;
    window.sendPacket('OUT', sid, '{s:"myworld_view"}{b:false}{b:false}');
    return true;
  }

  function _closeNavigatorWindow() {
    const closeBtn = document.querySelector('.nitro-navigator .nitro-card-header-close');
    if (closeBtn) closeBtn.click();
  }

  function _navigateToRoom(roomId) {
    const oid = _outId('OpenFlatConnection');
    if (oid === null) return;
    window.sendPacket('OUT', oid, '{i:' + roomId + '}{b:false}{b:false}');
  }

  function _parseUserRoomsPacket(raw) {
    const r = window.makeReader(raw);
    if (!r) return [];
    const rooms = [];
    try {
      const count = r.int();
      for (let i = 0; i < count; i++) {
        const roomId = r.int();
        const name = r.str();
        r.str(); // second string field — present but unused here
        r.skip(10);
        rooms.push({ roomId: roomId, name: name });
      }
    } catch (e) { /* stop at whatever decoded cleanly so far */ }
    return rooms;
  }

  // ── Fetch "my rooms" — single-pending-slot pattern (window.onPacket has no unsubscribe),
  // same accepted-risk shape as rare-item-scanner.js's _getUserRooms: safe because this tool
  // only ever sends one such request at a time (a manual "Load My Rooms" click). ──
  let _pendingRoomsResolve = null;
  window.PacketStore.subscribe(function(p) {
    if (p.direction !== 'IN' || p.header !== 385 || !p.raw || !_pendingRoomsResolve) return;
    const resolve = _pendingRoomsResolve;
    _pendingRoomsResolve = null;
    resolve(_parseUserRoomsPacket(p.raw));
  });
  function _fetchMyRooms() {
    return new Promise(function(resolve) {
      if (!window._selfName) { resolve(null); return; }
      let settled = false;
      _pendingRoomsResolve = function(rooms) {
        if (settled) return;
        settled = true;
        resolve(rooms);
      };
      window.sendPacket('OUT', 381, '{s:"' + window._selfName.replace(/"/g, '\\"') + '"}');
      setTimeout(function() {
        if (settled) return;
        settled = true;
        _pendingRoomsResolve = null;
        resolve(null); // timed out — distinct from "zero rooms" (empty array)
      }, 5000);
    });
  }

  // ── DeleteRoom only works while standing in the room — same join-then-act pattern as
  // rare-item-scanner.js's _visitAndScanRoom: send OpenFlatConnection, wait for either a
  // matching RoomReady (success) or FlatAccessDenied/CantConnect (instant fail), with a
  // short safety-net timeout for a silent no-reply. ──
  let _pendingRoomReadyResolve = null;
  let _pendingRoomFailResolve = null;
  window.onPacket('RoomReady', function(p) {
    if (_pendingRoomReadyResolve) _pendingRoomReadyResolve(p);
  });
  window.onPacket('FlatAccessDenied', function() {
    if (_pendingRoomFailResolve) _pendingRoomFailResolve();
  });
  window.onPacket('CantConnect', function() {
    if (_pendingRoomFailResolve) _pendingRoomFailResolve();
  });
  function _waitForRoomReady(expectedRoomId) {
    return new Promise(function(resolve) {
      let settled = false;
      function _settle(ok) {
        if (settled) return;
        settled = true;
        _pendingRoomReadyResolve = null;
        _pendingRoomFailResolve = null;
        resolve(ok);
      }
      _pendingRoomReadyResolve = function(p) {
        if (!p.parsed || p.parsed.roomId !== expectedRoomId) return;
        _settle(true);
      };
      _pendingRoomFailResolve = function() { _settle(false); };
      setTimeout(function() { _settle(false); }, 1500);
    });
  }
  async function _joinRoom(roomId) {
    const oid = _outId('OpenFlatConnection');
    if (oid === null) return false;
    window.sendPacket('OUT', oid, '{i:' + roomId + '}{b:false}{b:false}');
    return _waitForRoomReady(roomId);
  }

  // ── Test room creator — CreateFlatMessageComposer(name, description, model, category,
  // maxVisitors, tradeType) followed 500ms later by SaveRoomSettingsMessageComposer with a
  // fixed set of settings. Field order/types confirmed against the real composer sources
  // (billsonnn/nitro-renderer); every literal value below (password "test", doorMode 2,
  // whoCanKick 1, allowWalkThrough true, everything else 0/false) is byte-exact verified
  // against a live capture, not guessed. SaveRoomSettings needs the room's real id, which
  // only exists after the server replies to CreateFlat with FlatCreatedEvent — so this
  // can't just replay two fixed packets, it has to wait for that reply first. ──
  // FlatCreatedEvent has no shared parser in core/parsers.js (niche, only needed here) —
  // parsed locally: roomId(int), roomName(str), confirmed against FlatCreatedMessageParser
  // (billsonnn/nitro-renderer).
  function _parseFlatCreated(raw) {
    const r = window.makeReader(raw);
    if (!r) return null;
    try {
      return { roomId: r.int(), roomName: r.str() };
    } catch (e) { return null; }
  }
  let _pendingFlatCreatedResolve = null;
  window.onPacket('FlatCreated', function(p) {
    if (_pendingFlatCreatedResolve && p.raw) _pendingFlatCreatedResolve(_parseFlatCreated(p.raw));
  });
  function _waitForFlatCreated() {
    return new Promise(function(resolve) {
      let settled = false;
      _pendingFlatCreatedResolve = function(parsed) {
        if (settled) return;
        settled = true;
        _pendingFlatCreatedResolve = null;
        resolve(parsed);
      };
      setTimeout(function() {
        if (settled) return;
        settled = true;
        _pendingFlatCreatedResolve = null;
        resolve(null);
      }, 5000);
    });
  }
  async function _createTestRoom() {
    const createId = _outId('CreateFlat');
    const saveId = _outId('SaveRoomSettings');
    if (createId === null || saveId === null) return { ok: false, reason: 'CreateFlat/SaveRoomSettings not found in PKT.' };

    window.sendPacket('OUT', createId, '{s:"klokje93"}{s:""}{s:"model_5"}{i:32}{i:10}{i:0}');
    const created = await _waitForFlatCreated();
    if (!created) return { ok: false, reason: 'Timed out waiting for the new room to be created.' };

    await _sleep(500);
    window.sendPacket('OUT', saveId,
      '{i:' + created.roomId + '}{s:"klokje93"}{s:""}{i:2}{s:"test"}{i:10}{i:32}{i:0}{i:0}' +
      '{b:false}{b:false}{b:true}{b:false}{i:0}{i:0}{i:0}{i:1}{i:0}{i:0}{i:0}{i:0}{i:0}{i:0}');

    // AssignRights ({out:AssignRights}{i:4367673}) has no room-id argument — it acts on
    // whatever room you're currently standing in, so it only lands correctly once we're
    // actually inside the room we just created.
    const assignId = _outId('AssignRights');
    let rightsAssigned = false;
    if (assignId !== null) {
      const joined = await _joinRoom(created.roomId);
      if (joined) {
        window.sendPacket('OUT', assignId, '{i:4367673}');
        rightsAssigned = true;
      }
    }

    return { ok: true, roomId: created.roomId, roomName: created.roomName, rightsAssigned: rightsAssigned };
  }

  function init() {
    const style = document.createElement('style');
    style.textContent = [
      '#__rd_panel{position:fixed;top:16px;right:16px;width:300px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__rd_panel *{box-sizing:border-box}',
      '.__rd_card_wrap{display:flex;flex-direction:column;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb}',
      '.__rd_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__rd_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}',
      '.__rd_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__rd_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__rd_close:hover{color:#eceefb}',
      '#__rd_body{padding:12px;display:flex;flex-direction:column;gap:10px}',
      '.__rd_card{background:#1c1e2a;border:1px solid #23252f;border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:8px}',
      '.__rd_card h4{margin:0;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#82849a}',
      '.__rd_desc{font-size:9px;color:#5c5e6b;line-height:1.5}',
      '.__rd_row{display:flex;gap:6px;align-items:center}',
      '.__rd_btn{font-size:11px;font-weight:600;padding:7px 10px;border-radius:8px;border:none;cursor:pointer;color:#0A0B10;background:#A6B0FF}',
      '.__rd_btn:hover{filter:brightness(1.08)}',
      '.__rd_btn.danger{background:rgba(231,76,60,0.14);color:#e74c3c;border:1px solid rgba(231,76,60,0.3)}',
      '.__rd_btn:disabled{opacity:0.45;cursor:not-allowed;filter:none}',
      // flex-shrink defaults to 1, so a flex-column list with a capped max-height and MANY
      // children could squash every row down toward zero height instead of overflowing/
      // scrolling (readable rows becoming unreadable thin stripes) — flex-shrink:0 on each
      // row is what actually forces the container to scroll instead of compressing them.
      '.__rd_list{max-height:110px;overflow-y:auto;display:flex;flex-direction:column;gap:3px}',
      '.__rd_room_row{flex-shrink:0;min-height:14px;font-size:10px;color:#82849a;padding:3px 6px;background:#0A0B10;border-radius:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.__rd_room_row.clickable{cursor:pointer}',
      '.__rd_room_row.clickable:hover{background:#1c1e2a;color:#eceefb}',
      '.__rd_section_label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#5c5e6b;margin:8px 0 4px}',
      '.__rd_empty{font-size:9px;color:#5c5e6b}',
      '#__rd_confirm_overlay{position:fixed;inset:0;z-index:2200;background:rgba(0,0,0,0.72);display:flex;align-items:center;justify-content:center}',
      '.__rd_confirm_card{width:280px;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);padding:16px;color:#eceefb;display:flex;flex-direction:column;gap:10px}',
      '.__rd_confirm_title{font-size:13px;font-weight:700;color:#e74c3c}',
      '.__rd_confirm_text{font-size:11px;color:#82849a;line-height:1.5}',
      '.__rd_confirm_actions{display:flex;gap:8px;margin-top:4px}',
    ].join('');
    document.head.appendChild(style);

    const p = document.createElement('div');
    p.id = '__rd_panel';
    p.innerHTML =
      '<div class="__rd_card_wrap">' +
        '<div class="__rd_hdr" id="__rd_hdr">' +
          '<span class="__rd_eyebrow">Gheloo</span>' +
          '<span class="__rd_title">Room Deleter</span>' +
          '<span class="__rd_close" id="__rd_close">&times;</span>' +
        '</div>' +
        '<div id="__rd_body">' +

          '<label class="__rd_row" style="padding:0 2px;cursor:pointer">' +
            '<input type="checkbox" id="__rd_autoopen">' +
            '<span class="__rd_desc" style="margin:0">Auto-open this panel on page load</span>' +
          '</label>' +

          '<div class="__rd_card">' +
            '<h4>Your Rooms</h4>' +
            '<div class="__rd_row">' +
              '<button class="__rd_btn" id="__rd_load" style="flex:1">Load My Rooms</button>' +
            '</div>' +
            '<div id="__rd_list_wrap"></div>' +
            '<div class="__rd_desc" id="__rd_rare_note" style="display:none"></div>' +
          '</div>' +

          '<div class="__rd_card">' +
            '<h4>Delete</h4>' +
            '<div class="__rd_row">' +
              '<button class="__rd_btn danger" id="__rd_delete_all" style="flex:1" disabled>Delete ALL rooms</button>' +
              '<button class="__rd_btn" id="__rd_stop" style="flex-shrink:0" disabled>Stop</button>' +
            '</div>' +
            '<div class="__rd_desc" id="__rd_progress">Load your rooms first.</div>' +
          '</div>' +

          '<div class="__rd_card">' +
            '<h4>Test Room</h4>' +
            '<div class="__rd_row">' +
              '<button class="__rd_btn" id="__rd_create_test" style="flex:1">Create Test Room</button>' +
            '</div>' +
            '<div class="__rd_desc" id="__rd_create_status">Sends CreateFlat, then SaveRoomSettings 500ms later.</div>' +
          '</div>' +

          '<div class="__rd_card">' +
            '<h4>Place Rare Items</h4>' +
            '<div class="__rd_row">' +
              '<button class="__rd_btn" id="__rd_place_rares" style="flex:1">Place in this room</button>' +
              '<button class="__rd_btn" id="__rd_place_stop" style="flex-shrink:0" disabled>Stop</button>' +
            '</div>' +
            '<div class="__rd_desc" id="__rd_place_status">Fills a 1-32 x 1-32 grid (floor and wall separately) in your current room with every (LTD)/(Rare)/(SS)/(Club Cadeau)/(BC Shop) item in your inventory, wrapping and stacking if you have more than 1024 of one kind.</div>' +
          '</div>' +

        '</div>' +
      '</div>';
    document.body.appendChild(p);
    p.style.display = 'none';

    window.__ghk_makeDraggable(p, p.querySelector('#__rd_hdr'), '__ghk_rd_pos', function(e) {
      return e.target.id === '__rd_close';
    });
    p.querySelector('#__rd_close').addEventListener('click', function() { p.style.display = 'none'; });

    // ── Auto-open on page load ──
    const AUTOOPEN_KEY = '__rd_autoopen';
    let _autoOpen = false;
    try { _autoOpen = localStorage.getItem(AUTOOPEN_KEY) === '1'; } catch(_) {}
    const autoOpenCb = p.querySelector('#__rd_autoopen');
    autoOpenCb.checked = _autoOpen;
    autoOpenCb.addEventListener('change', function() {
      try { localStorage.setItem(AUTOOPEN_KEY, autoOpenCb.checked ? '1' : '0'); } catch(_) {}
    });
    if (_autoOpen) {
      p.style.display = '';
      if (window.__ghk_bringToFront) window.__ghk_bringToFront(p);
    }

    const loadBtn     = p.querySelector('#__rd_load');
    const deleteBtn    = p.querySelector('#__rd_delete_all');
    const stopBtn      = p.querySelector('#__rd_stop');
    const progressEl   = p.querySelector('#__rd_progress');
    const listWrapEl   = p.querySelector('#__rd_list_wrap');

    let _rooms = [];       // [{roomId, name}, ...]
    let _deleting = false;
    let _stopRequested = false;

    // Accounts with a lot of rooms could otherwise render hundreds of DOM rows at once —
    // cap it and point at the fact there are more, same pattern user-database.js uses for
    // its own (much bigger) list.
    const ROOM_RENDER_CAP = 300;

    function _esc(s) {
      return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Rare-items rooms come from a separate navigator fetch (_parseMyWorldRooms) — kept
    // apart from _rooms on purpose so Delete ALL never touches them, just rendered as a
    // second section inside the same list.
    let _rareRooms = [];

    function _roomsSectionHtml() {
      if (!_rooms.length) return '<div class="__rd_empty">No rooms loaded yet.</div>';
      const shown = _rooms.length > ROOM_RENDER_CAP ? _rooms.slice(0, ROOM_RENDER_CAP) : _rooms;
      return '<div class="__rd_list">' + shown.map(function(r) {
        return '<div class="__rd_room_row">' + _esc(r.name) + '</div>';
      }).join('') + (_rooms.length > ROOM_RENDER_CAP
        ? '<div class="__rd_empty">Showing first ' + ROOM_RENDER_CAP + ' of ' + _rooms.length + '.</div>'
        : '') + '</div>';
    }
    function _rareSectionHtml() {
      if (!_rareRooms.length) return '';
      const shown = _rareRooms.length > ROOM_RENDER_CAP ? _rareRooms.slice(0, ROOM_RENDER_CAP) : _rareRooms;
      return '<div class="__rd_section_label">Rare Items — click to jump there</div>'
        + '<div class="__rd_list">' + shown.map(function(r) {
          return '<div class="__rd_room_row clickable" data-room-id="' + r.roomId + '" title="' + _esc(r.owner) + '">'
            + _esc(r.name) + '</div>';
        }).join('') + (_rareRooms.length > ROOM_RENDER_CAP
          ? '<div class="__rd_empty">Showing first ' + ROOM_RENDER_CAP + ' of ' + _rareRooms.length + '.</div>'
          : '') + '</div>';
    }
    function _renderList() {
      listWrapEl.innerHTML = _roomsSectionHtml() + _rareSectionHtml();
    }
    // Delegated once on the wrapper — only rare-items rows carry data-room-id, the
    // deletable "Your Rooms" rows aren't clickable.
    listWrapEl.addEventListener('click', function(e) {
      const row = e.target.closest('.__rd_room_row[data-room-id]');
      if (!row) return;
      _navigateToRoom(parseInt(row.dataset.roomId, 10));
    });
    // Visible feedback for the best-effort navigator request — silently doing nothing when
    // the composer guess is wrong made it look broken with no way to tell why.
    const rareNoteEl = p.querySelector('#__rd_rare_note');
    let _rareRequestTimer = null;
    // Only auto-close the navigator window if WE opened it (via _requestMyWorldRooms) —
    // never if the player already had it open themselves for some other reason.
    let _weOpenedNavigator = false;
    function _rareNote(text) {
      rareNoteEl.style.display = text ? '' : 'none';
      rareNoteEl.textContent = text || '';
    }
    // Passive — picks up a reply whether it came from loadBtn's request below or from you
    // opening the navigator's "My World" tab yourself in-game.
    window.onPacket('NavigatorSearchResultBlocks', function(pkt) {
      if (_rareRequestTimer) { clearTimeout(_rareRequestTimer); _rareRequestTimer = null; }
      if (_weOpenedNavigator) { _closeNavigatorWindow(); _weOpenedNavigator = false; }
      if (!pkt.raw) return;
      let rooms;
      try { rooms = _parseMyWorldRooms(pkt.raw); } catch (e) { return; }
      if (!rooms.length) return; // not a useful reply, leave whatever's shown
      _rareRooms = rooms.filter(function(r) { return r.tags.indexOf('with_rare_items') !== -1; });
      _rareNote(_rareRooms.length ? '' : 'Navigator replied, but no room in it had the rare-items tag.');
      _renderList();
    });

    function _setButtonsForDeleting(active) {
      loadBtn.disabled = active;
      deleteBtn.disabled = active || !_rooms.length;
      stopBtn.disabled = !active;
    }

    loadBtn.addEventListener('click', function() {
      loadBtn.disabled = true;
      deleteBtn.disabled = true;
      progressEl.textContent = 'Loading your rooms...';
      // Opens the navigator UI (briefly — see _requestMyWorldRooms/_closeNavigatorWindow)
      // to also fetch the rare-items tags. Doesn't affect the main load; if it's
      // unsupported, that section just stays empty until you open the navigator's "My
      // World" tab yourself.
      _rareNote('');
      if (_rareRequestTimer) clearTimeout(_rareRequestTimer);
      const sentRareReq = _requestMyWorldRooms();
      if (sentRareReq) {
        _weOpenedNavigator = true;
        _rareRequestTimer = setTimeout(function() {
          _rareRequestTimer = null;
          if (_weOpenedNavigator) { _closeNavigatorWindow(); _weOpenedNavigator = false; }
          if (!_rareRooms.length) {
            _rareNote('No reply to the rare-items navigator request — open the in-game navigator\'s "My World" tab once manually, it\'ll be picked up from there.');
          }
        }, 4000);
      } else {
        _rareNote('NewNavigatorSearch not found in PKT — open the in-game navigator\'s "My World" tab manually instead, it\'ll still get picked up.');
      }
      _fetchMyRooms().then(function(rooms) {
        loadBtn.disabled = false;
        if (rooms === null) {
          progressEl.textContent = 'Timed out waiting for your room list — try again.';
          return;
        }
        _rooms = rooms;
        _renderList();
        deleteBtn.disabled = !_rooms.length;
        progressEl.textContent = _rooms.length
          ? _rooms.length + ' room(s) loaded.'
          : 'You have no rooms.';
      });
    });

    function _showConfirm(count, onConfirm) {
      const overlay = document.createElement('div');
      overlay.id = '__rd_confirm_overlay';
      overlay.innerHTML =
        '<div class="__rd_confirm_card">' +
          '<div class="__rd_confirm_title">Delete ' + count + ' room(s)?</div>' +
          '<div class="__rd_confirm_text">This permanently deletes every one of your ' + count + ' rooms. This cannot be undone.</div>' +
          '<div class="__rd_confirm_actions">' +
            '<button class="__rd_btn danger" id="__rd_confirm_yes" style="flex:1">Delete all</button>' +
            '<button class="__rd_btn" id="__rd_confirm_no" style="flex:1">Cancel</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      function close() { overlay.remove(); }
      overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
      overlay.querySelector('#__rd_confirm_no').addEventListener('click', close);
      overlay.querySelector('#__rd_confirm_yes').addEventListener('click', function() { close(); onConfirm(); });
    }

    async function _runDelete() {
      const deleteRoomId = _outId('DeleteRoom');
      if (deleteRoomId === null) { progressEl.textContent = 'DeleteRoom not found in PKT.'; return; }

      _deleting = true;
      _stopRequested = false;
      _setButtonsForDeleting(true);

      const total = _rooms.length;
      const remaining = _rooms.slice();
      const skippedRooms = []; // failed to join — kept visible/pending for a retry, not deleted
      let done = 0;
      while (remaining.length) {
        if (_stopRequested) break;
        const room = remaining.shift();
        progressEl.textContent = 'Entering "' + room.name + '" (' + (done + skippedRooms.length + 1) + '/' + total + ')...';
        const joined = await _joinRoom(room.roomId);
        if (_stopRequested) { remaining.unshift(room); break; }
        let justDeleted = false;
        if (joined) {
          window.sendPacket('OUT', deleteRoomId, '{i:' + room.roomId + '}');
          done++;
          justDeleted = true;
        } else {
          skippedRooms.push(room);
        }
        progressEl.textContent = 'Deleted ' + done + ', skipped ' + skippedRooms.length + ' of ' + total + '...';
        _rooms = remaining.concat(skippedRooms);
        _renderList();
        // The server needs real time to tear down the room you just deleted (and walk you
        // out of it) before it'll let you join the next one — a plain 200ms pacing delay
        // wasn't enough and produced spurious "can't enter" failures on the very next room.
        await _sleep(justDeleted ? 1000 : 200);
      }

      _rooms = remaining.concat(skippedRooms);
      _deleting = false;
      _setButtonsForDeleting(false);
      deleteBtn.disabled = !_rooms.length;
      progressEl.textContent = (_stopRequested ? 'Stopped — ' : 'Done — ') +
        'deleted ' + done + ', skipped ' + skippedRooms.length + ' (couldn\'t enter), ' + remaining.length + ' not attempted, of ' + total + '.';
    }

    deleteBtn.addEventListener('click', function() {
      if (_deleting || !_rooms.length) return;
      _showConfirm(_rooms.length, _runDelete);
    });
    stopBtn.addEventListener('click', function() { _stopRequested = true; });

    const createTestBtn = p.querySelector('#__rd_create_test');
    const createStatusEl = p.querySelector('#__rd_create_status');
    createTestBtn.addEventListener('click', function() {
      createTestBtn.disabled = true;
      createStatusEl.textContent = 'Creating room...';
      _createTestRoom().then(function(result) {
        createTestBtn.disabled = false;
        createStatusEl.textContent = result.ok
          ? 'Created "' + result.roomName + '" (#' + result.roomId + '), saved settings' + (result.rightsAssigned ? ', and assigned rights.' : ' (rights not assigned).')
          : result.reason;
      });
    });

    const placeBtn = p.querySelector('#__rd_place_rares');
    const placeStopBtn = p.querySelector('#__rd_place_stop');
    const placeStatusEl = p.querySelector('#__rd_place_status');
    let _placeStopRequested = false;
    placeBtn.addEventListener('click', function() {
      placeBtn.disabled = true;
      placeStopBtn.disabled = false;
      _placeStopRequested = false;
      placeStatusEl.textContent = 'Refreshing inventory...';
      _placeRareItems(
        function(placed, total, note) { placeStatusEl.textContent = note || ('Placed ' + placed + '/' + total + '...'); },
        function() { return _placeStopRequested; }
      ).then(function(result) {
        placeBtn.disabled = false;
        placeStopBtn.disabled = true;
        placeStatusEl.textContent = result.ok
          ? (_placeStopRequested ? 'Stopped — ' : 'Done — ') + 'sent ' + result.placed + '/' + result.total
            + ', confirmed ' + result.confirmed + ', unconfirmed ' + result.unconfirmed
            + (result.retries ? ' (after ' + result.retries + ' retry round(s))' : '')
            + (result.unconfirmed ? ' — still in inventory, placement rejected.' : '.')
          : result.reason;
      });
    });
    placeStopBtn.addEventListener('click', function() { _placeStopRequested = true; });

    _renderList();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(init); });
  } else {
    window.__ghk_ready(init);
  }
})();
