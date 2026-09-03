(function () {
  // Same self-hosted Postgres + PostgREST as every other databin.uk site — same-origin
  // under Caddy on marktplaats.databin.uk (proxied to /rest/v1), so no CORS header needed
  // here. Data is written by extensions/fun/marktplaats-scan-worker.js (one background tab
  // per category, opened by the Marktplaats panel's Scanner toggle in-game).
  const SB_URL = '/rest/v1';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6ImdoZWxvby1zZWxmaG9zdCIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwfQ.9uAMhqRJOL-m_xtTO5duAUOAw-4pKk4LEENcT47crXU';
  const HEADERS = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };

  // Same slug -> tab-label mapping as the scan worker (extensions/fun/marktplaats-scan-worker.js)
  // — mp_items.category and mp_scan_progress.category both use these exact strings/slugs.
  const CATEGORIES = [
    { slug: 'club-cadeau', label: 'Club Cadeau' },
    { slug: 'ltd', label: 'Limited Edition (LTD)' },
    { slug: 'rares', label: 'Rares' },
    { slug: 'ss', label: 'Super Zeldzaam (SS)' },
  ];

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  async function sbGet(path) {
    const res = await fetch(SB_URL + path, { headers: HEADERS });
    if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + (await res.text()));
    return res.json();
  }

  // Prefer: count=exact returns the table's real total in the Content-Range response
  // header (e.g. "0-99/1234") — needed for Sales Feed's first/last/page-jump controls,
  // which have to know the true page count instead of guessing from whether a page came
  // back full.
  async function sbGetWithCount(path) {
    const res = await fetch(SB_URL + path, { headers: Object.assign({}, HEADERS, { Prefer: 'count=exact' }) });
    if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + (await res.text()));
    const range = res.headers.get('content-range') || '';
    const total = parseInt(range.split('/')[1], 10);
    return { rows: await res.json(), total: isNaN(total) ? 0 : total };
  }

  const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500];

  // Shared first/back10/prev/jump/next/fwd10/last + page-size pager — same component as
  // accounts.databin.uk, reused as-is on both Items and Sales Feed (and later Marktplaats
  // Offers) so every list on this site paginates the same way.
  function renderPager(mountId, page, totalPages, total, pageSize, unitLabel) {
    const el = document.getElementById(mountId);
    if (!total) { el.innerHTML = ''; return; }
    const atStart = page <= 0, atEnd = page >= totalPages - 1;
    el.innerHTML =
      '<button class="btn btn-outline" data-pg="back10" title="10 pagina\'s terug"' + (atStart ? ' disabled' : '') + '>&laquo;&laquo;</button>'
      + '<button class="btn btn-outline" data-pg="prev" title="Vorige"' + (atStart ? ' disabled' : '') + '>&laquo;</button>'
      + '<input class="page-jump" data-pg="jump" type="number" min="1" max="' + totalPages + '" value="' + (page + 1) + '">'
      + '<span class="page-info">/ ' + totalPages + ' (' + total.toLocaleString() + ' ' + unitLabel + ')</span>'
      + '<button class="btn btn-outline" data-pg="next" title="Volgende"' + (atEnd ? ' disabled' : '') + '>&raquo;</button>'
      + '<button class="btn btn-outline" data-pg="fwd10" title="10 pagina\'s vooruit"' + (atEnd ? ' disabled' : '') + '>&raquo;&raquo;</button>'
      + '<select class="page-size-select" data-pg="size">' + PAGE_SIZE_OPTIONS.map((n) =>
          '<option value="' + n + '"' + (n === pageSize ? ' selected' : '') + '>' + n + '/pagina</option>'
        ).join('') + '</select>';
  }

  // Wires one pagination element's clicks/jump-input/size-select to page-agnostic
  // callbacks. `getPage`/`setPage` and `getPageSize`/`setPageSize` read/write the caller's
  // own state; `reload` re-renders after any of them change.
  function wirePager(mountId, totalPagesFn, getPage, setPage, getPageSize, setPageSize, reload) {
    const el = document.getElementById(mountId);
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pg]');
      if (!btn) return;
      const totalPages = totalPagesFn();
      const page = getPage();
      if (btn.dataset.pg === 'back10') setPage(Math.max(0, page - 10));
      else if (btn.dataset.pg === 'prev') setPage(Math.max(0, page - 1));
      else if (btn.dataset.pg === 'next') setPage(Math.min(totalPages - 1, page + 1));
      else if (btn.dataset.pg === 'fwd10') setPage(Math.min(totalPages - 1, page + 10));
      else return;
      reload();
    });
    el.addEventListener('change', (e) => {
      if (e.target.dataset.pg !== 'size') return;
      setPageSize(parseInt(e.target.value, 10));
      setPage(0);
      reload();
    });
    function jump(input) {
      const n = parseInt(input.value, 10) - 1;
      if (!isNaN(n)) setPage(Math.min(Math.max(0, n), totalPagesFn() - 1));
      reload();
    }
    el.addEventListener('keydown', (e) => { if (e.target.dataset.pg === 'jump' && e.key === 'Enter') jump(e.target); });
    el.addEventListener('focusout', (e) => { if (e.target.dataset.pg === 'jump') jump(e.target); });
  }

  function relTime(iso) {
    if (!iso) return '—';
    const diff = (Date.now() - new Date(iso)) / 1000;
    if (diff < 5) return 'net';
    if (diff < 60) return Math.floor(diff) + 's geleden';
    if (diff < 3600) return Math.floor(diff / 60) + 'm geleden';
    if (diff < 86400) return Math.floor(diff / 3600) + 'u geleden';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd geleden';
    return new Date(iso).toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function fullTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  // <input type="date"> gives a bare "YYYY-MM-DD" in the viewer's own local calendar day —
  // turned into a real instant at that local day's start/end before ever touching the
  // gte/lte filter, so "tot" genuinely includes every sale/cancellation up to 23:59:59 of
  // that day instead of silently cutting off at local midnight.
  function dateInputToIso(value, endOfDay) {
    if (!value) return null;
    const d = new Date(value + (endOfDay ? 'T23:59:59.999' : 'T00:00:00.000'));
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  // leet.city's own three currencies — belcredits/diamonds/credits are genuinely different
  // and not interchangeable, so every price on this site carries its unit rather than a
  // bare number. Values come from the API lowercased (see marktplaats-scan-worker.js).
  const CURRENCY_LABELS = { belcredits: 'BC', diamonds: 'Diamonds', credits: 'Credits' };
  // For price-based sorting only — items always group by currency first (this fixed order),
  // then by value within each group. Unknown/missing currency sinks to the very end.
  const CURRENCY_RANK = { belcredits: 0, diamonds: 1, credits: 2 };
  function currencyLabel(c) {
    return CURRENCY_LABELS[c] || (c || '');
  }
  function currencyCls(c) {
    return c === 'belcredits' ? 'coins' : c === 'diamonds' ? 'credits' : c === 'credits' ? 'plaincredits' : '';
  }
  // Some items carry a second, alternative price (e.g. 200 Diamonds or 50 BC for the same
  // item) — only the primary value/currency is shown, the alternative is redundant clutter
  // on the badge/row.
  function valueHtml(r) {
    return (r.value == null ? '—' : r.value.toLocaleString()) + (r.value_currency ? ' <span class="item-value-unit">' + esc(currencyLabel(r.value_currency)) + '</span>' : '');
  }

  // ── Row/tile view toggle — shared by Items and Sales Feed, each with its own persisted
  // choice (independent, so picking tile on one doesn't change the other). ────────────
  const VIEW_ICONS = {
    row: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>',
    tile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>',
  };
  function loadViewPref(key, defaultMode) {
    const fallback = defaultMode === 'tile' ? 'tile' : 'row';
    try {
      const saved = localStorage.getItem(key);
      return saved === 'tile' || saved === 'row' ? saved : fallback;
    } catch (e) { return fallback; }
  }
  function saveViewPref(key, mode) {
    try { localStorage.setItem(key, mode); } catch (e) { /* per-viewer convenience only, fine to lose */ }
  }
  function renderViewToggle(mountId, mode) {
    const el = document.getElementById(mountId);
    el.innerHTML = ['row', 'tile'].map((m) =>
      '<button class="view-toggle-btn' + (mode === m ? ' active' : '') + '" data-view="' + m + '" title="' + (m === 'row' ? 'Rij-volgorde' : 'Tegel-volgorde') + '">' + VIEW_ICONS[m] + '</button>'
    ).join('');
  }


  // ── Trade-volume lookup — shared by Items' and Offers' "Meest verhandeld" sort. One
  // request per (range, refresh) rather than per-item, reducing to a name -> count map
  // client-side (PostgREST has no GROUP BY over REST). Cached per range so switching back
  // to a range already loaded this session doesn't re-fetch. ──────────────────────────
  let _tradeCounts = null;
  let _tradeCountsRangeDays = null;
  let _tradeCountsLoading = null; // in-flight promise, so two callers don't double-fetch

  async function loadTradeCounts(rangeDays, force) {
    if (!force && _tradeCounts && _tradeCountsRangeDays === rangeDays) return _tradeCounts;
    if (_tradeCountsLoading && _tradeCountsRangeDays === rangeDays) return _tradeCountsLoading;
    let path = '/mp_sales?select=item_name&limit=50000';
    if (rangeDays > 0) path += '&sold_at=gte.' + encodeURIComponent(new Date(Date.now() - rangeDays * 86400000).toISOString());
    _tradeCountsRangeDays = rangeDays;
    _tradeCountsLoading = sbGet(path).then((rows) => {
      const counts = new Map();
      rows.forEach((r) => counts.set(r.item_name, (counts.get(r.item_name) || 0) + 1));
      _tradeCounts = counts;
      _tradeCountsLoading = null;
      return counts;
    }).catch((e) => { _tradeCountsLoading = null; throw e; });
    return _tradeCountsLoading;
  }
  function tradeCountFor(itemName) {
    return (_tradeCounts && _tradeCounts.get(itemName)) || 0;
  }

  // Most recent sale per item, name -> ISO sold_at — for the Items tab's "Laatst
  // verhandeld" sort. Independent of the trade-volume range picker above (this is always
  // "ever", not range-scoped) so it needs its own fetch/cache. Sorted desc + first-write-
  // wins per name gives the max without a GROUP BY (PostgREST has none over REST).
  let _lastTradedAt = null;
  async function loadLastTradedAt() {
    try {
      const rows = await sbGet('/mp_sales?select=item_name,sold_at&order=sold_at.desc&limit=20000');
      const map = new Map();
      rows.forEach((r) => { if (!map.has(r.item_name)) map.set(r.item_name, r.sold_at); });
      _lastTradedAt = map;
      if (_itemsSort === 'last-traded') renderItems();
    } catch (e) { /* Items tab just falls back to "nooit" for this sort until it succeeds */ }
  }
  function lastTradedAtFor(itemName) {
    return (_lastTradedAt && _lastTradedAt.get(itemName)) || null;
  }

  // Items tab "Grootste prijssprongen eerst" sort — per item, the single biggest
  // percentage swing between two CONSECUTIVE sales (chronological), e.g. an item that sold
  // for 500 then 5000 then 480 has a 900% jump. Not the same thing as the item detail
  // modal's outlier/suspicious flagging (that compares each sale to a running clean
  // average, seeded and built up over the first 20 trusted sales) — this is a much
  // simpler, cheaper "how jumpy does this item's raw price history look at a glance" signal
  // meant purely for sorting the Items list toward the volatile-looking ones, not a
  // suspicious-sale verdict in its own right.
  let _priceVolatility = null;
  async function loadPriceVolatility() {
    try {
      const rows = await sbGet('/mp_sales?select=item_name,price,sold_at&order=sold_at.asc&limit=50000');
      const byItem = new Map();
      rows.forEach((r) => {
        let list = byItem.get(r.item_name);
        if (!list) { list = []; byItem.set(r.item_name, list); }
        list.push(r.price);
      });
      const jumps = new Map();
      byItem.forEach((prices, name) => {
        let maxJump = 0;
        for (let i = 1; i < prices.length; i++) {
          const prev = prices[i - 1];
          if (!prev) continue; // guard div-by-zero on a stray 0-price sale
          const pct = Math.abs((prices[i] - prev) / prev) * 100;
          if (pct > maxJump) maxJump = pct;
        }
        jumps.set(name, maxJump);
      });
      _priceVolatility = jumps;
      if (_itemsSort === 'volatile') renderItems();
    } catch (e) { /* Items tab just falls back to 0 for this sort until it succeeds */ }
  }
  function volatilityFor(itemName) {
    return (_priceVolatility && _priceVolatility.get(itemName)) || 0;
  }

  // Sales average per item, name -> avg price, over a chosen window — used only for the
  // Offers tab's discount badge/tile tint (see discountPct). Independent cache/range from
  // the trade-volume lookup above (different UI control, different purpose) — its own
  // range so switching between them doesn't fight over one shared cache. Deliberately
  // matches whatever window the user picks in "Gemiddelde over" so the badge stays
  // consistent with the item's own detail modal when that's set to the same window
  // (the two disagreeing was the original bug report this whole thing came from).
  let _discountAvgPrices = null;
  let _discountAvgRangeDays = 0; // 0 = all-time
  let _discountAvgLoading = null;

  // Despite the name, this has always meant to be the SAME average the item detail modal
  // calls "Gefilterd gem. (excl. verdacht)" — the outlier-aware one from computeSalesStats,
  // not a flat mean of every sale — that's the whole point of filtering outliers out in the
  // first place: a badge/percentage built off the raw mean would swing wildly on a single
  // bogus 1 BC "sale" the same way the raw average itself does. Originally this WAS just a
  // flat sum/count (confirmed live as a real bug: a single 1 BC outlier sale visibly dragged
  // every badge computed off it), fixed by running the exact same computeSalesStats/
  // salesStatsOptsFor algorithm per item here that the detail modal already uses — needs
  // sold_at+manual_suspicious per row (not just price) and chronological order for that.
  async function loadDiscountAvgPrices(rangeDays, force) {
    if (!force && _discountAvgPrices && _discountAvgRangeDays === rangeDays) return _discountAvgPrices;
    if (_discountAvgLoading && _discountAvgRangeDays === rangeDays) return _discountAvgLoading;
    let path = '/mp_sales?select=item_name,price,sold_at,manual_suspicious&order=sold_at.asc&limit=50000';
    if (rangeDays > 0) path += '&sold_at=gte.' + encodeURIComponent(new Date(Date.now() - rangeDays * 86400000).toISOString());
    _discountAvgRangeDays = rangeDays;
    _discountAvgLoading = sbGet(path).then((rows) => {
      // rows arrive sold_at ASC already — grouping preserves that per-item chronological
      // order, which computeSalesStats requires (its first-20-trusted/running-average logic
      // is order-dependent).
      const byItem = new Map();
      rows.forEach((r) => {
        let list = byItem.get(r.item_name);
        if (!list) { list = []; byItem.set(r.item_name, list); }
        list.push(r);
      });
      const itemsByName = new Map(_items.map((it) => [it.name, it]));
      const avgs = new Map();
      byItem.forEach((salesAsc, name) => {
        const item = itemsByName.get(name);
        const stats = computeSalesStats(salesAsc, salesStatsOptsFor(item));
        const avg = stats.cleanAvg != null ? stats.cleanAvg : stats.rawAvg;
        if (avg != null) avgs.set(name, avg);
      });
      // An item with custom_value ("Alternatieve waarde") but ZERO real sales yet never goes
      // through the loop above at all (nothing in byItem for it) — computeSalesStats still
      // needs to run once for it with an empty sales list so the seedValue-only average comes
      // through, same as the detail modal's own no-sales branch does.
      _items.forEach((it) => {
        if (avgs.has(it.name) || byItem.has(it.name)) return;
        const stats = computeSalesStats([], salesStatsOptsFor(it));
        const avg = stats.cleanAvg != null ? stats.cleanAvg : stats.rawAvg;
        if (avg != null) avgs.set(it.name, avg);
      });
      _discountAvgPrices = avgs;
      _discountAvgLoading = null;
      renderOffers(); // re-render so badges/tints pick up the freshly (re)loaded averages
      if (_salesAll.length) renderSalesFeed(); // Sales' own vs-average badges read this same cache
      return avgs;
    }).catch((e) => { _discountAvgLoading = null; throw e; });
    return _discountAvgLoading;
  }
  function startLiveDiscountAvgRefresh() {
    setInterval(() => loadDiscountAvgPrices(_discountAvgRangeDays, true), 30000);
  }

  // Wires a sort <select> + its companion time-range <select> (only relevant/shown for the
  // 'traded' sort option) — shared by Items and Offers, which each pass their own
  // get/set closures over their own sort/range state.
  function _wireSortControls(sortId, rangeId, setSort, getSort, setRange, getRange, rerender) {
    const sortEl = document.getElementById(sortId);
    const rangeEl = document.getElementById(rangeId);
    function syncRangeVisibility() { rangeEl.hidden = getSort() !== 'traded'; }
    syncRangeVisibility();
    sortEl.addEventListener('change', () => {
      setSort(sortEl.value);
      syncRangeVisibility();
      if (sortEl.value === 'traded') loadTradeCounts(getRange()).then(rerender);
      else rerender();
    });
    rangeEl.addEventListener('change', () => {
      setRange(parseInt(rangeEl.value, 10));
      loadTradeCounts(getRange(), true).then(rerender);
    });
  }

  // ── Items tab ──────────────────────────────────────────────────────────────────────
  let _items = [];
  let _itemsQuery = '';
  const _itemsCategories = new Set(); // empty = no filter = show every category
  let _itemsPage = 0;
  let _itemsPageSize = 100;
  let _itemsView = loadViewPref('__mp_items_view', 'tile');
  let _itemsSort = 'default'; // 'default' = the category+alphabetical grouping loadItems() already sorts into
  let _itemsTradeRangeDays = 30;

  async function loadItems(silent) {
    const grid = document.getElementById('items-grid');
    if (!silent) grid.innerHTML = '<div class="loading">Laden...</div>';
    try {
      const rows = await sbGet('/mp_items?select=name,category,icon_url,value,value_currency,custom_value,custom_value_currency,last_scanned_at&order=name.asc&limit=5000');
      // Grouped in the same order as the tabs on leet.city/ruilwaarde itself (Club Cadeau,
      // LTD, Rares, SS), alphabetical within each category — not one flat alphabetical mix
      // across categories.
      const catRank = {};
      CATEGORIES.forEach((c, i) => { catRank[c.label] = i; });
      rows.sort((a, b) => {
        const ra = catRank[a.category], rb = catRank[b.category];
        if (ra !== rb) return (ra == null ? 99 : ra) - (rb == null ? 99 : rb);
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });
      _items = rows;
      document.getElementById('items-sub').textContent = _items.length.toLocaleString() + ' items bekend, gegroepeerd naar Waarde-pagina.';
      renderItemsFilters();
      renderItems();
    } catch (e) {
      if (!silent) grid.innerHTML = '<div class="error-msg">Fout bij laden: ' + esc(e.message) + '</div>';
      // A silent background refresh failing just leaves the last good render up — no need
      // to blow away a working page over one flaky poll.
    }
  }

  // New items (freshly scanned in-game) show up here without a manual reload — a plain
  // background re-fetch on an interval, re-rendering in place. Doesn't touch the search
  // box or filter chips, only the grid/pagination content, so it doesn't steal focus or
  // reset whatever the user was doing.
  function startLiveItemsRefresh() {
    setInterval(() => loadItems(true), 10000);
  }

  // Multi-select: "Alle" clears the set (shows everything); each category chip toggles
  // independently, so any combination of categories can be shown at once.
  function renderItemsFilters() {
    const row = document.getElementById('items-filter-row');
    row.innerHTML = '<button class="filter-chip' + (_itemsCategories.size === 0 ? ' active' : '') + '" data-cat="ALL">Alle</button>'
      + CATEGORIES.map((c) =>
          '<button class="filter-chip' + (_itemsCategories.has(c.slug) ? ' active' : '') + '" data-cat="' + esc(c.slug) + '">' + esc(c.label) + '</button>'
        ).join('');
  }

  function filteredItemsList() {
    let filtered = _items;
    if (_itemsCategories.size > 0) {
      const activeLabels = new Set(Array.from(_itemsCategories).map((slug) => CATEGORIES.find((c) => c.slug === slug).label));
      filtered = filtered.filter((r) => activeLabels.has(r.category));
    }
    if (_itemsQuery) {
      const q = _itemsQuery.toLowerCase();
      filtered = filtered.filter((r) => r.name.toLowerCase().includes(q));
    }
    // 'default' order is already how _items itself is sorted (category rank, then
    // alphabetical) — everything else needs an explicit re-sort here. Ties broken
    // alphabetically throughout so the order stays stable/predictable either way.
    if (_itemsSort === 'traded') {
      filtered = filtered.slice().sort((a, b) => {
        const d = tradeCountFor(b.name) - tradeCountFor(a.name);
        return d !== 0 ? d : (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      });
    } else if (_itemsSort === 'last-traded') {
      filtered = filtered.slice().sort((a, b) => {
        const ta = lastTradedAtFor(a.name), tb = lastTradedAtFor(b.name);
        if (!ta && !tb) return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
        if (!ta) return 1; // never-traded sinks to the end
        if (!tb) return -1;
        return tb < ta ? -1 : tb > ta ? 1 : 0; // most recent first
      });
    } else if (_itemsSort === 'volatile') {
      filtered = filtered.slice().sort((a, b) => {
        const d = volatilityFor(b.name) - volatilityFor(a.name);
        return d !== 0 ? d : (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      });
    } else if (_itemsSort === 'price-desc' || _itemsSort === 'price-asc') {
      const dir = _itemsSort === 'price-desc' ? -1 : 1;
      filtered = filtered.slice().sort((a, b) => {
        const ra = a.value_currency in CURRENCY_RANK ? CURRENCY_RANK[a.value_currency] : 3;
        const rb = b.value_currency in CURRENCY_RANK ? CURRENCY_RANK[b.value_currency] : 3;
        if (ra !== rb) return ra - rb; // currency grouping is always this fixed order, regardless of price direction
        const va = a.value, vb = b.value;
        if (va == null && vb == null) return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
        if (va == null) return 1; // no value sinks to the end within its group
        if (vb == null) return -1;
        return dir * (va - vb);
      });
    }
    return filtered;
  }
  function itemsTotalPages() {
    return Math.max(1, Math.ceil(filteredItemsList().length / _itemsPageSize));
  }

  function renderItems() {
    const filtered = filteredItemsList();
    const totalPages = itemsTotalPages();
    if (_itemsPage >= totalPages) _itemsPage = totalPages - 1;
    if (_itemsPage < 0) _itemsPage = 0;
    const pageRows = filtered.slice(_itemsPage * _itemsPageSize, _itemsPage * _itemsPageSize + _itemsPageSize);

    const grid = document.getElementById('items-grid');
    grid.className = _itemsView === 'tile' ? 'cat-grid' : 'tbl-wrap';
    if (!pageRows.length) {
      grid.innerHTML = '<div class="loading"' + (_itemsView === 'tile' ? ' style="grid-column:1/-1"' : '') + '>' + (_items.length ? 'Geen resultaten.' : 'Nog geen items gescand.') + '</div>';
    } else if (_itemsView === 'tile') {
      grid.innerHTML = pageRows.map((r) => {
        const thumb = r.icon_url
          ? '<img src="' + esc(r.icon_url) + '" alt="" loading="lazy">'
          : '<span class="cat-thumb-ph">' + esc((r.name || '?').slice(0, 1).toUpperCase()) + '</span>';
        const curCls = currencyCls(r.value_currency);
        return '<button class="cat-card" data-item="' + esc(r.name) + '" style="position:relative;text-align:left">'
          + '<div class="item-value ' + curCls + '">' + valueHtml(r) + '</div>'
          + '<div class="cat-thumb">' + thumb + '</div>'
          + '<div class="cat-name">' + esc(r.name) + '</div>'
          + (_itemsSort === 'traded' ? '<div class="sale-tile-time">' + tradeCountFor(r.name).toLocaleString() + 'x verhandeld</div>' : '')
          + (_itemsSort === 'last-traded' ? '<div class="sale-tile-time">' + esc(relTime(lastTradedAtFor(r.name))) + '</div>' : '')
          + '</button>';
      }).join('');
    } else {
      // "Laatste wijziging" isn't shown per row — it's computed on demand from a full
      // sales fetch (see openItemDetail), too expensive to do for every row in a list of
      // hundreds/thousands of items at once.
      grid.innerHTML = pageRows.map((r) => {
        const icon = r.icon_url
          ? '<img class="sale-icon" src="' + esc(r.icon_url) + '" alt="" loading="lazy">'
          : '<span class="sale-icon-ph"></span>';
        const curCls = currencyCls(r.value_currency);
        return '<button class="item-row" data-item="' + esc(r.name) + '">'
          + icon
          + '<span class="item-row-name">' + esc(r.name) + '</span>'
          + '<span class="item-row-cat">' + esc(r.category || '') + '</span>'
          + (_itemsSort === 'traded' ? '<span class="item-row-cat">' + tradeCountFor(r.name).toLocaleString() + 'x verhandeld</span>' : '')
          + (_itemsSort === 'last-traded' ? '<span class="item-row-cat">' + esc(relTime(lastTradedAtFor(r.name))) + '</span>' : '')
          + '<span class="item-row-value ' + curCls + '">' + valueHtml(r) + '</span>'
          + '</button>';
      }).join('');
    }
    renderPager('items-pagination', _itemsPage, totalPages, filtered.length, _itemsPageSize, 'items');
  }

  // ── Item detail modal ─────────────────────────────────────────────────────────────
  let _detailData = null; // set once per openItemDetail() call, read by _renderDetailWindow on toggle clicks
  let _detailWindow = 'all';
  let _detailListTab = 'sales'; // 'sales' | 'cancelled' — which list is shown below the chart

  async function openItemDetail(name) {
    const item = _items.find((r) => r.name === name);
    // Live listing info (if this item currently has an active marketplace offer) — separate
    // from mp_items/mp_sales, so it has to be looked up from the Offers tab's own data.
    const liveOffer = _offers.find((r) => r.item_name === name);
    document.getElementById('modal-title').innerHTML = (item && item.icon_url
      ? '<img src="' + esc(item.icon_url) + '" alt="" style="width:28px;height:28px;object-fit:contain;image-rendering:pixelated;vertical-align:middle;margin-right:8px">'
      : '') + esc(name);
    const body = document.getElementById('modal-body');
    body.innerHTML = '<div class="loading">Laden...</div>';
    document.getElementById('modal-overlay').classList.add('open');
    _detailWindow = 'all';
    _detailListTab = 'sales';
    _detailData = null;

    let sales, cancelled;
    try {
      sales = await sbGet('/mp_sales?item_name=eq.' + encodeURIComponent(name) + '&select=offer_id,price,currency,sold_at,manual_suspicious&order=sold_at.desc,offer_id.desc&limit=1000');
    } catch (e) {
      body.innerHTML = '<div class="error-msg">Fout bij laden: ' + esc(e.message) + '</div>';
      return;
    }
    // Best-effort — a failed fetch here shouldn't block the sales side of the modal from
    // showing, it just leaves the "annulaties" tab empty.
    try {
      cancelled = await sbGet('/mp_cancelled_offers?item_name=eq.' + encodeURIComponent(name) + '&select=offer_id,price,count,cancelled_at&order=cancelled_at.desc&limit=1000');
    } catch (e) { cancelled = []; }

    if (!sales.length) {
      const seedOnly = item && item.custom_value > 0 && item.custom_value_currency === 'belcredits'
        ? { rawAvg: item.custom_value, cleanAvg: item.custom_value, count: 0 }
        : { rawAvg: null, cleanAvg: null, count: 0 };
      _detailData = { item, liveOffer, sales: [], ascending: [], changePct: null, statsOpts: salesStatsOptsFor(item), cancelled };
      body.innerHTML = renderDetailStats(item, seedOnly, null, liveOffer)
        + '<div class="detail-sales-hdr" id="detail-list-tabs"></div>'
        + '<div id="detail-sales-list"></div>';
      _renderDetailListTabs();
      _renderActiveDetailList();
      return;
    }

    const ascending = sales.slice().reverse(); // chart + suspicious-detection both read chronologically

    // "Laatste wijziging" — average of every sale before the most recent one vs. the
    // average with it included, as a %. Needs at least 2 sales. Not windowed — it's about
    // the single latest transaction, which stays the same regardless of look-back range.
    let changePct = null;
    if (sales.length >= 2) {
      const rawAvg = ascending.reduce((s, r) => s + r.price, 0) / ascending.length;
      const avgBefore = sales.slice(1).reduce((s, r) => s + r.price, 0) / (sales.length - 1);
      if (avgBefore > 0) changePct = ((rawAvg - avgBefore) / avgBefore) * 100;
    }

    _detailData = { item, liveOffer, sales, ascending, changePct, statsOpts: salesStatsOptsFor(item), cancelled };

    body.innerHTML =
      '<div class="filter-row" id="detail-window-toggle" style="margin-bottom:14px"></div>'
      + '<div id="detail-stats-mount"></div>'
      + '<div id="detail-chart-wrap"></div>'
      + '<div class="detail-sales-hdr" id="detail-list-tabs"></div>'
      + '<div id="detail-sales-list"></div>';

    _renderDetailListTabs();
    _renderActiveDetailList();
    _renderDetailWindow('all');
  }

  // Two clickable "headers" standing in for tabs — "Alle geregistreerde sales (N)" (default)
  // and "Alle geregistreerde annulaties (M)" — swap which list renders below without
  // re-fetching anything, both datasets are already loaded on _detailData from openItemDetail.
  function _renderDetailListTabs() {
    const el = document.getElementById('detail-list-tabs');
    if (!el || !_detailData) return;
    const salesCount = _detailData.sales.length;
    const cancelledCount = (_detailData.cancelled || []).length;
    el.innerHTML =
      '<span class="detail-list-tab' + (_detailListTab === 'sales' ? ' active' : '') + '" data-list-tab="sales">Alle geregistreerde sales (' + salesCount + ')</span>'
      + '<span class="detail-list-tab' + (_detailListTab === 'cancelled' ? ' active' : '') + '" data-list-tab="cancelled">Alle geregistreerde annulaties (' + cancelledCount + ')</span>';
  }

  function _renderActiveDetailList() {
    if (_detailListTab === 'cancelled') _renderCancelledList(); else _renderSalesList();
  }

  // Cancelled offers have no suspicious/manual-flag concept (that's a sales-price thing) —
  // just a flat list, same row shape as the sales list minus the flag button.
  function _renderCancelledList() {
    if (!_detailData) return;
    const cancelled = _detailData.cancelled || [];
    document.getElementById('detail-sales-list').innerHTML = cancelled.length ? cancelled.map((c, i) => {
      return '<div class="detail-sale-row">'
        + '<span class="detail-sale-num mono">#' + (cancelled.length - i) + '</span>'
        + '<span class="detail-sale-price">' + c.price.toLocaleString() + ' BC' + (_detailData.item ? vsAvgBadgeHtml(_detailData.item.name, c.price, 'vsavg-inline') : '') + '</span>'
        + '<span class="detail-sale-time">' + esc(fullTime(c.cancelled_at)) + '</span>'
        + '</div>';
    }).join('') : '<div class="loading">Nog geen annulaties geregistreerd voor dit item.</div>';
  }

  // Rebuilds just the "Alle geregistreerde sales" list from _detailData.sales — called on
  // open and after toggleManualSuspicious, entirely from already-loaded data (no refetch).
  function _renderSalesList() {
    if (!_detailData) return;
    const { sales, ascending, statsOpts } = _detailData;
    // Per-sale suspicious flag/deviation, keyed by offer_id — this list always shows every
    // sale (not windowed), so it always uses all-time's classification.
    const suspiciousByOfferId = new Map(computeSalesStats(ascending, statsOpts).perSale.map((s) => [s.offer_id, s]));
    document.getElementById('detail-sales-list').innerHTML = sales.map((s, i) => {
      const flagged = suspiciousByOfferId.get(s.offer_id);
      const suspicious = flagged && flagged.suspicious;
      const manual = s.manual_suspicious === true;
      const pctTxt = suspicious && !manual && flagged.pctFromAvg != null
        ? ' <span class="detail-sale-pct">' + (flagged.pctFromAvg > 0 ? '+' : '') + Math.round(flagged.pctFromAvg) + '% vs gem.</span>'
        : '';
      const badgeTxt = manual ? 'verdacht (manueel)' : 'verdacht';
      // sales is newest-first; the number counts down from the total (newest = highest,
      // i.e. the Nth sale ever recorded for this item) to 1 (oldest) — doubles as visible
      // proof this list holds more than leet.city's own capped "laatste 10" once it passes 10.
      return '<div class="detail-sale-row' + (suspicious ? ' suspicious' : '') + '">'
        + '<span class="detail-sale-num mono">#' + (sales.length - i) + '</span>'
        + '<span class="detail-sale-price">' + s.price.toLocaleString() + ' ' + esc(currencyLabel(s.currency)) + (suspicious ? ' <span class="badge badge-red">' + badgeTxt + '</span>' + pctTxt : '') + '</span>'
        + '<span class="detail-sale-offerid mono">offer #' + esc(s.offer_id) + '</span>'
        + '<span class="detail-sale-time">' + esc(fullTime(s.sold_at)) + '</span>'
        + '<button class="btn-ghost detail-sale-flag' + (manual ? ' active' : '') + '" data-offer-id="' + s.offer_id + '" data-manual="' + manual + '" title="' + (manual ? 'Ontmarkeer als verdacht' : 'Markeer als verdacht') + '">&#9873;</button>'
        + '</div>';
    }).join('');
  }

  const DETAIL_WINDOWS = [
    { key: 'all', label: 'All-time', days: 0 },
    { key: '90', label: '90 dagen', days: 90 },
    { key: '10', label: '10 dagen', days: 10 },
  ];

  // Re-renders just the toggle + stat tiles + chart for the selected window — the sales
  // list underneath stays put (it's always the full all-time list, never windowed), so
  // switching windows doesn't reset scroll position or flicker that part.
  let _detailHideSuspicious = false; // chart-only — the sales list below already flags "verdacht" rows in place, this just keeps their spikes from distorting the chart
  function _renderDetailWindow(key) {
    if (!_detailData) return;
    _detailWindow = key;
    const { item, liveOffer, ascending, changePct, statsOpts } = _detailData;
    const win = DETAIL_WINDOWS.find((w) => w.key === key) || DETAIL_WINDOWS[0];
    const points = win.days > 0 ? ascending.filter((s) => Date.now() - new Date(s.sold_at).getTime() <= win.days * 86400000) : ascending;
    const stats = computeSalesStats(points, statsOpts);
    const chartPoints = _detailHideSuspicious ? points.filter((p, i) => !stats.perSale[i].suspicious) : points;

    document.getElementById('detail-window-toggle').innerHTML = DETAIL_WINDOWS.map((w) =>
      '<button class="filter-chip' + (w.key === key ? ' active' : '') + '" data-window="' + w.key + '">' + w.label + '</button>'
    ).join('');
    document.getElementById('detail-stats-mount').innerHTML = renderDetailStats(item, stats, changePct, liveOffer);
    renderPriceChart(document.getElementById('detail-chart-wrap'), chartPoints, stats.rawAvg);
  }

  // Outlier-aware average: the first 20 sales (chronologically) are always trusted, to
  // build a real baseline before any flagging starts — an item with only a handful of sales
  // would otherwise never get a stable enough average to judge outliers against. From the
  // 21st sale on, each one is compared to the running average of everything trusted SO FAR;
  // more than 50% off in either direction gets flagged suspicious and excluded from the
  // running average (so one bad sale can't drag the baseline toward the next one). Runs
  // independently per time window (all-time/90d/10d) — each gets its own first-20 baseline
  // from its own subset, not a shared one, so a 10-day window with fewer than 20 sales just
  // never flags anything (matches "not enough data to judge" rather than guessing).
  // `opts.alwaysSuspiciousBelow` short-circuits the normal first-20/running-average logic
  // entirely — used for SS: a 1-100 BC "sale" on an item whose real value is usually
  // thousands is essentially never a real market price. A couple of SS items are genuinely
  // cheap by nature though (confirmed live: "De Hand in het Gezicht (SS)" and "Prinselijke
  // Troon (SS)" both sell for well under 100 BC normally, and the blanket rule flagged
  // every single one of their sales, leaving no clean average at all) — see
  // SS_ALWAYS_SUSPICIOUS_EXCLUDED below for those. A manual flag (s.manual_suspicious ===
  // true, set via the detail modal's per-sale toggle) outranks both — a human said so, no
  // algorithm gets to overrule that.
  // `opts.seedValue` — an item's custom_value ("Alternatieve waarde", set on the ruilwaarde
  // page, not a real sale) is folded into the average as one extra trusted data point when
  // it's > 0 *and* denominated in Belcredits (see salesStatsOptsFor — mp_sales prices are
  // always BC, so a Diamonds/Credits custom_value can't just be summed in with them; that
  // was a real bug here, caught live). It's added to the running clean baseline *before*
  // any real sales are processed (so it's part of what "first 20 trusted" sales get judged
  // against too), but never appears in `perSale` — it's not a transaction, so it has no
  // place in the "Alle geregistreerde sales" list or the suspicious-per-sale detection.
  function computeSalesStats(salesAsc, opts) {
    opts = opts || {};
    const hasSeed = opts.seedValue > 0;
    let cleanSum = hasSeed ? opts.seedValue : 0;
    let cleanCount = hasSeed ? 1 : 0;
    let rawSum = hasSeed ? opts.seedValue : 0;
    const perSale = salesAsc.map((s, i) => {
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
      return Object.assign({}, s, { suspicious, pctFromAvg });
    });
    const rawCount = salesAsc.length + (hasSeed ? 1 : 0);
    return {
      count: salesAsc.length, // real sales only — this is what "Aantal sales" displays
      rawAvg: rawCount ? rawSum / rawCount : null,
      cleanAvg: cleanCount ? cleanSum / cleanCount : null,
      cleanCount,
      perSale,
    };
  }

  // SS items confirmed to be genuinely cheap by nature — exempted from the "under 100 BC
  // is always suspicious" SS rule (see computeSalesStats).
  const SS_ALWAYS_SUSPICIOUS_EXCLUDED = new Set(['De Hand in het Gezicht (SS)', 'Prinselijke Troon (SS)']);
  function salesStatsOptsFor(item) {
    const opts = {};
    if (item && item.custom_value > 0 && item.custom_value_currency === 'belcredits') opts.seedValue = item.custom_value;
    const ssLabel = CATEGORIES.find((c) => c.slug === 'ss').label;
    if (item && item.category === ssLabel && !SS_ALWAYS_SUSPICIOUS_EXCLUDED.has(item.name)) opts.alwaysSuspiciousBelow = 100;
    return Object.keys(opts).length ? opts : undefined;
  }

  // `stats` is a computeSalesStats() result (rawAvg/cleanAvg/count) for whichever window
  // is currently selected — see _renderDetailWindow.
  function renderDetailStats(item, stats, changePct, liveOffer) {
    const value = item && item.value != null ? item.value.toLocaleString() : '—';
    const valueUnit = item && item.value_currency ? currencyLabel(item.value_currency) : '';
    const changeTxt = changePct == null ? '—' : (changePct > 0 ? '+' : '') + changePct.toFixed(1) + '%';
    function fmtAvg(v) { return v == null ? '—' : Math.round(v).toLocaleString() + ' <span class="item-value-unit" style="font-size:11px">BC</span>'; }
    // mp_sales prices are always Belcredits (see marktplaats-scan-worker.js — the
    // marktplaats itself only ever trades in BC), so the average's unit is fixed, unlike
    // Waarde which can be BC or Diamonds depending on the item.
    const customHtml = item && item.custom_value != null
      ? '<div class="detail-stat"><div class="detail-stat-lbl">Alternatieve waarde</div><div class="detail-stat-val">' + item.custom_value.toLocaleString() + ' <span class="item-value-unit" style="font-size:11px">' + esc(currencyLabel(item.custom_value_currency)) + '</span></div></div>'
      : '';
    // Same LTD-vs-quantity distinction as the Offers list (see _isLtd) — an LTD's count is
    // its edition/serial number, a regular Rare/SS's count is how many identical offers are
    // currently stacked under this one listing.
    const liveIsLtd = liveOffer && _isLtd(liveOffer.item_name);
    const liveHtml = liveOffer
      ? '<div class="detail-stat"><div class="detail-stat-lbl">' + (liveIsLtd ? 'Live aanbod (editienr.)' : 'Live aanbod') + '</div><div class="detail-stat-val">' + liveOffer.price.toLocaleString() + ' <span class="item-value-unit" style="font-size:11px">BC' + (liveOffer.count > 1 ? ' &middot; ' + (liveIsLtd ? '#' + liveOffer.count : 'x' + liveOffer.count) : '') + '</span></div></div>'
      : '';
    return '<div class="detail-stats">'
      + '<div class="detail-stat"><div class="detail-stat-lbl">Waarde</div><div class="detail-stat-val">' + value + (valueUnit ? ' <span class="item-value-unit" style="font-size:11px">' + esc(valueUnit) + '</span>' : '') + '</div></div>'
      + customHtml
      + liveHtml
      + '<div class="detail-stat"><div class="detail-stat-lbl">Laatste wijziging</div><div class="detail-stat-val" style="' + (changePct > 0 ? 'color:var(--green)' : changePct < 0 ? 'color:var(--red)' : '') + '">' + changeTxt + '</div></div>'
      + '<div class="detail-stat"><div class="detail-stat-lbl">Aantal sales</div><div class="detail-stat-val">' + stats.count + '</div></div>'
      + '<div class="detail-stat"><div class="detail-stat-lbl">Gemiddelde prijs</div><div class="detail-stat-val">' + fmtAvg(stats.rawAvg) + '</div></div>'
      + '<div class="detail-stat"><div class="detail-stat-lbl">Gefilterd gem. <span style="font-weight:400;text-transform:none">(excl. verdacht)</span></div><div class="detail-stat-val">' + fmtAvg(stats.cleanAvg) + '</div></div>'
      + '</div>';
  }

  // Single-series line chart, inline SVG — thin 2px line, rounded data-ends, hover
  // crosshair+tooltip. One series (this item's own price history) so no legend needed;
  // the card title already names it.
  function renderPriceChart(container, points, avg) {
    if (points.length < 2) {
      container.innerHTML = '<div class="card" style="padding:14px"><p class="desc" style="margin:0">Nog niet genoeg data-punten voor een grafiek (minstens 2 sales nodig).</p></div>';
      return;
    }
    const W = 560, H = 200, PAD_L = 44, PAD_R = 12, PAD_T = 14, PAD_B = 26;
    const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;

    const times = points.map((p) => new Date(p.sold_at).getTime());
    const prices = points.map((p) => p.price);
    const minT = Math.min.apply(null, times), maxT = Math.max.apply(null, times);
    const minP = Math.min.apply(null, prices), maxP = Math.max.apply(null, prices);
    const pRange = maxP - minP || 1;
    const tRange = maxT - minT || 1;

    function x(t) { return PAD_L + ((t - minT) / tRange) * plotW; }
    function y(p) { return PAD_T + plotH - ((p - minP) / pRange) * plotH; }

    const pathD = points.map((p, i) => (i === 0 ? 'M' : 'L') + x(times[i]).toFixed(1) + ' ' + y(prices[i]).toFixed(1)).join(' ');

    // 4 horizontal gridlines with price labels — recessive, muted token color.
    const gridLines = [];
    for (let i = 0; i <= 3; i++) {
      const gp = minP + (pRange * i / 3);
      const gy = y(gp);
      gridLines.push('<line x1="' + PAD_L + '" y1="' + gy.toFixed(1) + '" x2="' + (W - PAD_R) + '" y2="' + gy.toFixed(1) + '" stroke="var(--border)" stroke-width="1"/>');
      gridLines.push('<text x="' + (PAD_L - 6) + '" y="' + (gy + 3).toFixed(1) + '" text-anchor="end" font-size="9" fill="var(--muted)">' + Math.round(gp).toLocaleString() + '</text>');
    }

    const dots = points.map((p, i) =>
      '<circle class="chart-dot" data-i="' + i + '" cx="' + x(times[i]).toFixed(1) + '" cy="' + y(prices[i]).toFixed(1) + '" r="7" fill="transparent"/>'
    ).join('');
    const visibleDots = points.map((p, i) =>
      '<circle cx="' + x(times[i]).toFixed(1) + '" cy="' + y(prices[i]).toFixed(1) + '" r="2.5" fill="var(--primary)"/>'
    ).join('');

    container.innerHTML =
      '<div class="card" style="padding:14px;position:relative">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin:0 0 8px;gap:8px">'
      + '<p class="desc" style="margin:0">Prijs per sale, chronologisch</p>'
      + '<button type="button" id="detail-hide-suspicious-chk" class="chart-hide-suspicious-btn' + (_detailHideSuspicious ? ' active' : '') + '" aria-pressed="' + (_detailHideSuspicious ? 'true' : 'false') + '">Verberg verdachte sales</button>'
      + '</div>'
      + '<svg id="price-chart-svg" viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block">'
      + gridLines.join('')
      + '<path d="' + pathD + '" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
      + visibleDots
      + dots
      + '</svg>'
      + '<div id="chart-tooltip"></div>'
      + '</div>';

    const svg = document.getElementById('price-chart-svg');
    const tooltip = document.getElementById('chart-tooltip');
    svg.querySelectorAll('.chart-dot').forEach((dot) => {
      dot.addEventListener('mouseenter', () => {
        const i = parseInt(dot.dataset.i, 10);
        const p = points[i];
        tooltip.innerHTML = '<strong>' + p.price.toLocaleString() + ' ' + esc(currencyLabel(p.currency)) + '</strong><br>' + esc(fullTime(p.sold_at));
        tooltip.style.opacity = '1';
        const rect = dot.getBoundingClientRect();
        const wrapRect = svg.parentElement.getBoundingClientRect();
        tooltip.style.left = (rect.left - wrapRect.left + 10) + 'px';
        tooltip.style.top = (rect.top - wrapRect.top - 30) + 'px';
      });
      dot.addEventListener('mouseleave', () => { tooltip.style.opacity = '0'; });
    });
  }

  // ── Offers tab (live public marketplace listings, fed by extensions/fun/marktplaats.js's
  // Logger — MarketPlaceOffers poll, throttled DB sync, TTL-pruned so a bought/expired
  // listing just ages out) ──────────────────────────────────────────────────────────
  const OFFERS_STALE_MS = 10 * 1000; // a bit above the extension's own 6s prune window, so this doesn't flicker stale before that does
  let _offers = [];
  let _offersQuery = '';
  const _offersCategories = new Set(); // empty = no filter = show every category, same multi-select as Items/Sales
  let _offersPage = 0;
  let _offersPageSize = 100;
  let _offersView = loadViewPref('__mp_offers_view', 'tile');
  let _offersSort = 'newest'; // matches loadOffers()'s own order=offer_id.desc — see sortOffersList
  let _offersTradeRangeDays = 30;
  let _offersMinDiscount = 0; // 0 = no filter
  let _offersDiscountBasisDays = 0; // which average discountPct() is computed against — 0 = all-time

  function renderOffersFilters() {
    const row = document.getElementById('offers-filter-row');
    row.innerHTML = '<button class="filter-chip' + (_offersCategories.size === 0 ? ' active' : '') + '" data-cat="ALL">Alle</button>'
      + CATEGORIES.map((c) =>
          '<button class="filter-chip' + (_offersCategories.has(c.slug) ? ' active' : '') + '" data-cat="' + esc(c.slug) + '">' + esc(c.label) + '</button>'
        ).join('');
  }

  // Live offers carry no ruilwaarde category of their own (the marketplace packet only has
  // a furni classId) — cross-referenced against the Items tab's already-loaded mp_items
  // list (name -> category) instead of a real FK-embed, since mp_live_offers.item_name
  // isn't declared as a foreign key.
  function _offerCategory(itemName) {
    const item = _items.find((r) => r.name === itemName);
    return item ? item.category : null;
  }

  // ── Proxy scanner (ruilwaarde-proxy-scan on the VM) — a headless equivalent of the
  // in-game "Ruilwaarde scanner", running through curl-impersonate + a residential/dc
  // proxy so it works without a browser tab open. Runs itself every 2h; this control lets
  // you fire one on demand and see its status, plus the compact per-category rows (see
  // renderScanProgress) it feeds. Shown on Sales Feed/Items, hidden on Offers (live
  // listings, a different data source entirely) — see setTab(). One sidebar block, not
  // duplicated per page.
  let _proxyScanStatus = null;
  const PROXY_SCAN_STALE_MS = 2.5 * 60 * 60 * 1000; // a bit past the 2h auto-run interval

  async function pollProxyScanStatus() {
    try {
      const res = await fetch(SB_URL.replace('/rest/v1', '') + '/trigger-scan/status');
      _proxyScanStatus = await res.json();
    } catch (e) { /* just keeps showing whatever was last rendered */ }
    renderProxyScanStatus();
  }
  function startLiveProxyScanStatusRefresh() {
    setInterval(pollProxyScanStatus, 15000);
  }

  async function triggerProxyScan() {
    try {
      await fetch(SB_URL.replace('/rest/v1', '') + '/trigger-scan', { method: 'POST' });
    } catch (e) { /* status poll below will just keep showing whatever the service reports */ }
    await pollProxyScanStatus();
  }

  function renderProxyScanStatus() {
    const s = _proxyScanStatus;
    const running = !!(s && s.running);
    // Red = something's actually wrong (last attempt failed outright, or it's been so long
    // since the last success that the scan service itself looks dead) — not just "currently
    // idle between scheduled runs", which is the normal, healthy state most of the time given
    // the 2h+ gaps in the schedule. That normal wait gets its own orange instead of reusing
    // red, which used to make a perfectly healthy idle scanner look broken.
    const failed = !!(s && s.lastRun && s.lastRun.ok === false);
    const staleSuccess = !!(s && s.lastRun && s.lastRun.ok && (Date.now() - new Date(s.lastRun.finishedAt).getTime()) >= PROXY_SCAN_STALE_MS);
    const broken = failed || staleSuccess;
    const dotColor = running ? 'var(--green)' : (broken ? 'var(--red)' : 'var(--orange)');
    const label = running ? 'Bezig...' : (broken ? 'Niet actief' : 'Wachten op volgende scan');
    const timeTxt = s && s.lastRun ? relTime(s.lastRun.finishedAt) : '—';
    // Belgian time explicitly (not the viewer's own timezone) — the schedule itself is
    // defined in Brussels wall-clock time (see ruilwaarde-proxy-scan/schedule.js), so
    // showing anything else here would just be confusing next to it. Hour:minute only — the
    // weekday added noise without adding information for a scan that's always within a day.
    const nextTxt = s && s.nextScanAt
      ? new Date(s.nextScanAt).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })
      : '—';
    const html = '<div class="ps-line"><span class="scan-dot" style="background:' + dotColor + '"></span><span>Ruilwaarde proxy-scan</span></div>'
      + '<span class="ps-time">Laatst gescand: ' + esc(timeTxt) + '</span>'
      + '<span class="ps-status">' + esc(label) + '</span>'
      + '<span class="ps-time">Volgende: ' + esc(nextTxt) + '</span>'
      + '<button class="btn btn-blue proxy-scan-btn"' + (running ? ' disabled' : '') + '>'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>'
      + 'Scan</button>';
    document.querySelectorAll('.proxy-scan-status-inner').forEach((el) => { el.innerHTML = html; });
  }

  // Lives in the sidebar now (site-wide, not just the Offers page) — just a dot + short
  // label, count/freshness moved into the title tooltip instead of always-visible text.
  function renderOffersLogger(rows) {
    const el = document.getElementById('offers-logger-card');
    if (!el) return;
    const newest = rows.reduce((max, r) => (!max || r.last_seen > max ? r.last_seen : max), null);
    const stale = !newest || (Date.now() - new Date(newest).getTime()) > OFFERS_STALE_MS;
    const dotColor = stale ? 'var(--red)' : 'var(--green)';
    const title = stale ? 'Nog niet verbonden — zet Marktplaats scanner aan in-game' : rows.length.toLocaleString() + ' actieve aanbiedingen — ' + relTime(newest);
    el.title = title;
    el.innerHTML = '<span class="scan-dot" style="background:' + dotColor + '"></span><span>Marktplaats Logger</span>';
  }

  function offersTotalPages() {
    return Math.max(1, Math.ceil(filteredOffersList().length / _offersPageSize));
  }
  function filteredOffersList() {
    let filtered = _offers;
    if (_offersCategories.size > 0) {
      const activeLabels = new Set(Array.from(_offersCategories).map((slug) => CATEGORIES.find((c) => c.slug === slug).label));
      filtered = filtered.filter((r) => activeLabels.has(_offerCategory(r.item_name)));
    }
    if (_offersQuery) {
      const q = _offersQuery.toLowerCase();
      filtered = filtered.filter((r) => r.item_name.toLowerCase().includes(q));
    }
    if (_offersMinDiscount > 0) {
      filtered = filtered.filter((r) => {
        const pct = discountPct(r);
        return pct != null && pct >= _offersMinDiscount;
      });
    }
    return sortOffersList(filtered);
  }

  // 'newest' needs no re-sort — _offers already arrives ordered offer_id.desc from
  // loadOffers()'s own query, and filtering preserves that order.
  function sortOffersList(list) {
    switch (_offersSort) {
      case 'oldest': return list.slice().sort((a, b) => a.offer_id - b.offer_id);
      case 'price-desc': return list.slice().sort((a, b) => b.price - a.price);
      case 'price-asc': return list.slice().sort((a, b) => a.price - b.price);
      case 'traded': return list.slice().sort((a, b) => tradeCountFor(b.item_name) - tradeCountFor(a.item_name));
      case 'discount-desc': return list.slice().sort((a, b) => {
        const pa = discountPct(a), pb = discountPct(b);
        if (pa == null && pb == null) return 0;
        if (pa == null) return 1; // no known average sinks to the end
        if (pb == null) return -1;
        return pb - pa; // highest discount (or lowest markup) first
      });
      default: return list;
    }
  }

  // The packet's "count" field means two different things depending on item type — for
  // regular Rares/SS it's a real stack of N identical offers (native UI shows "Aanbod: N"
  // to match), but for LTD items each copy has its own unique edition/serial number and
  // the count field carries THAT instead (native UI still shows "Aanbod: 1" — one offer —
  // while the icon itself gets a numbered badge). LTD names always carry the "(LTD)" suffix
  // (same convention as mp_items.name elsewhere), so that's the cheapest reliable signal.
  function _isLtd(itemName) {
    return /\(LTD\)\s*$/.test(itemName || '');
  }

  // Discount vs. this item's own all-time sales average (_allTimeAvgPrices, see
  // loadAllTimeAvgPrices) — NOT the packet's own avg_price field. Those turned out to
  // disagree (confirmed live: a 960 BC live offer read as "-83%" off the packet's avgPrice
  // while the item's real sales average, shown right there in its own detail modal, was
  // 355 BC — 960 is a markup over 355, not a discount at all), so using our own computed
  // average keeps the badge consistent with what the detail modal already shows.
  // Only ever tiered for a discount (price below avg) — a markup gets no tier color, just
  // a plain red badge, since only discount bands were specified.
  function discountPct(r) {
    const avg = _discountAvgPrices && _discountAvgPrices.get(r.item_name);
    if (!avg || avg <= 0) return null;
    return ((avg - r.price) / avg) * 100;
  }
  // Marktplaats Sales' own simpler vs-average badge — a completed sale's price against that
  // item's all-time average (same _discountAvgPrices cache the Offers discount badge uses,
  // just read the other direction: here a POSITIVE % means this sale went for MORE than
  // average, i.e. a markup). Plain red/green, no tiering — only Offers' discount badge tiers.
  function vsAvgPct(itemName, price) {
    const avg = _discountAvgPrices && _discountAvgPrices.get(itemName);
    if (!avg || avg <= 0) return null;
    return ((price - avg) / avg) * 100;
  }
  function vsAvgBadgeHtml(itemName, price, cls) {
    const pct = vsAvgPct(itemName, price);
    if (pct == null) return ''; // no average known yet for this item — nothing to compare against, not even "0%"
    const rounded = Math.round(pct);
    const tone = rounded === 0 ? 'flat' : (rounded > 0 ? 'up' : 'down');
    return '<span class="' + cls + ' ' + tone + '">' + (rounded > 0 ? '+' : '') + rounded + '%</span>';
  }
  function discountColor(pct) {
    if (pct < 20) return 'var(--muted)';
    if (pct < 30) return 'var(--green)';
    if (pct < 40) return 'var(--primary)';
    if (pct < 50) return 'var(--purple)';
    return 'var(--orange)';
  }
  function discountBadgeHtml(r) {
    const pct = discountPct(r);
    if (pct == null || Math.round(pct) === 0) return '';
    const isDiscount = pct > 0;
    const color = isDiscount ? discountColor(pct) : 'var(--red)';
    const label = (isDiscount ? '-' : '+') + Math.round(Math.abs(pct)) + '%';
    return '<div class="discount-badge" style="background:' + color + '">' + label + '</div>';
  }
  // Tints the whole card/row, not just the badge — a color-mixed tint (not solid) so the
  // price/name text stays readable on top of it. Only for an actual discount; a markup
  // gets no tile tint (just the plain red badge from discountBadgeHtml above).
  function discountTileStyle(r) {
    const pct = discountPct(r);
    if (pct == null || pct <= 0) return '';
    return 'background:color-mix(in oklch,' + discountColor(pct) + ' 16%,var(--card));border-color:color-mix(in oklch,' + discountColor(pct) + ' 40%,var(--border));';
  }

  // A listing stays on the marketplace for 48h from when it went up, unless bought or
  // cancelled first — the public MarketPlaceOffers packet carries no expiry field itself
  // (unlike MarketPlaceOwnOffers, which does), so this is derived from first_seen instead:
  // the first poll that ever logged this offer_id is the closest we can get to "when it was
  // listed" (a few seconds off at most, bounded by DB_SYNC_MS in the extension).
  const OFFER_LIFETIME_MS = 48 * 60 * 60 * 1000;
  function expiryLabel(firstSeen) {
    if (!firstSeen) return null;
    const remainingMs = new Date(firstSeen).getTime() + OFFER_LIFETIME_MS - Date.now();
    if (remainingMs <= 0) return 'verloopt nu';
    const totalMin = Math.floor(remainingMs / 60000);
    const h = Math.floor(totalMin / 60), m = totalMin % 60;
    return h > 0 ? h + 'u ' + m + 'm resterend' : m + 'm resterend';
  }

  async function loadOffers(silent) {
    const list = document.getElementById('offers-list');
    if (!silent) list.innerHTML = '<div class="loading">Laden...</div>';
    try {
      // Newest-listed-first, matching the native marketplace's own default sort — offer_id
      // is server-assigned per new listing, so higher = more recent.
      const rows = await sbGet('/mp_live_offers?select=offer_id,item_name,icon_url,price,avg_price,count,first_seen,last_seen&order=offer_id.desc&limit=2000');
      _offers = rows;
      renderOffersLogger(rows);
      renderOffers();
    } catch (e) {
      if (!silent) list.innerHTML = '<div class="error-msg">Fout bij laden: ' + esc(e.message) + '</div>';
    }
  }

  function startLiveOffersRefresh() {
    setInterval(() => loadOffers(true), 5000);
  }

  function renderOffers() {
    const filtered = filteredOffersList();
    const totalPages = offersTotalPages();
    if (_offersPage >= totalPages) _offersPage = totalPages - 1;
    if (_offersPage < 0) _offersPage = 0;
    const pageRows = filtered.slice(_offersPage * _offersPageSize, _offersPage * _offersPageSize + _offersPageSize);

    const list = document.getElementById('offers-list');
    list.className = _offersView === 'tile' ? 'cat-grid' : 'tbl-wrap';
    if (!pageRows.length) {
      list.innerHTML = '<div class="loading"' + (_offersView === 'tile' ? ' style="grid-column:1/-1"' : '') + '>' + (_offers.length ? 'Geen resultaten.' : 'Nog geen live aanbod — zet Marktplaats scanner aan in-game.') + '</div>';
    } else if (_offersView === 'tile') {
      list.innerHTML = pageRows.map((r) => {
        const icon = r.icon_url
          ? '<img src="' + esc(r.icon_url) + '" alt="" loading="lazy">'
          : '<span class="cat-thumb-ph">' + esc((r.item_name || '?').slice(0, 1).toUpperCase()) + '</span>';
        const expiry = expiryLabel(r.first_seen);
        const ltd = _isLtd(r.item_name);
        const name = esc(r.item_name) + (ltd && r.count > 1 ? ' #' + r.count : '');
        return '<button class="cat-card" data-item="' + esc(r.item_name) + '" style="position:relative;text-align:left;' + discountTileStyle(r) + '">'
          + '<div class="sale-tile-price">' + r.price.toLocaleString() + ' BC' + (r.count > 1 && !ltd ? ' (x' + r.count + ')' : '') + '</div>'
          + discountBadgeHtml(r)
          + '<div class="cat-thumb">' + icon + '</div>'
          + '<div class="cat-name">' + name + '</div>'
          + '<div class="sale-tile-time">' + (expiry ? esc(expiry) : '') + (_offersSort === 'traded' ? ' &middot; ' + tradeCountFor(r.item_name).toLocaleString() + 'x' : '') + '</div>'
          + '<div class="sale-tile-offerid">#' + r.offer_id + '</div>'
          + '</button>';
      }).join('');
    } else {
      list.innerHTML = pageRows.map((r) => {
        const icon = r.icon_url
          ? '<img class="sale-icon" src="' + esc(r.icon_url) + '" alt="" loading="lazy">'
          : '<span class="sale-icon-ph"></span>';
        const expiry = expiryLabel(r.first_seen);
        const ltd = _isLtd(r.item_name);
        const pct = discountPct(r);
        const pctHtml = pct == null || Math.round(pct) === 0 ? ''
          : ' <span class="discount-badge-inline" style="background:' + (pct > 0 ? discountColor(pct) : 'var(--red)') + '">' + (pct > 0 ? '-' : '+') + Math.round(Math.abs(pct)) + '%</span>';
        return '<button class="item-row" data-item="' + esc(r.item_name) + '" style="' + discountTileStyle(r) + '">'
          + icon
          + '<span class="sale-item">' + esc(r.item_name) + (ltd && r.count > 1 ? ' #' + r.count : '')
            + (r.count > 1 && !ltd ? ' <span class="item-row-custom">x' + r.count + '</span>' : '')
            + ' <span class="item-row-custom">#' + r.offer_id + '</span>'
            + pctHtml
            + '</span>'
          + (expiry ? '<span class="sale-time">' + esc(expiry) + '</span>' : '')
          + (_offersSort === 'traded' ? '<span class="sale-time">' + tradeCountFor(r.item_name).toLocaleString() + 'x verhandeld</span>' : '')
          + '<span class="sale-price">' + r.price.toLocaleString() + ' BC' + (r.avg_price != null ? ' <span class="item-value-unit">(gem. ' + r.avg_price.toLocaleString() + ')</span>' : '') + '</span>'
          + '</button>';
      }).join('');
    }
    renderPager('offers-pagination', _offersPage, totalPages, filtered.length, _offersPageSize, 'aanbiedingen');
  }

  // ── Sales feed tab — search/price/date/category still narrow the query server-side (this
  // table can grow large), but "Meest verhandeld"/"Meest verdachte sales" rank by data that
  // isn't a column on mp_sales at all (trade COUNT per item, and Items' own price-jump
  // volatility score — see loadPriceVolatility) — no way to ask PostgREST to order by that
  // directly, so those two sorts (and the pagination under them) work off a capped client-side
  // batch instead, same architecture as Offers/Geannuleerd. limit=20000 caps how deep this
  // reaches into history, same order of magnitude as loadLastTradedAt's own cap. ─────────────
  let _salesAll = [];
  let _salesPage = 0;
  let _salesPageSize = 100;
  let _salesQuery = '';
  let _salesPriceMin = null;
  let _salesPriceMax = null;
  let _salesDateFrom = ''; // raw <input type="date"> values — converted at query time via dateInputToIso
  let _salesDateTo = '';
  const _salesCategories = new Set(); // empty = no filter = show every category, same multi-select as Items
  let _salesView = loadViewPref('__mp_sales_view');
  let _salesSort = 'newest';

  // "Vorige scan" — the ruilwaarde proxy-scan service now tracks its own prevRunFinishedAt
  // (the successful run BEFORE its current lastRun, see ruilwaarde-proxy-scan/server.js) and
  // hands it straight to us, so "new" is a precise server-side boundary — everything sold
  // since the scan before the latest one — instead of something this browser had to remember
  // itself. Two earlier versions of this (per-page-visit, then a browser-remembered scan
  // timestamp) both drifted: the first reset on every reload, the second could stay pinned to
  // an arbitrarily old scan for hours since nothing ever advanced it except this exact browser
  // happening to reload. Reading prevRunFinishedAt fresh every load needs no localStorage at
  // all — it's correct by construction, not by remembering.
  let _salesPrevSessionAt = null;
  async function initSalesNewSinceScan() {
    try {
      const res = await fetch(SB_URL.replace('/rest/v1', '') + '/trigger-scan/status');
      const s = await res.json();
      _salesPrevSessionAt = s && s.prevRunFinishedAt ? new Date(s.prevRunFinishedAt) : null;
    } catch (_) { _salesPrevSessionAt = null; /* badge/underline just stay off */ }
  }
  let _newSalesSinceLastVisit = null;

  async function refreshNewSalesCount() {
    if (!_salesPrevSessionAt) return; // no scan history yet (or unreachable) — nothing to compare against
    try {
      const { total } = await sbGetWithCount('/mp_sales?select=offer_id&sold_at=gt.' + encodeURIComponent(_salesPrevSessionAt.toISOString()) + '&limit=1');
      _newSalesSinceLastVisit = total;
    } catch (e) { return; }
    const badge = document.getElementById('sales-new-badge');
    const text = document.getElementById('sales-new-text');
    if (!badge || !text) return;
    badge.hidden = !_newSalesSinceLastVisit;
    if (_newSalesSinceLastVisit) text.textContent = _newSalesSinceLastVisit.toLocaleString() + ' nieuwe sale' + (_newSalesSinceLastVisit === 1 ? '' : 's') + ' sinds vorige scan';
  }

  function renderSalesFilters() {
    const row = document.getElementById('sales-filter-row');
    row.innerHTML = '<button class="filter-chip' + (_salesCategories.size === 0 ? ' active' : '') + '" data-cat="ALL">Alle</button>'
      + CATEGORIES.map((c) =>
          '<button class="filter-chip' + (_salesCategories.has(c.slug) ? ' active' : '') + '" data-cat="' + esc(c.slug) + '">' + esc(c.label) + '</button>'
        ).join('');
  }

  function salesTotalPages() {
    return Math.max(1, Math.ceil(sortedSalesList().length / _salesPageSize));
  }

  // 'newest' needs no re-sort — _salesAll already arrives ordered sold_at.desc from
  // loadSalesFeed()'s own query. 'traded'/'volatile' rank by data that lives on the ITEM
  // (tradeCountFor/volatilityFor, same caches Items' own sorts use), not the individual sale
  // row, so multiple sales of the same item end up adjacent but keep their own relative
  // newest-first order within that group (stable sort).
  function sortedSalesList() {
    switch (_salesSort) {
      case 'oldest': return _salesAll.slice().reverse();
      case 'price-desc': return _salesAll.slice().sort((a, b) => b.price - a.price);
      case 'price-asc': return _salesAll.slice().sort((a, b) => a.price - b.price);
      case 'volatile': return _salesAll.slice().sort((a, b) => volatilityFor(b.item_name) - volatilityFor(a.item_name));
      default: return _salesAll;
    }
  }

  async function loadSalesFeed(silent) {
    const list = document.getElementById('sales-list');
    if (!silent) list.innerHTML = '<div class="loading">Laden...</div>';
    try {
      // mp_items(icon_url,category) is a FK-embed (mp_sales.item_name -> mp_items.name) —
      // one request gets both the item's thumbnail and its category, so the category chips
      // and the item search here can filter server-side instead of fetching everything and
      // discarding client-side. A filter on an embedded resource only restricts what's
      // *inside* that embed by default — it does NOT exclude the parent mp_sales row when
      // the embed doesn't match (confirmed live: the SS chip left every category showing,
      // Rares included). `!inner` is what actually turns it into a real filter on the
      // parent rows — only added when a category filter is active, so browsing with no
      // filter doesn't turn into an inner join that could hide a sale whose item_name has
      // no mp_items row yet.
      const embedJoin = _salesCategories.size > 0 ? 'mp_items!inner' : 'mp_items';
      // Ties on sold_at (same-minute sales, common since the source only has minute
      // precision) have no deterministic order from Postgres alone — a second key stops
      // them from silently swapping places between polls.
      let path = '/mp_sales?select=offer_id,item_name,price,currency,sold_at,' + embedJoin + '(icon_url,category)&order=sold_at.desc,offer_id.desc&limit=20000';
      if (_salesCategories.size === 1) {
        const label = CATEGORIES.find((c) => c.slug === Array.from(_salesCategories)[0]).label;
        path += '&mp_items.category=eq.' + encodeURIComponent(label);
      } else if (_salesCategories.size > 1) {
        const labels = Array.from(_salesCategories).map((slug) => CATEGORIES.find((c) => c.slug === slug).label);
        path += '&mp_items.category=in.(' + encodeURIComponent(labels.map((l) => '"' + l.replace(/"/g, '\\"') + '"').join(',')) + ')';
      }
      if (_salesQuery) path += '&item_name=ilike.*' + encodeURIComponent(_salesQuery) + '*';
      // Composes with the category/name filters above rather than replacing them — all
      // active filters narrow the same query together.
      if (_salesPriceMin != null) path += '&price=gte.' + _salesPriceMin;
      if (_salesPriceMax != null) path += '&price=lte.' + _salesPriceMax;
      const fromIso = dateInputToIso(_salesDateFrom, false);
      const toIso = dateInputToIso(_salesDateTo, true);
      if (fromIso) path += '&sold_at=gte.' + encodeURIComponent(fromIso);
      if (toIso) path += '&sold_at=lte.' + encodeURIComponent(toIso);
      _salesAll = await sbGet(path);
      renderSalesFeed();
    } catch (e) {
      if (!silent) list.innerHTML = '<div class="error-msg">Fout bij laden: ' + esc(e.message) + '</div>';
    }
  }

  function renderSalesFeed() {
    const sorted = sortedSalesList();
    const totalPages = salesTotalPages();
    if (_salesPage >= totalPages) _salesPage = totalPages - 1;
    if (_salesPage < 0) _salesPage = 0;
    const rows = sorted.slice(_salesPage * _salesPageSize, _salesPage * _salesPageSize + _salesPageSize);

    const list = document.getElementById('sales-list');
    list.className = _salesView === 'tile' ? 'cat-grid' : 'tbl-wrap';
    if (!rows.length) {
      const emptyMsg = _salesCategories.size === 0 && !_salesQuery ? 'Nog geen sales geregistreerd — zet de Scanner aan in-game.' : 'Geen sales gevonden.';
      list.innerHTML = '<div class="loading"' + (_salesView === 'tile' ? ' style="grid-column:1/-1"' : '') + '>' + (_salesAll.length ? 'Geen resultaten.' : emptyMsg) + '</div>';
    } else if (_salesView === 'tile') {
      list.innerHTML = rows.map((r) => {
        const icon = r.mp_items && r.mp_items.icon_url
          ? '<img src="' + esc(r.mp_items.icon_url) + '" alt="" loading="lazy">'
          : '<span class="cat-thumb-ph">' + esc((r.item_name || '?').slice(0, 1).toUpperCase()) + '</span>';
        const isNew = _salesPrevSessionAt && new Date(r.sold_at) > _salesPrevSessionAt;
        return '<button class="cat-card' + (isNew ? ' new-sale' : '') + '" data-item="' + esc(r.item_name) + '" style="position:relative;text-align:left">'
          + '<div class="sale-tile-price">' + r.price.toLocaleString() + ' ' + esc(currencyLabel(r.currency)) + '</div>'
          + vsAvgBadgeHtml(r.item_name, r.price, 'vsavg-badge')
          + '<div class="cat-thumb">' + icon + '</div>'
          + '<div class="cat-name">' + esc(r.item_name) + '</div>'
          + '<div class="sale-tile-time">' + esc(fullTime(r.sold_at)) + '</div>'
          + '<div class="sale-tile-offerid">#' + r.offer_id + '</div>'
          + '</button>';
      }).join('');
    } else {
      // Rows arrive newest-first when sorted 'newest', so "new since previous scan" ones are
      // then always a contiguous block at the top — a red line under every one of them was
      // noisy and read as N separate flags instead of one cutoff. Only the LAST new row (the
      // one right above where the old ones start) gets the divider then, marking where "new"
      // ends instead of marking every new row individually. Any other sort scatters "new"
      // rows around instead of keeping them contiguous, so this same boundary-line trick
      // would land in the wrong place — falls back to flagging every new row individually.
      const isNewRow = (r) => !!(_salesPrevSessionAt && new Date(r.sold_at) > _salesPrevSessionAt);
      const contiguous = _salesSort === 'newest' || _salesSort === 'oldest';
      list.innerHTML = rows.map((r, i) => {
        const icon = r.mp_items && r.mp_items.icon_url
          ? '<img class="sale-icon" src="' + esc(r.mp_items.icon_url) + '" alt="" loading="lazy">'
          : '<span class="sale-icon-ph"></span>';
        const isNew = isNewRow(r) && (!contiguous || !(i + 1 < rows.length && isNewRow(rows[i + 1])));
        return '<button class="sale-row' + (isNew ? ' new' : '') + '" data-item="' + esc(r.item_name) + '">'
          + icon
          + '<span class="sale-time">' + esc(fullTime(r.sold_at)) + '<span class="sale-offerid">#' + r.offer_id + '</span></span>'
          + '<span class="sale-item">' + esc(r.item_name) + '</span>'
          + '<span class="sale-price">' + r.price.toLocaleString() + ' ' + esc(currencyLabel(r.currency)) + vsAvgBadgeHtml(r.item_name, r.price, 'vsavg-inline') + '</span>'
          + '</button>';
      }).join('');
    }
    renderPager('sales-pagination', _salesPage, totalPages, sorted.length, _salesPageSize, 'sales');
  }

  // New sales show up here without a manual reload, same as Items — only actually
  // re-renders while looking at the newest page (page 0); refreshing underneath someone
  // paged deeper into the history would shift rows out from under them mid-read.
  function startLiveSalesRefresh() {
    setInterval(() => {
      if (_salesPage === 0) loadSalesFeed(true);
      refreshNewSalesCount();
    }, 10000);
  }

  // ── Geannuleerd tab (mp_cancelled_offers — logged server-side by ruilwaarde-proxy-scan
  // once a watched offer's full 48h marketplace lifetime has passed without a matching sale,
  // see server.js's sweepOfferWatch) ──────────────────────────────────────────────────────
  // Client-side full-load + filter/sort/paginate, same architecture as the Offers tab —
  // mp_cancelled_offers.item_name has NO foreign key to mp_items (dropped on purpose: a
  // still-unscanned item's name would otherwise make the insert silently fail against a real
  // FK, confirmed live as the actual cause of entries just never showing up), so there's no
  // FK for PostgREST to embed/join on server-side. Categories are cross-referenced against
  // the already-loaded Items list instead, exactly like Offers' own _offerCategory() does.
  let _cancelledAll = [];
  let _cancelledPage = 0;
  let _cancelledPageSize = 100;
  let _cancelledQuery = '';
  let _cancelledPriceMin = null;
  let _cancelledPriceMax = null;
  let _cancelledDateFrom = '';
  let _cancelledDateTo = '';
  let _cancelledView = loadViewPref('__mp_cancelled_view');
  let _cancelledSort = 'newest';
  const _cancelledCategories = new Set(); // empty = no filter, same multi-select as Items/Sales/Offers

  function renderCancelledFilters() {
    const row = document.getElementById('cancelled-filter-row');
    row.innerHTML = '<button class="filter-chip' + (_cancelledCategories.size === 0 ? ' active' : '') + '" data-cat="ALL">Alle</button>'
      + CATEGORIES.map((c) =>
          '<button class="filter-chip' + (_cancelledCategories.has(c.slug) ? ' active' : '') + '" data-cat="' + esc(c.slug) + '">' + esc(c.label) + '</button>'
        ).join('');
  }

  function cancelledTotalPages() {
    return Math.max(1, Math.ceil(filteredCancelledList().length / _cancelledPageSize));
  }

  function filteredCancelledList() {
    let filtered = _cancelledAll;
    if (_cancelledCategories.size > 0) {
      const activeLabels = new Set(Array.from(_cancelledCategories).map((slug) => CATEGORIES.find((c) => c.slug === slug).label));
      filtered = filtered.filter((r) => activeLabels.has(_offerCategory(r.item_name)));
    }
    if (_cancelledQuery) {
      const q = _cancelledQuery.toLowerCase();
      filtered = filtered.filter((r) => r.item_name.toLowerCase().includes(q));
    }
    if (_cancelledPriceMin != null) filtered = filtered.filter((r) => r.price >= _cancelledPriceMin);
    if (_cancelledPriceMax != null) filtered = filtered.filter((r) => r.price <= _cancelledPriceMax);
    const fromIso = dateInputToIso(_cancelledDateFrom, false);
    const toIso = dateInputToIso(_cancelledDateTo, true);
    if (fromIso) filtered = filtered.filter((r) => r.cancelled_at >= fromIso);
    if (toIso) filtered = filtered.filter((r) => r.cancelled_at <= toIso);
    return sortCancelledList(filtered);
  }

  // How often an item (by name) shows up across EVERY cancelled offer, not just the
  // currently-filtered list — "meest/minst geannuleerd" ranks the furniture itself, so the
  // count has to stay stable while the user filters/searches, not shrink along with the view.
  function _cancelFreqFor(itemName) {
    if (!_cancelFreqCache || _cancelFreqCache.source !== _cancelledAll) {
      const map = new Map();
      _cancelledAll.forEach((r) => map.set(r.item_name, (map.get(r.item_name) || 0) + 1));
      _cancelFreqCache = { source: _cancelledAll, map };
    }
    return _cancelFreqCache.map.get(itemName) || 0;
  }
  let _cancelFreqCache = null;

  // 'newest' needs no re-sort — _cancelledAll already arrives ordered cancelled_at.desc from
  // loadCancelledFeed()'s own query, and filtering preserves that order.
  function sortCancelledList(list) {
    switch (_cancelledSort) {
      case 'oldest': return list.slice().sort((a, b) => (a.cancelled_at < b.cancelled_at ? -1 : a.cancelled_at > b.cancelled_at ? 1 : 0));
      case 'price-desc': return list.slice().sort((a, b) => b.price - a.price);
      case 'price-asc': return list.slice().sort((a, b) => a.price - b.price);
      case 'cancel-desc': return list.slice().sort((a, b) => _cancelFreqFor(b.item_name) - _cancelFreqFor(a.item_name));
      case 'cancel-asc': return list.slice().sort((a, b) => _cancelFreqFor(a.item_name) - _cancelFreqFor(b.item_name));
      default: return list;
    }
  }

  async function loadCancelledFeed(silent) {
    const list = document.getElementById('cancelled-list');
    if (!silent) list.innerHTML = '<div class="loading">Laden...</div>';
    try {
      const rows = await sbGet('/mp_cancelled_offers?select=offer_id,item_name,icon_url,price,count,first_seen,cancelled_at&order=cancelled_at.desc&limit=5000');
      _cancelledAll = rows;
      renderCancelledFeed();
    } catch (e) {
      if (!silent) list.innerHTML = '<div class="error-msg">Fout bij laden: ' + esc(e.message) + '</div>';
    }
  }

  function renderCancelledFeed() {
    const filtered = filteredCancelledList();
    const totalPages = cancelledTotalPages();
    if (_cancelledPage >= totalPages) _cancelledPage = totalPages - 1;
    if (_cancelledPage < 0) _cancelledPage = 0;
    const pageRows = filtered.slice(_cancelledPage * _cancelledPageSize, _cancelledPage * _cancelledPageSize + _cancelledPageSize);

    const list = document.getElementById('cancelled-list');
    list.className = _cancelledView === 'tile' ? 'cat-grid' : 'tbl-wrap';
    if (!pageRows.length) {
      list.innerHTML = '<div class="loading"' + (_cancelledView === 'tile' ? ' style="grid-column:1/-1"' : '') + '>' + (_cancelledAll.length ? 'Geen resultaten.' : 'Nog niks geannuleerd geregistreerd.') + '</div>';
    } else if (_cancelledView === 'tile') {
      list.innerHTML = pageRows.map((r) => {
        const icon = r.icon_url
          ? '<img src="' + esc(r.icon_url) + '" alt="" loading="lazy">'
          : '<span class="cat-thumb-ph">' + esc((r.item_name || '?').slice(0, 1).toUpperCase()) + '</span>';
        return '<button class="cat-card" data-item="' + esc(r.item_name) + '" style="position:relative;text-align:left">'
          + '<div class="sale-tile-price">' + r.price.toLocaleString() + ' BC</div>'
          + vsAvgBadgeHtml(r.item_name, r.price, 'vsavg-badge')
          + '<div class="cat-thumb">' + icon + '</div>'
          + '<div class="cat-name">' + esc(r.item_name) + '</div>'
          + '<div class="sale-tile-time">' + esc(fullTime(r.cancelled_at)) + '</div>'
          + '</button>';
      }).join('');
    } else {
      list.innerHTML = pageRows.map((r) => {
        const icon = r.icon_url
          ? '<img class="sale-icon" src="' + esc(r.icon_url) + '" alt="" loading="lazy">'
          : '<span class="sale-icon-ph"></span>';
        return '<button class="sale-row" data-item="' + esc(r.item_name) + '">'
          + icon
          + '<span class="sale-time">' + esc(fullTime(r.cancelled_at)) + '</span>'
          + '<span class="sale-item">' + esc(r.item_name) + '</span>'
          + '<span class="sale-price">' + r.price.toLocaleString() + ' BC' + vsAvgBadgeHtml(r.item_name, r.price, 'vsavg-inline') + '</span>'
          + '</button>';
      }).join('');
    }
    renderPager('cancelled-pagination', _cancelledPage, totalPages, filtered.length, _cancelledPageSize, 'geannuleerd');
  }

  function startLiveCancelledRefresh() {
    setInterval(() => loadCancelledFeed(true), 15000);
  }

  // ── Tabs / wiring ──────────────────────────────────────────────────────────────────
  function setTab(tab) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.dataset.page === tab));
    // Sidebar status blocks are only relevant to the data they track — Marktplaats Logger
    // (live offers) on Offers, the ruilwaarde proxy-scan on Sales Feed/Items.
    document.getElementById('offers-logger-card').hidden = tab !== 'offers';
    document.querySelector('.proxy-scan-mount').hidden = tab === 'offers';
  }

  function setupEvents() {
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setTab(t.dataset.tab)));

    document.getElementById('items-search').addEventListener('input', (e) => {
      _itemsQuery = e.target.value;
      _itemsPage = 0;
      renderItems();
    });
    document.getElementById('items-filter-row').addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-chip');
      if (!btn) return;
      if (btn.dataset.cat === 'ALL') _itemsCategories.clear();
      else if (_itemsCategories.has(btn.dataset.cat)) _itemsCategories.delete(btn.dataset.cat);
      else _itemsCategories.add(btn.dataset.cat);
      _itemsPage = 0;
      renderItemsFilters();
      renderItems();
    });
    document.getElementById('items-grid').addEventListener('click', (e) => {
      const card = e.target.closest('[data-item]');
      if (card) openItemDetail(card.dataset.item);
    });
    wirePager('items-pagination', itemsTotalPages,
      () => _itemsPage, (p) => { _itemsPage = p; },
      () => _itemsPageSize, (s) => { _itemsPageSize = s; },
      renderItems);
    document.getElementById('items-view-toggle').addEventListener('click', (e) => {
      const btn = e.target.closest('.view-toggle-btn');
      if (!btn || btn.dataset.view === _itemsView) return;
      _itemsView = btn.dataset.view;
      saveViewPref('__mp_items_view', _itemsView);
      renderViewToggle('items-view-toggle', _itemsView);
      renderItems();
    });
    _wireSortControls('items-sort', 'items-trade-range',
      (v) => { _itemsSort = v; }, () => _itemsSort,
      (v) => { _itemsTradeRangeDays = v; }, () => _itemsTradeRangeDays,
      renderItems);

    document.getElementById('offers-list').addEventListener('click', (e) => {
      const card = e.target.closest('[data-item]');
      if (card) openItemDetail(card.dataset.item);
    });
    document.getElementById('sales-list').addEventListener('click', (e) => {
      const card = e.target.closest('[data-item]');
      if (card) openItemDetail(card.dataset.item);
    });
    // Delegated on document — .proxy-scan-mount's innerHTML gets replaced on every status
    // poll (and there are two of them, Items + Sales Feed), so a direct per-button listener
    // would be destroyed/duplicated.
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('proxy-scan-btn')) triggerProxyScan();
    });
    document.getElementById('offers-filter-row').addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-chip');
      if (!btn) return;
      if (btn.dataset.cat === 'ALL') _offersCategories.clear();
      else if (_offersCategories.has(btn.dataset.cat)) _offersCategories.delete(btn.dataset.cat);
      else _offersCategories.add(btn.dataset.cat);
      _offersPage = 0;
      renderOffersFilters();
      renderOffers();
    });
    document.getElementById('offers-search').addEventListener('input', (e) => {
      _offersQuery = e.target.value;
      _offersPage = 0;
      renderOffers();
    });
    wirePager('offers-pagination', offersTotalPages,
      () => _offersPage, (p) => { _offersPage = p; },
      () => _offersPageSize, (s) => { _offersPageSize = s; },
      renderOffers);
    document.getElementById('offers-view-toggle').addEventListener('click', (e) => {
      const btn = e.target.closest('.view-toggle-btn');
      if (!btn || btn.dataset.view === _offersView) return;
      _offersView = btn.dataset.view;
      saveViewPref('__mp_offers_view', _offersView);
      renderViewToggle('offers-view-toggle', _offersView);
      renderOffers();
    });
    _wireSortControls('offers-sort', 'offers-trade-range',
      (v) => { _offersSort = v; }, () => _offersSort,
      (v) => { _offersTradeRangeDays = v; }, () => _offersTradeRangeDays,
      renderOffers);
    const discountFilterEl = document.getElementById('offers-discount-filter');
    const discountCustomEl = document.getElementById('offers-discount-custom');
    discountFilterEl.addEventListener('change', () => {
      discountCustomEl.hidden = discountFilterEl.value !== 'custom';
      if (discountFilterEl.value === 'custom') {
        _offersMinDiscount = parseInt(discountCustomEl.value, 10) || 0;
        discountCustomEl.focus();
      } else {
        _offersMinDiscount = parseInt(discountFilterEl.value, 10) || 0;
      }
      _offersPage = 0;
      renderOffers();
    });
    discountCustomEl.addEventListener('input', () => {
      _offersMinDiscount = Math.max(0, Math.min(100, parseInt(discountCustomEl.value, 10) || 0));
      _offersPage = 0;
      renderOffers();
    });

    const basisEl = document.getElementById('offers-discount-basis');
    const basisCustomEl = document.getElementById('offers-discount-basis-custom');
    function _applyDiscountBasis(days) {
      _offersDiscountBasisDays = days;
      loadDiscountAvgPrices(days).then(renderOffers);
    }
    basisEl.addEventListener('change', () => {
      basisCustomEl.hidden = basisEl.value !== 'custom';
      if (basisEl.value === 'custom') {
        basisCustomEl.focus();
        _applyDiscountBasis(Math.max(1, parseInt(basisCustomEl.value, 10) || 30));
      } else {
        _applyDiscountBasis(parseInt(basisEl.value, 10));
      }
    });
    basisCustomEl.addEventListener('change', () => {
      _applyDiscountBasis(Math.max(1, parseInt(basisCustomEl.value, 10) || 30));
    });

    document.getElementById('sales-filter-row').addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-chip');
      if (!btn) return;
      if (btn.dataset.cat === 'ALL') _salesCategories.clear();
      else if (_salesCategories.has(btn.dataset.cat)) _salesCategories.delete(btn.dataset.cat);
      else _salesCategories.add(btn.dataset.cat);
      _salesPage = 0;
      renderSalesFilters();
      loadSalesFeed();
    });
    let _salesSearchDebounce = null;
    document.getElementById('sales-search').addEventListener('input', (e) => {
      _salesQuery = e.target.value;
      clearTimeout(_salesSearchDebounce);
      // Debounced — this hits the DB on every change (unlike Items' search, which filters
      // an already-fetched in-memory list), so typing shouldn't fire a request per keystroke.
      _salesSearchDebounce = setTimeout(() => { _salesPage = 0; loadSalesFeed(); }, 300);
    });
    let _salesPriceDebounce = null;
    function _wirePriceInput(id, setter) {
      document.getElementById(id).addEventListener('input', (e) => {
        const v = e.target.value.trim();
        setter(v === '' ? null : Math.max(0, parseInt(v, 10) || 0));
        clearTimeout(_salesPriceDebounce);
        _salesPriceDebounce = setTimeout(() => { _salesPage = 0; loadSalesFeed(); }, 300);
      });
    }
    _wirePriceInput('sales-price-min', (v) => { _salesPriceMin = v; });
    _wirePriceInput('sales-price-max', (v) => { _salesPriceMax = v; });
    document.getElementById('sales-date-from').addEventListener('change', (e) => { _salesDateFrom = e.target.value; _salesPage = 0; loadSalesFeed(); });
    document.getElementById('sales-date-to').addEventListener('change', (e) => { _salesDateTo = e.target.value; _salesPage = 0; loadSalesFeed(); });
    document.getElementById('sales-sort').addEventListener('change', (e) => {
      _salesSort = e.target.value;
      _salesPage = 0;
      renderSalesFeed(); // sort is purely client-side (see sortedSalesList) — no need to refetch
    });
    wirePager('sales-pagination', salesTotalPages,
      () => _salesPage, (p) => { _salesPage = p; },
      () => _salesPageSize, (s) => { _salesPageSize = s; },
      renderSalesFeed);
    document.getElementById('sales-view-toggle').addEventListener('click', (e) => {
      const btn = e.target.closest('.view-toggle-btn');
      if (!btn || btn.dataset.view === _salesView) return;
      _salesView = btn.dataset.view;
      saveViewPref('__mp_sales_view', _salesView);
      renderViewToggle('sales-view-toggle', _salesView);
      renderSalesFeed();
    });

    let _cancelledSearchDebounce = null;
    document.getElementById('cancelled-search').addEventListener('input', (e) => {
      _cancelledQuery = e.target.value;
      clearTimeout(_cancelledSearchDebounce);
      _cancelledSearchDebounce = setTimeout(() => { _cancelledPage = 0; renderCancelledFeed(); }, 300);
    });
    let _cancelledPriceDebounce = null;
    function _wireCancelledPriceInput(id, setter) {
      document.getElementById(id).addEventListener('input', (e) => {
        const v = e.target.value.trim();
        setter(v === '' ? null : Math.max(0, parseInt(v, 10) || 0));
        clearTimeout(_cancelledPriceDebounce);
        _cancelledPriceDebounce = setTimeout(() => { _cancelledPage = 0; renderCancelledFeed(); }, 300);
      });
    }
    _wireCancelledPriceInput('cancelled-price-min', (v) => { _cancelledPriceMin = v; });
    _wireCancelledPriceInput('cancelled-price-max', (v) => { _cancelledPriceMax = v; });
    document.getElementById('cancelled-date-from').addEventListener('change', (e) => { _cancelledDateFrom = e.target.value; _cancelledPage = 0; renderCancelledFeed(); });
    document.getElementById('cancelled-date-to').addEventListener('change', (e) => { _cancelledDateTo = e.target.value; _cancelledPage = 0; renderCancelledFeed(); });
    document.getElementById('cancelled-sort').addEventListener('change', (e) => {
      _cancelledSort = e.target.value;
      _cancelledPage = 0;
      renderCancelledFeed();
    });
    document.getElementById('cancelled-filter-row').addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-chip');
      if (!btn) return;
      if (btn.dataset.cat === 'ALL') _cancelledCategories.clear();
      else if (_cancelledCategories.has(btn.dataset.cat)) _cancelledCategories.delete(btn.dataset.cat);
      else _cancelledCategories.add(btn.dataset.cat);
      _cancelledPage = 0;
      renderCancelledFilters();
      renderCancelledFeed();
    });
    wirePager('cancelled-pagination', cancelledTotalPages,
      () => _cancelledPage, (p) => { _cancelledPage = p; },
      () => _cancelledPageSize, (s) => { _cancelledPageSize = s; },
      renderCancelledFeed);
    document.getElementById('cancelled-view-toggle').addEventListener('click', (e) => {
      const btn = e.target.closest('.view-toggle-btn');
      if (!btn || btn.dataset.view === _cancelledView) return;
      _cancelledView = btn.dataset.view;
      saveViewPref('__mp_cancelled_view', _cancelledView);
      renderViewToggle('cancelled-view-toggle', _cancelledView);
      renderCancelledFeed();
    });
    document.getElementById('cancelled-list').addEventListener('click', (e) => {
      const card = e.target.closest('[data-item]');
      if (card) openItemDetail(card.dataset.item);
    });

    document.getElementById('modal-close-btn').addEventListener('click', () => document.getElementById('modal-overlay').classList.remove('open'));
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') document.getElementById('modal-overlay').classList.remove('open');
    });
    // Delegated on modal-body (not the toggle itself) since openItemDetail() replaces the
    // whole body's innerHTML fresh on every open — a direct listener would be destroyed
    // along with the old buttons each time.
    document.getElementById('modal-body').addEventListener('click', (e) => {
      const winBtn = e.target.closest('[data-window]');
      if (winBtn) { _renderDetailWindow(winBtn.dataset.window); return; }
      const listTabBtn = e.target.closest('[data-list-tab]');
      if (listTabBtn) { _detailListTab = listTabBtn.dataset.listTab; _renderDetailListTabs(); _renderActiveDetailList(); return; }
      const flagBtn = e.target.closest('.detail-sale-flag');
      if (flagBtn) toggleManualSuspicious(parseInt(flagBtn.dataset.offerId, 10), flagBtn.dataset.manual === 'true');
      if (e.target.id === 'detail-hide-suspicious-chk') {
        _detailHideSuspicious = !_detailHideSuspicious;
        _renderDetailWindow(_detailWindow); // re-render just the chart/stats at the current window with the filter applied
      }
    });
  }

  // Flips manual_suspicious for one sale (true <-> null) and reloads the whole detail
  // modal so the toggle, the stats tiles, the chart and the clean/raw averages all pick up
  // the change together — cheaper to just refetch than to hand-patch every derived value.
  // Updates the already-loaded _detailData in place and re-renders from it — no refetch,
  // so the toggle is instant instead of reloading the whole modal (which flashed a loading
  // state and reset scroll every click). The PATCH still goes out, just not awaited before
  // re-rendering — worst case a failed save silently reverts on the next real reload.
  function toggleManualSuspicious(offerId, currentlyManual) {
    if (!_detailData) return;
    const sale = _detailData.sales.find((s) => s.offer_id === offerId);
    if (!sale) return;
    const newVal = currentlyManual ? null : true;
    sale.manual_suspicious = newVal; // ascending holds the same object references, so it updates too

    fetch(SB_URL + '/mp_sales?offer_id=eq.' + offerId, {
      method: 'PATCH',
      headers: Object.assign({}, HEADERS, { Prefer: 'return=minimal' }),
      body: JSON.stringify({ manual_suspicious: newVal }),
    }).catch(() => {});

    _renderSalesList();
    _renderDetailWindow(_detailWindow);
  }

  setupEvents();
  renderSalesFilters();
  renderOffersFilters();
  renderCancelledFilters();
  renderViewToggle('items-view-toggle', _itemsView);
  renderViewToggle('sales-view-toggle', _salesView);
  renderViewToggle('offers-view-toggle', _offersView);
  renderViewToggle('cancelled-view-toggle', _cancelledView);
  loadItems();
  startLiveItemsRefresh();
  loadLastTradedAt();
  setInterval(loadLastTradedAt, 30000);
  loadPriceVolatility();
  setInterval(loadPriceVolatility, 30000);
  initSalesNewSinceScan().then(() => { loadSalesFeed(); refreshNewSalesCount(); });
  startLiveSalesRefresh();
  loadCancelledFeed();
  startLiveCancelledRefresh();
  loadOffers();
  startLiveOffersRefresh();
  loadDiscountAvgPrices(0);
  startLiveDiscountAvgRefresh();
  pollProxyScanStatus();
  startLiveProxyScanStatusRefresh();

  // Fire-and-forget — lets the CPU/DB history panel on hub.databin.uk line spikes up
  // against actual site visits instead of showing an unexplained number.
  fetch(SB_URL + '/event_log', { method: 'POST', headers: HEADERS, body: JSON.stringify({ event: 'visit', detail: 'marktplaats' }) }).catch(() => {});
})();
