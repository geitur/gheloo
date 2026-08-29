(function() {
  function buildBingoPanel() {
    const style = document.createElement('style');
    style.textContent = [
      '#__bg{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__bg *{box-sizing:border-box}',
      '.__bg_card_outer{background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb;display:flex;flex-direction:column}',
      '.__bg_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__bg_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}',
      '.__bg_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__bg_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__bg_close:hover{color:#eceefb}',
      '#__bg_status_card{border-radius:10px;background:#3a3d4a;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}',
      '#__bg_host_label{font-size:24px;font-weight:800;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,0.3);line-height:1}',
      '.__bg_own_label{font-size:14px;font-weight:700;color:rgba(255,255,255,0.9);line-height:1}',
      '.__bg_own_row{display:flex;align-items:center;gap:6px}',
      '.__bg_own_row .__bg_label{color:rgba(255,255,255,0.6)}',
      // Host and Own are visually distinct cards (own accented, since it's the one that
      // rolls) instead of two rows sharing one box with a divider between them.
      '.__bg_card{background:#1c1e2a;border-radius:8px;padding:8px 12px;border:1px solid #23252f}',
      '.__bg_card_own{border-color:rgba(108,124,255,0.25)}',
      '.__bg_card_hdr{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#6C7CFF;margin-bottom:6px}',
      '.__bg_label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#5c5e6b}',
      '.__bg_btn{border:none;border-radius:8px;font-size:11px;font-weight:600;padding:6px 10px;cursor:pointer}',
      '.__bg_btn_sm{font-size:9px;padding:2px 8px}',
      '.__bg_btn_secondary{background:#1c1e2a;color:#82849a;border:1px solid #23252f}',
      '.__bg_btn_secondary:hover{color:#eceefb}',
      '.__bg_btn_secondary.active{background:rgba(108,124,255,0.16);color:#A6B0FF;border-color:#6C7CFF}',
      '.__bg_btn_success{background:#A6B0FF;color:#0A0B10}',
      '.__bg_btn_success:hover{filter:brightness(1.08)}',
      '.__bg_btn_danger{background:rgba(231,76,60,0.15);color:#e74c3c}',
      '.__bg_btn_danger:hover{background:rgba(231,76,60,0.28)}',
    ].join('');
    document.head.appendChild(style);

    const bg = document.createElement('div');
    bg.id = '__bg';
    bg.style.cssText = 'position:fixed;top:16px;right:16px;width:300px;z-index:1000;user-select:none;display:none';
    bg.innerHTML =
      '<div class="__bg_card_outer">' +
        '<div class="__bg_hdr" id="__bg_hdr">' +
          '<span class="__bg_eyebrow">Gheloo</span>' +
          '<span class="__bg_title">Bingo</span>' +
          '<span class="__bg_close" id="__bg_close">&times;</span>' +
        '</div>' +
        '<div id="__bg_main" style="box-sizing:border-box;display:flex;flex-direction:column;padding:0">' +
          '<div style="flex:1;overflow:hidden;padding:8px 12px;display:flex;flex-direction:column;gap:8px">' +
            '<div id="__bg_status_card">' +
              '<div style="display:flex;flex-direction:column;gap:3px">' +
                '<span class="__bg_label" style="color:rgba(255,255,255,0.7)">Host</span>' +
                '<span id="__bg_host_label">—</span>' +
              '</div>' +
              '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">' +
                '<span class="__bg_label" style="color:rgba(255,255,255,0.7)">Own</span>' +
                '<div class="__bg_own_row"><span class="__bg_label">1</span><span id="__bg_own_label_1" class="__bg_own_label">—</span></div>' +
                '<div class="__bg_own_row"><span class="__bg_label">2</span><span id="__bg_own_label_2" class="__bg_own_label">—</span></div>' +
              '</div>' +
            '</div>' +
            '<div class="__bg_card">' +
              '<div class="__bg_card_hdr">Host</div>' +
              '<div style="display:flex;align-items:center;justify-content:space-between">' +
                '<div style="display:flex;flex-direction:column;gap:2px">' +
                  '<span class="__bg_label">Host dice</span>' +
                  '<span id="__bg_host_id" style="font-size:9px;color:#82849a;font-family:monospace">not set</span>' +
                '</div>' +
                '<button id="__bg_sel_host_btn" class="__bg_btn __bg_btn_sm __bg_btn_secondary" style="flex-shrink:0">Select Host Dice</button>' +
              '</div>' +
            '</div>' +
            '<div class="__bg_card __bg_card_own">' +
              '<div class="__bg_card_hdr">Own 1</div>' +
              '<div style="display:flex;align-items:center;justify-content:space-between">' +
                '<div style="display:flex;flex-direction:column;gap:2px">' +
                  '<span class="__bg_label">Own dice 1</span>' +
                  '<span id="__bg_own_id_1" style="font-size:9px;color:#82849a;font-family:monospace">not set</span>' +
                '</div>' +
                '<button id="__bg_sel_own_btn_1" class="__bg_btn __bg_btn_sm __bg_btn_secondary" style="flex-shrink:0">Select Own Dice</button>' +
              '</div>' +
            '</div>' +
            '<div class="__bg_card __bg_card_own">' +
              '<div class="__bg_card_hdr">Own 2</div>' +
              '<div style="display:flex;align-items:center;justify-content:space-between">' +
                '<div style="display:flex;flex-direction:column;gap:2px">' +
                  '<span class="__bg_label">Own dice 2</span>' +
                  '<span id="__bg_own_id_2" style="font-size:9px;color:#82849a;font-family:monospace">not set</span>' +
                '</div>' +
                '<button id="__bg_sel_own_btn_2" class="__bg_btn __bg_btn_sm __bg_btn_secondary" style="flex-shrink:0">Select Own Dice</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div style="padding:0 12px 8px;flex-shrink:0">' +
            '<button id="__bg_startstop" class="__bg_btn __bg_btn_success" style="width:100%;font-weight:800">Start</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(bg);

    window.__ghk_makeDraggable(bg, bg.querySelector('#__bg_hdr'), '__ghk_bg_pos', e => e.target.id === '__bg_close');
    bg.querySelector('#__bg_close').addEventListener('click', () => { bg.style.display = 'none'; });

    // ── BINGO ── two own dice can run at once. Every ThrowDice send (either dice) goes
    // through _bgRoll, which enforces a shared _bgRollGapMs cooldown so the two dice's
    // packets never land back-to-back and trip the server's rate limit.
    const _bgRollGapMs  = 400;
    let _bgEnabled       = false;
    let _bgHostId        = null; // string furni id
    let _bgHostRaw       = null; // last raw state string from the host dice: '-1' | '0' | '1'..'6' | null
    let _bgHostTarget    = null; // parsed 1-6 number, or null when there's no live call
    let _bgSelectTarget  = null; // 'host' | 'own1' | 'own2' | null — which button is waiting for a click
    let _bgLastRollAt    = 0;    // Date.now() of the most recently scheduled roll send (reserved slot)
    const _bgOwn = [
      { id: null, raw: null, pending: false }, // own dice 1
      { id: null, raw: null, pending: false }, // own dice 2
    ];

    function _bgSetHostIdUI() {
      const el = bg.querySelector('#__bg_host_id');
      if (el) el.textContent = _bgHostId ? '#' + _bgHostId : 'not set';
    }
    function _bgSetOwnIdUI(idx) {
      const el = bg.querySelector('#__bg_own_id_' + (idx + 1));
      if (el) el.textContent = _bgOwn[idx].id ? '#' + _bgOwn[idx].id : 'not set';
    }
    function _bgUpdateSelectButtons() {
      const hostBtn = bg.querySelector('#__bg_sel_host_btn');
      const own1Btn = bg.querySelector('#__bg_sel_own_btn_1');
      const own2Btn = bg.querySelector('#__bg_sel_own_btn_2');
      if (hostBtn) {
        hostBtn.textContent = _bgSelectTarget === 'host' ? 'Click a dice…' : 'Select Host Dice';
        hostBtn.classList.toggle('active', _bgSelectTarget === 'host');
      }
      if (own1Btn) {
        own1Btn.textContent = _bgSelectTarget === 'own1' ? 'Click a dice…' : 'Select Own Dice';
        own1Btn.classList.toggle('active', _bgSelectTarget === 'own1');
      }
      if (own2Btn) {
        own2Btn.textContent = _bgSelectTarget === 'own2' ? 'Click a dice…' : 'Select Own Dice';
        own2Btn.classList.toggle('active', _bgSelectTarget === 'own2');
      }
    }

    bg.querySelector('#__bg_sel_host_btn').addEventListener('click', () => {
      _bgSelectTarget = _bgSelectTarget === 'host' ? null : 'host';
      _bgUpdateSelectButtons();
    });
    bg.querySelector('#__bg_sel_own_btn_1').addEventListener('click', () => {
      _bgSelectTarget = _bgSelectTarget === 'own1' ? null : 'own1';
      _bgUpdateSelectButtons();
    });
    bg.querySelector('#__bg_sel_own_btn_2').addEventListener('click', () => {
      _bgSelectTarget = _bgSelectTarget === 'own2' ? null : 'own2';
      _bgUpdateSelectButtons();
    });

    // Intercept OUT #355 (click/use object) to capture whichever dice gets clicked next,
    // same mechanism Color Party uses for its "Select Tile" button.
    window.PacketStore.subscribe(function(p) {
      if (!_bgSelectTarget || p.direction !== 'OUT' || p.header !== 355) return;
      try {
        const r = window.makeReader(p.raw);
        if (!r) return;
        const id = String(r.int());
        if (_bgSelectTarget === 'host') {
          _bgHostId = id; _bgSetHostIdUI();
        } else {
          const idx = _bgSelectTarget === 'own1' ? 0 : 1;
          _bgOwn[idx].id = id; _bgSetOwnIdUI(idx);
        }
        _bgSelectTarget = null;
        _bgUpdateSelectButtons();
      } catch(_) {}
    });

    function _bgLabelForRaw(raw) {
      if (raw === null) return '—';
      if (raw === '-1') return 'Rolling…';
      if (raw === '0') return 'Closed';
      return raw;
    }
    function _bgSetHostUI() {
      const el = bg.querySelector('#__bg_host_label');
      if (el) el.textContent = _bgLabelForRaw(_bgHostRaw);
    }
    function _bgSetOwnUI(idx) {
      const el = bg.querySelector('#__bg_own_label_' + (idx + 1));
      if (el) el.textContent = _bgLabelForRaw(_bgOwn[idx].raw);
    }

    // OUT 1990 (ThrowDiceMessageComposer) is the actual roll action — confirmed via a real
    // capture. OUT 355 (used for selection) only clicks/targets a dice, it doesn't roll it.
    // Sends are staggered through _bgLastRollAt so two dice rolling around the same instant
    // (e.g. both starting cold, or both reacting to a new host target) still land >=_bgRollGapMs
    // apart — the server enforces a per-account cooldown between ThrowDice packets.
    function _bgRoll(idx) {
      const slot = _bgOwn[idx];
      if (!slot.id) return;
      slot.pending = true;
      const now = Date.now();
      const waitFor = Math.max(0, _bgLastRollAt + _bgRollGapMs - now);
      _bgLastRollAt = now + waitFor;
      setTimeout(() => {
        window.sendPacket('OUT', 1990, '{i:' + slot.id + '}');
      }, waitFor);
    }

    // Central decision point, called after every relevant state change. Instantly re-rolls
    // on a mismatch (no delay) — the server's own roll animation (state passes through '-1'
    // before settling) is what naturally paces this, since we only act on a settled value.
    // While the host dice itself shows '-1' (mid-roll, no target yet), we start rolling own
    // dice already instead of waiting idle for the host to settle — head start on the match.
    function _bgMaybeRoll(idx) {
      const slot = _bgOwn[idx];
      if (!_bgEnabled || !slot.id || slot.pending) return;
      if (slot.raw === '-1') return; // still mid-roll, wait for it to settle
      if (_bgHostTarget === null) {
        if (_bgHostRaw !== '-1') return; // no live call and host isn't rolling — nothing to do
      } else {
        const ownNum = /^[1-6]$/.test(slot.raw || '') ? parseInt(slot.raw) : null;
        if (ownNum === _bgHostTarget) return; // matched — stop
      }
      _bgRoll(idx);
    }
    function _bgMaybeRollAll() { _bgMaybeRoll(0); _bgMaybeRoll(1); }

    bg.querySelector('#__bg_startstop').addEventListener('click', function() {
      _bgEnabled = !_bgEnabled;
      this.textContent = _bgEnabled ? 'Stop' : 'Start';
      this.className = _bgEnabled ? '__bg_btn __bg_btn_danger' : '__bg_btn __bg_btn_success';
      if (_bgEnabled) {
        _bgSelectTarget = null;
        _bgUpdateSelectButtons();
        _bgMaybeRoll(0);
        setTimeout(() => _bgMaybeRoll(1), 800); // dice 2's first attempt always waits 800ms after Start
      }
    });

    window.onPacket('ObjectDataUpdate', p => {
      if (!p.parsed) return;
      const id = String(p.parsed.id);
      if (_bgHostId && id === _bgHostId) {
        _bgHostRaw = p.parsed.state;
        _bgHostTarget = /^[1-6]$/.test(_bgHostRaw || '') ? parseInt(_bgHostRaw) : null;
        _bgSetHostUI();
        _bgMaybeRollAll();
      }
      _bgOwn.forEach((slot, idx) => {
        if (slot.id && id === slot.id) {
          slot.pending = false;
          slot.raw = p.parsed.state;
          _bgSetOwnUI(idx);
          _bgMaybeRoll(idx);
        }
      });
    });

    window.__ghk_bgOwnIds = () => _bgOwn.map(s => s.id).filter(Boolean);

    // Reset on room change, same pattern as Color Party.
    window.onPacket('RoomReady', () => {
      _bgEnabled = false;
      _bgHostId = null;
      _bgHostRaw = null; _bgHostTarget = null;
      _bgOwn.forEach(slot => { slot.id = null; slot.raw = null; slot.pending = false; });
      _bgSelectTarget = null;
      _bgLastRollAt = 0;
      const ssBtn = bg.querySelector('#__bg_startstop');
      if (ssBtn) { ssBtn.textContent = 'Start'; ssBtn.className = '__bg_btn __bg_btn_success'; }
      _bgSetHostUI(); _bgSetOwnUI(0); _bgSetOwnUI(1);
      _bgSetHostIdUI(); _bgSetOwnIdUI(0); _bgSetOwnIdUI(1);
      _bgUpdateSelectButtons();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(buildBingoPanel); }); else window.__ghk_ready(buildBingoPanel);
})();
