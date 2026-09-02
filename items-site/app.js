(function () {
  // Same self-hosted Postgres + PostgREST as the other databin.uk sites — see
  // core/supabase.js for the full setup. Same-origin under Caddy (proxied to /rest/v1)
  // for this site's own item_overview table, and cross-origin to furnis.databin.uk (its
  // PostgREST already sends Access-Control-Allow-Origin: *) to look up type IDs against
  // the crowdsourced furni_master table.
  const SB_URL = '/rest/v1';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6ImdoZWxvby1zZWxmaG9zdCIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwfQ.9uAMhqRJOL-m_xtTO5duAUOAw-4pKk4LEENcT47crXU';
  const FURNIS_URL = 'https://furnis.databin.uk/rest/v1';

  const HEADERS = {
    apikey: SB_KEY,
    Authorization: 'Bearer ' + SB_KEY,
    'Content-Type': 'application/json',
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // Pasted/uploaded text is often not pure JSON — a browser's "⇩ Download foo.json (338
  // items)" notification line frequently ends up copied along with the actual array when
  // grabbing console output. Rather than choke on that, just start parsing at the first
  // '[' or '{' — whatever came before it (banners, log lines, comments) is irrelevant to
  // the actual data and safely discarded.
  function parseLooseJson(text) {
    const start = text.search(/[[{]/);
    return JSON.parse(start === -1 ? text : text.slice(start));
  }

  // Catalog names carry their category as a trailing "(XXX)" tag — e.g. "Bubbelbad
  // (Club Cadeau)", "Hippo der Anubis (LTD)". furni_master.name (see room-clone.js's
  // _pushMasterFurniData) stores the SAME full string including that tag — confirmed
  // live against the real table (2026-08-28) — so matching is a plain exact/indexed
  // lookup on the full scraped name, no stripping needed. The tag is only pulled back
  // out here for display as its own column.
  function extractCategory(name) {
    const m = /\(([^()]+)\)\s*$/.exec(name);
    return m ? m[1] : null;
  }

  // ── Saved items browser — everything currently in item_overview, paginated like the
  // user-database page (50/page) so this doesn't choke rendering once there are
  // thousands of rows.
  const SAVED_PAGE_SIZE = 50;
  let _saved = [];
  let _savedPage = 0;
  let _savedQuery = '';
  let _iconByName = new Map();

  async function loadSaved() {
    try {
      const res = await fetch(SB_URL + '/item_overview?select=name,category,icon,type_id&order=name.asc', { headers: HEADERS });
      if (!res.ok) return;
      _saved = await res.json();
      _iconByName = new Map(_saved.map((r) => [r.name, r.icon]));
      renderSaved();
      if (_inv.length) renderInventory(); // icons may have arrived after an earlier inventory render
    } catch (e) { /* leave whatever was already shown */ }
  }

  // ── Generic PostgREST fetch-all — loops on Range/limit+offset so a table growing past
  // the default page-size cap never silently truncates what Inventory/Users render.
  async function fetchAll(path) {
    const rows = [];
    const pageSize = 1000;
    let offset = 0;
    for (;;) {
      const sep = path.indexOf('?') === -1 ? '?' : '&';
      const res = await fetch(SB_URL + path + sep + 'limit=' + pageSize + '&offset=' + offset, { headers: HEADERS });
      if (!res.ok) break;
      const batch = await res.json();
      rows.push.apply(rows, batch);
      if (batch.length < pageSize) break;
      offset += pageSize;
    }
    return rows;
  }

  function filteredSaved() {
    const q = _savedQuery.trim().toLowerCase();
    if (!q) return _saved;
    return _saved.filter((r) => (r.name || '').toLowerCase().includes(q));
  }

  function renderSaved() {
    const body = document.getElementById('saved-body');
    const countEl = document.getElementById('saved-count');
    const list = filteredSaved();
    const totalPages = Math.max(1, Math.ceil(list.length / SAVED_PAGE_SIZE));
    if (_savedPage >= totalPages) _savedPage = totalPages - 1;
    if (_savedPage < 0) _savedPage = 0;
    const pageRows = list.slice(_savedPage * SAVED_PAGE_SIZE, _savedPage * SAVED_PAGE_SIZE + SAVED_PAGE_SIZE);

    countEl.textContent = list.length + ' item(s)' + (list.length !== _saved.length ? ' van ' + _saved.length : '') + '.';
    body.innerHTML = pageRows.length ? pageRows.map((r) => (
      '<tr style="cursor:pointer" data-action="edit-saved" data-name="' + esc(r.name) + '">'
      + '<td class="icon-cell">' + (r.icon ? '<img src="' + esc(r.icon) + '" loading="lazy" onerror="this.style.opacity=\'.15\'">' : '') + '</td>'
      + '<td>' + esc(r.name) + '</td>'
      + '<td>' + esc(r.category || '—') + '</td>'
      + '<td>' + (r.type_id != null ? r.type_id : '—') + '</td>'
      + '</tr>'
    )).join('') : '<tr><td colspan="4" style="color:var(--muted);text-align:center;padding:20px">Nog geen items opgeslagen.</td></tr>';

    renderSavedPagination(totalPages);
  }

  function renderSavedPagination(totalPages) {
    const el = document.getElementById('saved-pagination');
    if (filteredSaved().length <= SAVED_PAGE_SIZE) { el.innerHTML = ''; return; }
    const atStart = _savedPage <= 0, atEnd = _savedPage >= totalPages - 1;
    el.innerHTML =
      '<button class="btn btn-outline" id="saved-prev"' + (atStart ? ' disabled' : '') + '>&laquo; Vorige</button>'
      + '<span class="page-info">Pagina ' + (_savedPage + 1) + ' / ' + totalPages + '</span>'
      + '<button class="btn btn-outline" id="saved-next"' + (atEnd ? ' disabled' : '') + '>Volgende &raquo;</button>';
  }

  // ── Inventory / Users ────────────────────────────────────────────────────────
  // inventory_items rows are keyed by item_id (globally unique per furni instance in-game,
  // per the Room Deleter scan) — a re-import just updates room/owner/last_seen in place.
  let _inv = [];
  let _invQuery = '';
  let _invFilters = new Set(); // empty = "Alle" (no category filter active)
  const INV_PAGE_SIZE_OPTIONS = [50, 100, 200];
  const INV_PAGE_SIZE_KEY = 'gheloo_items_inv_page_size';
  let _invPageSize = INV_PAGE_SIZE_OPTIONS.includes(parseInt(localStorage.getItem(INV_PAGE_SIZE_KEY), 10))
    ? parseInt(localStorage.getItem(INV_PAGE_SIZE_KEY), 10) : 50;
  let _invPage = 0;
  let _userQuery = '';

  // Same category set as the Ruilwaarde scan checkboxes in Settings, matched against each
  // row's `tag` field (as captured by Room Deleter's rare-item scan — "LTD", "Rare", "SS",
  // "Club Cadeau" — or whatever a compatible import carries).
  const INV_FILTER_LABELS = { ALL: 'Alle', CURRENCY: 'Currency', CC: 'Club Cadeau', RARE: 'Rares', LTD: 'LTD', SS: 'SS', POKEMON: 'Pokémon', ECOTRON: 'Ecotron', BC: 'BC Shop' };
  const INV_FILTER_MATCH = {
    CC: function (tag) { return /^club cadeau$/i.test(tag || ''); },
    RARE: function (tag) { return /^rares?$/i.test(tag || ''); },
    LTD: function (tag) { return /^ltd$/i.test(tag || ''); },
    SS: function (tag) { return /^ss$/i.test(tag || ''); },
    BC: function (tag) { return /^bc shop$/i.test(tag || ''); },
    POKEMON: function (tag) { return /pok[eé]mon/i.test(tag || ''); },
    ECOTRON: function (tag) { return /^ecotron$/i.test(tag || ''); },
    CURRENCY: function (tag) { return /^currency$/i.test(tag || ''); },
  };
  let _usersPage = 0;
  const USERS_PAGE_SIZE = 50;

  // Bel-Credits/Diamanten furni names always start with the stack's face value
  // ("25 Bel-Credits Staaf (BC)", "750 Diamanten Schedel") — read it straight off the name.
  function parseCurrencyValue(name) {
    if (!name) return null;
    let m = /^(\d+)\s*Bel-Credits/i.exec(name);
    if (m) return { type: 'bc', value: parseInt(m[1], 10) };
    m = /^(\d+)\s*Diamanten/i.exec(name);
    if (m) return { type: 'diamond', value: parseInt(m[1], 10) };
    return null;
  }

  async function loadInventory() {
    try {
      _inv = await fetchAll('/inventory_items?select=item_id,room_id,room_name,owner_username,type_id,item_name,tag,edition_number,is_wall,last_seen');
    } catch (e) { _inv = []; }
    renderInventory();
    renderUsers();
  }

  function groupByType(rows) {
    const groups = new Map();
    rows.forEach((r) => {
      const key = r.item_name + '|' + (r.is_wall ? 1 : 0);
      if (!groups.has(key)) groups.set(key, { key: key, name: r.item_name, typeId: r.type_id, tag: r.tag, rows: [] });
      groups.get(key).rows.push(r);
    });
    return groups;
  }

  function renderInventoryFilterRow() {
    const el = document.getElementById('inv-filter-row');
    const q = _invQuery.trim().toLowerCase();
    const searchRows = q ? _inv.filter((r) => (r.item_name || '').toLowerCase().includes(q)) : _inv;
    el.innerHTML = Object.keys(INV_FILTER_LABELS).map((f) => {
      const count = f === 'ALL' ? searchRows.length : searchRows.filter((r) => INV_FILTER_MATCH[f](r.tag)).length;
      const active = f === 'ALL' ? _invFilters.size === 0 : _invFilters.has(f);
      return '<button class="filter-chip' + (active ? ' active' : '') + '" data-filter="' + f + '">'
        + esc(INV_FILTER_LABELS[f]) + ' <span style="opacity:.65">' + count.toLocaleString('nl-BE') + '</span></button>';
    }).join('');
  }

  function renderInventory() {
    const grid = document.getElementById('inv-grid');
    const subEl = document.getElementById('inv-sub');
    renderInventoryFilterRow();
    const q = _invQuery.trim().toLowerCase();
    let rows = q ? _inv.filter((r) => (r.item_name || '').toLowerCase().includes(q)) : _inv;
    if (_invFilters.size) rows = rows.filter((r) => Array.from(_invFilters).some((f) => INV_FILTER_MATCH[f](r.tag)));
    const groups = Array.from(groupByType(rows).values()).sort((a, b) => a.name.localeCompare(b.name));
    subEl.textContent = groups.length.toLocaleString('nl-BE') + ' furni-type(s), ' + rows.length.toLocaleString('nl-BE') + ' item(s) totaal.';

    const summaryEl = document.getElementById('inv-currency-summary');
    if (_invFilters.size === 0 || _invFilters.has('CURRENCY')) {
      // Sums by NAME pattern (parseCurrencyValue), not by the `tag` column — a scan can
      // land a Bel-Credits/Diamanten item with a stale/wrong tag (e.g. "Bel-Credits"
      // instead of "Currency"), and gating the sum on tag silently undercounts those even
      // though the card itself (grouped by name, not tag) still shows them.
      let totalBC = 0, totalDiamond = 0;
      rows.forEach((r) => {
        const v = parseCurrencyValue(r.item_name);
        if (v) { if (v.type === 'bc') totalBC += v.value; else totalDiamond += v.value; }
      });
      summaryEl.style.display = '';
      summaryEl.innerHTML =
        '<div class="currency-stat bc"><span class="currency-stat-label">Totaal Bel-Credits</span><span class="currency-stat-value">' + totalBC.toLocaleString('nl-BE') + '</span></div>'
        + '<div class="currency-stat diamond"><span class="currency-stat-label">Totaal Diamanten</span><span class="currency-stat-value">' + totalDiamond.toLocaleString('nl-BE') + '</span></div>';
    } else {
      summaryEl.style.display = 'none';
      summaryEl.innerHTML = '';
    }

    const totalPages = Math.max(1, Math.ceil(groups.length / _invPageSize));
    if (_invPage >= totalPages) _invPage = totalPages - 1;
    if (_invPage < 0) _invPage = 0;
    const pageGroups = groups.slice(_invPage * _invPageSize, _invPage * _invPageSize + _invPageSize);

    grid.innerHTML = pageGroups.length ? pageGroups.map((g) => {
      const icon = _iconByName.get(g.name);
      return '<button type="button" class="cat-card" data-action="open-item" data-key="' + esc(g.key) + '">'
        + '<span class="cat-qty">' + g.rows.length + '</span>'
        + '<div class="cat-thumb">' + (icon ? '<img src="' + esc(icon) + '" loading="lazy" onerror="this.style.opacity=\'.15\'">' : '<span class="cat-thumb-ph">?</span>') + '</div>'
        + '<div class="cat-name">' + esc(g.name) + '</div>'
        + '</button>';
    }).join('') : '<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:40px">'
      + (_inv.length ? 'Geen furni gevonden.' : 'Nog geen inventory geïmporteerd — zie Settings.') + '</div>';

    const pagEl = document.getElementById('inv-pagination');
    const atStart = _invPage <= 0, atEnd = _invPage >= totalPages - 1;
    pagEl.innerHTML =
      '<button class="btn btn-outline" id="inv-prev"' + (atStart ? ' disabled' : '') + '>&laquo; Vorige</button>'
      + '<span class="page-info">Pagina ' + (_invPage + 1) + ' / ' + totalPages + '</span>'
      + '<button class="btn btn-outline" id="inv-next"' + (atEnd ? ' disabled' : '') + '>Volgende &raquo;</button>'
      + '<select class="page-size-select" id="inv-page-size" title="Furni-types per pagina">'
      + INV_PAGE_SIZE_OPTIONS.map((n) => '<option value="' + n + '"' + (n === _invPageSize ? ' selected' : '') + '>' + n + '</option>').join('')
      + '</select>';
  }

  // Edition numbers stay collapsed behind the count by default — a wall of 20+ badges per
  // row was the whole problem being fixed here. Click the count to reveal them.
  function editionBadgesHtml(items) {
    const sorted = items.map((i) => i.edition_number).filter(Boolean)
      .sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));
    return sorted.map((e) => '<span class="badge neutral edition-badge">#' + esc(e) + '</span>').join('');
  }
  let _editionToggleSeq = 0;

  // One delete button per row opens this — a small "delete all N" or "delete a specific
  // amount" choice — instead of either silently nuking everything or cluttering every row
  // with a removable chip per single instance.
  function openDeleteQtyModal(rows, label) {
    const max = rows.length;
    openModal(
      'Verwijderen',
      '<div class="desc" style="margin:0 0 14px">' + esc(label) + ' — <b>' + max + '</b> stuk(s) beschikbaar.</div>'
      + '<div class="row"><button class="btn btn-danger" id="dq-all-btn">Verwijder alles (' + max + ')</button></div>'
      + '<div class="form-group" style="margin-top:16px">'
      + '<label>Of verwijder een specifiek aantal</label>'
      + '<div style="display:flex;gap:8px">'
      + '<input id="dq-amount" class="no-spin" type="number" min="1" max="' + max + '" value="1" style="width:auto;flex:1">'
      + '<button class="btn btn-danger" id="dq-amount-btn">Verwijder aantal</button>'
      + '</div></div>'
      + '<div class="row"><button class="btn btn-outline" id="dq-cancel-btn">Annuleren</button></div>'
      + '<div id="dq-status" style="font-size:12px;margin-top:8px"></div>'
    );
    document.getElementById('dq-cancel-btn').addEventListener('click', refreshActiveModal);
    document.getElementById('dq-all-btn').addEventListener('click', () => {
      deleteInventoryRowsRaw(rows.map((r) => r.item_id)).then((ok) => { if (ok) refreshActiveModal(); });
    });
    document.getElementById('dq-amount-btn').addEventListener('click', () => {
      const statusEl = document.getElementById('dq-status');
      let n = parseInt(document.getElementById('dq-amount').value, 10);
      if (!n || n < 1) { statusEl.className = 'err'; statusEl.textContent = 'Ongeldig aantal.'; return; }
      if (n > max) n = max;
      deleteInventoryRowsRaw(rows.slice(0, n).map((r) => r.item_id)).then((ok) => { if (ok) refreshActiveModal(); });
    });
  }

  const TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
  const CHEVRON_ICON = '<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="9" height="9" style="transition:transform .12s"><polyline points="6 9 12 15 18 9"/></svg>';

  // Tracks which modal is currently open (item-type or user) so any delete action, however
  // it was triggered, can refresh that same modal in place afterward instead of each
  // delete handler having to guess or duplicate the re-open logic.
  let _activeModal = null;
  function refreshActiveModal() {
    if (!_activeModal) return;
    if (_activeModal.type === 'item') {
      if (groupByType(_inv).has(_activeModal.key)) openItemModal(_activeModal.key);
      else closeModal();
    } else if (_activeModal.type === 'user') {
      if (_inv.some((r) => r.owner_username === _activeModal.username)) openUserModal(_activeModal.username);
      else closeModal();
    }
  }

  async function deleteInventoryRowsRaw(itemIds) {
    if (!itemIds.length) return false;
    try {
      const res = await fetch(SB_URL + '/inventory_items?item_id=in.(' + itemIds.join(',') + ')', { method: 'DELETE', headers: HEADERS });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      await loadInventory();
      return true;
    } catch (e) {
      window.alert('Fout bij verwijderen: ' + e.message);
      return false;
    }
  }
  async function deleteInventoryRows(itemIds, confirmMsg) {
    if (!itemIds.length || !window.confirm(confirmMsg)) return false;
    return deleteInventoryRowsRaw(itemIds);
  }

  // Whole-user delete goes through a direct owner_username filter instead of an item_id
  // list — a heavy account can own thousands of rows, past what's sane to cram into a URL.
  async function deleteUserAll(username, confirmMsg) {
    if (!window.confirm(confirmMsg)) return false;
    try {
      const res = await fetch(SB_URL + '/inventory_items?owner_username=eq.' + encodeURIComponent(username), { method: 'DELETE', headers: HEADERS });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      await loadInventory();
      return true;
    } catch (e) {
      window.alert('Fout bij verwijderen: ' + e.message);
      return false;
    }
  }

  function openItemModal(key) {
    const groups = groupByType(_inv);
    const g = groups.get(key);
    if (!g) return;
    _activeModal = { type: 'item', key: key };
    const byOwner = new Map();
    g.rows.forEach((r) => {
      if (!byOwner.has(r.owner_username)) byOwner.set(r.owner_username, []);
      byOwner.get(r.owner_username).push(r);
    });
    const ownerRows = Array.from(byOwner.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .map(([owner, items]) => {
        const hasEditions = items.some((i) => i.edition_number);
        const detailId = 'ed-' + (_editionToggleSeq++);
        const countBadge = hasEditions
          ? '<button type="button" class="badge neutral edition-toggle" style="cursor:pointer;border:none" data-action="toggle-editions" data-target="' + detailId + '">' + items.length + '&times; ' + CHEVRON_ICON + '</button>'
          : '<span class="badge neutral">' + items.length + '&times;</span>';
        return '<div class="owner-row"' + (hasEditions ? ' style="flex-direction:column;align-items:stretch"' : '') + '>'
          + '<div class="owner-row-hdr">'
          + '<button class="link" data-action="open-user" data-user="' + esc(owner) + '">' + esc(owner) + '</button>'
          + '<div class="owner-detail">' + countBadge
          + ' <button class="btn btn-danger btn-sm" data-action="delete-owner-items" data-key="' + esc(key) + '" data-owner="' + esc(owner) + '" title="Verwijder deze items van ' + esc(owner) + '">' + TRASH_ICON + '</button>'
          + '</div>'
          + '</div>'
          + (hasEditions ? '<div class="edition-grid" id="' + detailId + '" style="display:none">' + editionBadgesHtml(items) + '</div>' : '')
          + '</div>';
      }).join('');
    openModal(
      esc(g.name) + ((g.tag && !g.name.includes('(' + g.tag + ')')) ? ' <span class="modal-tag">(' + esc(g.tag) + ')</span>' : ''),
      '<div class="owner-list">' + (ownerRows || '<div style="color:var(--muted);text-align:center;padding:16px">Geen eigenaars.</div>') + '</div>'
      + '<div class="modal-total">Totaal: ' + g.rows.length + ' stuk(s) bij ' + byOwner.size + ' account(s).</div>'
      + '<div class="row"><button class="btn btn-danger" data-action="delete-item-all" data-key="' + esc(key) + '">' + TRASH_ICON + ' Verwijder alle exemplaren</button></div>'
    );
  }

  function openUserModal(username) {
    _activeModal = { type: 'user', username: username };
    const rows = _inv.filter((r) => r.owner_username === username);
    const groups = Array.from(groupByType(rows).values()).sort((a, b) => a.name.localeCompare(b.name));
    const list = groups.map((g) => {
      const icon = _iconByName.get(g.name);
      const hasEditions = g.rows.some((r) => r.edition_number);
      const detailId = 'ed-' + (_editionToggleSeq++);
      const countBadge = hasEditions
        ? '<button type="button" class="badge neutral edition-toggle" style="cursor:pointer;border:none" data-action="toggle-editions" data-target="' + detailId + '">' + g.rows.length + '&times; ' + CHEVRON_ICON + '</button>'
        : '<span class="badge neutral">' + g.rows.length + '&times;</span>';
      return '<div class="owner-row"' + (hasEditions ? ' style="flex-direction:column;align-items:stretch"' : '') + '>'
        + '<div class="owner-row-hdr">'
        + '<span class="item-cell">' + (icon ? '<img class="row-thumb" src="' + esc(icon) + '" onerror="this.style.opacity=0">' : '')
        + '<button class="link" data-action="open-item" data-key="' + esc(g.key) + '">' + esc(g.name) + '</button></span>'
        + '<div class="owner-detail">' + countBadge
        + ' <button class="btn btn-danger btn-sm" data-action="delete-owner-items" data-key="' + esc(g.key) + '" data-owner="' + esc(username) + '" title="Verwijder dit item bij ' + esc(username) + '">' + TRASH_ICON + '</button>'
        + '</div>'
        + '</div>'
        + (hasEditions ? '<div class="edition-grid" id="' + detailId + '" style="display:none">' + editionBadgesHtml(g.rows) + '</div>' : '')
        + '</div>';
    }).join('');
    openModal(
      esc(username),
      '<div class="owner-list">' + (list || '<div style="color:var(--muted);text-align:center;padding:16px">Geen items.</div>') + '</div>'
      + '<div class="modal-total">Totaal: ' + rows.length + ' item(s), ' + groups.length + ' furni-type(s).</div>'
      + '<div class="row"><button class="btn btn-danger" data-action="delete-user-all" data-user="' + esc(username) + '">' + TRASH_ICON + ' Verwijder alle items van deze user</button></div>'
    );
  }

  function renderUsers() {
    const body = document.getElementById('users-body');
    const subEl = document.getElementById('users-sub');
    const byOwner = new Map();
    _inv.forEach((r) => byOwner.set(r.owner_username, (byOwner.get(r.owner_username) || 0) + 1));
    let users = Array.from(byOwner.entries()).map(([user, count]) => ({ user: user, count: count }));
    const q = _userQuery.trim().toLowerCase();
    if (q) users = users.filter((u) => u.user.toLowerCase().includes(q));
    users.sort((a, b) => b.count - a.count);

    const totalPages = Math.max(1, Math.ceil(users.length / USERS_PAGE_SIZE));
    if (_usersPage >= totalPages) _usersPage = totalPages - 1;
    if (_usersPage < 0) _usersPage = 0;
    const pageRows = users.slice(_usersPage * USERS_PAGE_SIZE, _usersPage * USERS_PAGE_SIZE + USERS_PAGE_SIZE);

    subEl.textContent = users.length + ' apart(e) gebruiker(s).';
    body.innerHTML = pageRows.length ? pageRows.map((u) => (
      '<tr><td><button class="link" data-action="open-user" data-user="' + esc(u.user) + '">' + esc(u.user) + '</button></td>'
      + '<td style="text-align:right">' + u.count + '</td></tr>'
    )).join('') : '<tr><td colspan="2" style="color:var(--muted);text-align:center;padding:20px">Nog geen gebruikers.</td></tr>';

    const pagEl = document.getElementById('users-pagination');
    if (users.length <= USERS_PAGE_SIZE) { pagEl.innerHTML = ''; return; }
    const atStart = _usersPage <= 0, atEnd = _usersPage >= totalPages - 1;
    pagEl.innerHTML =
      '<button class="btn btn-outline" id="users-prev"' + (atStart ? ' disabled' : '') + '>&laquo; Vorige</button>'
      + '<span class="page-info">Pagina ' + (_usersPage + 1) + ' / ' + totalPages + '</span>'
      + '<button class="btn btn-outline" id="users-next"' + (atEnd ? ' disabled' : '') + '>Volgende &raquo;</button>';
  }

  function openModal(title, bodyHtml) {
    document.getElementById('modal-title').innerHTML = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-overlay').classList.add('open');
  }
  function closeModal() {
    document.getElementById('modal-overlay').classList.remove('open');
    _activeModal = null;
  }

  function openImportModal() {
    openModal(
      'Import Items',
      '<div class="desc" style="margin-bottom:10px">Plak de JSON van een Room Deleter-scan (of gelijkaardige export met <code>ownerUsername</code>, <code>itemId</code>, <code>typeId</code>, <code>editionNumber</code>).</div>'
      + '<input type="file" id="imp-file-input" accept=".json,.txt">'
      + '<textarea id="imp-paste-input" style="margin-top:8px" placeholder=\'[{ "ownerUsername": "hov", "itemId": 456, "typeId": 789, "itemName": "...", "tag": "LTD", "editionNumber": "89/100" }]\'></textarea>'
      + '<div class="row">'
      + '<button class="btn btn-primary" id="imp-import-btn">Importeer</button>'
      + '<button class="btn btn-outline" id="imp-clear-btn">Wissen</button>'
      + '</div>'
      + '<div id="imp-status" style="font-size:12px;margin-top:10px"></div>'
    );
    document.getElementById('imp-file-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { document.getElementById('imp-paste-input').value = reader.result; };
      reader.readAsText(file);
    });
    document.getElementById('imp-import-btn').addEventListener('click', () => {
      let items;
      try {
        items = parseLooseJson(document.getElementById('imp-paste-input').value);
      } catch (e) {
        const statusEl = document.getElementById('imp-status');
        statusEl.className = 'err';
        statusEl.textContent = 'Ongeldige JSON: ' + e.message;
        return;
      }
      importInventoryItems(items);
    });
    document.getElementById('imp-clear-btn').addEventListener('click', () => {
      document.getElementById('imp-paste-input').value = '';
      document.getElementById('imp-file-input').value = '';
      const statusEl = document.getElementById('imp-status');
      statusEl.className = '';
      statusEl.textContent = '';
    });
  }

  async function importInventoryItems(items) {
    const statusEl = document.getElementById('imp-status');
    const btn = document.getElementById('imp-import-btn');
    if (!Array.isArray(items) || !items.length) {
      statusEl.className = 'err';
      statusEl.textContent = 'Geen geldige items gevonden in de JSON.';
      return;
    }
    btn.disabled = true;
    statusEl.className = '';

    const rows = items
      .filter((it) => it && it.itemId != null && it.ownerUsername)
      .map((it) => ({
        item_id: it.itemId,
        room_id: it.roomId != null ? it.roomId : null,
        room_name: it.roomName || null,
        owner_username: it.ownerUsername,
        type_id: it.typeId != null ? it.typeId : null,
        item_name: it.itemName || null,
        tag: it.tag || null,
        edition_number: it.editionNumber || null,
        is_wall: !!it.isWall,
        last_seen: it.lastSeen || new Date().toISOString(),
      }));
    const skipped = items.length - rows.length;
    try {
      // A fresh scan is this account's CURRENT truth, not an addition to whatever was
      // recorded before — an item that's no longer in the new scan (traded, moved, etc.)
      // shouldn't keep sitting around forever from an old import. Replace, not stack: wipe
      // each owner appearing in this import before writing their new rows in. Only owners
      // actually present in this JSON are touched — everyone else's data is untouched.
      const owners = Array.from(new Set(rows.map((r) => r.owner_username)));
      if (owners.length) {
        statusEl.textContent = 'Oude items van ' + owners.length + ' account(s) vervangen…';
        for (let i = 0; i < owners.length; i++) {
          const res = await fetch(SB_URL + '/inventory_items?owner_username=eq.' + encodeURIComponent(owners[i]), {
            method: 'DELETE',
            headers: HEADERS,
          });
          if (!res.ok) throw new Error('HTTP ' + res.status + ' bij verwijderen oude items van ' + owners[i]);
        }
      }

      const CHUNK = 500;
      let saved = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        statusEl.textContent = 'Opslaan… ' + Math.min(i + CHUNK, rows.length) + '/' + rows.length;
        const res = await fetch(SB_URL + '/inventory_items?on_conflict=item_id', {
          method: 'POST',
          headers: Object.assign({}, HEADERS, { Prefer: 'resolution=merge-duplicates,return=representation' }),
          body: JSON.stringify(chunk),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + (await res.text()));
        const out = await res.json();
        saved += out.length;
      }
      statusEl.className = 'ok';
      statusEl.textContent = 'Klaar — ' + saved + ' item(s) opgeslagen' + (skipped ? ', ' + skipped + ' overgeslagen (ongeldig)' : '') + '.';
      await loadInventory();
    } catch (e) {
      statusEl.className = 'err';
      statusEl.textContent = 'Fout bij opslaan: ' + e.message;
    } finally {
      btn.disabled = false;
    }
  }

  // ── Manual add/edit — item_overview's PK is `name`, so editing always PATCHes by the
  // ORIGINAL name (even if the name itself is being changed in this save), while adding a
  // new one is the same upsert POST the import flow already uses.
  const ITEM_CATEGORIES = ['Club Cadeau', 'LTD', 'Rare', 'SS', 'BC Shop', 'Pokémon', 'Ecotron', 'Currency'];

  function openItemEditModal(existing) {
    const isEdit = !!existing;
    const current = isEdit ? (existing.category || '') : '';
    const options = ITEM_CATEGORIES.slice();
    if (current && options.indexOf(current) === -1) options.push(current); // preserve an odd/legacy value instead of silently discarding it
    const optionsHtml = '<option value="">— Geen —</option>' + options.map((c) => (
      '<option value="' + esc(c) + '"' + (c === current ? ' selected' : '') + '>' + esc(c) + '</option>'
    )).join('');
    openModal(
      isEdit ? 'Item bewerken' : 'Nieuw item',
      '<div class="form-group"><label>Naam *</label><input id="ie-name" value="' + (isEdit ? esc(existing.name) : '') + '"></div>'
      + '<div class="form-group"><label>Categorie</label><select id="ie-category">' + optionsHtml + '</select></div>'
      + '<div class="form-group"><label>Icoon URL</label><input id="ie-icon" value="' + (isEdit ? esc(existing.icon || '') : '') + '"></div>'
      + '<div class="form-group"><label>Type ID</label><input id="ie-type-id" type="number" value="' + (isEdit && existing.type_id != null ? existing.type_id : '') + '"></div>'
      + '<div class="row">'
      + '<button class="btn btn-primary" id="ie-save-btn">Opslaan</button>'
      + (isEdit ? '<button class="btn btn-outline" id="ie-delete-btn">Verwijderen</button>' : '')
      + '</div>'
      + '<div id="ie-status" style="font-size:12px;margin-top:8px"></div>'
    );

    document.getElementById('ie-save-btn').addEventListener('click', async () => {
      const statusEl = document.getElementById('ie-status');
      const name = document.getElementById('ie-name').value.trim();
      if (!name) { statusEl.className = 'err'; statusEl.textContent = 'Naam is verplicht.'; return; }
      const typeIdRaw = document.getElementById('ie-type-id').value.trim();
      const payload = {
        name: name,
        category: document.getElementById('ie-category').value.trim() || null,
        icon: document.getElementById('ie-icon').value.trim() || null,
        type_id: typeIdRaw ? parseInt(typeIdRaw, 10) : null,
        is_wall: isEdit ? !!existing.is_wall : false,
        matched: true,
      };
      statusEl.className = '';
      statusEl.textContent = 'Opslaan…';
      try {
        let res;
        if (isEdit) {
          res = await fetch(SB_URL + '/item_overview?name=eq.' + encodeURIComponent(existing.name), {
            method: 'PATCH',
            headers: Object.assign({}, HEADERS, { Prefer: 'return=representation' }),
            body: JSON.stringify(payload),
          });
        } else {
          res = await fetch(SB_URL + '/item_overview?on_conflict=name', {
            method: 'POST',
            headers: Object.assign({}, HEADERS, { Prefer: 'resolution=merge-duplicates,return=representation' }),
            body: JSON.stringify([payload]),
          });
        }
        if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + (await res.text()));
        closeModal();
        loadSaved();
      } catch (e) {
        statusEl.className = 'err';
        statusEl.textContent = 'Fout: ' + e.message;
      }
    });

    if (isEdit) {
      document.getElementById('ie-delete-btn').addEventListener('click', async () => {
        if (!window.confirm('"' + existing.name + '" verwijderen?')) return;
        const statusEl = document.getElementById('ie-status');
        statusEl.className = '';
        statusEl.textContent = 'Verwijderen…';
        try {
          const res = await fetch(SB_URL + '/item_overview?name=eq.' + encodeURIComponent(existing.name), { method: 'DELETE', headers: HEADERS });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          closeModal();
          loadSaved();
        } catch (e) {
          statusEl.className = 'err';
          statusEl.textContent = 'Fout: ' + e.message;
        }
      });
    }
  }

  async function matchOne(name) {
    const url = FURNIS_URL + '/furni_master?select=type_id,is_wall&name=eq.' + encodeURIComponent(name);
    try {
      const res = await fetch(url, { headers: { apikey: SB_KEY } });
      if (!res.ok) return null;
      const rows = await res.json();
      return rows.length ? rows[0] : null;
    } catch (e) {
      return null;
    }
  }

  // The scraped JSON only ever carries {name, icon} — never a separate classname field.
  // But for sources with no real display name anywhere (BC Shop), the icon filename IS
  // furni_master's `classname`, so it's worth a shot at import time: derive it straight
  // from the icon URL (nothing extra to carry around) and use it to recover the REAL name
  // + type_id when furni_master has it, before falling back to the guessed name.
  function classnameFromIcon(iconUrl) {
    if (!iconUrl) return null;
    const file = iconUrl.split('/').pop().split('?')[0];
    return file.replace(/\.(png|gif|jpg|jpeg)$/i, '').replace(/_icon$/i, '') || null;
  }
  async function matchByClassname(classname) {
    const url = FURNIS_URL + '/furni_master?select=name,type_id,is_wall&classname=eq.' + encodeURIComponent(classname);
    try {
      const res = await fetch(url, { headers: { apikey: SB_KEY } });
      if (!res.ok) return null;
      const rows = await res.json();
      return rows.length ? rows[0] : null;
    } catch (e) {
      return null;
    }
  }

  // Shared by the import flow and the auto-retry below — name match first, then classname
  // (derived from the icon URL) both as-is and with the trailing "_N" swapped for "*N"
  // (furni_master's actual numbered-variant format).
  async function resolveMatch(name, icon) {
    let match = await matchOne(name);
    let finalName = name;
    if (!match) {
      const classname = classnameFromIcon(icon);
      if (classname) {
        let byClass = await matchByClassname(classname);
        if (!byClass && /_\d+$/.test(classname)) {
          byClass = await matchByClassname(classname.replace(/_(\d+)$/, '*$1'));
        }
        if (byClass) { match = byClass; finalName = byClass.name || name; }
      }
    }
    return { match: match, finalName: finalName };
  }

  // Items saved without a type_id (furnis didn't know them yet at import time) get a
  // quiet automatic retry here — no need to re-paste the JSON by hand once furnis catches
  // up. Cooldown-gated so a page reload can't turn into a lookup storm.
  const RETRY_UNMATCHED_KEY = 'gheloo_items_last_unmatched_retry';
  const RETRY_UNMATCHED_COOLDOWN_MS = 10 * 60 * 1000;
  async function retryUnmatchedItems() {
    const last = parseInt(localStorage.getItem(RETRY_UNMATCHED_KEY), 10) || 0;
    if (Date.now() - last < RETRY_UNMATCHED_COOLDOWN_MS) return;
    localStorage.setItem(RETRY_UNMATCHED_KEY, String(Date.now()));
    let unmatched;
    try {
      const res = await fetch(SB_URL + '/item_overview?select=name,icon&matched=eq.false', { headers: HEADERS });
      if (!res.ok) return;
      unmatched = await res.json();
    } catch (e) { return; }
    if (!unmatched.length) return;
    let fixed = 0;
    for (let i = 0; i < unmatched.length; i++) {
      const it = unmatched[i];
      const r = await resolveMatch(it.name, it.icon);
      if (r.match) {
        try {
          const res = await fetch(SB_URL + '/item_overview?name=eq.' + encodeURIComponent(it.name), {
            method: 'PATCH',
            headers: Object.assign({}, HEADERS, { Prefer: 'return=minimal' }),
            body: JSON.stringify({
              name: r.finalName,
              category: extractCategory(r.finalName),
              type_id: r.match.type_id,
              is_wall: r.match.is_wall,
              matched: true,
            }),
          });
          if (res.ok) fixed++;
        } catch (e) { /* leave it for the next retry pass */ }
      }
      await sleep(120);
    }
    if (fixed) loadSaved();
  }

  function renderResults(rows) {
    const card = document.getElementById('results-card');
    const body = document.getElementById('results-body');
    const count = document.getElementById('results-count');
    const matched = rows.filter((r) => r.matched).length;
    count.textContent = matched + ' / ' + rows.length + ' gelinkt aan een type ID.';
    body.innerHTML = rows.map((r) => (
      '<tr>'
      + '<td class="icon-cell">' + (r.icon ? '<img src="' + esc(r.icon) + '" loading="lazy" onerror="this.style.opacity=\'.15\'">' : '') + '</td>'
      + '<td>' + esc(r.name) + '</td>'
      + '<td>' + esc(r.category || '—') + '</td>'
      + '<td>' + (r.type_id != null ? r.type_id : '—') + '</td>'
      + '<td>' + (r.matched ? '<span class="badge match">Gelinkt</span>' : '<span class="badge nomatch">Geen match</span>') + '</td>'
      + '</tr>'
    )).join('');
    card.style.display = '';
  }

  async function importItems(items) {
    const statusEl = document.getElementById('import-status');
    const importBtn = document.getElementById('import-btn');
    if (!Array.isArray(items) || !items.length) {
      statusEl.className = 'err';
      statusEl.textContent = 'Geen geldige items gevonden in de JSON.';
      return;
    }
    importBtn.disabled = true;

    // Dedupe by name up front — pasting multiple merged scan sessions can carry the same
    // name twice, and PostgREST's on_conflict upsert hard-errors ("ON CONFLICT DO UPDATE
    // command cannot affect row a second time") if one INSERT batch has the same conflict
    // key more than once. Last occurrence wins.
    const dedupedItems = Array.from(new Map(items.filter((it) => it && it.name).map((it) => [it.name, it])).values());

    // Only process names not already SUCCESSFULLY matched — a re-import (e.g. after
    // scraping more pages, or once furnis has caught up on items it didn't know before)
    // should just add what's missing and retry whatever's still unmatched, not re-process
    // everything every time. Unmatched rows stay eligible for a future retry on purpose.
    statusEl.className = '';
    statusEl.textContent = 'Checken welke items al bekend zijn…';
    let known = new Set();
    try {
      const existing = await fetch(SB_URL + '/item_overview?select=name,matched', { headers: HEADERS });
      if (existing.ok) known = new Set((await existing.json()).filter((r) => r.matched).map((r) => r.name));
    } catch (e) { /* if this fails, we just re-check everything — not fatal */ }
    const toProcess = dedupedItems.filter((it) => it && it.name && !known.has(it.name));
    const skipped = items.length - toProcess.length;

    const rows = [];
    for (let i = 0; i < toProcess.length; i++) {
      const it = toProcess[i];
      statusEl.textContent = 'Linken… ' + (i + 1) + '/' + toProcess.length + ' (' + it.name + ')'
        + (skipped ? ' — ' + skipped + ' al bekend, overgeslagen' : '');
      const r = await resolveMatch(it.name, it.icon);
      const match = r.match;
      const finalName = r.finalName;
      rows.push({
        name: finalName,
        icon: it.icon || null,
        category: extractCategory(finalName),
        type_id: match ? match.type_id : null,
        is_wall: match ? match.is_wall : null,
        matched: !!match,
      });
      // Paced, not hammered — see core/supabase.js's own outbox comments for why this
      // VM stays gentle with request rates even on fast indexed lookups.
      await sleep(120);
    }

    // A classname match can rename two different guessed names onto the same real
    // furni_master name — dedupe again post-match for the same on_conflict reason as above.
    const dedupedRows = Array.from(new Map(rows.map((r) => [r.name, r])).values());

    // Save everything, matched or not — an unmatched row just has no type_id yet. Keeping
    // it (rather than dropping it) means it shows up in Opgeslagen items with its icon and
    // guessed name, and stays eligible for a retry on the next import once furnis catches
    // up (see the `known` filter above), instead of silently vanishing every time.
    const unmatched = dedupedRows.filter((r) => !r.matched).length;
    statusEl.textContent = 'Opslaan…';
    try {
      let saved = [];
      if (dedupedRows.length) {
        const res = await fetch(SB_URL + '/item_overview?on_conflict=name', {
          method: 'POST',
          headers: Object.assign({}, HEADERS, { Prefer: 'resolution=merge-duplicates,return=representation' }),
          body: JSON.stringify(dedupedRows),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + (await res.text()));
        saved = await res.json();
      }
      statusEl.className = 'ok';
      statusEl.textContent = 'Klaar — ' + saved.length + ' item(s) opgeslagen (' + (saved.length - unmatched) + ' met type ID, ' + unmatched + ' nog zonder), '
        + skipped + ' al gelinkt overgeslagen.';
      renderResults(dedupedRows);
      if (saved.length) loadSaved();
    } catch (e) {
      statusEl.className = 'err';
      statusEl.textContent = 'Fout bij opslaan: ' + e.message;
      renderResults(rows); // still show what we matched, even though saving failed
    } finally {
      importBtn.disabled = false;
    }
  }

  // ── Ruilwaarde console-script generator ─────────────────────────────────────
  // Same scraper worked out (and byte-verified against the real DOM) together in this
  // chat: walks every navigator tab except the ones the user unchecked here, paging
  // through each one via its pagination bar's next button (which gets a real `disabled`
  // attribute on the last page — confirmed against a live outerHTML capture), scraping
  // name + item icon (never the currency icon) per card, and downloading items.json at
  // the end. skipTabs is baked into the returned script text as a literal array so this
  // page never needs to talk to leet.city directly (cross-origin, and pointless anyway —
  // the script only needs to run IN that page's own console).
  // ── BC Shop (Hall of Fame) console script — separate page, separate DOM shape: tiles are
  // plain divs with a CSS background-image, no name text anywhere. Best we can do is derive
  // a readable name from the icon filename and tag it "(BC Shop)" so category extraction
  // still works on import. Runs standalone in that page's own console — a small floating
  // badge (debounced re-scan on DOM changes, since a live client mutates constantly and an
  // undebounced observer will peg the CPU) that copies the accumulated JSON to clipboard on
  // click, ready to paste into "Importeer items.json" below.
  const BC_SHOP_SCRIPT = '(function () {\n'
    + '  const items = new Map();\n'
    + '  function extractUrl(el) {\n'
    + '    const bg = el.style.backgroundImage || getComputedStyle(el).backgroundImage;\n'
    + '    const m = /url\\(["\']?(.*?)["\']?\\)/.exec(bg || \'\');\n'
    + '    return m ? m[1] : null;\n'
    + '  }\n'
    + '  function prettyName(url) {\n'
    + '    const file = url.split(\'/\').pop().split(\'?\')[0];\n'
    + '    const base = file.replace(/\\.(png|gif|jpg|jpeg)$/i, \'\').replace(/_icon$/i, \'\').replace(/[_-]+/g, \' \').trim();\n'
    + '    return base + \' (BC Shop)\';\n'
    + '  }\n'
    + '  function updateBadge(msg) {\n'
    + '    const badge = document.getElementById(\'__bc_badge\');\n'
    + '    if (badge) badge.textContent = msg || (\'BC Shop scan: \' + items.size + \' item(s) — klik om te kopiëren\');\n'
    + '  }\n'
    + '  function scan() {\n'
    + '    document.querySelectorAll(\'.layout-grid-item\').forEach((el) => {\n'
    + '      const url = extractUrl(el);\n'
    + '      if (!url) return;\n'
    + '      const name = prettyName(url);\n'
    + '      if (!items.has(name)) items.set(name, { name: name, icon: url });\n'
    + '    });\n'
    + '    updateBadge();\n'
    + '  }\n'
    + '  function copyToClipboard() {\n'
    + '    const list = Array.from(items.values());\n'
    + '    const text = JSON.stringify(list, null, 2);\n'
    + '    navigator.clipboard.writeText(text).then(function () {\n'
    + '      updateBadge(\'Gekopieerd! \' + list.length + \' item(s) — plak in items.databin.uk\');\n'
    + '      setTimeout(updateBadge, 3000);\n'
    + '    }).catch(function () {\n'
    + '      console.log(text);\n'
    + '      updateBadge(\'Kopiëren mislukt — JSON staat in de console, kopieer van daar.\');\n'
    + '    });\n'
    + '  }\n'
    + '  const badge = document.createElement(\'div\');\n'
    + '  badge.id = \'__bc_badge\';\n'
    + '  badge.style.cssText = \'position:fixed;top:12px;right:12px;z-index:999999;background:#111;color:#fff;\'\n'
    + '    + \'font:600 12px/1.4 -apple-system,system-ui,sans-serif;padding:10px 14px;border-radius:8px;\'\n'
    + '    + \'box-shadow:0 4px 16px rgba(0,0,0,.5);cursor:pointer;border:1px solid #444\';\n'
    + '  badge.addEventListener(\'click\', copyToClipboard);\n'
    + '  document.body.appendChild(badge);\n'
    + '  let pending = null;\n'
    + '  function scheduleScan() {\n'
    + '    if (pending) clearTimeout(pending);\n'
    + '    pending = setTimeout(scan, 500);\n'
    + '  }\n'
    + '  new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });\n'
    + '  scan();\n'
    + '})();';

  function buildScrapeScript(skipTabs) {
    return '(async function () {\n'
      + '  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }\n'
      + '  const WAIT_MS = 500;\n'
      + '  const MAX_PAGES = 250;\n'
      + '  const SKIP_TABS = ' + JSON.stringify(skipTabs) + ';\n'
      + '\n'
      + '  function activeTabpanel() {\n'
      + '    return document.querySelector(\'[role="tabpanel"][data-state="active"]\');\n'
      + '  }\n'
      + '  function scrapeCurrentPage(out) {\n'
      + '    const panel = activeTabpanel();\n'
      + '    if (!panel) return 0;\n'
      + '    let added = 0;\n'
      + '    panel.querySelectorAll(\'.card\').forEach(card => {\n'
      + '      const iconEl = card.querySelector(\':scope > .w-16 img, :scope > div.w-16 img\');\n'
      + '      const nameEl = card.querySelector(\'strong\');\n'
      + '      if (!iconEl || !nameEl) return;\n'
      + '      const name = nameEl.textContent.trim();\n'
      + '      if (!name || out.has(name)) return;\n'
      + '      out.set(name, { name, icon: iconEl.src });\n'
      + '      added++;\n'
      + '    });\n'
      + '    return added;\n'
      + '  }\n'
      + '  function findPaginationBar() {\n'
      + '    const panel = activeTabpanel();\n'
      + '    return panel && panel.querySelector(\'.p-2.flex.gap-4.items-center.justify-center.mt-6\');\n'
      + '  }\n'
      + '  function findNextButton(bar) {\n'
      + '    if (!bar) return null;\n'
      + '    const buttons = bar.querySelectorAll(\'button\');\n'
      + '    return buttons.length ? buttons[buttons.length - 1] : null;\n'
      + '  }\n'
      + '  function isDisabled(btn) {\n'
      + '    return !btn || btn.disabled || btn.classList.contains(\'cursor-not-allowed\');\n'
      + '  }\n'
      + '  function activePageLabel(bar) {\n'
      + '    const active = bar && bar.querySelector(\'[data-state="active"]\');\n'
      + '    return active ? active.textContent.trim() : null;\n'
      + '  }\n'
      + '  function isTabActive(tab) {\n'
      + '    return tab.getAttribute(\'data-state\') === \'active\' || tab.getAttribute(\'aria-selected\') === \'true\';\n'
      + '  }\n'
      + '  async function activateTab(tab) {\n'
      + '    if (isTabActive(tab)) return true;\n'
      + '    tab.click();\n'
      + '    await sleep(300);\n'
      + '    if (isTabActive(tab)) return true;\n'
      + '    tab.dispatchEvent(new PointerEvent(\'pointerdown\', { bubbles: true }));\n'
      + '    tab.dispatchEvent(new PointerEvent(\'pointerup\', { bubbles: true }));\n'
      + '    tab.dispatchEvent(new MouseEvent(\'mousedown\', { bubbles: true }));\n'
      + '    tab.dispatchEvent(new MouseEvent(\'mouseup\', { bubbles: true }));\n'
      + '    tab.click();\n'
      + '    await sleep(400);\n'
      + '    return isTabActive(tab);\n'
      + '  }\n'
      + '  async function scrapeAllPagesOfCurrentTab(items) {\n'
      + '    scrapeCurrentPage(items);\n'
      + '    for (let i = 0; i < MAX_PAGES; i++) {\n'
      + '      const bar = findPaginationBar();\n'
      + '      const nextBtn = findNextButton(bar);\n'
      + '      if (isDisabled(nextBtn)) { console.log(\'  done — no more pages.\'); break; }\n'
      + '      const before = activePageLabel(bar);\n'
      + '      nextBtn.click();\n'
      + '      await sleep(WAIT_MS);\n'
      + '      let after = activePageLabel(findPaginationBar());\n'
      + '      let extra = 0;\n'
      + '      while (after === before && extra < 5) {\n'
      + '        await sleep(300);\n'
      + '        after = activePageLabel(findPaginationBar());\n'
      + '        extra++;\n'
      + '      }\n'
      + '      const added = scrapeCurrentPage(items);\n'
      + '      console.log(\'  page \' + (after || \'?\') + \' — +\' + added + \' new, \' + items.size + \' total so far\');\n'
      + '    }\n'
      + '  }\n'
      + '\n'
      + '  const tabs = Array.from(document.querySelectorAll(\'[role="tab"]\'))\n'
      + '    .filter(t => !SKIP_TABS.map(s => s.toLowerCase()).includes(t.textContent.trim().toLowerCase()));\n'
      + '  const items = new Map();\n'
      + '\n'
      + '  for (const tab of tabs) {\n'
      + '    const ok = await activateTab(tab);\n'
      + '    console.log(\'=== Tab "\' + tab.textContent.trim() + \'" (\' + (ok ? \'activated\' : \'FAILED TO ACTIVATE\') + \') ===\');\n'
      + '    if (!ok) continue;\n'
      + '    await scrapeAllPagesOfCurrentTab(items);\n'
      + '  }\n'
      + '\n'
      + '  const list = Array.from(items.values());\n'
      + '  console.log(\'TOTAL: \' + list.length + \' unique items.\');\n'
      + '\n'
      + '  const blob = new Blob([JSON.stringify(list, null, 2)], { type: \'application/json\' });\n'
      + '  const url = URL.createObjectURL(blob);\n'
      + '  const a = document.createElement(\'a\');\n'
      + '  a.href = url;\n'
      + '  a.download = \'items.json\';\n'
      + '  document.body.appendChild(a);\n'
      + '  a.click();\n'
      + '  a.remove();\n'
      + '  setTimeout(() => URL.revokeObjectURL(url), 10000);\n'
      + '})();';
  }

  function setupEvents() {
    document.getElementById('tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === btn));
      document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.dataset.page === btn.dataset.tab));
    });

    document.getElementById('inv-goto-import-btn').addEventListener('click', openImportModal);

    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') closeModal();
    });
    document.addEventListener('click', (e) => {
      const openItemBtn = e.target.closest('[data-action="open-item"]');
      if (openItemBtn) { openItemModal(openItemBtn.dataset.key); return; }
      const openUserBtn = e.target.closest('[data-action="open-user"]');
      if (openUserBtn) { openUserModal(openUserBtn.dataset.user); return; }
      const toggleBtn = e.target.closest('[data-action="toggle-editions"]');
      if (toggleBtn) {
        const target = document.getElementById(toggleBtn.dataset.target);
        if (target) {
          const open = target.style.display === 'none';
          target.style.display = open ? 'grid' : 'none';
          const chevron = toggleBtn.querySelector('.chevron');
          if (chevron) chevron.style.transform = open ? 'rotate(180deg)' : '';
        }
        return;
      }

      const delItemAllBtn = e.target.closest('[data-action="delete-item-all"]');
      if (delItemAllBtn) {
        const key = delItemAllBtn.dataset.key;
        const g = groupByType(_inv).get(key);
        if (!g) return;
        deleteInventoryRows(g.rows.map((r) => r.item_id), 'Alle ' + g.rows.length + ' exemplaren van "' + g.name + '" verwijderen (bij alle accounts)?')
          .then((ok) => { if (ok) refreshActiveModal(); });
        return;
      }
      const delOwnerBtn = e.target.closest('[data-action="delete-owner-items"]');
      if (delOwnerBtn) {
        const key = delOwnerBtn.dataset.key;
        const owner = delOwnerBtn.dataset.owner;
        const g = groupByType(_inv).get(key);
        if (!g) return;
        const rows = g.rows.filter((r) => r.owner_username === owner);
        openDeleteQtyModal(rows, '"' + g.name + '" bij ' + owner);
        return;
      }
      const delUserAllBtn = e.target.closest('[data-action="delete-user-all"]');
      if (delUserAllBtn) {
        const username = delUserAllBtn.dataset.user;
        deleteUserAll(username, 'ALLE items van ' + username + ' verwijderen? Dit kan niet ongedaan gemaakt worden.')
          .then((ok) => { if (ok) refreshActiveModal(); });
        return;
      }
    });

    document.getElementById('inv-search').addEventListener('input', (e) => {
      _invQuery = e.target.value;
      _invPage = 0;
      renderInventory();
    });
    document.getElementById('inv-filter-row').addEventListener('click', (e) => {
      const chip = e.target.closest('.filter-chip');
      if (!chip) return;
      const filter = chip.dataset.filter;
      if (filter === 'ALL') _invFilters.clear();
      else if (_invFilters.has(filter)) _invFilters.delete(filter);
      else _invFilters.add(filter);
      _invPage = 0;
      renderInventory();
    });
    document.getElementById('inv-pagination').addEventListener('click', (e) => {
      if (e.target.id === 'inv-prev') { _invPage--; renderInventory(); }
      else if (e.target.id === 'inv-next') { _invPage++; renderInventory(); }
    });
    document.getElementById('inv-pagination').addEventListener('change', (e) => {
      if (e.target.id === 'inv-page-size') {
        _invPageSize = parseInt(e.target.value, 10) || 50;
        localStorage.setItem(INV_PAGE_SIZE_KEY, String(_invPageSize));
        _invPage = 0;
        renderInventory();
      }
    });
    document.getElementById('user-search').addEventListener('input', (e) => {
      _userQuery = e.target.value;
      _usersPage = 0;
      renderUsers();
    });
    document.getElementById('users-pagination').addEventListener('click', (e) => {
      if (e.target.id === 'users-prev') { _usersPage--; renderUsers(); }
      else if (e.target.id === 'users-next') { _usersPage++; renderUsers(); }
    });

    const pasteInput = document.getElementById('paste-input');
    const fileInput = document.getElementById('file-input');
    const importBtn = document.getElementById('import-btn');
    const clearBtn = document.getElementById('clear-btn');
    const statusEl = document.getElementById('import-status');

    const scanBtn = document.getElementById('scan-btn');
    const scanStatusEl = document.getElementById('scan-status');
    scanBtn.addEventListener('click', () => {
      const checked = Array.from(document.querySelectorAll('#scan-tabs input[type=checkbox]'));
      const skipTabs = checked.filter((cb) => !cb.checked).map((cb) => cb.value);
      const script = buildScrapeScript(skipTabs);
      const done = () => {
        scanStatusEl.className = 'ok';
        scanStatusEl.textContent = 'Script gekopieerd! Open op de nieuwe tab de Console (F12) en plak (Ctrl+V) om te starten.';
        window.open('https://www.leet.city/ruilwaarde', '_blank');
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(script).then(done).catch(() => {
          scanStatusEl.className = 'err';
          scanStatusEl.textContent = 'Kopiëren naar klembord mislukt — geef de browser toestemming en probeer opnieuw.';
        });
      } else {
        scanStatusEl.className = 'err';
        scanStatusEl.textContent = 'Klembord-API niet beschikbaar in deze browser.';
      }
    });

    const bcScanBtn = document.getElementById('bc-scan-btn');
    const bcScanStatusEl = document.getElementById('bc-scan-status');
    bcScanBtn.addEventListener('click', () => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(BC_SHOP_SCRIPT).then(() => {
          bcScanStatusEl.className = 'ok';
          bcScanStatusEl.textContent = 'Script gekopieerd! Plak (Ctrl+V) in de console (F12) van de Hall of Fame-pagina.';
        }).catch(() => {
          bcScanStatusEl.className = 'err';
          bcScanStatusEl.textContent = 'Kopiëren naar klembord mislukt — geef de browser toestemming en probeer opnieuw.';
        });
      } else {
        bcScanStatusEl.className = 'err';
        bcScanStatusEl.textContent = 'Klembord-API niet beschikbaar in deze browser.';
      }
    });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { pasteInput.value = reader.result; };
      reader.readAsText(file);
    });

    importBtn.addEventListener('click', () => {
      let items;
      try {
        items = parseLooseJson(pasteInput.value);
      } catch (e) {
        statusEl.className = 'err';
        statusEl.textContent = 'Ongeldige JSON: ' + e.message;
        return;
      }
      importItems(items);
    });

    clearBtn.addEventListener('click', () => {
      pasteInput.value = '';
      fileInput.value = '';
      statusEl.className = '';
      statusEl.textContent = '';
      document.getElementById('results-card').style.display = 'none';
    });

    document.getElementById('saved-search').addEventListener('input', (e) => {
      _savedQuery = e.target.value;
      _savedPage = 0;
      renderSaved();
    });
    document.getElementById('saved-pagination').addEventListener('click', (e) => {
      if (e.target.id === 'saved-prev') { _savedPage--; renderSaved(); }
      else if (e.target.id === 'saved-next') { _savedPage++; renderSaved(); }
    });
    document.getElementById('saved-new-btn').addEventListener('click', () => openItemEditModal(null));
    document.getElementById('saved-body').addEventListener('click', (e) => {
      const row = e.target.closest('[data-action="edit-saved"]');
      if (!row) return;
      const item = _saved.find((r) => r.name === row.dataset.name);
      if (item) openItemEditModal(item);
    });
  }

  setupEvents();
  loadSaved();
  loadInventory();
  retryUnmatchedItems();

  // Fire-and-forget — lets the CPU/DB history panel on hub.databin.uk line spikes up
  // against actual site visits instead of showing an unexplained number.
  fetch(SB_URL + '/event_log', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ event: 'visit', detail: 'items' }),
  }).catch(() => {});
})();
