(function() {
  if (document.getElementById('__mpa_panel')) return;

  // Marktplaats Alerts — polls GetMarketplaceOffers on an interval, diffs the offerId
  // set against the last snapshot, and pops an in-game bubble (styled after the native
  // "@mention" notification bubble) for anything new. MarketPlaceOffers byte layout is
  // parsed by parsers.js (window.PacketParsers.IN.MarketPlaceOffers) — reverse-engineered
  // and confirmed against two real captures (94 vs 93 total offers, diffed to isolate
  // exactly one new entry; every one of 94 records decoded cleanly against both).

  const POLL_MS = 500;
  const STORAGE_KEY = '__ghk_mpalerts_settings';

  let _on = false;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (saved.on) _on = true;
  } catch(_) {}

  function _save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ on: _on })); } catch(_) {}
  }

  function _outId(name) {
    if (!window.PKT || !window.PKT.OUT) return null;
    for (const id in window.PKT.OUT) {
      if (window.shortName(window.PKT.OUT[id], 'OUT') === name) return parseInt(id);
    }
    return null;
  }

  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  let _lastIds = null; // null = no snapshot yet (skip alerting on the very first poll)
  let _pollTimer = null;
  let _statusEl = null;
  let _logEl = null;
  let _togInp = null;
  let _togTrack = null;
  let _togThumb = null;

  // Instead of guessing pixel coordinates for where native notification bubbles spawn,
  // watch the DOM for a real one (any native message, e.g. "let op je AFK" toasts) and
  // capture its parent container — then drop our own bubbles into that exact same
  // container so they always land wherever native ones do, even if that moves.
  // (Observer is started from init(), once document.body actually exists — this script
  // runs at document_start, before body exists, so .observe(document.body, ...) here
  // would throw and silently kill the rest of the file.)
  let _nativeContainer = null;
  function _watchForNativeContainer() {
    if (!document.body) return;
    new MutationObserver(function(muts) {
      if (_nativeContainer) return;
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (!(node instanceof Element)) continue;
          const bubble = node.classList && node.classList.contains('nitro-notification-bubble') && !node.classList.contains('__mpa_bubble')
            ? node
            : node.querySelector && node.querySelector('.nitro-notification-bubble:not(.__mpa_bubble)');
          if (bubble && bubble.parentElement) { _nativeContainer = bubble.parentElement; return; }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  // Clicking a bubble opens the shop -> Zeldzaams -> Marktplaats -> Aanbod tab.
  // Matched by real class + visible text instead of absolute DOM position (XPath by
  // exact div-index broke as soon as some other modal shifted the tree) — this survives
  // reordering since it doesn't care how deep the element is nested.
  function _findByText(selector, text) {
    const els = document.querySelectorAll(selector);
    for (const el of els) {
      if (el.textContent && el.textContent.trim().indexOf(text) !== -1) return el;
    }
    return null;
  }
  // Polls instead of guessing a fixed delay — clicks the instant the element actually
  // shows up (React render time varies per step), gives up after timeoutMs.
  function _waitAndClickText(selector, text, timeoutMs, cb) {
    const start = Date.now();
    (function tick() {
      const el = _findByText(selector, text);
      if (el) { el.click(); if (cb) cb(); return; }
      if (Date.now() - start > timeoutMs) return;
      setTimeout(tick, 25);
    })();
  }
  function _openMarktplaatsShop() {
    const shopIcon = document.querySelector('.navigation-item.icon-catalog');
    if (!shopIcon) return;
    shopIcon.click();
    _waitAndClickText('.btn', 'Zeldzaams', 1500, function() {
      _waitAndClickText('.layout-grid-item', 'Marktplaats', 1500, function() {
        _waitAndClickText('.layout-grid-item', 'Aanbod', 1500, null);
      });
    });
  }

  function _furniInfo(classId) {
    const fd = window.FurniData;
    if (!fd) return null;
    return (fd.floor && fd.floor[classId]) || (fd.wall && fd.wall[classId]) || null;
  }

  function _furniImageUrl(classname) {
    return 'https://images.leet.city/library/hof_furni/icons/' + encodeURIComponent(classname) + '_icon.png';
  }

  function _logLine(msg) {
    if (!_logEl) return;
    const row = document.createElement('div');
    row.className = '__mpa_log_row';
    row.textContent = new Date().toTimeString().slice(0, 8) + '  ' + msg;
    _logEl.insertBefore(row, _logEl.firstChild);
    while (_logEl.children.length > 30) _logEl.removeChild(_logEl.lastChild);
  }

  function _showAlert(offer) {
    const info = _furniInfo(offer.classId);
    const name = info ? info.name : ('Item #' + offer.classId);
    const priceText = offer.price + ' BC' + (offer.count > 1 ? ' (x' + offer.count + ')' : '');
    _logLine(name + ' — ' + priceText);

    const iconUrl = info && info.classname ? _furniImageUrl(info.classname) : 'https://images.leet.city/c_images/notifications/level.png';

    const wrap = document.createElement('div');
    wrap.className = 'd-flex flex-column gap-1 __mpa_bubble_wrap';
    wrap.innerHTML =
      '<div class="d-flex gap-2 align-items-center cursor-pointer nitro-notification-bubble default-bubble rounded p-2 __mpa_bubble">' +
        '<div class="d-flex bubble-image-container">' +
          '<div class="icon bubble-image" style="background-image:url(&quot;' + iconUrl + '&quot;)"></div>' +
        '</div>' +
        '<div class="d-flex flex-column notification-bubble-text fw-bold">' +
          '<span class="__mpa_name">' + esc(name) + '</span>' +
          '<span class="__mpa_price">Prijs: ' + esc(priceText) + '</span>' +
        '</div>' +
      '</div>';
    const bubble = wrap.firstElementChild;

    bubble.addEventListener('click', function() {
      _openMarktplaatsShop();
      _removeAlert(wrap);
    });

    let stack = _nativeContainer;
    if (!stack) {
      stack = document.getElementById('__mpa_stack');
      if (!stack) {
        stack = document.createElement('div');
        stack.id = '__mpa_stack';
        stack.style.cssText = 'position:fixed;top:16px;right:16px;z-index:99998;display:flex;flex-direction:column;gap:6px;max-width:340px;pointer-events:none;align-items:flex-end';
        document.body.appendChild(stack);
      }
    }
    wrap.style.cssText += 'pointer-events:all;opacity:0;transition:opacity 220ms ease-out';
    stack.appendChild(wrap);
    requestAnimationFrame(function() { wrap.style.opacity = '1'; });

    setTimeout(function() { _removeAlert(wrap); }, 8000);
  }

  function _removeAlert(wrap) {
    if (!wrap || !wrap.parentNode) return;
    wrap.style.transition = 'opacity 2000ms linear';
    wrap.style.opacity = '0';
    setTimeout(function() { wrap.remove(); }, 2000);
  }

  window.onPacket('MarketPlaceOffers', function(p) {
    if (!p.parsed || !p.parsed.offers) return;
    const offers = p.parsed.offers;
    const curIds = new Set(offers.map(function(o) { return o.offerId; }));

    if (_lastIds) {
      const newOnes = offers.filter(function(o) { return !_lastIds.has(o.offerId); });
      newOnes.forEach(_showAlert);
      if (_statusEl) _statusEl.textContent = newOnes.length ? (newOnes.length + ' nieuw gevonden') : 'Geen nieuwe items';
    } else if (_statusEl) {
      _statusEl.textContent = offers.length + ' items geladen (baseline)';
    }
    _lastIds = curIds;
  });

  // Pause polling while the player has the native Marktplaats shop screen open
  // ("Mijn advertenties" or "Aanbod") — no point spamming requests for a screen
  // that's already fetching/showing this data itself.
  function _isMarktplaatsShopOpen() {
    const titles = document.querySelectorAll('p.ctlg-title');
    for (const el of titles) {
      const t = (el.textContent || '').trim();
      if (t === 'Mijn advertenties' || t === 'Aanbod') return true;
    }
    return false;
  }

  function _poll() {
    if (!_on) return;
    if (_isMarktplaatsShopOpen()) { if (_statusEl) _statusEl.textContent = 'Gepauzeerd (Marktplaats open)'; return; }
    const id = _outId('GetMarketplaceOffers');
    if (id === null) { if (_statusEl) _statusEl.textContent = 'GetMarketplaceOffers niet gevonden'; return; }
    window.sendPacket('OUT', id, '{i:-1}{i:-1}{i:0}{u:7}');
  }

  function _startPolling() {
    if (_pollTimer) return;
    _poll();
    _pollTimer = setInterval(_poll, POLL_MS);
  }
  function _stopPolling() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    _lastIds = null; // fresh baseline next time it's turned back on
  }

  function init() {
    _watchForNativeContainer();

    const style = document.createElement('style');
    style.textContent = [
      '#__mpa_panel{position:fixed;top:16px;right:16px;width:300px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__mpa_panel *{box-sizing:border-box}',
      '.__mpa_card_wrap{display:flex;flex-direction:column;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb}',
      '.__mpa_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__mpa_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__mpa_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__mpa_close:hover{color:#eceefb}',
      '#__mpa_body{padding:12px;display:flex;flex-direction:column;gap:10px}',
      '.__mpa_row{display:flex;align-items:center;justify-content:space-between;background:#1c1e2a;border:1px solid #23252f;border-radius:8px;padding:8px 10px}',
      '.__mpa_lbl{font-size:11px;font-weight:700;color:#eceefb}',
      '.__mpa_desc{font-size:9.5px;color:#5c5e6b;margin-top:2px}',
      '#__mpa_tog_wrap{position:relative;display:inline-block;width:34px;height:18px;flex-shrink:0;cursor:pointer}',
      '#__mpa_tog_inp{opacity:0;width:0;height:0;position:absolute}',
      '#__mpa_tog_track{position:absolute;inset:0;background:#23252f;border-radius:9px;transition:background .2s}',
      '#__mpa_tog_thumb{position:absolute;top:2px;left:2px;width:14px;height:14px;background:#eceefb;border-radius:50%;transition:transform .2s;box-shadow:0 1px 3px rgba(0,0,0,0.35)}',
      '#__mpa_status{font-size:10.5px;color:#82849a}',
      '#__mpa_log{max-height:180px;overflow-y:auto;border:1px solid #23252f;border-radius:8px;background:#0A0B10;padding:6px 8px;font-size:10px;font-family:monospace;color:#c7c9db;display:flex;flex-direction:column}',
      '.__mpa_log_row{padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.05)}',
      '.__mpa_log_row:last-child{border-bottom:none}',
      '.__mpa_bubble_wrap{width:200px}',
      '.nitro-notification-bubble.__mpa_bubble{background-color:rgba(46,46,44,0.92);box-shadow:0 4px 14px rgba(0,0,0,.4);color:#fff;width:200px!important;height:76px!important;box-sizing:border-box;padding:8px 10px!important;border-radius:10px!important;overflow:hidden}',
      '.__mpa_bubble .bubble-image-container{width:44px;height:44px;flex-shrink:0}',
      '.__mpa_bubble .bubble-image{background-size:contain!important;background-repeat:no-repeat!important;background-position:center!important;width:44px!important;height:44px!important;image-rendering:pixelated}',
      '.__mpa_bubble .notification-bubble-text{font-size:9px!important;line-height:1.35;min-width:0;overflow:hidden}',
      '.__mpa_bubble .__mpa_name{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:normal}',
      '.__mpa_bubble .__mpa_price{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}',
    ].join('');
    document.head.appendChild(style);

    const p = document.createElement('div');
    p.id = '__mpa_panel';
    p.innerHTML =
      '<div class="__mpa_card_wrap">' +
        '<div class="__mpa_hdr" id="__mpa_hdr">' +
          '<span class="__mpa_title">Marktplaats Alerts</span>' +
          '<span class="__mpa_close" id="__mpa_close">&times;</span>' +
        '</div>' +
        '<div id="__mpa_body">' +
          '<div class="__mpa_row">' +
            '<div>' +
              '<div class="__mpa_lbl">Live alerts</div>' +
              '<div class="__mpa_desc">Popup when a new item is listed</div>' +
            '</div>' +
            '<label id="__mpa_tog_wrap"><input type="checkbox" id="__mpa_tog_inp"><span id="__mpa_tog_track"></span><span id="__mpa_tog_thumb"></span></label>' +
          '</div>' +
          '<div id="__mpa_status">Off.</div>' +
          '<div id="__mpa_log"></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(p);
    p.style.display = 'none';

    window.__ghk_makeDraggable(p, p.querySelector('#__mpa_hdr'), '__ghk_mpa_pos', e => e.target.id === '__mpa_close');
    p.querySelector('#__mpa_close').addEventListener('click', () => p.style.display = 'none');

    _statusEl = p.querySelector('#__mpa_status');
    _logEl = p.querySelector('#__mpa_log');

    _togInp = p.querySelector('#__mpa_tog_inp');
    _togTrack = p.querySelector('#__mpa_tog_track');
    _togThumb = p.querySelector('#__mpa_tog_thumb');
    _togInp.checked = _on;
    _setToggleUI(_on);
    if (_on) _startPolling();

    _togInp.addEventListener('change', function() {
      window.__mpa_setEnabled(this.checked);
    });

    window.__mpa_render = function() {};
  }

  function _setToggleUI(on) {
    if (_togTrack) _togTrack.style.background = on ? '#6C7CFF' : '#23252f';
    if (_togThumb) _togThumb.style.transform = on ? 'translateX(16px)' : 'translateX(0)';
    if (_statusEl) _statusEl.textContent = on ? 'Watching for new listings...' : 'Off.';
  }

  // Lets the Gheloo hub's own Settings toggle (below Room History) control this without
  // needing the Marktplaats Alerts panel open at all.
  window.__mpa_setEnabled = function(on) {
    _on = !!on;
    _save();
    if (_togInp) _togInp.checked = _on;
    _setToggleUI(_on);
    if (_on) _startPolling(); else _stopPolling();
  };
  window.__mpa_isEnabled = function() { return _on; };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      window.__ghk_ready(init);
    });
  } else {
    window.__ghk_ready(init);
  }
})();
