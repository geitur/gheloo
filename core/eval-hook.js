(function() {
  // leetgame.js's outer obfuscator.io wrapper decodes the entire ~3.2MB Nitro client bundle
  // into one string and runs it via a single eval() call (confirmed: the unpacked bundle's
  // own webpack module system is plain function-wrapping, not eval-per-module — this is the
  // ONLY eval() in the whole load chain). Overriding window.eval BEFORE that runs lets us
  // regex-patch the bundle's source text on the way past, exposing an internal class we'd
  // otherwise have no handle on — same technique the Bananablet extension uses.
  //
  // Must be the first script this extension injects (see manifest.json) — content scripts at
  // document_start run before the page's own <script> tags, but only in the order listed here.
  //
  // Target 1: IH._selectionShader = new class extends E {...} — IH is Nitro-react's internal
  // furni-selection-highlight class (confirmed against this game's own leetgame.js: same
  // class, same shader GLSL, same lineColor/color uniforms, same show()/hide()/
  // applySelectionShader()/clearSelectionShader() API — found while decoding leetgame.js
  // earlier). "_selectionShader" is a plain dot-notation property name, not a string literal,
  // so obfuscator.io's string-array encryption doesn't touch it — it survives as literal,
  // regex-matchable text in the eval'd source no matter how the rest of the bundle is mangled.
  // ([$\w]+) capture is whatever that class got minified to in the current build — the exact
  // name isn't stable across rebuilds, only the structural pattern is.
  var nativeEval = window.eval;

  // Target 2: this._roomManager.addUpdateCategory(ve.FLOOR), inside RoomEngine's own
  // constructor — `this` at that exact point in the source IS the RoomEngine instance, no
  // capture group needed. Matched WITH its trailing comma and left untouched; the addition
  // is spliced in as another parenthesized comma-expression operand right after it — this
  // call sits inside a larger comma-sequence (terser's compaction of a run of five back-to-
  // back addUpdateCategory calls), not a semicolon-terminated statement, so a plain
  // `window.RoomEngine=this;` inserted here would be a syntax error mid-expression. Exact
  // same pattern the Bananablet/hibisco extension uses — confirmed structurally identical
  // in this game's own decoded bundle (webcrack-bundle/602-split/shared-DU-4718.js).
  function patch(source) {
    if (typeof source !== 'string') return source;
    if (source.indexOf('_selectionShader=') !== -1) {
      source = source.replace(
        /([$\w]+)\._selectionShader=/,
        'window.__gh_FurniSelect=$1;$&'
      );
    }
    if (source.indexOf('_roomManager.addUpdateCategory(') !== -1) {
      source = source.replace(
        /this\._roomManager\.addUpdateCategory\([$\w]+\.FLOOR\),/,
        '$&(window.RoomEngine=this),'
      );
    }
    // Target 3: this._originalTileMap=void 0; inside FloorplanEditor's constructor —
    // the class backing Nitro's native floorplan editor UI. This is the exact anchor a
    // competitor extension ("hibisco") uses for the same exposure — confirmed by reading
    // their decoded bundle (see docs/superpowers/specs/2026-08-03-floor-editor-design.md).
    // Nowhere else to get a handle on this class: it's a nitro-react UI component, not
    // part of the published @nitrots/nitro-renderer package.
    if (source.indexOf('_originalTileMap=void 0') !== -1) {
      source = source.replace(
        /this\._originalTileMap=void 0;/,
        '$&window.FloorplanEditor=this;'
      );
    }
    return source;
  }

  window.eval = function(source) {
    try {
      return nativeEval(patch(source));
    } catch (e) {
      // If the patch somehow produced invalid JS, fail open — run the original, unpatched
      // source rather than breaking the entire game client over a highlight feature.
      console.error('[Gheloo] eval-hook patch failed, running original source', e);
      return nativeEval(source);
    }
  };
})();
