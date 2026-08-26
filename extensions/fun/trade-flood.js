(function() {
  if (document.getElementById('__tf_panel')) return;

  const MAX_TYPES     = 9;   // how many different furni names can be flooded at once
  const CHUNK_SIZE     = 100; // AddItemsToTrade hard cap per packet
  const SETTINGS_KEY   = '__ghk_tf_settings';
  const DEFAULTS        = { delayMs: 0 };

  function loadSettings() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); }
    catch (_e) { return Object.assign({}, DEFAULTS); }
  }
  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (_e) {}
  }

  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // Cached OUT packet id lookup — same approach as mimic.js's _outId.
  const _pktCache = {};
  function outId(name) {
    if (name in _pktCache) return _pktCache[name];
    if (!window.PKT || !window.PKT.OUT) return (_pktCache[name] = null);
    for (const [id, full] of Object.entries(window.PKT.OUT)) {
      if (window.shortName(full, 'OUT') === name) return (_pktCache[name] = parseInt(id));
    }
    return (_pktCache[name] = null);
  }

  function init() {
    const style = document.createElement('style');
    style.textContent = [
      '#__tf_panel{position:fixed;top:16px;right:400px;width:320px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__tf_panel *{box-sizing:border-box}',
      '.__tf_card{display:flex;flex-direction:column;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb}',
      '.__tf_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__tf_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}',
      '.__tf_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__tf_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__tf_close:hover{color:#eceefb}',
      '.__tf_body{display:flex;flex-direction:column;gap:8px;padding:12px 14px}',
      '.__tf_lbl{font:700 9px/1 monospace;letter-spacing:1px;text-transform:uppercase;color:#5c5e6b;margin-bottom:4px}',
      '.__tf_row{display:flex;align-items:center;gap:8px}',
      '.__tf_input{background:#0A0B10;border:1px solid #23252f;border-radius:8px;color:#eceefb;padding:6px 8px;font-size:11px;width:100%}',
      '.__tf_input:focus{outline:none;border-color:#6C7CFF}',
      '.__tf_btn{flex:1;border:none;border-radius:8px;font-size:11px;font-weight:600;padding:8px 10px;cursor:pointer;color:#0A0B10;background:#A6B0FF}',
      '.__tf_btn:hover:not(:disabled){filter:brightness(1.08)}',
      '.__tf_btn:disabled{opacity:.4;cursor:not-allowed}',
      '.__tf_btn.secondary{background:#23252f;color:#eceefb;flex:0 0 auto}',
      '.__tf_btn.danger{background:rgba(231,76,60,0.14);color:#e74c3c;border:1px solid rgba(231,76,60,0.3)}',
      '.__tf_btnrow{display:flex;gap:8px}',
      '.__tf_list{max-height:150px;overflow:auto;background:#0A0B10;border:1px solid #23252f;border-radius:8px}',
      '.__tf_item{display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer}',
      '.__tf_item:last-child{border-bottom:none}',
      '.__tf_item:hover{background:rgba(255,255,255,0.04)}',
      '.__tf_item.selected{background:rgba(108,124,255,0.12)}',
      '.__tf_item_name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}',
      '.__tf_item_count{font-size:9px;color:#82849a;flex-shrink:0}',
      '.__tf_empty{padding:16px;text-align:center;font-size:11px;color:#5c5e6b}',
      '.__tf_chips{display:flex;flex-wrap:wrap;gap:6px}',
      '.__tf_chip{display:flex;align-items:center;gap:5px;background:rgba(108,124,255,0.14);color:#A6B0FF;border-radius:99px;padding:3px 6px 3px 10px;font-size:10px;font-weight:600;max-width:100%}',
      '.__tf_chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px}',
      '.__tf_chip_x{cursor:pointer;color:#A6B0FF;opacity:.7;font-size:12px;line-height:1;padding:0 2px}',
      '.__tf_chip_x:hover{opacity:1}',
      '.__tf_log{font-size:9px;font-family:monospace;color:#82849a;max-height:90px;overflow:auto;background:#0A0B10;border:1px solid #23252f;border-radius:8px;padding:6px 8px}',
    ].join('');
    document.head.appendChild(style);

    const settings = loadSettings();

    const panel = document.createElement('div');
    panel.id = '__tf_panel';
    panel.innerHTML =
      '<div class="__tf_card">' +
        '<div class="__tf_hdr" id="__tf_hdr">' +
          '<span class="__tf_eyebrow">Gheloo</span>' +
          '<span class="__tf_title">Trade Flood</span>' +
          '<span class="__tf_close" id="__tf_close">&times;</span>' +
        '</div>' +
        '<div class="__tf_body">' +
          '<div class="__tf_row">' +
            '<button id="__tf_loadinv" class="__tf_btn secondary" style="flex:1">Load inventory</button>' +
          '</div>' +
          '<div>' +
            '<div class="__tf_lbl">Furni (click to add, max ' + MAX_TYPES + ')</div>' +
            '<input id="__tf_search" class="__tf_input" type="text" placeholder="Filter by name..." style="margin-bottom:6px">' +
            '<div id="__tf_list" class="__tf_list"><div class="__tf_empty">Load inventory first</div></div>' +
          '</div>' +
          '<div>' +
            '<div class="__tf_lbl">Selected</div>' +
            '<div id="__tf_chips" class="__tf_chips"><span style="font-size:10px;color:#5c5e6b">None yet</span></div>' +
          '</div>' +
          '<div class="__tf_row">' +
            '<label style="flex:1;display:flex;flex-direction:column;gap:3px;font-size:9px;color:#82849a">Delay between packets (ms)' +
              '<input id="__tf_delay" class="__tf_input" type="number" min="0" value="' + settings.delayMs + '">' +
            '</label>' +
          '</div>' +
          '<div class="__tf_btnrow">' +
            '<button id="__tf_flood" class="__tf_btn" disabled>&#9889; Flood</button>' +
            '<button id="__tf_stop" class="__tf_btn danger" disabled>&#9632; Stop</button>' +
          '</div>' +
          '<div id="__tf_log" class="__tf_log"></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(panel);
    panel.style.display = 'none';

    window.__ghk_makeDraggable(panel, panel.querySelector('#__tf_hdr'), '__ghk_tf_pos', e =>
      ['BUTTON', 'INPUT', 'SELECT'].includes(e.target.tagName) || e.target.id === '__tf_close');
    panel.querySelector('#__tf_close').addEventListener('click', () => { panel.style.display = 'none'; });
    panel.addEventListener('mousedown', () => { if (window.__ghk_bringToFront) window.__ghk_bringToFront(panel); });

    const loadBtn   = panel.querySelector('#__tf_loadinv');
    const searchIn  = panel.querySelector('#__tf_search');
    const listEl    = panel.querySelector('#__tf_list');
    const chipsEl   = panel.querySelector('#__tf_chips');
    const delayIn   = panel.querySelector('#__tf_delay');
    const floodBtn  = panel.querySelector('#__tf_flood');
    const stopBtn   = panel.querySelector('#__tf_stop');
    const logEl     = panel.querySelector('#__tf_log');

    let _groups   = [];   // [{ typeId, name, ids: [instanceId, ...] }], sorted by name
    let _selected = [];   // [typeId, ...] in selection order, max MAX_TYPES
    let _running  = false;
    let _pendingTimer = null;

    function log(msg) {
      const line = document.createElement('div');
      line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
      logEl.appendChild(line);
      logEl.scrollTop = logEl.scrollHeight;
      while (logEl.children.length > 60) logEl.removeChild(logEl.firstChild);
    }

    delayIn.addEventListener('input', () => {
      saveSettings({ delayMs: parseInt(delayIn.value) || 0 });
    });

    // ── Inventory → groups, grouped by typeId (same field FurniData/Inventory already
    // resolve furniName/classname from — see core/parsers.js FurniList handling and
    // marktplaats.js's own Inventory.items grouping for the identical pattern). ──
    function buildGroups() {
      const items = (window.Inventory && window.Inventory.items) || {};
      const byType = {};
      Object.values(items).forEach(item => {
        const key = item.typeId;
        if (!byType[key]) {
          byType[key] = { typeId: key, name: item.furniName || item.classname || ('type #' + key), ids: [] };
        }
        byType[key].ids.push(item.id);
      });
      _groups = Object.values(byType).sort((a, b) => a.name.localeCompare(b.name));
      // Drop any selection whose type no longer exists in the freshly loaded inventory.
      _selected = _selected.filter(typeId => byType[typeId]);
      renderList();
      renderChips();
    }

    function renderList() {
      const q = searchIn.value.trim().toLowerCase();
      const filtered = q ? _groups.filter(g => g.name.toLowerCase().indexOf(q) !== -1) : _groups;
      if (!_groups.length) { listEl.innerHTML = '<div class="__tf_empty">Load inventory first</div>'; return; }
      if (!filtered.length) { listEl.innerHTML = '<div class="__tf_empty">No matches</div>'; return; }
      listEl.innerHTML = filtered.map(g => {
        const sel = _selected.includes(g.typeId);
        return '<div class="__tf_item' + (sel ? ' selected' : '') + '" data-tid="' + g.typeId + '">' +
          '<span class="__tf_item_name" title="' + esc(g.name) + '">' + esc(g.name) + '</span>' +
          '<span class="__tf_item_count">x' + g.ids.length + '</span>' +
        '</div>';
      }).join('');
      listEl.querySelectorAll('.__tf_item').forEach(row => {
        row.addEventListener('click', () => {
          const typeId = parseInt(row.dataset.tid);
          const idx = _selected.indexOf(typeId);
          if (idx !== -1) {
            _selected.splice(idx, 1);
          } else {
            if (_selected.length >= MAX_TYPES) { log('Max ' + MAX_TYPES + ' furni names at once.'); return; }
            _selected.push(typeId);
          }
          renderList();
          renderChips();
        });
      });
    }

    function renderChips() {
      if (!_selected.length) { chipsEl.innerHTML = '<span style="font-size:10px;color:#5c5e6b">None yet</span>'; }
      else {
        chipsEl.innerHTML = _selected.map(typeId => {
          const g = _groups.find(g => g.typeId === typeId);
          const name = g ? g.name : ('type #' + typeId);
          return '<span class="__tf_chip"><span title="' + esc(name) + '">' + esc(name) + '</span><span class="__tf_chip_x" data-tid="' + typeId + '">&times;</span></span>';
        }).join('');
        chipsEl.querySelectorAll('.__tf_chip_x').forEach(x => {
          x.addEventListener('click', () => {
            _selected = _selected.filter(t => t !== parseInt(x.dataset.tid));
            renderList();
            renderChips();
          });
        });
      }
      floodBtn.disabled = _running || !_selected.length;
    }

    searchIn.addEventListener('input', renderList);

    loadBtn.addEventListener('click', () => {
      const reqId = outId('RequestFurniInventory');
      if (reqId === null) { log('RequestFurniInventory not found.'); return; }
      loadBtn.disabled = true;
      loadBtn.textContent = 'Loading...';
      window.Inventory = window.Inventory || {};
      window.Inventory.loaded = false;
      window.Inventory.items  = {};
      window.sendPacket('OUT', reqId, '');
      const t = setInterval(() => {
        if (window.Inventory && window.Inventory.loaded) {
          clearInterval(t);
          loadBtn.disabled = false;
          loadBtn.textContent = 'Load inventory';
          buildGroups();
          log('Inventory loaded: ' + _groups.length + ' furni type(s), ' + Object.keys(window.Inventory.items).length + ' item(s).');
        }
      }, 200);
      setTimeout(() => { clearInterval(t); loadBtn.disabled = false; loadBtn.textContent = 'Load inventory'; }, 8000);
    });
    // Already loaded from an earlier tool (marktplaats.js, etc.) — build groups right away.
    if (window.Inventory && window.Inventory.loaded) buildGroups();

    // ── Flood: concatenate every selected furni type's instance ids, chunk into
    // AddItemsToTradeComposer packets of at most CHUNK_SIZE, fire them back to back
    // (optionally spaced by Delay). Payload format confirmed against a real capture:
    // {i:<count in this packet>}{i:id1}...{i:idN}. ──
    function stopFlood(reason) {
      if (_pendingTimer) clearTimeout(_pendingTimer);
      _pendingTimer = null;
      _running = false;
      stopBtn.disabled = true;
      renderChips();
      if (reason) log(reason);
    }

    floodBtn.addEventListener('click', () => {
      const addId = outId('AddItemsToTrade');
      if (addId === null) { log('AddItemsToTrade packet not found.'); return; }
      const ids = [];
      _selected.forEach(typeId => {
        const g = _groups.find(g => g.typeId === typeId);
        if (g) ids.push.apply(ids, g.ids);
      });
      if (!ids.length) return;

      const chunks = [];
      for (let i = 0; i < ids.length; i += CHUNK_SIZE) chunks.push(ids.slice(i, i + CHUNK_SIZE));
      const delayMs = Math.max(0, parseInt(delayIn.value) || 0);

      _running = true;
      floodBtn.disabled = true;
      stopBtn.disabled = false;
      const t0 = performance.now();
      log('Flooding ' + ids.length + ' item(s) across ' + chunks.length + ' packet(s)...');

      let idx = 0;
      function sendNext() {
        if (!_running) return;
        if (idx >= chunks.length) {
          log('Done: ' + ids.length + ' item(s) in ' + Math.round(performance.now() - t0) + 'ms.');
          stopFlood();
          return;
        }
        const chunk = chunks[idx];
        const payload = '{i:' + chunk.length + '}' + chunk.map(id => '{i:' + id + '}').join('');
        window.sendPacket('OUT', addId, payload);
        idx++;
        log('Batch ' + idx + '/' + chunks.length + ' (' + chunk.length + ' items) sent.');
        _pendingTimer = setTimeout(sendNext, delayMs);
      }
      sendNext();
    });
    stopBtn.addEventListener('click', () => stopFlood('Stopped by user.'));

    window.__tf_panel = panel;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(init); });
  else window.__ghk_ready(init);
})();
