// Marktplaats Scanner — one background tab per category, each running
// extensions/fun/marktplaats-scan-worker.js (matched via manifest.json against
// leet.city/ruilwaarde) tagged by a #ghscan=<slug> hash so that file knows which category
// tab to click and never touches a tab a user opened by hand.
var MP_SCAN_CATEGORIES = ['club-cadeau', 'ltd', 'rares', 'ss'];
var MP_SCAN_URL_BASE = 'https://www.leet.city/ruilwaarde';

function mpSleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

// chrome.tabs.remove() has been seen live to just not close a tab (still shows up in the
// next tabs.query a moment later — a busy/loading tab occasionally ignores the first
// remove) — this re-queries and retries the removal instead of firing it once and trusting
// it worked, giving up only after several real attempts.
function closeAllScanTabsUntilGone(maxAttempts) {
  maxAttempts = maxAttempts || 5;
  function attempt(n) {
    return chrome.tabs.query({ url: MP_SCAN_URL_BASE + '*' }).then(function(tabs) {
      if (!tabs.length) return;
      return Promise.all(tabs.map(function(t) { return chrome.tabs.remove(t.id).catch(function() {}); }))
        .then(function() { return mpSleep(300); })
        .then(function() {
          if (n >= maxAttempts) return; // a tab that survives this many removes isn't going to close — stop hammering it
          return attempt(n + 1);
        });
    });
  }
  return attempt(1);
}

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg && msg.type === 'apply_figure_to_tab') {
    chrome.tabs.sendMessage(msg.tabId, { type: 'apply_figure', figure: msg.figure, gender: msg.gender });
  }
  if (msg && msg.type === 'mp_scan_start') {
    // Close any scan tabs already open before opening fresh ones — toggling Scanner on
    // twice in a row (or an extension reload re-triggering the saved "on" state while old
    // tabs from before the reload are still alive) used to just pile up a second set of 4
    // tabs on top of the first, all scanning the same 4 categories in parallel with
    // themselves.
    closeAllScanTabsUntilGone().then(function() {
      return Promise.all(MP_SCAN_CATEGORIES.map(function(slug) {
        return chrome.tabs.create({ url: MP_SCAN_URL_BASE + '#ghscan=' + slug, active: false });
      }));
    }).then(function(tabs) {
      sendResponse({ tabIds: tabs.map(function(t) { return t.id; }) });
    }).catch(function() {
      sendResponse({ tabIds: [] });
    });
    return true; // keep the message channel open for the async sendResponse above
  }
  if (msg && msg.type === 'mp_scan_stop') {
    // Queried by URL instead of trusting passed-in tab ids — those only ever lived in the
    // hotel tab's in-memory state, so a reload between start and stop would otherwise leave
    // the scan tabs orphaned with nothing able to close them.
    closeAllScanTabsUntilGone();
  }
  if (msg && msg.type === 'get_room_viewer_bundle') {
    var tabId = sender.tab && sender.tab.id;
    if (tabId == null) { sendResponse({ ok: false, error: 'no sender tab' }); return; }
    getRoomViewerBundle().then(function(code) {
      // Injected via chrome.scripting.executeScript, NOT a page-created <script src="blob:">
      // tag — the latter is a DOM element the page's own CSP evaluates (indistinguishable
      // from the page adding it itself), which is why that approach could silently fail
      // partway through on strict host pages with no catchable JS exception to explain why.
      // Content scripts injected through this API (like every other file in this extension,
      // declared in manifest.json's content_scripts) are exempt from the page's CSP — same
      // exemption, just invoked dynamically instead of declaratively at document_start.
      return chrome.scripting.executeScript({
        target: { tabId: tabId },
        world: 'MAIN',
        func: function(src) {
          var hadBefore = !!window.__rv_renderThumbnail;
          try {
            new Function(src)();
          } catch (e) {
            window.__rv_loadError = (e && e.stack) ? e.stack : String(e);
          }
          // No devtools access on the target machine — return real numbers instead of
          // guessing again next time this fails. srcLength close to 0 means the fetch
          // itself was bad (not a page-context problem at all); a length matching the
          // real bundle but still no registration and no loadError means something is
          // silently eating the injected code between here and execution.
          return {
            srcLength: src ? src.length : 0,
            srcTail: src ? src.slice(-80) : '',
            hadBefore: hadBefore,
            hasThumbnailFn: !!window.__rv_renderThumbnail,
            loadError: window.__rv_loadError || null
          };
        },
        args: [code]
      });
    }).then(function(results) {
      var diag = results && results[0] && results[0].result;
      sendResponse({ ok: true, diag: diag });
    }).catch(function(err) {
      sendResponse({ ok: false, error: String(err) });
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
var RV_BUNDLE_VERSION = 'roomviewer-v2'; // bump only when the compiled bundle itself changes
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
// A truncated fetch (confirmed live: a partial download got cached and every retry after
// that just kept returning the same broken copy forever, with reloading the extension not
// helping since IndexedDB survives that) used to poison the cache permanently with no way
// to detect it — the esbuild footer (see esbuild.config.mjs's banner/footer) is always the
// literal last thing in a complete bundle, so its absence is a cheap, reliable signal that
// what's stored (or what a fetch just produced) is bad and must not be trusted or kept.
function _rvLooksComplete(code) {
  return typeof code === 'string' && code.length > 0 &&
    code.slice(-200).indexOf('window.__rv_loadError') !== -1;
}

async function getRoomViewerBundle() {
  var cached = await rvGetCached();
  if (cached && _rvLooksComplete(cached)) return cached;

  var res = await fetch(RV_BUNDLE_URL);
  if (!res.ok) throw new Error('fetch failed: ' + res.status);
  var code = await res.text();
  if (!_rvLooksComplete(code)) {
    throw new Error('fetch truncated: got ' + code.length + ' chars, bundle is missing its closing footer');
  }
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
