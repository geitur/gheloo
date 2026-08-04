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
      '.__gh_debug_row{display:flex}',
      '.__gh_debugbtn{font-size:9px;background:none;border:1px solid #23252f;color:#82849a;border-radius:6px;padding:4px 8px;cursor:pointer;margin-left:auto}',
      '.__gh_debugbtn:hover{color:#eceefb}',
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
            '<div class="__gh_debug_row" id="__gh_debug_row" style="display:none">' +
              '<button id="__gh_debug_copy" class="__gh_debugbtn" title="Copy debug log">Copy log</button>' +
            '</div>' +
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
              '<button type="button" class="__gh_ver_btn" id="__gh_ver_v3">V3</button>' +
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
        if (!_running) return;
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
        if (!_running) return;
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

    // ── V3 — "in-flight pickup + debug log" implementation. Adds two things V2 doesn't
    // have: on round-start, sweeps window.Room.floorItems for a tile that's already mid-fall
    // (the fall loop runs independently of whether we're tracking, so a round can already
    // have one airborne the instant we arm) instead of waiting up to a full ~5s cycle for it
    // to lap back through storage; and drops a queued tile immediately if it hits the line
    // or gets removed before its turn instead of dispatching a walk to an already-dead tile.
    // No start-delay (unlike V2). Same wrapping approach as V1/V2 — _ghEnabled renamed to
    // _running, click-handler body split into start()/stop() — plus a copyLog() method for
    // the debug-log button, since this is the only engine that keeps one.
    function makeV3Engine(gh) {
      const GH_LANE_X    = { 20: 'Yellow', 21: 'Red', 22: 'Blue', 23: 'Green' };
      const GH_LINE_Y    = 36;
      const GH_STORAGE_Y = 25;
      const GH_SPAWN_MIN = 26, GH_SPAWN_MAX = 27;
      const GH_HEX       = { Yellow: '#e8c030', Red: '#e04040', Blue: '#4488ee', Green: '#26c87a' };
      const GH_BOX       = { Red: [22, 42], Blue: [23, 41], Green: [24, 42], Yellow: [23, 43] };
      const GH_CENTER    = [23, 42];
      const GH_VALID_POS = new Set([...Object.values(GH_BOX), GH_CENTER].map(([x, y]) => x + ',' + y));
      const GH_FALLBACK_MS = 6000;
      const GH_DEBUG_MAX = 500;

      let _running         = false;
      let _ghInGame        = false;
      let _ghSelfIdx       = null;
      let _ghLastY         = {};
      let _ghQueue         = [];
      let _ghActive        = null;
      let _ghFallbackTimer = null;
      let _ghAdvanceTimer  = null;
      let _ghDebugLog      = [];

      function _ghLog(event, data) {
        _ghDebugLog.push({ t: Date.now(), event: event, data: data || null });
        if (_ghDebugLog.length > GH_DEBUG_MAX) _ghDebugLog.shift();
        console.debug('[GH]', event, data || '');
      }

      function _ghFindSelf() {
        if (!window._selfName || !window.Room || !window.Room.users) return;
        const u = Object.values(window.Room.users).find(u => u.name === window._selfName);
        if (u) _ghSelfIdx = u.index;
      }

      function _ghStopSession() {
        _ghLog('session-stop');
        _ghInGame = false;
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

      function _ghDispatch(entry) {
        _ghActive = entry;
        _ghSetLabel(entry.color);
        if (_ghFallbackTimer) clearTimeout(_ghFallbackTimer);
        if (_ghAdvanceTimer) { clearTimeout(_ghAdvanceTimer); _ghAdvanceTimer = null; }
        const dest = GH_BOX[entry.color];
        _ghLog('dispatch', { id: entry.id, color: entry.color });
        window.Game.walkTo(dest[0], dest[1]);
        // Safety net: if we never see this tile's y hit the line or an ObjectRemove for it
        // (missed/reordered packet), advance anyway instead of getting stuck on it forever.
        _ghFallbackTimer = setTimeout(function() { _ghAdvance(entry.id, 'fallback'); }, GH_FALLBACK_MS);
      }

      // Called once the currently-active tile is done (hit the line, got removed, or timed
      // out) — jumps straight to whatever spawned next in the queue, only resting at center
      // if nothing has spawned yet.
      function _ghAdvance(id, reason) {
        if (!_ghActive || _ghActive.id !== id) return;
        _ghLog('advance', { id: id, reason: reason || 'unknown' });
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

      // Shared entry point for "a falling tile needs to be handled" — used both for a tile
      // freshly detected leaving storage and for one picked up already mid-fall (see
      // _ghScanInFlight below).
      function _ghRegisterFall(id, color) {
        const entry = { id, color };
        if (_ghActive) { _ghQueue.push(entry); _ghUpdateQueue(); }
        else _ghDispatch(entry);
      }

      function _ghSpawn(id, x, y) {
        const color = GH_LANE_X[x];
        if (!color) return;
        if (y < GH_SPAWN_MIN || y > GH_SPAWN_MAX) return;
        // Belt-and-suspenders: if this id happens to already be known in
        // window.Room.floorItems (it usually isn't), require its name to actually be the
        // falling tile so we don't queue some unrelated furni sitting in the lane's x/y range.
        const known = window.Room && window.Room.floorItems && window.Room.floorItems[id];
        if (known && known.furniName && known.furniName.toLowerCase() !== 'kleurtegel (bronze)') return;
        _ghLog('spawn', { id: id, color: color, x: x, y: y });
        _ghRegisterFall(id, color);
      }

      // The room's tile-fall loop runs independently of whether we're tracking — a round can
      // already have a tile mid-air the instant we arm (arrival at center confirmed). That
      // tile left storage before we started listening, so it'll never land on y=26/27 again
      // until it laps all the way back through storage — a full ~5s cycle wasted doing
      // nothing. Sweep floorItems once on round-start and pick up anything already falling.
      function _ghScanInFlight() {
        if (!window.Room || !window.Room.floorItems) return;
        const inFlight = [];
        Object.values(window.Room.floorItems).forEach(function(item) {
          const color = GH_LANE_X[item.x];
          if (!color) return;
          if (item.y < GH_SPAWN_MIN || item.y >= GH_LINE_Y) return; // not currently mid-fall
          if (item.furniName && item.furniName.toLowerCase() !== 'kleurtegel (bronze)') return;
          inFlight.push({ id: item.id, color: color, y: item.y });
        });
        inFlight.sort(function(a, b) { return b.y - a.y; }); // closest to the line first — most urgent
        inFlight.forEach(function(t) {
          if (_ghLastY[t.id] !== undefined) return;
          _ghLastY[t.id] = t.y;
          _ghLog('inflight-pickup', { id: t.id, color: t.color, y: t.y });
          _ghRegisterFall(t.id, t.color);
        });
      }

      window.onPacket('SlideObjectBundle', p => {
        if (!_running || !_ghInGame || !p.parsed) return;
        p.parsed.items.forEach(({ id, x, y }) => {
          const last = _ghLastY[id];
          _ghLastY[id] = y;
          if (_ghActive && _ghActive.id === id) {
            if (y >= GH_LINE_Y && !_ghAdvanceTimer) {
              _ghAdvanceTimer = setTimeout(function() { _ghAdvanceTimer = null; _ghAdvance(id, 'line'); }, 500);
            }
            return;
          }
          const qIdx = _ghQueue.findIndex(function(e) { return e.id === id; });
          if (qIdx !== -1) {
            // A tile can hit the line (or get removed, handled below) while it's still
            // sitting in the queue — the bot fell behind and never got to dispatch it. Drop
            // it here the instant that happens instead of leaving it in the queue: if we
            // waited and dispatched it later anyway (old behavior), the deadline was already
            // gone and the walk landed on a dead/expired tile — no real hit, easy death.
            if (y >= GH_LINE_Y) {
              _ghLog('queue-miss', { id: id, reason: 'line' });
              _ghQueue.splice(qIdx, 1);
              _ghUpdateQueue();
            } else if (y === GH_STORAGE_Y) {
              // Storage (y=25) is where a tile rests between falls — several can idle there at
              // once. A queued tile reappearing there means it completed a lap without ever
              // being hit; drop the stale entry instead of dispatching it later out of sync.
              // It gets re-queued fresh once it actually leaves storage again (y=26/27).
              _ghLog('queue-miss', { id: id, reason: 'recycled' });
              _ghQueue.splice(qIdx, 1);
              _ghUpdateQueue();
            }
            return; // still waiting its turn (or just expired above)
          }
          // Not active, not queued — y=25 is inert storage and is NEVER a spawn signal on
          // its own (tiles can sit there idle indefinitely, several at a time). Only 26/27
          // count as "just left storage and started falling."
          const enteringPlay = (y === GH_SPAWN_MIN || y === GH_SPAWN_MAX) && (last === undefined || last <= GH_STORAGE_Y);
          if (enteringPlay) _ghSpawn(id, x, y);
        });
      });

      window.onPacket('ObjectRemove', p => {
        if (!_ghInGame || !p.parsed) return;
        const id = p.parsed.id;
        if (_ghActive && _ghActive.id === id) { _ghAdvance(id, 'removed'); return; }
        // Same reasoning as the queued line-hit case above: a removal for a tile we never
        // got around to dispatching means its window is gone — drop it, don't dispatch late.
        const qIdx = _ghQueue.findIndex(function(e) { return e.id === id; });
        if (qIdx !== -1) {
          _ghLog('queue-miss', { id: id, reason: 'removed' });
          _ghQueue.splice(qIdx, 1);
          _ghUpdateQueue();
        }
      });

      window.onPacket('Objects',    () => { setTimeout(_ghFindSelf, 50); });
      window.onPacket('Users',      () => { setTimeout(_ghFindSelf, 50); });
      window.onPacket('UserObject', () => { _ghFindSelf(); });

      window.onPacket('UserUpdate', p => {
        if (_ghSelfIdx === null || !p.parsed || p.parsed.index !== _ghSelfIdx) return;
        const key = p.parsed.x + ',' + p.parsed.y;
        // Confirmed real position, logged every time it changes — this is what actually
        // happened, to compare against the walkTo intent (dispatch) above it in the log
        // when tracking down a bug.
        if (_running) _ghLog('position', { x: p.parsed.x, y: p.parsed.y });
        if (!_ghInGame) {
          if (_running && p.parsed.x === GH_CENTER[0] && p.parsed.y === GH_CENTER[1]) {
            _ghInGame = true;
            _ghLog('round-start');
            _ghScanInFlight();
          }
          return;
        }
        if (!GH_VALID_POS.has(key)) _ghStopSession(); // walked out of the box — round's over
      });

      window.onPacket('RoomReady', () => {
        if (!_running) return;
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
        },
        copyLog: function() {
          return navigator.clipboard.writeText(JSON.stringify(_ghDebugLog, null, 2));
        }
      };
    }

    const V1Engine = makeV1Engine(gh);
    const V2Engine = makeV2Engine(gh);
    const V3Engine = makeV3Engine(gh);

    // ── Version toggle — persisted choice between the two engines above. Disabled while
    // running so the selection can't change mid-round.
    const VERSION_KEY = '__ghk_guitar_hero_version';
    function _ghLoadVersion() {
      try {
        const v = localStorage.getItem(VERSION_KEY);
        return (v === 'v1' || v === 'v2' || v === 'v3') ? v : 'v1';
      } catch (_) { return 'v1'; }
    }
    function _ghSaveVersion(v) {
      try { localStorage.setItem(VERSION_KEY, v); } catch (_) {}
    }

    let _ghVersion = _ghLoadVersion();
    let _ghRunning = false;

    function _ghSelectedEngine() {
      if (_ghVersion === 'v2') return V2Engine;
      if (_ghVersion === 'v3') return V3Engine;
      return V1Engine;
    }

    const v1Btn = gh.querySelector('#__gh_ver_v1');
    const v2Btn = gh.querySelector('#__gh_ver_v2');
    const v3Btn = gh.querySelector('#__gh_ver_v3');
    const debugRow = gh.querySelector('#__gh_debug_row');
    function _ghUpdateVersionButtons() {
      if (v1Btn) { v1Btn.classList.toggle('active', _ghVersion === 'v1'); v1Btn.disabled = _ghRunning; }
      if (v2Btn) { v2Btn.classList.toggle('active', _ghVersion === 'v2'); v2Btn.disabled = _ghRunning; }
      if (v3Btn) { v3Btn.classList.toggle('active', _ghVersion === 'v3'); v3Btn.disabled = _ghRunning; }
      // Only V3 keeps a debug log — hide the copy button for the other two rather than
      // show a control that would just copy an empty array.
      if (debugRow) debugRow.style.display = _ghVersion === 'v3' ? 'flex' : 'none';
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
    if (v3Btn) v3Btn.addEventListener('click', function() {
      if (_ghRunning) return;
      _ghVersion = 'v3';
      _ghSaveVersion('v3');
      _ghUpdateVersionButtons();
    });
    _ghUpdateVersionButtons();

    const debugCopyBtn = gh.querySelector('#__gh_debug_copy');
    if (debugCopyBtn) debugCopyBtn.addEventListener('click', function() {
      const btn = this;
      V3Engine.copyLog().catch(() => {}).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy log'; }, 1200);
      });
    });

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
