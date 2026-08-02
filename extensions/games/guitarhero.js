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
          '<div style="padding:0 12px 8px;flex-shrink:0">' +
            '<button id="__gh_startstop" class="__gh_btn __gh_btn_success" style="width:100%;font-weight:800">Start</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(gh);

    window.__ghk_makeDraggable(gh, gh.querySelector('#__gh_hdr'), '__ghk_gh_pos', e => e.target.id === '__gh_close');
    gh.querySelector('#__gh_close').addEventListener('click', () => { gh.style.display = 'none'; });

    // ── GUITAR HERO ──
    // Track layout measured directly in-room (fixed room, not derived from any packet field):
    // 4 lanes run north-south. Tiles spawn/rest at the storage row y=25 (confirmed: x 20-23,
    // y=25) and reach the orange hit line at y=36. Lane x is what encodes color (confirmed
    // via SlideObjectBundle captures: x stays constant while y increments by 1 every ~500ms
    // tick, and recycles straight back to y=25 after reaching the line — never y=37).
    const GH_LANE_X    = { 20: 'Yellow', 21: 'Red', 22: 'Blue', 23: 'Green' };
    const GH_LINE_Y    = 36;
    const GH_STORAGE_Y = 25; // tiles rest here (several at once) between falls — never a spawn signal on its own
    const GH_SPAWN_MIN = 26, GH_SPAWN_MAX = 27; // only y=26/27 means a tile actually left storage and started falling
    const GH_HEX       = { Yellow: '#e8c030', Red: '#e04040', Blue: '#4488ee', Green: '#26c87a' };
    // Player's box: one tile per color plus a center resting spot, measured the same way.
    const GH_BOX       = { Red: [22, 42], Blue: [23, 41], Green: [24, 42], Yellow: [23, 43] };
    const GH_CENTER    = [23, 42];
    // Every tile the player can legally stand on while a round is live — walking off all
    // five of these means the game ended (or was never joined) and kicked you back out.
    const GH_VALID_POS = new Set([...Object.values(GH_BOX), GH_CENTER].map(([x, y]) => x + ',' + y));
    const GH_FALLBACK_MS = 6000; // spawn-to-line is ~5s; safety net if a signal is ever missed
    const GH_START_DELAY_MS = 1000; // wait this long before walking to the very first tile of a fresh round

    let _ghEnabled       = false; // master on/off (the Start/Stop button)
    let _ghInGame        = false; // true from the moment we walk onto the center tile until we leave the box
    let _ghFirstTile     = false; // true only for the first tile of a fresh round — that one gets the start delay
    let _ghSelfIdx       = null;  // our own Room.users index, for reading our live x/y
    let _ghLastY         = {}; // id -> last seen y, used to detect a fresh spawn cycle
    let _ghQueue         = []; // [{ id, color }] in spawn order, not yet visited
    let _ghActive        = null; // { id, color } — the tile whose box we're currently standing on
    let _ghFallbackTimer = null;
    let _ghAdvanceTimer  = null; // short hold after y hits the line so the tile's slide animation finishes

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
      // Safety net: if we never see this tile's y hit the line or an ObjectRemove for it
      // (missed/reordered packet), advance anyway instead of getting stuck on it forever.
      _ghFallbackTimer = setTimeout(function() { _ghAdvance(entry.id); }, GH_FALLBACK_MS + delayMs);
    }

    // Called once the currently-active tile is done (hit the line, got removed, or timed
    // out) — jumps straight to whatever spawned next in the queue, only resting at center
    // if nothing has spawned yet.
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
      // Belt-and-suspenders: if this id happens to already be known in
      // window.Room.floorItems (it usually isn't), require its name to actually be the
      // falling tile so we don't queue some unrelated furni sitting in the lane's x/y range.
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

    // Ids get reused: the same tile id reappears at y=25 (storage) for its next fall cycle
    // instead of a fresh id being allocated (confirmed via real capture: id 18472461 went
    // ...35, 36, then straight back to 25). So "seen" can't be a permanent per-id flag.
    // y=25 itself is NOT a spawn signal though — it's a holding row where several tiles can
    // rest idle at once. A spawn is only real once an untracked id is actually seen moving,
    // at y=26 or 27.
    window.onPacket('SlideObjectBundle', p => {
      if (!_ghEnabled || !_ghInGame || !p.parsed) return;
      p.parsed.items.forEach(({ id, x, y }) => {
        const last = _ghLastY[id];
        _ghLastY[id] = y;
        if (_ghActive && _ghActive.id === id) {
          // Hold briefly once the line is reached — the tile is still mid-slide-animation
          // for ~500ms after the server reports y hitting the line, and advancing the
          // instant the packet arrives walks the avatar away before the hit visually lands.
          if (y >= GH_LINE_Y && !_ghAdvanceTimer) {
            _ghAdvanceTimer = setTimeout(function() { _ghAdvanceTimer = null; _ghAdvance(id); }, 500);
          }
          return;
        }
        const qIdx = _ghQueue.findIndex(function(e) { return e.id === id; });
        if (qIdx !== -1) {
          // Storage (y=25) is where a tile rests between falls — several can idle there at
          // once. A queued tile reappearing there means it completed a lap without ever
          // being hit; drop the stale entry instead of dispatching it later out of sync.
          // It gets re-queued fresh once it actually leaves storage again (y=26/27).
          if (y === GH_STORAGE_Y) {
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
      if (_ghActive && _ghActive.id === p.parsed.id) _ghAdvance(p.parsed.id);
    });

    // Self position tracking (same pattern as ui-colorparty.js's _cpFindSelf/_cpSelfIdx).
    window.onPacket('Objects',    () => { setTimeout(_ghFindSelf, 50); });
    window.onPacket('Users',      () => { setTimeout(_ghFindSelf, 50); });
    window.onPacket('UserObject', () => { _ghFindSelf(); });

    // UserUpdate reports where we've actually arrived — not where we asked to walk to
    // (that's MoveAvatar, which fires the instant the command is sent, well before the
    // avatar physically gets there). Using arrival for both edges: reaching center while
    // not already in a round arms tracking; leaving the whole box while in one stops it.
    window.onPacket('UserUpdate', p => {
      if (_ghSelfIdx === null || !p.parsed || p.parsed.index !== _ghSelfIdx) return;
      const key = p.parsed.x + ',' + p.parsed.y;
      if (!_ghInGame) {
        if (_ghEnabled && p.parsed.x === GH_CENTER[0] && p.parsed.y === GH_CENTER[1]) {
          _ghInGame    = true;
          _ghFirstTile = true;
        }
        return;
      }
      if (!GH_VALID_POS.has(key)) _ghStopSession(); // walked out of the box — round's over
    });

    window.onPacket('RoomReady', () => {
      _ghSelfIdx = null;
      _ghStopSession();
    });

    gh.querySelector('#__gh_startstop').addEventListener('click', function() {
      _ghEnabled = !_ghEnabled;
      this.textContent = _ghEnabled ? 'Stop' : 'Start';
      this.className   = _ghEnabled ? '__gh_btn __gh_btn_danger' : '__gh_btn __gh_btn_success';
      _ghStopSession();
      if (_ghEnabled) {
        _ghFindSelf();
        // Walks to center; tracking itself only arms once UserUpdate confirms we've
        // actually arrived (see above) — not the instant this command is sent.
        window.Game.walkTo(GH_CENTER[0], GH_CENTER[1]);
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(buildGuitarHeroPanel); }); else window.__ghk_ready(buildGuitarHeroPanel);
})();
