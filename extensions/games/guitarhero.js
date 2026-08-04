(function() {
  function buildGuitarHeroPanel() {
    const style = document.createElement('style');
    style.textContent = [
      '#__gh{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__gh *{box-sizing:border-box}',
      '.__gh_card_outer{background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb;display:flex;flex-direction:column}',
      '.__gh_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__gh_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}',
      '.__gh_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__gh_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__gh_close:hover{color:#eceefb}',
      '#__gh_color_card{border-radius:10px;background:#3a3d4a;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;transition:background 0.3s;flex-shrink:0}',
      '#__gh_color_label{font-size:24px;font-weight:800;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,0.3);line-height:1;letter-spacing:.5px}',
      '.__gh_card{background:#1c1e2a;border-radius:8px;padding:8px 12px}',
      '.__gh_label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#5c5e6b}',
      '.__gh_sub{font-size:9px;color:#82849a}',
      '.__gh_divider{height:1px;background:rgba(255,255,255,0.06)}',
      '.__gh_chip{font:700 9px/1 monospace;letter-spacing:.5px;color:#0A0B10;padding:4px 7px;border-radius:999px;text-transform:uppercase}',
      '.__gh_btn{border:none;border-radius:8px;font-size:11px;font-weight:600;padding:6px 10px;cursor:pointer}',
      '.__gh_btn_success{background:#A6B0FF;color:#0A0B10}',
      '.__gh_btn_success:hover{filter:brightness(1.08)}',
      '.__gh_btn_danger{background:rgba(231,76,60,0.15);color:#e74c3c}',
      '.__gh_btn_danger:hover{background:rgba(231,76,60,0.28)}',
      '.__gh_ver_wrap{display:flex;gap:2px;background:#1c1e2a;border-radius:8px;padding:2px;flex-shrink:0}',
      '.__gh_ver_btn{border:none;border-radius:6px;font:700 10px/1 monospace;padding:0 10px;cursor:pointer;background:transparent;color:#82849a}',
      '.__gh_ver_btn.active{background:#6C7CFF;color:#0A0B10}',
      '.__gh_ver_btn:disabled{cursor:not-allowed;opacity:0.5}',
    ].join('');
    document.head.appendChild(style);

    const gh = document.createElement('div');
    gh.id = '__gh';
    gh.style.cssText = 'position:fixed;top:16px;right:16px;width:330px;z-index:1000;user-select:none;display:none';
    gh.innerHTML =
      '<div class="__gh_card_outer">' +
        '<div class="__gh_hdr" id="__gh_hdr">' +
          '<span class="__gh_eyebrow">Gheloo</span>' +
          '<span class="__gh_title">Guitar Hero</span>' +
          '<span class="__gh_close" id="__gh_close">&times;</span>' +
        '</div>' +
        '<div id="__gh_main" style="box-sizing:border-box;display:flex;flex-direction:column;padding:0">' +
          '<div style="flex:1;overflow:hidden;padding:8px 12px;display:flex;flex-direction:column;gap:6px">' +
            '<div id="__gh_color_card">' +
              '<span id="__gh_color_label">—</span>' +
              '<span id="__gh_queue" style="font-size:10px;font-family:monospace;color:rgba(255,255,255,0.9)">queue: 0</span>' +
            '</div>' +
            '<div id="__gh_queue_chips" style="display:flex;flex-wrap:wrap;gap:4px;min-height:20px"></div>' +
          '</div>' +
          '<div style="padding:0 12px 8px;flex-shrink:0;display:flex;gap:6px;align-items:center">' +
            '<div class="__gh_ver_wrap">' +
              '<button type="button" class="__gh_ver_btn" id="__gh_ver_v1">V1</button>' +
              '<button type="button" class="__gh_ver_btn" id="__gh_ver_v2">V2</button>' +
            '</div>' +
            '<button id="__gh_startstop" class="__gh_btn __gh_btn_success" style="flex:1;font-weight:800">Start</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(gh);

    window.__ghk_makeDraggable(gh, gh.querySelector('#__gh_hdr'), '__ghk_gh_pos', e => e.target.id === '__gh_close');
    gh.querySelector('#__gh_close').addEventListener('click', () => { gh.style.display = 'none'; });

    // ── V1 — original implementation (git 1483636, ui-guitarhero.js). Plain Start/Stop:
    // walks to center immediately, no self-position tracking, no round auto-detection.
    // Copied verbatim, just wrapped so its on/off state is driven externally instead of
    // its own button click listener.
    function makeV1Engine(gh) {
      const GH_LANE_X    = { 20: 'Yellow', 21: 'Red', 22: 'Blue', 23: 'Green' };
      const GH_LINE_Y    = 36;
      const GH_STORAGE_Y = 25;
      const GH_SPAWN_MIN = 26, GH_SPAWN_MAX = 27;
      const GH_HEX       = { Yellow: '#e8c030', Red: '#e04040', Blue: '#4488ee', Green: '#26c87a' };
      const GH_BOX       = { Red: [22, 42], Blue: [23, 41], Green: [24, 42], Yellow: [23, 43] };
      const GH_CENTER    = [23, 42];
      const GH_FALLBACK_MS = 6000;

      let _running        = false;
      let _ghLastY         = {};
      let _ghQueue         = [];
      let _ghActive        = null;
      let _ghFallbackTimer = null;
      let _ghAdvanceTimer  = null;

      function _ghSetLabel(color) {
        const card = gh.querySelector('#__gh_color_card');
        const lbl  = gh.querySelector('#__gh_color_label');
        if (card) card.style.background = color ? GH_HEX[color] : '#3a3d4a';
        if (lbl)  lbl.textContent = color || '—';
      }

      function _ghUpdateQueue() {
        const el = gh.querySelector('#__gh_queue');
        if (el) el.textContent = 'queue: ' + _ghQueue.length;
        const chips = gh.querySelector('#__gh_queue_chips');
        if (!chips) return;
        chips.innerHTML = '';
        _ghQueue.forEach(function(entry, i) {
          const chip = document.createElement('span');
          chip.className = '__gh_chip';
          chip.style.background = GH_HEX[entry.color];
          chip.textContent = (i + 1) + ' ' + entry.color;
          chips.appendChild(chip);
        });
      }

      function _ghDispatch(entry) {
        _ghActive = entry;
        window.Game.walkTo(GH_BOX[entry.color][0], GH_BOX[entry.color][1]);
        _ghSetLabel(entry.color);
        if (_ghFallbackTimer) clearTimeout(_ghFallbackTimer);
        if (_ghAdvanceTimer) { clearTimeout(_ghAdvanceTimer); _ghAdvanceTimer = null; }
        _ghFallbackTimer = setTimeout(function() { _ghAdvance(entry.id); }, GH_FALLBACK_MS);
      }

      function _ghAdvance(id) {
        if (!_ghActive || _ghActive.id !== id) return;
        if (_ghFallbackTimer) { clearTimeout(_ghFallbackTimer); _ghFallbackTimer = null; }
        if (_ghQueue.length) {
          _ghDispatch(_ghQueue.shift());
        } else {
          _ghActive = null;
          window.Game.walkTo(GH_CENTER[0], GH_CENTER[1]);
          _ghSetLabel(null);
        }
        _ghUpdateQueue();
      }

      function _ghSpawn(id, x, y) {
        const color = GH_LANE_X[x];
        if (!color) return;
        if (y < GH_SPAWN_MIN || y > GH_SPAWN_MAX) return;
        const known = window.Room && window.Room.floorItems && window.Room.floorItems[id];
        if (known && known.furniName && known.furniName.toLowerCase() !== 'kleurtegel (bronze)') return;
        const entry = { id, color };
        if (_ghActive) { _ghQueue.push(entry); _ghUpdateQueue(); }
        else _ghDispatch(entry);
      }

      window.onPacket('SlideObjectBundle', p => {
        if (!_running || !p.parsed) return;
        p.parsed.items.forEach(({ id, x, y }) => {
          const last = _ghLastY[id];
          _ghLastY[id] = y;
          if (_ghActive && _ghActive.id === id) {
            if (y >= GH_LINE_Y && !_ghAdvanceTimer) {
              _ghAdvanceTimer = setTimeout(function() { _ghAdvanceTimer = null; _ghAdvance(id); }, 500);
            }
            return;
          }
          const qIdx = _ghQueue.findIndex(function(e) { return e.id === id; });
          if (qIdx !== -1) {
            if (y === GH_STORAGE_Y) {
              _ghQueue.splice(qIdx, 1);
              _ghUpdateQueue();
            }
            return;
          }
          const enteringPlay = (y === GH_SPAWN_MIN || y === GH_SPAWN_MAX) && (last === undefined || last <= GH_STORAGE_Y);
          if (enteringPlay) _ghSpawn(id, x, y);
        });
      });

      window.onPacket('ObjectRemove', p => {
        if (!p.parsed) return;
        if (_ghActive && _ghActive.id === p.parsed.id) _ghAdvance(p.parsed.id);
      });

      window.onPacket('RoomReady', () => {
        _ghLastY = {};
        _ghQueue = [];
        _ghActive = null;
        _ghUpdateQueue();
        _ghSetLabel(null);
        if (_ghFallbackTimer) { clearTimeout(_ghFallbackTimer); _ghFallbackTimer = null; }
      });

      return {
        start: function() {
          _running = true;
          _ghLastY = {}; _ghQueue = []; _ghActive = null; _ghUpdateQueue();
          if (_ghFallbackTimer) { clearTimeout(_ghFallbackTimer); _ghFallbackTimer = null; }
          window.Game.walkTo(GH_CENTER[0], GH_CENTER[1]);
          _ghSetLabel(null);
        },
        stop: function() {
          _running = false;
          _ghLastY = {}; _ghQueue = []; _ghActive = null; _ghUpdateQueue();
          if (_ghFallbackTimer) { clearTimeout(_ghFallbackTimer); _ghFallbackTimer = null; }
          _ghSetLabel(null);
        }
      };
    }

    // ── V2 — "auto-detect rounds" implementation (git 1eea628). Tracks the player's own
    // position, auto-arms tracking once UserUpdate confirms arrival at center, start-delay
    // on the first tile of a fresh round. Copied verbatim, same wrapping approach as V1.
    // Known quirk, unchanged from the original commit: Start does nothing if you're already
    // standing on the center tile when clicked (no UserUpdate fires for a no-op walk).
    function makeV2Engine(gh) {
      const GH_LANE_X    = { 20: 'Yellow', 21: 'Red', 22: 'Blue', 23: 'Green' };
      const GH_LINE_Y    = 36;
      const GH_STORAGE_Y = 25;
      const GH_SPAWN_MIN = 26, GH_SPAWN_MAX = 27;
      const GH_HEX       = { Yellow: '#e8c030', Red: '#e04040', Blue: '#4488ee', Green: '#26c87a' };
      const GH_BOX       = { Red: [22, 42], Blue: [23, 41], Green: [24, 42], Yellow: [23, 43] };
      const GH_CENTER    = [23, 42];
      const GH_VALID_POS = new Set([...Object.values(GH_BOX), GH_CENTER].map(([x, y]) => x + ',' + y));
      const GH_FALLBACK_MS = 6000;
      const GH_START_DELAY_MS = 1000;

      let _running         = false;
      let _ghInGame        = false;
      let _ghFirstTile     = false;
      let _ghSelfIdx       = null;
      let _ghLastY         = {};
      let _ghQueue         = [];
      let _ghActive        = null;
      let _ghFallbackTimer = null;
      let _ghAdvanceTimer  = null;

      function _ghFindSelf() {
        if (!window._selfName || !window.Room || !window.Room.users) return;
        const u = Object.values(window.Room.users).find(u => u.name === window._selfName);
        if (u) _ghSelfIdx = u.index;
      }

      function _ghStopSession() {
        _ghInGame = false;
        _ghFirstTile = false;
        _ghLastY = {};
        _ghQueue = [];
        _ghActive = null;
        _ghUpdateQueue();
        _ghSetLabel(null);
        if (_ghFallbackTimer) { clearTimeout(_ghFallbackTimer); _ghFallbackTimer = null; }
        if (_ghAdvanceTimer) { clearTimeout(_ghAdvanceTimer); _ghAdvanceTimer = null; }
      }

      function _ghSetLabel(color) {
        const card = gh.querySelector('#__gh_color_card');
        const lbl  = gh.querySelector('#__gh_color_label');
        if (card) card.style.background = color ? GH_HEX[color] : '#3a3d4a';
        if (lbl)  lbl.textContent = color || '—';
      }

      function _ghUpdateQueue() {
        const el = gh.querySelector('#__gh_queue');
        if (el) el.textContent = 'queue: ' + _ghQueue.length;
        const chips = gh.querySelector('#__gh_queue_chips');
        if (!chips) return;
        chips.innerHTML = '';
        _ghQueue.forEach(function(entry, i) {
          const chip = document.createElement('span');
          chip.className = '__gh_chip';
          chip.style.background = GH_HEX[entry.color];
          chip.textContent = (i + 1) + ' ' + entry.color;
          chips.appendChild(chip);
        });
      }

      function _ghDispatch(entry, delayMs) {
        delayMs = delayMs || 0;
        _ghActive = entry;
        _ghSetLabel(entry.color);
        if (_ghFallbackTimer) clearTimeout(_ghFallbackTimer);
        if (_ghAdvanceTimer) { clearTimeout(_ghAdvanceTimer); _ghAdvanceTimer = null; }
        if (delayMs > 0) setTimeout(function() { window.Game.walkTo(GH_BOX[entry.color][0], GH_BOX[entry.color][1]); }, delayMs);
        else window.Game.walkTo(GH_BOX[entry.color][0], GH_BOX[entry.color][1]);
        _ghFallbackTimer = setTimeout(function() { _ghAdvance(entry.id); }, GH_FALLBACK_MS + delayMs);
      }

      function _ghAdvance(id) {
        if (!_ghActive || _ghActive.id !== id) return;
        if (_ghFallbackTimer) { clearTimeout(_ghFallbackTimer); _ghFallbackTimer = null; }
        if (_ghQueue.length) {
          _ghDispatch(_ghQueue.shift());
        } else {
          _ghActive = null;
          window.Game.walkTo(GH_CENTER[0], GH_CENTER[1]);
          _ghSetLabel(null);
        }
        _ghUpdateQueue();
      }

      function _ghSpawn(id, x, y) {
        const color = GH_LANE_X[x];
        if (!color) return;
        if (y < GH_SPAWN_MIN || y > GH_SPAWN_MAX) return;
        const known = window.Room && window.Room.floorItems && window.Room.floorItems[id];
        if (known && known.furniName && known.furniName.toLowerCase() !== 'kleurtegel (bronze)') return;
        const entry = { id, color };
        if (_ghActive) { _ghQueue.push(entry); _ghUpdateQueue(); }
        else {
          const delay = _ghFirstTile ? GH_START_DELAY_MS : 0;
          _ghFirstTile = false;
          _ghDispatch(entry, delay);
        }
      }

      window.onPacket('SlideObjectBundle', p => {
        if (!_running || !_ghInGame || !p.parsed) return;
        p.parsed.items.forEach(({ id, x, y }) => {
          const last = _ghLastY[id];
          _ghLastY[id] = y;
          if (_ghActive && _ghActive.id === id) {
            if (y >= GH_LINE_Y && !_ghAdvanceTimer) {
              _ghAdvanceTimer = setTimeout(function() { _ghAdvanceTimer = null; _ghAdvance(id); }, 500);
            }
            return;
          }
          const qIdx = _ghQueue.findIndex(function(e) { return e.id === id; });
          if (qIdx !== -1) {
            if (y === GH_STORAGE_Y) {
              _ghQueue.splice(qIdx, 1);
              _ghUpdateQueue();
            }
            return;
          }
          const enteringPlay = (y === GH_SPAWN_MIN || y === GH_SPAWN_MAX) && (last === undefined || last <= GH_STORAGE_Y);
          if (enteringPlay) _ghSpawn(id, x, y);
        });
      });

      window.onPacket('ObjectRemove', p => {
        if (!_ghInGame || !p.parsed) return;
        if (_ghActive && _ghActive.id === p.parsed.id) _ghAdvance(p.parsed.id);
      });

      window.onPacket('Objects',    () => { setTimeout(_ghFindSelf, 50); });
      window.onPacket('Users',      () => { setTimeout(_ghFindSelf, 50); });
      window.onPacket('UserObject', () => { _ghFindSelf(); });

      window.onPacket('UserUpdate', p => {
        if (_ghSelfIdx === null || !p.parsed || p.parsed.index !== _ghSelfIdx) return;
        const key = p.parsed.x + ',' + p.parsed.y;
        if (!_ghInGame) {
          if (_running && p.parsed.x === GH_CENTER[0] && p.parsed.y === GH_CENTER[1]) {
            _ghInGame    = true;
            _ghFirstTile = true;
          }
          return;
        }
        if (!GH_VALID_POS.has(key)) _ghStopSession();
      });

      window.onPacket('RoomReady', () => {
        _ghSelfIdx = null;
        _ghStopSession();
      });

      return {
        start: function() {
          _running = true;
          _ghStopSession();
          _ghFindSelf();
          window.Game.walkTo(GH_CENTER[0], GH_CENTER[1]);
        },
        stop: function() {
          _running = false;
          _ghStopSession();
        }
      };
    }

    const V1Engine = makeV1Engine(gh);
    const V2Engine = makeV2Engine(gh);

    // ── Version toggle — persisted choice between the two engines above. Disabled while
    // running so the selection can't change mid-round.
    const VERSION_KEY = '__ghk_guitar_hero_version';
    function _ghLoadVersion() {
      try {
        const v = localStorage.getItem(VERSION_KEY);
        return (v === 'v1' || v === 'v2') ? v : 'v1';
      } catch (_) { return 'v1'; }
    }
    function _ghSaveVersion(v) {
      try { localStorage.setItem(VERSION_KEY, v); } catch (_) {}
    }

    let _ghVersion = _ghLoadVersion();
    let _ghRunning = false;

    function _ghSelectedEngine() { return _ghVersion === 'v2' ? V2Engine : V1Engine; }

    const v1Btn = gh.querySelector('#__gh_ver_v1');
    const v2Btn = gh.querySelector('#__gh_ver_v2');
    function _ghUpdateVersionButtons() {
      if (v1Btn) { v1Btn.classList.toggle('active', _ghVersion === 'v1'); v1Btn.disabled = _ghRunning; }
      if (v2Btn) { v2Btn.classList.toggle('active', _ghVersion === 'v2'); v2Btn.disabled = _ghRunning; }
    }
    if (v1Btn) v1Btn.addEventListener('click', function() {
      if (_ghRunning) return;
      _ghVersion = 'v1';
      _ghSaveVersion('v1');
      _ghUpdateVersionButtons();
    });
    if (v2Btn) v2Btn.addEventListener('click', function() {
      if (_ghRunning) return;
      _ghVersion = 'v2';
      _ghSaveVersion('v2');
      _ghUpdateVersionButtons();
    });
    _ghUpdateVersionButtons();

    const startStopBtn = gh.querySelector('#__gh_startstop');
    startStopBtn.addEventListener('click', function() {
      _ghRunning = !_ghRunning;
      startStopBtn.textContent = _ghRunning ? 'Stop' : 'Start';
      startStopBtn.className   = _ghRunning ? '__gh_btn __gh_btn_danger' : '__gh_btn __gh_btn_success';
      _ghUpdateVersionButtons();
      if (_ghRunning) _ghSelectedEngine().start();
      else _ghSelectedEngine().stop();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(buildGuitarHeroPanel); }); else window.__ghk_ready(buildGuitarHeroPanel);
})();
