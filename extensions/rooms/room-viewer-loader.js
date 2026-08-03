(function() {
  // The off-screen room renderer (window.__rv_renderThumbnail, window.__rv_getEngine)
  // lives in a bundle hosted outside this repo (see core/bridge.js) — fetched once and
  // cached in IndexedDB from then on, so a normal Gheloo update never re-ships its
  // ~3.6MB. This loader is the small part that always ships: it asks bridge.js for the
  // bundle's code and injects it into the page as a real <script> (so it runs with its
  // own top-level scope, same as any other content script here — a plain
  // new Function(code)() would still work, but this survives page CSP more reliably).
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

      if (!e.data.code) {
        _finish(false, 'failed to fetch renderer: ' + (e.data.error || 'unknown error'));
        return;
      }
      var blob = new Blob([e.data.code], { type: 'application/javascript' });
      var url = URL.createObjectURL(blob);
      var script = document.createElement('script');
      script.src = url;
      script.onload = function() {
        URL.revokeObjectURL(url);
        script.remove();
        if (window.__rv_renderThumbnail) _finish(true);
        // The bundle itself wraps its whole top-level execution in a try/catch (see
        // esbuild.config.mjs) that stashes any thrown error here — surface the real
        // reason instead of just "it didn't register", since there's no devtools access
        // to go look for it directly.
        else if (window.__rv_loadError) _finish(false, 'renderer threw during load: ' + window.__rv_loadError);
        else _finish(false, 'renderer script ran but never registered — likely blocked partway through by page CSP');
      };
      script.onerror = function() {
        URL.revokeObjectURL(url);
        _finish(false, 'renderer script failed to execute — likely blocked by page CSP (blob: scripts not allowed)');
      };
      document.head.appendChild(script);
    }
    window.addEventListener('message', handler);
    window.postMessage({ type: '__ghk_rv_request_bundle' }, '*');
  };
})();
