(function() {
  var SUPABASE_URL      = 'https://qwcfsqsrtegyvvwkzcgb.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_mi9rS5i9a-xrAWC0lG0TNA_vg903xRL';

  if (SUPABASE_URL.indexOf('YOUR_PROJECT') !== -1) {
    console.warn('[Supabase] fill in SUPABASE_URL and SUPABASE_ANON_KEY in supabase.js');
    return;
  }

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

    // skipFilter: bypass the score gate for an explicitly opened profile/guild/
    // relationship list — the gate exists to keep passive room-scanning from flooding
    // the DB with low-score alts, but deliberately looking someone up is a direct
    // signal to log them regardless of score.
    if (!opts.skipFilter) {
      users = users.filter(function(u) { return (u.achievementScore || 0) >= 2500; });
    }

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

    fetch(SUPABASE_URL + '/rest/v1/users', {
      method:  'POST',
      headers: Object.assign({}, HEADERS, { 'Prefer': 'resolution=merge-duplicates' }),
      body:    JSON.stringify(upsertRows),
    }).then(async function(res) {
      // fetch() only rejects on a real network failure — a 400/500 response resolves
      // normally, so this HAS to check res.ok explicitly or a rejected write (e.g. a
      // malformed batch) fails completely silently with nothing in the console.
      if (!res.ok) {
        var body = await res.text().catch(function() { return '(no body)'; });
        console.warn('[Supabase] upsert rejected:', res.status, body);
        return;
      }
      // Lets an already-open User Database panel merge these rows in live instead of
      // needing a manual reload to see someone who just got logged.
      if (window.__udb_onUsersUpserted) window.__udb_onUsersUpserted(upsertRows);
    }).catch(function(e) {
      console.warn('[Supabase] upsert failed:', e);
    });
  }

  window.onPacket('Users', function(p) {
    if (!p.parsed || !p.parsed.users || !p.parsed.users.length) return;
    upsertUsers(p.parsed.users);
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
    upsertUsers([u]);
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
    upsertUsers([Object.assign({}, cached, p.parsed)], { skipFilter: true, source: 'profile' });
  });

  // GuildMembers (group's member list opened) — logs every member on the page received.
  // No motto/gender/score in this packet, so upsertUsers falls back to whatever's already
  // known for each id instead of blanking those fields.
  window.onPacket('GuildMembers', function(p) {
    if (!p.parsed || !p.parsed.members || !p.parsed.members.length) return;
    upsertUsers(p.parsed.members, { skipFilter: true, source: 'guild' });
  });

  // RelationshipStatusInfo (someone's relationships list opened) — same reasoning as
  // GuildMembers: no motto/gender/score in this packet, upsertUsers falls back to
  // whatever's already known.
  window.onPacket('RelationshipStatusInfo', function(p) {
    if (!p.parsed || !p.parsed.users || !p.parsed.users.length) return;
    upsertUsers(p.parsed.users, { skipFilter: true, source: 'relationship' });
  });

  console.log('[Supabase] user logger active');
})();
