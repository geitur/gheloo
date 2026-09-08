(function () {
  // Renders leet avatar figures to data-URL images with Gheloo's headless Nitro engine
  // (the same one Room Viewer / Room Clone boot via room-viewer-loader.js), instead of
  // the https://www.leet.city/leet-imaging/avatarimage HTTP service — the leet client
  // itself has no imaging server (the string appears nowhere in its bundle), that
  // endpoint is a separate unmaintained service that frequently fails to load.
  //
  // Avatar part assets download from images.leet.city (sends Access-Control-Allow-Origin:
  // *), the engine's own asset manager caches them, and finished data URLs are memoised
  // here keyed by figure+gender+direction+headOnly.
  //
  // Public API (MAIN world, defined synchronously — safe to reference any time; the
  // engine itself only boots on the first real request):
  //
  //   window.__gh_avatarImg(figure, opts) -> Promise<string dataURL>
  //   window.__gh_bindAvatarImg(imgEl, figure, opts) -> void
  //       sets imgEl.src on success, dims it (opts.failOpacity, default '.2') on failure
  //
  //   opts: { gender:'M'|'F', direction:0..7 (default 3), headOnly:false, failOpacity }

  var SCALE_LARGE = 'h';                 // AvatarScaleType.LARGE — 'sh' (small) renders blank headless
  var SET_FULL = 'full', SET_HEAD = 'head';   // AvatarSetType

  var CACHE_MAX = 500;
  var CONCURRENCY = 3;
  var RENDER_TIMEOUT = 15000;

  var _cache = new Map();   // key -> dataURL string, or in-flight Promise<string>
  var _queue = [];
  var _active = 0;
  var _enginePromise = null;

  function _norm(opts) {
    opts = opts || {};
    return {
      gender: opts.gender === 'F' ? 'F' : 'M',
      direction: opts.direction == null ? 3 : (opts.direction | 0),
      headOnly: !!opts.headOnly,
      failOpacity: opts.failOpacity || '.2'
    };
  }

  function _key(figure, o) {
    return figure + '|' + o.gender + '|' + o.direction + '|' + (o.headOnly ? 'h' : 'f');
  }

  function _engine() {
    if (_enginePromise) return _enginePromise;
    _enginePromise = new Promise(function (resolve, reject) {
      if (typeof window.__rv_ensureLoaded !== 'function') {
        reject(new Error('room-viewer loader not present'));
        return;
      }
      window.__rv_ensureLoaded(function () {
        if (typeof window.__rv_getEngine !== 'function') {
          reject(new Error('renderer engine hook missing'));
          return;
        }
        window.__rv_getEngine().then(function (nitro) {
          // __rv_getEngine resolves on roomEngine readiness, which can be before the
          // avatar render manager has finished loading figuredata / figuremap / etc.
          var t0 = Date.now();
          (function waitAvatar() {
            if (nitro && nitro.avatar && nitro.avatar.isReady) { resolve(nitro); return; }
            if (Date.now() - t0 > 20000) { reject(new Error('avatar renderer never became ready')); return; }
            setTimeout(waitAvatar, 150);
          })();
        }, reject);
      }, function (err) {
        reject(new Error(err || 'renderer bundle failed to load'));
      });
    });
    // let a failed boot be retried on the next request
    _enginePromise.catch(function () { _enginePromise = null; });
    return _enginePromise;
  }

  function _cropFromReady(nitro, figure, o) {
    var img = nitro.avatar.createAvatarImage(figure, SCALE_LARGE, o.gender);
    if (!img) throw new Error('avatar renderer unavailable');
    try {
      var setType = o.headOnly ? SET_HEAD : SET_FULL;
      img.setDirection(setType, o.direction);
      var out = img.getCroppedImage(setType);
      if (out && out.src) return out.src;
      throw new Error('renderer returned an empty image');
    } finally {
      try { img.dispose(); } catch (_) {}
    }
  }

  function _renderOnce(nitro, figure, o) {
    return new Promise(function (resolve, reject) {
      // Fast path: parts already downloaded.
      var probe = nitro.avatar.createAvatarImage(figure, SCALE_LARGE, o.gender);
      if (probe && !probe.isPlaceholder()) {
        try { probe.dispose(); } catch (_) {}
        try { resolve(_cropFromReady(nitro, figure, o)); } catch (e) { reject(e); }
        return;
      }
      if (probe) { try { probe.dispose(); } catch (_) {} }

      // Slow path: request with a listener that fires once the parts land.
      var settled = false;
      var listener = {
        disposed: false,
        dispose: function () { this.disposed = true; },
        resetFigure: function () {
          if (settled) return;
          settled = true;
          try { resolve(_cropFromReady(nitro, figure, o)); } catch (e) { reject(e); }
        }
      };
      nitro.avatar.createAvatarImage(figure, SCALE_LARGE, o.gender, listener);
      setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error('avatar parts download timed out'));
      }, RENDER_TIMEOUT);
    });
  }

  function _pump() {
    while (_active < CONCURRENCY && _queue.length) {
      var job = _queue.shift();
      _active++;
      _engine()
        .then(function (nitro) { return _renderOnce(nitro, job.figure, job.opts); })
        .then(job.resolve, job.reject)
        .then(function () { _active--; _pump(); });
    }
  }

  window.__gh_avatarImg = function (figure, opts) {
    if (!figure) return Promise.reject(new Error('no figure'));
    var o = _norm(opts);
    var key = _key(figure, o);

    var hit = _cache.get(key);
    if (typeof hit === 'string') return Promise.resolve(hit);
    if (hit) return hit;

    var p = new Promise(function (resolve, reject) {
      _queue.push({ figure: figure, opts: o, resolve: resolve, reject: reject });
    });
    _cache.set(key, p);
    p.then(function (src) {
      if (_cache.size > CACHE_MAX) _cache.delete(_cache.keys().next().value);
      _cache.set(key, src);
    }, function () {
      _cache.delete(key);
    });
    _pump();
    return p;
  };

  window.__gh_bindAvatarImg = function (imgEl, figure, opts) {
    if (!imgEl) return;
    var o = _norm(opts);
    window.__gh_avatarImg(figure, o).then(function (src) {
      imgEl.src = src;
      imgEl.style.opacity = '';
    }, function () {
      imgEl.style.opacity = o.failOpacity;
    });
  };
})();
