(function() {
  if (document.getElementById('__or_panel')) return;

  // Same self-hosted Postgres + PostgREST userlogger project user-database.js reads from
  // — picks a random outfit out of everyone that's actually been seen/scanned, same pool
  // the old dice button (formerly in user-database.js's header) drew from. Moved out into
  // its own tool per extensions/README.md's "one extension = one concern" rule instead of
  // living bolted onto the User Database panel's header.
  const SUPABASE_URL      = 'https://userlogger.databin.uk';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6ImdoZWxvby1zZWxmaG9zdCIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwfQ.9uAMhqRJOL-m_xtTO5duAUOAw-4pKk4LEENcT47crXU';
  const HEADERS = { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY };

  function _log(msg) { console.log('[OutfitRandomizer]', msg); }

  function _outId(name) {
    if (!window.PKT || !window.PKT.OUT) return null;
    for (const id in window.PKT.OUT) {
      if (window.shortName(window.PKT.OUT[id], 'OUT') === name) return parseInt(id);
    }
    return null;
  }

  // ── Logged-outfit pool ─────────────────────────────────────────────────────────────
  let _pool = null; // [{figure, gender}] once loaded, deduped by figure string
  let _poolLoading = false;

  async function _ensurePool() {
    if (_pool || _poolLoading) return;
    _poolLoading = true;
    _setStatus('Looks laden…');
    try {
      // Single big page — this is a random-sample pool, not a "must have every row"
      // listing, so one large limit is enough; no need for user-database.js's full
      // keyset pagination here.
      const res = await fetch(
        SUPABASE_URL + '/rest/v1/users?select=figure,gender&figure=not.is.null&limit=20000',
        { headers: HEADERS }
      );
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const rows = await res.json();
      // Dedup by the exact figure string — an outfit 500 different accounts happen to
      // wear would otherwise be 500x more likely to get picked than one only one
      // account ever had, and it'd show up in the pool 500 times over for no reason.
      const seen = new Set();
      _pool = [];
      rows.forEach(function(r) {
        if (!r.figure || seen.has(r.figure)) return;
        seen.add(r.figure);
        _pool.push(r);
      });
      _setStatus(_pool.length.toLocaleString('nl-BE') + ' unieke looks geladen.');
    } catch (e) {
      _log('pool load failed: ' + e.message);
      _setStatus('Fout bij laden: ' + e.message);
    } finally {
      _poolLoading = false;
    }
  }

  function _pickLook() {
    if (!_pool || !_pool.length) return null;
    const r = _pool[Math.floor(Math.random() * _pool.length)];
    return { figure: r.figure, gender: (r.gender || 'M').toUpperCase() };
  }

  // ── Wear + cooldown ──────────────────────────────────────────────────────────────
  const WEAR_COOLDOWN_MS = 16000;
  let _wearCooldownUntil = 0;

  function _wearFigure(figure, gender) {
    if (!figure) return;
    const now = Date.now();
    if (now < _wearCooldownUntil) {
      _setStatus('Wacht ' + Math.ceil((_wearCooldownUntil - now) / 1000) + 's…');
      return;
    }
    const fid = _outId('UpdateFigureData');
    if (fid === null) {
      _log('UpdateFigureData not found in PKT — is the game connected?');
      _setStatus('Niet verbonden — open het spel eerst.');
      return;
    }
    const g = (gender || 'M').toUpperCase();
    window.sendPacket('OUT', fid, '{s:"' + g + '"}{s:"' + figure.replace(/"/g, '\\"') + '"}');
    _wearCooldownUntil = now + WEAR_COOLDOWN_MS;
    _startCooldownRing();
    _setStatus('Outfit toegepast.');
    setTimeout(function() { if (_statusEl && _statusEl.textContent === 'Outfit toegepast.') _statusEl.textContent = ''; }, 2000);
  }

  const RING_CIRCUMFERENCE = 2 * Math.PI * 9;
  function _startCooldownRing() {
    const ring = panel && panel.querySelector('#__or_ring_circle');
    if (!ring) return;
    ring.style.transition = 'none';
    ring.style.strokeDashoffset = '0';
    ring.style.opacity = '1';
    void ring.getBoundingClientRect();
    ring.style.transition = 'stroke-dashoffset ' + WEAR_COOLDOWN_MS + 'ms linear, opacity 300ms linear ' + (WEAR_COOLDOWN_MS - 300) + 'ms';
    ring.style.strokeDashoffset = String(RING_CIRCUMFERENCE);
    ring.style.opacity = '0';
  }

  // ── Core actions ─────────────────────────────────────────────────────────────────
  async function _rollAndWear() {
    await _ensurePool();
    const pick = _pickLook();
    if (!pick) { _setStatus(_pool && !_pool.length ? 'Geen looks gevonden.' : 'Nog aan het laden…'); return; }
    _wearFigure(pick.figure, pick.gender);
  }

  let _autoTimer = null;
  function _toggleAuto() {
    const btn = panel.querySelector('#__or_auto_btn');
    if (_autoTimer) {
      clearInterval(_autoTimer);
      _autoTimer = null;
      // Same flag core/supabase.js's own-account logging checks (name kept from when
      // this lived in user-database.js) — while auto-cycling, your OWN outfit changes
      // constantly, and without this it'd spam your own users row with every random
      // pick instead of your real logged history.
      window.__udb_autoRandomActive = false;
      if (btn) { btn.classList.remove('active'); btn.title = 'Elke ' + (WEAR_COOLDOWN_MS / 1000) + 's automatisch een nieuwe look'; }
      return;
    }
    window.__udb_autoRandomActive = true;
    _rollAndWear();
    _autoTimer = setInterval(_rollAndWear, WEAR_COOLDOWN_MS);
    if (btn) { btn.classList.add('active'); btn.title = 'Stop automatisch wisselen'; }
  }

  // ── UI ───────────────────────────────────────────────────────────────────────────
  let panel = null;
  let _statusEl = null;
  function _setStatus(text) { if (_statusEl) _statusEl.textContent = text || ''; }

  const _ICON_DICE =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<rect x="3" y="3" width="18" height="18" rx="3"/>'
    + '<circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none"/>'
    + '<circle cx="16" cy="8" r="1.2" fill="currentColor" stroke="none"/>'
    + '<circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>'
    + '<circle cx="8" cy="16" r="1.2" fill="currentColor" stroke="none"/>'
    + '<circle cx="16" cy="16" r="1.2" fill="currentColor" stroke="none"/>'
    + '</svg>';
  const _ICON_REPEAT =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>'
    + '<polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>'
    + '</svg>';

  function injectStyle() {
    const style = document.createElement('style');
    style.textContent = [
      '#__or_panel{position:fixed;top:16px;right:16px;width:220px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__or_panel *{box-sizing:border-box}',
      '.__or_card{display:flex;flex-direction:column;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb}',
      '.__or_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__or_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}',
      '.__or_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__or_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__or_close:hover{color:#eceefb}',
      '.__or_actions{display:flex;align-items:center;gap:10px;justify-content:center;padding:16px 14px 4px}',
      '.__or_random_wrap{position:relative;display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;flex-shrink:0}',
      '.__or_roll_btn{all:unset;box-sizing:border-box;width:100%;height:100%;border-radius:50%;background:#A6B0FF;color:#0A0B10;display:flex;align-items:center;justify-content:center;cursor:pointer}',
      '.__or_roll_btn:hover{filter:brightness(1.08)}',
      '.__or_ring{position:absolute;top:-3px;left:-3px;width:54px;height:54px;pointer-events:none;transform:rotate(-90deg)}',
      '.__or_ring circle{fill:none;stroke:#2ecc71;stroke-width:2;stroke-dasharray:56.549;stroke-dashoffset:56.549;opacity:0}',
      '.__or_auto_btn{all:unset;box-sizing:border-box;width:36px;height:36px;border-radius:50%;background:#1c1e2a;border:1px solid #23252f;color:#82849a;display:flex;align-items:center;justify-content:center;cursor:pointer}',
      '.__or_auto_btn:hover{color:#eceefb}',
      '.__or_auto_btn.active{color:#2ecc71;border-color:#2ecc71}',
      '#__or_status{padding:10px 14px 14px;font-size:10px;color:#A6B0FF;font-family:monospace;min-height:14px;text-align:center}',
    ].join('');
    document.head.appendChild(style);
  }

  function buildPanel() {
    injectStyle();
    panel = document.createElement('div');
    panel.id = '__or_panel';
    panel.innerHTML =
      '<div class="__or_card">'
      + '<div class="__or_hdr" id="__or_hdr">'
      + '<span class="__or_eyebrow">Gheloo</span>'
      + '<span class="__or_title">Outfit Randomizer</span>'
      + '<span class="__or_close" id="__or_close">&times;</span>'
      + '</div>'
      + '<div class="__or_actions">'
      + '<button class="__or_auto_btn" id="__or_auto_btn" title="Elke ' + (WEAR_COOLDOWN_MS / 1000) + 's automatisch een nieuwe look">' + _ICON_REPEAT + '</button>'
      + '<span class="__or_random_wrap">'
      + '<svg class="__or_ring" viewBox="0 0 24 24"><circle id="__or_ring_circle" cx="12" cy="12" r="9"/></svg>'
      + '<button class="__or_roll_btn" id="__or_roll_btn" title="Nieuwe willekeurige outfit">' + _ICON_DICE + '</button>'
      + '</span>'
      + '<span style="width:36px"></span>'
      + '</div>'
      + '<div id="__or_status"></div>'
      + '</div>';
    document.body.appendChild(panel);
    panel.style.display = 'none';
    _statusEl = panel.querySelector('#__or_status');

    window.__ghk_makeDraggable(panel, panel.querySelector('#__or_hdr'), '__ghk_or_pos', function(e) {
      return e.target.id === '__or_close';
    });
    panel.querySelector('#__or_close').addEventListener('click', function() { panel.style.display = 'none'; });

    panel.querySelector('#__or_roll_btn').addEventListener('click', function() { _rollAndWear(); });
    panel.querySelector('#__or_auto_btn').addEventListener('click', function() { _toggleAuto(); });

    _ensurePool();
  }

  function init() {
    buildPanel();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(init); });
  } else {
    window.__ghk_ready(init);
  }
})();
