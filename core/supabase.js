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

  function appendUniq(arr, val) {
    if (!val || arr.indexOf(val) !== -1) return arr;
    var next = arr.concat([val]);
    return next.length > 20 ? next.slice(next.length - 20) : next;
  }

  async function upsertUsers(users) {
    var roomId = window.Room ? window.Room.id : null;
    var now    = new Date().toISOString();

    users = users.filter(function(u) { return u.type !== 2 && u.type !== 4 && (u.achievementScore || 0) >= 2500; });
    var ids = users.map(function(u) { return u.id; }).filter(Boolean);
    if (!ids.length) return;

    // Fetch existing rows to detect name/figure changes
    var existing = {};
    try {
      var r = await fetch(
        SUPABASE_URL + '/rest/v1/users?id=in.(' + ids.join(',') + ')&select=id,name,figure,previous_names,previous_figures',
        { headers: HEADERS }
      );
      if (r.ok) {
        var rows = await r.json();
        rows.forEach(function(u) { existing[u.id] = u; });
      }
    } catch(e) {
      console.warn('[Supabase] fetch existing failed:', e);
    }

    var upsertRows = users.map(function(u) {
      var ex         = existing[u.id] || {};
      var prevNames  = ex.previous_names  || [];
      var prevFigs   = ex.previous_figures || [];
      var newName    = u.name   || '';
      var newFigure  = u.figure || '';

      // Track changes
      if (ex.name   && ex.name   !== newName)   prevNames = appendUniq(prevNames, ex.name);
      if (ex.figure && ex.figure !== newFigure)  prevFigs  = appendUniq(prevFigs,  ex.figure);

      return {
        id:                u.id,
        name:              newName,
        motto:             u.motto             || '',
        figure:            newFigure,
        gender:            (u.gender           || '').toUpperCase(),
        type:              u.type              || 1,
        favorite_group:    u.favoriteGroup     || '',
        achievement_score: u.achievementScore  || 0,
        last_room_id:      roomId,
        last_seen:         now,
        previous_names:        prevNames,
        previous_figures:      prevFigs,
      };
    });

    fetch(SUPABASE_URL + '/rest/v1/users', {
      method:  'POST',
      headers: Object.assign({}, HEADERS, { 'Prefer': 'resolution=merge-duplicates' }),
      body:    JSON.stringify(upsertRows),
    }).catch(function(e) {
      console.warn('[Supabase] upsert failed:', e);
    });
  }

  window.onPacket('Users', function(p) {
    if (!p.parsed || !p.parsed.users || !p.parsed.users.length) return;
    upsertUsers(p.parsed.users);
  });

  console.log('[Supabase] user logger active');
})();
