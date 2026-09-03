(function () {
  // Runs standalone on leet.city/ruilwaarde — opened by extensions/fun/marktplaats.js's
  // Scanner toggle (via core/bridge.js -> background.js chrome.tabs.create), one tab per
  // category, tagged with a #ghscan=<slug> hash so this same file knows which category to
  // scan and never touches a tab a user opened manually (no hash = do nothing).
  //
  // Originally this drove the actual UI (click tabs, click Info, click "next page") and
  // scraped the DOM — replaced entirely after finding (via a real Network-tab capture) that
  // the page itself just calls a plain JSON API:
  //   GET /api/value/categories                       -> [{id, name, slug}, ...]
  //   GET /api/value/category/{id}/page/{n}/order/0    -> {rareValues: [...], totalPages}
  // Same-origin fetch() from inside this already-loaded page automatically carries the
  // browser's real cf_clearance cookie (confirmed live), so this passes Cloudflare exactly
  // like the page's own requests do — no clicking, no modal, no pagination-button hunting,
  // and maybe 5-10KB per page instead of ~1MB for a full reload.
  const CATEGORY_IDS = {
    'club-cadeau': 1,
    'ltd': 2,
    'rares': 3,
    'ss': 4,
  };
  const CATEGORY_LABELS = {
    'club-cadeau': 'Club Cadeau',
    'ltd': 'Limited Edition (LTD)',
    'rares': 'Rares',
    'ss': 'Super Zeldzaam (SS)',
  };
  const slug = (location.hash || '').replace('#ghscan=', '');
  const categoryId = CATEGORY_IDS[slug];
  const tabLabel = CATEGORY_LABELS[slug];
  if (!categoryId) return;

  const DB_URL = 'https://marktplaats.databin.uk/rest/v1';
  const DB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6ImdoZWxvby1zZWxmaG9zdCIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwfQ.9uAMhqRJOL-m_xtTO5duAUOAw-4pKk4LEENcT47crXU';
  const DB_HEADERS = {
    apikey: DB_KEY,
    Authorization: 'Bearer ' + DB_KEY,
    'Content-Type': 'application/json',
  };

  // Still gentle, still backs off on trouble — just per PAGE now instead of per item, since
  // one fetch already returns a whole page's worth of items+sales in one shot.
  let _pageDelayMs = 1000;
  let _consecutiveFailures = 0;

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // leet.city's own currency names, lowercased — kept as three distinct values (not
  // collapsed to two) since CREDITS and DIAMONDS are genuinely different currencies, not
  // just a naming inconsistency (confirmed live: both appear on separate real items).
  function normalizeCurrency(c) {
    if (!c) return null;
    return String(c).toLowerCase();
  }

  // "dd-mm-yyyy hh:mm" as returned by the API -> ISO. No timezone marker in the response;
  // interpreted as this machine's local time (fine as long as the scanner runs somewhere in
  // the Netherlands/Belgium, which it does).
  function parseDutchDate(text) {
    const m = /(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})/.exec(text || '');
    if (!m) return null;
    const d = new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Classnames with a color variant use a literal "*" (e.g. "chair_plasto*14") — the CDN
  // has no file with a literal * in the name, only one with it swapped for "_" (confirmed
  // live: both chair_plasto*14 and table_plasto_4leg*14 404 as-is, 200 with * -> _).
  function iconUrlFor(itemName) {
    return 'https://images.leet.city/library/hof_furni/icons/' + encodeURIComponent(String(itemName).replace(/\*/g, '_')) + '_icon.png';
  }

  function updateBadge(msg) {
    let el = document.getElementById('__ghscan_badge');
    if (!el) {
      el = document.createElement('div');
      el.id = '__ghscan_badge';
      el.style.cssText = 'position:fixed;top:10px;right:10px;z-index:999999;background:#111;color:#7CFF8C;font:600 11px/1.4 ui-monospace,monospace;padding:8px 12px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.5);max-width:260px';
      document.body.appendChild(el);
    }
    el.textContent = '[Gheloo Scanner: ' + tabLabel + '] ' + msg;
  }

  async function fetchPage(pageIdx) {
    const res = await fetch('/api/value/category/' + categoryId + '/page/' + pageIdx + '/order/0', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  // Name/icon/currency/customValue are captured once and never touched again — a brand-new
  // item gets a full upsert, everything after that is just a PATCH of value/custom_value
  // (the only fields that actually change scan to scan), so a known item never re-sends its
  // static fields.
  const _knownIcons = new Set();

  async function loadKnownIcons() {
    try {
      const rows = await fetch(DB_URL + '/mp_items?category=eq.' + encodeURIComponent(tabLabel) + '&icon_url=not.is.null&select=name,icon_url', { headers: DB_HEADERS }).then((r) => r.json());
      rows.forEach((r) => { if (r.icon_url && /^https?:/.test(r.icon_url)) _knownIcons.add(r.name); });
    } catch (e) { /* fine to start with an empty set — worst case, one extra full upsert per item */ }
  }

  async function upsertItem(rv) {
    const name = rv.furniture.publicName;
    const now = new Date().toISOString();
    const value = rv.price;
    const valueCurrency = normalizeCurrency(rv.currency);
    const customValue = rv.customPrice > 0 ? rv.customPrice : null;
    const customValueCurrency = customValue != null ? normalizeCurrency(rv.customCurrency) : null;

    if (_knownIcons.has(name)) {
      return fetch(DB_URL + '/mp_items?name=eq.' + encodeURIComponent(name), {
        method: 'PATCH',
        headers: DB_HEADERS,
        body: JSON.stringify({ value, custom_value: customValue, last_scanned_at: now }),
      });
    }
    const res = await fetch(DB_URL + '/mp_items?on_conflict=name', {
      method: 'POST',
      headers: Object.assign({}, DB_HEADERS, { Prefer: 'resolution=merge-duplicates' }),
      body: JSON.stringify({
        name,
        category: tabLabel,
        icon_url: iconUrlFor(rv.furniture.itemName),
        value,
        value_currency: valueCurrency,
        custom_value: customValue,
        custom_value_currency: customValueCurrency,
        last_scanned_at: now,
      }),
    });
    if (res.ok) _knownIcons.add(name);
    return res;
  }

  async function upsertSales(name, offers) {
    if (!offers || !offers.length) return { ok: true };
    const rows = offers.map((o) => ({
      offer_id: o.id,
      item_name: name,
      price: o.price,
      currency: 'belcredits', // marktplaats trades are always Belcredits — confirmed live, same as before
      sold_at: parseDutchDate(o.date),
    })).filter((r) => r.sold_at != null);
    if (!rows.length) return { ok: true };
    return fetch(DB_URL + '/mp_sales?on_conflict=offer_id', {
      method: 'POST',
      headers: Object.assign({}, DB_HEADERS, { Prefer: 'resolution=merge-duplicates' }),
      body: JSON.stringify(rows),
    });
  }

  async function reportProgress(fields) {
    return fetch(DB_URL + '/mp_scan_progress?on_conflict=category', {
      method: 'POST',
      headers: Object.assign({}, DB_HEADERS, { Prefer: 'resolution=merge-duplicates' }),
      body: JSON.stringify(Object.assign({ category: slug, updated_at: new Date().toISOString() }, fields)),
    }).catch(() => {});
  }

  async function scanPage(pageIdx) {
    const data = await fetchPage(pageIdx);
    const items = data.rareValues || [];
    for (let i = 0; i < items.length; i++) {
      const rv = items[i];
      try {
        const r1 = await upsertItem(rv);
        const r2 = await upsertSales(rv.furniture.publicName, rv.marketplaceOffers);
        if ((r1 && !r1.ok) || (r2 && !r2.ok)) _consecutiveFailures++;
        else _consecutiveFailures = 0;
      } catch (e) {
        _consecutiveFailures++;
      }
    }
    return { itemCount: items.length, totalPages: data.totalPages || 1 };
  }

  // Tracks how many reload-triggering failure storms have hit the exact same pageIdx,
  // across reloads — sessionStorage survives location.reload() (cleared on tab close) so
  // this doesn't reset to 0 every time. Without it, a page that's durably broken (not
  // just a transient blip) reloads forever: pageIdx always restarts at 0, hits the same
  // failing page, fails 6x, reloads, repeat — the tab never gets past it (confirmed live:
  // Club Cadeau stuck reloading on page 1, then SS on page 4, both real leet.city-side
  // 520s that didn't clear on their own for several minutes).
  const STUCK_KEY = '__ghscan_stuck_' + slug;
  const MAX_RELOADS_PER_PAGE = 3;

  function loadStuckInfo() {
    try { return JSON.parse(sessionStorage.getItem(STUCK_KEY) || 'null'); } catch (e) { return null; }
  }
  function saveStuckInfo(info) {
    try { sessionStorage.setItem(STUCK_KEY, JSON.stringify(info)); } catch (e) {}
  }
  function clearStuckInfo() {
    try { sessionStorage.removeItem(STUCK_KEY); } catch (e) {}
  }

  async function run() {
    await loadKnownIcons();
    let pageIdx = 0;
    let itemsScanned = 0; // lifetime, this tab session
    let passScanned = 0;  // resets every time the loop wraps back to page 0

    while (true) {
      let result;
      try {
        result = await scanPage(pageIdx);
        _consecutiveFailures = 0;
        clearStuckInfo(); // made progress — whatever stuck point existed before is behind us now
      } catch (e) {
        _consecutiveFailures++;
        updateBadge('fout op pagina ' + (pageIdx + 1) + ': ' + e.message);
        // A handful of back-to-back failures (network hiccup, transient 403, DB blip) is
        // worth a slower retry; a LOT in a row means something's actually broken (auth
        // expired, endpoint changed) and a hard reload is the only thing that's ever fixed
        // that class of problem for this scanner.
        if (_consecutiveFailures >= 6) {
          const stuck = loadStuckInfo();
          if (stuck && stuck.pageIdx === pageIdx && stuck.reloadCount >= MAX_RELOADS_PER_PAGE) {
            // Reloading hasn't helped MAX_RELOADS_PER_PAGE times in a row on this exact
            // page — it's not a session/cookie problem a reload can fix, it's just a
            // durably broken page on leet.city's end. Skip it and keep the rest of the
            // category moving instead of reloading forever.
            updateBadge('pagina ' + (pageIdx + 1) + ' blijft falen na ' + stuck.reloadCount + ' reloads — overgeslagen');
            clearStuckInfo();
            _consecutiveFailures = 0;
            pageIdx++;
            await sleep(_pageDelayMs);
            continue;
          }
          saveStuckInfo({ pageIdx, reloadCount: (stuck && stuck.pageIdx === pageIdx ? stuck.reloadCount : 0) + 1 });
          await reloadForGlitch('herhaalde fouten op pagina ' + (pageIdx + 1));
          return;
        }
        await sleep(Math.min(_pageDelayMs * _consecutiveFailures, 15000));
        continue;
      }

      itemsScanned += result.itemCount;
      passScanned += result.itemCount;
      updateBadge('pagina ' + (pageIdx + 1) + '/' + result.totalPages + ' (' + itemsScanned + ' totaal)');
      reportProgress({
        page: pageIdx + 1,
        total_pages: result.totalPages,
        item_index: result.itemCount,
        items_on_page: result.itemCount,
        pass_scanned: passScanned,
      });

      pageIdx++;
      if (pageIdx >= result.totalPages) {
        pageIdx = 0;
        passScanned = 0;
      }
      await sleep(_pageDelayMs);
    }
  }

  async function reloadForGlitch(reason) {
    updateBadge(reason + ' — pagina herladen...');
    await sleep(500);
    location.reload();
    await sleep(60000); // parked here until the reload actually tears this context down
  }

  run();
})();
