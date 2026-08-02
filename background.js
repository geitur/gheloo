chrome.runtime.onMessage.addListener(function(msg) {
  if (msg && msg.type === 'open_users') {
    chrome.tabs.create({ url: chrome.runtime.getURL('users.html') });
  }
  if (msg && msg.type === 'apply_figure_to_tab') {
    chrome.tabs.sendMessage(msg.tabId, { type: 'apply_figure', figure: msg.figure, gender: msg.gender });
  }
});
