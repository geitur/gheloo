(function() {
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
