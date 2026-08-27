(function () {
  // Same self-hosted Postgres + PostgREST as the extension — see core/supabase.js.
  // Same-origin under Caddy on accounts.databin.uk (proxied to /rest/v1), so no CORS
  // header is needed as long as this site and the API share that domain.
  const SB_URL = '/rest/v1';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6ImdoZWxvby1zZWxmaG9zdCIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwfQ.9uAMhqRJOL-m_xtTO5duAUOAw-4pKk4LEENcT47crXU';

  const HEADERS = {
    apikey: SB_KEY,
    Authorization: 'Bearer ' + SB_KEY,
    'Content-Type': 'application/json',
  };

  const LINE_RE = /^(?<user>[^:]+):(?<pass>[^|]+?)\s*\|\s*Credits:\s*(?<account>\d+)\s*\|\s*BelCredits:\s*(?<vrienden>\d+)\s*\|\s*Rank:\s*(?<rank>\d+)/i;

  let _all = new Map();   // username -> row
  let _tab = 'all';
  let _query = '';
  let _sortKey = null;    // 'account' | 'vrienden' | 'rank' | null (default: username asc)
  let _sortDir = 'asc';
  let _page = 0;
  let _totalPages = 1;
  const PAGE_SIZE = 25;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function copyToClipboard(text, sourceEl) {
    navigator.clipboard.writeText(text).then(() => {
      if (!sourceEl) return;
      sourceEl.classList.add('copied-flash');
      const original = sourceEl.dataset.origLabel || sourceEl.textContent;
      sourceEl.dataset.origLabel = original;
      sourceEl.textContent = 'Gekopieerd!';
      setTimeout(() => {
        sourceEl.classList.remove('copied-flash');
        sourceEl.textContent = sourceEl.dataset.origLabel;
      }, 900);
    });
  }

  async function sbGet(path) {
    const res = await fetch(SB_URL + path, { headers: HEADERS });
    if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + (await res.text()));
    return res.json();
  }

  async function sbUpsert(path, body) {
    const res = await fetch(SB_URL + path, {
      method: 'POST',
      headers: Object.assign({}, HEADERS, { Prefer: 'resolution=merge-duplicates,return=representation' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + (await res.text()));
    return res.json();
  }

  async function sbPatch(path, body) {
    const res = await fetch(SB_URL + path, {
      method: 'PATCH',
      headers: Object.assign({}, HEADERS, { Prefer: 'return=representation' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + (await res.text()));
    return res.json();
  }

  // ── Load ─────────────────────────────────────────────────────────────────────
  async function loadAll() {
    const tbody = document.getElementById('tbl-body');
    try {
      const rows = await sbGet('/bot_accounts?select=*&order=username.asc');
      _all = new Map(rows.map((r) => [r.username, r]));
      render();
    } catch (e) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Fout bij laden: ' + esc(e.message) + '</td></tr>';
    }
  }

  // ── Import ───────────────────────────────────────────────────────────────────
  function parseList(text) {
    const rows = [];
    text.split('\n').forEach((line) => {
      line = line.trim();
      if (!line) return;
      const m = LINE_RE.exec(line);
      if (!m) return;
      rows.push({
        username: m.groups.user.trim(),
        password: m.groups.pass.trim(),
        account: parseInt(m.groups.account, 10),
        vrienden: parseInt(m.groups.vrienden, 10),
        rank: parseInt(m.groups.rank, 10),
      });
    });
    return rows;
  }

  async function importText(text) {
    const statusEl = document.getElementById('import-status');
    const rows = parseList(text);
    if (!rows.length) {
      statusEl.textContent = 'Geen geldige regels gevonden.';
      return;
    }
    statusEl.textContent = 'Uploaden van ' + rows.length + ' account(s)…';
    try {
      // category is deliberately omitted here — PostgREST's merge-duplicates upsert
      // only overwrites columns present in the payload, so an account's existing
      // goud/groen/rood tag survives being re-imported from a fresh list.
      const saved = await sbUpsert('/bot_accounts?on_conflict=username', rows);
      saved.forEach((r) => {
        const existing = _all.get(r.username);
        _all.set(r.username, existing ? Object.assign({}, existing, r) : r);
      });
      statusEl.textContent = rows.length + ' account(s) verwerkt (dubbele automatisch samengevoegd).';
      document.getElementById('import-text').value = '';
      render();
    } catch (e) {
      statusEl.textContent = 'Fout: ' + e.message;
    }
  }

  // ── Note editing ─────────────────────────────────────────────────────────────
  async function saveNote(username, note, inputEl) {
    const row = _all.get(username);
    if (!row || row.note === note) return;
    try {
      const saved = await sbPatch('/bot_accounts?username=eq.' + encodeURIComponent(username), { note });
      if (saved[0]) _all.set(username, Object.assign({}, row, saved[0]));
      if (inputEl) {
        inputEl.classList.add('note-saved');
        setTimeout(() => inputEl.classList.remove('note-saved'), 600);
      }
    } catch (e) {
      alert('Kon notitie niet opslaan: ' + e.message);
    }
  }

  // ── Category toggle ──────────────────────────────────────────────────────────
  async function setCategory(username, cat) {
    const row = _all.get(username);
    if (!row) return;
    const next = row.category === cat ? null : cat; // click again to unset
    try {
      const saved = await sbPatch('/bot_accounts?username=eq.' + encodeURIComponent(username), { category: next });
      if (saved[0]) _all.set(username, Object.assign({}, row, saved[0]));
      render();
    } catch (e) {
      alert('Kon categorie niet opslaan: ' + e.message);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  const MARKS = [
    { key: 'goud', title: 'Goud' },
    { key: 'groen', title: 'Groen' },
    { key: 'rood', title: 'Rood' },
  ];

  function markBtn(row) {
    return '<span class="mark-row">' + MARKS.map((m) => {
      const on = row.category === m.key ? ' on-' + m.key : '';
      return '<button class="mark-btn' + on + '" data-action="mark" data-username="' + esc(row.username) + '" data-cat="' + m.key + '" title="' + m.title + '">'
        + (row.category === m.key ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' : '')
        + '</button>';
    }).join('') + '</span>';
  }

  function copyText(text) {
    return '<button class="copy-txt" data-action="copy" data-copy="' + esc(text) + '" title="Klik om te kopiëren">' + esc(text) + '</button>';
  }

  function render() {
    const rows = Array.from(_all.values());
    const counts = { all: rows.length, goud: 0, groen: 0, rood: 0, none: 0 };
    rows.forEach((r) => {
      if (r.category === 'goud') counts.goud++;
      else if (r.category === 'groen') counts.groen++;
      else if (r.category === 'rood') counts.rood++;
      else counts.none++;
    });
    ['all', 'goud', 'groen', 'rood', 'none'].forEach((k) => {
      document.getElementById('cnt-' + k).textContent = counts[k];
    });

    let filtered = rows.filter((r) => {
      if (_tab === 'goud' || _tab === 'groen' || _tab === 'rood') return r.category === _tab;
      if (_tab === 'none') return !r.category;
      return true;
    });
    if (_query) {
      const q = _query.toLowerCase();
      filtered = filtered.filter((r) => r.username.toLowerCase().includes(q));
    }

    if (_sortKey) {
      const dir = _sortDir === 'desc' ? -1 : 1;
      filtered.sort((a, b) => (((a[_sortKey] ?? -Infinity) - (b[_sortKey] ?? -Infinity)) * dir) || a.username.localeCompare(b.username));
    } else {
      filtered.sort((a, b) => a.username.localeCompare(b.username));
    }

    document.querySelectorAll('.sort-th').forEach((el) => {
      el.classList.toggle('sort-asc', _sortKey === el.dataset.sort && _sortDir === 'asc');
      el.classList.toggle('sort-desc', _sortKey === el.dataset.sort && _sortDir === 'desc');
    });

    const titles = { all: 'Alle accounts', goud: 'Goud', groen: 'Groen', rood: 'Rood', none: 'Ongesorteerd' };
    document.getElementById('page-title').textContent = titles[_tab];

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (_page >= totalPages) _page = totalPages - 1;
    if (_page < 0) _page = 0;
    _totalPages = totalPages;
    const pageRows = filtered.slice(_page * PAGE_SIZE, _page * PAGE_SIZE + PAGE_SIZE);

    renderPagination(filtered.length, totalPages);

    const tbody = document.getElementById('tbl-body');
    if (!filtered.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7">' + (rows.length ? 'Geen resultaten.' : 'Nog geen accounts geïmporteerd.') + '</td></tr>';
      return;
    }
    tbody.innerHTML = pageRows.map((r) => (
      '<tr>'
      + '<td class="plain-cell">' + markBtn(r) + '</td>'
      + '<td>' + copyText(r.username) + '</td>'
      + '<td>' + copyText(r.password) + '</td>'
      + '<td class="plain-cell">' + (r.account != null ? r.account.toLocaleString() : '—') + '</td>'
      + '<td class="plain-cell">' + (r.vrienden ?? '—') + '</td>'
      + '<td class="plain-cell">' + (r.rank ?? '—') + '</td>'
      + '<td><input class="note-input" data-username="' + esc(r.username) + '" value="' + esc(r.note || '') + '" placeholder="…"></td>'
      + '</tr>'
    )).join('');
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
      + '<span class="page-info">/ ' + totalPages + ' (' + total + ' accounts)</span>'
      + '<button class="btn btn-outline" id="pg-next" title="Volgende"' + (atEnd ? ' disabled' : '') + '>&raquo;</button>'
      + '<button class="btn btn-outline" id="pg-fwd10" title="10 pagina\'s vooruit"' + (atEnd ? ' disabled' : '') + '>&raquo;&raquo;</button>'
      + '<button class="btn btn-outline" id="pg-last" title="Laatste pagina"' + (atEnd ? ' disabled' : '') + '>&raquo;&raquo;&raquo;</button>';
  }

  function gotoPage(n, totalPages) {
    _page = Math.min(Math.max(n, 0), totalPages - 1);
    render();
  }

  // ── Events ───────────────────────────────────────────────────────────────────
  function setupEvents() {
    document.getElementById('tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      _tab = btn.dataset.tab;
      _page = 0;
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === btn));
      render();
    });

    document.getElementById('search').addEventListener('input', (e) => {
      _query = e.target.value;
      _page = 0;
      render();
    });

    document.querySelector('thead').addEventListener('click', (e) => {
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

    document.getElementById('import-btn').addEventListener('click', () => {
      importText(document.getElementById('import-text').value);
    });

    document.getElementById('import-file-btn').addEventListener('click', () => {
      document.getElementById('import-file').click();
    });
    document.getElementById('import-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      file.text().then((text) => importText(text));
      e.target.value = '';
    });

    document.getElementById('tbl-body').addEventListener('click', (e) => {
      const markEl = e.target.closest('[data-action="mark"]');
      if (markEl) { setCategory(markEl.dataset.username, markEl.dataset.cat); return; }
      const copyEl = e.target.closest('[data-action="copy"]');
      if (copyEl) { copyToClipboard(copyEl.dataset.copy, copyEl); return; }
    });

    // 'blur' doesn't bubble — 'focusout' does, so delegation still works after re-render.
    document.getElementById('tbl-body').addEventListener('focusout', (e) => {
      if (!e.target.classList.contains('note-input')) return;
      saveNote(e.target.dataset.username, e.target.value, e.target);
    });
    document.getElementById('tbl-body').addEventListener('keydown', (e) => {
      if (e.target.classList.contains('note-input') && e.key === 'Enter') e.target.blur();
    });
  }

  setupEvents();
  loadAll();
})();
