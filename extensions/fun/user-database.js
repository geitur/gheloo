(function() {
  if (document.getElementById('__userdb')) return;

  // Self-hosted Postgres + PostgREST, not managed Supabase — see the matching comment
  // in core/supabase.js for the full setup (VM address, Caddy's /rest/v1 rewrite, how
  // to rotate the anon key, how to apply schema changes). Same API shape either way,
  // so every fetch below still targets /rest/v1/... unchanged.
  const SUPABASE_URL      = 'https://userlogger.databin.uk';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6ImdoZWxvby1zZWxmaG9zdCIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwfQ.9uAMhqRJOL-m_xtTO5duAUOAw-4pKk4LEENcT47crXU';
  const HEADERS = {
    'apikey':        SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
  };

  // Fire-and-forget row in event_log — lets the CPU/DB history panel on hub.databin.uk
  // line spikes up against what was actually running (the scanner is one of the biggest
  // CPU drivers on that shared VM) instead of showing an unexplained number.
  function _logEvent(event, detail) {
    fetch(SUPABASE_URL + '/rest/v1/event_log', {
      method: 'POST',
      headers: Object.assign({}, HEADERS, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ event: event, detail: detail || null }),
    }).catch(function() {});
  }

  let _all = [];
  let _selId = null;
  let _loaded = false;
  let _loading = false;
  let _showAll = false; // false = only room-encountered users; true = everyone incl. group/profile-only

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
  const _ICON_DB =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>'
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
  const WEAR_COOLDOWN_MS = 10000;
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
    _startWearCooldownRing(opts.ringEl);
    if (statusEl && !opts.silent) {
      statusEl.textContent = 'Outfit applied.';
      setTimeout(function() { if (statusEl.textContent === 'Outfit applied.') statusEl.textContent = ''; }, 2000);
    }
  }

  const WEAR_RING_CIRCUMFERENCE = 2 * Math.PI * 9;
  function _animateRing(ring) {
    if (!ring) return;
    ring.style.transition = 'none';
    ring.style.strokeDashoffset = '0';
    ring.style.opacity = '1';
    void ring.getBoundingClientRect(); // force reflow so the transition below re-triggers
    ring.style.transition = 'stroke-dashoffset ' + WEAR_COOLDOWN_MS + 'ms linear, opacity 300ms linear ' + (WEAR_COOLDOWN_MS - 300) + 'ms';
    ring.style.strokeDashoffset = String(WEAR_RING_CIRCUMFERENCE);
    ring.style.opacity = '0';
  }
  // Only the ring around whatever was actually clicked pulses — defaults to the dice
  // ring when nothing specific was passed (dice/auto-random triggers).
  function _startWearCooldownRing(ringEl) {
    _animateRing(ringEl || (panel && panel.querySelector('#__udb_random_ring_circle')));
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
  const PAGE_SIZE = 25000;

  // Shared pager: walks every page of a query via Content-Range's real total, not by
  // comparing page length to PAGE_SIZE (a lower server-side db-max-rows would make every
  // page come back short, and a length-based check would wrongly stop after page 1).
  async function _fetchAllPages(table, query, onProgress) {
    let all = [];
    let offset = 0;
    for (;;) {
      const res = await fetch(
        SUPABASE_URL + '/rest/v1/' + table + '?' + query + '&limit=' + PAGE_SIZE + '&offset=' + offset,
        { headers: Object.assign({}, HEADERS, { 'Prefer': 'count=exact' }) }
      );
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const page = await res.json();
      all = all.concat(page);
      if (onProgress) onProgress(all.length);
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
    return all;
  }

  // Default view only shows accounts you've actually been in a room with at some point
  // (last_room_id set — only ever written by a real room encounter) — group/profile/
  // relationship-only entries are just snapshots from someone else's list, often stale
  // and not verified in person. "Load all accounts" pulls in everything.
  async function _loadUsers(showAll) {
    if (_loading) return;
    _loading = true;
    _showAll = !!showAll;
    const countEl = panel && panel.querySelector('#__udb_count');
    if (countEl) countEl.textContent = 'Loading…';
    try {
      const filter = _showAll ? '' : '&last_room_id=not.is.null';
      _all = await _fetchAllPages(
        'users', 'select=*&type=eq.1' + filter + '&order=last_seen.desc.nullslast',
        function(n) { if (countEl) countEl.textContent = 'Loading… (' + n + ')'; }
      );
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
    if (!_loading) { await _loadUsers(_showAll); return; }
    while (_loading) await new Promise(function(r) { setTimeout(r, 100); });
  }

  // Scanner's "skip already-known ids" set must always cover EVERY logged id regardless
  // of the UI's room-only filter — otherwise ids only known via a group/profile view
  // would look unscanned and get redundantly re-probed. Unioned with scanned_ids (every
  // id ever PROBED, hit or miss) so an id that turned out to be invalid/deleted — and so
  // never got a `users` row — still isn't re-probed on the next scan. See scanned_ids
  // outbox below for how that table gets filled.
  // Returns both: `all` (users ∪ scanned_ids — everything to SKIP in start/custom mode)
  // and `users` (real accounts only — what 'known' mode should actually walk; it has no
  // business re-probing scanned_ids misses, those were never real accounts).
  async function _fetchAllKnownIds() {
    const [userRows, scannedRows] = await Promise.all([
      _fetchAllPages('users', 'select=id&type=eq.1'),
      _fetchAllPages('scanned_ids', 'select=id'),
    ]);
    const users = new Set(userRows.map(function(r) { return r.id; }));
    const all = new Set(users);
    scannedRows.forEach(function(r) { all.add(r.id); });
    return { all: all, users: users };
  }

  // How recently an id must have been refreshed (by ANY account's 'known'-mode scan) to
  // skip it when building a new refresh queue — coordination for the same overlap problem
  // start/custom mode already solves, but for the "refresh every known account" sweep.
  // At 622k+ known accounts a full pass takes hours, so two accounts starting one within
  // the same window would otherwise redo most of the same work.
  const KNOWN_REFRESH_STALE_MS = 15 * 60 * 1000; // 15 min
  async function _fetchRecentlyTouchedIds(sinceMs) {
    const sinceIso = new Date(Date.now() - sinceMs).toISOString();
    const rows = await _fetchAllPages('scanned_ids', 'select=id&scanned_at=gt.' + encodeURIComponent(sinceIso));
    return new Set(rows.map(function(r) { return r.id; }));
  }

  // ── scanned_ids outbox — records every id the scanner has ever sent a
  // GetExtendedProfile probe for, whether or not it turned out to be a real user. Kept as
  // its own {id, scanned_at} table (see core/supabase.js's schema-change recipe for how to
  // add it) instead of piggybacking on `users`, since a miss never gets a `users` row.
  // Batched + queued through localStorage exactly like core/supabase.js's own outbox, so a
  // page reload mid-scan doesn't lose already-attempted ids and a struggling DB gets
  // backoff room instead of getting hammered.
  const SCANNED_IDS_OUTBOX_KEY = 'gheloo_scanned_ids_outbox_v1';
  const SCANNED_IDS_BATCH_SIZE = 200;
  const SCANNED_IDS_DRAIN_MS   = 1000;
  const SCANNED_IDS_BACKOFF_MS = 5000;
  let _scannedIdsBackoffUntil = 0;
  let _scannedIdsDraining = false;

  function _loadScannedIdsOutbox() {
    try { return JSON.parse(localStorage.getItem(SCANNED_IDS_OUTBOX_KEY) || '[]'); } catch (e) { return []; }
  }
  function _saveScannedIdsOutbox(ids) {
    try { localStorage.setItem(SCANNED_IDS_OUTBOX_KEY, JSON.stringify(ids)); } catch (e) {}
  }
  function _enqueueScannedId(id) {
    const items = _loadScannedIdsOutbox();
    items.push(id);
    _saveScannedIdsOutbox(items);
  }

  // core/supabase.js calls this after every upsert (room encounters, profile/guild/
  // relationship views — any source, not just this file's own sweep) so those ids land
  // in scanned_ids too. Without this, an id you just walk past in a room gets written to
  // `users` but never to scanned_ids, so an in-progress scan (whose live-sync only polls
  // scanned_ids) never learns about it and probes it again later anyway.
  window.__udb_markIdsScanned = function(ids) {
    (ids || []).forEach(function(id) { if (id != null) _enqueueScannedId(id); });
  };
  async function _scannedIdsDrainTick() {
    if (_scannedIdsDraining || Date.now() < _scannedIdsBackoffUntil) return;
    const items = _loadScannedIdsOutbox();
    if (!items.length) return;
    const batch = items.slice(0, SCANNED_IDS_BATCH_SIZE);
    _scannedIdsDraining = true;
    try {
      // merge-duplicates (not ignore-duplicates) so scanned_at gets bumped to now on every
      // touch, not just the first — that's what lets a 'known'-mode queue-build (below)
      // treat "touched in the last 15 min" as "someone else already just refreshed this."
      const nowIso = new Date().toISOString();
      const res = await fetch(SUPABASE_URL + '/rest/v1/scanned_ids?on_conflict=id', {
        method:  'POST',
        headers: Object.assign({}, HEADERS, { 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' }),
        body:    JSON.stringify(batch.map(function(id) { return { id: id, scanned_at: nowIso }; })),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const current = _loadScannedIdsOutbox();
      _saveScannedIdsOutbox(current.slice(batch.length));
    } catch (e) {
      _log('scanned-id sync failed, will retry: ' + e.message);
      _scannedIdsBackoffUntil = Date.now() + SCANNED_IDS_BACKOFF_MS;
    } finally {
      _scannedIdsDraining = false;
    }
  }
  setInterval(_scannedIdsDrainTick, SCANNED_IDS_DRAIN_MS);

  // ── Live cross-tab/cross-account sync while a scan is running — polls for scanned_ids
  // rows newer than the last poll and folds their ids straight into _scanKnownIds, so a
  // second account scanning at the same time gets skipped over here within one poll
  // interval instead of both accounts probing the same ids in parallel. Also feeds
  // _scanFreshAt (id -> last-touched ms) which 'known' mode's queue walk checks to skip an
  // entry someone else just refreshed, even mid-queue.
  const SCAN_SYNC_INTERVAL_MS = 3000;
  let _scanSyncSince = null;
  let _scanSyncTimer = null;
  let _scanFreshAt = new Map();

  async function _scanPollNewIds() {
    if (!_scanActive || _scanSyncSince == null) return;
    try {
      const res = await fetch(
        SUPABASE_URL + '/rest/v1/scanned_ids?select=id,scanned_at&scanned_at=gt.' + encodeURIComponent(_scanSyncSince) + '&order=scanned_at.asc&limit=5000',
        { headers: HEADERS }
      );
      if (!res.ok) return;
      const rows = await res.json();
      if (!rows.length) return;
      rows.forEach(function(r) {
        if (_scanKnownIds) _scanKnownIds.add(r.id);
        _scanFreshAt.set(r.id, Date.parse(r.scanned_at) || Date.now());
        if (r.scanned_at > _scanSyncSince) _scanSyncSince = r.scanned_at;
      });
    } catch (e) { /* best-effort — a missed poll just gets caught on the next one */ }
  }
  function _scanSyncStart() {
    _scanSyncSince = new Date().toISOString();
    if (_scanSyncTimer) clearInterval(_scanSyncTimer);
    _scanSyncTimer = setInterval(_scanPollNewIds, SCAN_SYNC_INTERVAL_MS);
  }
  function _scanSyncStop() {
    if (_scanSyncTimer) clearInterval(_scanSyncTimer);
    _scanSyncTimer = null;
    _scanSyncSince = null;
  }

  // ── ID scan (GetExtendedProfile sweep) ──────────────────────────────────────────
  // Walks GetExtendedProfile across every user id in order. Skips ids already in the
  // loaded list (already logged, no point re-asking).
  let _scanTimer      = null;
  let _scanCurrentId  = null;
  let _scanActive     = false;
  let _scanKnownIds   = null;
  let _scanQueue      = null;   // set for 'known' mode: fixed list of already-logged ids to re-check
  let _scanQueueIdx   = 0;
  let _scanMode       = null;   // which mode _scanCurrentId/_scanQueue currently reflects
  let _scanDirection  = 1;      // 1 = ascending, -1 = descending (only meaningful for 'custom')
  let _scanLastReplyId = null;  // last id that actually got an ExtendedProfile reply back — display only

  // Display-only — just tracks what to show in the status line, not tied to any
  // persisted resume position.
  window.onPacket('ExtendedProfile', function(p) {
    if (!p.parsed || !p.parsed.id || !_scanActive) return;
    _scanLastReplyId = p.parsed.id;
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
      // Someone else's 'known'-mode scan may have refreshed the next few queue entries
      // since this queue was built — skip past anything already fresh instead of
      // re-probing it too.
      while (_scanQueueIdx < _scanQueue.length && _scanFreshAt.has(_scanQueue[_scanQueueIdx])
        && (Date.now() - _scanFreshAt.get(_scanQueue[_scanQueueIdx])) < KNOWN_REFRESH_STALE_MS) {
        _scanQueueIdx++;
      }
      if (_scanQueueIdx >= _scanQueue.length) {
        _scanSetStatus('Done — refreshed all ' + _scanQueue.length + ' known ids.');
        _scanStop();
        return;
      }
      id = _scanQueue[_scanQueueIdx++];
      _scanSetStatus('Refreshing known ids… ' + _scanQueueIdx + '/' + _scanQueue.length + ' (id ' + id + ')' + _scanLastReplySuffix());
      _enqueueScannedId(id);
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
      _scanSetStatus('Scanning ' + (_scanDirection < 0 ? 'downward' : '') + '… id ' + id + _scanLastReplySuffix());
      // Mark immediately (hit or miss) so this id is never re-probed — by this scan on a
      // future restart, or by another account scanning concurrently once its next sync
      // poll picks this up.
      if (_scanKnownIds) _scanKnownIds.add(id);
      _enqueueScannedId(id);
    }
    window.sendPacket('OUT', pid, '{i:' + id + '}{b:false}');
  }

  function _scanLastReplySuffix() {
    return _scanLastReplyId != null ? ' — laatste reply: id ' + _scanLastReplyId : '';
  }

  // 25/sec by default — drives both the GetExtendedProfile probe and the scanned_ids link
  // upload. Kept in localStorage (not a const) so it can be tuned live from the scan menu
  // instead of requiring a code edit.
  const SCAN_INTERVAL_KEY = 'gheloo_udb_scan_interval_ms';
  const SCAN_INTERVAL_MIN_MS = 10; // hard floor — below this it's just hammering the server
  let _scanIntervalMs = parseInt(localStorage.getItem(SCAN_INTERVAL_KEY), 10) || 40;
  if (_scanIntervalMs < SCAN_INTERVAL_MIN_MS) _scanIntervalMs = SCAN_INTERVAL_MIN_MS;

  function _setScanIntervalMs(ms) {
    ms = parseInt(ms, 10);
    if (!ms || ms < SCAN_INTERVAL_MIN_MS) ms = SCAN_INTERVAL_MIN_MS;
    _scanIntervalMs = ms;
    localStorage.setItem(SCAN_INTERVAL_KEY, String(ms));
    // Live-apply — a scan already running keeps going, just on the new cadence from here on.
    if (_scanTimer) {
      clearInterval(_scanTimer);
      _scanTimer = setInterval(_scanTick, _scanIntervalMs);
    }
  }

  // mode: 'known' = re-check every id already in the database (refresh stale data,
  // catch unbans); 'start' = sequential sweep from id 1; 'custom' = jump to a given id.
  // 'start' still skips ids already known — only 'known' mode targets those on purpose.
  async function _scanStart(mode, customId, direction) {
    if (_scanActive) return;
    mode = mode || 'start';
    const btn = panel.querySelector('#__udb_scan_btn');
    if (btn) btn.disabled = true;
    _scanSetStatus('Loading already-logged ids…');
    const known = await _fetchAllKnownIds();
    _scanKnownIds = known.all;

    // Only reset position when the mode actually changes (or this is the first run) —
    // re-picking the SAME mode after a pause continues where it left off, but switching
    // modes (e.g. 'start' -> 'custom') must not inherit the other mode's scan position.
    // 'custom' always jumps to the given id — a fresh explicit target every time it's picked.
    const isSameMode = _scanMode === mode;
    if (mode === 'known') {
      if (!isSameMode || !_scanQueue) {
        _scanSetStatus('Checking which known ids were refreshed recently…');
        // Real accounts only (never scanned_ids misses — those were never users) minus
        // anything another account's 'known'-mode scan already refreshed recently, so two
        // accounts starting a full refresh around the same time don't redo the same work.
        const recentlyTouched = await _fetchRecentlyTouchedIds(KNOWN_REFRESH_STALE_MS);
        _scanQueue = Array.from(known.users)
          .filter(function(id) { return !recentlyTouched.has(id); })
          .sort(function(a, b) { return a - b; });
        _scanQueueIdx = 0;
      }
    } else {
      _scanQueue = null;
      if (mode === 'custom') {
        _scanCurrentId = customId;
        _scanDirection = direction === -1 ? -1 : 1;
      } else { // 'start'
        _scanDirection = 1;
        if (!isSameMode || _scanCurrentId === null) _scanCurrentId = 1;
      }
    }
    _scanMode = mode;
    if (btn) btn.disabled = false;

    _scanActive = true;
    if (btn) { btn.innerHTML = '&#9208;'; btn.title = 'Pause user-id scan'; }
    _logEvent('scan_start', mode + (window._selfName ? ' (' + window._selfName + ')' : ''));
    _scanSyncStart();
    _scanTick();
    _scanTimer = setInterval(_scanTick, _scanIntervalMs);
  }

  function _scanStop() {
    if (_scanTimer) clearInterval(_scanTimer);
    _scanTimer = null;
    if (_scanActive) _logEvent('scan_stop', window._selfName || null);
    _scanActive = false;
    _scanSyncStop();
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
    _renderList(list, q);
  }

  // If a search hit someone only because one of their OLD names matches (not their
  // current name), surface that — otherwise a hit like "Frog" for a query "ceder" looks
  // unexplained. Most recent old name checked first.
  function _oldNameMatch(u, q) {
    if (!q) return null;
    if (_matchesQuery((u.name || '').toLowerCase(), q)) return null;
    const prev = u.previous_names || [];
    for (let i = prev.length - 1; i >= 0; i--) {
      if (_matchesQuery((prev[i] || '').toLowerCase(), q)) return prev[i];
    }
    return null;
  }

  // At 30k+ logged users, building one DOM row (+ avatar <img>) per match locks up the
  // page — cap what actually renders and push people toward the search bar to narrow it
  // down instead. Click handling is delegated once on the list container (buildPanel),
  // not attached per row, so this cap is the only thing keeping render cost bounded.
  const RENDER_CAP = 200;

  function _renderList(users, q) {
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
      const oldName = _oldNameMatch(u, q);
      const subText = oldName
        ? '<span class="__udb_row_oldname">Old name: ' + _esc(oldName) + '</span>'
        : (u.motto ? _esc(u.motto) : (u.favorite_group ? _esc(u.favorite_group) : ''));
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
    const users = _all.filter(function(u) { return u.previous_names && u.previous_names.length > 0; })
      .sort(function(a, b) { return new Date(b.last_name_change || 0) - new Date(a.last_name_change || 0); });

    if (!users.length) {
      listEl.innerHTML = '<div class="__udb_empty_sm">No name changes logged yet.</div>';
      return;
    }

    listEl.innerHTML = users.map(function(u) {
      const hasAv = !!u.figure;
      const pills = u.previous_names.slice().reverse().map(function(n) {
        return '<span class="__udb_dc_tag">' + _esc(n) + '</span>';
      }).join('');
      return '<div class="__udb_ncrow" data-uid="' + u.id + '">'
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

    listEl.querySelectorAll('.__udb_ncrow').forEach(function(row) {
      row.addEventListener('click', function() {
        panel.style.display = '';
        _showUser(parseInt(row.dataset.uid, 10));
      });
    });
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
        ? '<svg class="__udb_wear_ring" viewBox="0 0 24 24"><circle class="__udb_wear_ring_circle" cx="12" cy="12" r="9"/></svg>'
          + '<img src="' + _esc(avatarLarge(u.figure)) + '" onerror="this.style.opacity=\'.1\'" title="Click to wear this outfit">'
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
      const avatarRing = detail.querySelector('#__udb_dc_avatar .__udb_wear_ring_circle');
      detail.querySelector('#__udb_dc_avatar').addEventListener('click', function() { _wearFigure(u.figure, u.gender, statusEl, { ringEl: avatarRing }); });
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
        + '<svg class="__udb_wear_ring" viewBox="0 0 24 24"><circle class="__udb_wear_ring_circle" cx="12" cy="12" r="9"/></svg>'
        + '<img src="' + _esc(avatarMini(fig)) + '" data-fig="' + _esc(fig) + '" title="Click to wear this outfit" class="__udb_outfit_clickable" loading="lazy" onerror="this.style.opacity=\'.1\'">'
        + '<button class="__udb_outfit_ac_btn" data-fig="' + _esc(fig) + '" title="Avatar Check — who else wore this outfit">' + _ICON_SEARCH + '</button>'
        + '</div>';
    }).join('');

    container.querySelectorAll('.__udb_outfit_wrap').forEach(function(wrap) {
      const img = wrap.querySelector('img[data-fig]');
      const ring = wrap.querySelector('.__udb_wear_ring_circle');
      img.addEventListener('click', function() { _wearFigure(img.dataset.fig, u && u.gender, statusEl, { ringEl: ring }); });
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
      '#__udb_title_link{cursor:pointer;flex:0 0 auto}',
      '#__udb_title_link:hover{text-decoration:underline}',
      '.__udb_hdr_spacer{flex:1}',
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
      '.__udb_row_oldname{color:#A6B0FF;font-weight:600}',
      '#__udb_detail_panel{flex:1;overflow-y:auto;padding:0}',
      '#__udb_empty{display:flex;align-items:center;justify-content:center;height:100%;color:#5c5e6b;font-size:12px;text-align:center;padding:24px}',
      '.__udb_dc_header{background:linear-gradient(135deg,#2b2f6b,#1a1c3d);padding:20px 20px 16px;display:flex;gap:16px;align-items:flex-end}',
      '.__udb_dc_avatar{position:relative;width:90px;height:130px;flex-shrink:0;display:flex;align-items:flex-end;justify-content:center;background:rgba(255,255,255,.06);border-radius:8px 8px 0 0;overflow:hidden}',
      '.__udb_wear_ring{position:absolute;top:50%;left:50%;width:70px;height:70px;transform:translate(-50%,-50%) rotate(-90deg);pointer-events:none;z-index:1}',
      '.__udb_wear_ring circle{fill:none;stroke:#2ecc71;stroke-width:2;stroke-dasharray:56.549;stroke-dashoffset:56.549;opacity:0}',
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
      '.__udb_ncrow{display:flex;gap:10px;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer}',
      '.__udb_ncrow:hover{background:rgba(255,255,255,0.04)}',
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
      '#__udb_scan_menu,#__udb_scan_pause_menu{position:fixed;z-index:100000;display:none;flex-direction:column;background:#12131A;border:1px solid #23252f;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.5);overflow:hidden;min-width:170px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}',
      '#__udb_scan_menu button,#__udb_scan_pause_menu button{all:unset;cursor:pointer;color:#eceefb;font-size:11px;padding:9px 12px;box-sizing:border-box}',
      '#__udb_scan_menu button:hover,#__udb_scan_pause_menu button:hover{background:rgba(255,255,255,.08)}',
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
      + '<span class="__udb_title" id="__udb_title_link" title="Open userlogger.databin.uk">User Database</span>'
      + '<span class="__udb_hdr_spacer"></span>'
      + '<span class="__udb_random_wrap">'
      + '<svg class="__udb_random_ring" viewBox="0 0 24 24"><circle id="__udb_random_ring_circle" cx="12" cy="12" r="9"/></svg>'
      + '<button class="__udb_iconbtn" id="__udb_random_btn" title="Wear a random logged outfit">' + _ICON_DICE + '</button>'
      + '</span>'
      + '<button class="__udb_iconbtn" id="__udb_random_auto_btn" title="Auto-wear a random outfit every 6s">' + _ICON_REPEAT + '</button>'
      + '<button class="__udb_iconbtn" id="__udb_scan_btn" title="Scan user IDs via GetExtendedProfile">&#9654;</button>'
      + '<button class="__udb_iconbtn" id="__udb_loadall_btn" title="Load all accounts, including group/profile-only entries never seen in a room">' + _ICON_DB + '</button>'
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
        || e.target.id === '__udb_random_auto_btn' || e.target.id === '__udb_loadall_btn'
        || e.target.id === '__udb_title_link';
    });

    panel.querySelector('#__udb_title_link').addEventListener('click', function() {
      window.open('https://userlogger.databin.uk/', '_blank');
    });
    panel.querySelector('#__udb_close').addEventListener('click', function() { panel.style.display = 'none'; });
    panel.querySelector('#__udb_search').addEventListener('input', function() { _applyFilters(); });
    panel.querySelector('#__udb_namechanges_btn').addEventListener('click', function() {
      ncPanel.style.display = '';
      window.__udb_ensureLoaded();
      _renderNameChanges();
    });
    panel.querySelector('#__udb_scan_btn').addEventListener('click', function() {
      if (_scanActive) _scanTogglePauseMenu(); else _scanToggleMenu();
    });
    panel.querySelector('#__udb_loadall_btn').addEventListener('click', function() {
      if (_loading) return;
      _loaded = false;
      _loadUsers(true);
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
      + '<button data-mode="custom">Scan from id…</button>'
      + '<button data-action="cooldown">Cooldown…</button>';
    document.body.appendChild(scanMenu);
    scanMenu.style.display = 'none';

    scanMenu.querySelectorAll('button').forEach(function(b) {
      b.addEventListener('click', function() {
        if (b.dataset.action === 'cooldown') {
          const val = window.prompt(
            'Cooldown tussen scans in ms (huidig: ' + _scanIntervalMs + 'ms — lager = sneller, minimum ' + SCAN_INTERVAL_MIN_MS + 'ms):',
            String(_scanIntervalMs)
          );
          if (val === null) return;
          const ms = parseInt(val, 10);
          if (!ms) return;
          _setScanIntervalMs(ms);
          scanMenu.style.display = 'none';
          return;
        }
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

  // Discards the in-progress position instead of just pausing it — next time this mode
  // is picked it starts fresh ('start' goes back to id 1, 'custom' simply forgets the
  // range, 'known' rebuilds its queue).
  function _scanCancel() {
    _scanStop();
    _scanCurrentId = null;
    _scanQueue = null;
    _scanQueueIdx = 0;
    _scanMode = null;
    _scanSetStatus('Geannuleerd.');
  }

  let pauseMenu = null;

  function buildScanPauseMenu() {
    pauseMenu = document.createElement('div');
    pauseMenu.id = '__udb_scan_pause_menu';
    pauseMenu.innerHTML =
      '<button data-action="pause">Pauzeer (positie bewaren)</button>'
      + '<button data-action="cancel">Annuleer (reset)</button>';
    document.body.appendChild(pauseMenu);
    pauseMenu.style.display = 'none';

    pauseMenu.querySelectorAll('button').forEach(function(b) {
      b.addEventListener('click', function() {
        pauseMenu.style.display = 'none';
        if (b.dataset.action === 'cancel') _scanCancel(); else _scanStop();
      });
    });

    document.addEventListener('click', function(e) {
      if (pauseMenu.style.display === 'none') return;
      if (pauseMenu.contains(e.target) || e.target.id === '__udb_scan_btn') return;
      pauseMenu.style.display = 'none';
    });
  }

  function _scanTogglePauseMenu() {
    if (!pauseMenu) return;
    if (pauseMenu.style.display !== 'none') { pauseMenu.style.display = 'none'; return; }
    const btn = panel.querySelector('#__udb_scan_btn');
    const r = btn.getBoundingClientRect();
    pauseMenu.style.left = r.left + 'px';
    pauseMenu.style.top  = (r.bottom + 4) + 'px';
    pauseMenu.style.display = 'flex';
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
      if (idx !== -1) {
        // Already in the list — merge and bump to the front too, or it'd sit stuck at
        // its old load-time position even though it's now the most recently touched.
        const merged = Object.assign({}, _all[idx], row);
        _all.splice(idx, 1);
        _all.unshift(merged);
      } else if (_showAll || row.last_room_id) {
        // A brand-new row from a group/profile source shouldn't appear in the
        // room-only default view — matches what a fresh _loadUsers() would show.
        _all.unshift(row);
      }
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
    buildScanPauseMenu();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(init); });
  } else {
    window.__ghk_ready(init);
  }
})();
