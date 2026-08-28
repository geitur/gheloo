(function () {
  // Same self-hosted Postgres + PostgREST as the extension's Room Clone catalog scan
  // (extensions/rooms/room-clone.js pushes here) — see core/supabase.js for the setup.
  // Same-origin under Caddy on furnis.databin.uk (proxied to /rest/v1), so no CORS
  // header is needed for this site itself.
  const SB_URL = '/rest/v1';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6ImdoZWxvby1zZWxmaG9zdCIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwfQ.9uAMhqRJOL-m_xtTO5duAUOAw-4pKk4LEENcT47crXU';

  const HEADERS = {
    apikey: SB_KEY,
    Authorization: 'Bearer ' + SB_KEY,
    'Content-Type': 'application/json',
  };

  // Two intentionally separate datasets:
  //   furnis       — only offers actually seen in a real catalog scan (buyable).
  //   furni_master — every furni type in the hotel's furnidata, buyable or not (event/
  //                  quest/wired-effect types never show up in a catalog scan at all).
  const DATASETS = {
    furnis: {
      table: '/furnis?select=offer_id,name,furni_name,page_id,page_title,ints,updated_at&order=offer_id.asc&limit=50000',
      title: 'Catalogus',
      sub: 'Gescande offers uit de Room Clone-extensie, samengevoegd van alle gebruikers',
      statLbl: 'Unieke offers bekend',
      defaultSort: '_typeSort',
      columns: [
        { key: '_copy', label: '', isCopy: true },
        { key: 'ints', label: 'Type IDs', cls: 'ints-cell mono', isInts: true, sort: true, sortField: '_typeSort' },
        { key: 'furni_name', label: 'Naam' },
        { key: 'page_id', label: 'Page ID', sort: true, cls: 'mono' },
        { key: 'offer_id', label: 'Offer ID', sort: true, cls: 'mono' },
        { key: 'name', label: 'Classname', cls: 'mono' },
        { key: 'page_title', label: 'Omschrijving' },
      ],
    },
    master: {
      table: '/furni_master?select=type_id,name,description,classname,is_wall,created_at&order=type_id.asc&limit=50000',
      title: 'Alle Furni',
      sub: 'Complete furnidata (buyable of niet), gesynced vanuit spelers hun browser',
      statLbl: 'Furni types bekend',
      defaultSort: 'type_id',
      columns: [
        { key: 'type_id', label: 'Type ID', sort: true, cls: 'mono' },
        { key: 'name', label: 'Naam' },
        { key: 'classname', label: 'Classname', cls: 'mono' },
        { key: 'description', label: 'Omschrijving' },
        { key: 'is_wall', label: 'Type', isWall: true, sort: true },
        { key: 'created_at', label: 'Toegevoegd op', sort: true, isTime: true },
      ],
    },
  };

  // The game's own furnidata CDN sends Access-Control-Allow-Origin: * (verified via
  // curl -H "Origin: https://furnis.databin.uk"), so a real browser tab here can fetch
  // it directly — no VM/cron needed. The VM's own curl gets Cloudflare-challenged
  // (datacenter IP), but this is a normal visitor's browser, which just works.
  const FURNI_SOURCE_URL = 'https://images.leet.city/leet-asset-bundles/gamedata/leet_furni.json';

  async function syncMasterFromSource(onStatus) {
    onStatus('Bezig met ophalen van leet.city...');
    const res = await fetch(FURNI_SOURCE_URL);
    if (!res.ok) throw new Error('leet.city HTTP ' + res.status);
    const d = await res.json();
    // The source JSON itself has duplicate ids within the same room/wall array (78 +
    // 13 as of this writing) — a Map dedupes those before upserting, otherwise a
    // single batch can propose the same (type_id, is_wall) twice and Postgres rejects
    // the whole batch with "ON CONFLICT DO UPDATE command cannot affect row a second
    // time". Last occurrence wins, same as PostgREST's own merge-duplicates semantics.
    const now = new Date().toISOString();
    const roomMap = new Map();
    (d.roomitemtypes && d.roomitemtypes.furnitype || []).forEach((f) => {
      roomMap.set(f.id, { type_id: f.id, name: f.name, description: f.description, classname: f.classname, is_wall: false, updated_at: now });
    });
    const wallMap = new Map();
    (d.wallitemtypes && d.wallitemtypes.furnitype || []).forEach((f) => {
      wallMap.set(f.id, { type_id: f.id, name: f.name, description: f.description, classname: f.classname, is_wall: true, updated_at: now });
    });
    const rows = [...roomMap.values(), ...wallMap.values()];
    const BATCH = 1000;
    for (let i = 0; i < rows.length; i += BATCH) {
      onStatus('Bezig met synchen... ' + Math.min(i + BATCH, rows.length) + '/' + rows.length);
      const up = await fetch(SB_URL + '/furni_master?on_conflict=type_id,is_wall', {
        method: 'POST',
        headers: Object.assign({}, HEADERS, { Prefer: 'resolution=merge-duplicates' }),
        body: JSON.stringify(rows.slice(i, i + BATCH)),
      });
      if (!up.ok) throw new Error('Upsert HTTP ' + up.status + ': ' + (await up.text()));
    }
    return rows.length;
  }

  let _tab = 'furnis';
  let _all = [];
  let _query = '';
  let _sortKey = DATASETS.furnis.defaultSort;
  let _sortDir = 'asc';
  let _page = 0;
  let _totalPages = 1;
  const PAGE_SIZE = 500;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function relTime(iso) {
    if (!iso) return '—';
    const diff = (Date.now() - new Date(iso)) / 1000;
    if (diff < 60) return 'net';
    if (diff < 3600) return Math.floor(diff / 60) + 'm geleden';
    if (diff < 86400) return Math.floor(diff / 3600) + 'u geleden';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd geleden';
    return new Date(iso).toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // Cached for the page lifetime — furni_master doesn't change within a session, and
  // re-fetching 42k classname/name pairs on every Koopbaar load would be wasteful.
  let _classnameMapPromise = null;
  function getClassnameMap() {
    if (!_classnameMapPromise) {
      _classnameMapPromise = sbGet('/furni_master?select=classname,name&classname=not.is.null').then((rows) => {
        const map = new Map();
        rows.forEach((r) => { if (r.classname && r.name) map.set(r.classname, r.name); });
        return map;
      }).catch((e) => { _classnameMapPromise = null; throw e; });
    }
    return _classnameMapPromise;
  }

  async function sbGet(path) {
    const res = await fetch(SB_URL + path, { headers: HEADERS });
    if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + (await res.text()));
    return res.json();
  }

  function renderHead() {
    const ds = DATASETS[_tab];
    document.getElementById('thead-row').innerHTML = '<tr>' + ds.columns.map((c) => {
      if (!c.sort) return '<th>' + esc(c.label) + '</th>';
      return '<th><span class="sort-th" data-sort="' + (c.sortField || c.key) + '">' + esc(c.label)
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="18 15 12 9 6 15"/></svg></span></th>';
    }).join('') + '</tr>';
    document.getElementById('page-title').textContent = ds.title;
    document.getElementById('page-sub').textContent = ds.sub;
    document.getElementById('stat-lbl').textContent = ds.statLbl;
  }

  // Switching dataset always re-queries the DB fresh (rather than reusing whatever was
  // cached from the last load) — "Alle Furni" in particular is kept current by every
  // player's extension syncing window.FurniData on load, so opening this tab should
  // reflect whatever the community has synced most recently, not a stale first load.
  // Guards against a stale response landing after a newer one — clicking Koopbaar then
  // Alle Furni in quick succession could otherwise let the slower (first) request's
  // count/rows overwrite the tab actually being shown.
  let _loadSeq = 0;

  async function loadTab(tab) {
    const seq = ++_loadSeq;
    _tab = tab;
    _sortKey = DATASETS[tab].defaultSort;
    _sortDir = 'asc';
    _page = 0;
    _query = '';
    document.getElementById('search').value = '';
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    renderHead();
    const tbody = document.getElementById('tbl-body');
    const colspan = DATASETS[tab].columns.length;
    tbody.innerHTML = '<tr class="empty-row"><td colspan="' + colspan + '">Laden…</td></tr>';

    if (tab === 'master') {
      // Only re-check the source once a day per browser — furnidata barely changes,
      // and re-fetching + re-upserting 42k rows on every tab click is wasted work.
      const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
      let lastSync = 0;
      try { lastSync = parseInt(localStorage.getItem('__furnis_last_sync') || '0', 10); } catch (_) {}
      if (Date.now() - lastSync > SYNC_INTERVAL_MS) {
        const setStatus = (msg) => { if (seq === _loadSeq) tbody.innerHTML = '<tr class="empty-row"><td colspan="' + colspan + '">' + esc(msg) + '</td></tr>'; };
        try {
          const count = await syncMasterFromSource(setStatus);
          try { localStorage.setItem('__furnis_last_sync', String(Date.now())); } catch (_) {}
          setStatus('Klaar — ' + count.toLocaleString() + ' furni type(s) gesynced. Laden…');
        } catch (e) {
          console.warn('[Furnis] live sync failed, showing last known data:', e);
          setStatus('Live sync mislukt (' + e.message + ') — toont laatst bekende data. Laden…');
        }
      }
    }
    if (seq !== _loadSeq) return; // a newer tab click superseded this one while syncing

    try {
      const rows = await sbGet(DATASETS[tab].table);
      if (seq !== _loadSeq) return;
      // furnis.name IS the furni's classname (see _resolveFurniName in room-clone.js) —
      // furni_master has the real name for every classname, buyable or not, so any
      // offer whose furni_name is still empty (older rows pushed before that resolver
      // existed, or a session where FurniData hadn't loaded yet) gets filled in here
      // from the more complete master list instead of showing blank forever.
      if (tab === 'furnis') {
        const classnameMap = await getClassnameMap();
        rows.forEach((r) => {
          if (!r.furni_name) r.furni_name = classnameMap.get(r.name) || null;
          r._typeSort = r.ints && r.ints.length ? Math.min.apply(null, r.ints) : null;
        });
        if (seq !== _loadSeq) return;
      }
      _all = rows;
      document.getElementById('stat-count').textContent = rows.length.toLocaleString();
      render();
    } catch (e) {
      if (seq === _loadSeq) tbody.innerHTML = '<tr class="empty-row"><td colspan="' + colspan + '">Fout bij laden: ' + esc(e.message) + '</td></tr>';
    }
  }

  // Highlights the current search term inside a cell — matches against the escaped
  // text so injecting <mark> tags can't land inside/break an entity like &amp;.
  function highlightText(raw, query) {
    const escaped = esc(raw);
    const q = (query || '').trim();
    if (!q) return escaped;
    const escQ = esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escaped.replace(new RegExp('(' + escQ + ')', 'ig'), '<mark class="hl-match">$1</mark>');
  }

  function cellHtml(col, row) {
    const v = row[col.key];
    if (col.isCopy) {
      return '<td style="padding:6px 10px;width:1%"><button class="copy-btn" data-action="copy-packet" data-page-id="' + esc(row.page_id) + '" data-offer-id="' + esc(row.offer_id) + '" title="Kopieer PurchaseFromCatalog packet">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
        + '</button></td>';
    }
    if (col.isInts) {
      const joined = (v || []).join(', ');
      return '<td class="' + (col.cls || '') + '" title="' + esc(joined) + '">' + (joined ? highlightText(joined, _query) : '—') + '</td>';
    }
    if (col.isTime) return '<td>' + esc(relTime(v)) + '</td>';
    if (col.isWall) return '<td>' + (v ? 'Muur' : 'Vloer') + '</td>';
    const text = v == null || v === '' ? null : String(v);
    return '<td class="' + (col.cls || '') + '">' + (text ? highlightText(text, _query) : '—') + '</td>';
  }

  function render() {
    const ds = DATASETS[_tab];
    let filtered = _all;
    if (_query) {
      const q = _query.toLowerCase();
      // Searches every column shown for this dataset, not a fixed subset — a search
      // term can match any visible field (name, classname, ids, description, ...).
      filtered = filtered.filter((r) => ds.columns.some((c) => {
        const v = r[c.key];
        if (v == null) return false;
        return (Array.isArray(v) ? v.join(', ') : String(v)).toLowerCase().includes(q);
      }));
    }

    const dir = _sortDir === 'desc' ? -1 : 1;
    filtered = filtered.slice().sort((a, b) => {
      const av = a[_sortKey], bv = b[_sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });

    document.querySelectorAll('.sort-th').forEach((el) => {
      el.classList.toggle('sort-asc', _sortKey === el.dataset.sort && _sortDir === 'asc');
      el.classList.toggle('sort-desc', _sortKey === el.dataset.sort && _sortDir === 'desc');
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (_page >= totalPages) _page = totalPages - 1;
    if (_page < 0) _page = 0;
    _totalPages = totalPages;
    const pageRows = filtered.slice(_page * PAGE_SIZE, _page * PAGE_SIZE + PAGE_SIZE);

    renderPagination(filtered.length, totalPages);

    const tbody = document.getElementById('tbl-body');
    if (!filtered.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="' + ds.columns.length + '">' + (_all.length ? 'Geen resultaten.' : 'Nog geen data bekend.') + '</td></tr>';
      return;
    }
    tbody.innerHTML = pageRows.map((r) => '<tr>' + ds.columns.map((c) => cellHtml(c, r)).join('') + '</tr>').join('');
  }

  function renderPagination(total, totalPages) {
    const el = document.getElementById('pagination');
    if (!total) { el.innerHTML = ''; return; }
    const atStart = _page <= 0, atEnd = _page >= totalPages - 1;
    el.innerHTML =
      '<button class="btn btn-outline" id="pg-first" title="Eerste pagina"' + (atStart ? ' disabled' : '') + '>&laquo;&laquo;&laquo;</button>'
      + '<button class="btn btn-outline" id="pg-back10" title="10 pagina\'s terug"' + (atStart ? ' disabled' : '') + '>&laquo;&laquo;</button>'
      + '<button class="btn btn-outline" id="pg-prev" title="Vorige"' + (atStart ? ' disabled' : '') + '>&laquo;</button>'
      + '<input class="page-jump" id="pg-jump" type="number" min="1" max="' + totalPages + '" value="' + (_page + 1) + '">'
      + '<span class="page-info">/ ' + totalPages + ' (' + total.toLocaleString() + ' rijen, 500/pagina)</span>'
      + '<button class="btn btn-outline" id="pg-next" title="Volgende"' + (atEnd ? ' disabled' : '') + '>&raquo;</button>'
      + '<button class="btn btn-outline" id="pg-fwd10" title="10 pagina\'s vooruit"' + (atEnd ? ' disabled' : '') + '>&raquo;&raquo;</button>'
      + '<button class="btn btn-outline" id="pg-last" title="Laatste pagina"' + (atEnd ? ' disabled' : '') + '>&raquo;&raquo;&raquo;</button>';
  }

  function gotoPage(n, totalPages) {
    _page = Math.min(Math.max(n, 0), totalPages - 1);
    render();
  }

  function setupEvents() {
    document.querySelectorAll('.tab').forEach((t) => {
      t.addEventListener('click', () => loadTab(t.dataset.tab));
    });

    document.getElementById('search').addEventListener('input', (e) => {
      _query = e.target.value;
      _page = 0;
      render();
    });

    document.getElementById('thead-row').addEventListener('click', (e) => {
      const th = e.target.closest('.sort-th');
      if (!th) return;
      const key = th.dataset.sort;
      if (_sortKey === key) _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
      else { _sortKey = key; _sortDir = 'asc'; }
      _page = 0;
      render();
    });

    document.getElementById('pagination').addEventListener('click', (e) => {
      switch (e.target.id) {
        case 'pg-first':  gotoPage(0, _totalPages); break;
        case 'pg-back10': gotoPage(_page - 10, _totalPages); break;
        case 'pg-prev':   gotoPage(_page - 1, _totalPages); break;
        case 'pg-next':   gotoPage(_page + 1, _totalPages); break;
        case 'pg-fwd10':  gotoPage(_page + 10, _totalPages); break;
        case 'pg-last':   gotoPage(_totalPages - 1, _totalPages); break;
      }
    });
    document.getElementById('pagination').addEventListener('keydown', (e) => {
      if (e.target.id === 'pg-jump' && e.key === 'Enter') {
        gotoPage(parseInt(e.target.value, 10) - 1 || 0, _totalPages);
      }
    });
    document.getElementById('pagination').addEventListener('focusout', (e) => {
      if (e.target.id === 'pg-jump') gotoPage(parseInt(e.target.value, 10) - 1 || 0, _totalPages);
    });

    document.getElementById('tbl-body').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="copy-packet"]');
      if (!btn) return;
      const packet = '{out:PurchaseFromCatalog}{i:' + btn.dataset.pageId + '}{i:' + btn.dataset.offerId + '}{i:0}{b:false}{b:true}';
      navigator.clipboard.writeText(packet).then(() => {
        btn.classList.add('copied');
        setTimeout(() => btn.classList.remove('copied'), 900);
      });
    });

    document.getElementById('export-btn').addEventListener('click', exportTxt);
  }

  // Exports the FULL dataset (_all — already the whole table, unaffected by the
  // search box or pagination) as a tab-separated .txt, one line per row.
  function exportTxt() {
    const ds = DATASETS[_tab];
    const cols = ds.columns.filter((c) => !c.isCopy);
    const lines = [cols.map((c) => c.label || c.key).join('\t')];
    _all.forEach((r) => {
      lines.push(cols.map((c) => {
        const v = r[c.key];
        if (c.isInts) return (v || []).join(',');
        if (c.isWall) return v ? 'Muur' : 'Vloer';
        return v == null ? '' : String(v);
      }).join('\t'));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (_tab === 'furnis' ? 'furnis-koopbaar' : 'furnis-alle-furni') + '.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  setupEvents();
  loadTab('furnis');

  // Fire-and-forget — lets the CPU/DB history panel on hub.databin.uk line spikes up
  // against actual site visits instead of showing an unexplained number.
  fetch(SB_URL + '/event_log', {
    method: 'POST', headers: HEADERS,
    body: JSON.stringify({ event: 'visit', detail: 'furnis' }),
  }).catch(() => {});
})();
