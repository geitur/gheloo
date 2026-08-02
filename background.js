chrome.runtime.onMessage.addListener(function(msg) {
  if (msg && msg.type === 'apply_figure_to_tab') {
    chrome.tabs.sendMessage(msg.tabId, { type: 'apply_figure', figure: msg.figure, gender: msg.gender });
  }
});

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
