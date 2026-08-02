(function() {
  var RELEASES_URL = 'https://github.com/geitur/gheloo/releases/latest';
  var _status = null;
  var _shown = false;

  window.addEventListener('message', function(e) {
    if (e.source !== window || !e.data || e.data.type !== '__ghk_update_status') return;
    _status = e.data;
    _maybeShow();
  });

  window.onPacket('UserObject', function(p) {
    if (!p || !p.parsed || !p.parsed.name) return;
    _selfNameForToast = p.parsed.name;
    _maybeShow();
  });

  var _selfNameForToast = null;

  function _maybeShow() {
    if (_shown) return;
    if (!_status || !_status.updateAvailable) return;
    if (!_selfNameForToast) return;
    if (sessionStorage.getItem('__ghk_update_dismissed') === _status.latestVersion) return;
    _shown = true;
    _render(_selfNameForToast, _status.installedVersion, _status.latestVersion);
  }

  function _render(name, installed, latest) {
    var css =
      '#__upd{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:320px;z-index:100000;' +
        'user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px;' +
        'background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb;' +
        'animation:__upd_rise .34s cubic-bezier(.2,.9,.25,1) both}' +
      '@keyframes __upd_rise{from{opacity:0;transform:translate(-50%,-50%) translateY(10px) scale(.97)}' +
        'to{opacity:1;transform:translate(-50%,-50%) translateY(0) scale(1)}}' +
      '#__upd_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10}' +
      '#__upd_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}' +
      '#__upd_title{font:600 13px system-ui;color:#eceefb;flex:1}' +
      '#__upd_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}' +
      '#__upd_close:hover{color:#eceefb}' +
      '#__upd_body{padding:12px 14px 14px}' +
      '#__upd_lede{font-size:11px;color:#82849a;line-height:1.5}' +
      '#__upd_lede b{color:#A6B0FF;font-family:monospace;font-weight:700}' +
      '#__upd_meta{margin-top:10px;display:flex;align-items:center;justify-content:space-between;font-family:monospace;' +
        'font-size:10px;color:#5c5e6b;padding:7px 9px;background:#0A0B10;border:1px solid #23252f;border-radius:8px;' +
        'font-variant-numeric:tabular-nums}' +
      '#__upd_meta b{color:#eceefb;font-weight:700}#__upd_meta span.arrow{color:#6C7CFF}' +
      '#__upd_actions{margin-top:10px;display:flex;gap:6px}' +
      '#__upd_actions button{flex:1;border:none;border-radius:8px;padding:6px 10px;font:600 11px system-ui;cursor:pointer}' +
      '#__upd_get{background:#A6B0FF;color:#0A0B10}#__upd_get:hover{filter:brightness(1.08)}' +
      '#__upd_later{background:#1c1e2a;color:#82849a;border:1px solid #23252f}#__upd_later:hover{color:#eceefb}';

    var style = document.createElement('style');
    style.textContent = css;
    document.documentElement.appendChild(style);

    var el = document.createElement('div');
    el.id = '__upd';
    el.innerHTML =
      '<div id="__upd_hdr">' +
        '<span id="__upd_eyebrow">Gheloo</span>' +
        '<span id="__upd_title">Update available</span>' +
        '<span id="__upd_close">&times;</span>' +
      '</div>' +
      '<div id="__upd_body">' +
        '<div id="__upd_lede">Signed in as <b>' + _esc(name) + '</b> — a newer build is up.</div>' +
        '<div id="__upd_meta">' +
          '<span>installed <b>' + _esc(installed) + '</b></span>' +
          '<span class="arrow">&#10148;</span>' +
          '<span>latest <b>' + _esc(latest) + '</b></span>' +
        '</div>' +
        '<div id="__upd_actions">' +
          '<button id="__upd_get">Get update</button>' +
          '<button id="__upd_later">Later</button>' +
        '</div>' +
      '</div>';
    document.documentElement.appendChild(el);

    function dismiss() {
      sessionStorage.setItem('__ghk_update_dismissed', latest);
      el.remove();
      style.remove();
    }

    el.querySelector('#__upd_close').addEventListener('click', dismiss);
    el.querySelector('#__upd_later').addEventListener('click', dismiss);
    el.querySelector('#__upd_get').addEventListener('click', function() {
      window.open(RELEASES_URL, '_blank');
      dismiss();
    });
  }

  function _esc(s) {
    return String(s).replace(/[&<>"']/g, function(c) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }
})();
