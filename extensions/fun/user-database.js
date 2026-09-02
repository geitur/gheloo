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
    'Content-Type':  'application/json',
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
        function(n) { if (countEl) countEl.textContent = 'Loading… (' + n.toLocaleString('nl-BE') + ')'; }
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

  // Keyset (cursor) pagination by id — used for every "must not miss a single row" fetch
  // below. Offset/limit pagination (still fine for _loadUsers's display list) is only
  // correct on a table nobody else is writing to while you paginate it: OFFSET counts
  // ROW POSITIONS, and with several accounts inserting into `users`/`scanned_ids` at the
  // same time this function itself is running, a row inserted before the current offset
  // shifts every later page's window — silently skipping whatever used to sit at that
  // position. That's exactly how an id that's genuinely been in the table for a day could
  // still be missing from the "already known" set built moments ago. Keyset pagination
  // asks "next N rows with id greater than the last one I actually saw" — a real value,
  // not a position — so it can't be shifted out from under itself by concurrent writes.
  async function _fetchAllIds(table, extraFilter) {
    const ids = [];
    let lastId = -1;
    for (;;) {
      const filter = (extraFilter ? extraFilter + '&' : '') + 'id=gt.' + lastId;
      const res = await fetch(
        SUPABASE_URL + '/rest/v1/' + table + '?select=id&' + filter + '&order=id.asc&limit=' + PAGE_SIZE,
        { headers: HEADERS }
      );
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const page = await res.json();
      if (!page.length) break;
      for (let i = 0; i < page.length; i++) ids.push(page[i].id);
      lastId = page[page.length - 1].id;
      if (page.length < PAGE_SIZE) break;
    }
    return ids;
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
    const [userIds, scannedIds] = await Promise.all([
      _fetchAllIds('users', 'type=eq.1'),
      _fetchAllIds('scanned_ids'),
    ]);
    const users = new Set(userIds);
    const all = new Set(users);
    scannedIds.forEach(function(id) { all.add(id); });
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
    const ids = await _fetchAllIds('scanned_ids', 'scanned_at=gt.' + encodeURIComponent(sinceIso));
    return new Set(ids);
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
  const SCANNED_IDS_DRAIN_MS   = 400;
  const SCANNED_IDS_BACKOFF_MS = 5000;
  let _scannedIdsBackoffUntil = 0;
  let _scannedIdsDraining = false;

  // Same cross-tab hazard as core/supabase.js's outbox: this key is shared by every open
  // tab, and removing "whatever's currently first" after an await deletes a different
  // tab's never-sent item the moment two tabs drain concurrently — silent, permanent loss
  // with no error (root cause of the 2026-08-29 "70k scanned, ~2k landed" report). Each
  // entry gets a unique `_k`; removal filters by that, not by position.
  let _scannedIdsKeySeq = 0;
  function _nextScannedIdsKey() { return Date.now() + '_' + Math.random().toString(36).slice(2) + '_' + (_scannedIdsKeySeq++); }
  function _loadScannedIdsOutbox() {
    try {
      const raw = JSON.parse(localStorage.getItem(SCANNED_IDS_OUTBOX_KEY) || '[]');
      let changed = false;
      // Pre-fix entries are bare ids (numbers), not {id,_k} objects — migrate on read.
      const items = raw.map((it) => {
        if (it != null && typeof it === 'object' && it._k != null) return it;
        changed = true;
        return { id: (it != null && typeof it === 'object') ? it.id : it, _k: _nextScannedIdsKey() };
      });
      if (changed) _saveScannedIdsOutbox(items);
      return items;
    } catch (e) { return []; }
  }
  function _saveScannedIdsOutbox(items) {
    try {
      localStorage.setItem(SCANNED_IDS_OUTBOX_KEY, JSON.stringify(items));
    } catch (e) {
      // Same quota hazard as core/supabase.js's outbox — drop oldest to stay unwedged
      // instead of silently swallowing every future enqueue once the key's maxed out.
      if (e && e.name === 'QuotaExceededError' && items.length > 1) {
        _saveScannedIdsOutbox(items.slice(Math.ceil(items.length * 0.1)));
      }
    }
  }
  function _enqueueScannedId(id) {
    const items = _loadScannedIdsOutbox();
    items.push({ id: id, _k: _nextScannedIdsKey() });
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
    const batchKeys = new Set(batch.map((it) => it._k));
    _scannedIdsDraining = true;
    try {
      // merge-duplicates (not ignore-duplicates) so scanned_at gets bumped to now on every
      // touch, not just the first — that's what lets a 'known'-mode queue-build (below)
      // treat "touched in the last 15 min" as "someone else already just refreshed this."
      const nowIso = new Date().toISOString();
      // The same id can land in the outbox twice (the scan loop enqueues at probe-send
      // time; core/supabase.js's __udb_markIdsScanned enqueues it again once a reply
      // upserts it) and both copies can end up in the same batch. Postgres rejects an
      // INSERT ... ON CONFLICT DO UPDATE that hits the same row twice in one statement
      // ("cannot affect row a second time") — a flat 500 on the whole batch, every time,
      // found live 2026-08-29 right after fixing the missing UPDATE grant. Dedupe by id
      // for the request body; batchKeys still covers every outbox entry so all duplicates
      // get cleared from the queue once the one row they collapsed into is confirmed sent.
      const rowsById = new Map();
      batch.forEach(function(it) { rowsById.set(it.id, { id: it.id, scanned_at: nowIso }); });
      const res = await fetch(SUPABASE_URL + '/rest/v1/scanned_ids?on_conflict=id', {
        method:  'POST',
        headers: Object.assign({}, HEADERS, { 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' }),
        body:    JSON.stringify(Array.from(rowsById.values())),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      // Remove by `_k`, not position — another tab may have drained/enqueued into this
      // same key while the fetch was in flight (see the outbox comment above).
      const current = _loadScannedIdsOutbox();
      _saveScannedIdsOutbox(current.filter((it) => !batchKeys.has(it._k)));
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
  const SCAN_SYNC_INTERVAL_MS = 1000;
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

  // 'range' mode's skip-set is `users`-only (see _scanTick), so its live cross-scanner sync
  // has to watch `users.created_at` instead of `scanned_ids.scanned_at` — otherwise a
  // second scanner's finds would only show up here via scanned_ids (which range mode
  // deliberately ignores) and never actually get skipped.
  async function _scanPollNewUserIds() {
    if (!_scanActive || _scanSyncSince == null) return;
    try {
      const res = await fetch(
        SUPABASE_URL + '/rest/v1/users?select=id,created_at&type=eq.1&created_at=gt.' + encodeURIComponent(_scanSyncSince) + '&order=created_at.asc&limit=5000',
        { headers: HEADERS }
      );
      if (res.ok) {
        const rows = await res.json();
        rows.forEach(function(r) {
          if (_scanKnownIds) _scanKnownIds.add(r.id);
          if (r.created_at > _scanSyncSince) _scanSyncSince = r.created_at;
        });
      }
    } catch (e) { /* best-effort — a missed poll just gets caught on the next one */ }
    // Piggybacked on this same 1s tick rather than its own timer — small table, changes
    // rarely, and this keeps a blackhole another tab just added showing up here quickly
    // without a second poll loop. Deliberately OUTSIDE the try/if above (an earlier version
    // had this after an `if (!rows.length) return`, which fires on almost every tick since
    // new users are rare — that skipped this refresh nearly every time, live 2026-08-30:
    // a blackhole kept getting re-probed lap after lap because of it).
    _scanBlackholes = await _fetchBlackholes();
  }
  function _scanSyncStart(since) {
    // Defaults to now, but _scanStart passes a timestamp captured BEFORE
    // _fetchAllKnownIds() — that fetch can take several seconds for hundreds of
    // thousands of rows, and anything another account scans DURING that window would
    // otherwise fall in the gap between the snapshot (already taken) and the poll
    // (which used to only start watching from after the snapshot finished) and get
    // re-probed here anyway.
    _scanSyncSince = since || new Date().toISOString();
    if (_scanSyncTimer) clearInterval(_scanSyncTimer);
    _scanSyncTimer = setInterval(_scanMode === 'range' ? _scanPollNewUserIds : _scanPollNewIds, SCAN_SYNC_INTERVAL_MS);
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
  let _scanDirection  = 1;      // 1 = ascending, -1 = descending (only meaningful for 'custom'/'range')
  let _scanLastReplyId = null;  // last id that actually got an ExtendedProfile reply back — display only
  let _scanNewCount = 0;        // real accounts found THIS run — display only, reset on a fresh start/custom/range run
  let _scanRangeFrom = null;    // 'range' mode only — loops back here once _scanRangeTo is reached
  let _scanRangeTo   = null;
  let _scanLapCount    = 0;     // 'range' mode only — completed passes over [from, to]
  let _scanLapHistory  = [];    // new-account count for each COMPLETED lap, oldest first
  let _scanCurrentLapNew = 0;   // new-account count for the lap in progress
  let _scanRangeTotalScanned = 0; // total ids probed this session, all laps combined
  let _scanBlackholes = [];       // 'range' mode only — [{id, from, to}] id ranges to always skip

  // scan_blackholes: manually-declared id ranges to always skip (e.g. a known bot-farm
  // block), on top of the normal `users` skip-set. Shared/global table — every scanner
  // reads the same list, kept live-synced via periodic re-fetch (see _scanPollNewUserIds
  // and the blackholes panel's own poll) rather than incremental diffing, since this table
  // is small and changes rarely.
  async function _fetchBlackholes() {
    try {
      const res = await fetch(SUPABASE_URL + '/rest/v1/scan_blackholes?select=id,range_from,range_to', { headers: HEADERS });
      if (!res.ok) return [];
      const rows = await res.json();
      return rows.map(function(r) { return { id: r.id, from: r.range_from, to: r.range_to }; });
    } catch (e) { return []; }
  }
  function _isBlackholed(id) {
    for (let i = 0; i < _scanBlackholes.length; i++) {
      const bh = _scanBlackholes[i];
      const lo = Math.min(bh.from, bh.to), hi = Math.max(bh.from, bh.to);
      if (id >= lo && id <= hi) return true;
    }
    return false;
  }

  // Display-only — just tracks what to show in the status line, not tied to any
  // persisted resume position.
  window.onPacket('ExtendedProfile', function(p) {
    if (!p.parsed || !p.parsed.id || !_scanActive) return;
    _scanLastReplyId = p.parsed.id;
    // 'start'/'custom' only ever probe ids _scanKnownIds didn't already have, so any reply
    // here is by construction a genuinely new find. 'known' mode is a refresh sweep over
    // already-known ids — a reply there isn't "new", so it's not counted.
    if (_scanMode !== 'known') _scanNewCount++;
    if (_scanMode === 'range') { _scanCurrentLapNew++; _updateRangePanelView(); }
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
    if (_scanMode === 'range') {
      // Loops the [from, to] range forever instead of stopping — reaching the far end just
      // wraps back to the start and keeps going, until paused/aborted from the UI. Skip-set
      // is `users`-only (not scanned_ids) by design: a probe whose reply got lost to a real
      // connection drop (not just lag — WS/TCP doesn't lose in-order data under plain
      // latency) would otherwise be marked "known" forever despite never actually landing a
      // row, permanently skipping a real account. Using `users` means it just gets
      // re-probed on the next lap instead.
      const pastBound = function(v) { return _scanDirection > 0 ? v > _scanRangeTo : v < _scanRangeTo; };
      const shouldSkip = function(v) { return (_scanKnownIds && _scanKnownIds.has(v)) || _isBlackholed(v); };
      while (shouldSkip(_scanCurrentId) && !pastBound(_scanCurrentId)) _scanCurrentId += _scanDirection;
      if (pastBound(_scanCurrentId)) {
        _scanLapCount++;
        _scanLapHistory.push(_scanCurrentLapNew);
        _scanCurrentLapNew = 0;
        _scanCurrentId = _scanRangeFrom;
        while (shouldSkip(_scanCurrentId) && !pastBound(_scanCurrentId)) _scanCurrentId += _scanDirection;
        if (pastBound(_scanCurrentId)) {
          // Skip the normal status refresh below — it would just overwrite this with the
          // generic "bezig bij id X" line.
          const statusEl = document.getElementById('__udb_range_status_line');
          if (statusEl) statusEl.textContent = 'Alle ids in ' + _scanRangeFrom + '–' + _scanRangeTo + ' staan al bekend — wacht op nieuwe...';
          return; // whole range already known — cheap no-op tick, tries again next interval
        }
      }
      id = _scanCurrentId;
      _scanCurrentId += _scanDirection;
      _scanRangeTotalScanned++;
      // Deliberately NOT added to _scanKnownIds here — that would mark it "known" the
      // instant it's merely probed, so the next lap would skip it even if it never actually
      // landed a `users` row. Only a CONFIRMED account (via the live users.created_at poll)
      // should ever get skipped; an unconfirmed id gets re-probed every lap until it is one.
      _enqueueScannedId(id);
      _updateRangePanelView();
    } else if (_scanQueue) {
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
    let s = _scanLastReplyId != null ? ' — laatste reply: id ' + _scanLastReplyId : '';
    if (_scanMode !== 'known') s += ' — ' + _scanNewCount + ' nieuw';
    return s;
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
  // catch unbans); 'start' = sequential sweep from id 1; 'custom' = jump to a given id;
  // 'range' = loop [rangeFrom, rangeTo] forever, `users`-only skip-set (see _scanTick).
  // 'start'/'range' still skip ids already known — only 'known' mode targets those on
  // purpose.
  async function _scanStart(mode, customId, direction, rangeFrom, rangeTo) {
    if (_scanActive) return;
    mode = mode || 'start';
    const btn = panel.querySelector('#__udb_scan_btn');
    if (btn) btn.disabled = true;
    const fetchStartedAt = new Date().toISOString();

    // Only reset position when the mode actually changes (or this is the first run) —
    // re-picking the SAME mode after a pause continues where it left off, but switching
    // modes (e.g. 'start' -> 'custom') must not inherit the other mode's scan position.
    // 'custom'/a fresh 'range' call always jump to the given id(s) — an explicit target
    // every time one is given.
    const isSameMode = _scanMode === mode;

    if (mode === 'range') {
      // Deliberately `users` only, never the scanned_ids union _fetchAllKnownIds() builds
      // for the other modes — see _scanTick's 'range' branch for why.
      const [userIds, blackholes] = await Promise.all([_fetchAllIds('users', 'type=eq.1'), _fetchBlackholes()]);
      _scanKnownIds = new Set(userIds);
      _scanBlackholes = blackholes;
      _scanQueue = null;
      if (rangeFrom != null) {
        _scanRangeFrom = rangeFrom;
        _scanRangeTo   = rangeTo;
        _scanDirection = rangeFrom <= rangeTo ? 1 : -1;
        _scanCurrentId = rangeFrom;
        _scanNewCount  = 0;
        _scanLapCount  = 1;
        _scanLapHistory = [];
        _scanCurrentLapNew = 0;
        _scanRangeTotalScanned = 0;
        _scanLastReplyId = null;
      }
      // Resuming (isSameMode, no fresh rangeFrom given) just keeps the saved position.
    } else {
      const known = await _fetchAllKnownIds();
      _scanKnownIds = known.all;
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
          _scanNewCount = 0;
        } else { // 'start'
          _scanDirection = 1;
          if (!isSameMode || _scanCurrentId === null) { _scanCurrentId = 1; _scanNewCount = 0; }
        }
      }
    }
    _scanMode = mode;
    if (btn) btn.disabled = false;

    _scanActive = true;
    if (btn) { btn.innerHTML = '&#9208;'; btn.title = 'Pause user-id scan'; }
    _logEvent('scan_start', mode + (window._selfName ? ' (' + window._selfName + ')' : ''));
    _scanSyncStart(fetchStartedAt);
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
    } else if (_scanMode !== 'range') {
      // 'range' mode's status lives in its own panel (#__udb_range_status_line) — the
      // header line stays blank for it instead of duplicating/lagging behind that.
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
    countEl.textContent = users.length.toLocaleString('nl-BE') + ' user' + (users.length !== 1 ? 's' : '') + (_all.length !== users.length ? ' of ' + _all.length.toLocaleString('nl-BE') : '');

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
      '#__udb_range{position:fixed;top:8px;right:664px;width:260px;z-index:1001;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__udb_range *{box-sizing:border-box}',
      '#__udb_range_form{padding:12px 14px;display:flex;flex-direction:column;gap:10px}',
      '#__udb_range_form label,#__udb_range_stats label{display:flex;flex-direction:column;gap:4px;font-size:10px;color:#82849a;font-weight:600}',
      '#__udb_range_form input,#__udb_range_stats input{background:#0A0B10;border:1px solid #23252f;border-radius:8px;color:#eceefb;padding:7px 9px;font-size:12px;outline:none;box-sizing:border-box}',
      '.__udb_range_start{all:unset;cursor:pointer;text-align:center;background:#A6B0FF;color:#0A0B10;font-size:11px;font-weight:700;padding:8px;border-radius:8px;box-sizing:border-box}',
      '.__udb_range_start:hover{filter:brightness(1.08)}',
      '.__udb_range_known{all:unset;cursor:pointer;text-align:center;font-size:10px;color:#82849a;padding:4px;box-sizing:border-box}',
      '.__udb_range_known:hover{color:#eceefb}',
      '#__udb_range_stats{padding:12px 14px;display:none;flex-direction:column;gap:8px;font-size:11px}',
      '#__udb_range_status_line{font-weight:700;color:#eceefb}',
      '#__udb_range_total_line{color:#82849a}',
      '.__udb_range_lap_current{color:#A6B0FF;font-weight:700}',
      '.__udb_range_lap_hist{max-height:140px;overflow-y:auto;display:flex;flex-direction:column;gap:3px;color:#82849a}',
      '.__udb_range_actions{display:flex;gap:8px;margin-top:4px}',
      '.__udb_range_actions button{all:unset;flex:1;cursor:pointer;text-align:center;font-size:11px;font-weight:700;padding:7px;border-radius:8px;box-sizing:border-box}',
      '.__udb_range_pause{background:#A6B0FF;color:#0A0B10}',
      '.__udb_range_pause:hover{filter:brightness(1.08)}',
      '.__udb_range_cancel{background:rgba(231,76,60,0.14);color:#e74c3c;border:1px solid rgba(231,76,60,0.3)!important}',
      '.__udb_range_cancel:hover{background:rgba(231,76,60,0.22)}',
      '#__udb_bh{position:fixed;top:8px;right:936px;width:240px;z-index:1001;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__udb_bh *{box-sizing:border-box}',
      '#__udb_bh_sub{padding:10px 14px;font-size:10px;color:#82849a;line-height:1.5;border-bottom:1px solid #23252f}',
      '#__udb_bh_list{max-height:280px;overflow-y:auto;display:flex;flex-direction:column;padding:10px 14px;gap:8px}',
      '.__udb_bh_row{display:flex;align-items:center;gap:6px}',
      '.__udb_bh_row span{color:#5c5e6b;font-size:11px}',
      '.__udb_bh_row input{width:0;flex:1;background:#0A0B10;border:1px solid #23252f;border-radius:8px;color:#eceefb;padding:6px 8px;font-size:12px;outline:none}',
      '.__udb_bh_del{all:unset;cursor:pointer;color:#5c5e6b;font-size:15px;line-height:1;padding:2px 4px}',
      '.__udb_bh_del:hover{color:#e74c3c}',
      '.__udb_bh_row.__udb_bh_saved input{border-color:#2ecc71!important;transition:border-color .15s}',
      '.__udb_bh_row.__udb_bh_save_err input{border-color:#e74c3c!important;transition:border-color .15s}',
      '.__udb_bh_add{all:unset;display:block;cursor:pointer;text-align:center;font-size:11px;font-weight:700;color:#A6B0FF;padding:10px 14px;box-sizing:border-box}',
      '.__udb_bh_add:hover{background:rgba(255,255,255,.05)}',
      '#__udb_scan_menu{position:fixed;z-index:1002;display:flex;flex-direction:column;background:#12131A;border:1px solid #23252f;border-radius:10px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;min-width:170px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}',
      '#__udb_scan_menu button{all:unset;box-sizing:border-box;display:block;width:100%;padding:9px 12px;font-size:11px;font-weight:600;color:#eceefb;cursor:pointer}',
      '#__udb_scan_menu button:hover{background:rgba(255,255,255,.06)}',
      '#__udb_scan_menu button+button{border-top:1px solid #23252f}',
      '#__udb_bc{position:fixed;top:8px;right:664px;width:280px;z-index:1001;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__udb_bc *{box-sizing:border-box}',
      '#__udb_bc_form{padding:12px 14px;display:flex;flex-direction:column;gap:10px}',
      '.__udb_bc_mode_row{display:flex;gap:14px;font-size:11px;color:#82849a}',
      '.__udb_bc_radio{display:flex;align-items:center;gap:5px;cursor:pointer}',
      '.__udb_bc_radio input{width:auto;accent-color:#6C7CFF;padding:0}',
      '#__udb_bc_input{width:100%;min-height:110px;resize:vertical;background:#0A0B10;border:1px solid #23252f;border-radius:8px;color:#eceefb;padding:8px 9px;font-size:11px;font-family:monospace;outline:none}',
      '#__udb_bc_input:focus{border-color:#6C7CFF}',
      '.__udb_bc_file_row{display:flex;align-items:center;gap:8px}',
      '.__udb_bc_file_status{font-size:10px;color:#5c5e6b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#__udb_bc_form label,#__udb_bc_stats label{display:flex;flex-direction:column;gap:4px;font-size:10px;color:#82849a;font-weight:600}',
      '#__udb_bc_form input,#__udb_bc_stats input{background:#0A0B10;border:1px solid #23252f;border-radius:8px;color:#eceefb;padding:7px 9px;font-size:12px;outline:none;box-sizing:border-box}',
      '#__udb_bc_stats{padding:12px 14px;display:none;flex-direction:column;gap:8px;font-size:11px}',
      '#__udb_bc_progress_line{font-weight:700;color:#eceefb}',
      '#__udb_bc_status_line{color:#A6B0FF;font-family:monospace;font-size:10px}',
      '.__udb_bc_results_hdr{font-size:9px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:#5c5e6b;margin-top:4px}',
      '#__udb_bc_results_list{max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:6px}',
      '.__udb_bc_row{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#1c1e2a;border:1px solid #23252f;border-radius:8px;padding:7px 9px}',
      '.__udb_bc_row_info{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.__udb_bc_row_id{font-size:11px;font-weight:700;color:#eceefb}',
      '.__udb_bc_row_name{font-size:10px;color:#82849a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.__udb_bc_open_btn{flex-shrink:0;margin-top:0!important}',
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
    panel.querySelector('#__udb_scan_btn').addEventListener('click', function(e) {
      e.stopPropagation();
      _scanMenuToggle();
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

  // ── Range-scan panel — single draggable panel, always reachable from the scan button,
  // replacing the old known/start/custom/cooldown dropdown plus the separate pause/resume
  // popup menus. Shows the from-id/to-id/cooldown form when there's no session yet; once
  // started it swaps to a live view (status, total scanned, lap breakdown) with its own
  // Pauzeer/Hervat and Afbreken buttons, so it never needs to be reopened to check on or
  // control a running scan.
  let rangePanel = null;

  function buildScanRangePanel() {
    rangePanel = document.createElement('div');
    rangePanel.id = '__udb_range';
    rangePanel.innerHTML =
      '<div class="__udb_card">'
      + '<div class="__udb_hdr" id="__udb_range_hdr">'
      + '<span class="__udb_eyebrow">Gheloo</span>'
      + '<span class="__udb_title">Scan van id tot id</span>'
      + '<span class="__udb_close" id="__udb_range_close">&times;</span>'
      + '</div>'
      + '<div id="__udb_range_form">'
      + '<label>Van id<input type="number" id="__udb_range_from" min="1" value="1"></label>'
      + '<label>Tot id<input type="number" id="__udb_range_to" min="1" placeholder="bv. 800000"></label>'
      + '<label>Cooldown tussen scans (ms)<input type="number" id="__udb_range_cooldown" min="' + SCAN_INTERVAL_MIN_MS + '"></label>'
      + '<button class="__udb_range_start" id="__udb_range_start_btn">Start</button>'
      + '<button class="__udb_range_known" id="__udb_range_known_btn">Of ververs bekende accounts i.p.v.</button>'
      + '</div>'
      + '<div id="__udb_range_stats">'
      + '<div id="__udb_range_status_line"></div>'
      + '<div id="__udb_range_total_line"></div>'
      + '<div id="__udb_range_last_reply_line"></div>'
      + '<div id="__udb_range_lap_current" class="__udb_range_lap_current"></div>'
      + '<div id="__udb_range_lap_hist" class="__udb_range_lap_hist"></div>'
      + '<label>Cooldown tussen scans (ms)<input type="number" id="__udb_range_cooldown_live" min="' + SCAN_INTERVAL_MIN_MS + '"></label>'
      + '<div class="__udb_range_actions">'
      + '<button class="__udb_range_pause" id="__udb_range_pause_btn">Pauzeer</button>'
      + '<button class="__udb_range_cancel" id="__udb_range_cancel_btn">Afbreken</button>'
      + '</div>'
      + '</div>'
      + '<button class="__udb_range_known" id="__udb_range_blackholes_btn">Blackholes</button>'
      + '</div>';
    document.body.appendChild(rangePanel);
    rangePanel.style.display = 'none';

    window.__ghk_makeDraggable(rangePanel, rangePanel.querySelector('#__udb_range_hdr'), '__ghk_udb_range_pos', function(e) {
      return e.target.id === '__udb_range_close';
    });
    rangePanel.querySelector('#__udb_range_close').addEventListener('click', function() {
      rangePanel.style.display = 'none';
    });
    rangePanel.querySelector('#__udb_range_blackholes_btn').addEventListener('click', function() {
      _toggleBlackholesPanel();
    });
    rangePanel.querySelector('#__udb_range_start_btn').addEventListener('click', function() {
      const from = parseInt(document.getElementById('__udb_range_from').value, 10);
      const to = parseInt(document.getElementById('__udb_range_to').value, 10);
      const cooldown = parseInt(document.getElementById('__udb_range_cooldown').value, 10);
      if (!from || from < 1 || !to || to < 1) { window.alert('Vul een geldig van-id en tot-id in.'); return; }
      if (cooldown) _setScanIntervalMs(cooldown);
      _showRangeLoading();
      _scanStart('range', null, null, from, to).then(_updateRangePanelView);
    });
    rangePanel.querySelector('#__udb_range_cooldown_live').addEventListener('change', function(e) {
      const ms = parseInt(e.target.value, 10);
      if (ms) _setScanIntervalMs(ms); // live-applies immediately, even while active — see _setScanIntervalMs
    });
    rangePanel.querySelector('#__udb_range_known_btn').addEventListener('click', function() {
      rangePanel.style.display = 'none';
      _scanStart('known');
    });
    rangePanel.querySelector('#__udb_range_pause_btn').addEventListener('click', function() {
      if (_scanActive) { _scanStop(); _updateRangePanelView(); return; }
      _showRangeLoading();
      _scanStart('range').then(_updateRangePanelView);
    });
    rangePanel.querySelector('#__udb_range_cancel_btn').addEventListener('click', function() {
      _scanCancel();
      _updateRangePanelView();
    });
  }

  // _scanStart's own known-ids fetch (hundreds of thousands of rows) can take a few
  // seconds with no other feedback in between — swap to the stats view immediately on
  // click instead of leaving the panel looking unresponsive until it resolves.
  function _showRangeLoading() {
    document.getElementById('__udb_range_form').style.display = 'none';
    const statsEl = document.getElementById('__udb_range_stats');
    statsEl.style.display = 'flex';
    document.getElementById('__udb_range_status_line').textContent = 'Gelogde ids laden...';
    document.getElementById('__udb_range_total_line').textContent = '';
    document.getElementById('__udb_range_last_reply_line').textContent = '';
    document.getElementById('__udb_range_lap_current').textContent = '';
    document.getElementById('__udb_range_lap_hist').innerHTML = '';
  }

  // Decides form-vs-live-stats and refreshes every stat in the live view — called on every
  // open, and on every tick/reply/pause/resume/cancel while the panel might be showing.
  function _updateRangePanelView() {
    if (!rangePanel) return;
    const hasSession = _scanMode === 'range' && _scanCurrentId !== null;
    document.getElementById('__udb_range_form').style.display = hasSession ? 'none' : 'flex';
    document.getElementById('__udb_range_stats').style.display = hasSession ? 'flex' : 'none';
    if (!hasSession) return;
    document.getElementById('__udb_range_status_line').textContent =
      (_scanActive ? 'Actief' : 'Gepauzeerd') + ' — bezig bij id ' + _scanCurrentId + ' (' + _scanRangeFrom + '–' + _scanRangeTo + ')';
    document.getElementById('__udb_range_total_line').textContent = _scanRangeTotalScanned + ' id(s) gescand in totaal';
    document.getElementById('__udb_range_last_reply_line').textContent =
      _scanLastReplyId != null ? 'Laatste gelogde id: ' + _scanLastReplyId : 'Nog geen reply ontvangen.';
    document.getElementById('__udb_range_lap_current').textContent =
      'Loop ' + _scanLapCount + ' bezig — ' + _scanCurrentLapNew + ' nieuw deze loop';
    document.getElementById('__udb_range_lap_hist').innerHTML = _scanLapHistory.map(function(n, i) {
      return '<div>Loop ' + (i + 1) + ': ' + n + ' nieuw</div>';
    }).join('');
    document.getElementById('__udb_range_pause_btn').textContent = _scanActive ? 'Pauzeer' : 'Hervat';
    // Don't stomp on it while the user is actively typing a new value into it.
    const cooldownEl = document.getElementById('__udb_range_cooldown_live');
    if (document.activeElement !== cooldownEl) cooldownEl.value = _scanIntervalMs;
  }

  function _scanTogglePanel() {
    if (!rangePanel) return;
    if (rangePanel.style.display !== 'none') { rangePanel.style.display = 'none'; return; }
    if (!(_scanMode === 'range' && _scanCurrentId !== null)) document.getElementById('__udb_range_cooldown').value = _scanIntervalMs;
    _updateRangePanelView();
    rangePanel.style.display = 'flex';
  }

  // ── Blackholes panel — manually-declared id ranges every scanner always skips, on top
  // of `users`. Draggable, own panel (matches ncPanel/acPanel), rows are (from, to) pairs
  // saved on change; a row without a saved id yet becomes a real row the first time both
  // fields have a value. Polls scan_blackholes every 3s while open so an edit from another
  // account/tab shows up here too, without stomping a row mid-edit.
  let bhPanel = null;
  let _bhPollTimer = null;
  let bcPanel = null;

  function _renderBlackholeRow(bh) {
    const row = document.createElement('div');
    row.className = '__udb_bh_row';
    if (bh.id != null) row.dataset.id = bh.id;
    row.innerHTML =
      '<input type="number" class="__udb_bh_from" placeholder="Van id" value="' + (bh.from != null ? bh.from : '') + '">'
      + '<span>–</span>'
      + '<input type="number" class="__udb_bh_to" placeholder="Tot id" value="' + (bh.to != null ? bh.to : '') + '">'
      + '<button class="__udb_bh_del" title="Verwijder">&times;</button>';
    document.getElementById('__udb_bh_list').appendChild(row);
  }

  // Local cache is a display/resilience aid only — the DB is still the one source of
  // truth every scanner reads from. Lets the panel show something instantly on open (and
  // on a relog) before the network fetch resolves, instead of a blank list.
  const BH_CACHE_KEY = 'gheloo_udb_blackholes_cache_v1';
  function _cacheBlackholesLocally(list) {
    try { localStorage.setItem(BH_CACHE_KEY, JSON.stringify(list)); } catch (e) {}
  }
  function _loadCachedBlackholesLocally() {
    try { return JSON.parse(localStorage.getItem(BH_CACHE_KEY) || '[]'); } catch (e) { return []; }
  }

  async function _saveBlackholeRow(row) {
    const from = parseInt(row.querySelector('.__udb_bh_from').value, 10);
    const to = parseInt(row.querySelector('.__udb_bh_to').value, 10);
    if (!from || !to) return;
    row.classList.remove('__udb_bh_saved', '__udb_bh_save_err');
    let ok = false;
    try {
      if (row.dataset.id) {
        const res = await fetch(SUPABASE_URL + '/rest/v1/scan_blackholes?id=eq.' + row.dataset.id, {
          method: 'PATCH', headers: HEADERS, body: JSON.stringify({ range_from: from, range_to: to }),
        });
        ok = res.ok;
        if (!ok) _log('blackhole PATCH failed: HTTP ' + res.status + ' ' + (await res.text().catch(function() { return ''; })));
      } else {
        const res = await fetch(SUPABASE_URL + '/rest/v1/scan_blackholes', {
          method: 'POST', headers: Object.assign({}, HEADERS, { 'Prefer': 'return=representation' }),
          body: JSON.stringify([{ range_from: from, range_to: to }]),
        });
        ok = res.ok;
        if (ok) {
          const saved = await res.json();
          if (saved && saved[0]) row.dataset.id = saved[0].id;
        } else {
          _log('blackhole POST failed: HTTP ' + res.status + ' ' + (await res.text().catch(function() { return ''; })));
        }
      }
    } catch (e) { ok = false; _log('blackhole save threw: ' + e.message); }
    // Visible confirmation either way — silently trusting a save that never actually
    // landed (found live 2026-08-30: a "saved-looking" row with 0 rows in the real table)
    // is exactly how this went unnoticed before.
    row.classList.add(ok ? '__udb_bh_saved' : '__udb_bh_save_err');
    if (ok) {
      setTimeout(function() { row.classList.remove('__udb_bh_saved'); }, 1200);
      _cacheBlackholesLocally(await _fetchBlackholes());
    }
  }

  async function _loadBlackholesListUI() {
    const list = document.getElementById('__udb_bh_list');
    if (!list || list.contains(document.activeElement)) return; // mid-edit — don't yank focus
    // Own fetch (not _fetchBlackholes, which swallows failures into []) — a transient
    // network hiccup on this 3s poll must leave the list untouched, not wipe it to empty.
    let rows;
    try {
      const res = await fetch(SUPABASE_URL + '/rest/v1/scan_blackholes?select=id,range_from,range_to&order=id.asc', { headers: HEADERS });
      if (!res.ok) return;
      rows = (await res.json()).map(function(r) { return { id: r.id, from: r.range_from, to: r.range_to }; });
    } catch (e) { return; }
    _cacheBlackholesLocally(rows);
    // A row with no data-id was never actually saved (e.g. only one field filled in so
    // far) — rebuilding from the DB would otherwise silently discard it mid-entry. Detach
    // and re-append those instead of losing them.
    const unsaved = Array.from(list.querySelectorAll('.__udb_bh_row:not([data-id])'));
    list.innerHTML = '';
    rows.forEach(function(bh) { _renderBlackholeRow(bh); });
    unsaved.forEach(function(row) { list.appendChild(row); });
  }

  function buildBlackholesPanel() {
    bhPanel = document.createElement('div');
    bhPanel.id = '__udb_bh';
    bhPanel.innerHTML =
      '<div class="__udb_card">'
      + '<div class="__udb_hdr" id="__udb_bh_hdr">'
      + '<span class="__udb_eyebrow">Gheloo</span>'
      + '<span class="__udb_title">Blackholes</span>'
      + '<span class="__udb_close" id="__udb_bh_close">&times;</span>'
      + '</div>'
      + '<div id="__udb_bh_sub">Id-bereiken die elke scan altijd overslaat — gedeeld tussen alle accounts.</div>'
      + '<div id="__udb_bh_list"></div>'
      + '<button class="__udb_bh_add" id="__udb_bh_add_btn">+ Bereik toevoegen</button>'
      + '</div>';
    document.body.appendChild(bhPanel);
    bhPanel.style.display = 'none';

    window.__ghk_makeDraggable(bhPanel, bhPanel.querySelector('#__udb_bh_hdr'), '__ghk_udb_bh_pos', function(e) {
      return e.target.id === '__udb_bh_close';
    });
    bhPanel.querySelector('#__udb_bh_close').addEventListener('click', function() {
      bhPanel.style.display = 'none';
      if (_bhPollTimer) { clearInterval(_bhPollTimer); _bhPollTimer = null; }
    });
    bhPanel.querySelector('#__udb_bh_add_btn').addEventListener('click', function() {
      _renderBlackholeRow({ id: null, from: null, to: null });
    });
    // 'input' + a short debounce instead of 'change' — 'change' only fires on blur, which
    // turned out unreliable for actually triggering a save (found live 2026-08-30: a row
    // that looked filled in and saved had 0 matching rows in the real table). This fires
    // purely off typing, no dependency on how/whether focus ever left the field.
    const bhSaveTimers = new WeakMap();
    bhPanel.querySelector('#__udb_bh_list').addEventListener('input', function(e) {
      const row = e.target.closest('.__udb_bh_row');
      if (!row) return;
      clearTimeout(bhSaveTimers.get(row));
      bhSaveTimers.set(row, setTimeout(function() { _saveBlackholeRow(row); }, 600));
    });
    bhPanel.querySelector('#__udb_bh_list').addEventListener('click', function(e) {
      const delBtn = e.target.closest('.__udb_bh_del');
      if (!delBtn) return;
      const row = delBtn.closest('.__udb_bh_row');
      if (row.dataset.id) {
        fetch(SUPABASE_URL + '/rest/v1/scan_blackholes?id=eq.' + row.dataset.id, { method: 'DELETE', headers: HEADERS }).catch(function() {});
      }
      row.remove();
    });
  }

  function _toggleBlackholesPanel() {
    if (!bhPanel) return;
    if (bhPanel.style.display !== 'none') {
      bhPanel.style.display = 'none';
      if (_bhPollTimer) { clearInterval(_bhPollTimer); _bhPollTimer = null; }
      return;
    }
    // Instant paint from the local cache (survives a relog) while the real fetch is in
    // flight, instead of a blank list for that first moment.
    const list = document.getElementById('__udb_bh_list');
    list.innerHTML = '';
    _loadCachedBlackholesLocally().forEach(function(bh) { _renderBlackholeRow(bh); });
    bhPanel.style.display = 'flex';
    _loadBlackholesListUI();
    if (_bhPollTimer) clearInterval(_bhPollTimer);
    _bhPollTimer = setInterval(_loadBlackholesListUI, 3000);
  }

  // ── Ban Checker ──────────────────────────────────────────────────────────────────
  // Separate from the id-discovery scanner above: given an explicit, fixed list of ids
  // (typed in or pasted, e.g. straight from a userlogger export), probes each one via
  // GetExtendedProfile and decides hit/miss per id instead of walking a range. A miss
  // gets retried (same id re-sent) up to 5 attempts total before being written off as
  // banned/deleted — a reply on attempt 2 or 3 counts as a normal hit, only silence
  // across all 5 lands it in the results list.
  const BC_DELAY_KEY = 'gheloo_udb_bc_delay_ms';
  const BC_ATTEMPTS_KEY = 'gheloo_udb_bc_attempts';
  let _bcDelayMs = parseInt(localStorage.getItem(BC_DELAY_KEY), 10) || 300;
  if (_bcDelayMs < SCAN_INTERVAL_MIN_MS) _bcDelayMs = SCAN_INTERVAL_MIN_MS;
  let _bcMaxAttempts = parseInt(localStorage.getItem(BC_ATTEMPTS_KEY), 10) || 5;
  if (_bcMaxAttempts < 1) _bcMaxAttempts = 1;

  let _bcQueue      = [];   // [{id, name|null}]
  let _bcIdx        = 0;
  let _bcActive     = false;
  let _bcResults    = [];   // entries from _bcQueue that never replied within BC_MAX_ATTEMPTS
  let _bcWaitingId  = null; // id the current attempt's wait is listening for
  let _bcGotReply   = false;
  // ids currently re-probed via a result row's "Open profile" button — a reply for one
  // of these means the original 5-miss verdict was just lag, not an actual ban, so that
  // row gets pulled back out of the results list instead of staying flagged forever.
  const _bcRecheckWaiting = new Set();
  let _bcSkippedNames = []; // 'names' mode: pasted names never found on userlogger at all

  function _setBcDelayMs(ms) {
    ms = parseInt(ms, 10);
    if (!ms || ms < SCAN_INTERVAL_MIN_MS) ms = SCAN_INTERVAL_MIN_MS;
    _bcDelayMs = ms;
    localStorage.setItem(BC_DELAY_KEY, String(ms));
  }

  function _setBcMaxAttempts(n) {
    n = parseInt(n, 10);
    if (!n || n < 1) n = 1;
    _bcMaxAttempts = n;
    localStorage.setItem(BC_ATTEMPTS_KEY, String(n));
    const hdr = bcPanel && bcPanel.querySelector('#__udb_bc_results_hdr');
    if (hdr) hdr.textContent = 'Niet gevonden (' + _bcMaxAttempts + '/' + _bcMaxAttempts + ' gemist)';
  }

  // Own listener, independent of the id-discovery scanner's — window.onPacket supports
  // any number of listeners per packet name (see core/ws.js), so this doesn't disturb
  // the existing ExtendedProfile handling above or in core/supabase.js.
  window.onPacket('ExtendedProfile', function(p) {
    if (!p.parsed) return;
    if (_bcWaitingId != null && p.parsed.id === _bcWaitingId) _bcGotReply = true;
    if (_bcRecheckWaiting.has(p.parsed.id)) {
      _bcRecheckWaiting.delete(p.parsed.id);
      const idx = _bcResults.findIndex(function(r) { return r.id === p.parsed.id; });
      if (idx !== -1) {
        _bcResults.splice(idx, 1);
        _bcRenderResults();
        _bcRenderProgress();
      }
    }
  });

  // 'ids' mode: accepts bare ids (one per line) or "name<TAB>id" / "id<TAB>name" pairs —
  // exactly the shape of a userdb TSV export. Whichever token on the line is purely
  // digits is taken as the id; whatever's left (if anything) becomes the display name.
  // A line with no numeric token (e.g. a "username\tid" header row) is silently dropped.
  // 'names' mode: every line is a plain username (first tab-separated column if there
  // happen to be more, e.g. pasting a full accounts-site export) — no id yet, that gets
  // resolved against userlogger by _bcResolveNames before the check actually starts.
  // The two modes exist because a habbo name can itself be all-digits (seen live in a
  // real accounts export, e.g. "124120559191220") — indistinguishable from a real id by
  // pattern alone, so guessing silently probed that number as if it were one and always
  // missed. Letting the user say which the list actually is avoids that misread.
  function _bcParseInput(text, mode) {
    const out = [];
    (text || '').split(/\r?\n/).forEach(function(line) {
      line = line.trim();
      if (!line) return;
      if (mode === 'names') {
        const name = line.split(/\t/)[0].trim();
        if (name) out.push({ id: null, name: name });
        return;
      }
      const tokens = line.split(/\t+|\s{2,}|,/).map(function(t) { return t.trim(); }).filter(Boolean);
      const parts = tokens.length > 1 ? tokens : line.split(/\s+/);
      let id = null;
      const nameParts = [];
      parts.forEach(function(t) {
        if (id === null && /^\d+$/.test(t)) id = parseInt(t, 10);
        else if (t) nameParts.push(t);
      });
      if (id !== null) out.push({ id: id, name: nameParts.join(' ') || null });
    });
    return out;
  }

  // Resolves every id-less {name} entry against userlogger's own users table (same
  // SUPABASE_URL/HEADERS this file already talks to for everything else) — batched, with
  // a short pause between batches so a long pasted list doesn't fire dozens of requests
  // back to back. Returns the ones that matched (with their real id filled in) separately
  // from the ones that don't exist there at all, so those can be reported instead of
  // silently probed with no id and instantly "found" as banned.
  const BC_RESOLVE_BATCH = 40;
  const BC_RESOLVE_GAP_MS = 200;
  async function _bcResolveNames(entries) {
    const already = entries.filter(function(e) { return e.id != null; });
    const toResolve = entries.filter(function(e) { return e.id == null && e.name; });
    if (!toResolve.length) return { resolved: already, unresolved: [] };

    const foundId = new Map();
    for (let i = 0; i < toResolve.length; i += BC_RESOLVE_BATCH) {
      const batch = toResolve.slice(i, i + BC_RESOLVE_BATCH);
      _bcSetStatus('Ids opzoeken op userlogger… (' + Math.min(i + BC_RESOLVE_BATCH, toResolve.length) + '/' + toResolve.length + ')');
      const filt = 'in.(' + batch.map(function(e) { return '"' + e.name.replace(/"/g, '""') + '"'; }).join(',') + ')';
      try {
        const res = await fetch(SUPABASE_URL + '/rest/v1/users?select=id,name&name=' + encodeURIComponent(filt), { headers: HEADERS });
        if (res.ok) {
          const rows = await res.json();
          rows.forEach(function(r) { foundId.set(r.name, r.id); });
        } else {
          _log('ban-check name resolve failed: HTTP ' + res.status);
        }
      } catch (e) { _log('ban-check name resolve failed: ' + e.message); }
      if (i + BC_RESOLVE_BATCH < toResolve.length) await _bcSleep(BC_RESOLVE_GAP_MS);
    }

    const resolved = already.slice();
    const unresolved = [];
    toResolve.forEach(function(e) {
      const id = foundId.get(e.name);
      if (id != null) resolved.push({ id: id, name: e.name });
      else unresolved.push(e);
    });
    return { resolved: resolved, unresolved: unresolved };
  }

  function _bcSleep(ms) { return new Promise(function(res) { setTimeout(res, ms); }); }

  // One id, up to BC_MAX_ATTEMPTS probes. Resolves true on any reply (first attempt or
  // a retry), false only after every attempt went unanswered. Bails out (treated as an
  // an inconclusive "true"/skip, never recorded as banned) if the ban check was paused
  // mid-wait, or if the packet isn't available at all.
  async function _bcCheckOne(id) {
    const pid = _outId('GetExtendedProfile');
    if (pid === null) {
      _log('GetExtendedProfile not found in PKT — is the game connected?');
      _bcActive = false;
      return true;
    }
    for (let attempt = 1; attempt <= _bcMaxAttempts; attempt++) {
      if (!_bcActive) return true;
      _bcWaitingId = id;
      _bcGotReply = false;
      window.sendPacket('OUT', pid, '{i:' + id + '}{b:false}');
      _bcSetStatus('Checken id ' + id + ' — poging ' + attempt + '/' + _bcMaxAttempts + '…');
      await _bcSleep(_bcDelayMs);
      if (_bcGotReply) { _bcWaitingId = null; return true; }
    }
    _bcWaitingId = null;
    return false;
  }

  async function _bcRun() {
    while (_bcActive && _bcIdx < _bcQueue.length) {
      const item = _bcQueue[_bcIdx];
      const ok = await _bcCheckOne(item.id);
      if (!_bcActive) break; // paused mid-check — don't count this one either way
      if (!ok) { _bcResults.push(item); _bcRenderResults(); }
      _bcIdx++;
      _bcRenderProgress();
    }
    if (_bcActive && _bcIdx >= _bcQueue.length) {
      _bcActive = false;
      _bcUpdateButtons();
      _bcSetStatus('Klaar — ' + _bcQueue.length + ' id(s) gecheckt, ' + _bcResults.length + ' niet gevonden.');
    }
  }

  function _bcSetStatus(text) {
    const el = bcPanel && bcPanel.querySelector('#__udb_bc_status_line');
    if (el) el.textContent = text || '';
  }

  function _bcRenderProgress() {
    const el = bcPanel && bcPanel.querySelector('#__udb_bc_progress_line');
    if (!el) return;
    let text = _bcIdx + ' / ' + _bcQueue.length + ' gecheckt — ' + _bcResults.length + ' niet gevonden';
    if (_bcSkippedNames.length) text += ' — ' + _bcSkippedNames.length + ' naam/namen niet op userlogger (overgeslagen)';
    el.textContent = text;
  }

  function _bcRenderResults() {
    const listEl = bcPanel && bcPanel.querySelector('#__udb_bc_results_list');
    if (!listEl) return;
    if (!_bcResults.length) { listEl.innerHTML = '<div class="__udb_empty_sm">Nog niets gevonden.</div>'; return; }
    listEl.innerHTML = _bcResults.slice().reverse().map(function(r) {
      return '<div class="__udb_bc_row">'
        + '<div class="__udb_bc_row_info">'
        + '<span class="__udb_bc_row_id">#' + r.id + '</span>'
        + (r.name ? '<span class="__udb_bc_row_name">' + _esc(r.name) + '</span>' : '')
        + '</div>'
        + '<button class="__udb_ac_btn __udb_bc_open_btn" data-id="' + r.id + '" title="Stuur GetExtendedProfile met b:true — opent het profiel in-game">' + _ICON_PERSON + ' Open profile</button>'
        + '</div>';
    }).join('');
  }

  function _bcUpdateButtons() {
    if (!bcPanel) return;
    bcPanel.querySelector('#__udb_bc_pause_btn').textContent = _bcActive ? 'Pauzeer' : 'Hervat';
  }

  function _bcStart(queue) {
    if (queue) { _bcQueue = queue; _bcIdx = 0; _bcResults = []; }
    if (!_bcQueue.length) return;
    _bcActive = true;
    _bcUpdateButtons();
    _bcRun();
  }

  function _bcPause() {
    _bcActive = false;
    _bcWaitingId = null;
    _bcUpdateButtons();
    _bcSetStatus('Gepauzeerd — ' + _bcIdx + '/' + _bcQueue.length + ' gecheckt.');
  }

  function _bcCancel() {
    _bcActive = false;
    _bcWaitingId = null;
    _bcQueue = [];
    _bcIdx = 0;
    _bcResults = [];
    _bcSkippedNames = [];
    if (!bcPanel) return;
    bcPanel.querySelector('#__udb_bc_form').style.display = 'flex';
    bcPanel.querySelector('#__udb_bc_stats').style.display = 'none';
  }

  function buildBanCheckPanel() {
    bcPanel = document.createElement('div');
    bcPanel.id = '__udb_bc';
    bcPanel.innerHTML =
      '<div class="__udb_card">'
      + '<div class="__udb_hdr" id="__udb_bc_hdr">'
      + '<span class="__udb_eyebrow">Gheloo</span>'
      + '<span class="__udb_title">Ban Checker</span>'
      + '<span class="__udb_close" id="__udb_bc_close">&times;</span>'
      + '</div>'
      + '<div id="__udb_bc_form">'
      + '<div class="__udb_bc_mode_row">'
      + '<label class="__udb_bc_radio"><input type="radio" name="__udb_bc_mode" value="ids" checked> Ids</label>'
      + '<label class="__udb_bc_radio"><input type="radio" name="__udb_bc_mode" value="names"> Namen <span style="opacity:.6">(opzoeken via userlogger)</span></label>'
      + '</div>'
      + '<textarea id="__udb_bc_input" placeholder="Bij \'Ids\': ids, of een lijst als &#10;naam[TAB]id&#10;per regel.&#10;Bij \'Namen\': gewoon een lijst usernames, één per regel."></textarea>'
      + '<div class="__udb_bc_file_row">'
      + '<input type="file" id="__udb_bc_file" accept=".txt,.tsv,.csv" style="display:none">'
      + '<button class="__udb_range_known" id="__udb_bc_file_btn" type="button">Upload .txt</button>'
      + '<span class="__udb_bc_file_status" id="__udb_bc_file_status"></span>'
      + '</div>'
      + '<label>Delay tussen pogingen (ms)<input type="number" id="__udb_bc_delay" min="' + SCAN_INTERVAL_MIN_MS + '" value="' + _bcDelayMs + '"></label>'
      + '<label>Aantal pogingen voor "niet gevonden"<input type="number" id="__udb_bc_attempts" min="1" value="' + _bcMaxAttempts + '"></label>'
      + '<button class="__udb_range_start" id="__udb_bc_start_btn">Start</button>'
      + '</div>'
      + '<div id="__udb_bc_stats">'
      + '<div id="__udb_bc_progress_line"></div>'
      + '<div id="__udb_bc_status_line"></div>'
      + '<label>Delay tussen pogingen (ms)<input type="number" id="__udb_bc_delay_live" min="' + SCAN_INTERVAL_MIN_MS + '"></label>'
      + '<label>Aantal pogingen voor "niet gevonden"<input type="number" id="__udb_bc_attempts_live" min="1"></label>'
      + '<div class="__udb_range_actions">'
      + '<button class="__udb_range_pause" id="__udb_bc_pause_btn">Pauzeer</button>'
      + '<button class="__udb_range_cancel" id="__udb_bc_cancel_btn">Afbreken</button>'
      + '</div>'
      + '<div class="__udb_bc_results_hdr" id="__udb_bc_results_hdr">Niet gevonden (' + _bcMaxAttempts + '/' + _bcMaxAttempts + ' gemist)</div>'
      + '<div id="__udb_bc_results_list"></div>'
      + '</div>'
      + '</div>';
    document.body.appendChild(bcPanel);
    bcPanel.style.display = 'none';
    bcPanel.querySelector('#__udb_bc_stats').style.display = 'none';

    window.__ghk_makeDraggable(bcPanel, bcPanel.querySelector('#__udb_bc_hdr'), '__ghk_udb_bc_pos', function(e) {
      return e.target.id === '__udb_bc_close';
    });
    bcPanel.querySelector('#__udb_bc_close').addEventListener('click', function() { bcPanel.style.display = 'none'; });

    bcPanel.querySelector('#__udb_bc_file_btn').addEventListener('click', function() {
      bcPanel.querySelector('#__udb_bc_file').click();
    });
    bcPanel.querySelector('#__udb_bc_file').addEventListener('change', function(e) {
      const file = e.target.files[0];
      if (!file) return;
      const statusEl = bcPanel.querySelector('#__udb_bc_file_status');
      file.text().then(function(text) {
        const ta = bcPanel.querySelector('#__udb_bc_input');
        ta.value = ta.value.trim() ? ta.value.trim() + '\n' + text : text;
        if (statusEl) statusEl.textContent = file.name + ' toegevoegd.';
      });
      e.target.value = '';
    });

    bcPanel.querySelector('#__udb_bc_start_btn').addEventListener('click', async function() {
      const delay = parseInt(bcPanel.querySelector('#__udb_bc_delay').value, 10);
      if (delay) _setBcDelayMs(delay);
      const attempts = parseInt(bcPanel.querySelector('#__udb_bc_attempts').value, 10);
      if (attempts) _setBcMaxAttempts(attempts);
      const mode = (bcPanel.querySelector('input[name="__udb_bc_mode"]:checked') || {}).value || 'ids';
      let queue = _bcParseInput(bcPanel.querySelector('#__udb_bc_input').value, mode);
      if (!queue.length) { window.alert('Geen geldige regels gevonden in de lijst.'); return; }

      bcPanel.querySelector('#__udb_bc_form').style.display = 'none';
      bcPanel.querySelector('#__udb_bc_stats').style.display = 'flex';
      bcPanel.querySelector('#__udb_bc_delay_live').value = _bcDelayMs;
      bcPanel.querySelector('#__udb_bc_attempts_live').value = _bcMaxAttempts;
      _bcRenderResults();
      _bcRenderProgress();

      _bcSkippedNames = [];
      if (mode === 'names') {
        const { resolved, unresolved } = await _bcResolveNames(queue);
        queue = resolved;
        _bcSkippedNames = unresolved;
        _bcRenderProgress();
        if (!queue.length) {
          bcPanel.querySelector('#__udb_bc_form').style.display = 'flex';
          bcPanel.querySelector('#__udb_bc_stats').style.display = 'none';
          window.alert('Geen van deze namen gevonden op userlogger.');
          return;
        }
      }
      _bcStart(queue);
    });
    bcPanel.querySelector('#__udb_bc_delay_live').addEventListener('change', function(e) {
      const ms = parseInt(e.target.value, 10);
      if (ms) _setBcDelayMs(ms);
    });
    bcPanel.querySelector('#__udb_bc_attempts_live').addEventListener('change', function(e) {
      const n = parseInt(e.target.value, 10);
      if (n) _setBcMaxAttempts(n);
    });
    bcPanel.querySelector('#__udb_bc_pause_btn').addEventListener('click', function() {
      if (_bcActive) { _bcPause(); return; }
      _bcStart(null);
    });
    bcPanel.querySelector('#__udb_bc_cancel_btn').addEventListener('click', function() { _bcCancel(); });
    bcPanel.querySelector('#__udb_bc_results_list').addEventListener('click', function(e) {
      const btn = e.target.closest('.__udb_bc_open_btn');
      if (!btn) return;
      const id = parseInt(btn.dataset.id, 10);
      // If this re-probe actually gets a reply, that means the original 5-miss verdict
      // was just lag — pull the row back out (see the ExtendedProfile listener above).
      _bcRecheckWaiting.add(id);
      setTimeout(function() { _bcRecheckWaiting.delete(id); }, 5000);
      _profileCheck(id);
    });
  }

  function _banCheckTogglePanel() {
    if (!bcPanel) return;
    if (bcPanel.style.display !== 'none') { bcPanel.style.display = 'none'; return; }
    bcPanel.style.display = 'flex';
  }

  // ── Scan mode chooser — the scan button opens this tiny menu instead of jumping
  // straight into the id-discovery scanner, since there are now two different scanners
  // behind it.
  let scanMenu = null;
  function _buildScanMenu() {
    scanMenu = document.createElement('div');
    scanMenu.id = '__udb_scan_menu';
    scanMenu.innerHTML =
      '<button id="__udb_scan_menu_default">Standaard scanner</button>'
      + '<button id="__udb_scan_menu_bc">Ban checker</button>';
    document.body.appendChild(scanMenu);
    scanMenu.style.display = 'none';
    scanMenu.querySelector('#__udb_scan_menu_default').addEventListener('click', function() {
      scanMenu.style.display = 'none';
      _scanTogglePanel();
    });
    scanMenu.querySelector('#__udb_scan_menu_bc').addEventListener('click', function() {
      scanMenu.style.display = 'none';
      _banCheckTogglePanel();
    });
    document.addEventListener('mousedown', function(e) {
      if (scanMenu.style.display === 'none') return;
      if (e.target === scanMenu || scanMenu.contains(e.target)) return;
      if (e.target.id === '__udb_scan_btn') return;
      scanMenu.style.display = 'none';
    });
  }
  function _scanMenuToggle() {
    if (!scanMenu) _buildScanMenu();
    if (scanMenu.style.display !== 'none') { scanMenu.style.display = 'none'; return; }
    const btn = panel.querySelector('#__udb_scan_btn');
    const rect = btn.getBoundingClientRect();
    scanMenu.style.top = (rect.bottom + 4) + 'px';
    scanMenu.style.left = Math.max(8, rect.right - 170) + 'px';
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
    _scanRangeFrom = null;
    _scanRangeTo = null;
    _scanLapCount = 0;
    _scanLapHistory = [];
    _scanCurrentLapNew = 0;
    _scanRangeTotalScanned = 0;
    _scanSetStatus('Geannuleerd.');
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
    buildScanRangePanel();
    buildBlackholesPanel();
    buildBanCheckPanel();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(init); });
  } else {
    window.__ghk_ready(init);
  }
})();
