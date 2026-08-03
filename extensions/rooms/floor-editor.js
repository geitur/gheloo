(function() {
  if (window.__fe_log) return; // singleton guard — no panel element to key off, this file has no floating UI of its own

  // Floor Editor Tools — repurposes Nitro's native floorplan editor buttons: the
  // primary button becomes Undo, the (normally disabled) Preview button becomes Expand.
  // Also live-previews tilemap edits on the actual 3D room floor and lets you drag-select
  // tiles directly on the room instead of only the small editor grid. Ported from a
  // competitor extension ("hibisco"), minus its Fill, Autofloor, and Shrink (Shrink's
  // pure-bounding-box approach turned out unusable on rooms with stray disconnected
  // walkable tiles — see live-testing notes in the design doc). Full design/risk notes:
  // docs/superpowers/specs/2026-08-03-floor-editor-design.md.
  //
  // No floating Gheloo panel — everything here patches the native editor's own
  // DOM/behavior directly.

  const STORAGE_KEY = '__ghk_floor_editor_settings';

  let _on = false;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (saved.on) _on = true;
  } catch (_) {}

  function _save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ on: _on })); } catch (_) {}
  }

  // Console-only now — the on-screen log box was useful for initial live debugging but
  // is gone now that the feature works; window.__fe_log stays as the logging entry
  // point everything else already calls into, still visible in devtools if needed.
  window.__fe_log = function(msg) {
    console.log('[FloorEditor]', msg);
  };

  window.__fe_setEnabled = function(on) {
    _on = !!on;
    _save();
  };
  window.__fe_isEnabled = function() { return _on; };

  // ── Tilemap string helpers — 'x' = void/non-walkable, '0'-'9'/'a'-'z' = walkable at
  // that height, one char per tile, '\r'-separated rows. Matches the FloorHeightMap
  // format window.Room.floorPlan already uses (core/parsers.js).
  function _expandTilemap(tilemapString) {
    const rows = tilemapString.replace(/x/g, '0').split('\r');
    const padded = rows.map(function(row) { return row.padEnd(64, '0'); });
    while (padded.length < 64) padded.push('0'.repeat(64));
    return padded.join('\r');
  }

  // ── Snapshot of the tilemap when the editor opened, for the Undo hook.
  let _originalTilemap = null;

  // setTilemap's second argument is read as t[row][col] internally (confirmed against
  // the real client: `let s = t[a] && t[a][i] || false`, an occupied-tiles boolean grid)
  // — undefined throws immediately on the first row. The source extension always passes
  // a value called `originalOccupiedTiles`, read off a different object than
  // FloorplanEditor itself (one this codebase has no handle on) — but the real data is
  // available anyway: FloorplanEditor's own live _tilemap[row][col] is a grid of tile
  // objects (confirmed against a real client: `{_height, _isBlocked}`, e.g.
  // JSON.stringify(window.FloorplanEditor._tilemap[7])), and _isBlocked is exactly the
  // per-tile boolean setTilemap's second argument expects (matches its own real source:
  // `let s = t[a] && t[a][i] || false; ...; new iX(heightChar, s)`). Reading it straight
  // off the CURRENT _tilemap (before we overwrite it) preserves the darker "has furni"
  // rendering across Undo/Expand instead of wiping it to "nothing occupied".
  function _occupiedTilesSnapshot() {
    const tilemap = window.FloorplanEditor && window.FloorplanEditor._tilemap;
    if (!tilemap) return [];
    return tilemap.map(function(row) {
      return row ? row.map(function(tile) { return !!(tile && tile._isBlocked); }) : [];
    });
  }

  function _ensureFloorEditorButtons() {
    if (!window.__fe_isEnabled()) return;
    if (!window.FloorplanEditor) return;
    // Live preview re-enabled with a wallHeight sanity guard (see
    // _patchRenderTilesForLivePreview) after the corruption it caused was traced to
    // window.Room.wallHeight coming back -1 for at least one real room. Drag-select
    // stays disabled — that one's a genuine conflict with FloorplanEditor's own native
    // pointer handlers already driving the same RoomEngine.areaSelectionManager()
    // singleton, throwing inside native code (dX.processAreaSelection/onClick) on
    // release; not a bad-value problem a guard can fix. See
    // docs/superpowers/specs/2026-08-03-floor-editor-design.md.
    _patchRenderTilesForLivePreview();
    // _patchPointerHandlersForDragSelect();
    const primaryBtn = document.querySelector('.nitro-floorplan-editor .d-flex.justify-content-between > .btn-sm.btn-primary');
    if (!primaryBtn) return;

    if (_originalTilemap === null) {
      // Prefer the class's own snapshot if it already tracks one (matches the
      // _originalTileMap=void 0 anchor used to expose this class in eval-hook.js —
      // plausibly the same field, populated once the editor actually opens) — falls
      // back to reading the live tilemap ourselves if that field is still unset.
      if (window.FloorplanEditor._originalTileMap) {
        _originalTilemap = window.FloorplanEditor._originalTileMap;
      } else if (window.FloorplanEditor.getCurrentTilemapString) {
        _originalTilemap = window.FloorplanEditor.getCurrentTilemapString();
      }
    }

    // Relabel + rehook the native primary button as Undo (matches the source extension's
    // approach — it's the same button Nitro uses for its own "confirm"/undo step, so we
    // take it over rather than adding a duplicate).
    if (primaryBtn.textContent.trim() !== 'Undo') {
      primaryBtn.textContent = 'Undo';
      primaryBtn.replaceWith(primaryBtn.cloneNode(true)); // strips native listeners
    }
    // Re-query rather than reuse primaryBtn — replaceWith() above (when it ran) detached
    // the original node, leaving primaryBtn.parentElement null from here on.
    const undoBtn = document.querySelector('.nitro-floorplan-editor .d-flex.justify-content-between > .btn-sm.btn-primary');
    if (!undoBtn) return;
    if (!undoBtn.dataset.feHooked) {
      undoBtn.dataset.feHooked = '1';
      undoBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!window.__fe_isEnabled()) return;
        if (_originalTilemap === null) return;
        try {
          window.FloorplanEditor.setTilemap(_originalTilemap, _occupiedTilesSnapshot());
          window.FloorplanEditor.renderTiles();
          window.__fe_log('undo: restored original tilemap');
        } catch (err) {
          window.__fe_log('undo error: ' + (err && err.message ? err.message : err));
        }
      }, true);
    }

    // Relabel + rehook the native (normally disabled) Preview button as Expand — reuses
    // its existing slot in the button row instead of injecting a new element, so the row
    // reads Undo | Expand | Import/Export | Opslaan, matching native layout/order.
    // Matched by position (first child of .btn-group), not text, since its label changes
    // to "Expand" after the first pass and text-matching would stop finding it.
    const previewBtn = document.querySelector('.nitro-floorplan-editor .btn-group > .btn-sm.btn-primary:first-child');
    if (!previewBtn) return;
    if (previewBtn.textContent.trim() !== 'Expand') {
      previewBtn.textContent = 'Expand';
      previewBtn.classList.remove('disabled');
      previewBtn.replaceWith(previewBtn.cloneNode(true)); // strips native listeners
    }
    const expandBtn = document.querySelector('.nitro-floorplan-editor .btn-group > .btn-sm.btn-primary:first-child');
    if (expandBtn && !expandBtn.dataset.feHooked) {
      expandBtn.dataset.feHooked = '1';
      expandBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!window.__fe_isEnabled()) return;
        if (_originalTilemap === null) return;
        try {
          // Reads _originalTileMap (the tilemap as of editor-open), not
          // getCurrentTilemapString() — confirmed unreliable in live testing (internal
          // _tilemap array doesn't stay in sync with _height/_width outside native
          // code's own control flow, throws when read externally). Tradeoff: acts on
          // the opened state, not any native edits already made first in this session.
          const next = _expandTilemap(_originalTilemap);
          window.FloorplanEditor.setTilemap(next, _occupiedTilesSnapshot());
          window.FloorplanEditor.renderTiles();
          window.__fe_log('expand: tilemap padded to 64x64');
        } catch (err) {
          window.__fe_log('expand error: ' + (err && err.message ? err.message : err));
        }
      }, true);
    }
    window.__fe_log('buttons wired');
  }

  function _resetOnEditorClose() {
    if (!document.querySelector('.nitro-floorplan-editor')) {
      _originalTilemap = null;
      if (_renderTilesDebounce) {
        clearTimeout(_renderTilesDebounce);
        _renderTilesDebounce = null;
      }
      if (_dragOrigin && window.RoomEngine) window.RoomEngine.areaSelectionManager().deactivate();
      _dragOrigin = null;
    }
  }

  // ── Live preview — patches FloorplanEditor.renderTiles exactly once so every edit
  // (native click, Expand, Undo) also rebuilds the actual 3D room floor, not just the
  // small editor grid. Debounced so a fast drag across many tiles doesn't trigger a
  // rebuild per tile. Currently disabled — see _ensureFloorEditorButtons.
  let _renderTilesDebounce = null;
  function _patchRenderTilesForLivePreview() {
    if (!window.FloorplanEditor || window.FloorplanEditor.__fePatched) return;
    if (!window.__fe_applyTilemapLive) return; // bundle not loaded yet — retried on next MutationObserver tick
    window.FloorplanEditor.__fePatched = true;

    const originalRenderTiles = window.FloorplanEditor.renderTiles.bind(window.FloorplanEditor);
    window.FloorplanEditor.renderTiles = function() {
      const result = originalRenderTiles();
      if (!window.__fe_isEnabled()) return result;
      if (_renderTilesDebounce) clearTimeout(_renderTilesDebounce);
      _renderTilesDebounce = setTimeout(function() {
        if (!window.__fe_isEnabled()) return;
        try {
          const wallHeight = window.Room && window.Room.wallHeight;
          // window.Room.wallHeight came back -1 for at least one real room in live
          // testing, which FloorHeightMapMessageParser treats as a literal height
          // rather than a sentinel, producing a malformed room model that corrupted
          // FloorplanEditor's own internal state once pushed into the live room. Until
          // there's a confirmed valid source for this, skip rather than repeat that —
          // safe no-op instead of another corruption chase.
          if (typeof wallHeight !== 'number' || wallHeight <= 0) {
            window.__fe_log('live preview skipped: window.Room.wallHeight looks invalid (' + wallHeight + ')');
            return;
          }
          const tilemapString = window.FloorplanEditor.getCurrentTilemapString();
          const scale = window.Room && window.Room.floorPlanScale;
          const door = window.FloorplanEditor.doorLocation;
          if (!door) { window.__fe_log('live preview skipped: no doorLocation'); return; }
          const ok = window.__fe_applyTilemapLive(tilemapString, wallHeight, scale, door.x, door.y);
          window.__fe_log(ok ? 'live preview applied' : 'live preview: applyTilemapLive returned false');
        } catch (e) {
          window.__fe_log('live preview error: ' + (e && e.message ? e.message : e));
        }
      }, 50);
      return result;
    };
    window.__fe_log('renderTiles patched for live preview');
  }

  // ── Drag-select on the 3D room — patches FloorplanEditor's own pointer handlers so a
  // click-drag on the actual room (not just the small editor grid) drives Gheloo's
  // already-proven area-selection path (window.RoomEngine.areaSelectionManager(), the
  // same one area-mover.js and room-clone.js already use for their own area capture) —
  // deliberately NOT the source extension's raw _areaSelectionManager field access,
  // since Gheloo already has a working method-based path to the same manager.
  //
  // Screen-to-tile conversion: offsetX/offsetY run through the isometric inverse
  // projection the source extension uses. Its NitroPoint wrapper (new
  // NitroPoint(offsetX, offsetY) then read .x/.y straight back off it) is provably a
  // no-op passthrough — an empty-body subclass of a Point class inherits that
  // constructor unchanged, so it just stores x/y as given — meaning the conversion
  // below operates on raw offsetX/offsetY directly with no wrapper needed.
  let _dragOrigin = null;
  function _screenToTile(e) {
    const x = e.offsetX - 1024;
    const y = e.offsetY;
    const tileX = Math.round((x / 16 + y / 8) / 2) - 1;
    const tileY = Math.round((y / 8 - x / 16) / 2);
    return [tileX, tileY];
  }
  function _patchPointerHandlersForDragSelect() {
    if (!window.FloorplanEditor || window.FloorplanEditor.__feDragPatched) return;
    if (!window.RoomEngine) return; // retried on next MutationObserver tick
    window.FloorplanEditor.__feDragPatched = true;

    const originalDown = window.FloorplanEditor.onPointerDown.bind(window.FloorplanEditor);
    window.FloorplanEditor.onPointerDown = function(e) {
      originalDown(e);
      if (!window.__fe_isEnabled()) return;
      const mgr = window.RoomEngine.areaSelectionManager();
      if (mgr.areaSelectionState !== 0) return;
      const [tx, ty] = _screenToTile(e);
      _dragOrigin = [tx, ty];
      mgr.activate(function() {});
      mgr.startSelecting();
      mgr.handleTileMouseEvent({ type: 'ROE_MOUSE_DOWN', tileXAsInt: tx, tileYAsInt: ty });
    };

    const originalMove = window.FloorplanEditor.onPointerMove.bind(window.FloorplanEditor);
    window.FloorplanEditor.onPointerMove = function(e) {
      originalMove(e);
      if (!window.__fe_isEnabled() || !_dragOrigin) return;
      const [tx, ty] = _screenToTile(e);
      const x = Math.min(_dragOrigin[0], tx);
      const y = Math.min(_dragOrigin[1], ty);
      const w = Math.abs(tx - _dragOrigin[0]) + 1;
      const h = Math.abs(ty - _dragOrigin[1]) + 1;
      window.RoomEngine.areaSelectionManager().setHighlight(x, y, w, h);
    };

    const originalRelease = window.FloorplanEditor.onPointerRelease.bind(window.FloorplanEditor);
    window.FloorplanEditor.onPointerRelease = function(e) {
      originalRelease(e);
      if (_dragOrigin) window.RoomEngine.areaSelectionManager().deactivate();
      _dragOrigin = null;
    };

    window.__fe_log('pointer handlers patched for drag-select');
  }

  function init() {
    if (window.__fe_loadError) window.__fe_log('bundle load error: ' + window.__fe_loadError);
    _ensureFloorEditorButtons();
    if (document.body && typeof MutationObserver !== 'undefined') {
      let scheduled = false;
      new MutationObserver(function() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(function() {
          scheduled = false;
          _ensureFloorEditorButtons();
          _resetOnEditorClose();
        });
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(init); });
  } else {
    window.__ghk_ready(init);
  }
})();
