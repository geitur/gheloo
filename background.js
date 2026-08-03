chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg && msg.type === 'apply_figure_to_tab') {
    chrome.tabs.sendMessage(msg.tabId, { type: 'apply_figure', figure: msg.figure, gender: msg.gender });
  }
  if (msg && msg.type === 'get_room_viewer_bundle') {
    getRoomViewerBundle().then(function(code) {
      sendResponse({ code: code });
    }).catch(function(err) {
      sendResponse({ code: null, error: String(err) });
    });
    return true; // keep the message channel open for the async sendResponse above
  }
});

// Room Viewer's renderer bundle lives outside this repo entirely (a separate public repo,
// geitur/gheloo-assets) so a normal Gheloo update never re-ships its 3.6MB — fetched once
// and cached in IndexedDB from then on. This has to happen here in the service worker, not
// in core/bridge.js (a content script) — content script fetches are bound by the *page's*
// CORS policy same as the page's own JS would be, so host_permissions doesn't bypass CORS
// for them the way it does here. Confirmed live: the release asset's actual bytes get
// served from Azure blob storage after GitHub's redirect, and that response has no CORS
// headers at all — a content-script fetch to it fails with a generic "Failed to fetch",
// while the exact same fetch from the background service worker succeeds.
// NOTE: 'roomviewer-v1' is permanently retired as a version string — it was reused for the
// final v1 release, but it was ALSO the tag of the very first throwaway debug build from the
// start of Room Viewer's development. getRoomViewerBundle() below caches by this exact string
// in IndexedDB and never re-checks once a key has a cached entry, so anyone who had that early
// debug build cached silently kept it forever after the "real" v1 was published under the same
// name — no error, it just never re-fetched. Confirmed live: reloading the extension after the
// v1 release swap brought back pre-fix behavior (no floor/wall, wrong wall item locations) for
// exactly this reason. Always bump to a version string that has never been used before.
var RV_BUNDLE_VERSION = 'roomviewer-v1.1'; // bump only when the compiled bundle itself changes
var RV_BUNDLE_URL = 'https://github.com/geitur/gheloo-assets/releases/download/' + RV_BUNDLE_VERSION + '/room-viewer.bundle.js';

function rvOpenDb() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open('gheloo-room-viewer', 1);
    req.onupgradeneeded = function() { req.result.createObjectStore('bundles'); };
    req.onsuccess = function() { resolve(req.result); };
    req.onerror = function() { reject(req.error); };
  });
}
function rvGetCached() {
  return rvOpenDb().then(function(db) {
    return new Promise(function(resolve) {
      var tx = db.transaction('bundles', 'readonly');
      var req = tx.objectStore('bundles').get(RV_BUNDLE_VERSION);
      req.onsuccess = function() { resolve(req.result || null); };
      req.onerror = function() { resolve(null); };
    });
  });
}
function rvSetCached(code) {
  return rvOpenDb().then(function(db) {
    var tx = db.transaction('bundles', 'readwrite');
    tx.objectStore('bundles').put(code, RV_BUNDLE_VERSION);
  });
}
async function getRoomViewerBundle() {
  var cached = await rvGetCached();
  if (cached) return cached;
  var res = await fetch(RV_BUNDLE_URL);
  if (!res.ok) throw new Error('fetch failed: ' + res.status);
  var code = await res.text();
  await rvSetCached(code);
  return code;
}

// gist.githubusercontent.com's raw CDN caches aggressively and ignores cache-busting query
// strings, so a freshly-edited gist can read stale for several minutes there. The Gists API
// isn't behind that CDN and reflects edits immediately, so use that instead.
var UPDATE_CHECK_URL = 'https://api.github.com/gists/f4ef3677067e8529037fcbe37879134f';
var RELEASES_URL     = 'https://github.com/geitur/gheloo/releases/latest';

function compareVersions(a, b) {
  var pa = String(a).split('.').map(Number);
  var pb = String(b).split('.').map(Number);
  for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
    var na = pa[i] || 0, nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

async function checkForUpdate() {
  try {
    var res = await fetch(UPDATE_CHECK_URL);
    if (!res.ok) return;
    var gist = await res.json();
    var file = gist.files && gist.files['version.json'];
    if (!file || !file.content) return;
    var data = JSON.parse(file.content);
    var current = chrome.runtime.getManifest().version;
    var hasUpdate = !!data.version && compareVersions(data.version, current) > 0;

    await chrome.storage.local.set({ updateAvailable: hasUpdate, latestVersion: data.version });
    if (hasUpdate) {
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#e11d48' });
      chrome.action.setTitle({ title: 'Gheloo — update available (v' + data.version + ')' });
    } else {
      chrome.action.setBadgeText({ text: '' });
      chrome.action.setTitle({ title: 'Gheloo' });
    }
  } catch (e) {
    console.warn('[Gheloo] update check failed:', e);
  }
}

chrome.action.onClicked.addListener(function() {
  chrome.storage.local.get('updateAvailable', function(r) {
    if (r.updateAvailable) chrome.tabs.create({ url: RELEASES_URL });
  });
});

chrome.runtime.onStartup.addListener(checkForUpdate);
chrome.runtime.onInstalled.addListener(checkForUpdate);
chrome.alarms.create('ghelooUpdateCheck', { periodInMinutes: 180 });
chrome.alarms.onAlarm.addListener(function(alarm) {
  if (alarm.name === 'ghelooUpdateCheck') checkForUpdate();
});
