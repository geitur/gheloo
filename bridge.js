(function() {
  window.addEventListener('message', function(e) {
    if (e.source === window && e.data && e.data.type === '__ghk_open_users') {
      chrome.runtime.sendMessage({ type: 'open_users' });
    }
  });

  chrome.runtime.onMessage.addListener(function(msg) {
    if (msg && msg.type === 'apply_figure') {
      window.postMessage({ type: '__ghk_apply_figure', figure: msg.figure, gender: msg.gender }, '*');
    }
  });

  // MAIN world (ui-update-alert.js) can't touch chrome.storage/getManifest directly,
  // so relay the update-check result background.js already computed.
  chrome.storage.local.get(['updateAvailable', 'latestVersion'], function(r) {
    window.postMessage({
      type: '__ghk_update_status',
      updateAvailable: !!r.updateAvailable,
      latestVersion: r.latestVersion || null,
      installedVersion: chrome.runtime.getManifest().version
    }, '*');
  });
})();
