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
  // No floating Gheloo panel — everything here either patches the native editor's own
  // DOM/behavior, or (this box) is a minimal on-screen log, since there's no devtools
  // access on the machine this actually gets tested on (same situation Room Viewer was
  // built under).

  const STORAGE_KEY = '__ghk_floor_editor_settings';

  let _on = false;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (saved.on) _on = true;
  } catch (_) {}

  function _save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ on: _on })); } catch (_) {}
  }

  // ── On-screen log — last 20 lines, fixed top-right, only rendered while enabled.
  let _logBox = null;
  let _logLines = [];
  function _ensureLogBox() {
    if (_logBox || !_on) return;
    _logBox = document.createElement('div');
    _logBox.id = '__fe_log_box';
    _logBox.style.cssText = 'position:fixed;right:8px;top:8px;z-index:999999;max-width:420px;max-height:220px;overflow-y:auto;background:rgba(10,11,16,0.85);color:#eceefb;font:10px/1.5 monospace;padding:6px 8px;border-radius:6px;pointer-events:none;white-space:pre-wrap;word-break:break-all';
    document.body.appendChild(_logBox);
  }
  function _renderLog() {
    if (!_logBox) return;
    _logBox.textContent = _logLines.join('\n');
  }
  window.__fe_log = function(msg) {
    console.log('[FloorEditor]', msg);
    if (!_on) return;
    _ensureLogBox();
    _logLines.push(msg);
    if (_logLines.length > 20) _logLines.shift();
    _renderLog();
  };

  window.__fe_setEnabled = function(on) {
    _on = !!on;
    _save();
    if (_on) { _ensureLogBox(); window.__fe_log('enabled'); }
    else if (_logBox) { _logBox.remove(); _logBox = null; _logLines = []; }
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
  // FloorplanEditor itself (one this codebase has no handle on), so the exact property
  // name on window.FloorplanEditor is NOT confirmed from static source. Probe a few
  // plausible names; if none match, fall back to an empty array — t[a] on an empty
  // array safely returns undefined (no throw, unlike literal undefined), so every tile
  // is just treated as "not occupied" rather than crashing. Logs once so the real
  // property name can still be found and wired in later if it matters.
  function _occupiedTilesSnapshot() {
    const fe = window.FloorplanEditor;
    const candidates = ['_originalOccupiedTiles', 'originalOccupiedTiles', '_occupiedTiles', 'occupiedTiles'];
    for (let i = 0; i < candidates.length; i++) {
      if (fe && fe[candidates[i]] !== undefined) return fe[candidates[i]];
    }
    window.__fe_log('warning: no occupied-tiles property found on FloorplanEditor (keys: ' + (fe ? Object.keys(fe).join(',') : 'n/a') + ') — using empty array (all tiles treated as unoccupied)');
    return [];
  }

  function _ensureFloorEditorButtons() {
    if (!window.__fe_isEnabled()) return;
    if (!window.FloorplanEditor) return;
    // Both disabled pending live-testing fixes — confirmed broken against a real client:
    // - live preview: window.Room.wallHeight comes back -1 (likely a "use server default"
    //   sentinel, not a real height), which corrupts FloorplanEditor's own internal grid
    //   once fed through FloorHeightMapMessageParser and pushed into the live room.
    // - drag-select: FloorplanEditor's native onPointerDown/Move/Release already drive
    //   RoomEngine.areaSelectionManager() internally for their own purposes; driving the
    //   same singleton from here conflicts with that and throws inside native code
    //   (dX.processAreaSelection/onClick) on release.
    // Expand/Undo don't depend on either — they only touch the small editor grid,
    // native and unpatched. See docs/superpowers/specs/2026-08-03-floor-editor-design.md.
    // _patchRenderTilesForLivePreview();
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
          const tilemapString = window.FloorplanEditor.getCurrentTilemapString();
          const wallHeight = window.Room && window.Room.wallHeight;
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
    if (_on) _ensureLogBox();
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
