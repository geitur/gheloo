(function() {
  if (document.getElementById('__ins_panel')) return;

  // Room Inspector — client-side room state spoofing: fake YouAreOwner on room entry,
  // relay your own PlaceObject attempts back as a fake ObjectAdd so placement still
  // renders locally in rooms you don't own, capture/replay a room's Objects+Items+
  // FloorHeightMap so it can be redrawn later, and toggle client-side visibility of
  // wired/hide walktiles. Everything here is a local rendering trick (fake IN packets
  // injected into your own client) — it never touches the server or other users.

  const AUTOOWNER_KEY  = '__ghk_ins_autoowner';
  const AUTOPLACER_KEY = '__ghk_ins_autoplacer';
  const SNAP_KEY        = '__ghk_ins_snapshots';
  const MAX_SNAPSHOTS   = 8;

  // Wired/hide-tile classnames confirmed against a real CatalogPage dump.
  const WIRED_CLASSNAMES = [
    'cstm_wired_hide_tile_1x1', 'custom_white_wired_tile', 'custom_purple_wired_tile',
    'custom_pink_wired_tile', 'custom_orange_wired_tile', 'custom_green_wired_tile',
    'custom_gray_wired_tile', 'custom_darkblue_wired_tile', 'tile_walk_magic',
  ];
  const WIRED_FALLBACK_RE = /wired.*tile|tile.*wired|tile_walk|walk_magic/i;
  // Magic walk tiles (walk_magic*/tile_walk_magic*) don't use ObjectDataUpdate for
  // visibility — confirmed via live capture: hiding sends a fake IN packet with raw
  // header 402 (no shortName registered for it in PKT, so it must be sent by numeric
  // id) carrying {i:itemCount}{i:objectId}{i:-1}; showing again is just a normal
  // Objects packet re-adding that single item.
  const MAGIC_HIDE_PACKET_ID = 402;
  const MAGIC_TILE_RE = /walk_magic/i;

  function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function gStr(v) {
    return '{s:"' + String(v == null ? '' : v).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\r/g,'\\r').replace(/\n/g,'\\r') + '"}';
  }
  function packetId(dir, short) {
    const table = (window.PKT && window.PKT[dir]) || {};
    for (const id in table) { if (window.shortName(table[id], dir) === short) return parseInt(id, 10); }
    return null;
  }
  function packetSend(dir, short, payload) {
    const id = packetId(dir, short);
    if (id == null) return false;
    return window.sendPacket(dir, id, payload || '');
  }
  // For packets with no registered shortName (id known only from a live capture).
  function packetSendRaw(dir, id, payload) {
    return window.sendPacket(dir, id, payload || '');
  }
  // Reachable from listeners registered outside init() — updates the status line if
  // the panel happens to exist, always logs to console too.
  function reportStatus(msg) {
    const el = document.querySelector('#__ins_panel #__ins_status');
    if (el) el.textContent = msg;
    console.log('[RoomInspector]', msg);
  }

  // GPacket.fromExpression (ws.js) has no case for raw-byte {x:} tokens — it silently
  // drops them, corrupting replay. {b:N} writes the exact same single byte via
  // pushByte(parseInt(N)), so every raw byte gets re-encoded as {b:...} instead.
  function tokensToExpr(tokens) {
    return tokens.map(function(tok) {
      if (tok.t === 's') return gStr(tok.v);
      if (tok.t === 'b') return '{b:' + (tok.v ? 'true' : 'false') + '}';
      if (tok.t === 'x') return '{b:' + tok.v + '}';
      return '{' + tok.t + ':' + tok.v + '}'; // i, u, l
    }).join('');
  }
  // Generic raw-bytes -> replayable expression, for any packet with a registered parser
  // (Objects, Items). Records every read the real parser makes, in order — adapts
  // automatically to whatever fields that packet actually contains.
  function rawToExpr(dir, name, raw) {
    const tokens = window.decodeWithParser && window.decodeWithParser(name, dir, raw);
    return tokens ? tokensToExpr(tokens) : null;
  }
  // FloorHeightMap has no registered parser, so decode it by hand:
  // {i:doorInfo}{byte flag}{s:"grid"}{i:trailing}. The byte is re-encoded as {b:} for
  // the same fromExpression reason as above.
  function floorHeightMapToExpr(raw) {
    const r = window.makeReader(raw);
    if (!r) return null;
    try {
      const a = r.int();
      const b = r.byte();
      const grid = r.str();
      const c = r.int();
      return '{i:' + a + '}{b:' + b + '}' + gStr(grid) + '{i:' + c + '}';
    } catch(e) { return null; }
  }

  // ── Room-inspector state ────────────────────────────────────────────────────────
  let _autoOwner = localStorage.getItem(AUTOOWNER_KEY) !== '0'; // default on
  let _autoPlacer = localStorage.getItem(AUTOPLACER_KEY) === '1'; // default off
  let _snapshots = [];
  try { _snapshots = JSON.parse(localStorage.getItem(SNAP_KEY) || '[]'); } catch(_) { _snapshots = []; }
  function saveSnapshots() {
    try { localStorage.setItem(SNAP_KEY, JSON.stringify(_snapshots)); } catch(e) { console.error('[RoomInspector] snapshot save failed', e); }
  }

  // Cache the most recent replayable expression for the room we're currently in.
  let _lastExpr = { objects: null, items: null, heightmap: null, roomId: null };

  // Every id we've ever rendered client-side only (via Spawn or the Placer relay) —
  // typeId + current x/y/facing/stuff, so a real outgoing MoveObject for one of these
  // (dragging/rotating it with the game's own native furni UI) can be mirrored back as
  // a fake ObjectUpdate, same trick as Placer does for PlaceObject->ObjectAdd.
  const _fakeItems = new Map();

  function spoofOwner() { return packetSend('IN', 'YouAreOwner', ''); }

  window.onPacket('RoomReady', function() {
    _lastExpr = { objects: null, items: null, heightmap: null, roomId: window.Room && window.Room.id };
    if (_autoOwner) setTimeout(spoofOwner, 300);
  });
  window.onPacket('Objects', function(p) {
    _lastExpr.objects = rawToExpr('IN', 'Objects', p.raw);
    _lastExpr.roomId = window.Room && window.Room.id;
  });
  window.onPacket('Items', function(p) { _lastExpr.items = rawToExpr('IN', 'Items', p.raw); });
  window.onPacket('FloorHeightMap', function(p) { _lastExpr.heightmap = floorHeightMapToExpr(p.raw); });

  // The furni "stuff" data section is category-tagged and variable-shape (see
  // parsers.js's parseItemData: 0/3/4 = plain state string, 1 = string map, 2 =
  // string array, 5 = int array, 6 = scoreboard w/ leaderboard entries, 7 =
  // crackable). window.Inventory only preserves enough info to rebuild categories
  // 0/1/2/3/5 faithfully — 6/7 carry extra fields the inventory list never stores,
  // so those fall back to a plain state (won't perfectly match, but stays valid).
  function buildItemStuffExpr(stuff) {
    const cat = stuff && stuff.category;
    const data = stuff && stuff.data;
    if ((cat === 0 || cat === 3 || cat === 4) && data) return '{i:' + cat + '}' + gStr(data.state == null ? '0' : data.state);
    if (cat === 1 && data && data.map) {
      const entries = Object.entries(data.map);
      let out = '{i:1}{i:' + entries.length + '}';
      entries.forEach(function(kv) { out += gStr(kv[0]) + gStr(kv[1]); });
      return out;
    }
    if (cat === 2 && data && data.array) {
      let out = '{i:2}{i:' + data.array.length + '}';
      data.array.forEach(function(v) { out += gStr(v); });
      return out;
    }
    if (cat === 5 && data && data.intArray) {
      let out = '{i:5}{i:' + data.intArray.length + '}';
      data.intArray.forEach(function(v) { out += '{i:' + v + '}'; });
      return out;
    }
    return '{i:0}' + gStr('0'); // unsupported/unknown category — plain default state
  }

  // Your own room-entity id + name, off window.Room.users — same numeric id space as
  // a real furni's ownerId (confirmed: matches the ownerId a real Objects/Items
  // capture reports for furni you actually own in that room).
  function selfIdentity() {
    if (!window._selfName || !window.Room || !window.Room.users) return null;
    const u = Object.values(window.Room.users).find(function(u) { return u.name === window._selfName; });
    return u ? { id: u.id, name: u.name, x: u.x, y: u.y } : null;
  }

  // Single-item ObjectAdd payload for the Placer relay/Spawn — id, typeId, x, y,
  // facing, z, sizeZ, extra, dataTypeRaw+stuff, expires, usagePolicy, then a trailing
  // ownerId+ownerName pair that must always be present or the client won't place it
  // (confirmed: dropping it silently breaks rendering). Client-side only and never
  // sent to the server, so this is purely cosmetic to your own client — defaults to a
  // placeholder id/name if the caller doesn't have a real owner to attach.
  function buildObjectAddExpr(id, typeId, x, y, facing, stuff, ownerId, ownerName) {
    return '{i:' + id + '}' +
      '{i:' + typeId + '}' +
      '{i:' + x + '}' +
      '{i:' + y + '}' +
      '{i:' + facing + '}' +
      gStr('0.0') +
      gStr('0.65') +
      '{i:0}' +
      buildItemStuffExpr(stuff) +
      '{i:-1}{i:0}' +
      '{i:' + (ownerId != null ? ownerId : 1) + '}' + gStr(ownerName != null ? ownerName : 'a');
  }

  // ObjectUpdate payload for the MoveObject relay — same per-item fields as
  // ObjectAdd/Objects but with NO trailing ownerName (confirmed against a real
  // capture: id, typeId, x, y, facing, z, sizeZ, extra, dataTypeRaw+stuff, expires,
  // usagePolicy, ownerId — 13 tokens, nothing left over).
  function buildObjectUpdateExpr(id, typeId, x, y, facing, stuff, ownerId) {
    return '{i:' + id + '}' +
      '{i:' + typeId + '}' +
      '{i:' + x + '}' +
      '{i:' + y + '}' +
      '{i:' + facing + '}' +
      gStr('0.0') +
      gStr('0.65') +
      '{i:0}' +
      buildItemStuffExpr(stuff) +
      '{i:-1}{i:0}' +
      '{i:' + (ownerId != null ? ownerId : 1) + '}';
  }

  function rememberFakeItem(id, typeId, x, y, facing, stuff, ownerId) {
    _fakeItems.set(id, { typeId, x, y, facing, stuff, ownerId: ownerId != null ? ownerId : 1 });
  }

  // Move/rotate relay: the game's own native furni UI (drag to move, right-click
  // rotate) sends a real outgoing MoveObject for ANY furni you interact with,
  // including ones that only exist client-side (Spawn/Placer). The server will just
  // ignore it since that item was never really placed — so for ids we know are fake,
  // mirror it back as a fake ObjectUpdate too, same idea as the Placer relay.
  window.onPacket('MoveObject', function(p) {
    if (p.direction !== 'OUT' || !p.raw) return;
    const r = window.makeReader(p.raw);
    if (!r) return;
    let id, x, y, facing;
    try { id = r.int(); x = r.int(); y = r.int(); facing = r.int(); } catch (e) { return; }
    const item = _fakeItems.get(id);
    if (!item) return; // not one of ours — leave it to the server/client as normal
    item.x = x; item.y = y; item.facing = facing;
    if (_lastSpawn && _lastSpawn.id === id) { _lastSpawn.x = x; _lastSpawn.y = y; _lastSpawn.facing = facing; }
    const ok = packetSend('IN', 'ObjectUpdate', buildObjectUpdateExpr(id, item.typeId, x, y, facing, item.stuff, item.ownerId));
    reportStatus(ok ? 'Moved #' + id + ' to (' + x + ',' + y + ') facing ' + facing + '.' : 'Move relay: ObjectUpdate packet not found.');
  });

  // Use/click-state relay: clicking a real furni with states (lamp, chair color,
  // etc.) sends outgoing UseFurniture{id}{0}, server replies with
  // ObjectDataUpdate{"id"}{0}{"newState"} — confirmed via live capture cycling
  // 2 -> 3 on repeat clicks. For our own fake items the server never answers, so
  // mirror it: bump the tracked state by 1. No wrap-around — the Apply button
  // already lets you set an exact state directly whenever a click overshoots.
  window.onPacket('UseFurniture', function(p) {
    if (p.direction !== 'OUT' || !p.raw) return;
    const r = window.makeReader(p.raw);
    if (!r) return;
    let id;
    try { id = r.int(); } catch (e) { return; }
    const item = _fakeItems.get(id);
    if (!item) return; // not one of ours — leave it to the server as normal
    const cur = parseInt((item.stuff && item.stuff.data && item.stuff.data.state) || '0', 10) || 0;
    const next = cur + 1;
    item.stuff = { category: 0, data: { state: String(next) } };
    if (_lastSpawn && _lastSpawn.id === id) _lastSpawn.state = String(next);
    const ok = packetSend('IN', 'ObjectDataUpdate', gStr(String(id)) + '{i:0}' + gStr(String(next)));
    reportStatus(ok ? 'Used #' + id + ' — state ' + next + '.' : 'Use relay: ObjectDataUpdate packet not found.');
  });

  // Objects-packet payload re-adding exactly one already-known floor item (owner
  // table with 1 entry + 1-item list) — matches window.Room.floorItems[id]'s shape
  // field-for-field (see parsers.js's Objects/ObjectUpdate parsers), so any item
  // pulled from there can be replayed as-is. This is how magic walk tiles get shown
  // again after being hidden via the raw 402 packet (see MAGIC_HIDE_PACKET_ID).
  function buildObjectsExpr(item) {
    return '{i:1}' +
      '{i:' + item.ownerId + '}' + gStr(item.ownerName) +
      '{i:1}' +
      '{i:' + item.id + '}' +
      '{i:' + item.typeId + '}' +
      '{i:' + item.x + '}' +
      '{i:' + item.y + '}' +
      '{i:' + item.facing + '}' +
      gStr(item.z) +
      gStr(item.sizeZ) +
      '{i:' + item.extra + '}' +
      buildItemStuffExpr(item.stuff) +
      '{i:' + item.expires + '}' +
      '{i:' + item.usagePolicy + '}' +
      '{i:' + item.ownerId + '}';
  }

  function isMagicWalkTile(item) { return MAGIC_TILE_RE.test((item && item.classname) || ''); }
  function hideMagicTile(id) { return packetSendRaw('IN', MAGIC_HIDE_PACKET_ID, '{i:1}{i:' + id + '}{i:-1}'); }
  function showMagicTile(item) { return packetSend('IN', 'Objects', buildObjectsExpr(item)); }

  // Placer relay: watch outgoing PlaceObject (real inventory placement attempts) and
  // mirror them client-side as a fake incoming ObjectAdd — so a placement that a real
  // server would reject (room you don't own) still renders locally, same ids.
  window.onPacket('PlaceObject', function(p) {
    if (!_autoPlacer || p.direction !== 'OUT' || !p.raw) return;
    const r = window.makeReader(p.raw);
    if (!r) { reportStatus('Placer: could not read outgoing PlaceObject.'); return; }
    let parts;
    try { parts = r.str().trim().split(/\s+/); } catch(e) { reportStatus('Placer: could not read outgoing PlaceObject.'); return; }
    if (parts.length < 3) { reportStatus('Placer: unexpected PlaceObject payload format.'); return; }
    const invId = parts[0], x = parseInt(parts[1], 10), y = parseInt(parts[2], 10), rot = parseInt(parts[3] || '0', 10);
    const inv = window.Inventory && window.Inventory.items && window.Inventory.items[invId];
    const typeId = inv ? parseInt(inv.typeId, 10) : null;
    if (typeId == null) {
      reportStatus('Placer: unknown typeId for invId ' + invId + ' — inventory not loaded yet, requesting.');
      packetSend('OUT', 'RequestFurniInventory', '');
      return;
    }
    const me = selfIdentity();
    const expr = buildObjectAddExpr(invId, typeId, x, y, rot, inv.stuff, me && me.id, me && me.name);
    // A short delay after the outgoing PlaceObject — sending the fake ObjectAdd in the
    // same tick seems to land while the client is still in its own "placing..." state
    // and ignores it; giving it a beat first is what made this actually render.
    setTimeout(function() {
      const ok = packetSend('IN', 'ObjectAdd', expr);
      if (ok) rememberFakeItem(invId, typeId, x, y, rot, inv.stuff, me && me.id);
      // Drop it from the (fake, client-side) inventory too, so the next placement
      // of the same furni type picks the next id instead of reusing this one.
      packetSend('IN', 'FurniListRemove', '{i:' + invId + '}');
      reportStatus(ok ? 'Placer: #' + invId + ' placed at (' + x + ',' + y + ').' : 'Placer: ObjectAdd packet not found.');
    }, 500);
  });

  // Resolves a query to a furni typeId against leet_furni.json (window.FurniData) —
  // checked across both floor and wall catalogs since either input form could be
  // either. Accepts, in priority order: a raw numeric typeId (e.g. "886628664"), an
  // exact classname (e.g. "Habblet_Bday_27"), an exact display name, case-insensitive
  // classname, case-insensitive name, then name with a trailing rarity tag like
  // "(SS)"/"(Rare)"/"(LTD)" stripped — most furni names carry one of those (e.g. real
  // name "Zachtroze Valentijns Vuurdraak (SS)"), which people don't usually type.
  function findTypeId(query) {
    const q = String(query || '').trim();
    if (!q) return null;
    const dicts = [(window.FurniData && window.FurniData.floor) || {}, (window.FurniData && window.FurniData.wall) || {}];

    if (/^\d+$/.test(q)) {
      const asId = parseInt(q, 10);
      for (const fd of dicts) { if (fd[asId]) return asId; }
    }
    for (const fd of dicts) { for (const id in fd) { if (fd[id] && fd[id].classname === q) return parseInt(id, 10); } }
    for (const fd of dicts) { for (const id in fd) { if (fd[id] && fd[id].name === q) return parseInt(id, 10); } }

    const lower = q.toLowerCase();
    for (const fd of dicts) { for (const id in fd) { if (fd[id] && String(fd[id].classname || '').toLowerCase() === lower) return parseInt(id, 10); } }
    for (const fd of dicts) { for (const id in fd) { if (fd[id] && String(fd[id].name || '').toLowerCase() === lower) return parseInt(id, 10); } }
    for (const fd of dicts) { for (const id in fd) { if (fd[id] && String(fd[id].name || '').replace(/\s*\([^)]*\)\s*$/, '').toLowerCase() === lower) return parseInt(id, 10); } }
    return null;
  }

  // Same client-side-only trick as the Placer relay above (fake ObjectAdd), just
  // triggered directly from a classname instead of mirroring a real PlaceObject —
  // so it works without owning the item. Id is a random high number so it can't
  // collide with real inventory/room-object ids.
  let _lastSpawn = null; // { id, typeId, x, y, facing, state, ownerId, ownerName } — last item spawned this way, for Apply State
  function spawnByClassname(query, facing, state) {
    const typeId = findTypeId(query);
    if (typeId == null) return { ok: false, reason: 'Not found in FurniData (checked as typeId, classname, and name).' };
    const me = selfIdentity();
    if (!me) return { ok: false, reason: 'Could not find your own position.' };
    const id = 900000000 + Math.floor(Math.random() * 99999999);
    const f = facing || 0, st = state == null || state === '' ? '0' : String(state);
    const expr = buildObjectAddExpr(id, typeId, me.x, me.y, f, { category: 0, data: { state: st } }, me.id, me.name);
    const ok = packetSend('IN', 'ObjectAdd', expr);
    if (!ok) return { ok: false, reason: 'ObjectAdd packet not found.' };
    _lastSpawn = { id, typeId, x: me.x, y: me.y, facing: f, state: st, ownerId: me.id, ownerName: me.name };
    rememberFakeItem(id, typeId, me.x, me.y, f, { category: 0, data: { state: st } }, me.id);
    return { ok: true, typeId, id, x: me.x, y: me.y };
  }

  // Re-sends ObjectAdd for the same id/typeId/position as the last spawn, just with a
  // different state — the client treats a fake ObjectAdd for an id it already has as
  // an in-place update. Rotation/movement itself is handled live by the MoveObject
  // relay above (drag/rotate it with the game's own native furni UI), and further
  // clicks (Use relay above) keep incrementing from whatever state is set here.
  function updateLastSpawn(state) {
    if (!_lastSpawn) return { ok: false, reason: 'Nothing spawned yet.' };
    const st = state != null && state !== '' ? String(state) : _lastSpawn.state;
    const expr = buildObjectAddExpr(_lastSpawn.id, _lastSpawn.typeId, _lastSpawn.x, _lastSpawn.y, _lastSpawn.facing, { category: 0, data: { state: st } }, _lastSpawn.ownerId, _lastSpawn.ownerName);
    const ok = packetSend('IN', 'ObjectAdd', expr);
    if (!ok) return { ok: false, reason: 'ObjectAdd packet not found.' };
    _lastSpawn.state = st;
    rememberFakeItem(_lastSpawn.id, _lastSpawn.typeId, _lastSpawn.x, _lastSpawn.y, _lastSpawn.facing, { category: 0, data: { state: st } }, _lastSpawn.ownerId);
    return { ok: true, state: st };
  }

  function scanWiredTiles() {
    const fd = (window.FurniData && window.FurniData.floor) || {};
    const wiredTypeIds = new Set();
    Object.entries(fd).forEach(function(pair) {
      const typeId = parseInt(pair[0], 10);
      const info = pair[1];
      const cls = (info.classname || '').toLowerCase();
      if (WIRED_CLASSNAMES.indexOf(info.classname) !== -1 || WIRED_FALLBACK_RE.test(cls)) wiredTypeIds.add(typeId);
    });
    return Object.values((window.Room && window.Room.floorItems) || {})
      .filter(function(item) { return wiredTypeIds.has(item.typeId); });
  }
  function sendTileVisibility(id, hidden) {
    return packetSend('IN', 'ObjectDataUpdate', gStr(String(id)) + '{i:0}' + gStr(hidden ? '1' : '0'));
  }

  function init() {
    const style = document.createElement('style');
    style.textContent = [
      '#__ins_panel{position:fixed;top:16px;right:16px;width:340px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__ins_panel *{box-sizing:border-box}',
      '.__ins_card_wrap{display:flex;flex-direction:column;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb}',
      '.__ins_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__ins_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}',
      '.__ins_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__ins_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__ins_close:hover{color:#eceefb}',
      '#__ins_body{max-height:min(600px,calc(100vh - 90px));overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px}',
      '.__ins_card{background:#1c1e2a;border:1px solid #23252f;border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:8px}',
      '.__ins_card h4{margin:0;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#82849a}',
      '.__ins_toggle_row{display:flex;align-items:center;justify-content:space-between}',
      '.__ins_desc{font-size:9px;color:#5c5e6b;line-height:1.5}',
      '#__ins_owner_wrap,#__ins_placer_wrap{position:relative;display:inline-block;width:34px;height:18px;flex-shrink:0;cursor:pointer}',
      '.__ins_tog_inp{opacity:0;width:0;height:0;position:absolute}',
      '.__ins_tog_track{position:absolute;inset:0;background:#23252f;border-radius:9px;transition:background .2s}',
      '.__ins_tog_thumb{position:absolute;top:2px;left:2px;width:14px;height:14px;background:#eceefb;border-radius:50%;transition:transform .2s;box-shadow:0 1px 3px rgba(0,0,0,0.35)}',
      '.__ins_row{display:flex;gap:6px;align-items:center}',
      '.__ins_row input,.__ins_row select{font-size:11px;padding:5px 7px;border:1px solid #23252f;border-radius:6px;background:#0A0B10;color:#eceefb;outline:none;box-sizing:border-box}',
      '.__ins_row input:focus,.__ins_row select:focus{border-color:#6C7CFF}',
      '.__ins_row input::placeholder{color:#5c5e6b}',
      '#__ins_c_list{width:100%;font-size:11px;padding:5px 7px;border:1px solid #23252f;border-radius:6px;background:#0A0B10;color:#eceefb;outline:none;box-sizing:border-box}',
      '#__ins_c_list:focus{border-color:#6C7CFF}',
      '#__ins_c_list option{background:#0A0B10;color:#eceefb}',
      '.__ins_btn{font-size:11px;font-weight:600;padding:7px 10px;border-radius:8px;border:none;cursor:pointer;color:#0A0B10;background:#A6B0FF}',
      '.__ins_btn:hover{filter:brightness(1.08)}',
      '.__ins_btn.secondary{background:#23252f;color:#eceefb}',
      '.__ins_btn.green{background:rgba(46,204,113,0.14);color:#2ecc71;border:1px solid rgba(46,204,113,0.3)}',
      '.__ins_btn.danger{background:rgba(231,76,60,0.14);color:#e74c3c;border:1px solid rgba(231,76,60,0.3)}',
      '.__ins_btn.grey{background:#23252f;color:#82849a}',
      '.__ins_btn.small{padding:3px 8px;font-size:10px}',
      '.__ins_btn:disabled{opacity:0.45;cursor:not-allowed;filter:none}',
      '#__ins_status{font-size:10px;color:#82849a;background:#0A0B10;border:1px solid #23252f;border-radius:6px;padding:6px 8px}',
      '.__ins_list{max-height:130px;overflow-y:auto;border:1px solid #23252f;border-radius:8px}',
      '.__ins_list_row{display:flex;align-items:center;gap:4px;padding:5px 8px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:10px}',
      '.__ins_list_row:last-child{border-bottom:none}',
      '.__ins_list_row:hover{background:rgba(255,255,255,0.04)}',
      '.__ins_list_name{flex:1;color:#eceefb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.__ins_list_empty{padding:16px 8px;font-size:10px;color:#5c5e6b;text-align:center}',
    ].join('');
    document.head.appendChild(style);

    const p = document.createElement('div');
    p.id = '__ins_panel';
    p.innerHTML =
      '<div class="__ins_card_wrap">' +
        '<div class="__ins_hdr" id="__ins_hdr">' +
          '<span class="__ins_eyebrow">Gheloo</span>' +
          '<span class="__ins_title">Room Inspector</span>' +
          '<span class="__ins_close" id="__ins_close">&times;</span>' +
        '</div>' +
        '<div id="__ins_body">' +

          '<div class="__ins_card">' +
            '<div class="__ins_toggle_row">' +
              '<h4>Owner Spoof</h4>' +
              '<label id="__ins_owner_wrap"><input type="checkbox" class="__ins_tog_inp" id="__ins_owner_inp"><span class="__ins_tog_track"></span><span class="__ins_tog_thumb"></span></label>' +
            '</div>' +
            '<div class="__ins_desc">Sends YouAreOwner (client-side only) on every room entry.</div>' +
          '</div>' +

          '<div class="__ins_card">' +
            '<div class="__ins_toggle_row">' +
              '<h4>Placer</h4>' +
              '<label id="__ins_placer_wrap"><input type="checkbox" class="__ins_tog_inp" id="__ins_placer_inp"><span class="__ins_tog_track"></span><span class="__ins_tog_thumb"></span></label>' +
            '</div>' +
            '<div class="__ins_desc">Watches your own placement attempts (outgoing) and renders them client-side too — even in rooms that aren\'t yours.</div>' +
          '</div>' +

          '<div class="__ins_card">' +
            '<h4>Spawn by Classname / Name / ID</h4>' +
            '<div class="__ins_row">' +
              '<input type="text" id="__ins_spawn_cls" placeholder="e.g. throne, Groot Saffierblauwe Kussen, or 886628664" style="flex:1">' +
              '<button class="__ins_btn green" id="__ins_spawn_btn">Spawn</button>' +
            '</div>' +
            '<div class="__ins_row">' +
              '<input type="number" id="__ins_spawn_rot" placeholder="Rotation" value="0" min="0" max="7" style="width:70px">' +
              '<input type="text" id="__ins_spawn_state" placeholder="State (bs)" style="flex:1">' +
              '<button class="__ins_btn secondary small" id="__ins_spawn_apply">Apply</button>' +
            '</div>' +
            '<div class="__ins_desc">Client-side only (same trick as Placer) — spawns at your own tile, no ownership needed. Drag/right-click-rotate it with the normal furni UI afterward — that works too, and clicking it bumps State by 1 (set an exact value with Apply anytime).</div>' +
          '</div>' +

          '<div class="__ins_card">' +
            '<h4>Room Snapshots</h4>' +
            '<div class="__ins_row">' +
              '<input type="text" id="__ins_c_name" placeholder="Name for this room" style="flex:1">' +
              '<button class="__ins_btn green" id="__ins_c_capture">Capture</button>' +
            '</div>' +
            '<select id="__ins_c_list" size="3">' + _snapshots.map(function(s, i) { return '<option value="' + i + '">' + esc(s.label) + '</option>'; }).join('') + '</select>' +
            '<div class="__ins_row">' +
              '<button class="__ins_btn green" id="__ins_c_paste" style="flex:1">Replay Into This Room</button>' +
              '<button class="__ins_btn danger" id="__ins_c_del" style="flex:1">Delete</button>' +
            '</div>' +
          '</div>' +

          '<div class="__ins_card">' +
            '<h4>Walktiles</h4>' +
            '<button class="__ins_btn" id="__ins_w_scan">Scan Room</button>' +
            '<div class="__ins_row">' +
              '<button class="__ins_btn small" id="__ins_w_hideall" style="flex:1">Hide All</button>' +
              '<button class="__ins_btn small green" id="__ins_w_showall" style="flex:1">Show All</button>' +
            '</div>' +
            '<div class="__ins_list" id="__ins_w_list"></div>' +
          '</div>' +

          '<div id="__ins_status">Ready.</div>' +

        '</div>' +
      '</div>';
    document.body.appendChild(p);
    p.style.display = 'none';

    window.__ghk_makeDraggable(p, p.querySelector('#__ins_hdr'), '__ghk_ins_pos', function(e) {
      return e.target.id === '__ins_close';
    });
    p.querySelector('#__ins_close').addEventListener('click', function() { p.style.display = 'none'; });

    const bodyEl = p.querySelector('#__ins_body');

    function setStatus(msg) {
      const el = bodyEl.querySelector('#__ins_status');
      if (el) el.textContent = msg;
    }

    function setToggleUI(track, thumb, on) {
      track.style.background = on ? '#6C7CFF' : '#23252f';
      thumb.style.transform  = on ? 'translateX(16px)' : 'translateX(0)';
    }

    const ownerInp   = bodyEl.querySelector('#__ins_owner_inp');
    const ownerTrack = bodyEl.querySelector('#__ins_owner_wrap .__ins_tog_track');
    const ownerThumb = bodyEl.querySelector('#__ins_owner_wrap .__ins_tog_thumb');
    ownerInp.checked = _autoOwner;
    setToggleUI(ownerTrack, ownerThumb, _autoOwner);
    ownerInp.addEventListener('change', function() {
      _autoOwner = this.checked;
      localStorage.setItem(AUTOOWNER_KEY, _autoOwner ? '1' : '0');
      setToggleUI(ownerTrack, ownerThumb, _autoOwner);
      if (_autoOwner) setStatus(spoofOwner() ? 'Owner spoof on — applied now.' : 'Owner spoof on (spoof failed just now, will retry next room entry).');
      else setStatus('Owner spoof off.');
    });

    const placerInp   = bodyEl.querySelector('#__ins_placer_inp');
    const placerTrack = bodyEl.querySelector('#__ins_placer_wrap .__ins_tog_track');
    const placerThumb = bodyEl.querySelector('#__ins_placer_wrap .__ins_tog_thumb');
    placerInp.checked = _autoPlacer;
    setToggleUI(placerTrack, placerThumb, _autoPlacer);
    placerInp.addEventListener('change', function() {
      _autoPlacer = this.checked;
      localStorage.setItem(AUTOPLACER_KEY, _autoPlacer ? '1' : '0');
      setToggleUI(placerTrack, placerThumb, _autoPlacer);
      if (_autoPlacer) {
        packetSend('OUT', 'RequestFurniInventory', ''); // refresh so typeId lookups hit
        setStatus('Placer on — inventory refreshed.');
      } else {
        setStatus('Placer off.');
      }
    });

    bodyEl.querySelector('#__ins_spawn_btn').addEventListener('click', function() {
      const inp = bodyEl.querySelector('#__ins_spawn_cls');
      const query = inp.value.trim();
      if (!query) { setStatus('Enter a classname, name, or typeId first.'); return; }
      const rot = parseInt(bodyEl.querySelector('#__ins_spawn_rot').value, 10) || 0;
      const state = bodyEl.querySelector('#__ins_spawn_state').value.trim();
      const result = spawnByClassname(query, rot, state);
      if (result.ok) {
        setStatus('Spawned "' + query + '" (typeId ' + result.typeId + ') at (' + result.x + ',' + result.y + ').');
      } else {
        setStatus('Spawn failed: ' + result.reason);
      }
    });
    bodyEl.querySelector('#__ins_spawn_apply').addEventListener('click', function() {
      const state = bodyEl.querySelector('#__ins_spawn_state').value.trim();
      const result = updateLastSpawn(state);
      setStatus(result.ok ? 'State set to "' + result.state + '".' : 'Apply failed: ' + result.reason);
    });

    function renderSnapshotList() {
      bodyEl.querySelector('#__ins_c_list').innerHTML =
        _snapshots.map(function(s, i) { return '<option value="' + i + '">' + esc(s.label) + '</option>'; }).join('');
    }

    bodyEl.querySelector('#__ins_c_capture').addEventListener('click', function() {
      if (_lastExpr.roomId !== (window.Room && window.Room.id)) {
        setStatus('No packets received for this room yet — leave and re-enter.');
        return;
      }
      const nameInp = bodyEl.querySelector('#__ins_c_name');
      const customName = nameInp.value.trim();
      const snap = {
        label: customName || ('Room ' + (window.Room.id != null ? window.Room.id : '?') + ' — ' + new Date().toLocaleString()),
        roomId: window.Room.id,
        objectsExpr: _lastExpr.objects,
        itemsExpr: _lastExpr.items,
        heightmapExpr: _lastExpr.heightmap,
        capturedAt: Date.now(),
      };
      _snapshots.push(snap);
      while (_snapshots.length > MAX_SNAPSHOTS) _snapshots.shift();
      saveSnapshots();
      setStatus('Captured: ' +
        (snap.objectsExpr ? 'objects ' : '') + (snap.itemsExpr ? 'items ' : '') + (snap.heightmapExpr ? 'heightmap' : '') +
        (!snap.objectsExpr && !snap.itemsExpr && !snap.heightmapExpr ? '(nothing received)' : ''));
      nameInp.value = '';
      renderSnapshotList();
    });
    bodyEl.querySelector('#__ins_c_paste').addEventListener('click', function() {
      const idx = parseInt(bodyEl.querySelector('#__ins_c_list').value, 10);
      const snap = _snapshots[idx];
      if (!snap) { setStatus('Select a captured room first.'); return; }
      // Heightmap left out on purpose — replaying it into a room with a different floor
      // plan/grid size than the one it was captured from crashes the client.
      let done = [];
      if (snap.objectsExpr) done.push(packetSend('IN', 'Objects', snap.objectsExpr) ? 'objects' : 'objects(fail)');
      if (snap.itemsExpr) done.push(packetSend('IN', 'Items', snap.itemsExpr) ? 'items' : 'items(fail)');
      setStatus('Replayed: ' + (done.length ? done.join(', ') : 'nothing to send'));
    });
    bodyEl.querySelector('#__ins_c_del').addEventListener('click', function() {
      const idx = parseInt(bodyEl.querySelector('#__ins_c_list').value, 10);
      if (Number.isNaN(idx) || !_snapshots[idx]) return;
      _snapshots.splice(idx, 1);
      saveSnapshots();
      renderSnapshotList();
    });

    let _wiredMatches = [];
    function renderWiredList() {
      const listEl = bodyEl.querySelector('#__ins_w_list');
      if (!_wiredMatches.length) { listEl.innerHTML = '<div class="__ins_list_empty">No walktiles found in this room.</div>'; return; }
      listEl.innerHTML = '';
      _wiredMatches.forEach(function(m) {
        const row = document.createElement('div');
        row.className = '__ins_list_row';
        row.innerHTML =
          '<span class="__ins_list_name">#' + m.typeId + ' ' + esc(m.classname || '') + ' @ (' + m.x + ',' + m.y + ')</span>' +
          '<button class="__ins_btn small" data-act="hide">Hide</button>' +
          '<button class="__ins_btn small green" data-act="show">Show</button>';
        row.querySelector('[data-act="hide"]').addEventListener('click', function() {
          const ok = isMagicWalkTile(m) ? hideMagicTile(m.id) : sendTileVisibility(m.id, true);
          setStatus(ok ? 'Hidden: #' + m.id : 'Failed (packet not found).');
        });
        row.querySelector('[data-act="show"]').addEventListener('click', function() {
          const ok = isMagicWalkTile(m) ? showMagicTile(m) : sendTileVisibility(m.id, false);
          setStatus(ok ? 'Shown: #' + m.id : 'Failed (packet not found).');
        });
        listEl.appendChild(row);
      });
    }
    bodyEl.querySelector('#__ins_w_scan').addEventListener('click', function() {
      _wiredMatches = scanWiredTiles();
      renderWiredList();
      setStatus(_wiredMatches.length + ' walktile(s) found.');
    });
    bodyEl.querySelector('#__ins_w_hideall').addEventListener('click', function() {
      if (!_wiredMatches.length) { setStatus('Scan the room first.'); return; }
      _wiredMatches.forEach(function(m) { isMagicWalkTile(m) ? hideMagicTile(m.id) : sendTileVisibility(m.id, true); });
      setStatus('All ' + _wiredMatches.length + ' walktile(s) hidden.');
    });
    bodyEl.querySelector('#__ins_w_showall').addEventListener('click', function() {
      if (!_wiredMatches.length) { setStatus('Scan the room first.'); return; }
      _wiredMatches.forEach(function(m) { isMagicWalkTile(m) ? showMagicTile(m) : sendTileVisibility(m.id, false); });
      setStatus('All ' + _wiredMatches.length + ' walktile(s) shown.');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(init); });
  } else {
    window.__ghk_ready(init);
  }
})();
