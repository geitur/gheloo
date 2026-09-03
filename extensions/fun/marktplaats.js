(function() {
  if (document.getElementById('__mpa_panel')) return;

  // Marktplaats — two independent features sharing one panel:
  //  1. Marktplaats scanner: polls GetMarketplaceOffers on an interval (MarketPlaceOffers
  //     byte layout is parsed by parsers.js, window.PacketParsers.IN.MarketPlaceOffers —
  //     reverse-engineered and confirmed against two real captures) and pushes a throttled
  //     snapshot of the live public listings to mp_live_offers on marktplaats.databin.uk,
  //     feeding the site's "Marktplaats Offers" tab. Rows just age out (last_seen TTL
  //     prune) instead of being diffed/deleted individually — the packet always carries
  //     the full current list, so a plain TTL is simpler and just as correct as computing
  //     a delete-set every sync.
  //  2. Marktplaats alerts: pops an in-game bubble for a genuinely new offer, sourced from
  //     mp_live_offers directly (not this tab's own packet stream) — see
  //     _pollServerOffers — so it fires even for offers logged by another player's tab or
  //     the VM's ruilwaarde-proxy-scan (runs on its own schedule, no browser needed at
  //     all). The two toggles here used to be three (a separate local-packet "Live alerts"
  //     and a browser-tab-based "Ruilwaarde scanner" for value/sales history) — both
  //     removed once the proxy-scan and this server-sourced alert made them redundant.

  const POLL_MS = 500;
  const DB_SYNC_MS = 1000;
  // Decoupled from DB_SYNC_MS on purpose — pruning too tight to the sync interval risks
  // dropping a still-live offer over one slow/failed sync tick. A fixed, more generous
  // window stays safe regardless of how fast DB_SYNC_MS is tuned.
  const OFFER_TTL_MS = 6000;
  const DB_URL = 'https://marktplaats.databin.uk/rest/v1';
  const DB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6ImdoZWxvby1zZWxmaG9zdCIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwfQ.9uAMhqRJOL-m_xtTO5duAUOAw-4pKk4LEENcT47crXU';
  const DB_HEADERS = { apikey: DB_KEY, Authorization: 'Bearer ' + DB_KEY, 'Content-Type': 'application/json' };

  const LIVE_SCAN_STORAGE_KEY = '__ghk_mplivescan_settings';
  // On by default — no saved settings means never explicitly toggled, not "off". A user
  // who doesn't want their client feeding the shared scan has to turn this off themselves.
  let _liveScanOn = true;
  try {
    const _liveScanRaw = localStorage.getItem(LIVE_SCAN_STORAGE_KEY);
    if (_liveScanRaw !== null) {
      const saved = JSON.parse(_liveScanRaw);
      if (typeof saved.on === 'boolean') _liveScanOn = saved.on;
    }
  } catch(_) {}

  function _saveLiveScan() {
    try { localStorage.setItem(LIVE_SCAN_STORAGE_KEY, JSON.stringify({ on: _liveScanOn })); } catch(_) {}
  }

  // Server-based alerts — reacts to mp_live_offers on marktplaats.databin.uk directly,
  // independent of this tab's own GetMarketplaceOffers poll (see _pollServerOffers). Works
  // even when this session isn't the one that logged the offer — another player's tab or
  // the VM's proxy-scan (ruilwaarde-proxy-scan, runs every 2h without any browser open) may
  // have found it. Discount tier/color match the site's own (marktplaats-site/app.js
  // discountColor) so a bubble's tint means the same thing there and here.
  const SERVER_ALERT_STORAGE_KEY = '__ghk_mpsrv_settings';
  // On by default — no saved settings means never explicitly toggled, not "off". A user
  // who doesn't want the alert bubbles has to turn this off themselves.
  let _serverAlertsOn = true;
  let _serverMinDiscount = 0; // 0 = alert on every new offer, regardless of discount
  let _serverOpenDetailOnClick = true; // click a bubble -> also open the item's stats panel
  try {
    const _serverRaw = localStorage.getItem(SERVER_ALERT_STORAGE_KEY);
    if (_serverRaw !== null) {
      const saved = JSON.parse(_serverRaw);
      if (typeof saved.on === 'boolean') _serverAlertsOn = saved.on;
      if (typeof saved.minDiscount === 'number') _serverMinDiscount = saved.minDiscount;
      if (typeof saved.openDetail === 'boolean') _serverOpenDetailOnClick = saved.openDetail;
    }
  } catch(_) {}
  function _saveServerAlerts() {
    try { localStorage.setItem(SERVER_ALERT_STORAGE_KEY, JSON.stringify({ on: _serverAlertsOn, minDiscount: _serverMinDiscount, openDetail: _serverOpenDetailOnClick })); } catch(_) {}
  }

  function _outId(name) {
    if (!window.PKT || !window.PKT.OUT) return null;
    for (const id in window.PKT.OUT) {
      if (window.shortName(window.PKT.OUT[id], 'OUT') === name) return parseInt(id);
    }
    return null;
  }

  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  let _pollTimer = null;
  let _liveScanTogInp = null;
  let _liveScanTogTrack = null;
  let _liveScanTogThumb = null;
  let _serverTogInp = null;
  let _serverTogTrack = null;
  let _serverTogThumb = null;
  let _serverStatusEl = null;
  let _serverMinDiscountEl = null;
  let _serverCustomRowEl = null;
  let _serverCustomPctEl = null;
  let _serverDetailTogInp = null;
  let _serverDetailTogTrack = null;
  let _serverDetailTogThumb = null;
  let _serverPollTimer = null;
  let _serverAvgRefreshTimer = null;

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

  // Color-variant classnames use a literal "*" (e.g. "chair_plasto*14") — the CDN 404s on
  // that, only serves the file with * swapped for "_" (confirmed live).
  function _furniImageUrl(classname) {
    return 'https://images.leet.city/library/hof_furni/icons/' + encodeURIComponent(String(classname).replace(/\*/g, '_')) + '_icon.png';
  }

  // Drops a bubble into whatever container native toasts use (or a fallback stack this
  // file owns), fades it in, and schedules its auto-dismiss.
  function _attachAlertToStack(wrap, ttlMs) {
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

    setTimeout(function() { _removeAlert(wrap); }, ttlMs || 8000);
  }

  function _removeAlert(wrap) {
    if (!wrap || !wrap.parentNode) return;
    wrap.style.transition = 'opacity 2000ms linear';
    wrap.style.opacity = '0';
    setTimeout(function() { wrap.remove(); }, 2000);
  }

  // Discount tier -> color, matching marktplaats-site/app.js's discountColor exactly (same
  // meaning in both places). A markup (pct <= 0) or unknown average (pct === null) gets a
  // neutral/red tint instead of a tier color.
  function _discountTierColor(pct) {
    if (pct == null) return '#5c5e6b';
    if (pct <= 0) return '#e05a5a';
    if (pct < 20) return '#8a8f9a';
    if (pct < 30) return '#33c47a';
    if (pct < 40) return '#6C7CFF';
    if (pct < 50) return '#a35bfa';
    return '#f2994a';
  }

  // Same "(LTD) suffix = count field is an edition/serial number, not a stack size"
  // convention the site uses (marktplaats-site/app.js's _isLtd) — kept as its own named
  // helper here since the poll's shrink-vs-growth suppression logic needs it too, not just
  // the name display below.
  function _isLtdName(itemName) {
    return /\(LTD\)\s*$/.test(itemName || '');
  }

  // Server-detected offer (from mp_live_offers, not this tab's own packet stream). Price +
  // discount% sit stacked in one small lightly-tinted/transparent chip, in the discount tier
  // color (same tiers/colors as the site's own discount badge) — no "Prijs:"/"t.o.v. gem."
  // labels, no stack count, just the two numbers. LTD items get their edition/serial number
  // appended to the name (display only — never written back into mp_items.item_name, since
  // the site already appends its own "#N" at render time off the same count field, and
  // baking one in would double up with the other).
  function _showServerAlert(offer, pct) {
    const priceText = offer.price.toLocaleString() + ' BC';
    const pctText = pct == null ? '' : (pct > 0 ? '-' : '+') + Math.round(Math.abs(pct)) + '%';
    const tint = _discountTierColor(pct);
    const iconUrl = offer.icon_url || 'https://images.leet.city/c_images/notifications/level.png';
    const nameText = offer.item_name + (_isLtdName(offer.item_name) && offer.count > 1 ? ' [' + offer.count + ']' : '');

    const wrap = document.createElement('div');
    wrap.className = 'd-flex flex-column gap-1 __mpa_bubble_wrap';
    wrap.innerHTML =
      '<div class="d-flex gap-2 align-items-center cursor-pointer nitro-notification-bubble default-bubble rounded p-2 __mpa_bubble">' +
        '<div class="d-flex bubble-image-container">' +
          '<div class="icon bubble-image" style="background-image:url(&quot;' + iconUrl + '&quot;)"></div>' +
        '</div>' +
        '<div class="d-flex flex-column notification-bubble-text fw-bold">' +
          '<span class="__mpa_name">' + esc(nameText) + '</span>' +
          '<span class="__mpa_chip" style="background:' + tint + '26;color:' + tint + '">' +
            '<span class="__mpa_chip_price">' + esc(priceText) + '</span>' +
            (pctText ? '<span class="__mpa_chip_pct">' + esc(pctText) + '</span>' : '') +
          '</span>' +
        '</div>' +
      '</div>';
    const bubble = wrap.firstElementChild;

    bubble.addEventListener('click', function() {
      // Turning the scanner toggle fully off (not just relying on _isMarktplaatsShopOpen's
      // own pause) before the native UI even starts opening closes a real race: that pause
      // only kicks in once the shop's DOM markers actually render, which is a beat AFTER the
      // click — a poll tick landing in that gap could still sync a filtered/transitional
      // response. The 50ms gives that toggle-off a moment to actually settle before
      // navigating. Auto re-enabled the instant the shop screen closes again (see the
      // interval below) — never left off for real just because someone clicked a bubble.
      if (_liveScanOn) {
        _liveScanAutoDisabled = true;
        window.__mplivescan_setEnabled(false);
        _armLiveScanAutoReenable();
      }
      setTimeout(function() {
        _openMarktplaatsShop();
        if (_serverOpenDetailOnClick) _showItemDetailPanel(offer.item_name, offer);
      }, 50);
      _removeAlert(wrap);
    });

    _attachAlertToStack(wrap, 12000);
  }

  // Item detail panel — opened from a bubble click (see _showServerAlert), toggleable via
  // the "Marktplaats alerts" tile. Same stats/algorithm as the site's own item detail modal
  // (marktplaats-site/app.js: computeSalesStats/salesStatsOptsFor/renderDetailStats/
  // renderPriceChart) ported here so the numbers agree wherever you look at them, just laid
  // out in a second small floating panel instead of a full-page modal.
  const DT_CURRENCY_LABELS = { belcredits: 'BC', diamonds: 'Diamonds', credits: 'Credits' };
  function _dtCurrencyLabel(c) { return DT_CURRENCY_LABELS[c] || (c || ''); }
  function _dtFullTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  const DT_SS_LABEL = 'Super Zeldzaam (SS)';
  const DT_SS_ALWAYS_SUSPICIOUS_EXCLUDED = new Set(['De Hand in het Gezicht (SS)', 'Prinselijke Troon (SS)']);
  function _dtStatsOptsFor(item) {
    const opts = {};
    if (item && item.custom_value > 0 && item.custom_value_currency === 'belcredits') opts.seedValue = item.custom_value;
    if (item && item.category === DT_SS_LABEL && !DT_SS_ALWAYS_SUSPICIOUS_EXCLUDED.has(item.name)) opts.alwaysSuspiciousBelow = 100;
    return opts;
  }
  function _dtComputeSalesStats(salesAsc, opts) {
    opts = opts || {};
    const hasSeed = opts.seedValue > 0;
    let cleanSum = hasSeed ? opts.seedValue : 0;
    let cleanCount = hasSeed ? 1 : 0;
    let rawSum = hasSeed ? opts.seedValue : 0;
    const perSale = salesAsc.map(function(s, i) {
      rawSum += s.price;
      let suspicious = false, pctFromAvg = null;
      if (s.manual_suspicious === true) {
        suspicious = true;
      } else if (opts.alwaysSuspiciousBelow != null && s.price <= opts.alwaysSuspiciousBelow) {
        suspicious = true;
      } else if (i >= 20 && cleanCount > 0) {
        const runningAvg = cleanSum / cleanCount;
        pctFromAvg = ((s.price - runningAvg) / runningAvg) * 100;
        if (Math.abs(pctFromAvg) > 50) suspicious = true;
      }
      if (!suspicious) { cleanSum += s.price; cleanCount++; }
      return Object.assign({}, s, { suspicious: suspicious, pctFromAvg: pctFromAvg });
    });
    const rawCount = salesAsc.length + (hasSeed ? 1 : 0);
    return {
      count: salesAsc.length,
      rawAvg: rawCount ? rawSum / rawCount : null,
      cleanAvg: cleanCount ? cleanSum / cleanCount : null,
      cleanCount: cleanCount,
      perSale: perSale,
    };
  }

  const DT_WINDOWS = [
    { key: 'all', label: 'All-time', days: 0 },
    { key: '90', label: '90 dagen', days: 90 },
    { key: '10', label: '10 dagen', days: 10 },
  ];

  let _detailPanelEl = null;
  let _detailPollTimer = null;
  let _detailData = null; // { item, liveOffer, sales, ascending, changePct, statsOpts }
  let _detailWindow = 'all';

  function _ensureDetailPanel() {
    if (_detailPanelEl) return _detailPanelEl;
    const p = document.createElement('div');
    p.id = '__mpa_detail_panel';
    p.style.display = 'none';
    p.innerHTML =
      '<div class="__mpa_card_wrap">' +
        '<div class="__mpa_hdr" id="__mpad_hdr">' +
          '<span class="__mpa_title" id="__mpad_title">Item</span>' +
          '<span class="__mpa_close" id="__mpad_close">&times;</span>' +
        '</div>' +
        '<div id="__mpad_body"></div>' +
      '</div>';
    document.body.appendChild(p);
    window.__ghk_makeDraggable(p, p.querySelector('#__mpad_hdr'), '__ghk_mpad_pos', function(e) { return e.target.id === '__mpad_close'; });
    p.querySelector('#__mpad_close').addEventListener('click', function() {
      p.style.display = 'none';
      if (_detailPollTimer) { clearInterval(_detailPollTimer); _detailPollTimer = null; }
    });
    p.addEventListener('click', function(e) {
      const winBtn = e.target.closest('[data-dtwindow]');
      if (winBtn) { _detailWindow = winBtn.getAttribute('data-dtwindow'); _dtRenderWindow(); }
    });
    _detailPanelEl = p;
    return p;
  }

  async function _showItemDetailPanel(itemName, liveOfferHint) {
    const p = _ensureDetailPanel();
    p.style.display = '';
    p.style.top = p.style.top || '16px';
    p.style.right = p.style.right || '332px';
    p.querySelector('#__mpad_title').textContent = itemName;
    p.querySelector('#__mpad_body').innerHTML = '<div class="__mpad_loading">Laden...</div>';
    _detailWindow = 'all';
    await _dtLoadAndRender(itemName, liveOfferHint);

    if (_detailPollTimer) clearInterval(_detailPollTimer);
    _detailPollTimer = setInterval(function() {
      if (p.style.display === 'none') { clearInterval(_detailPollTimer); _detailPollTimer = null; return; }
      _dtLoadAndRender(itemName, liveOfferHint);
    }, 10000);
  }

  async function _dtLoadAndRender(itemName, liveOfferHint) {
    let item = null, sales = [];
    try {
      const itemRows = await fetch(DB_URL + '/mp_items?name=eq.' + encodeURIComponent(itemName) + '&select=name,icon_url,value,value_currency,custom_value,custom_value_currency,category&limit=1', { headers: DB_HEADERS }).then(function(r) { return r.json(); });
      item = itemRows[0] || null;
      sales = await fetch(DB_URL + '/mp_sales?item_name=eq.' + encodeURIComponent(itemName) + '&select=offer_id,price,currency,sold_at,manual_suspicious&order=sold_at.desc&limit=1000', { headers: DB_HEADERS }).then(function(r) { return r.json(); });
    } catch (e) {
      if (_detailPanelEl) _detailPanelEl.querySelector('#__mpad_body').innerHTML = '<div class="__mpad_loading">Fout bij laden.</div>';
      return;
    }
    // A live offer that's no longer in mp_live_offers (bought/expired since the alert fired)
    // just falls back to the hint the bubble was clicked with, which is always at least the
    // price/count that triggered this alert in the first place.
    let liveOffer = liveOfferHint;
    try {
      const liveRows = await fetch(DB_URL + '/mp_live_offers?item_name=eq.' + encodeURIComponent(itemName) + '&select=item_name,price,count&order=price.asc&limit=1', { headers: DB_HEADERS }).then(function(r) { return r.json(); });
      if (liveRows[0]) liveOffer = liveRows[0];
    } catch (e) { /* keep the hint */ }

    const ascending = sales.slice().reverse();
    let changePct = null;
    if (sales.length >= 2) {
      const rawAvg = ascending.reduce(function(s, r) { return s + r.price; }, 0) / ascending.length;
      const avgBefore = sales.slice(1).reduce(function(s, r) { return s + r.price; }, 0) / (sales.length - 1);
      if (avgBefore > 0) changePct = ((rawAvg - avgBefore) / avgBefore) * 100;
    }

    _detailData = { item: item, liveOffer: liveOffer, sales: sales, ascending: ascending, changePct: changePct, statsOpts: _dtStatsOptsFor(item) };
    _dtRenderWindow();
  }

  function _dtRenderWindow() {
    if (!_detailData || !_detailPanelEl) return;
    const d = _detailData;
    const win = DT_WINDOWS.find(function(w) { return w.key === _detailWindow; }) || DT_WINDOWS[0];
    const points = win.days > 0 ? d.ascending.filter(function(s) { return Date.now() - new Date(s.sold_at).getTime() <= win.days * 86400000; }) : d.ascending;
    const stats = _dtComputeSalesStats(points, d.statsOpts);

    const toggleHtml = DT_WINDOWS.map(function(w) {
      return '<button class="__mpad_wintog' + (w.key === _detailWindow ? ' active' : '') + '" data-dtwindow="' + w.key + '">' + w.label + '</button>';
    }).join('');

    const suspiciousByOfferId = new Map(_dtComputeSalesStats(d.ascending, d.statsOpts).perSale.map(function(s) { return [s.offer_id, s]; }));
    const salesHtml = d.sales.length ? d.sales.map(function(s, i) {
      const flagged = suspiciousByOfferId.get(s.offer_id);
      const suspicious = flagged && flagged.suspicious;
      return '<div class="__mpad_sale_row' + (suspicious ? ' suspicious' : '') + '">' +
        '<span class="__mpad_sale_num">#' + (d.sales.length - i) + '</span>' +
        '<span class="__mpad_sale_price">' + s.price.toLocaleString() + ' ' + esc(_dtCurrencyLabel(s.currency)) + (suspicious ? ' <span class="__mpad_badge">verdacht</span>' : '') + '</span>' +
        '<span class="__mpad_sale_time">' + esc(_dtFullTime(s.sold_at)) + '</span>' +
        '</div>';
    }).join('') : '<div class="__mpad_loading">Nog geen sales geregistreerd.</div>';

    _detailPanelEl.querySelector('#__mpad_body').innerHTML =
      '<div class="__mpad_wintog_row">' + toggleHtml + '</div>' +
      _dtRenderStatsHtml(d.item, stats, d.changePct, d.liveOffer) +
      '<div id="__mpad_chart"></div>' +
      '<div class="__mpa_section_lbl" style="margin-top:2px">Sales (' + d.sales.length + ')</div>' +
      '<div class="__mpad_sales_list">' + salesHtml + '</div>';

    _dtRenderChart(_detailPanelEl.querySelector('#__mpad_chart'), points);
  }

  function _dtRenderStatsHtml(item, stats, changePct, liveOffer) {
    function fmtAvg(v) { return v == null ? '—' : Math.round(v).toLocaleString() + ' BC'; }
    const value = item && item.value != null ? item.value.toLocaleString() + (item.value_currency ? ' ' + esc(_dtCurrencyLabel(item.value_currency)) : '') : '—';
    const changeTxt = changePct == null ? '—' : (changePct > 0 ? '+' : '') + changePct.toFixed(1) + '%';
    const changeColor = changePct > 0 ? '#33c47a' : changePct < 0 ? '#e05a5a' : '#eceefb';
    const customTile = item && item.custom_value != null
      ? '<div class="__mpad_stat"><div class="__mpad_stat_lbl">Alt. waarde</div><div class="__mpad_stat_val">' + item.custom_value.toLocaleString() + ' ' + esc(_dtCurrencyLabel(item.custom_value_currency)) + '</div></div>'
      : '';
    const liveIsLtd = liveOffer && _isLtdName(liveOffer.item_name || (item && item.name));
    const liveTile = liveOffer
      ? '<div class="__mpad_stat"><div class="__mpad_stat_lbl">Live aanbod</div><div class="__mpad_stat_val">' + liveOffer.price.toLocaleString() + ' BC' + (liveOffer.count > 1 ? ' &middot; ' + (liveIsLtd ? '#' + liveOffer.count : 'x' + liveOffer.count) : '') + '</div></div>'
      : '';
    return '<div class="__mpad_stats">' +
      '<div class="__mpad_stat"><div class="__mpad_stat_lbl">Waarde</div><div class="__mpad_stat_val">' + value + '</div></div>' +
      customTile +
      liveTile +
      '<div class="__mpad_stat"><div class="__mpad_stat_lbl">Laatste wijziging</div><div class="__mpad_stat_val" style="color:' + changeColor + '">' + changeTxt + '</div></div>' +
      '<div class="__mpad_stat"><div class="__mpad_stat_lbl">Aantal sales</div><div class="__mpad_stat_val">' + stats.count + '</div></div>' +
      '<div class="__mpad_stat"><div class="__mpad_stat_lbl">Gem. prijs</div><div class="__mpad_stat_val">' + fmtAvg(stats.rawAvg) + '</div></div>' +
      '<div class="__mpad_stat"><div class="__mpad_stat_lbl">Gefilterd gem.</div><div class="__mpad_stat_val">' + fmtAvg(stats.cleanAvg) + '</div></div>' +
      '</div>';
  }

  // Small inline SVG line chart — no hover tooltip (the site's has one; this is the compact
  // in-game version), just the shape of the price history so a glance tells you if it's
  // trending up or down.
  function _dtRenderChart(container, points) {
    if (!container) return;
    if (points.length < 2) {
      container.innerHTML = '<div class="__mpad_loading">Nog niet genoeg data voor een grafiek.</div>';
      return;
    }
    const W = 280, H = 120, PAD_L = 34, PAD_R = 8, PAD_T = 8, PAD_B = 8;
    const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
    const times = points.map(function(p) { return new Date(p.sold_at).getTime(); });
    const prices = points.map(function(p) { return p.price; });
    const minT = Math.min.apply(null, times), maxT = Math.max.apply(null, times);
    const minP = Math.min.apply(null, prices), maxP = Math.max.apply(null, prices);
    const pRange = maxP - minP || 1, tRange = maxT - minT || 1;
    function x(t) { return PAD_L + ((t - minT) / tRange) * plotW; }
    function y(p) { return PAD_T + plotH - ((p - minP) / pRange) * plotH; }
    const pathD = points.map(function(p, i) { return (i === 0 ? 'M' : 'L') + x(times[i]).toFixed(1) + ' ' + y(prices[i]).toFixed(1); }).join(' ');
    const gridLines = [];
    for (let i = 0; i <= 2; i++) {
      const gp = minP + (pRange * i / 2);
      const gy = y(gp);
      gridLines.push('<line x1="' + PAD_L + '" y1="' + gy.toFixed(1) + '" x2="' + (W - PAD_R) + '" y2="' + gy.toFixed(1) + '" stroke="#23252f" stroke-width="1"/>');
      gridLines.push('<text x="' + (PAD_L - 5) + '" y="' + (gy + 3).toFixed(1) + '" text-anchor="end" font-size="8" fill="#5c5e6b">' + Math.round(gp).toLocaleString() + '</text>');
    }
    const dots = points.map(function(p, i) { return '<circle cx="' + x(times[i]).toFixed(1) + '" cy="' + y(prices[i]).toFixed(1) + '" r="2" fill="#6C7CFF"/>'; }).join('');
    container.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block">' +
      gridLines.join('') +
      '<path d="' + pathD + '" fill="none" stroke="#6C7CFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      dots +
      '</svg>';
  }

  // Fire-and-forget batch upsert (on_conflict=offer_id) — never rejects hard enough to
  // block the alert/log flow above it, worst case one sync tick's data is just lost.
  let _lastDbSync = 0;
  async function _syncOffersToDb(offers) {
    const now = Date.now();
    if (now - _lastDbSync < DB_SYNC_MS) return;
    _lastDbSync = now;
    if (!offers.length) return;
    const nowIso = new Date(now).toISOString();
    // Postgres rejects ON CONFLICT DO UPDATE hitting the same row twice within one
    // statement ("cannot affect row a second time") — and offerId duplicates do show up
    // in real captures (confirmed live: every poll while this was unguarded 500'd). A
    // Map keyed by offerId keeps just the last occurrence per id, same net effect as the
    // upsert would've had anyway.
    const byId = new Map();
    offers.forEach(function(o) {
      const info = _furniInfo(o.classId);
      byId.set(o.offerId, {
        offer_id: o.offerId,
        item_name: info ? info.name : ('Item #' + o.classId),
        class_id: o.classId,
        icon_url: info && info.classname ? _furniImageUrl(info.classname) : null,
        price: o.price,
        avg_price: o.avgPrice != null ? o.avgPrice : null,
        count: o.count || 1,
        last_seen: nowIso,
      });
    });
    const rows = Array.from(byId.values());

    // offer_id is a finite, recycled id space — the game will eventually hand the exact same
    // id to a totally unrelated future listing once the old one's gone. A plain upsert leaves
    // first_seen untouched on conflict, so a recycled id would silently inherit whatever
    // first_seen its previous, unrelated listing had (confirmed as the cause of a lingering
    // false "new offer" bug: an old id's stale, decades-old-looking first_seen made a
    // genuinely fresh listing look old, and vice versa). Fetching item_name+first_seen for
    // the ids in this batch first lets us tell "same listing still going" (item_name
    // unchanged — keep its original first_seen) apart from "id got recycled to something
    // else" (item_name changed, or id never seen before — reset first_seen to now).
    let firstSeenById = new Map();
    try {
      const ids = rows.map(function(r) { return r.offer_id; });
      const existing = await fetch(DB_URL + '/mp_live_offers?select=offer_id,item_name,first_seen&offer_id=in.(' + ids.join(',') + ')', { headers: DB_HEADERS }).then(function(r) { return r.json(); });
      existing.forEach(function(e) { firstSeenById.set(e.offer_id, { item_name: e.item_name, first_seen: e.first_seen }); });
    } catch (e) { /* fall through — every row just resets to now below, no worse than before */ }
    rows.forEach(function(r) {
      const prior = firstSeenById.get(r.offer_id);
      r.first_seen = (prior && prior.item_name === r.item_name) ? prior.first_seen : nowIso;
    });

    fetch(DB_URL + '/mp_live_offers?on_conflict=offer_id', {
      method: 'POST',
      headers: Object.assign({}, DB_HEADERS, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(rows),
    }).catch(function() {});
    // TTL prune — anything not refreshed by the last few sync ticks has fallen out of the
    // live list and should stop showing as "for sale". A pruned offer_id disappearing does
    // NOT necessarily mean it sold or got cancelled — a stack changing size (e.g. 3->2)
    // reassigns a brand new offer_id to the SAME still-live listing (see the shrink/growth
    // notes elsewhere in this file), which prunes the OLD offer_id here even though the item
    // never actually left the marketplace. Deciding "cancelled" right here, at prune time, by
    // checking only THIS offer_id against mp_sales was wrong for exactly that case — the sale
    // eventually happens under the NEW offer_id, and the old one gets wrongly logged as
    // cancelled. A row not immediately found in mp_sales gets parked in mp_offer_watch
    // instead of judged outright; ruilwaarde-proxy-scan/server.js sweeps that table once each
    // watched row's full 48h marketplace lifetime (from its real first_seen, which already
    // survives offer_id reassignment) has elapsed, matching on item+price rather than the
    // stale offer_id — genuinely never sold by then is the only thing that still counts as
    // cancelled.
    const cutoffIso = new Date(now - OFFER_TTL_MS).toISOString();
    fetch(DB_URL + '/mp_live_offers?select=offer_id,item_name,icon_url,price,count,first_seen&last_seen=lt.' + encodeURIComponent(cutoffIso), { headers: DB_HEADERS })
      .then(function(r) { return r.json(); })
      .then(function(stale) {
        if (!stale.length) return;
        const ids = stale.map(function(r) { return r.offer_id; });
        return fetch(DB_URL + '/mp_sales?select=offer_id&offer_id=in.(' + ids.join(',') + ')', { headers: DB_HEADERS })
          .then(function(r) { return r.json(); })
          .then(function(sold) {
            const soldIds = new Set(sold.map(function(r) { return r.offer_id; }));
            const unresolved = stale.filter(function(r) { return !soldIds.has(r.offer_id); });
            if (!unresolved.length) return;
            return fetch(DB_URL + '/mp_offer_watch?on_conflict=offer_id', {
              method: 'POST',
              headers: Object.assign({}, DB_HEADERS, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
              body: JSON.stringify(unresolved),
            });
          });
      })
      .catch(function() {})
      .then(function() {
        fetch(DB_URL + '/mp_live_offers?last_seen=lt.' + encodeURIComponent(cutoffIso), {
          method: 'DELETE',
          headers: Object.assign({}, DB_HEADERS, { Prefer: 'return=minimal' }),
        }).catch(function() {});
      });
  }

  // Sales average per item — same "custom_value counts too, only if it's in Belcredits"
  // algorithm as the site (marktplaats-site/app.js's loadDiscountAvgPrices — mp_sales is
  // always BC, a Diamonds/Credits custom_value can't just be summed in with them). Cached
  // and refreshed on its own timer rather than per-poll, since it needs two full-table
  // fetches (mp_sales + mp_items).
  let _offerAvgPrices = new Map();
  async function _refreshOfferAvgPrices() {
    try {
      const salesRows = await fetch(DB_URL + '/mp_sales?select=item_name,price&limit=50000', { headers: DB_HEADERS }).then(function(r) { return r.json(); });
      const sums = new Map();
      salesRows.forEach(function(r) {
        const cur = sums.get(r.item_name) || { sum: 0, count: 0 };
        cur.sum += r.price; cur.count++;
        sums.set(r.item_name, cur);
      });
      const itemRows = await fetch(DB_URL + '/mp_items?select=name,custom_value,custom_value_currency', { headers: DB_HEADERS }).then(function(r) { return r.json(); });
      itemRows.forEach(function(it) {
        if (!(it.custom_value > 0) || it.custom_value_currency !== 'belcredits') return;
        const cur = sums.get(it.name) || { sum: 0, count: 0 };
        cur.sum += it.custom_value; cur.count++;
        sums.set(it.name, cur);
      });
      const avgs = new Map();
      sums.forEach(function(v, k) { avgs.set(k, v.sum / v.count); });
      _offerAvgPrices = avgs;
    } catch (e) { /* keep whatever was last loaded */ }
  }
  function _discountPctForServer(itemName, price) {
    const avg = _offerAvgPrices.get(itemName);
    if (!avg || avg <= 0) return null;
    return ((avg - price) / avg) * 100;
  }

  // Polls mp_live_offers directly — catches offers logged by anyone/anything (this
  // session's own poll, another player's tab, or the VM's proxy-scan, which runs every 2h
  // with no browser open at all), not just what this browser itself saw via the packet
  // stream. First poll after each toggle-on just establishes a baseline (no alerts) so
  // turning this on doesn't immediately dump every currently-live offer as "new".
  let _serverBaselineDone = false;
  // offer_id turned out not to be a reliable "is this really new" signal on its own — the
  // game reassigns it not just when a stack shrinks, but seemingly whenever the set of live
  // offers for that item changes at all (confirmed live: adding a second listing at a
  // different price could make the FIRST, unrelated listing re-alert too, with its own
  // unchanged price; and delisting+relisting one of two listings could show the OTHER
  // listing's price instead of the relisted one's). Tracking identity by item+price (and, for
  // LTD, by edition number) instead of offer_id sidesteps all of that.
  //
  // Non-LTD: item_name -> Map(price -> total count currently live at that price), rebuilt
  // wholly from scratch every poll (never merged with the previous one). A price bucket whose
  // live count grew since the last poll (including growing from "didn't exist last poll", i.e.
  // 0) is a real new listing and alerts; one that stayed the same or shrank is just a stack
  // continuing (or partially sold) and doesn't. Because the map is rebuilt from scratch each
  // poll, a price bucket that goes fully quiet for even one poll (item taken off market) falls
  // out of it entirely — so a later relist, even at the exact same price, has no prior count to
  // compare against and always alerts.
  //
  // LTD: "count" is each copy's own edition/serial number, not a stack size, so price-bucketed
  // count comparison doesn't apply — instead track which edition numbers are currently live per
  // item_name, and alert on any edition that wasn't live last poll.
  let _liveNonLtdShape = new Map(); // item_name -> Map(price -> count)
  let _liveLtdEditions = new Map(); // item_name -> Set(edition)
  async function _pollServerOffers() {
    if (!_serverAlertsOn) return;
    try {
      const rows = await fetch(DB_URL + '/mp_live_offers?select=offer_id,item_name,icon_url,price,count,first_seen&order=offer_id.desc&limit=500', { headers: DB_HEADERS }).then(function(r) { return r.json(); });

      const nextNonLtdShape = new Map();
      const nextLtdEditions = new Map();
      const toAlert = [];

      rows.forEach(function(r) {
        if (_isLtdName(r.item_name)) {
          let editions = nextLtdEditions.get(r.item_name);
          if (!editions) { editions = new Set(); nextLtdEditions.set(r.item_name, editions); }
          editions.add(r.count);
          if (_serverBaselineDone) {
            const prevEditions = _liveLtdEditions.get(r.item_name);
            if (!prevEditions || !prevEditions.has(r.count)) toAlert.push(r);
          }
        } else {
          let priceMap = nextNonLtdShape.get(r.item_name);
          if (!priceMap) { priceMap = new Map(); nextNonLtdShape.set(r.item_name, priceMap); }
          // MAX, not sum — a stack that's mid-reassignment (shrinking, new offer_id already
          // inserted while the old one hasn't been pruned yet) briefly shows up as TWO rows at
          // the exact same item+price for one poll or so. Summing them double-counted that
          // overlap (e.g. old=3 + new=2 = "5", read as growth from a previously-known 3).
          // MAX collapses the transient overlap back down to the real current size either way.
          priceMap.set(r.price, Math.max(priceMap.get(r.price) || 0, r.count));
        }
      });

      if (_serverBaselineDone) {
        nextNonLtdShape.forEach(function(priceMap, itemName) {
          const prevPriceMap = _liveNonLtdShape.get(itemName);
          priceMap.forEach(function(count, price) {
            const prevCount = prevPriceMap ? (prevPriceMap.get(price) || 0) : 0;
            if (count <= prevCount) return;
            const row = rows.find(function(r) { return r.item_name === itemName && r.price === price; });
            if (row) toAlert.push(row);
          });
        });
      }

      _serverBaselineDone = true;
      _liveNonLtdShape = nextNonLtdShape;
      _liveLtdEditions = nextLtdEditions;

      // Belt-and-suspenders on top of the shape-diff above: a genuinely new listing gets
      // inserted with first_seen = now (48h lifetime ahead of it), so only fire the
      // notification for a row still under a minute old — anything older got its "new"-looking
      // offer_id from some other reassignment quirk, not an actual fresh listing, and
      // shouldn't notify either way.
      const FRESH_MS = 60 * 1000;
      toAlert.forEach(function(r) {
        if (!r.first_seen || Date.now() - new Date(r.first_seen).getTime() > FRESH_MS) return;
        const pct = _discountPctForServer(r.item_name, r.price);
        if (_serverMinDiscount > 0 && (pct == null || pct < _serverMinDiscount)) return;
        _showServerAlert(r, pct);
      });

      if (_serverStatusEl) _serverStatusEl.textContent = rows.length.toLocaleString() + ' actieve aanbiedingen bekend';
    } catch (e) {
      if (_serverStatusEl) _serverStatusEl.textContent = 'Fout bij ophalen';
    }
  }

  const SERVER_POLL_MS = 1000;
  const SERVER_AVG_REFRESH_MS = 3 * 60 * 1000;
  function _startServerPolling() {
    if (_serverPollTimer) return;
    _serverBaselineDone = false; // fresh baseline every time this turns on, not just once ever
    _refreshOfferAvgPrices();
    _pollServerOffers();
    _serverPollTimer = setInterval(_pollServerOffers, SERVER_POLL_MS);
    _serverAvgRefreshTimer = setInterval(_refreshOfferAvgPrices, SERVER_AVG_REFRESH_MS);
  }
  function _stopServerPolling() {
    if (_serverPollTimer) { clearInterval(_serverPollTimer); _serverPollTimer = null; }
    if (_serverAvgRefreshTimer) { clearInterval(_serverAvgRefreshTimer); _serverAvgRefreshTimer = null; }
    if (_serverStatusEl) _serverStatusEl.textContent = 'Off.';
  }

  // Once the byte reader misreads one record's field width, every record after it in the
  // same packet shifts too — cascades into garbage classIds (confirmed live: negative
  // values like -529596416, impossible for a real furni class) and, downstream of that,
  // wrong prices on records whose classId still happened to resolve (e.g. a real item
  // showing 0 BC instead of its actual price). No amount of local reasoning fixes the
  // underlying byte layout without a fresh real capture, so this just drops anything that
  // clearly can't be real instead of storing/showing it.
  function _isValidOffer(o) {
    if (!_furniInfo(o.classId)) return false; // unresolvable classId — not a real furni class
    if (!(o.price > 0)) return false; // real listings always cost something
    return true;
  }

  window.onPacket('MarketPlaceOffers', function(p) {
    if (!p.parsed || !p.parsed.offers) return;
    const offers = p.parsed.offers.filter(_isValidOffer);
    // The native Marktplaats screen fires its own GetMarketplaceOffers requests while you
    // browse/switch tabs in it (including a filtered search/price-range one) — this
    // listener sees those too, not just our own poll's, and a filtered response must never
    // be synced to the DB as if it were the full marketplace state (see _isMarktplaatsShopOpen).
    const paused = _isMarktplaatsShopOpen();
    if (_liveScanOn && !paused) _syncOffersToDb(offers);
  });

  // Pause while the player has the native Marktplaats shop screen open ("Mijn
  // advertenties" of "Aanbod") — not just to avoid spamming redundant requests, but
  // because the native UI's own search/filter (price range, "Zoek Meubi...") also fires
  // GetMarketplaceOffers, and that response is indistinguishable from our own poll's once
  // parsed — a filtered "1 result for 'paarse'" packet synced to the DB as if it were the
  // full marketplace state, then TTL-pruned everything else that didn't get refreshed
  // (confirmed live: searching "paarse" wiped the Offers tab down to that one item).
  // Text-matching a title element used to do this but had drifted out of sync with the
  // current UI; .nitro-catalog-layout-marketplace-grid is the one already confirmed
  // reliable elsewhere (marktplaats-notes.js keys off it for own-offer rows) — it only
  // has children while a marketplace grid (either tab) is actually rendered.
  function _isMarktplaatsShopOpen() {
    // The top-level "Marktplaats" category button (in the Zeldzaams catalog nav) gets an
    // "active" class as soon as you're anywhere inside that section — including its "Hoe
    // werkt de Leet Marktplaats?" intro screen, which shows first and has neither a grid nor
    // the "Mijn advertenties" copy the checks below key off (confirmed live: that intro
    // screen slipped through both). This is the earliest and simplest signal — true the
    // moment the section opens, regardless of which sub-screen ends up showing — so check it
    // first and treat the rest as fallback for older markup that might not tag it this way.
    const navItems = document.querySelectorAll('.layout-grid-item.active');
    for (let i = 0; i < navItems.length; i++) {
      if (navItems[i].textContent && navItems[i].textContent.indexOf('Marktplaats') !== -1) return true;
    }
    if (document.querySelectorAll('.nitro-catalog-layout-marketplace-grid .layout-grid-item').length > 0) return true;
    // "Mijn advertenties" renders its grid empty (no .layout-grid-item at all) when you've
    // got nothing sold yet — the check above misses that state entirely, so it never paused
    // while that screen was open with zero results (confirmed live). It always shows its own
    // fixed intro copy instead, though, regardless of item count — Nitro doesn't expose a
    // dedicated class for that text, only generic Bootstrap utility classes shared all over
    // the rest of the UI, so this matches on the copy itself rather than a selector.
    const hints = document.querySelectorAll('.bg-muted');
    for (let i = 0; i < hints.length; i++) {
      if (hints[i].textContent && hints[i].textContent.indexOf('aangeboden Meubi verkocht') !== -1) return true;
    }
    return false;
  }

  // See the notification bubble's click handler — flips the "Marktplaats scanner" toggle
  // itself off right before opening the native shop (a harder guarantee than waiting on
  // _isMarktplaatsShopOpen's own DOM-based pause to kick in a beat later). This is what turns
  // it back on again once that shop screen actually closes, so a bubble click never leaves
  // scanning off for good — only ever runs while _liveScanAutoDisabled is actually set, i.e.
  // only after a click did the disabling, never interferes with the toggle if the user turned
  // it off themselves.
  let _liveScanAutoDisabled = false;
  let _liveScanAutoReenableTimer = null;
  function _armLiveScanAutoReenable() {
    if (_liveScanAutoReenableTimer) return;
    _liveScanAutoReenableTimer = setInterval(function() {
      if (_isMarktplaatsShopOpen()) return;
      clearInterval(_liveScanAutoReenableTimer);
      _liveScanAutoReenableTimer = null;
      _liveScanAutoDisabled = false;
      window.__mplivescan_setEnabled(true);
    }, 1000);
  }

  function _poll() {
    if (!_liveScanOn) return;
    if (_isMarktplaatsShopOpen()) return;
    const id = _outId('GetMarketplaceOffers');
    if (id === null) return;
    window.sendPacket('OUT', id, '{i:-1}{i:-1}{i:0}{u:7}');
  }

  function _updatePollingState() {
    if (_liveScanOn) _startPolling(); else _stopPolling();
  }
  function _startPolling() {
    if (_pollTimer) return;
    _poll();
    _pollTimer = setInterval(_poll, POLL_MS);
  }
  function _stopPolling() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
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
      '.__mpa_section_lbl{font-size:10px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#5c5e6b;margin:2px 0 -2px}',
      '.__mpa_row{display:flex;align-items:center;justify-content:space-between;background:#1c1e2a;border:1px solid #23252f;border-radius:8px;padding:8px 10px}',
      '.__mpa_lbl{font-size:11px;font-weight:700;color:#eceefb}',
      '.__mpa_desc{font-size:9.5px;color:#5c5e6b;margin-top:2px}',
      '.__mpa_tog_wrap{position:relative;display:inline-block;width:34px;height:18px;flex-shrink:0;cursor:pointer}',
      '.__mpa_tog_inp{opacity:0;width:0;height:0;position:absolute}',
      '.__mpa_tog_track{position:absolute;inset:0;background:#23252f;border-radius:9px;transition:background .2s}',
      '.__mpa_tog_thumb{position:absolute;top:2px;left:2px;width:14px;height:14px;background:#eceefb;border-radius:50%;transition:transform .2s;box-shadow:0 1px 3px rgba(0,0,0,0.35)}',
      '#__mpsrv_status{font-size:10.5px;color:#82849a}',
      '.__mpa_input{font-size:11px;font-family:inherit;padding:5px 7px;border:1px solid #23252f;border-radius:6px;background:#0A0B10;color:#eceefb;outline:none;width:100%}',
      '.__mpa_input:focus{border-color:#6C7CFF}',
      '.__mpa_open_btn{width:100%;padding:7px 10px;border:1px solid rgba(166,176,255,0.24);border-radius:8px;background:rgba(108,124,255,0.12);color:#A6B0FF;font:600 11px system-ui;cursor:pointer;text-align:center}',
      '.__mpa_open_btn:hover{background:rgba(108,124,255,0.2)}',
      '.__mpa_bubble_wrap{width:200px}',
      '.nitro-notification-bubble.__mpa_bubble{background-color:rgba(46,46,44,0.92);box-shadow:0 4px 14px rgba(0,0,0,.4);color:#fff;width:200px!important;min-height:76px!important;box-sizing:border-box;padding:8px 10px!important;border-radius:10px!important;overflow:hidden}',
      '.__mpa_bubble .bubble-image-container{width:44px;height:44px;flex-shrink:0}',
      '.__mpa_bubble .bubble-image{background-size:contain!important;background-repeat:no-repeat!important;background-position:center!important;width:44px!important;height:44px!important;image-rendering:pixelated}',
      '.__mpa_bubble .notification-bubble-text{font-size:9px!important;line-height:1.35;min-width:0;overflow:hidden}',
      '.__mpa_bubble .__mpa_name{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:normal}',
      '.__mpa_bubble .__mpa_chip{display:inline-flex;flex-direction:column;margin-top:3px;padding:2px 6px;border-radius:8px;font-weight:800;max-width:fit-content}',
      '.__mpa_bubble .__mpa_chip_price{font-size:9px;line-height:1.3}',
      '.__mpa_bubble .__mpa_chip_pct{font-size:9px;line-height:1.3}',

      '#__mpa_detail_panel{position:fixed;z-index:1000;width:300px;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__mpa_detail_panel *{box-sizing:border-box}',
      '#__mpad_body{padding:12px;display:flex;flex-direction:column;gap:8px;max-height:calc(100vh - 80px);overflow-y:auto}',
      '.__mpad_loading{font-size:11px;color:#5c5e6b;padding:8px 0}',
      '.__mpad_wintog_row{display:flex;gap:4px}',
      '.__mpad_wintog{flex:1;padding:5px 4px;border:1px solid #23252f;border-radius:6px;background:#1c1e2a;color:#82849a;font:600 10px inherit;cursor:pointer}',
      '.__mpad_wintog.active{background:#6C7CFF;border-color:#6C7CFF;color:#0A0B10}',
      '.__mpad_stats{display:grid;grid-template-columns:1fr 1fr;gap:6px}',
      '.__mpad_stat{background:#1c1e2a;border:1px solid #23252f;border-radius:8px;padding:6px 8px}',
      '.__mpad_stat_lbl{font-size:9px;font-weight:800;letter-spacing:.3px;text-transform:uppercase;color:#5c5e6b}',
      '.__mpad_stat_val{font-size:13px;font-weight:800;color:#eceefb;margin-top:1px}',
      '.__mpad_sales_list{display:flex;flex-direction:column;gap:1px;max-height:200px;overflow-y:auto}',
      '.__mpad_sale_row{display:flex;align-items:center;gap:6px;padding:4px 2px;border-bottom:1px solid #1c1e2a;font-size:10px}',
      '.__mpad_sale_row.suspicious{opacity:.55}',
      '.__mpad_sale_num{color:#5c5e6b;font-family:monospace;width:26px;flex-shrink:0}',
      '.__mpad_sale_price{flex:1;color:#eceefb;font-weight:700}',
      '.__mpad_sale_time{color:#5c5e6b;font-size:9px;flex-shrink:0}',
      '.__mpad_badge{background:#e05a5a;color:#fff;font-size:8px;font-weight:800;padding:1px 4px;border-radius:4px;margin-left:3px}',
    ].join('');
    document.head.appendChild(style);

    const p = document.createElement('div');
    p.id = '__mpa_panel';
    p.innerHTML =
      '<div class="__mpa_card_wrap">' +
        '<div class="__mpa_hdr" id="__mpa_hdr">' +
          '<span class="__mpa_title">Marktplaats</span>' +
          '<span class="__mpa_close" id="__mpa_close">&times;</span>' +
        '</div>' +
        '<div id="__mpa_body">' +
          '<div class="__mpa_section_lbl">Scanner</div>' +
          '<div class="__mpa_row">' +
            '<div class="__mpa_lbl">Marktplaats scanner</div>' +
            '<label class="__mpa_tog_wrap"><input type="checkbox" class="__mpa_tog_inp" id="__mpls_tog_inp"><span class="__mpa_tog_track" id="__mpls_tog_track"></span><span class="__mpa_tog_thumb" id="__mpls_tog_thumb"></span></label>' +
          '</div>' +

          '<div class="__mpa_section_lbl">Alerts</div>' +
          '<div class="__mpa_row" style="flex-direction:column;align-items:stretch;gap:8px">' +
            '<div style="display:flex;align-items:center;justify-content:space-between">' +
              '<div class="__mpa_lbl">Marktplaats alerts</div>' +
              '<label class="__mpa_tog_wrap"><input type="checkbox" class="__mpa_tog_inp" id="__mpsrv_tog_inp"><span class="__mpa_tog_track" id="__mpsrv_tog_track"></span><span class="__mpa_tog_thumb" id="__mpsrv_tog_thumb"></span></label>' +
            '</div>' +
            '<select id="__mpsrv_min_discount" class="__mpa_input">' +
              '<option value="0">Meld bij: elk nieuw aanbod</option>' +
              '<option value="20">Meld bij: 20%+ korting</option>' +
              '<option value="30">Meld bij: 30%+ korting</option>' +
              '<option value="40">Meld bij: 40%+ korting</option>' +
              '<option value="50">Meld bij: 50%+ korting</option>' +
              '<option value="custom">Meld bij: custom %...</option>' +
            '</select>' +
            '<div style="display:flex;align-items:center;justify-content:space-between">' +
              '<span class="__mpa_lbl" style="font-size:10px;font-weight:600">Item details bij klik</span>' +
              '<label class="__mpa_tog_wrap"><input type="checkbox" class="__mpa_tog_inp" id="__mpsrv_detail_tog_inp"><span class="__mpa_tog_track" id="__mpsrv_detail_tog_track"></span><span class="__mpa_tog_thumb" id="__mpsrv_detail_tog_thumb"></span></label>' +
            '</div>' +
          '</div>' +
          '<div class="__mpa_row" id="__mpsrv_custom_row" style="display:none">' +
            '<span class="__mpa_lbl" style="font-size:10px;font-weight:600">Minimaal:</span>' +
            '<input id="__mpsrv_custom_pct" type="number" min="0" max="100" class="__mpa_input" style="width:70px" value="25">' +
            '<span class="__mpa_lbl" style="font-size:10px">%</span>' +
          '</div>' +
          '<div id="__mpsrv_status">Off.</div>' +

          '<button id="__mpa_open_site" class="__mpa_open_btn">Open site</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(p);
    p.style.display = 'none';

    window.__ghk_makeDraggable(p, p.querySelector('#__mpa_hdr'), '__ghk_mpa_pos', e => e.target.id === '__mpa_close');
    p.querySelector('#__mpa_close').addEventListener('click', () => p.style.display = 'none');
    p.querySelector('#__mpa_open_site').addEventListener('click', () => window.open('https://marktplaats.databin.uk/', '_blank'));

    _liveScanTogInp = p.querySelector('#__mpls_tog_inp');
    _liveScanTogTrack = p.querySelector('#__mpls_tog_track');
    _liveScanTogThumb = p.querySelector('#__mpls_tog_thumb');
    _liveScanTogInp.checked = _liveScanOn;
    _setLiveScanToggleUI(_liveScanOn);
    _liveScanTogInp.addEventListener('change', function() {
      window.__mplivescan_setEnabled(this.checked);
    });

    _updatePollingState(); // covers Marktplaats scanner having loaded on from localStorage

    _serverStatusEl = p.querySelector('#__mpsrv_status');
    _serverTogInp = p.querySelector('#__mpsrv_tog_inp');
    _serverTogTrack = p.querySelector('#__mpsrv_tog_track');
    _serverTogThumb = p.querySelector('#__mpsrv_tog_thumb');
    _serverMinDiscountEl = p.querySelector('#__mpsrv_min_discount');
    _serverCustomRowEl = p.querySelector('#__mpsrv_custom_row');
    _serverCustomPctEl = p.querySelector('#__mpsrv_custom_pct');

    // Reflect the loaded minDiscount into the select: one of the presets, or "custom" with
    // the number field pre-filled to whatever value it actually is.
    const presetValues = ['0', '20', '30', '40', '50'];
    const minDiscountStr = String(_serverMinDiscount);
    if (presetValues.includes(minDiscountStr)) {
      _serverMinDiscountEl.value = minDiscountStr;
    } else {
      _serverMinDiscountEl.value = 'custom';
      _serverCustomPctEl.value = _serverMinDiscount;
      _serverCustomRowEl.style.display = '';
    }
    _serverTogInp.checked = _serverAlertsOn;
    _setServerAlertsToggleUI(_serverAlertsOn);
    if (_serverAlertsOn) _startServerPolling();
    _serverTogInp.addEventListener('change', function() {
      window.__mpsrv_setEnabled(this.checked);
    });
    _serverMinDiscountEl.addEventListener('change', function() {
      if (this.value === 'custom') {
        _serverCustomRowEl.style.display = '';
        _serverMinDiscount = Math.max(0, Math.min(100, parseInt(_serverCustomPctEl.value, 10) || 0));
      } else {
        _serverCustomRowEl.style.display = 'none';
        _serverMinDiscount = parseInt(this.value, 10) || 0;
      }
      _saveServerAlerts();
    });
    _serverCustomPctEl.addEventListener('input', function() {
      _serverMinDiscount = Math.max(0, Math.min(100, parseInt(this.value, 10) || 0));
      _saveServerAlerts();
    });

    _serverDetailTogInp = p.querySelector('#__mpsrv_detail_tog_inp');
    _serverDetailTogTrack = p.querySelector('#__mpsrv_detail_tog_track');
    _serverDetailTogThumb = p.querySelector('#__mpsrv_detail_tog_thumb');
    _serverDetailTogInp.checked = _serverOpenDetailOnClick;
    _setServerDetailToggleUI(_serverOpenDetailOnClick);
    _serverDetailTogInp.addEventListener('change', function() {
      _serverOpenDetailOnClick = this.checked;
      _setServerDetailToggleUI(_serverOpenDetailOnClick);
      _saveServerAlerts();
    });

  }

  function _setServerDetailToggleUI(on) {
    if (_serverDetailTogTrack) _serverDetailTogTrack.style.background = on ? '#6C7CFF' : '#23252f';
    if (_serverDetailTogThumb) _serverDetailTogThumb.style.transform = on ? 'translateX(16px)' : 'translateX(0)';
  }

  function _setLiveScanToggleUI(on) {
    if (_liveScanTogTrack) _liveScanTogTrack.style.background = on ? '#6C7CFF' : '#23252f';
    if (_liveScanTogThumb) _liveScanTogThumb.style.transform = on ? 'translateX(16px)' : 'translateX(0)';
  }
  function _setServerAlertsToggleUI(on) {
    if (_serverTogTrack) _serverTogTrack.style.background = on ? '#6C7CFF' : '#23252f';
    if (_serverTogThumb) _serverTogThumb.style.transform = on ? 'translateX(16px)' : 'translateX(0)';
    if (!on && _serverStatusEl) _serverStatusEl.textContent = 'Off.';
  }

  window.__mplivescan_setEnabled = function(on) {
    _liveScanOn = !!on;
    _saveLiveScan();
    if (_liveScanTogInp) _liveScanTogInp.checked = _liveScanOn;
    _setLiveScanToggleUI(_liveScanOn);
    _updatePollingState();
  };
  window.__mplivescan_isEnabled = function() { return _liveScanOn; };

  window.__mpsrv_setEnabled = function(on) {
    _serverAlertsOn = !!on;
    _saveServerAlerts();
    if (_serverTogInp) _serverTogInp.checked = _serverAlertsOn;
    _setServerAlertsToggleUI(_serverAlertsOn);
    if (_serverAlertsOn) _startServerPolling(); else _stopServerPolling();
  };
  window.__mpsrv_isEnabled = function() { return _serverAlertsOn; };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      window.__ghk_ready(init);
    });
  } else {
    window.__ghk_ready(init);
  }
})();
