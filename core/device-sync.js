// Cross-PC account sync/relay: lets trade-sequencer.js (and anything else) see accounts
// open in Hotel tabs on OTHER computers and send them packets, not just tabs in this
// browser (which is all multitab.js's BroadcastChannel can reach).
//
// No pairing code — everyone running this extension build shares one fixed group. Fine
// for a small private install shared with a couple people (see README); the Supabase
// anon key here is public (shipped in the extension) either way, so a code would only
// have stopped accidental cross-talk in the UI, not a determined attacker hitting the
// REST API directly. The real gate is the consent checkbox below: your accounts only
// ever get published if you explicitly tick it, every session.
(function() {
  var SUPABASE_URL      = 'https://qwcfsqsrtegyvvwkzcgb.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_mi9rS5i9a-xrAWC0lG0TNA_vg903xRL';
  var HEADERS = {
    'apikey':        SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
    'Content-Type':  'application/json',
  };

  var PRESENCE_TABLE = 'gheloo_sync_presence';
  var COMMANDS_TABLE = 'gheloo_sync_commands';
  var SYNC_CODE  = 'gheloo'; // fixed — no per-user pairing code
  var DEVICE_KEY = '__ghk_device_id';
  var PRESENCE_MS = 3000;
  var POLL_MS     = 300;
  var STALE_MS    = 12000; // presence rows older than this are treated as offline

  function randId() { return Math.random().toString(36).slice(2, 10); }

  function getOrCreateDeviceId() {
    try {
      var v = localStorage.getItem(DEVICE_KEY);
      if (v) return v;
      v = randId();
      localStorage.setItem(DEVICE_KEY, v);
      return v;
    } catch (e) { return randId(); }
  }

  var deviceId = getOrCreateDeviceId();
  var syncCode = SYNC_CODE;

  // multitab.js runs earlier in manifest.json and assigns window.__ghk_mt synchronously
  // (not behind DOMContentLoaded), so tabId is already available here.
  var tabId = (window.__ghk_mt && window.__ghk_mt.tabId) || randId();

  var _remoteAccounts = {}; // "deviceId:tabId" -> { deviceId, tabId, name }
  var _lastCmdId = 0;
  var _listeners = [];

  // Consent to being visible/usable by other PCs on this sync code. Intentionally NOT
  // persisted — always starts false on every page load/relog, so sharing accounts is an
  // explicit per-session opt-in, never something that silently carries over.
  //
  // Ticking it in ONE tab applies to every account open in THIS browser (same pattern
  // multitab.js/marktplaats.js already use for discovering local tabs): consent is
  // broadcast over BroadcastChannel so every other tab flips too, instead of needing the
  // checkbox ticked per tab. A tab opened later queries on load and adopts a "yes" from
  // any tab that already has it on.
  var _consent = false;
  var CONSENT_BC = new BroadcastChannel('gheloo_device_consent');

  function notify() { _listeners.forEach(function(cb) { try { cb(); } catch (e) {} }); }

  function removeOwnPresence() {
    fetch(SUPABASE_URL + '/rest/v1/' + PRESENCE_TABLE +
      '?device_id=eq.' + encodeURIComponent(deviceId) + '&tab_id=eq.' + encodeURIComponent(tabId),
      { method: 'DELETE', headers: HEADERS }).catch(function() {});
  }

  function _applyConsent(on) {
    _consent = !!on;
    if (!_consent) removeOwnPresence();
    else heartbeat();
    notify();
  }

  function setConsent(on) {
    _applyConsent(on);
    CONSENT_BC.postMessage({ type: 'set', on: _consent });
  }

  CONSENT_BC.onmessage = function(ev) {
    var msg = ev.data;
    if (!msg) return;
    if (msg.type === 'set') _applyConsent(!!msg.on);
    else if (msg.type === 'query') { if (_consent) CONSENT_BC.postMessage({ type: 'state', on: true }); }
    else if (msg.type === 'state' && msg.on) _applyConsent(true);
  };
  CONSENT_BC.postMessage({ type: 'query' }); // catch up to whatever this browser's other tabs already agreed to

  window.addEventListener('beforeunload', function() { if (_consent) removeOwnPresence(); });

  async function heartbeat() {
    if (!syncCode || !window._selfName || !_consent) return;
    try {
      await fetch(SUPABASE_URL + '/rest/v1/' + PRESENCE_TABLE + '?on_conflict=sync_code,device_id,tab_id', {
        method:  'POST',
        headers: Object.assign({}, HEADERS, { 'Prefer': 'resolution=merge-duplicates' }),
        body:    JSON.stringify([{
          sync_code:    syncCode,
          device_id:    deviceId,
          tab_id:       tabId,
          account_name: window._selfName,
          last_seen:    new Date().toISOString(),
        }]),
      });
    } catch (e) {}
  }

  async function pollAccounts() {
    if (!syncCode) return;
    try {
      var since = new Date(Date.now() - STALE_MS).toISOString();
      var url = SUPABASE_URL + '/rest/v1/' + PRESENCE_TABLE +
        '?sync_code=eq.' + encodeURIComponent(syncCode) +
        '&last_seen=gte.' + encodeURIComponent(since) +
        '&select=device_id,tab_id,account_name';
      var res = await fetch(url, { headers: HEADERS });
      if (!res.ok) return;
      var rows = await res.json();
      var next = {};
      rows.forEach(function(r) {
        if (r.device_id === deviceId && r.tab_id === tabId) return; // exclude self
        next[r.device_id + ':' + r.tab_id] = { deviceId: r.device_id, tabId: r.tab_id, name: r.account_name };
      });
      _remoteAccounts = next;
      notify();
    } catch (e) {}
  }

  async function pollCommands() {
    if (!syncCode) return;
    try {
      var url = SUPABASE_URL + '/rest/v1/' + COMMANDS_TABLE +
        '?sync_code=eq.' + encodeURIComponent(syncCode) +
        '&target_device_id=eq.' + encodeURIComponent(deviceId) +
        '&target_tab_id=eq.' + encodeURIComponent(tabId) +
        '&id=gt.' + _lastCmdId +
        '&order=id.asc&select=id,payload';
      var res = await fetch(url, { headers: HEADERS });
      if (!res.ok) return;
      var rows = await res.json();
      if (!rows.length) return;
      var ids = [];
      rows.forEach(function(r) {
        if (r.id > _lastCmdId) _lastCmdId = r.id;
        ids.push(r.id);
        if (window.__ghk_mt && window.__ghk_mt.execute) window.__ghk_mt.execute(r.payload);
      });
      // Best-effort cleanup so the commands table doesn't grow unbounded while a sequence
      // is running — re-processing is already impossible either way (id=gt._lastCmdId).
      fetch(SUPABASE_URL + '/rest/v1/' + COMMANDS_TABLE + '?id=in.(' + ids.join(',') + ')', {
        method: 'DELETE', headers: HEADERS,
      }).catch(function() {});
    } catch (e) {}
  }

  function sendRemote(targetDeviceId, targetTabId, str) {
    if (!syncCode) return;
    fetch(SUPABASE_URL + '/rest/v1/' + COMMANDS_TABLE, {
      method:  'POST',
      headers: HEADERS,
      body:    JSON.stringify([{
        sync_code:        syncCode,
        target_device_id: targetDeviceId,
        target_tab_id:    targetTabId,
        payload:          str,
      }]),
    }).catch(function() {});
  }

  setInterval(heartbeat, PRESENCE_MS);
  setInterval(pollAccounts, PRESENCE_MS);
  setInterval(pollCommands, POLL_MS);
  setTimeout(heartbeat, 500);
  setTimeout(pollAccounts, 800);
  window.onPacket && window.onPacket('UserObject', function() { setTimeout(heartbeat, 200); });

  window.__ghk_ds = {
    get deviceId() { return deviceId; },
    get tabId() { return tabId; },
    get consent() { return _consent; },
    setConsent:     setConsent,
    remoteAccounts: function() { return _remoteAccounts; },
    onChange:       function(cb) { if (typeof cb === 'function') _listeners.push(cb); },
    sendRemote:     sendRemote,
  };
})();
