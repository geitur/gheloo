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

  const LINE_RE = /^(?<user>[^:]+):(?<pass>[^|]+?)\s*\|\s*Credits:\s*(?<account>\d+)\s*\|\s*BelCredits:\s*(?<vrienden>\d+)\s*\|\s*Rank:\s*(?<rank>\d+)(?:\s*\|\s*Diamonds:\s*(?<diamonds>\d+))?(?:\s*\|\s*Duckets:\s*(?<duckets>\d+))?/i;

  let _all = new Map();   // username -> row
  let _catNotes = new Map(); // category key -> note text
  // Empty set = "Alle" (everything). Otherwise a union of every checked category —
  // clicking a color tab toggles it on/off without clearing the others, "Alle" always
  // resets back to the empty (show-everything) state.
  let _selectedCats = new Set();
  let _query = '';
  let _sortKey = null;    // 'account' | 'vrienden' | 'rank' | null (default: username asc)
  let _sortDir = 'asc';
  let _page = 0;
  let _totalPages = 1;
  const PAGE_SIZE_OPTIONS = [15, 25, 50];
  const PAGE_SIZE_KEY = 'gheloo_accounts_page_size';
  let _pageSize = 25;
  try {
    const saved = parseInt(localStorage.getItem(PAGE_SIZE_KEY), 10);
    if (PAGE_SIZE_OPTIONS.includes(saved)) _pageSize = saved;
  } catch (e) {}

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

  // Fire-and-forget row in event_log — lets the CPU/DB history panel on hub.databin.uk
  // line spikes up against what actually happened (an import, a page visit, ...) instead
  // of just showing an unexplained number. Never blocks/throws on the caller.
  function logEvent(event, detail) {
    fetch(SB_URL + '/event_log', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ event: event, detail: detail || null }),
    }).catch(function () {});
  }

  // ── Load ─────────────────────────────────────────────────────────────────────
  async function loadAll() {
    const tbody = document.getElementById('tbl-body');
    try {
      const rows = await sbGet('/bot_accounts?select=*&order=username.asc');
      _all = new Map(rows.map((r) => [r.username, r]));
      render();
      // Re-check a miss after a day, not every single page load — the player may just not
      // have existed in userdatabase yet on the first pass (see sql/bot_accounts.sql).
      const GAMEID_RETRY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
      const now = Date.now();
      resolveGameIds(rows.filter((r) => r.game_id == null
        && (!r.game_id_checked_at || now - new Date(r.game_id_checked_at).getTime() > GAMEID_RETRY_COOLDOWN_MS)
      ).map((r) => r.username));
    } catch (e) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="11">Fout bij laden: ' + esc(e.message) + '</td></tr>';
    }
    try {
      const notes = await sbGet('/category_notes?select=*');
      _catNotes = new Map(notes.map((n) => [n.category, n.note]));
    } catch (e) { /* table may not exist yet */ }
  }

  // ── Game id resolution ──────────────────────────────────────────────────────
  // bot_accounts.game_id already existed in the schema (sql/bot_accounts.sql) but nothing
  // ever filled it in. userlogger.databin.uk's `users` table (fed by the extension's own
  // background player-scanning) already has every account it has ever seen, keyed by a
  // pre-lowercased `name_lower` column — matching against that instead of `name` makes the
  // lookup case-insensitive for free, no separate ilike-fallback pass needed (unlike
  // user-database.js's _bcResolveNames, which has to fall back to ilike since it only has
  // `name` to work with).
  const USERDB_URL = 'https://userlogger.databin.uk/rest/v1';
  const GAMEID_CHUNK = 250;
  const GAMEID_CHUNK_GAP_MS = 1000; // ~250 accounts/sec, paced so a 9000+ account backfill
  // doesn't fire one giant burst of requests at page load and doesn't block the UI thread.
  function _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // Called both right after a fresh import (just the newly-touched usernames, so new
  // accounts get their id immediately) and once per page load for every existing account
  // still eligible for a (re)check (self-heals as userdatabase picks up more players over
  // time — see the cooldown gate in loadAll()).
  async function resolveGameIds(usernames) {
    const pending = usernames.slice();
    while (pending.length) {
      const chunk = pending.splice(0, GAMEID_CHUNK);
      const inList = encodeURIComponent(chunk.map((u) => '"' + u.toLowerCase().replace(/"/g, '\\"') + '"').join(','));
      let found = [];
      try {
        found = await fetch(USERDB_URL + '/users?select=id,name_lower&name_lower=in.(' + inList + ')', { headers: HEADERS }).then((r) => r.json());
      } catch (e) { found = []; }
      const idByLower = new Map(found.map((row) => [row.name_lower, row.id]));
      const nowIso = new Date().toISOString();
      // password is NOT NULL with no default — PostgREST validates that on the attempted
      // INSERT even for an on_conflict DO UPDATE, so a sparse patch omitting it 400s even
      // though the row already exists and the update would never have touched that column.
      // Every row in the chunk gets written back (hit or miss) so a miss's checked_at is
      // actually stamped, which is what lets the cooldown gate below skip it next time
      // instead of re-querying a name that plainly isn't in userdatabase yet.
      const patchRows = chunk.map((username) => {
        const existing = _all.get(username);
        return {
          username: username,
          password: existing ? existing.password : '',
          game_id: idByLower.get(username.toLowerCase()) || null,
          game_id_checked: true,
          game_id_checked_at: nowIso,
        };
      });
      try {
        const updated = await sbUpsert('/bot_accounts?on_conflict=username', patchRows);
        updated.forEach((u) => {
          const existing = _all.get(u.username);
          if (existing) Object.assign(existing, u);
        });
        render();
      } catch (e) { /* this chunk gets retried once its cooldown lapses (or next reload if never stamped) */ }
      if (pending.length) await _sleep(GAMEID_CHUNK_GAP_MS);
    }
  }

  // ── Live category sync ──────────────────────────────────────────────────────
  // No realtime/websocket service on this self-hosted stack (just Postgres+PostgREST,
  // no Supabase Realtime) — so "live" here means polling for rows this browser hasn't
  // seen yet. bot_accounts.updated_at now auto-bumps on every UPDATE via a DB trigger
  // (it previously only had an INSERT default, so a plain category PATCH never actually
  // changed it — polling on it would have silently caught nothing). Scoped to
  // username+category+updated_at only, not a full row re-fetch, so this stays cheap at
  // 9000+ accounts even polled every few seconds.
  let _lastCategorySync = null;
  async function pollCategoryChanges() {
    if (_lastCategorySync == null) return;
    try {
      const rows = await sbGet('/bot_accounts?select=username,category,updated_at&updated_at=gt.'
        + encodeURIComponent(_lastCategorySync) + '&order=updated_at.asc');
      if (!rows.length) return;
      let changed = false;
      rows.forEach((r) => {
        const existing = _all.get(r.username);
        if (existing && existing.category !== r.category) {
          _all.set(r.username, Object.assign({}, existing, { category: r.category }));
          changed = true;
        }
        if (r.updated_at > _lastCategorySync) _lastCategorySync = r.updated_at;
      });
      if (changed) render();
    } catch (e) { /* best-effort — a missed poll just gets caught on the next one */ }
  }

  // ── Category note ────────────────────────────────────────────────────────────
  async function saveCategoryNote(category, note) {
    const statusEl = document.getElementById('catnote-status');
    try {
      await sbUpsert('/category_notes?on_conflict=category', [{ category, note }]);
      _catNotes.set(category, note);
      if (statusEl) {
        statusEl.textContent = 'Opgeslagen.';
        setTimeout(() => { if (statusEl.textContent === 'Opgeslagen.') statusEl.textContent = ''; }, 1500);
      }
    } catch (e) {
      if (statusEl) statusEl.textContent = 'Fout: ' + e.message;
    }
  }

  // Import card only makes sense on "Alle"; the category note only makes sense when
  // exactly one category is checked (a note is per-category, not per-combination).
  function showTopCard() {
    const isAll = _selectedCats.size === 0;
    const singleCat = _selectedCats.size === 1 ? Array.from(_selectedCats)[0] : null;
    document.getElementById('import-card').style.display = isAll ? '' : 'none';
    document.getElementById('catnote-card').style.display = singleCat ? '' : 'none';
    if (singleCat) {
      document.getElementById('catnote-text').value = _catNotes.get(singleCat) || '';
      document.getElementById('catnote-text').readOnly = true;
      document.getElementById('catnote-status').textContent = '';
    }
  }

  function updateActiveTabs() {
    document.querySelectorAll('.tab').forEach((t) => {
      const key = t.dataset.tab;
      t.classList.toggle('active', key === 'all' ? _selectedCats.size === 0 : _selectedCats.has(key));
    });
  }

  // ── Import ───────────────────────────────────────────────────────────────────
  function parseList(text) {
    // Deduped by username, last occurrence wins — a single upsert batch containing the
    // same on_conflict key twice makes Postgres reject the whole thing ("ON CONFLICT DO
    // UPDATE command cannot affect row a second time"), which combo/scraped lists trigger
    // often since the same account can legitimately appear more than once in one paste.
    const byUsername = new Map();
    text.split('\n').forEach((line) => {
      line = line.trim();
      if (!line) return;
      const m = LINE_RE.exec(line);
      if (!m) return;
      const username = m.groups.user.trim();
      // diamonds/duckets are a newer addition to the import format — an older-format
      // paste won't have them. The key still has to be present on every row regardless
      // (PostgREST rejects a bulk upsert where some rows have a column and others don't),
      // so fall back to whatever's already stored for this account instead of blanking it.
      const existing = _all.get(username);
      byUsername.set(username, {
        username: username,
        password: m.groups.pass.trim(),
        account: parseInt(m.groups.account, 10),
        vrienden: parseInt(m.groups.vrienden, 10),
        rank: parseInt(m.groups.rank, 10),
        diamonds: m.groups.diamonds != null ? parseInt(m.groups.diamonds, 10) : (existing ? existing.diamonds : null),
        duckets: m.groups.duckets != null ? parseInt(m.groups.duckets, 10) : (existing ? existing.duckets : null),
      });
    });
    return Array.from(byUsername.values());
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
      logEvent('import', rows.length + ' accounts');
      document.getElementById('import-text').value = '';
      render();
      resolveGameIds(rows.map((r) => r.username));
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

  // ── Category toggle (with undo/redo) ────────────────────────────────────────
  let _undoStack = [];
  let _redoStack = [];

  async function applyCategory(username, cat) {
    const row = _all.get(username);
    if (!row) return false;
    try {
      const saved = await sbPatch('/bot_accounts?username=eq.' + encodeURIComponent(username), { category: cat });
      if (saved[0]) {
        _all.set(username, Object.assign({}, row, saved[0]));
        // Advance the poll watermark past our own change so pollCategoryChanges doesn't
        // immediately re-fetch (and redundantly re-render) the edit we just made locally.
        if (_lastCategorySync != null && saved[0].updated_at > _lastCategorySync) _lastCategorySync = saved[0].updated_at;
      }
      render();
      return true;
    } catch (e) {
      alert('Kon categorie niet opslaan: ' + e.message);
      return false;
    }
  }

  async function setCategory(username, cat) {
    const row = _all.get(username);
    if (!row) return;
    const prev = row.category;
    const next = prev === cat ? null : cat; // click again to unset
    if (await applyCategory(username, next)) {
      _undoStack.push({ username, prev, next });
      _redoStack = [];
    }
  }

  async function undoCategory() {
    const action = _undoStack.pop();
    if (!action) return;
    if (await applyCategory(action.username, action.prev)) _redoStack.push(action);
  }

  async function redoCategory() {
    const action = _redoStack.pop();
    if (!action) return;
    if (await applyCategory(action.username, action.next)) _undoStack.push(action);
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  const MARKS = [
    { key: 'blauw', title: 'Blauw' },
    { key: 'paars', title: 'Paars' },
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

  function highlightMatch(text, query) {
    text = text || '';
    if (!query) return esc(text);
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return esc(text);
    return esc(text.slice(0, idx)) + '<mark class="search-hit">' + esc(text.slice(idx, idx + query.length)) + '</mark>' + esc(text.slice(idx + query.length));
  }
  function copyText(text, query) {
    return '<button class="copy-txt" data-action="copy" data-copy="' + esc(text) + '" title="Klik om te kopiëren">' + highlightMatch(text, query) + '</button>';
  }

  // Same filter+sort logic render() uses for the table — pulled out so Export can dump
  // the exact set/order currently on screen (minus pagination) without duplicating it.
  function getFilteredSorted() {
    const rows = Array.from(_all.values());
    let filtered = rows.filter((r) => {
      if (_selectedCats.size === 0) return true;
      return _selectedCats.has(r.category || 'none');
    });
    if (_query) {
      const q = _query.toLowerCase();
      filtered = filtered.filter((r) => r.username.toLowerCase().includes(q) || (r.password || '').toLowerCase().includes(q));
    }

    if (_query) {
      // Searching: closest match first (exact, then starts-with, then contains — checked
      // across both username and password, whichever field matches best for that row),
      // column sort takes a back seat while a query is active.
      const q = _query.toLowerCase();
      const fieldScore = (val) => {
        const v = (val || '').toLowerCase();
        if (v === q) return 0;
        if (v.indexOf(q) === 0) return 1;
        if (v.indexOf(q) !== -1) return 2;
        return 3;
      };
      const score = (r) => Math.min(fieldScore(r.username), fieldScore(r.password));
      filtered.sort((a, b) => score(a) - score(b) || a.username.localeCompare(b.username));
    } else if (_sortKey === 'created_at') {
      const dir = _sortDir === 'desc' ? -1 : 1;
      filtered.sort((a, b) => ((new Date(a.created_at || 0) - new Date(b.created_at || 0)) * dir) || a.username.localeCompare(b.username));
    } else if (_sortKey === 'note') {
      // Text field, not numeric — "up" means accounts WITH a note first, same up/down
      // convention as the numeric columns, just keyed on presence instead of magnitude.
      const dir = _sortDir === 'desc' ? -1 : 1;
      filtered.sort((a, b) => ((((b.note ? 1 : 0)) - (a.note ? 1 : 0)) * dir) || a.username.localeCompare(b.username));
    } else if (_sortKey) {
      const dir = _sortDir === 'desc' ? -1 : 1;
      filtered.sort((a, b) => (((a[_sortKey] ?? -Infinity) - (b[_sortKey] ?? -Infinity)) * dir) || a.username.localeCompare(b.username));
    } else {
      filtered.sort((a, b) => a.username.localeCompare(b.username));
    }
    return filtered;
  }

  function openModal(title, bodyHtml) {
    document.getElementById('modal-title').innerHTML = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-overlay').classList.add('open');
  }
  function closeModal() {
    document.getElementById('modal-overlay').classList.remove('open');
  }

  const EXPORT_FIELDS = [
    { key: 'username', label: 'Naam' },
    { key: 'password', label: 'Wachtwoord' },
    { key: 'account', label: 'Credits' },
    { key: 'duckets', label: 'Duckets' },
    { key: 'diamonds', label: 'Diamonds' },
    { key: 'vrienden', label: 'BelCredits' },
    { key: 'rank', label: 'Rank' },
    { key: 'note', label: 'Notitie' },
  ];

  // ── Password stats ──────────────────────────────────────────────────────────
  function openPasswordStatsModal() {
    const rows = Array.from(_all.values()).filter((r) => r.password);
    const counts = new Map();
    rows.forEach((r) => counts.set(r.password, (counts.get(r.password) || 0) + 1));
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const reused = sorted.filter((e) => e[1] > 1);

    const summary = '<div class="desc" style="margin-bottom:12px">'
      + rows.length.toLocaleString('nl-BE') + ' accounts met wachtwoord, '
      + sorted.length.toLocaleString('nl-BE') + ' unieke wachtwoorden, '
      + reused.length.toLocaleString('nl-BE') + ' hergebruikt (op meer dan 1 account).</div>';

    const tbl = '<div class="pwd-stats-wrap"><table class="pwd-stats-tbl"><thead><tr><th>Wachtwoord</th><th>Aantal accounts</th></tr></thead><tbody>'
      + sorted.map((e) => '<tr><td>' + esc(e[0]) + '</td><td>' + e[1] + '</td></tr>').join('')
      + '</tbody></table></div>';

    openModal('Wachtwoord Stats', summary + tbl);
  }

  function openExportModal() {
    openModal(
      'Exporteren',
      '<div class="desc" style="margin-bottom:12px">Kies welke velden je wil exporteren.</div>'
      + '<div class="row" id="export-fields">'
      + EXPORT_FIELDS.map((f) => (
        '<label style="display:inline-flex;align-items:center;gap:6px;background:var(--input);border:1px solid var(--border);border-radius:20px;padding:6px 12px;cursor:pointer;font-size:12px">'
        + '<input type="checkbox" value="' + f.key + '" checked style="width:auto"> ' + f.label + '</label>'
      )).join('')
      + '</div>'
      + '<div class="row" style="margin-top:16px">'
      + '<button class="btn btn-blue" id="export-confirm-btn">Exporteer</button>'
      + '<button class="btn btn-outline" id="export-cancel-btn">Annuleren</button>'
      + '</div>'
      + '<div id="export-modal-status" style="font-size:12px;margin-top:8px"></div>'
    );
    document.getElementById('export-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('export-confirm-btn').addEventListener('click', () => {
      const checked = Array.from(document.querySelectorAll('#export-fields input:checked')).map((el) => el.value);
      const statusEl = document.getElementById('export-modal-status');
      if (!checked.length) {
        statusEl.className = 'err';
        statusEl.textContent = 'Kies minstens 1 veld.';
        return;
      }
      exportCurrentView(checked);
      closeModal();
    });
  }

  function exportCurrentView(fields) {
    const filtered = getFilteredSorted();
    const hasUser = fields.includes('username');
    const hasPass = fields.includes('password');
    const lines = filtered.map((r) => {
      const parts = [];
      if (hasUser && hasPass) parts.push(r.username + ':' + (r.password || ''));
      else if (hasUser) parts.push(r.username);
      else if (hasPass) parts.push(r.password || '');
      if (fields.includes('account')) parts.push('Credits: ' + (r.account ?? 0));
      if (fields.includes('vrienden')) parts.push('BelCredits: ' + (r.vrienden ?? 0));
      if (fields.includes('rank')) parts.push('Rank: ' + (r.rank ?? 0));
      if (fields.includes('note')) parts.push('Notitie: ' + (r.note || ''));
      return parts.join(' | ');
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const tabLabel = _selectedCats.size === 0 ? 'all' : Array.from(_selectedCats).join('-');
    a.download = 'gheloo-accounts-' + tabLabel + '-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function render() {
    const rows = Array.from(_all.values());
    const counts = { all: rows.length, goud: 0, groen: 0, rood: 0, paars: 0, blauw: 0, none: 0 };
    rows.forEach((r) => {
      if (r.category === 'goud') counts.goud++;
      else if (r.category === 'groen') counts.groen++;
      else if (r.category === 'rood') counts.rood++;
      else if (r.category === 'paars') counts.paars++;
      else if (r.category === 'blauw') counts.blauw++;
      else counts.none++;
    });
    ['all', 'goud', 'groen', 'rood', 'paars', 'blauw', 'none'].forEach((k) => {
      document.getElementById('cnt-' + k).textContent = counts[k].toLocaleString('nl-BE');
    });

    updateActiveTabs();
    showTopCard();

    const filtered = getFilteredSorted();

    document.querySelectorAll('.sort-th').forEach((el) => {
      el.classList.toggle('sort-asc', _sortKey === el.dataset.sort && _sortDir === 'asc');
      el.classList.toggle('sort-desc', _sortKey === el.dataset.sort && _sortDir === 'desc');
    });

    const titles = { goud: 'Goud', groen: 'Groen', rood: 'Rood', paars: 'Paars', blauw: 'Blauw', none: 'Ongesorteerd' };
    document.getElementById('page-title').textContent = _selectedCats.size === 0
      ? 'Alle accounts'
      : Array.from(_selectedCats).map((k) => titles[k]).join(' + ');

    const totalPages = Math.max(1, Math.ceil(filtered.length / _pageSize));
    if (_page >= totalPages) _page = totalPages - 1;
    if (_page < 0) _page = 0;
    _totalPages = totalPages;
    const pageRows = filtered.slice(_page * _pageSize, _page * _pageSize + _pageSize);

    renderPagination(filtered.length, totalPages);

    const tbody = document.getElementById('tbl-body');
    if (!filtered.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="11">' + (rows.length ? 'Geen resultaten.' : 'Nog geen accounts geïmporteerd.') + '</td></tr>';
      return;
    }
    tbody.innerHTML = pageRows.map((r) => (
      '<tr>'
      + '<td class="plain-cell">' + markBtn(r) + '</td>'
      + '<td class="plain-cell">' + (r.game_id != null ? copyText(String(r.game_id), '') : '—') + '</td>'
      + '<td>' + copyText(r.username, _query) + '</td>'
      + '<td>' + copyText(r.password, _query) + '</td>'
      + '<td class="plain-cell">' + (r.account != null ? r.account.toLocaleString() : '—') + '</td>'
      + '<td class="plain-cell">' + (r.duckets ?? '—') + '</td>'
      + '<td class="plain-cell">' + (r.diamonds ?? '—') + '</td>'
      + '<td class="plain-cell">' + (r.vrienden ?? '—') + '</td>'
      + '<td class="plain-cell">' + (r.rank ?? '—') + '</td>'
      + '<td class="plain-cell">' + (r.created_at ? new Date(r.created_at).toLocaleString('nl-BE') : '—') + '</td>'
      + '<td><input class="note-input" data-username="' + esc(r.username) + '" value="' + esc(r.note || '') + '" placeholder="…"></td>'
      + '</tr>'
    )).join('');
  }

  function renderPagination(total, totalPages) {
    const el = document.getElementById('pagination');
    if (!total) { el.innerHTML = ''; return; }
    // A rebuild while the user is mid-type in the page-jump box would wipe out what they
    // just typed and drop focus. Skip the rebuild while it's focused; it catches up on
    // the next render once they blur/submit.
    if (document.activeElement && document.activeElement.id === 'pg-jump') return;
    const atStart = _page <= 0, atEnd = _page >= totalPages - 1;
    el.innerHTML =
      '<button class="btn btn-outline" id="pg-first" title="Eerste pagina"' + (atStart ? ' disabled' : '') + '>&laquo;&laquo;&laquo;</button>'
      + '<button class="btn btn-outline" id="pg-back10" title="10 pagina\'s terug"' + (atStart ? ' disabled' : '') + '>&laquo;&laquo;</button>'
      + '<button class="btn btn-outline" id="pg-prev" title="Vorige"' + (atStart ? ' disabled' : '') + '>&laquo;</button>'
      + '<input class="page-jump" id="pg-jump" type="number" min="1" max="' + totalPages + '" value="' + (_page + 1) + '">'
      + '<span class="page-info">/ ' + totalPages + ' (' + total.toLocaleString('nl-BE') + ' accounts)</span>'
      + '<button class="btn btn-outline" id="pg-next" title="Volgende"' + (atEnd ? ' disabled' : '') + '>&raquo;</button>'
      + '<button class="btn btn-outline" id="pg-fwd10" title="10 pagina\'s vooruit"' + (atEnd ? ' disabled' : '') + '>&raquo;&raquo;</button>'
      + '<button class="btn btn-outline" id="pg-last" title="Laatste pagina"' + (atEnd ? ' disabled' : '') + '>&raquo;&raquo;&raquo;</button>'
      + '<select class="page-size-select" id="pg-size" title="Accounts per pagina">'
      + PAGE_SIZE_OPTIONS.map((n) => '<option value="' + n + '"' + (n === _pageSize ? ' selected' : '') + '>' + n + '</option>').join('')
      + '</select>';
  }

  function gotoPage(n, totalPages) {
    _page = Math.min(Math.max(n, 0), totalPages - 1);
    render();
  }

  // ── Events ───────────────────────────────────────────────────────────────────
  function setupEvents() {
    // Only handles goud/groen/rood/paars undo — text fields (notes, search, import)
    // keep the browser's own native undo, so skip when focus is in an editable field.
    document.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undoCategory(); }
      else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) { e.preventDefault(); redoCategory(); }
    });

    document.getElementById('tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      const key = btn.dataset.tab;
      if (key === 'all') _selectedCats.clear();
      else if (_selectedCats.has(key)) _selectedCats.delete(key);
      else _selectedCats.add(key);
      _page = 0;
      render();
    });

    document.getElementById('search').addEventListener('input', (e) => {
      _query = e.target.value;
      _page = 0;
      render();
    });

    document.getElementById('export-btn').addEventListener('click', openExportModal);
    document.getElementById('pwd-stats-btn').addEventListener('click', openPasswordStatsModal);
    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') closeModal();
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
    document.getElementById('pagination').addEventListener('change', (e) => {
      if (e.target.id !== 'pg-size') return;
      _pageSize = parseInt(e.target.value, 10);
      try { localStorage.setItem(PAGE_SIZE_KEY, String(_pageSize)); } catch (err) {}
      _page = 0;
      render();
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

    document.getElementById('catnote-edit-btn').addEventListener('click', () => {
      const el = document.getElementById('catnote-text');
      el.readOnly = false;
      el.focus();
    });
    document.getElementById('catnote-text').addEventListener('focusout', (e) => {
      e.target.readOnly = true;
      if (_selectedCats.size !== 1) return;
      saveCategoryNote(Array.from(_selectedCats)[0], e.target.value);
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
  loadAll().then(function () {
    // Baseline set only after the initial load resolves — we already have everyone's
    // current category from loadAll itself, so the poller only needs to catch changes
    // from THIS point forward, not re-fetch history.
    _lastCategorySync = new Date().toISOString();
    setInterval(pollCategoryChanges, 3000);
  });
  logEvent('visit', 'accounts');
})();
