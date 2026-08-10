(function() {
  if (document.getElementById('__ecr_panel')) return;

  // Captured via Hub → Scripting → Packet Logger (raw hex):
  //   00 00 00 26 0a d3 00 00 00 08 00 3d 11 f4 00 3d 11 f5 00 3d 11 f6 00 3d 11 f7
  //               00 3d 11 f8 00 3d 11 f9 00 3d 11 fa 00 3d 11 fb
  // length=0x26=38, header=0x0AD3=2771, payload=int32 count(8) + 8x int32 inventory
  // placementIds fed into the recycler in that batch. No leftover bytes.
  const PKT_RECYCLE_OUT = 2771;
  const BATCH_SIZE = 8; // matches the capture's slot count

  // Classnames extracted from a GetCatalogPage capture of the "dierenwinkel" (pet shop)
  // page — the recycler only accepts these specific junk/pet items, not arbitrary furni.
  const RECYCLE_CLASSNAMES = [
    'petfood1','petfood2','petfood3','waterbowl*4','waterbowl*5','waterbowl*2','waterbowl*1','waterbowl*3',
    'goodie1','goodie1*1','goodie1*2','goodie2','petfood4','petfood8','petfood9','petfood10','petfood7',
    'petfood6','petfood5','petfood12','petfood11','petfood13','petfood27','petfood26','petfood19','petfood18',
    'petfood17','qt_sum11_petfood','petfood25','xmas11_petfood','konfood1','waterbowl_basic*1','waterbowl_basic*2',
    'waterbowl_basic*3','waterbowl_basic*4','waterbowl_basic*5','petfood20','petfood7_horseshoe','petfood28',
    'petfood29','petfood31','petfood30','milkbowl','petfood21','pet_food_corn','petfood_19','petfood24','petfood15',
    'petfood14','petfood16','petfood22','water_bowl1*5','water_bowl1*2','water_bowl1*3','water_bowl1*4','pet_waterbottle'
  ];
  const RECYCLE_SET = new Set(RECYCLE_CLASSNAMES);

  function isRecyclable(item) {
    return !!item.classname && RECYCLE_SET.has(item.classname);
  }

  // The recycler's own reward: an "ecotron_box" inventory item — confirmed classname from
  // an earlier live capture (F12 console log while placing one). Must be placed in the room
  // and opened (REQUEST_ECOTRONBOX, same header as RECYCLER_OPEN_BOX in the bundle) to redeem.
  function isBoxItem(item) {
    return !!item.classname && item.classname.toLowerCase().indexOf('ecotron') !== -1;
  }

  const PKT_REQUEST_ECOTRONBOX_OUT = 2774;

  function _outId(name) {
    if (!window.PKT || !window.PKT.OUT) return null;
    for (const id in window.PKT.OUT) {
      if (window.shortName(window.PKT.OUT[id], 'OUT') === name) return parseInt(id);
    }
    return null;
  }

  // Same knownIds-diff pattern room-clone.js already uses: PlaceObject never returns the new
  // floor item's server-assigned id directly, so poll Room.floorItems for the one that showed
  // up at this exact tile/typeId and wasn't there before.
  function waitForNewFloorItem(typeId, x, y, knownIds, timeoutMs) {
    return new Promise(resolve => {
      const deadline = Date.now() + timeoutMs;
      (function poll() {
        const found = Object.values(window.Room.floorItems || {}).find(fi =>
          fi.typeId === typeId && Math.round(fi.x) === x && Math.round(fi.y) === y && !knownIds.has(fi.id));
        if (found) { resolve(found.id); return; }
        if (Date.now() >= deadline) { resolve(null); return; }
        setTimeout(poll, 60);
      })();
    });
  }

  function selfTile() {
    const u = Object.values(window.Room.users || {}).find(u => u.name === window._selfName);
    return u ? { x: Math.round(u.x), y: Math.round(u.y) } : null;
  }

  function sendBatch(items) {
    const payload = '{i:' + items.length + '}' + items.map(it => '{i:' + it.placementId + '}').join('');
    window.sendPacket('OUT', PKT_RECYCLE_OUT, payload);
  }

  // Confirmed against the client bundle (webcrack-bundle: misc-101.js PS table, misc-092.js
  // parsers): GetRecyclerStatusMessageComposer=1342 (OUT), RecyclerStatusMessageEvent=3433 (IN,
  // {recyclerStatus:int, recyclerTimeoutSeconds:int}), RecyclerFinishedMessageEvent=468 (IN,
  // {recyclerFinishedStatus:int, prizeId:int}). shortName strips the (Message)?Event/Composer
  // suffix, so these arrive as 'RecyclerStatus' / 'RecyclerFinished' via onPacket.
  const PKT_GET_RECYCLER_STATUS_OUT = 1342;
  // recyclerFinishedStatus values, from the client's own switch (misc-179.js): 1=granted,
  // 2=machine closed (this is what a cooldown looks like — no error, no box), 3=blocked by trading.
  const FINISHED_OK = 1, FINISHED_CLOSED = 2, FINISHED_TRADING = 3;

  const DELAY_KEY = 'ghk_ecr_delay';
  let _delayMs  = Math.max(0, parseInt(localStorage.getItem(DELAY_KEY)) || 500);
  let _renderFn = null;

  function refresh() { if (_renderFn) _renderFn(); }
  window.onPacket('FurniList', refresh);
  window.onPacket('FurniListAddOrUpdate', refresh);
  window.onPacket('FurniListRemove', refresh);

  let _boxesGained = 0;
  let _pendingFinishResolve = null;
  let _pendingStatusResolve = null;

  window.onPacket('RecyclerFinished', p => {
    const r = window.makeReader(p.raw);
    if (!r) return;
    const status = r.int();
    const prizeId = r.int();
    if (status === FINISHED_OK) _boxesGained++;
    if (_pendingFinishResolve) { const resolve = _pendingFinishResolve; _pendingFinishResolve = null; resolve({ status, prizeId }); }
  });

  window.onPacket('RecyclerStatus', p => {
    const r = window.makeReader(p.raw);
    if (!r) return;
    const status = r.int();
    const timeoutSeconds = r.int();
    if (_pendingStatusResolve) { const resolve = _pendingStatusResolve; _pendingStatusResolve = null; resolve({ status, timeoutSeconds }); }
  });

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  // Races the real server reply against a timeout — a batch the server silently drops
  // (rather than answering "closed") never fires RecyclerFinished at all, so this can't just
  // await it forever. cancelPromise additionally lets Stop interrupt an in-flight wait
  // immediately instead of making the user wait out the full timeout first.
  function waitForFinish(timeoutMs, cancelPromise) {
    return new Promise(resolve => {
      let done = false;
      _pendingFinishResolve = result => { if (!done) { done = true; _pendingFinishResolve = null; resolve(result); } };
      setTimeout(() => { if (!done) { done = true; _pendingFinishResolve = null; resolve(null); } }, timeoutMs);
      if (cancelPromise) cancelPromise.then(() => { if (!done) { done = true; _pendingFinishResolve = null; resolve('cancelled'); } });
    });
  }

  function requestRecyclerStatus(timeoutMs) {
    return new Promise(resolve => {
      _pendingStatusResolve = resolve;
      window.sendPacket('OUT', PKT_GET_RECYCLER_STATUS_OUT, '');
      setTimeout(() => { if (_pendingStatusResolve) { _pendingStatusResolve = null; resolve(null); } }, timeoutMs);
    });
  }

  function init() {
    const style = document.createElement('style');
    style.textContent = [
      '#__ecr_panel{position:fixed;top:16px;right:16px;width:300px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__ecr_panel *{box-sizing:border-box}',
      '.__ecr_card{display:flex;flex-direction:column;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb}',
      '.__ecr_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__ecr_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}',
      '.__ecr_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__ecr_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__ecr_close:hover{color:#eceefb}',
      '#__ecr_list{max-height:260px;overflow-y:auto;margin:10px 10px 0;border:1px solid #23252f;border-radius:8px}',
      '.__ecr_row{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:11px}',
      '.__ecr_row:last-child{border-bottom:none}',
      '.__ecr_row:hover{background:rgba(255,255,255,0.04)}',
      '.__ecr_name{flex:1;color:#eceefb;font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.__ecr_cnt{font-size:9px;font-weight:700;padding:2px 7px;border-radius:10px;flex-shrink:0;font-family:monospace;background:rgba(108,124,255,0.16);color:#A6B0FF;border:1px solid rgba(108,124,255,0.3)}',
      '#__ecr_empty{padding:20px 12px;font-size:11px;color:#5c5e6b;text-align:center}',
      '#__ecr_summary{padding:8px 10px 0;font-size:11px;color:#82849a;flex-shrink:0}',
      '#__ecr_summary b{color:#A6B0FF}',
      '#__ecr_bottom{padding:8px 10px;flex-shrink:0;display:flex;flex-direction:column;gap:8px}',
      '.__ecr_row2{display:flex;align-items:center;gap:8px}',
      '.__ecr_label2{color:#82849a;font-size:11px;flex-shrink:0}',
      '.__ecr_input{background:#0A0B10;border:1px solid #23252f;border-radius:8px;color:#eceefb;padding:6px 8px;font-size:11px;width:64px}',
      '.__ecr_input:focus{outline:none;border-color:#6C7CFF}',
      '.__ecr_status{color:#82849a;font-size:10px;text-align:center}',
      '#__ecr_recycleall{width:100%;font-size:11px;font-weight:600;padding:7px 0;border-radius:8px;border:none;cursor:pointer;color:#0A0B10;background:#A6B0FF}',
      '#__ecr_recycleall:hover:not(:disabled){filter:brightness(1.08)}',
      '#__ecr_recycleall:disabled{opacity:.4;cursor:not-allowed}',
      '#__ecr_recycleall.__ecr_stop{background:rgba(231,76,60,0.14);color:#e74c3c;border:1px solid rgba(231,76,60,0.3)}',
      '#__ecr_divider{border-top:1px solid #23252f;margin:2px 0}',
      '#__ecr_redeemall{width:100%;font-size:11px;font-weight:600;padding:7px 0;border-radius:8px;border:none;cursor:pointer;color:#0A0B10;background:#A6B0FF}',
      '#__ecr_redeemall:hover:not(:disabled){filter:brightness(1.08)}',
      '#__ecr_redeemall:disabled{opacity:.4;cursor:not-allowed}',
      '#__ecr_redeemall.__ecr_stop{background:rgba(231,76,60,0.14);color:#e74c3c;border:1px solid rgba(231,76,60,0.3)}',
    ].join('');
    document.head.appendChild(style);

    const p = document.createElement('div');
    p.id = '__ecr_panel';
    p.innerHTML =
      '<div class="__ecr_card">' +
        '<div class="__ecr_hdr" id="__ecr_hdr">' +
          '<span class="__ecr_eyebrow">Gheloo</span>' +
          '<span class="__ecr_title">Ecotron Recycler</span>' +
          '<span class="__ecr_close" id="__ecr_close">&times;</span>' +
        '</div>' +
        '<div id="__ecr_list"></div>' +
        '<div id="__ecr_summary"></div>' +
        '<div id="__ecr_bottom">' +
          '<div class="__ecr_row2">' +
            '<span class="__ecr_label2">Delay between batches (ms):</span>' +
            '<input id="__ecr_delay" type="number" class="__ecr_input" min="0" step="100" />' +
          '</div>' +
          '<div id="__ecr_status" class="__ecr_status"></div>' +
          '<button id="__ecr_recycleall">Recycle All</button>' +
          '<div id="__ecr_divider"></div>' +
          '<div id="__ecr_boxcount" class="__ecr_status"></div>' +
          '<div id="__ecr_status2" class="__ecr_status"></div>' +
          '<button id="__ecr_redeemall">Place &amp; Redeem All Boxes</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(p);
    p.style.display = 'none';

    window.__ghk_makeDraggable(p, p.querySelector('#__ecr_hdr'), '__ghk_ecr_pos', e => e.target.id === '__ecr_close');
    p.querySelector('#__ecr_close').addEventListener('click', () => { p.style.display = 'none'; });

    const listEl     = p.querySelector('#__ecr_list');
    const summaryEl  = p.querySelector('#__ecr_summary');
    const allBtn     = p.querySelector('#__ecr_recycleall');
    const delayInp   = p.querySelector('#__ecr_delay');
    const statusEl   = p.querySelector('#__ecr_status');
    const boxCountEl = p.querySelector('#__ecr_boxcount');
    const status2El  = p.querySelector('#__ecr_status2');
    const redeemBtn  = p.querySelector('#__ecr_redeemall');

    delayInp.value = _delayMs;
    delayInp.addEventListener('input', function() {
      _delayMs = Math.max(0, parseInt(this.value) || 0);
      localStorage.setItem(DELAY_KEY, String(_delayMs));
    });

    function matchingItems() {
      return Object.values((window.Inventory && window.Inventory.items) || {}).filter(isRecyclable);
    }

    function boxItems() {
      return Object.values((window.Inventory && window.Inventory.items) || {}).filter(isBoxItem);
    }

    let _running = false;
    let _cancelRequested = false;
    let _cancelResolve = null; // resolves the current run's cancel signal so Stop interrupts an in-flight wait immediately
    const STALL_LIMIT = 5; // consecutive batches with zero boxes gained before auto-stop (server likely rate-limiting)

    let _running2 = false;
    let _cancelRequested2 = false;

    function setRunningUI(running) {
      _running = running;
      allBtn.classList.toggle('__ecr_stop', running);
      allBtn.textContent = running ? 'Stop' : 'Recycle All';
      if (!running) allBtn.disabled = !matchingItems().length;
      redeemBtn.disabled = running || !boxItems().length; // can't run both at once
    }

    function setRunningUI2(running) {
      _running2 = running;
      redeemBtn.classList.toggle('__ecr_stop', running);
      redeemBtn.textContent = running ? 'Stop' : 'Place & Redeem All Boxes';
      if (!running) redeemBtn.disabled = !boxItems().length;
      allBtn.disabled = running || !matchingItems().length;
    }

    function updateBoxUI() {
      const n = boxItems().length;
      boxCountEl.textContent = n + ' ecotron box' + (n === 1 ? '' : 'es') + ' in inventory';
      if (!_running && !_running2) redeemBtn.disabled = !n;
    }

    function render() {
      if (!window.Inventory || !window.Inventory.loaded) {
        listEl.innerHTML = '<div id="__ecr_empty">Inventory not loaded — open your Inventory panel in-game once.</div>';
        summaryEl.textContent = '';
        boxCountEl.textContent = '';
        if (!_running) allBtn.disabled = true;
        redeemBtn.disabled = true;
        return;
      }

      updateBoxUI();

      const items = matchingItems();
      const groups = {};
      items.forEach(it => { groups[it.classname] = (groups[it.classname] || 0) + 1; });
      const entries = Object.entries(groups).sort(([, a], [, b]) => b - a);

      if (!entries.length) {
        listEl.innerHTML = '<div id="__ecr_empty">No recyclable pet items in your inventory.</div>';
        summaryEl.textContent = '';
        if (!_running) allBtn.disabled = true;
        return;
      }
      if (!_running && !_running2) allBtn.disabled = false;

      const boxes = Math.floor(items.length / BATCH_SIZE);
      const leftover = items.length % BATCH_SIZE;
      summaryEl.innerHTML = items.length + ' items (mixed types OK) → <b>' + boxes + ' box' + (boxes === 1 ? '' : 'es') + '</b>' +
        (leftover ? ', ' + leftover + ' left over' : '');

      listEl.innerHTML = entries.map(([classname, count]) =>
        '<div class="__ecr_row">' +
          '<span class="__ecr_name" title="' + classname + '">' + classname + '</span>' +
          '<span class="__ecr_cnt">×' + count + '</span>' +
        '</div>'
      ).join('');
    }

    async function runBatches(batches) {
      statusEl.textContent = 'Checking recycler status...';
      const preflight = await requestRecyclerStatus(2000);
      if (preflight && preflight.timeoutSeconds > 0) {
        statusEl.textContent = 'Recycler is on cooldown: ' + preflight.timeoutSeconds + 's remaining. Not starting.';
        setRunningUI(false);
        return;
      }

      const cancelSignal = new Promise(resolve => { _cancelResolve = resolve; });

      let stall = 0;
      let i = 0;
      for (; i < batches.length; i++) {
        if (_cancelRequested) {
          statusEl.textContent = 'Stopped at batch ' + (i + 1) + '/' + batches.length + ' — ' + _boxesGained + ' boxes total.';
          break;
        }
        sendBatch(batches[i]);
        const result = await waitForFinish(Math.max(_delayMs, 2000), cancelSignal);

        if (result === 'cancelled') {
          statusEl.textContent = 'Stopped at batch ' + (i + 1) + '/' + batches.length + ' — ' + _boxesGained + ' boxes total.';
          break;
        } else if (!result) {
          // No RecyclerFinished at all — server dropped the request silently.
          stall++;
          statusEl.textContent = 'Batch ' + (i + 1) + '/' + batches.length + ' — no reply (timeout), ' + _boxesGained + ' boxes total.';
        } else if (result.status === FINISHED_OK) {
          stall = 0;
          statusEl.textContent = 'Batch ' + (i + 1) + '/' + batches.length + ' — box granted (prize ' + result.prizeId + '), ' + _boxesGained + ' boxes total.';
        } else if (result.status === FINISHED_CLOSED) {
          statusEl.textContent = 'Recycler closed (batch ' + (i + 1) + '/' + batches.length + ') — likely on cooldown. ' + _boxesGained + ' boxes total.';
          break;
        } else if (result.status === FINISHED_TRADING) {
          statusEl.textContent = 'Blocked: a trade window is open — close it and retry. ' + _boxesGained + ' boxes total.';
          break;
        } else {
          stall++;
          statusEl.textContent = 'Batch ' + (i + 1) + '/' + batches.length + ' — unknown status ' + result.status + ', ' + _boxesGained + ' boxes total.';
        }

        if (stall >= STALL_LIMIT) {
          statusEl.textContent = 'Stopped: no reply for ' + STALL_LIMIT + ' batches in a row (batch ' + (i + 1) + '/' + batches.length + '). ' + _boxesGained + ' boxes total.';
          break;
        }
        if (_delayMs > 0) await sleep(_delayMs);
      }
      if (i >= batches.length) statusEl.textContent = 'Done — ' + _boxesGained + ' boxes total.';
      _cancelRequested = false;
      _cancelResolve = null;
      setRunningUI(false);
    }

    allBtn.addEventListener('click', function() {
      if (_running) {
        _cancelRequested = true;
        if (_cancelResolve) _cancelResolve();
        statusEl.textContent = 'Stopping...';
        return;
      }
      const items = matchingItems();
      if (!items.length) return;

      const batches = [];
      for (let i = 0; i < items.length; i += BATCH_SIZE) batches.push(items.slice(i, i + BATCH_SIZE));

      _boxesGained = 0;
      setRunningUI(true);
      runBatches(batches);
    });

    async function redeemAllBoxes() {
      const placeId = _outId('PlaceObject');
      if (placeId === null) { status2El.textContent = 'PlaceObject packet not found.'; setRunningUI2(false); return; }
      const base = selfTile();
      if (!base) { status2El.textContent = 'Could not find your avatar position — stand in the room you want to use.'; setRunningUI2(false); return; }

      const items = boxItems();
      if (!items.length) { setRunningUI2(false); return; }

      for (let i = 0; i < items.length; i++) {
        if (_cancelRequested2) {
          status2El.textContent = 'Stopped at box ' + (i + 1) + '/' + items.length + '.';
          break;
        }
        const item = items[i];
        // All boxes go on the same single tile next to the player, stacked into each other —
        // PlaceObject for floor items has no explicit height field, the server just lands
        // each one at ground level on this tile since box furni doesn't stack upward.
        const x = base.x + 1;
        const y = base.y;
        const knownIds = new Set(Object.keys(window.Room.floorItems || {}).map(Number));

        window.sendPacket('OUT', placeId, '{s:"' + item.placementId + ' ' + x + ' ' + y + ' 0"}');
        const floorId = await waitForNewFloorItem(item.typeId, x, y, knownIds, 3000);

        if (floorId === null) {
          status2El.textContent = 'Box ' + (i + 1) + '/' + items.length + ' — placement timed out, skipped.';
        } else {
          window.sendPacket('OUT', PKT_REQUEST_ECOTRONBOX_OUT, '{i:' + floorId + '}');
          status2El.textContent = 'Box ' + (i + 1) + '/' + items.length + ' — placed & redeemed.';
        }
        if (_delayMs > 0) await sleep(_delayMs);
      }
      if (!_cancelRequested2) status2El.textContent = 'Done — ' + items.length + ' box' + (items.length === 1 ? '' : 'es') + ' processed.';
      _cancelRequested2 = false;
      setRunningUI2(false);
    }

    redeemBtn.addEventListener('click', function() {
      if (_running2) {
        _cancelRequested2 = true;
        status2El.textContent = 'Stopping...';
        return;
      }
      if (!boxItems().length) return;
      setRunningUI2(true);
      redeemAllBoxes();
    });

    _renderFn = render;
    window.__ecr_render = render;
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.__ghk_ready(init));
  } else {
    window.__ghk_ready(init);
  }
})();
