(function() {
  if (document.getElementById('__userdb')) return;

  const SUPABASE_URL      = 'https://qwcfsqsrtegyvvwkzcgb.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_mi9rS5i9a-xrAWC0lG0TNA_vg903xRL';
  const HEADERS = {
    'apikey':        SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
  };

  let _all = [];
  let _selId = null;
  let _loaded = false;
  let _loading = false;

  function _esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function _log(msg) { console.log('[UserDatabase]', msg); }

  // Plain monochrome SVG icons (inherit currentColor) instead of emoji glyphs — emoji
  // render as colorful platform-specific pictures that clash with the rest of the UI.
  const _ICON_DICE =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<rect x="3" y="3" width="18" height="18" rx="3"/>'
    + '<circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none"/>'
    + '<circle cx="16" cy="8" r="1.2" fill="currentColor" stroke="none"/>'
    + '<circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>'
    + '<circle cx="8" cy="16" r="1.2" fill="currentColor" stroke="none"/>'
    + '<circle cx="16" cy="16" r="1.2" fill="currentColor" stroke="none"/>'
    + '</svg>';
  const _ICON_REPEAT =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>'
    + '<polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>'
    + '</svg>';
  const _ICON_SEARCH =
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">'
    + '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'
    + '</svg>';
  const _ICON_PERSON =
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'
    + '</svg>';

  // previous_figure_ids are now references into a shared `figures` table (dedup —
  // see core/supabase.js) instead of full outfit strings, so rendering "previous
  // outfits" needs to resolve ids back to text. Cached since the same figure id often
  // shows up across many different users.
  const _figureCache = new Map();
  async function _resolveFigureIds(ids) {
    const missing = ids.filter(function(id) { return !_figureCache.has(id); });
    if (!missing.length) return;
    try {
      const res = await fetch(
        SUPABASE_URL + '/rest/v1/figures?id=in.(' + missing.join(',') + ')&select=id,figure',
        { headers: HEADERS }
      );
      if (res.ok) {
        const rows = await res.json();
        rows.forEach(function(r) { _figureCache.set(r.id, r.figure); });
      }
    } catch (e) {
      _log('figure resolve failed: ' + e.message);
    }
  }

  function avatarHead(figure) {
    return 'https://www.leet.city/leet-imaging/avatarimage'
      + '?figure=' + encodeURIComponent(figure || '')
      + '&direction=2&head_direction=3&size=m&gesture=sml&headonly=1&action=wav&img_format=png';
  }
  function avatarLarge(figure) {
    return 'https://www.leet.city/leet-imaging/avatarimage'
      + '?figure=' + encodeURIComponent(figure || '')
      + '&direction=3&head_direction=3&size=l&gesture=std&img_format=png';
  }
  function avatarMini(figure) {
    return 'https://www.leet.city/leet-imaging/avatarimage'
      + '?figure=' + encodeURIComponent(figure || '')
      + '&direction=3&head_direction=3&size=l&gesture=std&img_format=png';
  }

  function ts(s) {
    if (!s) return '—';
    const d = new Date(s);
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
      + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  // ── Outgoing packet lookup (same pattern as extensions/photo-library.js's _outId) ──
  function _outId(name) {
    if (!window.PKT || !window.PKT.OUT) return null;
    for (const id in window.PKT.OUT) {
      if (window.shortName(window.PKT.OUT[id], 'OUT') === name) return parseInt(id);
    }
    return null;
  }

  // Wearing an outfit has a real server-side cooldown — throttle client-side too so
  // spam-clicking the dice/avatar/thumbnails can't queue up requests the server would
  // just reject anyway. Shared across every wear entry point (dice, main avatar,
  // previous-outfit thumbnails), not just the dice button.
  const WEAR_COOLDOWN_MS = 6000;
  let _wearCooldownUntil = 0;

  // Same UpdateFigureData packet ws.js's :steal command already sends — applies a
  // figure to your own avatar directly, no chrome.tabs cross-tab messaging needed since
  // this panel already runs inside the game page.
  function _wearFigure(figure, gender, statusEl, opts) {
    opts = opts || {};
    if (!figure) return;
    const now = Date.now();
    if (now < _wearCooldownUntil) {
      if (statusEl && !opts.silent) statusEl.textContent = 'Wait ' + Math.ceil((_wearCooldownUntil - now) / 1000) + 's…';
      return;
    }
    const fid = _outId('UpdateFigureData');
    if (fid === null) {
      _log('UpdateFigureData not found in PKT — is the game connected?');
      if (statusEl) statusEl.textContent = 'Not connected — open the game first.';
      return;
    }
    const g = (gender || 'M').toUpperCase();
    window.sendPacket('OUT', fid, '{s:"' + g + '"}{s:"' + figure.replace(/"/g, '\\"') + '"}');
    _wearCooldownUntil = now + WEAR_COOLDOWN_MS;
    _startWearCooldownRing();
    if (statusEl && !opts.silent) {
      statusEl.textContent = 'Outfit applied.';
      setTimeout(function() { if (statusEl.textContent === 'Outfit applied.') statusEl.textContent = ''; }, 2000);
    }
  }

  const WEAR_RING_CIRCUMFERENCE = 2 * Math.PI * 9;
  function _startWearCooldownRing() {
    const ring = panel && panel.querySelector('#__udb_random_ring_circle');
    if (!ring) return;
    ring.style.transition = 'none';
    ring.style.strokeDashoffset = '0';
    ring.style.opacity = '1';
    void ring.getBoundingClientRect(); // force reflow so the transition below re-triggers
    ring.style.transition = 'stroke-dashoffset ' + WEAR_COOLDOWN_MS + 'ms linear, opacity 300ms linear ' + (WEAR_COOLDOWN_MS - 300) + 'ms';
    ring.style.strokeDashoffset = String(WEAR_RING_CIRCUMFERENCE);
    ring.style.opacity = '0';
  }

  // Picks a random figure out of every logged user's current + previous outfits, then
  // wears it the same way clicking an avatar/thumbnail does.
  async function _randomOutfit() {
    const btn      = panel.querySelector('#__udb_random_btn');
    const statusEl = panel.querySelector('#__udb_scan_status');
    if (btn) btn.disabled = true;
    if (statusEl) statusEl.textContent = 'Picking a random outfit…';
    await _ensureLoadedAsync();

    // Dedup by outfit identity before picking — otherwise an outfit 500 different
    // accounts wear would be 500x more likely to get picked than one only 1 account
    // ever had. Current figures dedupe by their text (same string = same outfit);
    // previous_figure_ids already dedupe by figures-table id. previous_figures (old,
    // frozen text array) isn't read here — no longer gets new entries since the dedup
    // migration.
    const byKey = new Map();
    _all.forEach(function(u) {
      if (u.figure && !byKey.has(u.figure)) byKey.set(u.figure, { figure: u.figure, gender: u.gender });
      (u.previous_figure_ids || []).forEach(function(id) {
        const key = 'id:' + id;
        if (!byKey.has(key)) byKey.set(key, { figureId: id, gender: u.gender });
      });
    });
    const pool = Array.from(byKey.values());
    if (!pool.length) {
      if (btn) btn.disabled = false;
      if (statusEl) statusEl.textContent = 'No outfits logged yet.';
      return;
    }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    let figure = pick.figure;
    if (!figure && pick.figureId != null) {
      await _resolveFigureIds([pick.figureId]);
      figure = _figureCache.get(pick.figureId);
    }
    if (btn) btn.disabled = false;
    if (!figure) { if (statusEl) statusEl.textContent = 'Could not resolve that outfit, try again.'; return; }
    // Silent — the cooldown ring around the dice is the feedback, not status text.
    _wearFigure(figure, pick.gender, statusEl, { silent: true });
    if (statusEl && statusEl.textContent === 'Picking a random outfit…') statusEl.textContent = '';
  }

  // Auto-random toggle: re-rolls a new random outfit every WEAR_COOLDOWN_MS, i.e. as
  // often as the wear cooldown actually allows.
  let _autoRandomTimer = null;
  function _toggleAutoRandom() {
    const btn = panel.querySelector('#__udb_random_auto_btn');
    if (_autoRandomTimer) {
      clearInterval(_autoRandomTimer);
      _autoRandomTimer = null;
      window.__udb_autoRandomActive = false;
      if (btn) { btn.classList.remove('active'); btn.title = 'Auto-wear a random outfit every 6s'; }
      return;
    }
    window.__udb_autoRandomActive = true;
    _randomOutfit();
    _autoRandomTimer = setInterval(_randomOutfit, WEAR_COOLDOWN_MS);
    if (btn) { btn.classList.add('active'); btn.title = 'Stop auto-wearing random outfits'; }
  }

  // ── Data ─────────────────────────────────────────────────────────────────────────
  // Paginated so we're never capped by Supabase's server-side db-max-rows setting
  // (which can silently truncate any single response below whatever limit we ask for).
  // Requesting a bigger page is safe as long as we detect the real end via Content-Range's
  // total count instead of comparing the returned page length to our own PAGE_SIZE — if
  // db-max-rows caps a response lower than PAGE_SIZE, every page would come back short
  // and a length-based check would (wrongly) stop after the first page.
  const PAGE_SIZE = 10000;

  async function _loadUsers() {
    if (_loading) return;
    _loading = true;
    const countEl = panel && panel.querySelector('#__udb_count');
    if (countEl) countEl.textContent = 'Loading…';
    try {
      let all = [];
      let offset = 0;
      for (;;) {
        const res = await fetch(
          SUPABASE_URL + '/rest/v1/users?select=*&type=eq.1&order=last_seen.desc&limit=' + PAGE_SIZE + '&offset=' + offset,
          { headers: Object.assign({}, HEADERS, { 'Prefer': 'count=exact' }) }
        );
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const page = await res.json();
        all = all.concat(page);
        if (countEl) countEl.textContent = 'Loading… (' + all.length + ')';
        if (!page.length) break;

        const range = res.headers.get('content-range') || '';
        const totalMatch = /\/(\d+)$/.exec(range);
        const endMatch   = /^(\d+)-(\d+)\//.exec(range);
        if (totalMatch && endMatch) {
          const total = parseInt(totalMatch[1], 10);
          const end   = parseInt(endMatch[2], 10);
          if (end >= total - 1) break;
          offset = end + 1;
        } else {
          // No usable total (shouldn't happen with count=exact) — fall back to the old
          // length-based check.
          if (page.length < PAGE_SIZE) break;
          offset += page.length;
        }
      }
      _all = all;
      _loaded = true;
      _applyFilters();
      _renderNameChanges();
    } catch (e) {
      if (countEl) countEl.textContent = 'Error: ' + e.message;
      _log('load failed: ' + e.message);
    } finally {
      _loading = false;
    }
  }

  async function _ensureLoadedAsync() {
    if (_loaded) return;
    if (!_loading) { await _loadUsers(); return; }
    while (_loading) await new Promise(function(r) { setTimeout(r, 100); });
  }

  // ── ID scan (GetExtendedProfile sweep) ──────────────────────────────────────────
  // Walks GetExtendedProfile across every user id in order. Skips ids already in the
  // loaded list (already logged, no point re-asking) and persists the highest id that
  // actually answered, so a later scan resumes past everything already confirmed
  // instead of re-sweeping ids that were sent but never got a reply.
  const SCAN_LAST_ID_KEY = '__ghk_udb_scan_last_id';
  let _scanTimer      = null;
  let _scanCurrentId  = null;
  let _scanActive     = false;
  let _scanKnownIds   = null;
  let _scanQueue      = null;   // set for 'known' mode: fixed list of already-logged ids to re-check
  let _scanQueueIdx   = 0;
  let _scanMode       = null;   // which mode _scanCurrentId/_scanQueue currently reflects
  let _scanDirection  = 1;      // 1 = ascending, -1 = descending (only meaningful for 'custom')

  function _scanGetLastId() {
    try { return parseInt(localStorage.getItem(SCAN_LAST_ID_KEY), 10) || 0; } catch (_e) { return 0; }
  }
  function _scanSetLastId(id) {
    try { if (id > _scanGetLastId()) localStorage.setItem(SCAN_LAST_ID_KEY, String(id)); } catch (_e) {}
  }

  // Only advance the resume pointer from replies the scan itself triggered — an
  // ExtendedProfile from normal play (opening a recent/high-id user's profile, a guild
  // list, etc.) must NOT drag this forward, or the scan would think it already swept
  // low, old-account ids it never actually sent requests for. 'custom' mode is excluded
  // too — a manual jump to an arbitrary id (e.g. starting at 4000000) isn't a sequential
  // sweep from the real resume point, so confirming ids there must not overwrite it and
  // silently skip whatever range a real 'resume' sweep hasn't actually covered yet.
  window.onPacket('ExtendedProfile', function(p) {
    if (!p.parsed || !p.parsed.id || !_scanActive || _scanMode === 'custom') return;
    _scanSetLastId(p.parsed.id);
  });

  function _scanSetStatus(text) {
    const el = panel && panel.querySelector('#__udb_scan_status');
    if (el) el.textContent = text || '';
  }

  function _scanTick() {
    if (!_scanActive) return;
    const pid = _outId('GetExtendedProfile');
    if (pid === null) {
      _log('GetExtendedProfile not found in PKT — is the game connected?');
      _scanStop();
      return;
    }

    let id;
    if (_scanQueue) {
      if (_scanQueueIdx >= _scanQueue.length) {
        _scanSetStatus('Done — refreshed all ' + _scanQueue.length + ' known ids.');
        _scanStop();
        return;
      }
      id = _scanQueue[_scanQueueIdx++];
      _scanSetStatus('Refreshing known ids… ' + _scanQueueIdx + '/' + _scanQueue.length + ' (id ' + id + ')');
    } else {
      if (_scanDirection < 0 && _scanCurrentId < 1) {
        _scanSetStatus('Done — reached id 1, nothing lower to scan.');
        _scanStop();
        return;
      }
      while (_scanKnownIds && _scanKnownIds.has(_scanCurrentId) && _scanCurrentId >= 1) _scanCurrentId += _scanDirection;
      if (_scanDirection < 0 && _scanCurrentId < 1) {
        _scanSetStatus('Done — reached id 1, nothing lower to scan.');
        _scanStop();
        return;
      }
      id = _scanCurrentId;
      _scanCurrentId += _scanDirection;
      _scanSetStatus('Scanning ' + (_scanDirection < 0 ? 'downward' : '') + '… id ' + id);
    }
    window.sendPacket('OUT', pid, '{i:' + id + '}{b:false}');
  }

  const SCAN_INTERVAL_MS = 80;

  // mode: 'known' = re-check every id already in the database (refresh stale data,
  // catch unbans); 'start' = sequential sweep from id 1; 'resume' (default) = sequential
  // sweep from the last id that actually answered. 'start'/'resume' both still skip ids
  // already known — only 'known' mode targets those on purpose.
  async function _scanStart(mode, customId, direction) {
    if (_scanActive) return;
    mode = mode || 'resume';
    const btn = panel.querySelector('#__udb_scan_btn');
    if (btn) btn.disabled = true;
    _scanSetStatus('Loading already-logged ids…');
    await _ensureLoadedAsync();
    _scanKnownIds = new Set(_all.map(function(u) { return u.id; }));

    // Only reset position when the mode actually changes (or this is the first run) —
    // re-picking the SAME mode after a pause continues where it left off, but switching
    // modes (e.g. 'start' -> 'resume') must not inherit the other mode's scan position.
    // 'custom' always jumps to the given id — a fresh explicit target every time it's picked.
    const isSameMode = _scanMode === mode;
    if (mode === 'known') {
      if (!isSameMode || !_scanQueue) {
        _scanQueue = Array.from(_scanKnownIds).sort(function(a, b) { return a - b; });
        _scanQueueIdx = 0;
      }
    } else {
      _scanQueue = null;
      if (mode === 'custom') {
        _scanCurrentId = customId;
        _scanDirection = direction === -1 ? -1 : 1;
      } else {
        _scanDirection = 1; // 'start'/'resume' only ever go upward
        if (!isSameMode || _scanCurrentId === null) {
          _scanCurrentId = (mode === 'start') ? 1 : (_scanGetLastId() + 1);
        }
      }
    }
    _scanMode = mode;
    if (btn) btn.disabled = false;

    _scanActive = true;
    if (btn) { btn.innerHTML = '&#9208;'; btn.title = 'Pause user-id scan'; }
    _scanTick();
    _scanTimer = setInterval(_scanTick, SCAN_INTERVAL_MS);
  }

  function _scanStop() {
    if (_scanTimer) clearInterval(_scanTimer);
    _scanTimer = null;
    _scanActive = false;
    const btn = panel && panel.querySelector('#__udb_scan_btn');
    if (btn) {
      btn.innerHTML = '&#9654;';
      btn.title = 'Scan user IDs via GetExtendedProfile';
      btn.disabled = false;
    }
    if (_scanQueue) {
      _scanSetStatus('Paused — ' + _scanQueueIdx + '/' + _scanQueue.length + ' known ids checked.');
    } else {
      _scanSetStatus(_scanCurrentId !== null ? 'Paused at id ' + (_scanCurrentId - _scanDirection) : '');
    }
  }

  // '*' matches any run of chars (incl. empty), e.g. "*123" or "j*n". No '*' present
  // falls back to plain substring so existing searches behave exactly as before.
  function _matchesQuery(hay, q) {
    if (q.indexOf('*') === -1) return hay.indexOf(q) !== -1;
    const pattern = q.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    try { return new RegExp(pattern).test(hay); } catch (_e) { return hay.indexOf(q) !== -1; }
  }

  // Lower = better match. Exact name match first, then name-starts-with, then
  // name-contains, then everything else (only matched via motto/id/group/old names).
  function _matchScore(u, q) {
    const name = (u.name || '').toLowerCase();
    if (name === q) return 0;
    if (name.indexOf(q) === 0) return 1;
    if (name.indexOf(q) !== -1) return 2;
    return 3;
  }

  function _applyFilters() {
    if (!panel) return;
    const q = (panel.querySelector('#__udb_search').value || '').toLowerCase().trim();
    let list = _all.filter(function(u) {
      if (!q) return true;
      const prevNames = (u.previous_names || []).join(' ');
      const hay = ((u.name || '') + ' ' + prevNames + ' ' + (u.motto || '') + ' ' + u.id + ' ' + (u.favorite_group || '')).toLowerCase();
      return _matchesQuery(hay, q);
    });
    if (q) list = list.slice().sort(function(a, b) { return _matchScore(a, q) - _matchScore(b, q); });
    _renderList(list);
  }

  // At 30k+ logged users, building one DOM row (+ avatar <img>) per match locks up the
  // page — cap what actually renders and push people toward the search bar to narrow it
  // down instead. Click handling is delegated once on the list container (buildPanel),
  // not attached per row, so this cap is the only thing keeping render cost bounded.
  const RENDER_CAP = 200;

  function _renderList(users) {
    const countEl = panel.querySelector('#__udb_count');
    const listEl = panel.querySelector('#__udb_list');
    countEl.textContent = users.length + ' user' + (users.length !== 1 ? 's' : '') + (_all.length !== users.length ? ' of ' + _all.length : '');

    if (!users.length) {
      listEl.innerHTML = '<div class="__udb_empty_sm">' + (_all.length ? 'No matches.' : 'No users logged yet.') + '</div>';
      return;
    }

    const shown = users.length > RENDER_CAP ? users.slice(0, RENDER_CAP) : users;

    listEl.innerHTML = shown.map(function(u) {
      const hasAv = !!u.figure;
      const selCls = _selId === u.id ? ' sel' : '';
      const subText = u.motto ? _esc(u.motto) : (u.favorite_group ? _esc(u.favorite_group) : '');
      return '<div class="__udb_row' + selCls + '" data-uid="' + u.id + '">'
        + '<div class="__udb_row_avatar">'
        + (hasAv
          ? '<img src="' + _esc(avatarHead(u.figure)) + '" loading="lazy" onerror="this.style.opacity=\'.2\'">'
          : '<span class="__udb_row_no_av">👤</span>')
        + '</div>'
        + '<div class="__udb_row_info">'
        + '<div class="__udb_row_name">' + _esc(u.name) + '</div>'
        + (subText ? '<div class="__udb_row_sub">' + subText + '</div>' : '')
        + '</div>'
        + '</div>';
    }).join('') + (users.length > RENDER_CAP
      ? '<div class="__udb_empty_sm">Showing first ' + RENDER_CAP + ' of ' + users.length + ' — search to narrow down.</div>'
      : '');
  }

  function _renderNameChanges() {
    if (!ncPanel) return;
    const listEl = ncPanel.querySelector('#__udb_nc_list');
    const users = _all.filter(function(u) { return u.previous_names && u.previous_names.length > 0; });

    if (!users.length) {
      listEl.innerHTML = '<div class="__udb_empty_sm">No name changes logged yet.</div>';
      return;
    }

    listEl.innerHTML = users.map(function(u) {
      const hasAv = !!u.figure;
      const pills = u.previous_names.slice().reverse().map(function(n) {
        return '<span class="__udb_dc_tag">' + _esc(n) + '</span>';
      }).join('');
      return '<div class="__udb_ncrow">'
        + '<div class="__udb_row_avatar">'
        + (hasAv
          ? '<img src="' + _esc(avatarHead(u.figure)) + '" loading="lazy" onerror="this.style.opacity=\'.2\'">'
          : '<span class="__udb_row_no_av">👤</span>')
        + '</div>'
        + '<div class="__udb_ncrow_info">'
        + '<div class="__udb_ncrow_name">' + _esc(u.name) + '</div>'
        + '<div class="__udb_dc_tags">' + pills + '</div>'
        + '</div>'
        + '</div>';
    }).join('');
  }

  function _rowHtml(label, value) {
    return '<div class="__udb_dc_row"><span class="__udb_dc_row_label">' + label + '</span><span class="__udb_dc_row_value">' + value + '</span></div>';
  }

  function _showUser(id) {
    const u = _all.find(function(x) { return x.id === id; });
    if (!u) return;
    _selId = id;

    panel.querySelectorAll('.__udb_row').forEach(function(r) {
      r.classList.toggle('sel', parseInt(r.dataset.uid, 10) === id);
    });

    panel.querySelector('#__udb_empty').style.display = 'none';
    const detail = panel.querySelector('#__udb_detail');
    detail.style.display = 'block';

    const hasAv = !!u.figure;

    let badges = '';
    if (u.gender) badges += '<span class="__udb_dc_badge">' + (u.gender.toUpperCase() === 'M' ? '♂ Male' : '♀ Female') + '</span>';
    if (u.achievement_score) badges += '<span class="__udb_dc_badge">★ ' + u.achievement_score + '</span>';

    let body = '<div class="__udb_dc_section"><div class="__udb_dc_section_title">Info</div><div class="__udb_dc_rows">';
    body += _rowHtml('ID', '#' + u.id);
    if (u.gender) body += _rowHtml('Gender', u.gender.toUpperCase() === 'M' ? 'Male' : 'Female');
    if (u.favorite_group) body += _rowHtml('Group', _esc(u.favorite_group));
    if (u.last_seen_via === 'profile' && u.last_profile_view) {
      body += _rowHtml('Logged via', 'Profile view');
      body += _rowHtml('Viewed at', ts(u.last_profile_view));
    } else if (u.last_seen_via === 'guild' && u.last_guild_view) {
      body += _rowHtml('Logged via', 'Group member list');
      body += _rowHtml('Viewed at', ts(u.last_guild_view));
    } else if (u.last_seen_via === 'relationship' && u.last_relationship_view) {
      body += _rowHtml('Logged via', 'Relationships list');
      body += _rowHtml('Viewed at', ts(u.last_relationship_view));
    } else {
      if (u.last_room_id) body += _rowHtml('Last room', '#' + u.last_room_id);
      body += _rowHtml('Last seen', ts(u.last_seen));
    }
    body += '</div></div>';

    const prevNames = u.previous_names || [];
    if (prevNames.length) {
      body += '<div class="__udb_dc_section"><div class="__udb_dc_section_title">Previous names</div><div class="__udb_dc_tags">';
      prevNames.slice().reverse().forEach(function(n) { body += '<span class="__udb_dc_tag">' + _esc(n) + '</span>'; });
      body += '</div></div>';
    }

    const prevFigureIds = u.previous_figure_ids || [];
    if (prevFigureIds.length && hasAv) {
      body += '<div class="__udb_dc_section"><div class="__udb_dc_section_title">Previous outfits</div>'
        + '<div class="__udb_dc_outfits" id="__udb_dc_prevoutfits"><div class="__udb_empty_sm">Loading…</div></div></div>';
    }

    body += '<div class="__udb_dc_section"><span class="__udb_status" id="__udb_wear_status"></span></div>';

    detail.innerHTML =
      '<div class="__udb_dc_header">'
      + '<div class="__udb_dc_avatar' + (hasAv ? ' __udb_outfit_clickable' : '') + '" id="__udb_dc_avatar">'
      + (hasAv
        ? '<img src="' + _esc(avatarLarge(u.figure)) + '" onerror="this.style.opacity=\'.1\'" title="Click to wear this outfit">'
        : '<span class="__udb_dc_no_av">👤</span>')
      + '</div>'
      + '<div class="__udb_dc_title">'
      + '<div class="__udb_dc_name">' + _esc(u.name || '—') + '</div>'
      + (u.motto ? '<div class="__udb_dc_motto">' + _esc(u.motto) + '</div>' : '')
      + (badges ? '<div class="__udb_dc_badges">' + badges + '</div>' : '')
      + '<div class="__udb_dc_btnrow">'
      + '<button class="__udb_ac_btn" id="__udb_dc_pc_btn" title="Profile Check — open their real in-game profile card">' + _ICON_PERSON + ' Profile Check</button>'
      + (hasAv ? '<button class="__udb_ac_btn" id="__udb_dc_ac_btn" title="Avatar Check — who else wore this exact outfit">' + _ICON_SEARCH + ' Avatar Check</button>' : '')
      + '</div>'
      + '</div></div>'
      + '<div class="__udb_dc_body">' + body + '</div>';

    const statusEl = detail.querySelector('#__udb_wear_status');

    detail.querySelector('#__udb_dc_pc_btn').addEventListener('click', function(e) {
      e.stopPropagation();
      _profileCheck(u.id);
    });
    if (hasAv) {
      detail.querySelector('#__udb_dc_avatar').addEventListener('click', function() { _wearFigure(u.figure, u.gender, statusEl); });
      detail.querySelector('#__udb_dc_ac_btn').addEventListener('click', function(e) {
        e.stopPropagation();
        _avatarCheck(u.figure);
      });
    }
    if (prevFigureIds.length && hasAv) _fillPrevOutfits(id, prevFigureIds, statusEl);
  }

  async function _fillPrevOutfits(userId, figureIds, statusEl) {
    await _resolveFigureIds(figureIds);
    // User may have clicked to a different profile while this was in flight.
    if (_selId !== userId || !panel) return;
    const container = panel.querySelector('#__udb_dc_prevoutfits');
    if (!container) return;

    const figs = figureIds.slice().reverse()
      .map(function(id) { return _figureCache.get(id); })
      .filter(Boolean);
    if (!figs.length) { container.innerHTML = ''; return; }

    const u = _all.find(function(x) { return x.id === userId; });
    container.innerHTML = figs.map(function(fig) {
      return '<div class="__udb_outfit_wrap">'
        + '<img src="' + _esc(avatarMini(fig)) + '" data-fig="' + _esc(fig) + '" title="Click to wear this outfit" class="__udb_outfit_clickable" loading="lazy" onerror="this.style.opacity=\'.1\'">'
        + '<button class="__udb_outfit_ac_btn" data-fig="' + _esc(fig) + '" title="Avatar Check — who else wore this outfit">' + _ICON_SEARCH + '</button>'
        + '</div>';
    }).join('');

    container.querySelectorAll('img[data-fig]').forEach(function(img) {
      img.addEventListener('click', function() { _wearFigure(img.dataset.fig, u && u.gender, statusEl); });
    });
    container.querySelectorAll('.__udb_outfit_ac_btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        _avatarCheck(btn.dataset.fig);
      });
    });
  }

  // Opens the real in-game profile card for this id — same GetExtendedProfile packet
  // the scanner uses, but with {b:true} so the client actually pops the card open
  // (the scan itself sends {b:false} to stay silent).
  function _profileCheck(id) {
    if (!id) return;
    const pid = _outId('GetExtendedProfile');
    if (pid === null) {
      _log('GetExtendedProfile not found in PKT — is the game connected?');
      return;
    }
    window.sendPacket('OUT', pid, '{i:' + id + '}{b:true}');
  }

  // ── Avatar Check ─────────────────────────────────────────────────────────────────
  // Looks up every logged user whose current figure matches exactly, or whose
  // previous_figure_ids history contains it — i.e. everyone who's ever worn this outfit.
  // History is now stored as ids into the shared figures table, so the outfit's own id
  // has to be resolved first before it can be matched against previous_figure_ids.
  async function _avatarCheck(figure) {
    if (!figure || !acPanel) return;
    acPanel.style.display = '';
    const listEl = acPanel.querySelector('#__udb_ac_list');
    const subEl  = acPanel.querySelector('#__udb_ac_sub');
    if (subEl) subEl.textContent = 'Searching…';
    listEl.innerHTML = '<div class="__udb_empty_sm">Searching…</div>';
    try {
      const encFig = encodeURIComponent(figure);
      let filter = 'figure.eq.' + encFig;
      const idRes = await fetch(
        SUPABASE_URL + '/rest/v1/figures?figure=eq.' + encFig + '&select=id',
        { headers: HEADERS }
      );
      if (idRes.ok) {
        const idRows = await idRes.json();
        if (idRows.length) filter += ',previous_figure_ids.cs.{' + idRows[0].id + '}';
      }
      const url = SUPABASE_URL + '/rest/v1/users?select=*&or=(' + filter + ')';
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const rows = await res.json();
      _renderAvatarCheck(rows, figure);
    } catch (e) {
      if (subEl) subEl.textContent = 'Error';
      listEl.innerHTML = '<div class="__udb_empty_sm">Error: ' + _esc(e.message) + '</div>';
      _log('avatar check failed: ' + e.message);
    }
  }

  function _renderAvatarCheck(rows, figure) {
    const listEl = acPanel.querySelector('#__udb_ac_list');
    const subEl  = acPanel.querySelector('#__udb_ac_sub');
    if (subEl) subEl.textContent = rows.length + ' user' + (rows.length !== 1 ? 's' : '') + ' wore this outfit';

    if (!rows.length) {
      listEl.innerHTML = '<div class="__udb_empty_sm">No one else logged wearing this exact outfit.</div>';
      return;
    }

    listEl.innerHTML = rows.map(function(u) {
      return '<div class="__udb_ncrow __udb_ac_row" data-uid="' + u.id + '">'
        + '<div class="__udb_row_avatar">'
        + '<img src="' + _esc(avatarHead(figure)) + '" loading="lazy" onerror="this.style.opacity=\'.2\'">'
        + '</div>'
        + '<div class="__udb_ncrow_info">'
        + '<div class="__udb_ncrow_name">' + _esc(u.name) + '</div>'
        + (u.motto ? '<div class="__udb_row_sub">' + _esc(u.motto) + '</div>' : '')
        + '</div>'
        + '</div>';
    }).join('');

    listEl.querySelectorAll('.__udb_ac_row').forEach(function(row) {
      row.addEventListener('click', function() {
        const id = parseInt(row.dataset.uid, 10);
        const match = rows.find(function(r) { return r.id === id; });
        if (match && !_all.some(function(x) { return x.id === id; })) _all.push(match);
        panel.style.display = '';
        _showUser(id);
      });
    });
  }

  // ── UI shell ─────────────────────────────────────────────────────────────────────
  let panel = null;
  let ncPanel = null;
  let acPanel = null;

  function injectStyle() {
    const style = document.createElement('style');
    style.textContent = [
      '#__userdb{position:fixed;top:8px;right:16px;width:640px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__userdb *{box-sizing:border-box}',
      '.__udb_card{display:flex;flex-direction:column;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb}',
      '.__udb_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__udb_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}',
      '.__udb_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__udb_iconbtn{cursor:pointer;color:#82849a;font-size:14px;line-height:1;padding:2px 6px;background:none;border:none}',
      '.__udb_iconbtn:hover{color:#eceefb}',
      '.__udb_iconbtn.active{color:#2ecc71}',
      '.__udb_random_wrap{position:relative;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;flex-shrink:0}',
      '.__udb_random_wrap .__udb_iconbtn{padding:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center}',
      '.__udb_random_ring{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;transform:rotate(-90deg)}',
      '.__udb_random_ring circle{fill:none;stroke:#2ecc71;stroke-width:2;stroke-dasharray:56.549;stroke-dashoffset:56.549;opacity:0}',
      '#__udb_scan_status{padding:0 14px 8px;font-size:10px;color:#A6B0FF;font-family:monospace}',
      '#__udb_scan_status:empty{display:none;padding:0}',
      '.__udb_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__udb_close:hover{color:#eceefb}',
      '#__udb_body{height:480px;display:flex;overflow:hidden}',
      '#__udb_list_panel{width:230px;flex-shrink:0;border-right:1px solid #23252f;display:flex;flex-direction:column;overflow:hidden}',
      '.__udb_search{margin:10px;background:#0A0B10;border:1px solid #23252f;border-radius:8px;color:#eceefb;padding:7px 9px;font-size:12px;outline:none}',
      '.__udb_search:focus{border-color:#6C7CFF}',
      '#__udb_count{padding:0 12px 8px;font-size:9px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#5c5e6b}',
      '#__udb_list{flex:1;overflow-y:auto;border-top:1px solid #23252f}',
      '.__udb_empty_sm{padding:20px 14px;color:#5c5e6b;font-size:11px;text-align:center}',
      '.__udb_row{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer}',
      '.__udb_row:hover{background:rgba(255,255,255,0.04)}',
      '.__udb_row.sel{background:rgba(108,124,255,0.12);border-left:2px solid #6C7CFF;padding-left:8px}',
      '.__udb_row_avatar{width:50px;height:50px;flex-shrink:0;border-radius:6px;overflow:hidden;background:#1c1e2a;display:flex;align-items:center;justify-content:center;position:relative}',
      // headonly&size=m renders a fixed 90x130 canvas where the head sits in a ~32,32-59,71px
      // box; these are the same fixed direction/head_direction/gesture params for every row,
      // so this hardcoded scale+offset crops straight to the head instead of guessing.
      '.__udb_row_avatar img{position:absolute;left:-26px;top:-33px;width:102px;height:147px;image-rendering:pixelated}',
      '.__udb_row_no_av{font-size:13px;opacity:.5}',
      '.__udb_row_info{flex:1;min-width:0}',
      '.__udb_row_name{font-size:11px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#eceefb}',
      '.__udb_row_sub{font-size:10px;color:#82849a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#__udb_detail_panel{flex:1;overflow-y:auto;padding:0}',
      '#__udb_empty{display:flex;align-items:center;justify-content:center;height:100%;color:#5c5e6b;font-size:12px;text-align:center;padding:24px}',
      '.__udb_dc_header{background:linear-gradient(135deg,#2b2f6b,#1a1c3d);padding:20px 20px 16px;display:flex;gap:16px;align-items:flex-end}',
      '.__udb_dc_avatar{width:90px;height:130px;flex-shrink:0;display:flex;align-items:flex-end;justify-content:center;background:rgba(255,255,255,.06);border-radius:8px 8px 0 0;overflow:hidden}',
      '.__udb_dc_avatar img{width:90px;height:130px;object-fit:contain;image-rendering:pixelated}',
      '.__udb_dc_no_av{font-size:34px;opacity:.3}',
      '.__udb_dc_title{flex:1;min-width:0;padding-bottom:6px}',
      '.__udb_dc_name{font-size:17px;font-weight:800;color:#fff;word-break:break-all}',
      '.__udb_dc_motto{font-size:11px;color:rgba(255,255,255,.65);margin-top:4px;font-style:italic}',
      '.__udb_dc_badges{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}',
      '.__udb_dc_btnrow{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}',
      '.__udb_dc_badge{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;padding:3px 8px;border-radius:4px;background:rgba(255,255,255,.15);color:#fff}',
      '.__udb_dc_body{padding:16px 20px}',
      '.__udb_dc_section{margin-bottom:16px}',
      '.__udb_dc_section:last-child{margin-bottom:0}',
      '.__udb_dc_section_title{font-size:9px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#5c5e6b;margin-bottom:8px}',
      '.__udb_dc_row{display:flex;align-items:baseline;gap:8px;padding:6px 0;border-bottom:1px solid #1c1e2a;font-size:11px}',
      '.__udb_dc_row:last-child{border-bottom:none}',
      '.__udb_dc_row_label{width:90px;flex-shrink:0;color:#82849a;font-weight:600}',
      '.__udb_dc_row_value{color:#eceefb;font-weight:600;flex:1;word-break:break-all}',
      '.__udb_dc_tags{display:flex;flex-wrap:wrap;gap:5px}',
      '.__udb_dc_tag{background:#1c1e2a;border:1px solid #23252f;color:#A6B0FF;font-size:10px;font-weight:600;padding:3px 9px;border-radius:20px}',
      '.__udb_dc_outfits{display:flex;flex-wrap:wrap;gap:8px}',
      '.__udb_dc_outfits img{width:90px;height:130px;image-rendering:pixelated;background:#1c1e2a;border-radius:8px;border:1.5px solid #23252f}',
      '.__udb_outfit_wrap{position:relative;width:90px;height:130px}',
      '.__udb_outfit_ac_btn{position:absolute;top:4px;right:4px;width:22px;height:22px;padding:0;cursor:pointer;background:rgba(10,11,16,.75);border:1px solid rgba(255,255,255,.15);color:#fff;font-size:11px;border-radius:6px;line-height:1;display:flex;align-items:center;justify-content:center}',
      '.__udb_outfit_ac_btn:hover{background:#6C7CFF;border-color:#6C7CFF}',
      '.__udb_outfit_clickable{cursor:pointer;transition:opacity .15s,outline .15s;outline:2px solid transparent;border-radius:4px}',
      '.__udb_outfit_clickable:hover{opacity:.8;outline-color:#6C7CFF}',
      '.__udb_status{font-size:10px;color:#2ecc71}',
      '#__udb_nc{position:fixed;top:8px;right:664px;width:360px;z-index:1001;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__udb_nc *{box-sizing:border-box}',
      '#__udb_nc_list{max-height:480px;overflow-y:auto}',
      '.__udb_ncrow{display:flex;gap:10px;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.05)}',
      '.__udb_ncrow_info{flex:1;min-width:0}',
      '.__udb_ncrow_name{font-size:12px;font-weight:700;color:#eceefb;margin-bottom:6px}',
      '#__udb_ac{position:fixed;top:8px;right:1034px;width:360px;z-index:1001;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__udb_ac *{box-sizing:border-box}',
      '#__udb_ac_sub{padding:10px 14px;font-size:9px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#5c5e6b;border-bottom:1px solid #23252f}',
      '#__udb_ac_list{max-height:460px;overflow-y:auto}',
      '.__udb_ac_row{cursor:pointer}',
      '.__udb_ac_row:hover{background:rgba(255,255,255,0.04)}',
      '.__udb_ac_btn{margin-top:8px;cursor:pointer;background:rgba(255,255,255,.12);border:none;color:#fff;font-size:10px;font-weight:700;padding:5px 10px;border-radius:20px;display:inline-flex;align-items:center;gap:5px}',
      '.__udb_ac_btn:hover{background:rgba(255,255,255,.22)}',
      '#__udb_scan_menu{position:fixed;z-index:100000;display:none;flex-direction:column;background:#12131A;border:1px solid #23252f;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.5);overflow:hidden;min-width:170px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}',
      '#__udb_scan_menu button{all:unset;cursor:pointer;color:#eceefb;font-size:11px;padding:9px 12px;box-sizing:border-box}',
      '#__udb_scan_menu button:hover{background:rgba(255,255,255,.08)}',
    ].join('');
    document.head.appendChild(style);
  }

  function buildPanel() {
    injectStyle();
    panel = document.createElement('div');
    panel.id = '__userdb';
    panel.innerHTML =
      '<div class="__udb_card">'
      + '<div class="__udb_hdr" id="__udb_hdr">'
      + '<span class="__udb_eyebrow">Gheloo</span>'
      + '<span class="__udb_title">User Database</span>'
      + '<span class="__udb_random_wrap">'
      + '<svg class="__udb_random_ring" viewBox="0 0 24 24"><circle id="__udb_random_ring_circle" cx="12" cy="12" r="9"/></svg>'
      + '<button class="__udb_iconbtn" id="__udb_random_btn" title="Wear a random logged outfit">' + _ICON_DICE + '</button>'
      + '</span>'
      + '<button class="__udb_iconbtn" id="__udb_random_auto_btn" title="Auto-wear a random outfit every 6s">' + _ICON_REPEAT + '</button>'
      + '<button class="__udb_iconbtn" id="__udb_scan_btn" title="Scan user IDs via GetExtendedProfile">&#9654;</button>'
      + '<button class="__udb_iconbtn" id="__udb_namechanges_btn" title="Name changes">&#8644;</button>'
      + '<span class="__udb_close" id="__udb_close">&times;</span>'
      + '</div>'
      + '<div id="__udb_scan_status"></div>'
      + '<div id="__udb_body">'
      + '<div id="__udb_list_panel">'
      + '<input id="__udb_search" class="__udb_search" placeholder="Search name, motto, id, group… (* wildcard)">'
      + '<div id="__udb_count">Loading…</div>'
      + '<div id="__udb_list"></div>'
      + '</div>'
      + '<div id="__udb_detail_panel">'
      + '<div id="__udb_empty">Click a user to view details</div>'
      + '<div id="__udb_detail" style="display:none"></div>'
      + '</div>'
      + '</div>'
      + '</div>';
    document.body.appendChild(panel);
    panel.style.display = 'none';

    window.__ghk_makeDraggable(panel, panel.querySelector('#__udb_hdr'), '__ghk_udb_pos', function(e) {
      return e.target.id === '__udb_close' || e.target.id === '__udb_namechanges_btn'
        || e.target.id === '__udb_scan_btn' || e.target.id === '__udb_random_btn'
        || e.target.id === '__udb_random_auto_btn';
    });

    panel.querySelector('#__udb_close').addEventListener('click', function() { panel.style.display = 'none'; });
    panel.querySelector('#__udb_search').addEventListener('input', function() { _applyFilters(); });
    panel.querySelector('#__udb_namechanges_btn').addEventListener('click', function() {
      ncPanel.style.display = '';
      window.__udb_ensureLoaded();
      _renderNameChanges();
    });
    panel.querySelector('#__udb_scan_btn').addEventListener('click', function() {
      if (_scanActive) _scanStop(); else _scanToggleMenu();
    });
    panel.querySelector('#__udb_random_btn').addEventListener('click', function() { _randomOutfit(); });
    panel.querySelector('#__udb_random_auto_btn').addEventListener('click', function() { _toggleAutoRandom(); });

    // Delegated on the container, not per-row — with 30k+ users a fresh listener per
    // row was a chunk of the render lag on its own.
    panel.querySelector('#__udb_list').addEventListener('click', function(e) {
      const row = e.target.closest('.__udb_row');
      if (row) _showUser(parseInt(row.dataset.uid, 10));
    });
  }

  function buildNameChangesPanel() {
    ncPanel = document.createElement('div');
    ncPanel.id = '__udb_nc';
    ncPanel.innerHTML =
      '<div class="__udb_card">'
      + '<div class="__udb_hdr" id="__udb_nc_hdr">'
      + '<span class="__udb_eyebrow">Gheloo</span>'
      + '<span class="__udb_title">Name Changes</span>'
      + '<span class="__udb_close" id="__udb_nc_close">&times;</span>'
      + '</div>'
      + '<div id="__udb_nc_list"></div>'
      + '</div>';
    document.body.appendChild(ncPanel);
    ncPanel.style.display = 'none';

    window.__ghk_makeDraggable(ncPanel, ncPanel.querySelector('#__udb_nc_hdr'), '__ghk_udb_nc_pos', function(e) {
      return e.target.id === '__udb_nc_close';
    });

    ncPanel.querySelector('#__udb_nc_close').addEventListener('click', function() { ncPanel.style.display = 'none'; });
  }

  function buildAvatarCheckPanel() {
    acPanel = document.createElement('div');
    acPanel.id = '__udb_ac';
    acPanel.innerHTML =
      '<div class="__udb_card">'
      + '<div class="__udb_hdr" id="__udb_ac_hdr">'
      + '<span class="__udb_eyebrow">Gheloo</span>'
      + '<span class="__udb_title">Avatar Check</span>'
      + '<span class="__udb_close" id="__udb_ac_close">&times;</span>'
      + '</div>'
      + '<div id="__udb_ac_sub"></div>'
      + '<div id="__udb_ac_list"></div>'
      + '</div>';
    document.body.appendChild(acPanel);
    acPanel.style.display = 'none';

    window.__ghk_makeDraggable(acPanel, acPanel.querySelector('#__udb_ac_hdr'), '__ghk_udb_ac_pos', function(e) {
      return e.target.id === '__udb_ac_close';
    });

    acPanel.querySelector('#__udb_ac_close').addEventListener('click', function() { acPanel.style.display = 'none'; });
  }

  let scanMenu = null;

  function buildScanMenu() {
    scanMenu = document.createElement('div');
    scanMenu.id = '__udb_scan_menu';
    scanMenu.innerHTML =
      '<button data-mode="known">Scan known ids</button>'
      + '<button data-mode="start">Scan from start</button>'
      + '<button data-mode="resume">Scan from last</button>'
      + '<button data-mode="custom">Scan from id…</button>';
    document.body.appendChild(scanMenu);
    scanMenu.style.display = 'none';

    scanMenu.querySelectorAll('button').forEach(function(b) {
      b.addEventListener('click', function() {
        if (b.dataset.mode === 'custom') {
          const val = window.prompt('Start scanning from which id?', '1');
          if (val === null) return;
          const id = parseInt(val, 10);
          if (!id || id < 1) return;
          const dirVal = window.prompt('Direction — type "down" to scan downward from this id, or leave blank for upward.', '');
          if (dirVal === null) return;
          const direction = dirVal.trim().toLowerCase() === 'down' ? -1 : 1;
          scanMenu.style.display = 'none';
          _scanStart('custom', id, direction);
          return;
        }
        scanMenu.style.display = 'none';
        _scanStart(b.dataset.mode);
      });
    });

    document.addEventListener('click', function(e) {
      if (scanMenu.style.display === 'none') return;
      if (scanMenu.contains(e.target) || e.target.id === '__udb_scan_btn') return;
      scanMenu.style.display = 'none';
    });
  }

  function _scanToggleMenu() {
    if (!scanMenu) return;
    if (scanMenu.style.display !== 'none') { scanMenu.style.display = 'none'; return; }
    const btn = panel.querySelector('#__udb_scan_btn');
    const r = btn.getBoundingClientRect();
    scanMenu.style.left = r.left + 'px';
    scanMenu.style.top  = (r.bottom + 4) + 'px';
    scanMenu.style.display = 'flex';
  }

  window.__udb_ensureLoaded = function() {
    if (!_loaded && !_loading) _loadUsers();
  };

  // core/supabase.js calls this right after a successful upsert so an already-open
  // panel reflects new/changed users immediately instead of needing a manual reload.
  window.__udb_onUsersUpserted = function(rows) {
    if (!_loaded || !rows || !rows.length) return;
    let selectedChanged = false;
    rows.forEach(function(row) {
      const idx = _all.findIndex(function(u) { return u.id === row.id; });
      if (idx === -1) _all.unshift(row);
      else _all[idx] = Object.assign({}, _all[idx], row);
      if (row.id === _selId) selectedChanged = true;
    });
    if (panel && panel.style.display !== 'none') _applyFilters();
    _renderNameChanges();
    // Currently-open profile (avatar, previous outfits, ...) needs a live refresh too —
    // otherwise an outfit change while you're looking at someone's page goes unnoticed
    // until you click away and back.
    if (selectedChanged) _showUser(_selId);
  };

  function init() {
    buildPanel();
    buildNameChangesPanel();
    buildAvatarCheckPanel();
    buildScanMenu();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(init); });
  } else {
    window.__ghk_ready(init);
  }
})();
