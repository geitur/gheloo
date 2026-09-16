(function() {
  chrome.runtime.onMessage.addListener(function(msg) {
    if (msg && msg.type === 'apply_figure') {
      window.postMessage({ type: '__ghk_apply_figure', figure: msg.figure, gender: msg.gender }, '*');
    }
  });

  // MAIN world (core/update-toast.js) can't touch chrome.storage/getManifest directly,
  // so relay the update-check result background.js already computed.
  chrome.storage.local.get(['updateAvailable', 'latestVersion'], function(r) {
    window.postMessage({
      type: '__ghk_update_status',
      updateAvailable: !!r.updateAvailable,
      latestVersion: r.latestVersion || null,
      installedVersion: chrome.runtime.getManifest().version
    }, '*');
  });

  // Room Viewer's renderer bundle: MAIN world asks here, this relays to background.js
  // (the actual fetch+IndexedDB-cache logic lives there, not here — a content script's
  // fetch is bound by the page's CORS policy same as the page's own JS, so it can't reach
  // across GitHub's redirect to Azure blob storage; the background service worker's fetch
  // isn't restricted that way). See background.js's getRoomViewerBundle for why.
  window.addEventListener('message', function(e) {
    if (e.source !== window || !e.data || e.data.type !== '__ghk_rv_request_bundle') return;
    chrome.runtime.sendMessage({ type: 'get_room_viewer_bundle' }, function(response) {
      window.postMessage({ type: '__ghk_rv_bundle', ok: !!(response && response.ok), error: response && response.error, diag: response && response.diag }, '*');
    });
  });
})();
