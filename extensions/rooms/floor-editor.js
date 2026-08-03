(function() {
  if (window.__fe_log) return; // singleton guard — no panel element to key off, this file has no floating UI of its own

  // Floor Editor Tools — injects Expand/Shrink buttons and an Undo hook into Nitro's
  // native floorplan editor, live-previews tilemap edits on the actual 3D room floor,
  // and lets you drag-select tiles directly on the room instead of only the small
  // editor grid. Ported from a competitor extension ("hibisco"), minus its Fill and
  // Autofloor buttons. Full design/risk notes: docs/superpowers/specs/2026-08-03-floor-editor-design.md.
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

  // ── On-screen log — last 20 lines, fixed bottom-left, only rendered while enabled.
  let _logBox = null;
  let _logLines = [];
  function _ensureLogBox() {
    if (_logBox || !_on) return;
    _logBox = document.createElement('div');
    _logBox.id = '__fe_log_box';
    _logBox.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:999999;max-width:420px;max-height:220px;overflow-y:auto;background:rgba(10,11,16,0.85);color:#eceefb;font:10px/1.5 monospace;padding:6px 8px;border-radius:6px;pointer-events:none;white-space:pre-wrap;word-break:break-all';
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

  function init() {
    if (_on) _ensureLogBox();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(init); });
  } else {
    window.__ghk_ready(init);
  }
})();
