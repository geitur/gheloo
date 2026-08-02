(function() {
  window.__ghk_ok = true;
  window.__ghk_ready = function(cb) { cb(); };
})();

// Shared draggable-panel helper — every extension/tool panel wires its own header-drag
// logic; this centralizes it AND persists the dragged position per panel (keyed by
// storageKey) so closing and reopening a panel (or reloading the page) puts it back
// where it was left, instead of resetting to its default corner every time. Defined
// here (the very first file loaded) rather than content.js because content.js loads
// AFTER several ui-*.js files that call window.__ghk_ready(init) synchronously at their
// own load time — content.js wouldn't exist yet when they'd need this.
window.__ghk_makeDraggable = function(panel, handleEl, storageKey, shouldSkip) {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch (_) {}
  if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
    panel.style.right = 'auto';
    panel.style.left = saved.left + 'px';
    panel.style.top = saved.top + 'px';
  }
  let dragging = false, ox = 0, oy = 0;
  handleEl.addEventListener('mousedown', function(e) {
    if (shouldSkip && shouldSkip(e)) return;
    dragging = true; ox = e.clientX - panel.offsetLeft; oy = e.clientY - panel.offsetTop;
  });
  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    panel.style.right = 'auto'; panel.style.top = 'auto';
    panel.style.left = (e.clientX - ox) + 'px'; panel.style.top = (e.clientY - oy) + 'px';
  });
  document.addEventListener('mouseup', function() {
    if (!dragging) return;
    dragging = false;
    try { localStorage.setItem(storageKey, JSON.stringify({ left: panel.offsetLeft, top: panel.offsetTop })); } catch (_) {}
  });
};

// Force preserveDrawingBuffer on the game's own WebGL canvas so Room Clone's screenshot
// thumbnails aren't just solid black. By default the browser clears a WebGL canvas's
// buffer right after each frame is presented, so toDataURL() from outside the renderer
// reads nothing — there's no fixing that after the context already exists, so this has
// to patch getContext BEFORE the game creates it, which only works because this content
// script runs at document_start, ahead of the page's own scripts.
(function() {
  const _getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, options) {
    if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
      options = Object.assign({}, options, { preserveDrawingBuffer: true });
    }
    return _getContext.call(this, type, options);
  };
})();

// Shared coordination between the Gheloo FPS overlay (top-left, Shadow DOM) and the
// #__nitro_pills_wrap stack (Color Party / Friend Adder / Mimic pills, light DOM) so
// the pill stack sits in the top corner by default, and moves below the FPS overlay
// only while that overlay is actually visible.
(function() {
  window.__ghk_fpsOverlayOn = false;
  window.__ghk_updatePillsWrapPos = function() {
    const wrap = document.getElementById('__nitro_pills_wrap');
    if (wrap) wrap.style.top = window.__ghk_fpsOverlayOn ? '48px' : '12px';
  };
})();

// FPS cap: throttle requestAnimationFrame at the source so it caps whatever
// render loop the page uses, regardless of the renderer.
(function() {
  const _rAF = window.requestAnimationFrame.bind(window);
  const _cAF = window.cancelAnimationFrame.bind(window);
  let _capInterval = 0; // ms between frames; 0 = unlimited
  let _lastFrameTime = 0;

  window.requestAnimationFrame = function(cb) {
    if (!_capInterval) return _rAF(cb);
    const now = performance.now();
    const delay = Math.max(0, _capInterval - (now - _lastFrameTime));
    return setTimeout(function() {
      _lastFrameTime = performance.now();
      cb(_lastFrameTime);
    }, delay);
  };

  window.cancelAnimationFrame = function(id) {
    clearTimeout(id);
    _cAF(id);
  };

  window.__ghk_setFpsCap = function(fps) {
    _capInterval = fps ? 1000 / fps : 0;
  };
})();

(function() {
  const _RealWS = window.WebSocket;
  const _spy = new Proxy(_RealWS, {
    construct(target, args) {
      const ws = Reflect.construct(target, args);
      window.__wsUrl = args[0];
      setTimeout(() => window.dispatchEvent(new CustomEvent('__ws_connect', { detail: { url: args[0] } })), 0);
      return ws;
    }
  });
  try {
    Object.defineProperty(window, 'WebSocket', { value: _spy, writable: true, configurable: true });
  } catch(e) {
    window.WebSocket = _spy;
  }

  const _RealWorker = window.Worker;
  const _workerSpy = new Proxy(_RealWorker, {
    construct(target, args) {
      const worker = Reflect.construct(target, args);
      worker.addEventListener('message', function(ev) {
        if (ev.data && ev.data.__n === 'url') {
          window.__wsUrl = ev.data.url;
          setTimeout(() => window.dispatchEvent(new CustomEvent('__ws_connect', { detail: { url: ev.data.url } })), 0);
        }
      });
      return worker;
    }
  });
  try {
    Object.defineProperty(window, 'Worker', { value: _workerSpy, writable: true, configurable: true });
  } catch(e) {
    window.Worker = _workerSpy;
  }
})();
