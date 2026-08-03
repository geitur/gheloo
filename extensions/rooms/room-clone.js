(function() {
  if (document.getElementById('__rclone')) return;

  const BLUEPRINTS_KEY = '__ghk_rc_blueprints';
  const CATALOG_KEY     = '__ghk_rc_catalog';

  let _blueprints  = [];
  let _catalogItems = [];
  let _scanning     = false;
  let _scanQueue    = [];
  let _scanTimer    = 0;

  function _loadBlueprints() { try { _blueprints = JSON.parse(localStorage.getItem(BLUEPRINTS_KEY) || '[]'); } catch(_) { _blueprints = []; } }
  function _saveBlueprints() { try { localStorage.setItem(BLUEPRINTS_KEY, JSON.stringify(_blueprints)); } catch(_) {} }
  function _loadCatalog() { try { _catalogItems = JSON.parse(localStorage.getItem(CATALOG_KEY) || '[]'); } catch(_) { _catalogItems = []; } }
  function _saveCatalog() { try { localStorage.setItem(CATALOG_KEY, JSON.stringify(_catalogItems)); } catch(_) {} }
  function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function _nextId() { return _blueprints.reduce((m, b) => Math.max(m, b.id || 0), 0) + 1; }

  function _log(msg) {
    console.log('[RoomClone]', msg);
  }

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

  // Tile pickers (Capture Area's two corners, Build's anchor) read x/y off the real
  // MoveAvatar click packet but must stop it actually reaching the server — otherwise
  // the avatar visibly walks to every tile clicked while picking. addPacket() (ws.js)
  // still runs before any block, so window.onPacket('MoveAvatar', ...) listeners keep
  // firing normally even though the packet itself never gets sent. Uses window's shared
  // _setOutgoingBlock (ws.js) rather than poking _blockOutgoingFilters directly — the
  // game's socket commonly runs inside a Worker, where the worker's own hooked send()
  // fires before this thread ever sees the packet, so blocking has to reach the worker
  // too (by wire id, via postMessage — a live filter FUNCTION can't cross that boundary).
  let _moveAvatarId = null;
  function _setWalkBlocked(blocked) {
    if (_moveAvatarId === null) _moveAvatarId = _outId('MoveAvatar');
    if (_moveAvatarId === null || !window._setOutgoingBlock) return;
    window._setOutgoingBlock(_moveAvatarId, blocked);
  }

  // Every int found anywhere in an offer's raw fields — used to match an offer to a
  // furni typeId without needing to know the exact field position (not mapped).
  function _offerInts(item) {
    return item.ints || [];
  }

  // window.FurniData is populated by furni-hider.js from the same leet_furni.json used
  // elsewhere in Gheloo, keyed by typeId with a real display name.
  function _typeName(typeId) {
    const fd = window.FurniData;
    const entry = fd && ((fd.floor && fd.floor[typeId]) || (fd.wall && fd.wall[typeId]));
    return (entry && entry.name) ? entry.name : ('type ' + typeId);
  }

  // Never auto-buy limited/rare offers — these are one-off collectibles, not
  // regular restockable furni, so blindly purchasing them risks real currency loss.
  const RESTRICTED_NAME_RE = /\((SS|LTD|BC|BC Shop|BT|Club Cadeau|Rare)\)/i;
  function _isRestrictedName(name) {
    return RESTRICTED_NAME_RE.test(name || '');
  }
  function _isRestrictedOffer(offer) {
    return _isRestrictedName(offer.name);
  }

  // Leet VIP catalog offers reject purchase packets from non-VIP accounts — skip
  // buying them entirely rather than sending a purchase that'll just fail server-side.
  const VIP_NAME_RE = /leet vip/i;
  function _isVipLockedOffer(offer) {
    return VIP_NAME_RE.test(offer.name || '') && !window.__ghk_isVip;
  }

  function _findOfferForTypeId(typeId) {
    for (let i = 0; i < _catalogItems.length; i++) {
      const offer = _catalogItems[i];
      if (_isRestrictedOffer(offer)) continue;
      if (_offerInts(offer).indexOf(typeId) !== -1) return offer;
    }
    return null;
  }

  // Compares every furni type id known from leet_furni.json against the type ids
  // seen across scanned catalog offers, to gauge how complete the scan is. Not every
  // furni type is actually catalog-purchasable (event/quest/VIP rewards), so 100%
  // isn't always reachable — this is a coverage estimate, not a scan-progress meter.
  function _computeCoverage() {
    const fd = window.FurniData;
    if (!fd || (!fd.floor && !fd.wall)) return null;
    if (!_catalogItems.length) return null;

    // Exclude (SS)/(Rare)/(LTD)/(BC Shop)/(Club Cadeau)/(BT) types from the coverage
    // count entirely — same RESTRICTED_NAME_RE used to skip buying them, but here it
    // keeps them out of the denominator since they're not realistically buyable anyway.
    const allTypeIds = new Set();
    if (fd.floor) Object.keys(fd.floor).forEach(function(k) { const t = parseInt(k); if (!_isRestrictedName(fd.floor[k] && fd.floor[k].name)) allTypeIds.add(t); });
    if (fd.wall) Object.keys(fd.wall).forEach(function(k) { const t = parseInt(k); if (!_isRestrictedName(fd.wall[k] && fd.wall[k].name)) allTypeIds.add(t); });

    const covered = new Set();
    _catalogItems.forEach(function(offer) {
      if (_isRestrictedOffer(offer)) return;
      _offerInts(offer).forEach(function(t) { covered.add(t); });
    });

    const missing = [];
    allTypeIds.forEach(function(t) { if (!covered.has(t)) missing.push(t); });

    const total = allTypeIds.size;
    const have = total - missing.length;
    return { have: have, total: total, pct: total ? (have / total) * 100 : 0, missing: missing };
  }

  function _checkCoverage() {
    const result = _computeCoverage();
    if (!result) {
      if (!window.FurniData || (!window.FurniData.floor && !window.FurniData.wall)) _log('FurniData not loaded yet — cannot check coverage.');
      else _log('No catalog offers known yet — scan or browse the catalog first.');
      return;
    }
    _log('Catalog coverage: ' + result.have + '/' + result.total + ' known furni type(s) have a scanned offer (' + result.pct.toFixed(1) + '%).');
    if (result.missing.length) {
      const shown = result.missing.slice(0, 25).map(_typeName).join(', ');
      _log(result.missing.length + ' type(s) with no known offer: ' + shown + (result.missing.length > 25 ? ', +' + (result.missing.length - 25) + ' more' : ''));
    }
  }

  // Exposed so the Gheloo Proxy tab can show a live "catalog scanned %" line
  // without reaching into this module's private state.
  window.__ghl_rcCoverage = _computeCoverage;

  // ── Catalog capture ────────────────────────────────────────────────────────
  // No reliable way to discover every real page id ourselves (tried index-tree
  // parsing and brute-force 1-5500 page walking — both undercounted significantly),
  // so instead this passively listens for {in:CatalogPage} responses from browsing
  // the real in-game catalog UI by hand, with no discovery/guessing needed at all.
  //
  // Furni type id and offer id are the same value for ~92% of items in this hotel's
  // furnidata, so the type id doubles as the offer id here — wrong for the remaining
  // ~8% (shared-offer variants), which just means "Buy Missing" may purchase a
  // different color/variant of the right item.

  function clearCatalog() {
    _catalogItems = [];
    _saveCatalog();
    _log('Catalog cleared.');
    _renderCatalogStatus();
  }

  // Brute-force page walk, now that the parser is actually correct (schema-driven, not
  // heuristic-guessed) so it's worth exhaustively covering. The always-on CatalogPage
  // listener below does the actual saving — this just fires the requests.
  function startFullPageScan(fromId, toId) {
    if (_scanning) return;
    _scanning = true;
    _scanQueue = [];
    for (let i = fromId; i >= toId; i--) _scanQueue.push(i);
    _log('Full scan started — walking pages ' + fromId + ' down to ' + toId + '...');
    _renderCatalogStatus();
    _scanTick();
  }

  function stopCatalogScan() {
    _scanning = false;
    _scanQueue = [];
    clearTimeout(_scanTimer);
    _log('Catalog scan stopped.');
    _renderCatalogStatus();
  }

  // Exposed so the Gheloo Proxy tab's "Scan Again" button can kick off a Full Scan
  // without reaching into this module's private state.
  window.__ghl_rcStartScan = function() { startFullPageScan(5500, 0); };

  // Exposed so the Proxy tab can show live scan progress (pages left, offers found)
  // while a Full Scan is running, instead of just the static coverage percentage.
  window.__ghl_rcScanStatus = function() {
    return { scanning: _scanning, remaining: _scanQueue.length, found: _catalogItems.length };
  };

  function _scanTick() {
    if (!_scanning) return;
    if (!_scanQueue.length) {
      _scanning = false;
      _log('Catalog scan done — ' + _catalogItems.length + ' offer(s) known.');
      _renderCatalogStatus();
      return;
    }
    const pageId = _scanQueue.shift();
    const gid = _outId('GetCatalogPage');
    if (gid !== null) window.sendPacket('OUT', gid, '{i:' + pageId + '}{s:"NORMAL"}{i:-1}');
    _renderCatalogStatus();
    _scanTimer = setTimeout(_scanTick, 60);
  }

  // Real schema, from G-Earth's HCatalogPage/HOffer/HProduct parsers (not guessed):
  //   header: pageId, catalogType, layoutCode, images[], texts[]
  //   offerCount, then per offer: offerId, localizationId, rent(bool), priceInCredits,
  //     priceInActivityPoints, activityPointType, priceInSilver, giftable(bool),
  //     productCount, then per product: productType(str) — if "b" (badge) just an
  //     extraParam string follows; otherwise furniClassId, extraParam, productCount,
  //     uniqueLimitedItem(bool) [+ seriesSize, itemsLeft if limited] — then after all
  //     products: clubLevel, bundlePurchaseAllowed(bool), isPet(bool), previewImage.
  // furniClassId inside each product is the real furni type id, and the offer's own
  // offerId is the real purchasable id — no more conflating a stray nearby int with
  // either of those, which is what the old heuristic scan was doing wrong.
  function _parseCatalogPageOffers(raw) {
    const r = window.makeReader(raw);
    if (!r) return null;
    try {
      const pageId = r.int();
      r.str(); // catalogType
      r.str(); // layoutCode
      const imageCount = r.int();
      for (let i = 0; i < imageCount; i++) r.str();
      const textCount = r.int();
      let pageTitle = null;
      for (let i = 0; i < textCount; i++) {
        const text = r.str();
        if (i === 0 && text) pageTitle = text;
      }

      const offerCount = r.int();
      const offers = [];
      for (let i = 0; i < offerCount; i++) {
        try {
          const offerId = r.int();
          const localizationId = r.str();
          r.bool(); // rent
          r.int(); // priceInCredits
          r.int(); // priceInActivityPoints
          r.int(); // activityPointType
          // priceInSilver omitted — this private hotel's server core likely predates
          // that field (it's a fairly recent addition even on official Habbo)
          r.bool(); // giftable

          const productCount = r.int();
          const typeIds = [];
          for (let j = 0; j < productCount; j++) {
            r.str(); // productType
            typeIds.push(r.int()); // furniClassId — read unconditionally for every product type
            r.str(); // extraParam
            r.int(); // productCount
            if (r.bool()) { r.int(); r.int(); } // uniqueLimitedItem -> seriesSize, itemsLeft
          }

          r.int(); // clubLevel
          r.bool(); // bundlePurchaseAllowed
          r.bool(); // unused
          r.str(); // previewImage

          offers.push({ offerId: offerId, name: localizationId, pageId: pageId, ints: typeIds });
        } catch (offerErr) {
          _log('Catalog page ' + pageId + ': parse failed at offer ' + (i + 1) + '/' + offerCount + ' (byte offset ' + r.getReadIndex() + ') — ' + offerErr.message + '. Keeping ' + offers.length + ' offer(s) parsed so far.');
          break;
        }
      }
      if (!offers.length) _log('Catalog page ' + pageId + ': 0 offers parsed out of ' + offerCount + ' declared.');
      return { pageId: pageId, pageTitle: pageTitle, offers: offers };
    } catch (topErr) {
      _log('Catalog page parse failed at header: ' + topErr.message);
      return null;
    }
  }

  // Always listening — clicking through categories in the real in-game catalog UI
  // captures them too, with no page-id discovery/guessing needed at all since the
  // real client is doing the navigating. Skips pages already known so re-visiting
  // one doesn't duplicate its items.
  window.onPacket('CatalogPage', function(p) {
    if (!p.raw) return;
    const page = _parseCatalogPageOffers(p.raw);
    if (!page || !page.offers.length) return;
    if (_catalogItems.some(function(c) { return c.pageId === page.pageId; })) return;
    page.offers.forEach(function(o) {
      _catalogItems.push({ offerId: o.offerId, name: o.name, pageId: page.pageId, pageTitle: page.pageTitle, ints: o.ints });
    });
    _saveCatalog();
    _log('Saved ' + page.offers.length + ' item(s) from page ' + page.pageId + ' (' + (_catalogItems.length) + ' total known).');
    _renderCatalogStatus();
  });

  // Surfaces whatever generic error code the server sends back — floor-plan saves have
  // no dedicated error event of their own, so this is the only way a silent rejection
  // (e.g. "room already has a custom floor plan", permission issue, etc.) becomes visible
  // instead of just looking like nothing happened.
  window.onPacket('GenericError', function(p) {
    if (!p.raw) { _log('Server sent a generic error (no further detail available).'); return; }
    try {
      const r = window.makeReader(p.raw);
      _log('Server generic error code: ' + r.int());
    } catch (e) {
      _log('Server sent a generic error (could not decode).');
    }
  });

  // Keep the Capture tab's room name live as you walk between rooms — RoomReady fires
  // first with just the numeric id (fallback text), GetGuestRoomResult follows shortly
  // after with the real name, so both re-render to avoid a stale name lingering.
  window.onPacket('RoomReady', function() { _renderCaptureTab(); });
  window.onPacket('GetGuestRoomResult', function() { _renderCaptureTab(); });

  // The room's real door tile isn't broadcast as its own field anywhere, but the
  // server always spawns you standing ON it when you first enter — so the very first
  // 'Users' roster after RoomReady (before you take a single step) doubles as the real
  // door position/facing. Captured once per room visit; lost if you walk away first,
  // in which case captureRoom() falls back to wherever you're standing then.
  let _roomEntryPos = null;
  window.onPacket('RoomReady', function() { _roomEntryPos = null; });
  window.onPacket('Users', function(p) {
    if (_roomEntryPos || !p.parsed) return;
    const me = p.parsed.users.find(function(u) { return u.name === window._selfName; });
    if (me) _roomEntryPos = { x: me.x, y: me.y, dir: me.bodyDirection };
  });

  // Real purchase outcome — "Purchase sent" above only means the packet went out, not
  // that the server accepted it. These give the actual answer.
  window.onPacket('PurchaseOK', function() { _log('Purchase confirmed by server.'); });
  window.onPacket('PurchaseError', function() { _log('Purchase FAILED — server rejected it.'); });
  window.onPacket('PurchaseNotAllowed', function() { _log('Purchase FAILED — not allowed (wrong offer/insufficient funds/etc).'); });

  // Apply always asks the server for a fresh inventory first (RequestFurniInventory)
  // instead of trusting whatever window.Inventory happened to hold — this listener
  // fires _applyBlueprintNow once that fresh FurniList (all pages) has landed.
  let _pendingApplyId = null, _pendingApplyTimer = null, _pendingApplyRetry = false, _pendingApplyIncludeWalls = false;
  window.onPacket('FurniList', function(p) {
    if (_pendingApplyId === null || !p.parsed) return;
    if ((p.parsed.pageIndex + 1) < p.parsed.totalPages) return;
    const id = _pendingApplyId, retry = _pendingApplyRetry, includeWalls = _pendingApplyIncludeWalls;
    _pendingApplyId = null;
    if (_pendingApplyTimer) { clearTimeout(_pendingApplyTimer); _pendingApplyTimer = null; }
    _applyBlueprintNow(id, retry, includeWalls);
  });

  // Area capture — drives the real client's OWN native area-selection tool
  // (RoomEngine._areaSelectionManager, exposed as window.RoomEngine by core/eval-hook.js —
  // same one Habbo's Wired "select furni by area" screens use, and what hibisco itself just
  // arms rather than building its own). activate()+startSelecting() is the entire
  // integration: the engine's own mouse pipeline (_roomObjectEventHandler.
  // handleRoomObjectMouseEvent, confirmed in the decoded client) already feeds every tile
  // mousedown/move/click into the manager automatically once armed — it dims every other
  // furni to 20% alpha and draws its own live tile-highlight as you drag, with zero
  // per-frame code from us. The manager eats the finishing click itself (RoomEngine.
  // dispatchMouseEvent short-circuits the normal walk-there dispatch when
  // finishSelecting() fires), so unlike the old two-corner-click version, no avatar
  // movement blocking or packet interception is needed here at all — the same reason
  // clicking on a furni sprite (instead of open floor) to START a drag won't work: that
  // click never becomes a floor/tile mouse event in the first place.
  let _areaPicking = false;
  let _areaLiveHighlightedIds = []; // ids currently wearing window.__gh_FurniSelect's recolor

  // The real client's own _selectionShader defaults to white/60%-gray, not this
  // extension's cyan look — same one-time repoint area-mover.js does too (independent
  // file, no shared module system between content scripts, hence the small duplication
  // rather than a cross-file call).
  let _areaColorMatched = false;
  function _matchAreaHighlightColors() {
    if (_areaColorMatched || !window.__gh_FurniSelect || !window.__gh_FurniSelect._selectionShader) return;
    window.__gh_FurniSelect._selectionShader.color = 0x66CCFF;
    window.__gh_FurniSelect._selectionShader.lineColor = 0xFFFFFF;
    _areaColorMatched = true;
  }

  // Diffs the recolor onto whatever's currently inside (x,y,w,h) rather than clearing and
  // reapplying everything on every call — this runs on every drag step (see the setHighlight
  // patch below), so a full hide-then-show-all each time would flicker every covered item on
  // every single mouse-move.
  function _syncAreaLiveHighlight(x, y, w, h) {
    if (!window.__gh_FurniSelect || !window.Room) return;
    _matchAreaHighlightColors();
    const wantIds = (w && h) ? Object.values(window.Room.floorItems || {})
      .filter(function(it) { return it.x >= x && it.x <= x + w - 1 && it.y >= y && it.y <= y + h - 1; })
      .map(function(it) { return it.id; }) : [];
    const wantSet = new Set(wantIds);
    const haveSet = new Set(_areaLiveHighlightedIds);
    _areaLiveHighlightedIds.forEach(function(id) {
      if (!wantSet.has(id)) { try { window.__gh_FurniSelect.hide(id); } catch(_e) {} }
    });
    wantIds.forEach(function(id) {
      if (!haveSet.has(id)) { try { window.__gh_FurniSelect.show(id); } catch(_e) {} }
    });
    _areaLiveHighlightedIds = wantIds;
  }

  function _clearAreaLiveHighlight() {
    if (window.__gh_FurniSelect) {
      _areaLiveHighlightedIds.forEach(function(id) { try { window.__gh_FurniSelect.hide(id); } catch(_e) {} });
    }
    _areaLiveHighlightedIds = [];
  }

  // Patched once, on the manager instance (persists across every start/cancel cycle —
  // areaSelectionManager() always returns the same singleton). setHighlight(x,y,w,h) is
  // what the manager's own handleTileMouseEvent calls on every ROE_MOUSE_DOWN/MOUSE_MOVE
  // it receives from the room's normal mouse pipeline while selecting — i.e. every drag
  // step, live, which is exactly what's needed to keep the recolor in sync as the
  // rectangle grows/shrinks/moves, not just once at the end.
  let _areaSetHighlightPatched = false;
  function _ensureAreaSetHighlightPatched(mgr) {
    if (_areaSetHighlightPatched) return;
    const original = mgr.setHighlight.bind(mgr);
    mgr.setHighlight = function(x, y, w, h) {
      original(x, y, w, h);
      _syncAreaLiveHighlight(x, y, w, h);
    };
    _areaSetHighlightPatched = true;
  }

  function startAreaCapture() {
    if (!(window.Room && window.Room.id)) { _log('Not in a room.'); return; }
    if (!window.RoomEngine) { _log('Real room engine not detected yet — try again in a moment, or reload the page.'); return; }
    const mgr = window.RoomEngine.areaSelectionManager();
    if (mgr.areaSelectionState !== 0) return; // already active somehow — ignore, not a fresh start
    _clearAreaLiveHighlight(); // in case a previous capture somehow left recolor dangling
    _ensureAreaSetHighlightPatched(mgr);
    mgr.activate(function(x, y, w, h) {
      mgr.deactivate();
      _clearAreaLiveHighlight();
      _areaPicking = false;
      _renderCaptureTab();
      // clearHighlight() (called by deactivate() above, but also independently by other
      // native UI that shares this same manager, e.g. Wired's own area-select screens)
      // invokes the callback with all-zeros when there's no real selection to report —
      // not a capture to act on.
      if (!w || !h) return;
      captureRoom({ minX: x, maxX: x + w - 1, minY: y, maxY: y + h - 1 });
    });
    mgr.startSelecting();
    _areaPicking = true;
    _renderCaptureTab();
  }

  function cancelAreaCapture() {
    if (window.RoomEngine) window.RoomEngine.areaSelectionManager().deactivate();
    _clearAreaLiveHighlight();
    _areaPicking = false;
    _renderCaptureTab();
  }

  window.onPacket('RoomReady', function() {
    // Not gated on _areaPicking — that already flips false as soon as the drag finishes,
    // but the manager itself (and our recolor) can still be sitting there un-deactivated
    // during the deferred 1s confirmation window that follows.
    if (window.RoomEngine && window.RoomEngine.areaSelectionManager().areaSelectionState !== 0) {
      window.RoomEngine.areaSelectionManager().deactivate();
    }
    _clearAreaLiveHighlight();
    _areaPicking = false;
  });

  // ── Capture ──────────────────────────────────────────────────────────────
  // Floor plan chars encode a tile's builder height as base-36 (0-9, then a-z for
  // 10-35; 'x' is void). KamerConstructieTool's height field turns out to be RELATIVE
  // to that tile's own terrain height, not an absolute Z — every earlier real capture
  // used to reverse-engineer the byte layout happened to be on flat (all-'0') floor
  // plans, so relative-vs-absolute was indistinguishable until a raised tile exposed
  // it (items on a builder-height-2 tile rendered too high — height 2 terrain + the
  // captured *absolute* Z of ~2 got added together server-side instead of replacing it).
  function _terrainHeightAt(floorPlanStr, x, y) {
    const rows = String(floorPlanStr || '').split(/\r\n|\r|\n/);
    const row = rows[Math.round(y)];
    if (!row) return 0;
    const ch = row[Math.round(x)];
    if (!ch || ch === 'x' || ch === 'X') return 0;
    const v = parseInt(ch, 36);
    return isNaN(v) ? 0 : v;
  }

  // rect (optional): {minX,maxX,minY,maxY} tile bounds from Capture Area — restricts
  // floorItems to that box and drops wall items entirely (they carry no tile x/y to
  // filter by) and floorProps (a partial area has no business reshaping the whole room).
  function captureRoom(rect) {
    const roomId = window.Room && window.Room.id;
    if (!roomId) { _log('Not in a room.'); return; }
    // Restricted items (SS/LTD/BC/BC Shop/BT/Club Cadeau/Rare) are dropped at capture
    // time entirely — not just excluded from buying, never stored, never placed.
    const floorItems = Object.values(window.Room.floorItems || {})
      .filter(function(it) { return !_isRestrictedName(_typeName(it.typeId)); })
      .filter(function(it) { return !rect || (it.x >= rect.minX && it.x <= rect.maxX && it.y >= rect.minY && it.y <= rect.maxY); })
      .map(function(it) {
        // The visible state/color (what ":bs" controls) lives in stuff.state (a string
        // from the item's data block), NOT the separate "extra" int — that's a different
        // field that's ~always 1 for normal furni, which is why state grouping collapsed
        // everything into one bucket before this fix.
        const stateStr = it.stuff && it.stuff.state;
        const state = (stateStr !== undefined && stateStr !== null && stateStr !== '') ? parseInt(stateStr, 10) : 0;
        // Store height relative to this tile's own terrain — the server adds whatever
        // terrain height exists at the destination tile back on top when placing.
        const terrainZ = window.Room.floorPlan ? _terrainHeightAt(window.Room.floorPlan, it.x, it.y) : 0;
        // Colorable items (mood lights, color-changing rugs, etc.) report their color via
        // dataType 5 — a plain intArray [enabledFlag, r, g, b] — instead of the "state"
        // string format. SetRoomBackgroundColorData is how it's set: {itemId}{r}{g}{b}.
        const ia = it.stuff && it.stuff.intArray;
        const colorData = (Array.isArray(ia) && ia.length === 4) ? { r: ia[1], g: ia[2], b: ia[3] } : null;
        return { typeId: it.typeId, x: it.x, y: it.y, z: it.z - terrainZ, facing: it.facing, state: state, colorData: colorData };
      });
    // Wall items (Items packet) carry their own placement string already, e.g.
    // ":w=0,12 l=3,38 l" — no coordinates to reconstruct, just replay it verbatim later.
    const wallItems = rect ? [] : Object.values(window.Room.wallItems || {})
      .filter(function(it) { return !_isRestrictedName(_typeName(it.typeId)); })
      .map(function(it) {
        return { typeId: it.typeId, location: it.location };
      });
    if (!floorItems.length && !wallItems.length) { _log(rect ? 'No floor items found inside that area.' : 'No floor or wall items found in this room.'); return; }
    const roomName = (window.Room && window.Room.name) || ('Room ' + roomId);
    const ownerName = (window.Room && window.Room.ownerName) || null;

    // Floor plan + wall height/thickness aren't part of any item — they're captured
    // separately so "Apply Floor + Wall Height" can reshape a destination room to
    // physically match, which is the only thing that makes wall item offsets line up
    // right (see: same location string renders ~106 units off between differently-
    // modeled rooms). Door position isn't broadcast by the server at all, so this uses
    // wherever you're standing right now as a stand-in — same trick other room-clone
    // tools use, since the exact original door tile isn't recoverable passively.
    let floorProps = null;
    if (!rect && window.Room && window.Room.floorPlan) {
      // Prefer the real door tile captured at room-entry time; only fall back to the
      // capturer's current position if that wasn't available (e.g. extension loaded
      // after already being in the room).
      const me = Object.values(window.Room.users || {}).find(function(u) { return u.name === window._selfName; });
      const doorX = _roomEntryPos ? _roomEntryPos.x : (me ? me.x : 0);
      const doorY = _roomEntryPos ? _roomEntryPos.y : (me ? me.y : 0);
      const doorDir = _roomEntryPos ? _roomEntryPos.dir : (me ? me.bodyDir : 2);
      floorProps = {
        floorPlan: window.Room.floorPlan,
        wallHeight: window.Room.wallHeight,
        hideWalls: window.Room.hideWalls,
        wallThickness: window.Room.wallThickness,
        floorThickness: window.Room.floorThickness,
        doorX: doorX,
        doorY: doorY,
        doorDir: doorDir
      };
    }

    // areaOrigin (the rect's top-left tile) is the reference point Build offsets against
    // when the user picks a different anchor tile in the destination room.
    const newData = { floorItems: floorItems, wallItems: wallItems, floorProps: floorProps, name: rect ? roomName + ' (area)' : roomName, ownerName: ownerName, isArea: !!rect, areaOrigin: rect ? { x: rect.minX, y: rect.minY } : null };
    let blueprint;
    if (rect) {
      // Area captures never merge into an existing blueprint for this room — they're
      // a different, partial dataset, so each one is always a new entry.
      blueprint = Object.assign({ id: _nextId(), roomId: roomId, capturedAt: Date.now() }, newData);
      _blueprints.push(blueprint);
      _log('Captured area of room ' + roomId + ' — ' + floorItems.length + ' floor item(s).');
    } else {
      // Recapturing a room already on file only overwrites it if something actually
      // changed — same room, no changes, is a silent no-op instead of piling up a
      // duplicate or clobbering an untouched capture with an identical one.
      const existing = _blueprints.find(function(b) { return b.roomId === roomId; });
      if (existing) {
        const unchanged = JSON.stringify({ floorItems: existing.floorItems, wallItems: existing.wallItems, floorProps: existing.floorProps, name: existing.name, ownerName: existing.ownerName }) === JSON.stringify(newData);
        if (unchanged) { _log('Room ' + roomId + ' — no changes since last capture.'); return; }
        Object.assign(existing, newData, { capturedAt: Date.now(), _missing: null });
        blueprint = existing;
        _log('Updated capture for room ' + roomId + ' — ' + floorItems.length + ' floor item(s), ' + wallItems.length + ' wall item(s).');
      } else {
        blueprint = Object.assign({ id: _nextId(), roomId: roomId, capturedAt: Date.now() }, newData);
        _blueprints.push(blueprint);
        _log('Captured room ' + roomId + ' — ' + floorItems.length + ' floor item(s), ' + wallItems.length + ' wall item(s).');
      }
    }
    _saveBlueprints();
    _renderBlueprints();
    // Diagnostic: log the exact raw location string captured per wall item, so it can be
    // compared byte-for-byte against what gets replayed on Apply (and against a fresh
    // Items capture of the same item once placed) to pin down where a height drift enters.
    wallItems.forEach(function(it) {
      _log('Wall captured: ' + _typeName(it.typeId) + ' — "' + it.location + '"');
    });
    _renderRoomThumbnail(blueprint);
    // Diagnostic: confirm captured states actually vary before blaming the placement/
    // chat logic — if this shows one state for everything, the bug is in what got
    // captured, not in how :bs gets sent afterward.
    const stateCounts = new Map();
    floorItems.forEach(function(it) {
      stateCounts.set(it.state, (stateCounts.get(it.state) || 0) + 1);
    });
    const breakdown = Array.from(stateCounts.entries()).map(function(e) { return 'state ' + e[0] + ': ' + e[1]; }).join(', ');
    _log('Captured state breakdown — ' + breakdown);
    _selectBlueprint(blueprint.id);
  }

  // Placing an area blueprint needs to know where in the destination room to start —
  // reuses the same real-MoveAvatar-click trick as Capture Area for reading tile clicks
  // without the avatar actually walking there. Just two buttons, both always visible:
  // Preview (toggles into "click around the room to move a live ghost preview" mode —
  // same fake-ObjectAdd/ObjectRemove technique Area Mover's own Preview uses, becomes
  // "Clear Preview" while on) and Build (commits at wherever the preview last was;
  // disabled until a tile's been clicked at least once). The offset is stashed on the
  // blueprint itself (same run-scoped-annotation pattern as blueprint._missing) so the
  // isRetry continuation paths (buy-then-place, "Build Without") reuse it without
  // re-prompting.
  let _buildAnchorId = null; // blueprint id the current preview/offset belongs to
  let _buildPreviewOn = false; // toggle state — while true, tile clicks move the preview
  let _buildPreviewOffset = null; // {dx,dy} once a tile's been clicked — null before that
  const _buildPreviewGhosts = []; // {ghostId, ownerId}
  let _buildGhostIdCounter = 2100000000; // distinct range from area-mover.js's own counter

  function _clearBuildPreview() {
    if (!_buildPreviewGhosts.length) return;
    _buildPreviewGhosts.forEach(function(g) {
      window.sendPacket('IN', 2703 /* ObjectRemove, hardcoded id — same convention furni-hider.js/area-mover.js use */,
        '{s:"' + g.ghostId + '"}{i:' + g.ownerId + '}{b:200}{i:0}');
    });
    _buildPreviewGhosts.length = 0;
  }

  function _spawnBuildPreview(blueprint, offset) {
    const addId = _inId('ObjectAdd');
    if (addId === null) { _log('ObjectAdd not found in PKT — no preview available, Build still works.'); return 0; }
    _clearBuildPreview();
    let count = 0;
    blueprint.floorItems.forEach(function(item) {
      const x = item.x + offset.dx;
      const y = item.y + offset.dy;
      // Stored z is relative to the ORIGINAL tile's terrain (captureRoom's own doing) —
      // add back whatever terrain height exists at the destination tile in THIS room, the
      // same reconstruction a real placement needs, just done here for visual accuracy
      // instead of left to the server.
      const terrainZ = window.Room && window.Room.floorPlan ? _terrainHeightAt(window.Room.floorPlan, x, y) : 0;
      const z = (item.z || 0) + terrainZ;
      const ghostId = ++_buildGhostIdCounter;
      const stuffState = String(item.state != null ? item.state : 0);
      const expr = '{i:' + ghostId + '}' +
        '{i:' + item.typeId + '}' +
        '{i:' + x + '}' +
        '{i:' + y + '}' +
        '{i:' + (item.facing || 0) + '}' +
        '{s:"' + String(z) + '"}' +
        '{s:"1.0"}' +
        '{i:0}' +
        '{i:0}{s:"' + stuffState.replace(/"/g, '\\"') + '"}' +
        '{i:-1}{i:1}' +
        '{i:-1}{s:""}';
      if (window.sendPacket('IN', addId, expr)) { _buildPreviewGhosts.push({ ghostId: ghostId, ownerId: -1 }); count++; }
    });
    return count;
  }

  function toggleBuildPreview(id) {
    if (!(window.Room && window.Room.id)) { _log('Enter the target room first.'); return; }
    if (_buildAnchorId === id && _buildPreviewOn) {
      // Turning off just stops clicks from moving it — the position/ghosts-off state is
      // kept, not a full reset, so Build still works afterward.
      _setWalkBlocked(false);
      _buildPreviewOn = false;
      _clearBuildPreview();
      _renderBuildTab();
      return;
    }
    // Switching to a different blueprint's preview (or starting fresh) leaves the
    // previous blueprint's offset meaningless — drop it so its ghosts (if any were still
    // showing) don't linger orphaned, unreachable by that blueprint's own toggle anymore.
    if (_buildAnchorId !== id) {
      _clearBuildPreview();
      _buildPreviewOffset = null;
    }
    _setWalkBlocked(true);
    _buildAnchorId = id;
    _buildPreviewOn = true;
    _log('Click a tile in this room to preview the area there.');
    if (_buildPreviewOffset) {
      // Resuming the SAME blueprint after a prior toggle-off — show it again at the last
      // position right away instead of waiting for a fresh click.
      const blueprint = _blueprints.find(function(b) { return b.id === id; });
      if (blueprint) _spawnBuildPreview(blueprint, _buildPreviewOffset);
    }
    _renderBuildTab();
  }

  function confirmBuildAnchor(id) {
    if (_buildAnchorId !== id || !_buildPreviewOffset) return;
    _setWalkBlocked(false);
    _buildAnchorId = null;
    _buildPreviewOn = false;
    _buildPreviewOffset = null;
    _clearBuildPreview();
    _renderBuildTab();
    applyBlueprint(id);
  }

  window.onPacket('RoomReady', function() { _setWalkBlocked(false); _buildAnchorId = null; _buildPreviewOn = false; _buildPreviewOffset = null; _clearBuildPreview(); });
  window.onPacket('MoveAvatar', function(p) {
    if (_buildAnchorId === null || !_buildPreviewOn || p.direction !== 'OUT' || !p.parsed) return;
    const blueprint = _blueprints.find(function(b) { return b.id === _buildAnchorId; });
    if (!blueprint || !blueprint.areaOrigin) { _setWalkBlocked(false); _buildAnchorId = null; _buildPreviewOn = false; _clearBuildPreview(); return; }
    _buildPreviewOffset = { dx: p.parsed.x - blueprint.areaOrigin.x, dy: p.parsed.y - blueprint.areaOrigin.y };
    blueprint._buildOffset = _buildPreviewOffset;
    const count = _spawnBuildPreview(blueprint, _buildPreviewOffset);
    _log('Preview: ' + count + ' item(s) at (' + p.parsed.x + ',' + p.parsed.y + ') — click elsewhere to move it, Clear Preview to stop, or Build to place.');
    _renderBuildTab();
  });

  // ── Apply ────────────────────────────────────────────────────────────────
  // Progress bar + ETA while a blueprint is being placed. The full placement timeline
  // is already known synchronously right after scheduling (every item's setTimeout
  // delay is computed up front), so "total time" is exact, not a guess.
  let _applyProgress = null; // { id, done, total, startedAt, totalMs, timer }

  function _startApplyProgress(id, total, totalMs) {
    if (_applyProgress && _applyProgress.timer) clearInterval(_applyProgress.timer);
    _applyProgress = { id: id, done: 0, total: total, startedAt: Date.now(), totalMs: totalMs, timer: 0, aborted: false };
    _applyProgress.timer = setInterval(_renderBlueprints, 250);
    _renderBlueprints();
  }
  function _tickApplyProgress(id) {
    if (!_applyProgress || _applyProgress.id !== id) return;
    _applyProgress.done += 1;
  }
  function _finishApplyProgress(id) {
    if (!_applyProgress || _applyProgress.id !== id) return;
    clearInterval(_applyProgress.timer);
    _applyProgress = null;
    _renderBlueprints();
  }

  // Same shape as _applyProgress, for the purchase phase — shown in the Build tab while
  // Buy Missing Items is sending purchase packets, before the build progress bar takes over.
  let _buyProgress = null; // { id, done, total, startedAt, totalMs, timer }

  function _startBuyProgress(id, total, totalMs) {
    if (_buyProgress && _buyProgress.timer) clearInterval(_buyProgress.timer);
    _buyProgress = { id: id, done: 0, total: total, startedAt: Date.now(), totalMs: totalMs, timer: 0, aborted: false };
    _buyProgress.timer = setInterval(_renderBlueprints, 250);
    _renderBlueprints();
  }

  // Marks both the current build run and any in-flight buy run for this blueprint as
  // aborted — checked at each step so in-progress loops/scheduled sends stop cleanly
  // instead of being forcibly killed mid-packet.
  // Buying schedules a whole batch of setTimeouts up front (one per purchase packet,
  // 500ms apart, plus a trailing continuation) — _buyProgress.aborted alone only stops
  // NEW sends, but the bar/timer would linger until the last of those already-scheduled
  // callbacks finally fires. _buyAbortedIds survives even after the bar is torn down
  // immediately, so every still-pending callback (which can't see _buyProgress anymore
  // once it's null) can still tell it was aborted and skip sending.
  const _buyAbortedIds = new Set();

  function abortBuild(id) {
    if (_applyProgress && _applyProgress.id === id) _applyProgress.aborted = true;
    if (_buyProgress && _buyProgress.id === id) {
      _buyAbortedIds.add(id);
      _finishBuyProgress(id);
    }
    _log('Aborted for blueprint #' + id + '.');
  }
  function _tickBuyProgress(id) {
    if (!_buyProgress || _buyProgress.id !== id) return;
    _buyProgress.done += 1;
  }
  function _finishBuyProgress(id) {
    if (!_buyProgress || _buyProgress.id !== id) return;
    clearInterval(_buyProgress.timer);
    _buyProgress = null;
    _renderBlueprints();
  }

  function _buildInventoryPools() {
    const pool = new Map();
    Object.values((window.Inventory && window.Inventory.items) || {}).forEach(function(it) {
      if (it.type !== 'S') return;
      if (!pool.has(it.typeId)) pool.set(it.typeId, []);
      pool.get(it.typeId).push(it);
    });
    return pool;
  }

  // Same idea as _buildInventoryPools but for wall items — inventory type is anything
  // other than 'S' (floor), matching how FurniData already picks floor vs. wall.
  function _buildWallInventoryPools() {
    const pool = new Map();
    Object.values((window.Inventory && window.Inventory.items) || {}).forEach(function(it) {
      if (it.type === 'S') return;
      if (!pool.has(it.typeId)) pool.set(it.typeId, []);
      pool.get(it.typeId).push(it);
    });
    return pool;
  }

  // Fresh missing-check against current inventory, no placing — used right before
  // buying so a stale blueprint._missing (e.g. items placed manually since) can't
  // cause items to be bought that are already owned.
  function _computeMissing(blueprint, includeWalls) {
    const pools = _buildInventoryPools();
    const missing = new Map();
    (blueprint.floorItems || []).forEach(function(desired) {
      const pool = pools.get(desired.typeId);
      const invItem = pool && pool.length ? pool.shift() : null;
      if (!invItem) missing.set(desired.typeId, (missing.get(desired.typeId) || 0) + 1);
    });
    if (includeWalls) {
      const wallPools = _buildWallInventoryPools();
      (blueprint.wallItems || []).forEach(function(desired) {
        const pool = wallPools.get(desired.typeId);
        const invItem = pool && pool.length ? pool.shift() : null;
        if (!invItem) missing.set(desired.typeId, (missing.get(desired.typeId) || 0) + 1);
      });
    }
    return Array.from(missing.entries())
      .filter(function(e) { return !_isRestrictedName(_typeName(e[0])); })
      .map(function(e) { return { typeId: e[0], count: e[1] }; });
  }

  // The GEarth-expression mini-language's {s:"..."} tokenizer can't cross a real
  // newline/CR (its regex uses "." without the dotAll flag), so any real line breaks in
  // the floor plan string have to travel as the literal 2-char "\r" escape sequence
  // instead — ws.js's fromExpression() unescapes that back into a real CR byte.
  function _escapeExprString(s) {
    return String(s || '')
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\r\n|\r|\n/g, '\\r');
  }

  // Reshapes the CURRENT room's floor plan + door position + wall/floor thickness +
  // wall height to match the captured blueprint — the only thing that makes wall item
  // location strings render at the right height in a differently-modeled room (see
  // room-clone wall-height investigation: identical ":w=.. l=.." strings landed ~106
  // units apart between two rooms built from different floor-plan templates). Requires
  // owning the destination room. Deliberately a separate, explicit action — not bundled
  // into plain Apply — since it can resize/reshape whatever room it's sent to.
  // Same fresh-inventory-first pattern as applyBlueprint()/buyMissing() — Build Floor +
  // Wall can be the very first thing clicked, so it can't assume window.Inventory.loaded
  // is already true.
  let _pendingFloorId = null, _pendingFloorTimer = null;
  window.onPacket('FurniList', function(p) {
    if (_pendingFloorId === null || !p.parsed) return;
    if ((p.parsed.pageIndex + 1) < p.parsed.totalPages) return;
    const id = _pendingFloorId;
    _pendingFloorId = null;
    if (_pendingFloorTimer) { clearTimeout(_pendingFloorTimer); _pendingFloorTimer = null; }
    _applyFloorPropertiesNow(id);
  });

  function applyFloorProperties(id) {
    const blueprint = _blueprints.find(function(b) { return b.id === id; });
    if (!blueprint) return;
    if (!blueprint.floorProps || !blueprint.floorProps.floorPlan) { _log('No floor plan / wall height captured for this blueprint.'); return; }
    if (!window.Room || !window.Room.id) { _log('Enter the target room first.'); return; }

    const reqId = _outId('RequestFurniInventory');
    if (reqId === null) { _log('RequestFurniInventory not found in PKT — using current inventory instead.'); _applyFloorPropertiesNow(id); return; }

    _pendingFloorId = id;
    window.sendPacket('OUT', reqId, '');
    _log('Requesting fresh inventory before checking what\'s missing...');
    if (_pendingFloorTimer) clearTimeout(_pendingFloorTimer);
    _pendingFloorTimer = setTimeout(function() {
      if (_pendingFloorId !== id) return;
      _pendingFloorId = null;
      _log('Inventory refresh timed out — using what we have.');
      _applyFloorPropertiesNow(id);
    }, 6000);
  }

  function _applyFloorPropertiesNow(id) {
    const blueprint = _blueprints.find(function(b) { return b.id === id; });
    if (!blueprint) return;
    if (!window.Inventory || !window.Inventory.loaded) { _log('Inventory not loaded yet — open your Inventory panel in-game first, then try again.'); return; }

    // Resolve missing items BEFORE touching the floor at all — reshaping the room and
    // then finding out you're missing items left it half-changed with no way back.
    const stillMissing = _computeMissing(blueprint, true);
    if (stillMissing.length) {
      blueprint._missing = stillMissing;
      _renderBlueprints();
      const totalMissingItems = stillMissing.reduce(function(s, m) { return s + m.count; }, 0);
      _showMissingWarning(totalMissingItems,
        function() { buyMissing(id, false, true, function() { _sendFloorPropertiesAndBuild(id); }); },
        function() { _sendFloorPropertiesAndBuild(id); });
      return;
    }
    _sendFloorPropertiesAndBuild(id);
  }

  function _sendFloorPropertiesAndBuild(id) {
    const blueprint = _blueprints.find(function(b) { return b.id === id; });
    if (!blueprint || !blueprint.floorProps) return;
    const ufpId = _outId('UpdateFloorProperties');
    if (ufpId === null) { _log('UpdateFloorProperties not found in PKT.'); return; }

    const fp = blueprint.floorProps;
    // Diagnostic: prove which blueprint's floor data is actually going out — room id +
    // row count — before trusting whether this is a stale-capture bug or a wrong-card click.
    _log('Floor data for "' + blueprint.name + '" (captured room #' + blueprint.roomId + '): ' + String(fp.floorPlan || '').split(/\r\n|\r|\n/).length + ' row(s).');
    const doorX = fp.doorX != null ? fp.doorX : 0;
    const doorY = fp.doorY != null ? fp.doorY : 0;
    const doorDir = fp.doorDir != null ? fp.doorDir : 2;
    const wallThickness = fp.wallThickness != null ? fp.wallThickness : 0;
    const floorThickness = fp.floorThickness != null ? fp.floorThickness : 0;
    const wallHeight = fp.wallHeight != null ? fp.wallHeight : -1;

    window.sendPacket('OUT', ufpId,
      '{s:"' + _escapeExprString(fp.floorPlan) + '"}' +
      '{i:' + doorX + '}{i:' + doorY + '}{i:' + doorDir + '}' +
      '{i:' + wallThickness + '}{i:' + floorThickness + '}{i:' + wallHeight + '}');

    _log('Sent floor plan + wall height for "' + blueprint.name + '" — reshapes this room to match (only works if you own it). Placing floor + wall items shortly...');

    // Diagnostic: the server rebroadcasts FloorHeightMap after a successful save — check
    // a moment later whether window.Room.floorPlan (now whatever the server confirmed)
    // actually matches what we sent, so a silent server-side rejection shows up in the
    // log instead of just looking like "nothing happened".
    const sentPlan = fp.floorPlan;
    setTimeout(function() {
      const got = window.Room && window.Room.floorPlan;
      if (got === sentPlan) _log('Floor plan confirmed by server — matches what was sent.');
      else _log('Floor plan NOT confirmed — server still reports a different plan than what was sent (rejected or ignored the change).');
    }, 1000);

    // isRetry=true: the missing-item decision already happened in applyFloorProperties,
    // so this skips straight to placement instead of showing the warning a second time.
    setTimeout(function() {
      applyBlueprint(id, true, true);
    }, 1500);
  }

  function visitRoom(id) {
    const blueprint = _blueprints.find(function(b) { return b.id === id; });
    if (!blueprint) return;
    const oid = _outId('OpenFlatConnection');
    if (oid === null) { _log('OpenFlatConnection not found in PKT.'); return; }
    window.sendPacket('OUT', oid, '{i:' + blueprint.roomId + '}{b:false}{b:false}');
    _log('Visiting room #' + blueprint.roomId + ' ("' + blueprint.name + '")...');
  }

  function applyBlueprint(id, isRetry, includeWalls) {
    const blueprint = _blueprints.find(function(b) { return b.id === id; });
    if (!blueprint) return;
    if (!window.Room || !window.Room.id) { _log('Enter the target room first.'); return; }

    const reqId = _outId('RequestFurniInventory');
    if (reqId === null) { _log('RequestFurniInventory not found in PKT — using current inventory instead.'); _applyBlueprintNow(id, isRetry, includeWalls); return; }

    _pendingApplyId = id;
    _pendingApplyRetry = !!isRetry;
    _pendingApplyIncludeWalls = !!includeWalls;
    window.sendPacket('OUT', reqId, '');
    _log('Requesting fresh inventory before applying...');
    if (_pendingApplyTimer) clearTimeout(_pendingApplyTimer);
    _pendingApplyTimer = setTimeout(function() {
      if (_pendingApplyId !== id) return;
      _pendingApplyId = null;
      _log('Inventory refresh timed out — applying with what we have.');
      _applyBlueprintNow(id, isRetry, includeWalls);
    }, 6000);
  }

  function _applyBlueprintNow(id, isRetry, includeWalls) {
    const blueprint = _blueprints.find(function(b) { return b.id === id; });
    if (!blueprint) return;
    if (!window.Room || !window.Room.id) { _log('Enter the target room first.'); return; }
    if (!window.Inventory || !window.Inventory.loaded) { _log('Inventory not loaded yet — open your Inventory panel in-game first, then try again.'); return; }

    // Never buy anything without asking — only on the initial Build (not on the
    // automatic recheck buyMissing triggers afterward). Warn and let the user
    // explicitly choose to buy; if they decline, stop, no purchase and no placement.
    if (!isRetry) {
      const stillMissing = _computeMissing(blueprint, includeWalls);
      if (stillMissing.length) {
        blueprint._missing = stillMissing;
        _renderBlueprints();
        const totalMissingItems = stillMissing.reduce(function(s, m) { return s + m.count; }, 0);
        _showMissingWarning(totalMissingItems,
          function() { buyMissing(id, true, includeWalls); },
          function() { _applyBlueprintNow(id, true, includeWalls); });
        return;
      }
    }

    const pid = _outId('PlaceObject');
    if (pid === null) { _log('PlaceObject not found in PKT.'); return; }
    const kctId = _outId('KamerConstructieTool');
    if (kctId === null) _log('KamerConstructieTool not found in PKT — heights may not be set correctly.');
    const colorId = _outId('SetRoomBackgroundColorData');

    const pools = _buildInventoryPools();
    const missing = new Map();
    let placed = 0;

    // No auto-stack assumption — every item gets its own explicit height and state
    // check, full stop. Sort so items sharing the same (height, state) end up next to
    // each other, purely to minimize how often the KamerConstructieTool packet actually
    // needs to change — not to skip sending it for anyone.
    const orderedFloorItems = blueprint.floorItems.slice().sort(function(a, b) {
      if (a.z !== b.z) return a.z - b.z;
      return (a.state || 0) - (b.state || 0);
    });
    if (colorId === null && orderedFloorItems.some(function(it) { return it.colorData; })) {
      _log('SetRoomBackgroundColorData not found in PKT — captured colors will not be set.');
    }

    // Height and state both go through the real KamerConstructieTool packet instead of
    // the ":bh"/":bs" chat commands — confirmed byte-for-byte from 14 real captures
    // (heights 1/2/5/10/50/-5/-10 + on/off, states 1/5/10 + on/off). Layout (47 bytes):
    //   byte 0: height-active flag (1/0), bytes 1-4: height*100 as a SIGNED int32 BE
    //   (negative heights need real two's-complement sign extension across all 4 bytes,
    //   not 2 padding zero bytes — confirmed via -5/-10 captures, e.g. -500 = 0xFFFFFE0C)
    //   bytes 5-9: unused property slot (always 0 in every capture)
    //   byte 10: state-active flag (1/0), bytes 11-13: reserved, byte 14: state (plain byte)
    //   bytes 15-44: unused, bytes 45-46: trailing bools (always false)
    // Either property can be left inactive (flag 0) to leave it untouched. It's a normal
    // packet, not chat, so there's no flood mute and no need to wait for it to "land"
    // before placing — it can fire right alongside PlaceObject.
    function _sendConstructionTool(height, state) {
      const heightActive = height !== null ? 1 : 0;
      const heightScaled = height !== null ? Math.round(height * 100) : 0;
      const stateActive = state !== null ? 1 : 0;
      const stateVal = state !== null ? state : 0;
      window.sendPacket('OUT', kctId,
        '{b:' + heightActive + '}{i:' + heightScaled + '}' +
        '{i:0}{b:0}' +
        '{b:' + stateActive + '}{b:0}{b:0}{b:0}{b:' + stateVal + '}' +
        '{i:0}{i:0}{i:0}{i:0}{i:0}{i:0}{i:0}{b:0}{b:0}' +
        '{b:false}{b:false}');
    }

    // Dry-run (no sending, no waiting) over the exact same walk, purely to know up front
    // what's missing and roughly how long the real run will take, so the log/progress
    // bar can appear immediately like before. Signature-based dedup (z|state), same idea
    // as the reference standalone script's editorSignature check.
    let dryLastSignature = '', estimatedMs = 0;
    orderedFloorItems.forEach(function(desired) {
      const state = desired.state || 0;
      const signature = desired.z + '|' + state;
      if (kctId !== null && signature !== dryLastSignature) {
        dryLastSignature = signature;
        estimatedMs += 210;
      }

      const pool = pools.get(desired.typeId);
      const invItem = pool && pool.length ? pool.shift() : null;
      if (!invItem) { missing.set(desired.typeId, (missing.get(desired.typeId) || 0) + 1); return; }
      placed += 1;
      estimatedMs += 95;
    });

    // Wall items go last, after every floor item — no KamerConstructieTool involved
    // (no height/state concept for them), just replay the captured placement string
    // (":w=X,Y l=OX,OY orientation") verbatim against a fresh inventory placementId.
    // Only placed when includeWalls is set — without matching wall height/floor plan
    // first (via "Apply Floor + Wall Height"), the exact same string renders at the
    // wrong physical height in a differently-modeled room, so plain Apply skips them.
    const wallItems = includeWalls ? (blueprint.wallItems || []) : [];
    if (includeWalls) {
      const wallPools = _buildWallInventoryPools();
      wallItems.forEach(function(desired) {
        const pool = wallPools.get(desired.typeId);
        const invItem = pool && pool.length ? pool.shift() : null;
        if (!invItem) { missing.set(desired.typeId, (missing.get(desired.typeId) || 0) + 1); return; }
        placed += 1;
        estimatedMs += 95;
      });
    }

    // Collectible tags (SS/LTD/BC Shop/Club Cadeau/Rare) are excluded from the missing
    // list entirely — they're one-off items, not something to flag as buyable-missing.
    const shown = Array.from(missing.entries()).filter(function(e) { return !_isRestrictedName(_typeName(e[0])); });
    _log('Applying "' + blueprint.name + '": placing ' + placed + ' item(s), ' + shown.length + ' type(s) missing.');
    if (shown.length) {
      blueprint._missing = shown.map(function(e) { return { typeId: e[0], count: e[1] }; });
      _renderBlueprints();
      shown.forEach(function(e) {
        _log('Missing: ' + _typeName(e[0]) + ' x' + e[1]);
      });
    } else {
      blueprint._missing = null;
      _renderBlueprints();
    }

    if (placed === 0) return;
    _startApplyProgress(id, placed, estimatedMs);

    // Real placement — genuinely sequential with await, not a burst of pre-computed
    // setTimeout offsets. Signature-based dedup (z|state), mirroring the reference
    // standalone script's editorSignature check — only resend KamerConstructieTool when
    // the combined height+state actually changes from the previous item. Timing also
    // matches that script's defaults (state/edit delay 210ms, place delay 95ms).
    const realPools = _buildInventoryPools();
    // Area blueprints get placed relative to a user-picked anchor tile instead of their
    // original captured coordinates (see toggleBuildPreview) — full-room blueprints
    // have no offset and place at their exact original x/y as before.
    const offX = blueprint._buildOffset ? blueprint._buildOffset.dx : 0;
    const offY = blueprint._buildOffset ? blueprint._buildOffset.dy : 0;
    (async function() {
      // Cold-start race: the very first height/state packets fired right after the
      // RequestFurniInventory/FurniList wait were landing wrong while later ones in the
      // same run were fine — a short warm-up here gives the connection/room a moment to
      // settle before the real placement begins.
      await _sleep(1000);

      let lastSignature = '';
      for (let ii = 0; ii < orderedFloorItems.length; ii++) {
        if (_applyProgress && _applyProgress.id === id && _applyProgress.aborted) break;
        const desired = orderedFloorItems[ii];
        const state = desired.state || 0;
        const signature = desired.z + '|' + state;

        if (kctId !== null && signature !== lastSignature) {
          _sendConstructionTool(desired.z, state);
          lastSignature = signature;
          await _sleep(210);
        }

        const pool = realPools.get(desired.typeId);
        const invItem = pool && pool.length ? pool.shift() : null;
        if (!invItem) continue; // already accounted for in the dry-run missing report
        const placeX = Math.round(desired.x + offX), placeY = Math.round(desired.y + offY);
        // Snapshot BEFORE sending so the wait below can tell "this placement's new item"
        // apart from anything already in the room with the same typeId/tile.
        const knownIds = desired.colorData && colorId !== null ? new Set(Object.keys(window.Room.floorItems || {}).map(Number)) : null;
        window.sendPacket('OUT', pid, '{s:"' + invItem.placementId + ' ' + placeX + ' ' + placeY + ' ' + Math.round(desired.facing || 0) + '"}');
        _tickApplyProgress(id);
        await _sleep(95);

        // Colorable items (SetRoomBackgroundColorData) target the item's server-assigned
        // ROOM instance id, which PlaceObject never returns directly — has to wait for the
        // server's own 'Objects' broadcast of the newly placed item to learn it.
        if (knownIds) {
          const newId = await _waitForNewFloorItemId(desired.typeId, placeX, placeY, knownIds, 1500);
          if (newId !== null) {
            window.sendPacket('OUT', colorId, '{i:' + newId + '}{i:' + desired.colorData.r + '}{i:' + desired.colorData.g + '}{i:' + desired.colorData.b + '}');
          } else {
            _log('Placed ' + _typeName(desired.typeId) + ' but could not confirm its room id in time — color not set.');
          }
        }
      }

      const realWallPools = _buildWallInventoryPools();
      for (let jj = 0; jj < wallItems.length; jj++) {
        if (_applyProgress && _applyProgress.id === id && _applyProgress.aborted) break;
        const desired = wallItems[jj];
        const pool = realWallPools.get(desired.typeId);
        const invItem = pool && pool.length ? pool.shift() : null;
        if (!invItem) continue; // already accounted for in the dry-run missing report
        const wallStr = invItem.placementId + ' ' + desired.location;
        window.sendPacket('OUT', pid, '{s:"' + wallStr + '"}');
        _log('Wall placed: ' + _typeName(desired.typeId) + ' — "' + wallStr + '"');
        _tickApplyProgress(id);
        await _sleep(95);
      }

      // Turn height/state back off once everything's placed, so the tool doesn't stay
      // armed and affect whatever gets placed next (manually or by a later apply run).
      if (kctId !== null) {
        _sendConstructionTool(null, null);
        await _sleep(210);
        _sendConstructionTool(null, null);
        await _sleep(210);
      }
      _finishApplyProgress(id);
    })();
  }

  // Polls window.Room.floorItems (kept live by parsers.js's 'Objects' handler) for the
  // newly placed item — the one at this exact tile/typeId that wasn't in knownIds before
  // PlaceObject was sent. Returns its server-assigned room id, or null on timeout.
  function _waitForNewFloorItemId(typeId, x, y, knownIds, timeoutMs) {
    return new Promise(function(resolve) {
      const deadline = Date.now() + timeoutMs;
      (function poll() {
        const found = Object.values(window.Room.floorItems || {}).find(function(fi) {
          return fi.typeId === typeId && Math.round(fi.x) === x && Math.round(fi.y) === y && !knownIds.has(fi.id);
        });
        if (found) { resolve(found.id); return; }
        if (Date.now() >= deadline) { resolve(null); return; }
        setTimeout(poll, 60);
      })();
    });
  }

  function _sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }

  // ── Buy missing ──────────────────────────────────────────────────────────
  // Same fresh-inventory-first pattern as applyBlueprint() — Buy Missing Items is often
  // the very first thing clicked (straight from the detail view, before ever hitting
  // Apply), so it can't assume window.Inventory.loaded is already true.
  let _pendingBuyId = null, _pendingBuyTimer = null, _pendingBuyThenApply = false, _pendingBuyIncludeWalls = false, _pendingBuyAfterBuy = null;
  window.onPacket('FurniList', function(p) {
    if (_pendingBuyId === null || !p.parsed) return;
    if ((p.parsed.pageIndex + 1) < p.parsed.totalPages) return;
    const id = _pendingBuyId, thenApply = _pendingBuyThenApply, includeWalls = _pendingBuyIncludeWalls, afterBuy = _pendingBuyAfterBuy;
    _pendingBuyId = null;
    if (_pendingBuyTimer) { clearTimeout(_pendingBuyTimer); _pendingBuyTimer = null; }
    _buyMissingNow(id, thenApply, includeWalls, afterBuy);
  });

  // thenApply is only set true when Apply itself found missing items and needs to buy
  // them first before continuing to place — the "Buy Missing Items" button in the UI
  // always calls this with thenApply left false, since buying is all that was asked for.
  // afterBuy overrides both: used by Build Floor + Wall's warning so the floor doesn't
  // get reshaped until the purchase has actually landed.
  function buyMissing(id, thenApply, includeWalls, afterBuy) {
    if (!_blueprints.find(function(b) { return b.id === id; })) return;
    if (!_catalogItems.length) { _log('Scan the catalog first — no offers known yet.'); return; }

    const reqId = _outId('RequestFurniInventory');
    if (reqId === null) { _log('RequestFurniInventory not found in PKT — using current inventory instead.'); _buyMissingNow(id, thenApply, includeWalls, afterBuy); return; }

    _pendingBuyId = id;
    _pendingBuyThenApply = !!thenApply;
    _pendingBuyIncludeWalls = !!includeWalls;
    _pendingBuyAfterBuy = afterBuy || null;
    window.sendPacket('OUT', reqId, '');
    _log('Requesting fresh inventory before checking what\'s missing...');
    if (_pendingBuyTimer) clearTimeout(_pendingBuyTimer);
    _pendingBuyTimer = setTimeout(function() {
      if (_pendingBuyId !== id) return;
      _pendingBuyId = null;
      _log('Inventory refresh timed out — using what we have.');
      _buyMissingNow(id, thenApply, includeWalls, afterBuy);
    }, 6000);
  }

  function _buyMissingNow(id, thenApply, includeWalls, afterBuy) {
    const blueprint = _blueprints.find(function(b) { return b.id === id; });
    if (!blueprint) return;
    if (!window.Inventory || !window.Inventory.loaded) { _log('Inventory still not loaded — open your Inventory panel in-game once, then try again.'); return; }

    // Recheck inventory right now instead of trusting the last Apply's snapshot —
    // items may have been placed/bought since, and buying them again would waste credits.
    blueprint._missing = _computeMissing(blueprint, includeWalls);
    _renderBlueprints();
    if (!blueprint._missing.length) { _log('Nothing missing to buy — inventory already covers this blueprint.'); return; }
    _buyAbortedIds.delete(id); // fresh run — clear any abort marker left by a previous one

    const pid = _outId('PurchaseFromCatalog');
    if (pid === null) { _log('PurchaseFromCatalog not found in PKT.'); return; }

    const MAX_PER_PURCHASE = 100;
    // Page 14 (currency/wisselkoers) offers reject the {u:count} bulk form — must
    // be bought one at a time with the plain {b:false}{b:true} packet instead.
    const NO_BULK_PAGE_IDS = [14];

    // Pre-count total purchase packets that will actually be sent, so the progress bar
    // knows its total up front instead of guessing — same idea as the build dry-run.
    let totalSteps = 0;
    blueprint._missing.forEach(function(m) {
      const offer = _findOfferForTypeId(m.typeId);
      if (!offer || _isVipLockedOffer(offer)) return;
      totalSteps += (NO_BULK_PAGE_IDS.indexOf(offer.pageId) !== -1) ? m.count : Math.ceil(m.count / MAX_PER_PURCHASE);
    });
    if (totalSteps) _startBuyProgress(id, totalSteps, totalSteps * 500);

    let unresolved = 0, delay = 0;
    blueprint._missing.forEach(function(m) {
      const offer = _findOfferForTypeId(m.typeId);
      if (!offer) { unresolved += 1; _log('No catalog offer found for ' + _typeName(m.typeId) + '.'); return; }
      if (_isVipLockedOffer(offer)) { _log('Skipped ' + _typeName(m.typeId) + ' — Leet VIP item, account is not VIP.'); return; }
      if (NO_BULK_PAGE_IDS.indexOf(offer.pageId) !== -1) {
        for (let n = 0; n < m.count; n++) {
          setTimeout(function() {
            if (_buyAbortedIds.has(id)) return;
            window.sendPacket('OUT', pid, '{i:' + offer.pageId + '}{i:' + offer.offerId + '}{i:0}{b:false}{b:true}');
            _log('Purchase sent for x1 of ' + _typeName(m.typeId) + ' (offer #' + offer.offerId + ') — waiting for confirmation...');
            _tickBuyProgress(id);
          }, delay);
          delay += 500;
        }
        return;
      }
      let remaining = m.count;
      while (remaining > 0) {
        const batch = Math.min(remaining, MAX_PER_PURCHASE);
        remaining -= batch;
        setTimeout(function() {
          if (_buyAbortedIds.has(id)) return;
          // {i:pageId}{i:offerId}{i:0}{u:count} — count buys that many in one purchase, capped at 100 per packet.
          window.sendPacket('OUT', pid, '{i:' + offer.pageId + '}{i:' + offer.offerId + '}{i:0}{u:' + batch + '}');
          _log('Purchase sent for x' + batch + ' of ' + _typeName(m.typeId) + ' (offer #' + offer.offerId + ') — waiting for confirmation...');
          _tickBuyProgress(id);
        }, delay);
        delay += 500;
      }
    });

    if (unresolved) _log(unresolved + ' type(s) have no known catalog offer — scan more of the catalog.');
    setTimeout(function() {
      // Aborted case already tore down the progress bar immediately in abortBuild() —
      // this is just the trailing scheduled callback, so only skip the continuation.
      if (_buyAbortedIds.has(id)) { _buyAbortedIds.delete(id); return; }
      _finishBuyProgress(id);
      if (afterBuy) {
        _log('Purchases landed — continuing...');
        afterBuy();
      } else if (thenApply) {
        _log('Purchases landed — placing items now...');
        applyBlueprint(id, true, includeWalls);
      } else {
        _log('Purchases sent — press Apply when you want to place items.');
      }
    }, delay + 1500);
  }

  function deleteBlueprint(id) {
    _blueprints = _blueprints.filter(function(b) { return b.id !== id; });
    _saveBlueprints();
    _thumbCache.delete(String(id));
    _deleteThumbFromDb(String(id));
    if (_selectedId === id) _selectedId = null;
    _renderBlueprints();
  }

  // ── UI ───────────────────────────────────────────────────────────────────
  let panel = null, listEl = null, catalogStatusEl = null;
  let _libFilter = 'all', _libSearch = '';

  function injectStyle() {
    const style = document.createElement('style');
    style.textContent = [
      '#__rclone{position:fixed;top:16px;right:16px;width:560px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__rclone *{box-sizing:border-box}',
      '.__rc_card{display:flex;flex-direction:column;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb}',
      '.__rc_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__rc_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}',
      '.__rc_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__rc_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__rc_close:hover{color:#eceefb}',
      '#__rc_body{max-height:520px;overflow-y:auto;display:flex;flex-direction:column}',
      '.__rc_section_label{font:700 9px/1 monospace;letter-spacing:1px;color:#5c5e6b;text-transform:uppercase}',
      '.__rc_muted{color:#82849a;font-size:10px;flex:1}',
      '.__rc_btn{border:none;border-radius:8px;font-size:11px;font-weight:600;padding:7px 10px;cursor:pointer}',
      '.__rc_btn_primary{background:#A6B0FF;color:#0A0B10}',
      '.__rc_btn_primary:hover{filter:brightness(1.08)}',
      '.__rc_btn_secondary{background:#1c1e2a;color:#eceefb;border:1px solid #23252f}',
      '.__rc_btn_secondary:hover{background:rgba(255,255,255,0.06)}',
      '.__rc_btn_danger{background:rgba(231,76,60,0.14);color:#e74c3c;border:1px solid rgba(231,76,60,0.3)}',
      '.__rc_btn_danger:hover{background:rgba(231,76,60,0.22)}',
      '.__rc_list{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:16px 18px 20px}',
      '.__rc_empty{padding:24px 0;text-align:center;font-size:11.5px;color:#5c5e6b;grid-column:1/-1}',
      '.__rc_progress_bar{height:6px;border-radius:3px;background:#0A0B10;overflow:hidden}',
      '.__rc_progress_fill{height:100%;background:#A6B0FF;transition:width .2s linear}',
      '.__rc_progress_text{font-size:9px;color:#82849a}',
      '.__rc_lib_hdr{padding:16px 18px 12px;border-bottom:1px solid #23252f;display:flex;flex-direction:column;gap:10px}',
      '.__rc_lib_title_row{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}',
      '.__rc_lib_title_row h3{margin:0;font-size:16px;font-weight:700;color:#eceefb}',
      '.__rc_lib_count{color:#82849a;font-size:11px;margin-left:8px}',
      '.__rc_search{width:100%;background:#1c1e2a;border:1px solid #23252f;border-radius:8px;padding:7px 11px;font-size:11px;color:#eceefb}',
      '.__rc_search::placeholder{color:#5c5e6b}',
      '.__rc_chip_row{display:flex;gap:6px;flex-wrap:wrap}',
      '.__rc_chip{font:700 9.5px monospace;letter-spacing:.3px;padding:5px 10px;border-radius:999px;border:1px solid #23252f;background:#1c1e2a;color:#82849a;cursor:pointer}',
      '.__rc_chip.active{background:rgba(108,124,255,0.14);border-color:#6C7CFF;color:#A6B0FF}',
      '.__rc_chip:hover:not(.active){color:#eceefb}',
      '.__rc_card2{width:100%;border-radius:10px;border:1px solid #23252f;background:#1c1e2a;overflow:hidden;display:flex;flex-direction:column;cursor:pointer;transition:border-color .14s,transform .14s}',
      '.__rc_card2:hover{border-color:#6C7CFF;transform:translateY(-2px)}',
      '.__rc_card2_thumb{width:100%;aspect-ratio:1/1;position:relative;overflow:hidden;background:#0A0B10;cursor:zoom-in}',
      '.__rc_card2_thumb img{width:100%;height:100%;object-fit:cover}',
      '.__rc_card2_fade{position:absolute;inset:0;background:linear-gradient(180deg,transparent 55%,rgba(0,0,0,.55) 100%);pointer-events:none}',
      '.__rc_card2_hoveractions{position:absolute;inset:auto 8px 8px 8px;display:flex;justify-content:flex-end;gap:6px;opacity:0;transform:translateY(4px);transition:opacity .14s,transform .14s}',
      '.__rc_card2:hover .__rc_card2_hoveractions{opacity:1;transform:translateY(0)}',
      '.__rc_mini_btn{flex:0 0 auto;border:none;border-radius:6px;font:700 9.5px monospace;letter-spacing:.2px;padding:5px 12px;cursor:pointer;background:rgba(10,11,16,.72);color:#fff}',
      '.__rc_mini_btn:hover{background:#6C7CFF;color:#0A0B10}',
      '.__rc_mini_btn.danger:hover{background:#e74c3c;color:#fff}',
      '.__rc_card2_body{padding:9px 10px 11px;display:flex;flex-direction:column;gap:4px}',
      '.__rc_card2_name{font-size:12px;font-weight:700;color:#eceefb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.__rc_card2_owner{font-size:10.5px;color:#82849a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.__rc_card2_meta{display:flex;gap:8px;font:10px monospace;color:#5c5e6b;font-variant-numeric:tabular-nums;margin-top:2px}',
      '#__rc_expand_modal{display:none;position:fixed;inset:0;z-index:3000;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}',
      '#__rc_expand_modal *{box-sizing:border-box}',
      '#__rc_expand_backdrop{position:absolute;inset:0;background:rgba(0,0,0,.72);cursor:pointer}',
      '#__rc_expand_body{position:relative;background:#12131A;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.6);padding:20px;max-width:90vw;max-height:90vh;display:flex;flex-direction:column;align-items:center}',
      '#__rc_expand_close{position:absolute;top:6px;right:10px;z-index:1;cursor:pointer;color:#5c5e6b;font-size:22px;line-height:1;padding:4px 8px}',
      '#__rc_expand_close:hover{color:#eceefb}',
      '#__rc_expand_content{position:relative;width:min(60vw,500px);height:min(60vh,500px);min-width:200px;min-height:200px;overflow:hidden;cursor:grab}',
      '#__rc_expand_content:active{cursor:grabbing}',
      '#__rc_expand_content img{position:absolute;top:0;left:0;max-width:none;max-height:none;border-radius:8px;display:block;user-select:none;-webkit-user-drag:none}',
      '#__rc_expand_status{color:#82849a;font-size:12px;padding:40px;text-align:center}',
      '.__rc_detail_hdr{display:flex;gap:14px;padding:18px 20px;border-bottom:1px solid #23252f}',
      '.__rc_detail_thumb{width:84px;height:84px;border-radius:8px;overflow:hidden;flex-shrink:0;background:#0A0B10;border:1px solid #23252f;cursor:zoom-in}',
      '.__rc_detail_thumb img{width:100%;height:100%;object-fit:cover}',
      '.__rc_detail_meta{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:3px}',
      '.__rc_detail_name{font-size:16px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.__rc_detail_owner{font-size:12px;color:#82849a}',
      '.__rc_detail_stats{display:flex;gap:12px;margin-top:4px;font:10px monospace;color:#5c5e6b;font-variant-numeric:tabular-nums}',
      '.__rc_detail_hdr .__rc_back{margin-left:auto;align-self:flex-start}',
      '.__rc_detail_body{padding:4px 20px 20px;display:flex;flex-direction:column;gap:0}',
      '.__rc_section_label2{display:flex;align-items:center;gap:8px;font:700 10px monospace;letter-spacing:1px;text-transform:uppercase;color:#5c5e6b;margin:14px 0 8px}',
      '.__rc_count_pill{font:700 9.5px monospace;padding:2px 7px;border-radius:999px;background:#1c1e2a;color:#82849a}',
      '.__rc_detail_list{display:flex;flex-direction:column;gap:1px;border:1px solid #23252f;border-radius:8px;overflow:hidden;max-height:180px;overflow-y:auto}',
      '.__rc_detail_row{display:flex;align-items:center;gap:10px;padding:8px 10px;background:#1c1e2a;font-size:12px;border-top:1px solid #23252f}',
      '.__rc_detail_row:first-child{border-top:none}',
      '.__rc_swatch{width:8px;height:8px;border-radius:2px;flex-shrink:0;background:#A6B0FF}',
      '.__rc_detail_row .__rc_item_name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.__rc_detail_row .__rc_item_count{font:700 11px monospace;color:#82849a;font-variant-numeric:tabular-nums;flex-shrink:0}',
      '.__rc_detail_actions{display:flex;gap:8px;padding-top:16px;flex-wrap:wrap}',
      '#__rc_warn_overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2100;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}',
      '.__rc_warn_card{width:300px;background:#12131A;border:1px solid rgba(241,196,15,.35);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.5);color:#eceefb;padding:18px}',
      '.__rc_warn_title{font:700 13px system-ui;color:#f1c40f;margin-bottom:8px}',
      '.__rc_warn_text{font-size:12px;color:#c8cad8;line-height:1.5;margin-bottom:16px}',
      '.__rc_warn_actions{display:flex;gap:8px}',
      '.__rc_btn_buy{background:rgba(46,204,113,.16);color:#2ecc71;border:1px solid rgba(46,204,113,.35)}',
      '.__rc_btn_buy:hover{background:rgba(46,204,113,.26)}',
      '.__rc_btn_danger_outline{background:rgba(231,76,60,.12);color:#e74c3c;border:1px solid rgba(231,76,60,.3)}',
      '.__rc_btn_danger_outline:hover{background:rgba(231,76,60,.2)}',
      '.__rc_back{cursor:pointer;color:#82849a;font-size:15px;line-height:1;padding:2px 4px}',
      '.__rc_back:hover{color:#eceefb}',
      '.__rc_quick_room{margin:6px 0 10px;font:600 12px system-ui;color:#eceefb}',
      '.__rc_btn_block{width:100%;text-align:center}',
      '.__rc_tabs{display:flex;gap:4px;padding:0 12px;border-bottom:1px solid #23252f}',
      '.__rc_tab{padding:8px 10px;font-size:11px;font-weight:600;color:#82849a;cursor:pointer;border-bottom:2px solid transparent}',
      '.__rc_tab:hover{color:#eceefb}',
      '.__rc_tab.active{color:#A6B0FF;border-bottom-color:#A6B0FF}',
      '.__rc_tabpane{display:none}',
      '.__rc_tabpane.active{display:block}',
    ].join('');
    document.head.appendChild(style);
  }

  function _renderCatalogStatus() {
    if (!catalogStatusEl) return;
    const fullBtn = panel.querySelector('#__rc_fullscan_btn');
    if (_scanning) {
      catalogStatusEl.textContent = _catalogItems.length + ' offer(s) known — walking pages (' + _scanQueue.length + ' left)...';
      if (fullBtn) fullBtn.textContent = 'Stop Scan';
    } else {
      catalogStatusEl.textContent = _catalogItems.length + ' offer(s) known.';
      if (fullBtn) fullBtn.textContent = 'Full Scan';
    }
  }

  // Real screenshot thumbnail — turns out ":screenshot" is just a client-side capture of
  // the room's own render canvas (confirmed: sending the identical raw Chat packet did
  // nothing, only the real UI-typed version worked, and that's because it's not a server
  // round-trip at all — it grabs the canvas directly). So we do the same: find the
  // biggest visible <canvas> on the page (the game's render surface) and read it with
  // toDataURL() ourselves, no chat command needed. Cached in-memory per blueprint (keyed
  // by id+capturedAt), not persisted to localStorage — full images would bloat storage.
  const _thumbCache = new Map();
  function _getThumbnail(blueprint) {
    return _thumbCache.get(String(blueprint.id)) || null;
  }

  // Thumbnails are real screenshots (tens of KB each as base64) — localStorage's ~5-10MB
  // quota would fill up fast with more than a handful of rooms, so they live in
  // IndexedDB instead (keyed by blueprint id, not id+capturedAt, so recapturing/updating
  // a blueprint in place just overwrites its one thumbnail rather than orphaning old rows).
  const _THUMB_DB_NAME = 'gheloo_roomclone_thumbs';
  const _THUMB_STORE = 'thumbs';
  let _thumbDbPromise = null;
  function _openThumbDb() {
    if (_thumbDbPromise) return _thumbDbPromise;
    _thumbDbPromise = new Promise(function(resolve) {
      try {
        const req = indexedDB.open(_THUMB_DB_NAME, 1);
        req.onupgradeneeded = function() {
          if (!req.result.objectStoreNames.contains(_THUMB_STORE)) req.result.createObjectStore(_THUMB_STORE);
        };
        req.onsuccess = function() { resolve(req.result); };
        req.onerror = function() { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return _thumbDbPromise;
  }
  function _saveThumbToDb(id, dataUrl) {
    _openThumbDb().then(function(db) {
      if (!db) return;
      try { db.transaction(_THUMB_STORE, 'readwrite').objectStore(_THUMB_STORE).put(dataUrl, id); } catch (e) {}
    });
  }
  function _deleteThumbFromDb(id) {
    _openThumbDb().then(function(db) {
      if (!db) return;
      try { db.transaction(_THUMB_STORE, 'readwrite').objectStore(_THUMB_STORE).delete(id); } catch (e) {}
    });
  }
  function _loadAllThumbsFromDb() {
    return _openThumbDb().then(function(db) {
      if (!db) return;
      return new Promise(function(resolve) {
        try {
          const req = db.transaction(_THUMB_STORE, 'readonly').objectStore(_THUMB_STORE).openCursor();
          req.onsuccess = function(e) {
            const cursor = e.target.result;
            if (!cursor) { resolve(); return; }
            _thumbCache.set(String(cursor.key), cursor.value);
            cursor.continue();
          };
          req.onerror = function() { resolve(); };
        } catch (e) { resolve(); }
      });
    });
  }
  // Renders an actual isometric room thumbnail via the Room Viewer's own off-screen Nitro
  // engine (room-viewer-src/src/thumbnail.ts) instead of screenshotting whatever the real
  // game canvas happened to be showing (wrong crop/angle/zoom for area captures especially
  // — that screenshot was the whole visible viewport, not just the captured tiles). Lazily
  // downloads the ~3.6MB renderer bundle the first time this runs in a session, same as
  // opening the Room Viewer panel itself (room-viewer-loader.js) — cached afterward.
  function _renderRoomThumbnail(blueprint) {
    if (!window.__rv_ensureLoaded) { _log('Thumbnail: Room Viewer loader script missing — reload the extension.'); return; }
    window.__rv_ensureLoaded(function() {
      if (!window.__rv_renderThumbnail) { _log('Thumbnail: renderer loaded but __rv_renderThumbnail missing.'); return; }
      window.__rv_renderThumbnail({
        floorItems: blueprint.floorItems,
        wallItems: blueprint.wallItems,
        floorProps: blueprint.floorProps
      }).then(function(result) {
        _log('Thumbnail: ' + result.itemsResolved + '/' + result.itemsRequested + ' item(s) rendered.');
        if (!result.dataUrl) { _log('Thumbnail: render produced nothing for this blueprint.'); return; }
        _thumbCache.set(String(blueprint.id), result.dataUrl);
        _saveThumbToDb(String(blueprint.id), result.dataUrl);
        _renderBlueprints();
      }).catch(function(err) {
        _log('Thumbnail render failed: ' + (err && err.message ? err.message : String(err)));
      });
    }, function(err) {
      _log('Thumbnail: failed to load renderer — ' + err);
    });
  }

  // ── Full render modal — the small 200x200 card thumbnail is deliberately just a cropped
  // preview (see thumbnail.ts: fitting a whole room into that box broke floor/wall plane
  // rendering entirely). Click it to re-render the same blueprint with fitWhole=true — the
  // renderer computes a canvas big enough to contain the ENTIRE room at its normal scale
  // (see thumbnail.ts), so the resulting image is complete even though the modal's own CSS
  // viewport only shows part of it at once; dragging (see _ensureExpandModal's pan wiring)
  // pans across the actual image data instead of trying to scale/fit it all into view.
  const _expandCache = new Map(); // blueprint id -> dataUrl, session-only (not persisted — big images)
  let _expandModalEl = null;

  function _ensureExpandModal() {
    if (_expandModalEl) return _expandModalEl;
    const el = document.createElement('div');
    el.id = '__rc_expand_modal';
    el.innerHTML =
      '<div id="__rc_expand_backdrop"></div>' +
      '<div id="__rc_expand_body">' +
        '<span id="__rc_expand_close">&times;</span>' +
        '<div id="__rc_expand_content"></div>' +
      '</div>';
    document.body.appendChild(el);
    function close() { el.style.display = 'none'; }
    el.querySelector('#__rc_expand_backdrop').addEventListener('click', close);
    el.querySelector('#__rc_expand_close').addEventListener('click', close);
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && el.style.display !== 'none') close(); });

    // Drag-to-pan — the rendered image is shown at its native size (bigger than the
    // 80vw/80vh viewport, deliberately: fitting the whole thing scaled-down was the
    // previous version, reverted), so parts of it sit outside the visible area until
    // dragged into view. Wired once here rather than per-render since #__rc_expand_content
    // itself is a stable node — only the <img> inside it gets replaced each render.
    const content = el.querySelector('#__rc_expand_content');
    let panX = 0, panY = 0, dragging = false, lastX = 0, lastY = 0;
    function currentImg() { return content.querySelector('img'); }
    function clampPan() {
      const img = currentImg();
      if (!img) return;
      const minX = Math.min(0, content.clientWidth - (img.naturalWidth || img.width));
      const minY = Math.min(0, content.clientHeight - (img.naturalHeight || img.height));
      panX = Math.min(0, Math.max(minX, panX));
      panY = Math.min(0, Math.max(minY, panY));
    }
    function applyPan() {
      const img = currentImg();
      if (img) img.style.transform = 'translate(' + panX + 'px,' + panY + 'px)';
    }
    // Called after a new image is set — starts centered rather than pinned to the
    // top-left corner, so the initially-visible crop matches the small card thumbnail's
    // own framing instead of jumping to a random edge.
    el.resetExpandPan = function() {
      const img = currentImg();
      if (!img) return;
      function center() {
        panX = Math.min(0, (content.clientWidth - (img.naturalWidth || img.width)) / 2);
        panY = Math.min(0, (content.clientHeight - (img.naturalHeight || img.height)) / 2);
        clampPan();
        applyPan();
      }
      if (img.complete) center(); else img.addEventListener('load', center, { once: true });
    };
    content.addEventListener('mousedown', function(e) {
      if (!currentImg()) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      e.preventDefault();
    });
    window.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      panX += e.clientX - lastX;
      panY += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      clampPan();
      applyPan();
    });
    window.addEventListener('mouseup', function() { dragging = false; });

    _expandModalEl = el;
    return el;
  }

  function openThumbnailExpand(blueprint) {
    const el = _ensureExpandModal();
    const content = el.querySelector('#__rc_expand_content');
    el.style.display = 'flex';

    const cached = _expandCache.get(blueprint.id);
    if (cached) { content.innerHTML = '<img src="' + cached + '" alt="">'; el.resetExpandPan(); return; }

    content.innerHTML = '<div id="__rc_expand_status">Rendering...</div>';
    if (!window.__rv_ensureLoaded) { content.innerHTML = '<div id="__rc_expand_status">Room Viewer loader script missing — reload the extension.</div>'; return; }
    window.__rv_ensureLoaded(function() {
      if (!window.__rv_renderThumbnail) { content.innerHTML = '<div id="__rc_expand_status">Renderer loaded but __rv_renderThumbnail missing.</div>'; return; }
      window.__rv_renderThumbnail({
        floorItems: blueprint.floorItems,
        wallItems: blueprint.wallItems,
        floorProps: blueprint.floorProps
      }, 450, true).then(function(result) {
        if (el.style.display === 'none') return; // closed before this resolved
        if (!result.dataUrl) { content.innerHTML = '<div id="__rc_expand_status">Render produced nothing for this blueprint.</div>'; return; }
        _expandCache.set(blueprint.id, result.dataUrl);
        content.innerHTML = '<img src="' + result.dataUrl + '" alt="">';
        el.resetExpandPan();
      }).catch(function(err) {
        if (el.style.display === 'none') return;
        content.innerHTML = '<div id="__rc_expand_status">Render failed: ' + _esc(err && err.message ? err.message : String(err)) + '</div>';
      });
    }, function(err) {
      content.innerHTML = '<div id="__rc_expand_status">Failed to load renderer — ' + _esc(String(err)) + '</div>';
    });
  }

  // Bill-of-materials for a captured room — every item type needed to build it, full
  // stop (no split by buyability; that's only relevant to Buy Missing, not this view).
  function _groupBlueprintItems(blueprint) {
    const counts = new Map();
    blueprint.floorItems.forEach(function(it) {
      counts.set(it.typeId, (counts.get(it.typeId) || 0) + 1);
    });
    (blueprint.wallItems || []).forEach(function(it) {
      counts.set(it.typeId, (counts.get(it.typeId) || 0) + 1);
    });
    const needed = [];
    counts.forEach(function(count, typeId) {
      needed.push({ typeId: typeId, name: _typeName(typeId), count: count });
    });
    needed.sort(function(a, b) { return b.count - a.count; });
    return { needed: needed };
  }

  // In-extension warning instead of a browser confirm() — same overlay pattern as the
  // detail view, just smaller. onBuy/onBuildWithout only fire on their own explicit click.
  function _showMissingWarning(missingItemCount, onBuy, onBuildWithout) {
    const overlay = document.createElement('div');
    overlay.id = '__rc_warn_overlay';
    overlay.innerHTML =
      '<div class="__rc_warn_card">' +
        '<div class="__rc_warn_title">Missing Items</div>' +
        '<div class="__rc_warn_text">' + missingItemCount + ' item(s) are missing from your inventory.</div>' +
        '<div class="__rc_warn_actions">' +
          '<button class="__rc_btn __rc_btn_buy" id="__rc_warn_buy">Buy Missing Items</button>' +
          '<button class="__rc_btn __rc_btn_secondary" id="__rc_warn_build">Build Without</button>' +
          '<button class="__rc_btn __rc_btn_secondary" id="__rc_warn_cancel">Cancel</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    function close() { overlay.remove(); }
    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
    overlay.querySelector('#__rc_warn_cancel').addEventListener('click', close);
    overlay.querySelector('#__rc_warn_buy').addEventListener('click', function() { close(); onBuy(); });
    overlay.querySelector('#__rc_warn_build').addEventListener('click', function() { close(); onBuildWithout(); });
  }

  // ── Build tab — selected blueprint's detail lives inline here, replacing the old
  // modal overlay. No selection yet → shows the capture prompt instead.
  let _selectedId = null;
  let _activeTab = 'capture';

  function _selectBlueprint(id) {
    _selectedId = id;
    _switchTab('build');
    _renderBlueprints();
  }
  function _clearSelection() {
    _selectedId = null;
    _renderBlueprints();
  }
  function _switchTab(tab) {
    _activeTab = tab;
    if (!panel) return;
    panel.querySelectorAll('.__rc_tab').forEach(function(t) { t.classList.toggle('active', t.dataset.tab === tab); });
    panel.querySelectorAll('.__rc_tabpane').forEach(function(p) { p.classList.toggle('active', p.id === '__rc_pane_' + tab); });
  }

  function _progressBarHtml(prog, label) {
    if (!prog) return '';
    const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
    const remainingMs = Math.max(0, (prog.startedAt + prog.totalMs) - Date.now());
    const remainingS = Math.ceil(remainingMs / 1000);
    const eta = remainingMs <= 0 ? 'finishing...' : (remainingS < 60 ? remainingS + 's left' : Math.floor(remainingS / 60) + 'm ' + (remainingS % 60) + 's left');
    return '<div class="__rc_section_label2">' + label + '<span class="__rc_count_pill">' + prog.done + '/' + prog.total + '</span></div>' +
      '<div class="__rc_progress_bar"><div class="__rc_progress_fill" style="width:' + pct + '%"></div></div>' +
      '<div class="__rc_progress_text">' + eta + '</div>';
  }

  // Capture is its own tab now — Build only ever shows a selected blueprint, or a
  // plain placeholder pointing at the Library when nothing's selected.
  function _renderCaptureTab() {
    if (!panel) return;
    const roomEl = panel.querySelector('#__rc_quick_room');
    if (roomEl) roomEl.textContent = (window.Room && window.Room.id) ? (window.Room.name || ('Room ' + window.Room.id)) : 'Not in a room';
    const areaBtn = panel.querySelector('#__rc_area_capture_btn');
    if (areaBtn) areaBtn.textContent = _areaPicking ? 'Cancel Area Capture' : 'Capture Area';
    const areaHint = panel.querySelector('#__rc_area_hint');
    if (areaHint) {
      areaHint.textContent = _areaPicking ? 'Click an empty tile and drag to the opposite corner, then release.' :
        'Drag a rectangle over the room (other furni dims while you drag) — the area captures on release. No wall items.';
    }
  }

  function _renderBuildTab() {
    if (!panel) return;
    const pane = panel.querySelector('#__rc_pane_build');
    if (!pane) return;

    const blueprint = _selectedId !== null ? _blueprints.find(function(b) { return b.id === _selectedId; }) : null;

    if (!blueprint) {
      pane.innerHTML = '<div class="__rc_empty">Select a capture from Room Library to build it.</div>';
      return;
    }

    const groups = _groupBlueprintItems(blueprint);
    const thumbUrl = _getThumbnail(blueprint);
    const thumbHtml = thumbUrl ? '<img src="' + thumbUrl + '" alt="">' : '';
    const ownerHtml = blueprint.ownerName ? '<div class="__rc_detail_owner">Owned by ' + _esc(blueprint.ownerName) + '</div>' : '';

    function rowsHtml(items) {
      if (!items.length) return '<div class="__rc_empty">None</div>';
      return items.map(function(it) {
        return '<div class="__rc_detail_row">' +
          '<span class="__rc_swatch"></span>' +
          '<span class="__rc_item_name">' + _esc(it.name) + '</span>' +
          '<span class="__rc_item_count">&times;' + it.count + '</span>' +
        '</div>';
      }).join('');
    }

    const neededTotal = groups.needed.reduce(function(s, i) { return s + i.count; }, 0);
    const buyProg = (_buyProgress && _buyProgress.id === blueprint.id) ? _buyProgress : null;
    const buildProg = (_applyProgress && _applyProgress.id === blueprint.id) ? _applyProgress : null;
    const isRunning = !!(buyProg || buildProg);
    // Preview/Build are always both visible for an area blueprint (no separate "start
    // picking" step) — state belongs to whichever blueprint id last toggled Preview on,
    // so switching to a different blueprint mid-preview just shows it as not-yet-started.
    const ownsPreview = _buildAnchorId === blueprint.id;
    const previewOn = ownsPreview && _buildPreviewOn;
    const hasAnchorPos = ownsPreview && !!_buildPreviewOffset;

    pane.innerHTML =
      '<div class="__rc_detail_hdr">' +
        '<div class="__rc_detail_thumb">' + thumbHtml + '</div>' +
        '<div class="__rc_detail_meta">' +
          '<div class="__rc_detail_name" id="__rc_visit_room" title="' + _esc(blueprint.name) + ' — click to visit" style="cursor:pointer">' + _esc(blueprint.name) + '</div>' +
          ownerHtml +
          '<div class="__rc_detail_stats">' +
            '<span>#' + blueprint.roomId + '</span>' +
            '<span>Floor: ' + blueprint.floorItems.length + '</span>' +
            '<span>Wall: ' + (blueprint.wallItems ? blueprint.wallItems.length : 0) + '</span>' +
          '</div>' +
        '</div>' +
        '<span class="__rc_back" id="__rc_clear_selection" title="Back to capture">&larr;</span>' +
      '</div>' +
      '<div class="__rc_detail_body">' +
        '<div class="__rc_section_label2">Needed to rebuild<span class="__rc_count_pill">' + groups.needed.length + ' types &middot; ' + neededTotal + ' pcs</span></div>' +
        '<div class="__rc_detail_list">' + rowsHtml(groups.needed) + '</div>' +
        _progressBarHtml(buyProg, 'Buying') +
        _progressBarHtml(buildProg, 'Building') +
        (blueprint.isArea
          ? '<div class="__rc_muted">' + (previewOn
              ? 'Click a tile to place the preview, click elsewhere to move it, or Build once it looks right.'
              : hasAnchorPos
                ? 'Preview paused at the last position — Preview to resume, or Build to place it there.'
                : 'Preview, then click a tile in this room to place it.') + '</div>'
          : '') +
        '<div class="__rc_detail_actions">' +
          (isRunning ? '<button class="__rc_btn __rc_btn_danger_outline" data-action="abort">Abort</button>' : '') +
          (blueprint.isArea
            ? '<button class="__rc_btn __rc_btn_secondary" data-action="confirmanchor"' + (hasAnchorPos ? '' : ' disabled') + '>Build</button>' +
              '<button class="__rc_btn __rc_btn_secondary" data-action="togglepreview">' + (previewOn ? 'Clear Preview' : 'Preview') + '</button>'
            : '<button class="__rc_btn __rc_btn_secondary" data-action="apply"' + (isRunning ? ' disabled' : '') + '>Build</button>') +
          (blueprint.floorProps && blueprint.floorProps.floorPlan
            ? '<button class="__rc_btn __rc_btn_secondary" data-action="applyfloor"' + (isRunning ? ' disabled' : '') + ' title="Reshapes this room to match the original and sets wall height — only works if you own it">Build Floor + Wall</button>'
            : '') +
          '<button class="__rc_btn __rc_btn_buy" data-action="buy"' + (isRunning ? ' disabled' : '') + '>Buy Missing Items</button>' +
          '<button class="__rc_btn __rc_btn_danger_outline" data-action="delete"' + (isRunning ? ' disabled' : '') + '>Delete</button>' +
        '</div>' +
      '</div>';

    pane.querySelector('#__rc_clear_selection').addEventListener('click', _clearSelection);
    pane.querySelector('#__rc_visit_room').addEventListener('click', function() { visitRoom(blueprint.id); });
    const detailThumbEl = pane.querySelector('.__rc_detail_thumb');
    if (detailThumbEl) detailThumbEl.addEventListener('click', function() { openThumbnailExpand(blueprint); });
    pane.querySelector('.__rc_detail_actions').addEventListener('click', function(e) {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'apply') applyBlueprint(blueprint.id);
      else if (btn.dataset.action === 'togglepreview') toggleBuildPreview(blueprint.id);
      else if (btn.dataset.action === 'confirmanchor') confirmBuildAnchor(blueprint.id);
      else if (btn.dataset.action === 'applyfloor') applyFloorProperties(blueprint.id);
      else if (btn.dataset.action === 'buy') buyMissing(blueprint.id);
      else if (btn.dataset.action === 'abort') abortBuild(blueprint.id);
      else if (btn.dataset.action === 'delete') { deleteBlueprint(blueprint.id); _clearSelection(); }
    });
  }

  function _filteredLibraryBlueprints() {
    let list = _blueprints.slice().sort(function(a, b) { return b.capturedAt - a.capturedAt; });
    if (_libFilter === 'rooms') list = list.filter(function(b) { return !b.isArea; });
    else if (_libFilter === 'areas') list = list.filter(function(b) { return b.isArea; });
    if (_libSearch) {
      const q = _libSearch.toLowerCase();
      list = list.filter(function(b) {
        return (b.name || '').toLowerCase().indexOf(q) !== -1 || (b.ownerName || '').toLowerCase().indexOf(q) !== -1;
      });
    }
    return list;
  }

  function _renderBlueprints() {
    _renderCaptureTab();
    _renderBuildTab();
    if (panel) {
      const countEl = panel.querySelector('#__rc_lib_count');
      if (countEl) countEl.textContent = _blueprints.length + (_blueprints.length === 1 ? ' capture' : ' captures');
    }
    if (!listEl) return;
    const filtered = _filteredLibraryBlueprints();
    if (!filtered.length) {
      listEl.innerHTML = '<div class="__rc_empty">' + (_blueprints.length ? 'No captures match this filter.' : 'No blueprints yet. Enter a room and click Capture.') + '</div>';
      return;
    }
    listEl.innerHTML = filtered.map(function(b) {
      const thumbUrl = _getThumbnail(b);
      const thumbImg = thumbUrl ? '<img src="' + thumbUrl + '" alt="">' : '';
      const ownerHtml = b.ownerName ? '<div class="__rc_card2_owner">Owned by ' + _esc(b.ownerName) + '</div>' : '';
      return '<div class="__rc_card2" data-id="' + b.id + '">' +
        '<div class="__rc_card2_thumb">' +
          thumbImg +
          '<div class="__rc_card2_fade"></div>' +
          '<div class="__rc_card2_hoveractions">' +
            '<button class="__rc_mini_btn danger" data-action="delete" data-id="' + b.id + '">Del</button>' +
          '</div>' +
        '</div>' +
        '<div class="__rc_card2_body">' +
          '<div class="__rc_card2_name" title="' + _esc(b.name) + '">' + _esc(b.name) + '</div>' +
          ownerHtml +
          '<div class="__rc_card2_meta"><span>#' + b.roomId + '</span></div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function buildPanel() {
    injectStyle();
    panel = document.createElement('div');
    panel.id = '__rclone';
    panel.innerHTML =
      '<div class="__rc_card">' +
        '<div class="__rc_hdr" id="__rc_hdr">' +
          '<span class="__rc_eyebrow">Gheloo</span>' +
          '<span class="__rc_title">Room Clone</span>' +
          '<span class="__rc_close" id="__rc_close">&times;</span>' +
        '</div>' +
        '<div class="__rc_tabs">' +
          '<div class="__rc_tab active" data-tab="capture">Capture</div>' +
          '<div class="__rc_tab" data-tab="build">Build</div>' +
          '<div class="__rc_tab" data-tab="library">Room Library</div>' +
        '</div>' +
        '<div id="__rc_body">' +
          '<div class="__rc_tabpane active" id="__rc_pane_capture">' +
            '<div style="padding:16px 18px">' +
              '<div class="__rc_section_label">Quick Capture</div>' +
              '<div class="__rc_quick_room" id="__rc_quick_room">Not in a room</div>' +
              '<button class="__rc_btn __rc_btn_primary __rc_btn_block" id="__rc_quick_capture_btn">Capture This Room</button>' +
              '<div class="__rc_section_label" style="margin-top:14px">Capture Area</div>' +
              '<div class="__rc_muted" id="__rc_area_hint">Captures only the floor items inside a rectangle you click. No wall items.</div>' +
              '<button class="__rc_btn __rc_btn_secondary __rc_btn_block" id="__rc_area_capture_btn" style="margin-top:6px">Capture Area</button>' +
            '</div>' +
          '</div>' +
          '<div class="__rc_tabpane" id="__rc_pane_build"></div>' +
          '<div class="__rc_tabpane" id="__rc_pane_library">' +
            '<div class="__rc_lib_hdr">' +
              '<div class="__rc_lib_title_row">' +
                '<div><h3>Room Library</h3><span class="__rc_lib_count" id="__rc_lib_count">0 captures</span></div>' +
              '</div>' +
              '<input type="text" class="__rc_search" id="__rc_search" placeholder="Search captures...">' +
              '<div class="__rc_chip_row">' +
                '<span class="__rc_chip active" data-filter="all">All</span>' +
                '<span class="__rc_chip" data-filter="rooms">Rooms</span>' +
                '<span class="__rc_chip" data-filter="areas">Areas</span>' +
              '</div>' +
            '</div>' +
            '<div class="__rc_list" id="__rc_list"></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(panel);
    panel.style.display = 'none';

    listEl = panel.querySelector('#__rc_list');

    panel.querySelectorAll('.__rc_tab').forEach(function(tabEl) {
      tabEl.addEventListener('click', function() { _switchTab(tabEl.dataset.tab); });
    });

    panel.querySelectorAll('.__rc_chip').forEach(function(chipEl) {
      chipEl.addEventListener('click', function() {
        panel.querySelectorAll('.__rc_chip').forEach(function(c) { c.classList.remove('active'); });
        chipEl.classList.add('active');
        _libFilter = chipEl.dataset.filter;
        _renderBlueprints();
      });
    });
    panel.querySelector('#__rc_search').addEventListener('input', function(e) {
      _libSearch = e.target.value;
      _renderBlueprints();
    });

    window.__ghk_makeDraggable(panel, panel.querySelector('#__rc_hdr'), '__ghk_rc_pos', function(e) {
      return e.target.id === '__rc_close';
    });

    panel.querySelector('#__rc_close').addEventListener('click', function() { panel.style.display = 'none'; });
    panel.querySelector('#__rc_quick_capture_btn').addEventListener('click', function() { captureRoom(); });
    panel.querySelector('#__rc_area_capture_btn').addEventListener('click', function() {
      if (_areaPicking) cancelAreaCapture(); else startAreaCapture();
    });

    listEl.addEventListener('click', function(e) {
      const btn = e.target.closest('button[data-action]');
      if (btn) {
        if (btn.dataset.action === 'delete') deleteBlueprint(parseInt(btn.dataset.id));
        return;
      }
      const card = e.target.closest('.__rc_card2[data-id]');
      if (!card) return;
      const thumb = e.target.closest('.__rc_card2_thumb');
      if (thumb) {
        const blueprint = _blueprints.find(function(b) { return b.id === parseInt(card.dataset.id); });
        if (blueprint) openThumbnailExpand(blueprint);
        return;
      }
      _selectBlueprint(parseInt(card.dataset.id));
    });

    _renderBlueprints();
    _renderCatalogStatus();
  }

  // content.js's hub menu button calls this right after showing the panel, so every
  // click on "Room Clone" clears any selection and lands back on the Capture tab —
  // capturing a room is the one thing that jumps straight to Build afterward.
  window.__ghl_rcShowQuick = function() {
    _selectedId = null;
    _switchTab('capture');
    _renderBlueprints();
  };

  function init() {
    _loadBlueprints();
    _loadCatalog();
    buildPanel();
    _loadAllThumbsFromDb().then(_renderBlueprints);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(init); });
  } else {
    window.__ghk_ready(init);
  }
})();
