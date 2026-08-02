(function() {
  function buildRoomCopyPanel() {
    const style = document.createElement('style');
    style.textContent = [
      '#__rc{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__rc *{box-sizing:border-box}',
      '.__cp_card_outer{background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb;display:flex;flex-direction:column}',
      '.__cp_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__cp_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}',
      '.__cp_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__cp_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__cp_close:hover{color:#eceefb}',
      '#__cp_color_card{border-radius:10px;background:#3a3d4a;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;transition:background 0.3s;flex-shrink:0}',
      '#__cp_color_label{font-size:24px;font-weight:800;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,0.3);line-height:1;letter-spacing:.5px}',
      '#__cp_dice_status{font-size:10px;font-family:monospace;font-weight:600;color:rgba(255,255,255,0.9);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}',
      '.__cp_card{background:#1c1e2a;border-radius:8px;padding:8px 12px}',
      '.__cp_label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#5c5e6b}',
      '.__cp_sub{font-size:9px;color:#82849a}',
      '.__cp_divider{height:1px;background:rgba(255,255,255,0.06)}',
      '#__cp_delay{width:65px;font-size:10px;font-family:monospace;padding:3px 6px;border:1px solid #23252f;border-radius:6px;background:#0A0B10;color:#eceefb;outline:none;text-align:right}',
      '#__cp_delay:focus{border-color:#6C7CFF}',
      '.__cp_ms{font-size:10px;color:#5c5e6b}',
      '#__cp_tog_wrap{position:relative;display:inline-block;width:34px;height:18px;flex-shrink:0;cursor:pointer}',
      '#__cp_autopos{opacity:0;width:0;height:0;position:absolute}',
      '#__cp_tog_track{position:absolute;inset:0;background:#23252f;border-radius:9px;transition:background 0.2s}',
      '#__cp_tog_thumb{position:absolute;top:2px;left:2px;width:14px;height:14px;background:#eceefb;border-radius:50%;transition:transform 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.25)}',
      '.__cp_btn{border:none;border-radius:8px;font-size:11px;font-weight:600;padding:6px 10px;cursor:pointer}',
      '.__cp_btn_sm{font-size:9px;padding:2px 8px}',
      '.__cp_btn_secondary{background:#1c1e2a;color:#82849a;border:1px solid #23252f}',
      '.__cp_btn_secondary:hover{color:#eceefb}',
      '.__cp_btn_secondary.active{background:rgba(108,124,255,0.16);color:#A6B0FF;border-color:#6C7CFF}',
      '.__cp_btn_success{background:#A6B0FF;color:#0A0B10}',
      '.__cp_btn_success:hover{filter:brightness(1.08)}',
      '.__cp_btn_danger{background:rgba(231,76,60,0.15);color:#e74c3c}',
      '.__cp_btn_danger:hover{background:rgba(231,76,60,0.28)}',
    ].join('');
    document.head.appendChild(style);

    const rc = document.createElement('div');
    rc.id = '__rc';
    rc.style.cssText = 'position:fixed;top:16px;right:16px;width:330px;z-index:1000;user-select:none;display:none';
    rc.innerHTML =
      '<div class="__cp_card_outer">' +
        '<div class="__cp_hdr" id="__rc_hdr">' +
          '<span class="__cp_eyebrow">Gheloo</span>' +
          '<span class="__cp_title">Color Party</span>' +
          '<span class="__cp_close" id="__rc_close">&times;</span>' +
        '</div>' +
        '<div id="__rc_main" style="box-sizing:border-box;display:flex;flex-direction:column;padding:0">' +
          '<div style="flex:1;overflow:hidden;padding:8px 12px;display:flex;flex-direction:column;gap:6px">' +
            '<div id="__cp_color_card">' +
              '<div style="display:flex;flex-direction:column;gap:3px">' +
                '<span id="__cp_color_label"></span>' +
              '</div>' +
              '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">' +
                '<span id="__cp_source_label" class="__cp_label" style="color:rgba(255,255,255,0.9)">Dice</span>' +
                '<span id="__cp_dice_status">not found</span>' +
              '</div>' +
            '</div>' +
            '<div class="__cp_card" style="display:flex;align-items:center;justify-content:space-between">' +
              '<div style="display:flex;flex-direction:column;gap:2px">' +
                '<span class="__cp_label">Player</span>' +
                '<span id="__cp_uname" style="font-size:11px;font-weight:600;color:#eceefb;font-family:monospace">—</span>' +
              '</div>' +
              '<span id="__cp_upos" style="font-size:10px;font-family:monospace;color:#82849a;background:rgba(255,255,255,0.06);padding:2px 8px;border-radius:4px">—, —</span>' +
            '</div>' +
            '<div class="__cp_card" style="display:flex;flex-direction:column;gap:10px">' +
              '<div style="display:flex;align-items:center;justify-content:space-between">' +
                '<div style="display:flex;flex-direction:column;gap:2px">' +
                  '<span class="__cp_label">Walk delay</span>' +
                  '<span class="__cp_sub">Wait before moving</span>' +
                '</div>' +
                '<div style="display:flex;align-items:center;gap:5px">' +
                  '<input id="__cp_delay" type="number" min="0" step="100" value="0">' +
                  '<span class="__cp_ms">ms</span>' +
                '</div>' +
              '</div>' +
              '<div class="__cp_divider"></div>' +
              '<div style="display:flex;align-items:center;justify-content:space-between">' +
                '<div style="display:flex;flex-direction:column;gap:2px">' +
                  '<span class="__cp_label">Smart position</span>' +
                  '<span class="__cp_sub">Best tile on field change</span>' +
                '</div>' +
                '<label id="__cp_tog_wrap">' +
                  '<input type="checkbox" id="__cp_autopos">' +
                  '<span id="__cp_tog_track"></span>' +
                  '<span id="__cp_tog_thumb"></span>' +
                '</label>' +
              '</div>' +
              '<div class="__cp_divider"></div>' +
              '<div style="display:flex;align-items:center;justify-content:space-between">' +
                '<div style="display:flex;flex-direction:column;gap:2px">' +
                  '<span class="__cp_label">Tile mode</span>' +
                  '<span class="__cp_sub">Click tile to use as color source</span>' +
                '</div>' +
                '<button id="__cp_sel_tile_btn" class="__cp_btn __cp_btn_sm __cp_btn_secondary" style="flex-shrink:0">Select Tile</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div style="padding:0 12px 8px;flex-shrink:0">' +
            '<button id="__cp_startstop" class="__cp_btn __cp_btn_success" style="width:100%;font-weight:800">Start</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(rc);

    // Hide the 3 hotel header buttons (home / fullscreen / refresh)
    (function hideHotelHeader() {
      function tryHide() {
        const hdr = document.querySelector('header.fixed.top-0.z-50.p-2.float-left');
        if (hdr) { hdr.style.setProperty('display', 'none', 'important'); return true; }
        return false;
      }
      if (!tryHide()) {
        const iv = setInterval(() => { if (tryHide()) clearInterval(iv); }, 300);
        setTimeout(() => clearInterval(iv), 10000);
      }
    })();

    window.addEventListener('unhandledrejection', function(e) {
      if (e.reason && e.reason.name === 'AbortError') e.preventDefault();
    });

    (function killRadio() {
      function kill(audio) {
        try { audio.volume = 0; audio.muted = true; } catch(_) {}
        audio.style.setProperty('display', 'none', 'important');
      }
      function tryKill() {
        const audios = document.querySelectorAll('audio[src*="leet_radio"], audio[src*="leet.city"]');
        audios.forEach(kill);
        return audios.length > 0;
      }
      tryKill();
      // Keep killing in case React recreates the element
      const iv = setInterval(tryKill, 1000);
      setTimeout(() => clearInterval(iv), 30000);
    })();

    window.__ghk_makeDraggable(rc, rc.querySelector('#__rc_hdr'), '__ghk_cp_pos', e => e.target.id === '__rc_close');

    rc.querySelector('#__rc_close').addEventListener('click', ()=>{ rc.style.display='none'; });

    // ── COLOR PARTY ──
    const CP_COLORS       = { '6':'Red','5':'Green','1':'Pink','2':'Orange','3':'Blue','4':'Yellow','-1':'Rolling...','0':'Closed' };
    const CP_HEX          = { 'Red':'#e04040','Green':'#26c87a','Pink':'#e060c0','Orange':'#e88030','Blue':'#4488ee','Yellow':'#e8c030','White':'#c8cfd6','Rolling...':'#aaaaaa','Closed':'#888888' };
    const CP_DICE_TO_TILE = { 1:4, 2:2, 3:5, 4:1, 5:6, 6:3 };
    const CP_TILE_NAMES   = { 0:'White',1:'Yellow',2:'Orange',3:'Red',4:'Pink',5:'Blue',6:'Green' };

    let _cpEnabled      = false;
    let _cpDiceId       = null;
    let _cpTiles        = {};
    let _cpSelfIdx      = null;
    let _cpLastColor    = null;
    let _cpTileTargetId = null;
    let _cpSelectMode   = false;

    // Wire toggle switch
    const _togCheck = rc.querySelector('#__cp_autopos');
    const _togTrack = rc.querySelector('#__cp_tog_track');
    const _togThumb = rc.querySelector('#__cp_tog_thumb');
    if (_togCheck) _togCheck.addEventListener('change', function() {
      if (_togTrack) _togTrack.style.background = this.checked ? '#6C7CFF' : '#23252f';
      if (_togThumb) _togThumb.style.transform   = this.checked ? 'translateX(16px)' : '';
    });

    // Select Tile / Use Dice toggle button
    rc.querySelector('#__cp_sel_tile_btn').addEventListener('click', () => {
      const btn = rc.querySelector('#__cp_sel_tile_btn');
      if (_cpTileTargetId) {
        // Switch back to dice
        _cpTileTargetId = null; _cpSelectMode = false;
        if (btn) { btn.textContent = 'Select Tile'; btn.classList.remove('active'); }
        _cpUpdateSourceLabel();
      } else if (_cpSelectMode) {
        // Cancel selection
        _cpSelectMode = false;
        if (btn) { btn.textContent = 'Select Tile'; btn.classList.remove('active'); }
      } else {
        // Enter select mode
        _cpSelectMode = true;
        if (btn) { btn.textContent = 'Click a tile...'; btn.classList.add('active'); }
      }
    });

    // Start / Stop button
    rc.querySelector('#__cp_startstop').addEventListener('click', function() {
      _cpEnabled = !_cpEnabled;
      this.textContent = _cpEnabled ? 'Stop' : 'Start';
      this.className   = _cpEnabled ? '__cp_btn __cp_btn_danger' : '__cp_btn __cp_btn_success';
    });

    // Intercept OUT #355 (click/use object) to capture tile ID
    window.PacketStore.subscribe(function(p) {
      if (!_cpSelectMode || p.direction !== 'OUT' || p.header !== 355) return;
      try {
        const r = window.makeReader(p.raw);
        if (!r) return;
        _cpTileTargetId = String(r.int());
        _cpSelectMode   = false;
        const btn = rc.querySelector('#__cp_sel_tile_btn');
        if (btn) { btn.textContent = 'Use Dice'; btn.classList.remove('active'); }
        _cpUpdateSourceLabel();
      } catch(_) {}
    });

    function _cpSetStatus(text) {
      const el = rc.querySelector('#__cp_dice_status');
      if (el) el.textContent = text;
    }

    function _cpUpdateSourceLabel() {
      const srcLbl = rc.querySelector('#__cp_source_label');
      if (_cpTileTargetId) {
        if (srcLbl) srcLbl.textContent = 'Tile';
        _cpSetStatus('#' + _cpTileTargetId);
      } else if (_cpDiceId) {
        if (srcLbl) srcLbl.textContent = 'Dice';
        _cpSetStatus('#' + _cpDiceId);
      } else {
        if (srcLbl) srcLbl.textContent = 'Dice';
        _cpSetStatus('not found');
      }
    }

    function _cpSetColorFromTileState(state) {
      const label = CP_TILE_NAMES[state] || ('State: ' + state);
      const hex   = CP_HEX[label] || '#888';
      const card  = rc.querySelector('#__cp_color_card');
      const lbl   = rc.querySelector('#__cp_color_label');
      if (card) card.style.background = hex;
      if (lbl)  lbl.textContent = label;
      if (state >= 1 && state <= 6) { _cpLastColor = state; _cpWalk(state); }
      else _cpLastColor = null;
    }

    function _cpSetColor(value) {
      const label = CP_COLORS[String(value)] || ('Value: ' + value);
      const hex   = CP_HEX[label] || '#888';
      const card  = rc.querySelector('#__cp_color_card');
      const lbl   = rc.querySelector('#__cp_color_label');
      if (card) card.style.background = hex;
      if (lbl)  lbl.textContent       = label;
      const intVal   = parseInt(value);
      const tileState = CP_DICE_TO_TILE[intVal];
      if (tileState !== undefined) { _cpLastColor = tileState; _cpWalk(tileState); }
      else if (intVal === 0 || intVal === -1) _cpLastColor = null;
    }

    function _cpScan() {
      const items = Object.values((window.Room && window.Room.floorItems) || {});
      // Dice
      const dice = items.find(f => (f.furniName || '').toLowerCase().includes('kleur dobbel'));
      if (dice) {
        _cpDiceId = String(dice.id);
      } else {
        _cpDiceId = null;
      }
      _cpUpdateSourceLabel();
      // Color tiles (silent — no GUI)
      _cpTiles = {};
      items.forEach(f => {
        const n = (f.furniName || '').toLowerCase();
        if (n === 'kleurtegel' || n.startsWith('kleurtegel ')) {
          _cpTiles[String(f.id)] = { id: f.id, x: f.x, y: f.y, state: parseInt((f.stuff && f.stuff.state) || '0') };
        }
      });
    }

    function _cpFindSelf() {
      if (!window._selfName || !window.Room) return;
      const u = Object.values(window.Room.users).find(u => u.name === window._selfName);
      if (u) _cpSelfIdx = u.index;
    }

    function _cpBestPosition() {
      if (!_cpEnabled) return;
      const tiles = Object.values(_cpTiles);
      if (!tiles.length) return;
      const self = _cpSelfIdx !== null && window.Room && window.Room.users[_cpSelfIdx];
      // Pass 1: find max diversity (unique colors in Moore neighborhood)
      let maxUnique = 0;
      tiles.forEach(t => {
        const nearby = tiles.filter(o => Math.abs(o.x - t.x) <= 1 && Math.abs(o.y - t.y) <= 1);
        const u = new Set(nearby.map(o => o.state)).size;
        if (u > maxUnique) maxUnique = u;
      });
      // Pass 2: among tiles with max diversity, pick closest
      let bestTile = null, bestDist = Infinity;
      tiles.forEach(t => {
        const nearby = tiles.filter(o => Math.abs(o.x - t.x) <= 1 && Math.abs(o.y - t.y) <= 1);
        const u = new Set(nearby.map(o => o.state)).size;
        if (u < maxUnique) return;
        const dist = self ? Math.hypot(t.x - self.x, t.y - self.y) : 0;
        if (dist < bestDist) { bestDist = dist; bestTile = t; }
      });
      if (!bestTile) return;
      const delayEl = rc.querySelector('#__cp_delay');
      const delay   = delayEl ? Math.max(0, parseInt(delayEl.value) || 0) : 0;
      if (delay > 0) setTimeout(() => window.Game.walkTo(bestTile.x, bestTile.y), delay);
      else window.Game.walkTo(bestTile.x, bestTile.y);
    }

    function _cpWalk(colorValue) {
      if (!_cpEnabled) return;
      const matching = Object.values(_cpTiles).filter(t => t.state === colorValue);
      if (!matching.length) return;
      const self = _cpSelfIdx !== null && window.Room && window.Room.users[_cpSelfIdx];
      if (!self) return;
      let best = null, bestDist = Infinity;
      matching.forEach(t => {
        const d = Math.hypot(t.x - self.x, t.y - self.y);
        if (d < bestDist) { bestDist = d; best = t; }
      });
      if (!best) return;
      const delayEl = rc.querySelector('#__cp_delay');
      const delay   = delayEl ? Math.max(0, parseInt(delayEl.value) || 0) : 0;
      if (delay > 0) setTimeout(() => window.Game.walkTo(best.x, best.y), delay);
      else window.Game.walkTo(best.x, best.y);
    }

    function _updateCPInfo() {
      const nameEl = rc.querySelector('#__cp_uname');
      const posEl  = rc.querySelector('#__cp_upos');
      if (nameEl && window._selfName) nameEl.textContent = window._selfName;
      if (posEl && window._selfName && window.Room) {
        const u = Object.values(window.Room.users).find(u => u.name === window._selfName);
        if (u) { posEl.textContent = u.x + ', ' + u.y; }
      }
    }

    // Auto-detect when room objects arrive
    window.onPacket('Objects', () => { setTimeout(_cpScan, 50); setTimeout(_cpFindSelf, 100); setTimeout(_updateCPInfo, 150); });

    // Also catch self index when user list loads
    window.onPacket('Users',       () => { setTimeout(_cpFindSelf, 50); setTimeout(_updateCPInfo, 100); });
    window.onPacket('UserObject',  p => {
      _updateCPInfo();
    });
    window.onPacket('UserUpdate',  _updateCPInfo);

    // Bulk tile state updates — re-walk if field changes while color is active
    window.onPacket('ObjectsDataUpdate', p => {
      if (!p.raw) return;
      try {
        const r = window.makeReader(p.raw);
        if (!r) return;
        const count = r.int();
        for (let i = 0; i < count; i++) {
          const id = String(r.int());
          r.int();
          const state = parseInt(r.str());
          if (_cpTiles[id]) _cpTiles[id].state = state;
          if (_cpTileTargetId && id === _cpTileTargetId) _cpSetColorFromTileState(state);
        }
        const autoEl = rc.querySelector('#__cp_autopos');
        if (autoEl && autoEl.checked) _cpBestPosition();
      } catch(_) {}
    });

    // Reset on room change
    window.onPacket('RoomReady', () => {
      _cpEnabled = false;
      _cpDiceId = null; _cpTiles = {}; _cpSelfIdx = null; _cpLastColor = null;
      _cpTileTargetId = null; _cpSelectMode = false;
      const ssBtn = rc.querySelector('#__cp_startstop');
      if (ssBtn) { ssBtn.textContent = 'Start'; ssBtn.className = '__cp_btn __cp_btn_success'; }
      const btn = rc.querySelector('#__cp_sel_tile_btn');
      if (btn) { btn.textContent = 'Select Tile'; btn.classList.remove('active'); }
      _cpUpdateSourceLabel();
      const card = rc.querySelector('#__cp_color_card');
      const lbl  = rc.querySelector('#__cp_color_label');
      if (card) card.style.background = '#3a3d4a';
      if (lbl)  lbl.textContent = '';
    });

    // Dice / tile target update
    window.onPacket('ObjectDataUpdate', p => {
      if (!p.raw) return;
      try {
        const r = window.makeReader(p.raw);
        if (!r) return;
        const objId = r.str();
        r.int();
        const value = r.str();
        if (_cpDiceId && objId === _cpDiceId && !_cpTileTargetId) _cpSetColor(value);
        if (_cpTileTargetId && objId === _cpTileTargetId) _cpSetColorFromTileState(parseInt(value));
      } catch(_) {}
    });

    // Initial scan
    _cpScan();
    _cpFindSelf();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(buildRoomCopyPanel); }); else window.__ghk_ready(buildRoomCopyPanel);
})();
