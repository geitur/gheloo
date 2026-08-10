(function() {
  if (document.getElementById('__fsc_panel')) return;

  const POS_KEY = '__ghk_fsc_pos';
  const PLACE_DELAY_MS = 95; // same measured PlaceObject floor room-clone.js/furni-relay.js use

  let _running = false;
  let _aborted = false;
  let _log = [];

  function outId(name) {
    if (!window.PKT || !window.PKT.OUT) return null;
    for (const id in window.PKT.OUT) if (window.shortName(window.PKT.OUT[id], 'OUT') === name) return parseInt(id, 10);
    return null;
  }
  function typeName(typeId) {
    const fd = window.FurniData;
    const entry = fd && ((fd.floor && fd.floor[typeId]) || (fd.wall && fd.wall[typeId]));
    return (entry && entry.name) ? entry.name : '';
  }
  function escapeRegExp(s) { return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function getMatchingItems(nameFilter) {
    const filterRe = nameFilter ? new RegExp(escapeRegExp(nameFilter), 'i') : null;
    return Object.values((window.Inventory && window.Inventory.items) || {})
      .filter(it => it.type === 'S')
      .filter(it => !filterRe || filterRe.test(typeName(it.typeId)));
  }
  // Groups by real furni name (e.g. per color variant, since each color is its own typeId)
  // rather than typeId itself, so the breakdown reads as "Tijgerwelpje (blauw) x4" etc.
  function breakdownByType(items) {
    const counts = new Map();
    items.forEach(function(it) {
      const name = typeName(it.typeId) || ('type ' + it.typeId);
      counts.set(name, (counts.get(name) || 0) + 1);
    });
    return Array.from(counts.entries()).sort(function(a, b) { return b[1] - a[1]; });
  }
  function formatBreakdown(items) {
    return breakdownByType(items).map(function(e) { return e[0] + ' x' + e[1]; }).join(', ');
  }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function waitForFreshInventory(timeoutMs) {
    return new Promise(function(resolve) {
      const reqId = outId('RequestFurniInventory');
      if (reqId === null || !window.onPacket) { resolve(false); return; }
      let done = false;
      window.onPacket('FurniList', function(p) {
        if (done || !p.parsed) return;
        if ((p.parsed.pageIndex + 1) < p.parsed.totalPages) return;
        done = true;
        resolve(true);
      });
      window.sendPacket('OUT', reqId, '');
      setTimeout(function() { if (!done) resolve(false); }, timeoutMs);
    });
  }

  // Row-major, starting at (x1,y1): fills row y1 left-to-right (x1..x2), then row y1+1, etc.
  // Order is deliberately NOT shuffled — only the item/color assignment per tile is randomized.
  function buildTiles(x1, y1, x2, y2, exclude) {
    const tiles = [];
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        if (exclude && x >= exclude.x1 && x <= exclude.x2 && y >= exclude.y1 && y <= exclude.y2) continue;
        tiles.push({ x, y });
      }
    }
    return tiles;
  }
  function formatSecs(ms) {
    const s = ms / 1000;
    return (s < 10 ? s.toFixed(1) : Math.round(s)) + 's';
  }

  async function runScatter(opts, logFn, progressFn) {
    _running = true;
    _aborted = false;
    logFn('Refreshing inventory...');
    const loaded = await waitForFreshInventory(8000);
    if (!loaded) logFn('Inventory refresh timed out, using what is known.');
    if (_aborted) { _running = false; return; }

    const items = shuffle(getMatchingItems(opts.nameFilter));
    logFn('Found ' + items.length + ' matching item(s) in inventory: ' + (items.length ? formatBreakdown(items) : 'none'));
    if (!items.length) { _running = false; return; }

    const tiles = buildTiles(opts.x1, opts.y1, opts.x2, opts.y2, opts.exclude);
    const placeId = outId('PlaceObject');
    if (placeId === null) { logFn('PlaceObject packet id not found.'); _running = false; return; }

    const count = Math.min(items.length, tiles.length);
    const totalMs = count * PLACE_DELAY_MS;
    logFn('Placing ' + count + ' item(s) across ' + tiles.length + ' available tile(s) — estimated ' + formatSecs(totalMs) + '...');

    const startedAt = Date.now();
    for (let i = 0; i < count; i++) {
      if (_aborted) { logFn('Aborted at ' + i + '/' + count + '.'); break; }
      const item = items[i];
      const tile = tiles[i];
      window.sendPacket('OUT', placeId, '{s:"' + item.placementId + ' ' + tile.x + ' ' + tile.y + ' ' + opts.rotation + '"}');
      progressFn(i + 1, count, startedAt, totalMs);
      await sleep(PLACE_DELAY_MS);
    }

    if (!_aborted) {
      logFn('Done — placed ' + count + ' item(s) in ' + formatSecs(Date.now() - startedAt) + '.' + (items.length > count ? ' ' + (items.length - count) + ' left in inventory (ran out of tiles).' : ''));
    }
    _running = false;
  }

  function abortScatter() {
    if (_running) _aborted = true;
  }

  function init() {
    const style = document.createElement('style');
    style.textContent = [
      '#__fsc_panel{position:fixed;top:16px;right:16px;width:300px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__fsc_panel *{box-sizing:border-box}',
      '.__fsc_card{background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb;display:flex;flex-direction:column}',
      '.__fsc_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__fsc_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}',
      '.__fsc_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__fsc_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__fsc_close:hover{color:#eceefb}',
      '#__fsc_body{padding:10px 12px;display:flex;flex-direction:column;gap:8px}',
      '.__fsc_field label{display:block;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#5c5e6b;margin-bottom:2px}',
      '.__fsc_grid2{display:grid;grid-template-columns:1fr 1fr;gap:6px}',
      '.__fsc_grid4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px}',
      '.__fsc_filter_row{display:flex;gap:6px;align-items:flex-end}',
      '.__fsc_filter_row .__fsc_field{flex:1}',
      '#__fsc_panel input{width:100%;background:#1c1e2a;border:1px solid #23252f;border-radius:6px;color:#eceefb;padding:5px 7px;font:11px Consolas,monospace}',
      '#__fsc_panel input:focus{outline:none;border-color:#6C7CFF}',
      '.__fsc_sub{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#5c5e6b;margin-top:2px}',
      '.__fsc_check_btn{flex-shrink:0;background:#1c1e2a;color:#82849a;border:1px solid #23252f;border-radius:6px;font-size:10px;font-weight:700;padding:0 10px;cursor:pointer;height:26px}',
      '.__fsc_check_btn:hover{color:#eceefb}',
      '#__fsc_found{font-size:10px;color:#82849a;font-family:Consolas,monospace;max-height:54px;overflow-y:auto;word-break:break-word}',
      '#__fsc_status{font-size:10px;color:#82849a;font-family:Consolas,monospace;max-height:70px;overflow-y:auto}',
      '.__fsc_btn{border:none;border-radius:8px;font-size:11px;font-weight:700;padding:8px 10px;cursor:pointer;width:100%}',
      '.__fsc_btn_success{background:#A6B0FF;color:#0A0B10}',
      '.__fsc_btn_success:hover{filter:brightness(1.08)}',
      '.__fsc_btn_danger{background:rgba(231,76,60,0.18);color:#e74c3c}',
      '.__fsc_btn_danger:hover{background:rgba(231,76,60,0.3)}',
      '#__fsc_progress_wrap{height:8px;background:#1c1e2a;border:1px solid #23252f;border-radius:4px;overflow:hidden;display:none}',
      '#__fsc_progress_fill{height:100%;width:0%;background:#2ecc71;transition:width .2s ease}',
      '#__fsc_progress_text{font-size:10px;color:#82849a;font-family:Consolas,monospace;display:none}',
    ].join('');
    document.head.appendChild(style);

    function field(label, id, value) {
      return '<div class="__fsc_field"><label>' + label + '</label><input id="' + id + '" value="' + value + '"></div>';
    }

    const p = document.createElement('div');
    p.id = '__fsc_panel';
    p.innerHTML =
      '<div class="__fsc_card">' +
        '<div class="__fsc_hdr" id="__fsc_hdr">' +
          '<span class="__fsc_eyebrow">Gheloo</span>' +
          '<span class="__fsc_title">Scatter</span>' +
          '<span class="__fsc_close" id="__fsc_close">&times;</span>' +
        '</div>' +
        '<div id="__fsc_body">' +
          '<div class="__fsc_filter_row">' + field('Name filter (inventory)', '__fsc_filter', 'Tijgerwelpje') +
            '<button id="__fsc_check" class="__fsc_check_btn" type="button">Check</button>' +
          '</div>' +
          '<div id="__fsc_found">Found: — (click Check to refresh)</div>' +
          '<div class="__fsc_sub">Area (start tile → end tile, inclusive)</div>' +
          '<div class="__fsc_grid4">' +
            field('start x', '__fsc_x1', '0') + field('start y', '__fsc_y1', '0') +
            field('end x', '__fsc_x2', '63') + field('end y', '__fsc_y2', '63') +
          '</div>' +
          '<div class="__fsc_sub">Exclude rectangle (tile coords, inclusive) — leave blank for none</div>' +
          '<div class="__fsc_grid4">' +
            field('x1', '__fsc_ex1', '0') + field('x2', '__fsc_ex2', '1') +
            field('y1', '__fsc_ey1', '25') + field('y2', '__fsc_ey2', '38') +
          '</div>' +
          '<div class="__fsc_sub">Rotation (facing, 0-7)</div>' +
          field('rotation', '__fsc_rot', '0') +
          '<div id="__fsc_status">Klaar.</div>' +
          '<div id="__fsc_progress_wrap"><div id="__fsc_progress_fill"></div></div>' +
          '<div id="__fsc_progress_text"></div>' +
          '<button id="__fsc_start" class="__fsc_btn __fsc_btn_success">Scatter</button>' +
          '<button id="__fsc_abort" class="__fsc_btn __fsc_btn_danger" style="display:none">Abort</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(p);
    p.style.display = 'none';

    window.__ghk_makeDraggable(p, p.querySelector('#__fsc_hdr'), POS_KEY, e => e.target.id === '__fsc_close');
    p.querySelector('#__fsc_close').addEventListener('click', () => p.style.display = 'none');

    const statusEl = p.querySelector('#__fsc_status');
    const progWrap = p.querySelector('#__fsc_progress_wrap');
    const progFill = p.querySelector('#__fsc_progress_fill');
    const progText = p.querySelector('#__fsc_progress_text');
    const startBtn = p.querySelector('#__fsc_start');
    const abortBtn = p.querySelector('#__fsc_abort');
    const checkBtn = p.querySelector('#__fsc_check');
    const foundEl = p.querySelector('#__fsc_found');

    function val(id) { return p.querySelector('#' + id).value.trim(); }

    function logFn(text) {
      _log.push(text);
      if (_log.length > 50) _log.shift();
      statusEl.textContent = _log.join('\n');
      statusEl.scrollTop = statusEl.scrollHeight;
      console.log('[Scatter]', text);
    }

    function progressFn(done, total, startedAt, totalMs) {
      progWrap.style.display = 'block';
      progText.style.display = 'block';
      const pct = Math.round((done / total) * 100);
      progFill.style.width = pct + '%';
      const elapsedMs = Date.now() - startedAt;
      const remainingMs = Math.max(0, totalMs - (done * PLACE_DELAY_MS));
      progText.textContent = done + '/' + total + ' (' + pct + '%) — ' + formatSecs(elapsedMs) + ' elapsed, ~' + formatSecs(remainingMs) + ' left';
    }

    function setRunningUi(running) {
      startBtn.style.display = running ? 'none' : 'block';
      abortBtn.style.display = running ? 'block' : 'none';
      if (!running) setTimeout(() => { progWrap.style.display = 'none'; progText.style.display = 'none'; progFill.style.width = '0%'; }, 1200);
    }

    startBtn.addEventListener('click', function() {
      const x1 = parseInt(val('__fsc_x1'), 10) || 0;
      const y1 = parseInt(val('__fsc_y1'), 10) || 0;
      const x2 = parseInt(val('__fsc_x2'), 10) || 0;
      const y2 = parseInt(val('__fsc_y2'), 10) || 0;
      const ex1 = val('__fsc_ex1'), ex2 = val('__fsc_ex2'), ey1 = val('__fsc_ey1'), ey2 = val('__fsc_ey2');
      const exclude = (ex1 !== '' && ex2 !== '' && ey1 !== '' && ey2 !== '')
        ? { x1: Math.min(parseInt(ex1, 10), parseInt(ex2, 10)), x2: Math.max(parseInt(ex1, 10), parseInt(ex2, 10)),
            y1: Math.min(parseInt(ey1, 10), parseInt(ey2, 10)), y2: Math.max(parseInt(ey1, 10), parseInt(ey2, 10)) }
        : null;
      const nameFilter = val('__fsc_filter');
      const rotation = parseInt(val('__fsc_rot'), 10) || 0;

      setRunningUi(true);
      runScatter({ x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2), exclude: exclude, nameFilter: nameFilter, rotation: rotation }, logFn, progressFn)
        .finally(() => setRunningUi(false));
    });

    abortBtn.addEventListener('click', function() {
      abortScatter();
    });

    // Best-effort count off whatever inventory is already cached — instant, but may be
    // stale/incomplete until a real Check (or Scatter, which always refreshes first) runs.
    p.querySelector('#__fsc_filter').addEventListener('input', function() {
      const items = getMatchingItems(val('__fsc_filter'));
      foundEl.textContent = 'Found: ~' + items.length + (items.length ? ' — ' + formatBreakdown(items) : '') + ' (cached, click Check to refresh)';
    });

    checkBtn.addEventListener('click', async function() {
      checkBtn.disabled = true;
      checkBtn.textContent = 'Checking...';
      foundEl.textContent = 'Refreshing inventory...';
      const loaded = await waitForFreshInventory(8000);
      const items = getMatchingItems(val('__fsc_filter'));
      foundEl.textContent = 'Found: ' + items.length + (items.length ? ' — ' + formatBreakdown(items) : '') + ' in inventory' + (loaded ? '' : ' (refresh timed out, may be incomplete)');
      checkBtn.disabled = false;
      checkBtn.textContent = 'Check';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.__ghk_ready(init));
  } else {
    window.__ghk_ready(init);
  }
})();
