(function() {
  // The off-screen room renderer (window.__rv_renderThumbnail, window.__rv_getEngine)
  // lives in a bundle hosted outside this repo (see core/bridge.js) — fetched once and
  // cached in IndexedDB from then on, so a normal Gheloo update never re-ships its
  // ~3.6MB. This loader is the small part that always ships: it asks bridge.js to fetch
  // the bundle and have background.js inject it via chrome.scripting.executeScript
  // (see background.js's 'get_room_viewer_bundle' handler) — NOT by building a
  // <script src="blob:"> tag here and appending it to the page ourselves. That used to
  // be how this worked, and it silently failed on strict-CSP pages: a page-created
  // <script> element is a DOM node the page's own CSP evaluates, indistinguishable from
  // the page adding it itself, so a block there throws no catchable JS exception —
  // confirmed live as "renderer script ran but never registered" with no further info.
  // chrome.scripting.executeScript is the same privileged, CSP-exempt injection channel
  // every other file in this extension already gets via manifest.json's content_scripts,
  // just invoked dynamically instead of declaratively at document_start.
  // Consumers: Room Clone's thumbnail rendering (extensions/rooms/room-clone.js) calls
  // __rv_ensureLoaded before its first __rv_renderThumbnail call each session.
  var _loading = false;
  var _pending = []; // { cb, onError } queued while a fetch is already in flight

  window.__rv_ensureLoaded = function(cb, onError) {
    if (window.__rv_renderThumbnail) { cb(); return; }
    _pending.push({ cb: cb, onError: onError });
    if (_loading) return; // already fetching — this rides along with that request
    _loading = true;

    // If bridge.js never answers at all (e.g. it didn't load), fail loud instead of
    // hanging forever with no feedback.
    var timeout = setTimeout(function() {
      window.removeEventListener('message', handler);
      _finish(null, 'no response after 15s — the extension bridge may not be loaded, try reloading the extension');
    }, 15000);

    function _finish(ok, err) {
      _loading = false;
      var waiting = _pending;
      _pending = [];
      if (ok) waiting.forEach(function(w) { w.cb(); });
      else {
        console.error('[RoomViewer]', err);
        waiting.forEach(function(w) { if (w.onError) w.onError(err); });
      }
    }

    function handler(e) {
      if (e.source !== window || !e.data || e.data.type !== '__ghk_rv_bundle') return;
      window.removeEventListener('message', handler);
      clearTimeout(timeout);

      // By the time this response arrives, background.js's executeScript call has
      // already run the bundle's full synchronous top-level code in this page — so
      // __rv_renderThumbnail (or __rv_loadError, from the bundle's own try/catch banner/
      // footer, see esbuild.config.mjs) is already set one way or the other.
      if (!e.data.ok) {
        _finish(false, 'failed to load renderer: ' + (e.data.error || 'unknown error'));
        return;
      }
      if (window.__rv_renderThumbnail) { _finish(true); return; }
      if (window.__rv_loadError) { _finish(false, 'renderer threw during load: ' + window.__rv_loadError); return; }
      var d = e.data.diag;
      var diagStr = d ? (' [srcLength=' + d.srcLength + ' hadBefore=' + d.hadBefore + ' tail="' + d.srcTail + '"]') : ' [no diag from background.js]';
      _finish(false, 'renderer script ran but never registered' + diagStr);
    }
    window.addEventListener('message', handler);
    window.postMessage({ type: '__ghk_rv_request_bundle' }, '*');
  };
})();
