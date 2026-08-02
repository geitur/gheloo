chrome.runtime.onMessage.addListener(function(msg) {
  if (msg && msg.type === 'apply_figure_to_tab') {
    chrome.tabs.sendMessage(msg.tabId, { type: 'apply_figure', figure: msg.figure, gender: msg.gender });
  }
});

var UPDATE_CHECK_URL = 'https://gist.githubusercontent.com/geitur/f4ef3677067e8529037fcbe37879134f/raw/version.json';
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
    var res = await fetch(UPDATE_CHECK_URL + '?_=' + Date.now());
    if (!res.ok) return;
    var data = await res.json();
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
