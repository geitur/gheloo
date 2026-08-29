(function() {
  // Self-hosted Postgres + PostgREST (no Kong/Auth/Realtime/Storage — just the two
  // containers), replacing Supabase's managed free tier (500MB cap) with a 200GB Oracle
  // Cloud Always Free VM. Runs on 141.148.224.129, project dir ~/gheloo-db on that VM
  // (docker-compose.yml + init.sql there define the two services and schema). Caddy
  // (/etc/caddy/Caddyfile on the VM) terminates TLS and strips the "/rest/v1" prefix
  // before proxying to PostgREST on :3000 — that's why this still hits /rest/v1/* even
  // though bare PostgREST itself serves routes at root. SUPABASE_ANON_KEY below is a
  // hand-minted HS256 JWT ({"role":"anon", exp far in the future}) signed with the
  // JWT_SECRET in that VM's .env — if the secret ever needs rotating, regenerate with
  // the same openssl+bash recipe used originally (hash header+payload with
  // `openssl dgst -sha256 -hmac "$JWT_SECRET"`, base64url all three parts). Schema
  // changes: `docker exec -it gheloo-db-db-1 psql -U postgres -c "ALTER TABLE ..."`,
  // then `docker compose restart postgrest` (it caches the schema, won't see new columns
  // until restarted).
  var SUPABASE_URL      = 'https://userlogger.databin.uk';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6ImdoZWxvby1zZWxmaG9zdCIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwfQ.9uAMhqRJOL-m_xtTO5duAUOAw-4pKk4LEENcT47crXU';

  if (SUPABASE_URL.indexOf('YOUR_PROJECT') !== -1) {
    console.warn('[Supabase] fill in SUPABASE_URL and SUPABASE_ANON_KEY in supabase.js');
    return;
  }

  // Persistent local outbox instead of firing straight to the network: every user gets
  // logged into localStorage immediately (survives a page reload, never lost), then a
  // drain loop sends them to the DB one at a time at a fixed ~10/sec pace, only removing
  // an entry once its upsert is *confirmed* successful. A burst of packets (busy room,
  // fast ID scan, a background tab dumping queued ticks after being foregrounded) used to
  // fire dozens of concurrent requests at the self-hosted PostgREST's small connection
  // pool on that tiny 1-core VM — that wedged the API for everyone twice (2026-08-28).
  // This also means an outage doesn't lose anything: failed sends stay queued and just
  // wait, with a backoff so a down/recovering DB doesn't get hammered every tick.
  var OUTBOX_KEY   = 'gheloo_upsert_outbox_v1';
  var DRAIN_MS     = 100;  // ~10 sends/sec
  var BACKOFF_MS   = 5000; // pause the whole drain after a failure so a struggling DB gets room to recover
  var _backoffUntil = 0;
  var _draining      = false;

  // Multiple tabs/windows share this same localStorage key (same origin). A removal that
  // just trusts array position ("shift the first item off") breaks the moment a second tab
  // is also draining: by the time tab A's fetch resolves, tab B may have already shifted a
  // DIFFERENT item into position 0, so tab A ends up deleting an item it never sent — gone
  // for good, no error, no retry. Every entry gets a unique `_k` so removal can target the
  // exact item that was actually confirmed sent, no matter what else moved around it in the
  // meantime (found live 2026-08-29: 70k+ scanned locally, ~2k landed in the DB).
  var _outboxKeySeq = 0;
  function _nextOutboxKey() { return Date.now() + '_' + Math.random().toString(36).slice(2) + '_' + (_outboxKeySeq++); }
  function loadOutbox() {
    try {
      var items = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
      var changed = false;
      items.forEach(function(it) { if (it._k == null) { it._k = _nextOutboxKey(); changed = true; } });
      if (changed) saveOutbox(items);
      return items;
    } catch (e) { return []; }
  }
  function saveOutbox(items) {
    try {
      localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
    } catch (e) {
      // localStorage is ~5-10MB/origin. A backend outage that outlasts the drain rate (the
      // 2026-08-29 scanned_ids permission bug held this up a full day) can queue enough
      // full user objects to hit that ceiling — after which EVERY further enqueue silently
      // fails to persist (caught below, swallowed) even though the in-memory push looked
      // like it worked. Drop the oldest slice to make room instead of staying wedged.
      if (e && e.name === 'QuotaExceededError' && items.length > 1) {
        var trimmed = items.slice(Math.ceil(items.length * 0.1));
        console.warn('[Supabase] outbox over quota, dropping ' + (items.length - trimmed.length) + ' oldest entries');
        saveOutbox(trimmed);
        return;
      }
      console.warn('[Supabase] outbox save failed:', e);
    }
  }
  function enqueueUsers(users, opts) {
    if (!users || !users.length) return;
    var items = loadOutbox();
    users.forEach(function(u) { items.push({ u: u, o: opts || {}, _k: _nextOutboxKey() }); });
    saveOutbox(items);
  }

  // One POST can carry many rows — upsertUsers() already accepts an array. Sending only
  // items[0] here capped real throughput at ~10 users/sec (1 per DRAIN_MS tick) no matter
  // how fast a scan or a full room roster found people, which is what "nothing lands in
  // the DB fast enough with 2 tabs scanning" traces back to (2026-08-29). Batching every
  // consecutive item that shares the same opts (same source/room — can't merge across
  // different ones without mis-stamping last_room_id) into one request removes that
  // ceiling while still keeping only one request in flight at a time, which is the actual
  // protection the small VM needs against the connection-pool wedge from 2026-08-28.
  var DRAIN_BATCH_MAX = 200;
  async function drainTick() {
    if (_draining || Date.now() < _backoffUntil) return;
    var items = loadOutbox();
    if (!items.length) return;
    _draining = true;
    var frontOptsKey = JSON.stringify(items[0].o);
    var batch = [];
    for (var i = 0; i < items.length && batch.length < DRAIN_BATCH_MAX; i++) {
      if (JSON.stringify(items[i].o) !== frontOptsKey) break;
      batch.push(items[i]);
    }
    var sentKeys = {};
    batch.forEach(function(it) { sentKeys[it._k] = true; });
    try {
      await upsertUsers(batch.map(function(it) { return it.u; }), batch[0].o);
      // Re-read rather than reuse `items` — packet handlers (or another tab) may have
      // pushed or drained entries while this send was in flight. Remove by `_k`, not
      // position, so this only ever deletes the exact items just confirmed sent.
      var current = loadOutbox();
      saveOutbox(current.filter(function(it) { return !sentKeys[it._k]; }));
    } catch (e) {
      console.warn('[Supabase] outbox send failed, will retry:', e);
      _backoffUntil = Date.now() + BACKOFF_MS;
    } finally {
      _draining = false;
    }
  }
  setInterval(drainTick, DRAIN_MS);

  var HEADERS = {
    'apikey':        SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
    'Content-Type':  'application/json',
  };

  // previous_names/previous_figures history length — each figure string can run
  // 100-150+ chars, so this is the single biggest per-row size lever.
  var HISTORY_CAP = 12;

  function appendUniq(arr, val) {
    if (!val || arr.indexOf(val) !== -1) return arr;
    var next = arr.concat([val]);
    return next.length > HISTORY_CAP ? next.slice(next.length - HISTORY_CAP) : next;
  }

  // figures table dedupes outfit history: instead of writing a fresh ~100-150 char
  // string into previous_figures every time someone's outfit changes, previous_figure_ids
  // references a shared `figures` row — reused whether it's the SAME person re-wearing an
  // old look or a DIFFERENT person who happened to wear the identical outfit. Upserting
  // with resolution=merge-duplicates + return=representation gets ids back for both new
  // and already-existing figures in one round trip.
  async function resolveFigureIds(figureTexts) {
    var uniq = Array.from(new Set(figureTexts.filter(Boolean)));
    if (!uniq.length) return {};
    var map = {};
    try {
      var res = await fetch(SUPABASE_URL + '/rest/v1/figures?on_conflict=figure', {
        method:  'POST',
        headers: Object.assign({}, HEADERS, { 'Prefer': 'resolution=merge-duplicates,return=representation' }),
        body:    JSON.stringify(uniq.map(function(f) { return { figure: f }; })),
      });
      if (res.ok) {
        var rows = await res.json();
        rows.forEach(function(r) { map[r.figure] = r.id; });
      }
    } catch (e) {
      console.warn('[Supabase] figure id resolve failed:', e);
    }
    return map;
  }

  function appendUniqId(arr, id) {
    if (id == null || arr.indexOf(id) !== -1) return arr;
    var next = arr.concat([id]);
    return next.length > HISTORY_CAP ? next.slice(next.length - HISTORY_CAP) : next;
  }

  async function upsertUsers(users, opts) {
    opts = opts || {};
    var source = opts.source || 'room';
    var roomId = window.Room ? window.Room.id : null;
    var now    = new Date().toISOString();

    // Bots (type 2) and pets (type 4) are never worth a row, regardless of source —
    // even an explicit guild/relationship lookup shouldn't log them.
    users = users.filter(function(u) { return u.type !== 2 && u.type !== 4; });

    // No achievement-score gate anymore — everyone gets logged, low-score included.
    // The panel's own queries are unfiltered by score too, so this shows up exactly
    // like any other user: absent from the default room-only view until actually
    // room-encountered, but included in "Load all accounts".

    var ids = users.map(function(u) { return u.id; }).filter(Boolean);
    if (!ids.length) return;

    // Fetch existing rows to detect name/figure changes
    var existing = {};
    try {
      var r = await fetch(
        SUPABASE_URL + '/rest/v1/users?id=in.(' + ids.join(',') + ')&select=id,name,figure,motto,gender,type,favorite_group,achievement_score,previous_names,previous_figure_ids,last_name_change',
        { headers: HEADERS }
      );
      if (r.ok) {
        var rows = await r.json();
        rows.forEach(function(u) { existing[u.id] = u; });
      }
    } catch(e) {
      console.warn('[Supabase] fetch existing failed:', e);
    }

    // 'room'/'profile' are real-time — you're either physically in the room right now or
    // you just opened their live profile card. 'guild'/'relationship' reflect whatever
    // the server had cached for that list, which can lag behind. So only room/profile
    // are trusted to update the CURRENT figure; a guild/relationship sighting that
    // disagrees still gets recorded, just into history instead of displacing a more
    // trustworthy current figure with a possibly-stale one.
    var isTrustedSource = source === 'room' || source === 'profile';

    // Figures actually changing this round need an id from the shared figures table —
    // resolved once for the whole batch rather than one round trip per user.
    var changedFigures = [];
    users.forEach(function(u) {
      var ex = existing[u.id] || {};
      var candidateFigure = u.figure || '';
      if (candidateFigure && ex.figure && candidateFigure !== ex.figure) {
        changedFigures.push(isTrustedSource ? ex.figure : candidateFigure);
      }
    });
    var figureIdMap = await resolveFigureIds(changedFigures);

    var upsertRows = users.map(function(u) {
      var ex           = existing[u.id] || {};
      var prevNames     = ex.previous_names || [];
      var prevFigureIds = ex.previous_figure_ids || [];
      var newName       = u.name   || '';
      var candidateFigure = u.figure || '';
      var newFigure = (!ex.figure || isTrustedSource) ? candidateFigure : ex.figure;

      // Track changes
      var nameChanged = ex.name && ex.name !== newName;
      if (nameChanged) prevNames = appendUniq(prevNames, ex.name);
      if (candidateFigure && ex.figure && candidateFigure !== ex.figure) {
        var displacedFigure = isTrustedSource ? ex.figure : candidateFigure;
        var oldFigureId = figureIdMap[displacedFigure];
        if (oldFigureId != null) prevFigureIds = appendUniqId(prevFigureIds, oldFigureId);
      }

      // Sources like GuildMembers don't carry motto/gender/type/group/score at all —
      // fall back to whatever's already on the DB row instead of blanking it out.
      var motto  = u.motto             !== undefined ? (u.motto || '')                    : (ex.motto || '');
      var gender = u.gender            !== undefined ? (u.gender || '').toUpperCase()      : (ex.gender || '');
      var type   = u.type              !== undefined ? u.type                              : (ex.type !== undefined ? ex.type : 1);
      var favGrp = u.favoriteGroup     !== undefined ? (u.favoriteGroup || '')             : (ex.favorite_group || '');
      var score  = u.achievementScore  !== undefined ? (u.achievementScore || 0)           : (ex.achievement_score || 0);

      var row = {
        id:                u.id,
        name:              newName,
        motto:             motto,
        figure:            newFigure,
        gender:            gender,
        type:              type,
        favorite_group:    favGrp,
        achievement_score: score,
        previous_names:        prevNames,
        previous_figure_ids:   prevFigureIds,
        last_seen_via:     source,
        // Always present (never a per-user-conditional key) — a bulk upsert where some
        // rows have a key and others don't gets rejected outright by PostgREST (400,
        // silently swallowed by fetch() since a 400 doesn't reject the promise). Keep
        // the existing value when this user's name didn't change this round.
        last_name_change:  nameChanged ? now : (ex.last_name_change || null),
      };
      // Room-encounter fields (last_room_id/last_seen) only get touched for an actual
      // room encounter — profile/guild lookups aren't that, so they get their own
      // timestamp column instead of overwriting last_room_id/last_seen with stale info.
      if (source === 'profile') {
        row.last_profile_view = now;
      } else if (source === 'guild') {
        row.last_guild_view = now;
      } else if (source === 'relationship') {
        row.last_relationship_view = now;
      } else {
        row.last_room_id = roomId;
        row.last_seen    = now;
      }
      return row;
    });

    // Throws on a failed write (not just a real network error) so the outbox drain loop
    // above actually sees this as failed and keeps the entry queued for retry — fetch()
    // only rejects on a network failure, a 400/500 response resolves normally, so res.ok
    // has to be checked explicitly and turned into a real rejection.
    var res = await fetch(SUPABASE_URL + '/rest/v1/users', {
      method:  'POST',
      headers: Object.assign({}, HEADERS, { 'Prefer': 'resolution=merge-duplicates' }),
      body:    JSON.stringify(upsertRows),
    });
    if (!res.ok) {
      var body = await res.text().catch(function() { return '(no body)'; });
      throw new Error('upsert rejected: ' + res.status + ' ' + body);
    }
    // Lets an already-open User Database panel merge these rows in live instead of
    // needing a manual reload to see someone who just got logged.
    if (window.__udb_onUsersUpserted) window.__udb_onUsersUpserted(upsertRows);
    // Any id logged through ANY source (room encounter, profile/guild/relationship view)
    // also counts as "known" for the id-sweep scanner — not just ids the scanner itself
    // probed — so a scan running while you play normally doesn't re-probe someone you
    // just walked past. See extensions/fun/user-database.js's scanned_ids outbox.
    if (window.__udb_markIdsScanned) window.__udb_markIdsScanned(ids);
  }

  window.onPacket('Users', function(p) {
    if (!p.parsed || !p.parsed.users || !p.parsed.users.length) return;
    enqueueUsers(p.parsed.users);
  });

  // UserChange (outfit/motto edited live in a room you're already in) — parsers.js's own
  // UserChange handler runs first (loaded before this file, see manifest.json) and already
  // merged the new figure/gender/motto into window.Room.users[index], so this just re-upserts
  // that same enriched record through the normal name/figure-diff path.
  window.onPacket('UserChange', function(p) {
    if (!p.parsed) return;
    var u = window.Room && window.Room.users && window.Room.users[p.parsed.index];
    if (!u || !u.id) return;
    // Auto-random-outfit (user-database.js) fires a UserChange for yourself every
    // cooldown tick — don't log your own account while that's cycling looks.
    if (window.__udb_autoRandomActive && window._selfName && u.name === window._selfName) return;
    enqueueUsers([u]);
  });

  // ExtendedProfile (profile card opened — either by clicking an avatar in-room, or via
  // the game's own player search). Merge in whatever richer fields we already have cached
  // for this id from the room roster, then log with the score/type gate skipped.
  window.onPacket('ExtendedProfile', function(p) {
    if (!p.parsed || !p.parsed.id) return;
    var cached = null;
    var roomUsers = window.Room && window.Room.users;
    if (roomUsers) {
      for (var idx in roomUsers) {
        if (roomUsers[idx].id === p.parsed.id) { cached = roomUsers[idx]; break; }
      }
    }
    enqueueUsers([Object.assign({}, cached, p.parsed)], { skipFilter: true, source: 'profile' });
  });

  // GuildMembers (group's member list opened) — logs every member on the page received.
  // No motto/gender/score in this packet, so upsertUsers falls back to whatever's already
  // known for each id instead of blanking those fields.
  window.onPacket('GuildMembers', function(p) {
    if (!p.parsed || !p.parsed.members || !p.parsed.members.length) return;
    enqueueUsers(p.parsed.members, { skipFilter: true, source: 'guild' });
  });

  // RelationshipStatusInfo (someone's relationships list opened) — same reasoning as
  // GuildMembers: no motto/gender/score in this packet, upsertUsers falls back to
  // whatever's already known.
  window.onPacket('RelationshipStatusInfo', function(p) {
    if (!p.parsed || !p.parsed.users || !p.parsed.users.length) return;
    enqueueUsers(p.parsed.users, { skipFilter: true, source: 'relationship' });
  });

  console.log('[Supabase] user logger active');
})();
