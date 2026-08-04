(function() {
  if (window.__fe_log) return; // singleton guard — no panel element to key off, this file has no floating UI of its own

  // Floor Editor Tools — repurposes Nitro's native floorplan editor buttons: the
  // primary button becomes Undo, the (normally disabled) Preview button becomes Expand.
  // Ported from a competitor extension ("hibisco"), minus its Fill, Autofloor, Shrink
  // (pure-bounding-box crop turned out unusable on rooms with stray disconnected
  // walkable tiles), live 3D-room preview, and drag-select-on-the-room — both of the
  // latter were built and live-tested but dropped: live preview corrupted
  // FloorplanEditor's internal state on rooms where window.Room.wallHeight comes back
  // -1, and drag-select conflicted with FloorplanEditor's own native pointer handlers
  // already driving the same RoomEngine.areaSelectionManager() singleton. Full
  // design/risk notes: docs/superpowers/specs/2026-08-03-floor-editor-design.md.
  //
  // No floating Gheloo panel — everything here patches the native editor's own
  // DOM/behavior directly.

  window.__fe_log = function(msg) {
    console.log('[FloorEditor]', msg);
  };

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
    if (!window.FloorplanEditor) return;
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
    }
  }

  function init() {
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
