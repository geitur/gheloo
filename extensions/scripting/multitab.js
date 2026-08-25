(function() {
  const ARROW_B64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACEAAAAiCAMAAADmrkDzAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAPUExURQAAANnZ2f///2x6gwAAAJeH9EoAAAAFdFJOU/////8A+7YOUwAAAAlwSFlzAAAOwwAADsMBx2+oZAAAALRJREFUOE+F0kkWwzAIA1C3+P5nLoOwwK8hWiR68BfOsHbNstzNr4iPfcHWxFofjS3YmtDxV2OL02wcWw3GLk6TInJsczaRI56ACMQzgBhAiAm4GIGddAYqXoDuX4ALpDaCUTiYRIA4KdIJAJ4WaQTAv9x/EvsQMhK/jyRuEwEcCMRAUhTCl9gFiYrT9K1QJNF9afzXLbrw6Ddhy389Egsb14ZlxEdXuiBhu0QuSrtFLNj2/gEx8wlvqfF/gwAAAABJRU5ErkJggg==';

  let TAB_ID;
  try {
    if (!window.top.__nitro_tab_id) window.top.__nitro_tab_id = Math.random().toString(36).slice(2, 8);
    TAB_ID = window.top.__nitro_tab_id;
  } catch(e) { TAB_ID = Math.random().toString(36).slice(2, 8); }

  const BC     = new BroadcastChannel('nitro_tabs');
  const _peers = {};
  const _pkts  = {};

  // ── Ping API, for your own Extensions (the paste-your-own-JS panel) ──
  // This file runs the actual RTT measurement; everything below is what it publishes on
  // `window` so other code — including anything you paste into the Extensions panel — can
  // read live ping without re-implementing any of this:
  //
  //   window.__ghk_rtt            number|null — current smoothed RTT in ms. null while the
  //                                Ping toggle (Settings > Performance > Ping) is off, or
  //                                before the first reply has come back.
  //   window.onLatency(cb)        subscribe instead of polling __ghk_rtt yourself. cb(ms)
  //                                fires on every update, with ms === null on reset (i.e.
  //                                when the user switches the Ping toggle off).
  //   window.__ghk_pingEnabled    bool — mirrors the Settings > Performance > Ping toggle.
  //                                Read-only from your side; owned by content.js.
  //   window.__ghk_pingIntervalMs number — current configured probe interval in ms, set
  //                                from the same Settings row. Read-only from your side.
  //
  // Example — log ping every time it changes:
  //   window.onLatency(ms => console.log('ping:', ms === null ? 'off' : ms + 'ms'));

  // ── Live latency (RTT) — Tried two "official" candidates, both bad fits:
  // - LatencyPingRequest(295)/LatencyPingResponse(10): in pkt.js's header map but this
  //   hotel never answers it (confirmed live: 5x sent over 10s, zero replies).
  // - GetCreditsInfo(273)/CreditBalance(3475): answered once (probably the login-time
  //   push, not a real reply to our request) then never again — server doesn't treat it
  //   as a repeatable query.
  // - RequestFurniInventory(3150)/FurniList(994) DOES answer every time, but the reply is
  //   the account's full paged inventory — response time scales with furni count, which
  //   would contaminate the RTT reading with server-side query/serialize time instead of
  //   pure network latency, and two accounts with different-sized inventories would read
  //   different "ping" for reasons that have nothing to do with their connection.
  // Landed on GetGiftWrappingConfiguration(418)/GiftWrappingConfiguration(2234) — confirmed
  // live: response is a fixed static config blob (color/ribbon options), byte-identical on
  // every request, same for every account. Not tied to any user data, so response time is
  // pure network RTT with no server-side query cost riding along, and no per-account skew.
  let _myRtt = null, _rttEma = null;
  const _pendingPings = [];

  // Public hook for the paste-your-own-JS Extensions panel (and any other panel) to react
  // to live ping — same shape as onPacket. window.__ghk_rtt is the plain current-value
  // read; onLatency is for code that wants to be pushed updates instead of polling it.
  window._latencyListeners = [];
  window.onLatency = function(cb) { if (typeof cb === 'function') window._latencyListeners.push(cb); };
  function _emitLatency(ms) {
    window._latencyListeners.forEach(cb => { try { cb(ms); } catch(e) { console.error('[onLatency]', e); } });
  }

  // Clears the reading (rather than just freezing it) when the Settings > Performance >
  // Ping toggle turns off, so nothing displays a stale number as if it were still live.
  window.__ghk_resetPing = function() {
    _myRtt = null; _rttEma = null; _pendingPings.length = 0;
    window.__ghk_rtt = null;
    _pingArmed = false; // wait for a fresh OpenFlatConnection before probing again
    _emitLatency(null);
    _renderPeers();
    _renderMulti();
  };

  // Don't start probing right after the socket connects — login sends a burst of
  // frames the server processes before the client has entered any room, and a ping
  // sent into that burst reads high for reasons that have nothing to do with real
  // network latency. Wait for the first real OpenFlatConnection (room entry) instead.
  let _pingArmed = false;
  window.onPacket && window.onPacket('OpenFlatConnection', function() { _pingArmed = true; });

  function _sendPing() {
    if (!window.__ghk_pingEnabled) return; // opt-in — only probe while the Ping toggle is on
    if (!_pingArmed) return; // haven't seen a room-enter yet since (re)connect
    if (!window.sendPacket || (!window._ws && !window._worker && !window._ws_worker)) return;
    if (_pendingPings.length > 3) _pendingPings.length = 0; // response(s) got lost — don't let stale sends pile up
    _pendingPings.push(Date.now());
    window.sendPacket('OUT', 418);
  }
  window.onPacket && window.onPacket('GiftWrappingConfiguration', function() {
    const sentAt = _pendingPings.shift();
    if (sentAt === undefined) return;
    _myRtt  = Date.now() - sentAt;
    _rttEma = _rttEma === null ? _myRtt : Math.round(_rttEma * 0.7 + _myRtt * 0.3);
    window.__ghk_rtt = _rttEma;
    _emitLatency(_rttEma);
    _renderPeers();
    _renderMulti();
    // Re-announce immediately on every fresh reading (not just the 4s heartbeat below) so
    // other tabs' view of OUR rtt stays roughly as fresh as our own ping cadence — matters
    // for anything comparing two tabs' rtt against each other in near-real-time (e.g.
    // marktplaats.js's ping-match wait), where up to 4s of staleness would otherwise hide
    // a match that already exists.
    _announce();
  });
  // Self-rescheduling instead of setInterval so a live interval change (Settings >
  // Performance > Ping's dropdown) takes effect on the very next tick, no restart needed.
  function _scheduleNextPing() {
    setTimeout(function() { _sendPing(); _scheduleNextPing(); }, window.__ghk_pingIntervalMs || 2000);
  }
  setTimeout(_sendPing, 1500);
  _scheduleNextPing();

  function _announce() {
    BC.postMessage({ type: 'hello', tabId: TAB_ID, url: window.__wsUrl || '', user: window._selfName || '', page: window.location.pathname, rtt: _rttEma });
  }
  window.addEventListener('__ws_connect', _announce);
  window.onPacket && window.onPacket('UserObject', () => setTimeout(_announce, 200));
  setInterval(_announce, 4000);
  setTimeout(_announce, 300);

  BC.onmessage = function(ev) {
    const msg = ev.data;
    if (!msg) return;
    if (msg.type === 'hello') {
      if (msg.tabId === TAB_ID) return;
      const prev  = _peers[msg.tabId];
      const isNew = !prev;
      _peers[msg.tabId] = {
        url:      msg.url  || (prev && prev.url)  || '',
        user:     msg.user || (prev && prev.user) || '',
        rtt:      msg.rtt != null ? msg.rtt : (prev ? prev.rtt : null),
        lastSeen: Date.now(),
        enabled:  isNew ? true : prev.enabled,
      };
      if (isNew) _announce();
      _renderPeers();
      _renderMulti();
    } else if (msg.type === 'bye') {
      delete _peers[msg.tabId];
      _renderPeers();
      _renderMulti();
    } else if (msg.type === 'send' && msg.targetId === TAB_ID) {
      if (window._ws || window._worker) _executeMultiPackets(msg.str);
    } else if (msg.type === 'send_at' && msg.targetId === TAB_ID) {
      if (!window._ws && !window._worker) return;
      setTimeout(() => _executeMultiPackets(msg.str), Math.max(0, msg.at - Date.now()));
    }
  };

  window.addEventListener('beforeunload', () => BC.postMessage({ type: 'bye', tabId: TAB_ID }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) _announce(); });
  setInterval(() => {
    const now = Date.now(); let changed = false;
    Object.keys(_peers).forEach(id => { if (now - _peers[id].lastSeen > 60000) { delete _peers[id]; changed = true; } });
    if (changed) { _renderPeers(); _renderMulti(); }
  }, 4000);

  function _nameToId() {
    const map = { OUT: {}, IN: {} };
    Object.entries((window.PKT||{}).OUT||{}).forEach(([id,n]) => { map.OUT[(window.shortName||String)(n,'OUT')] = parseInt(id); });
    Object.entries((window.PKT||{}).IN||{}).forEach(([id,n])  => { map.IN[(window.shortName||String)(n,'IN')]  = parseInt(id); });
    return map;
  }
  // {out:#355} / {in:#355} sends straight to logical id 355, bypassing name lookup —
  // for when only the raw header id is known and PKT has no name for it.
  function _resolveId(map, dir, name) {
    const m = name.match(/^#(\d+)$/);
    if (m) return parseInt(m[1]);
    const id = (map[dir]||{})[name];
    return id === undefined ? null : id;
  }
  function _parsePacket(str) {
    const m = (str||'').match(/^\{(out|in):([^}]+)\}([\s\S]*)/i);
    if (!m) return null;
    const dir = m[1].toUpperCase(), name = m[2].trim();
    const id  = _resolveId(_nameToId(), dir, name);
    if (id === null) return { dir, name, id: null, payload: m[3].trim(), unknown: true };
    return { dir, name, id, payload: m[3].trim(), unknown: false };
  }
  function _executePacket(str) {
    const p = _parsePacket((str||'').trim());
    if (!p || p.unknown) return false;
    return window.sendPacket ? window.sendPacket(p.dir, p.id, p.payload || undefined) : false;
  }
  function _parseMultiPackets(str) {
    const results = [], re = /\{(out|in):([^}]+)\}/gi;
    let match, lastDir = null, lastName = null, lastEnd = 0;
    const map = _nameToId();
    while ((match = re.exec(str)) !== null) {
      if (lastDir !== null) {
        const payload = str.slice(lastEnd, match.index).trim();
        const id = _resolveId(map, lastDir, lastName);
        results.push({ dir: lastDir, name: lastName, id, payload, unknown: id === null });
      }
      lastDir = match[1].toUpperCase(); lastName = match[2].trim(); lastEnd = match.index + match[0].length;
    }
    if (lastDir !== null) {
      const payload = str.slice(lastEnd).trim();
      const id = _resolveId(map, lastDir, lastName);
      results.push({ dir: lastDir, name: lastName, id, payload, unknown: id === null });
    }
    return results;
  }
  function _executeMultiPackets(str) {
    const packets = _parseMultiPackets((str||'').trim());
    packets.forEach(p => { if (!p.unknown && p.id !== null && window.sendPacket) window.sendPacket(p.dir, p.id, p.payload || undefined); });
    return packets.some(p => !p.unknown && p.id !== null);
  }

  let _renderPeers = () => {};
  let _renderMulti = () => {};
  let _orderedTabs = []; // [{id, user, enabled}] in the same order as the rendered rows —
  // Send All uses this order to stagger sends (row 1 fires first, row 2 at +offset, etc).

  function buildTestPanel() {
    const style = document.createElement('style');
    style.textContent = [
      '#__tst_back{display:flex;align-items:center;gap:10px;background:rgb(182,190,197);cursor:pointer;min-height:50px;padding:8px 12px;flex-shrink:0}',
      '#__tst_back:hover{filter:brightness(0.95)}',
      '.__tst_card{background:rgba(0,0,0,0.04);border-radius:8px;padding:8px 12px}',
      '.__tst_lbl{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:#222;display:block;margin-bottom:5px}',
      '.__tst_tabrow{display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid rgba(0,0,0,0.06)}',
      '.__tst_tabrow:last-child{border-bottom:none}',
      '.__tst_tog{font-size:9px;padding:1px 7px;border-radius:10px;border:none;cursor:pointer;font-weight:700;flex-shrink:0}',
      '.__tst_tog.on{background:#27ae60;color:#fff}.__tst_tog.off{background:#ccc;color:#666}',
      // multi-sender rows (rendered inside packet sender tab, styled to match the Gheloo dark theme)
      '#__ms_rows{padding:2px 0}',
      '.__ms_row{display:grid;grid-template-columns:46px 88px 1fr 46px;align-items:center;gap:5px;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.06);box-sizing:border-box}',
      '.__ms_row:last-child{border-bottom:none}',
      '.__ms_tog_cell{display:flex;justify-content:center}',
      '.__ms_tog_cell .__tst_tog.on{background:rgba(108,124,255,0.16);color:#A6B0FF}',
      '.__ms_tog_cell .__tst_tog.off{background:#1c1e2a;color:#5c5e6b}',
      '.__ms_name{font-size:11px;font-weight:700;color:#eceefb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.__ms_ta{width:100%;font-size:10px;font-family:monospace;padding:4px 6px;border:1px solid #23252f;border-radius:6px;background:#0A0B10;color:#eceefb;outline:none;box-sizing:border-box;resize:none;height:56px;line-height:1.4}',
      '.__ms_ta:focus{border-color:#6C7CFF}',
      '.__ms_swapbar{display:flex;justify-content:center;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.06)}',
      '.__ms_rowsend{font-size:9px;padding:1px 4px;width:46px;text-align:center}',
    ].join('');
    document.head.appendChild(style);

    // ── Main panel (330×340, same as hub) ──
    const panel = document.createElement('div');
    panel.id = '__tst';
    panel.style.cssText = 'position:fixed;top:16px;right:16px;width:330px;z-index:999999;user-select:none;display:none';
    panel.innerHTML =
      '<div class="d-flex overflow-hidden position-relative flex-column nitro-card theme-primary">' +
        '<div class="d-flex position-relative flex-column align-items-center justify-content-center drag-handler container-fluid nitro-card-header" id="__tst_hdr">' +
          '<div class="d-flex w-100 align-items-center justify-content-center">' +
            '<span class="nitro-card-header-text">Multi Tab</span>' +
            '<div class="position-absolute end-0 nitro-card-header-close" id="__tst_close"></div>' +
          '</div>' +
        '</div>' +
        '<div class="container-fluid content-area" style="height:340px;box-sizing:border-box;overflow:hidden;display:flex;flex-direction:column;padding:0">' +
          '<div id="__tst_back">' +
            '<img src="' + ARROW_B64 + '" style="width:18px;object-fit:contain;flex-shrink:0">' +
            '<div style="display:flex;flex-direction:column;gap:1px">' +
              '<span style="font-size:14px;font-weight:700;color:#222;line-height:normal">Hub</span>' +
              '<span style="font-size:11px;color:#444;line-height:normal">Terug naar het menu</span>' +
            '</div>' +
          '</div>' +
          '<div style="flex:1;overflow-y:auto;padding:8px 12px;display:flex;flex-direction:column;gap:6px">' +
            '<div class="__tst_card">' +
              '<span class="__tst_lbl">This Tab</span>' +
              '<div class="__tst_tabrow" style="border:none;padding:0">' +
                '<span id="__tst_myuser" style="font-size:11px;font-weight:700;color:#333">— <span style="font-weight:400;color:#888;font-size:9px">#' + TAB_ID + '</span></span>' +
              '</div>' +
            '</div>' +
            '<div class="__tst_card">' +
              '<span class="__tst_lbl">Other Tabs</span>' +
              '<div id="__tst_peers"><span style="color:#aaa;font-size:10px">none detected</span></div>' +
            '</div>' +
          '</div>' +
          '<div style="padding:0 12px 8px;flex-shrink:0">' +
            '<button id="__tst_openms" class="btn btn-primary btn-sm" style="width:100%;font-size:10px;font-weight:700">&#x2197; Open Multi Tab Sender</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(panel);

    // ── My info ──
    const myUserEl = panel.querySelector('#__tst_myuser');
    const peersEl  = panel.querySelector('#__tst_peers');

    function updateMyInfo() {
      const rttTag = _rttEma != null ? ' <span style="font-weight:700;color:#6C7CFF;font-size:9px">' + _rttEma + 'ms</span>' : '';
      myUserEl.innerHTML = (window._selfName || '—') + ' <span style="font-weight:400;color:#888;font-size:9px">#' + TAB_ID + '</span>' + rttTag;
    }
    if (window._selfName) updateMyInfo();
    window.onPacket && window.onPacket('UserObject', () => setTimeout(updateMyInfo, 100));

    // ── Small panel peer list ──
    _renderPeers = function() {
      const ids = Object.keys(_peers).filter(id => _peers[id].user);
      if (!ids.length) { peersEl.innerHTML = ''; return; }
      peersEl.innerHTML = ids.map(id => {
        const p       = _peers[id];
        const rttTag  = p.rtt != null ? ' <span style="font-weight:700;color:#6C7CFF;font-size:9px">' + p.rtt + 'ms</span>' : '';
        const label   = p.user + ' <span style="font-weight:400;color:#888;font-size:9px">#' + id + '</span>' + rttTag;
        const cls   = p.enabled ? 'on' : 'off';
        return '<div class="__tst_tabrow">' +
          '<button class="__tst_tog ' + cls + '" data-peer="' + id + '">' + (p.enabled ? 'ON' : 'OFF') + '</button>' +
          '<span style="font-size:11px;font-weight:600;color:#333;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + label + '</span>' +
        '</div>';
      }).join('');
      peersEl.querySelectorAll('.__tst_tog').forEach(btn => {
        btn.addEventListener('click', function() {
          const id = this.dataset.peer;
          if (_peers[id]) { _peers[id].enabled = !_peers[id].enabled; _renderPeers(); _renderMulti(); }
        });
      });
    };

    // ── Multi-sender rows (rendered inside Packet Sender's Multi Injection tab) ──
    const msRowsEl = document.getElementById('__ms_rows');

    _renderMulti = function() {
      // Save focus state before destroying DOM
      const ae = document.activeElement;
      const focusId  = (ae && ae.classList.contains('__ms_ta')) ? ae.dataset.tabid : null;
      const selStart = focusId ? ae.selectionStart : 0;
      const selEnd   = focusId ? ae.selectionEnd   : 0;

      // Save current textarea values before re-render
      msRowsEl.querySelectorAll('.__ms_ta').forEach(ta => { _pkts[ta.dataset.tabid] = ta.value; });

      const namedPeers = Object.entries(_peers).filter(([id, p]) => p.user).map(([id, p]) => ({ id, user: p.user, enabled: p.enabled, rtt: p.rtt }));
      if (!namedPeers.length) { msRowsEl.innerHTML = ''; return; }
      const allTabs = [
        { id: 'self', user: window._selfName || '—', enabled: true, rtt: _rttEma },
        ...namedPeers
      ];
      _orderedTabs = allTabs;

      const rows = allTabs.map(t => {
        const key    = t.id === 'self' ? TAB_ID : t.id;
        const val    = (_pkts[key] || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        const isSelf = t.id === 'self';
        const cls    = t.enabled ? 'on' : 'off';
        const rttTag = t.rtt != null ? '<span style="font-weight:700;color:#6C7CFF;font-size:9px;margin-left:4px">' + t.rtt + 'ms</span>' : '';
        const togCell = isSelf
          ? '<div class="__ms_tog_cell"><span style="font-size:9px;background:#A6B0FF;color:#0A0B10;padding:1px 6px;border-radius:10px;font-weight:700">YOU</span></div>'
          : '<div class="__ms_tog_cell"><button class="__tst_tog ' + cls + '" data-peer="' + t.id + '">' + (t.enabled ? 'ON' : 'OFF') + '</button></div>';
        return '<div class="__ms_row">' +
          togCell +
          '<span class="__ms_name" title="' + t.user + ' #' + key + '">' + t.user + rttTag + '</span>' +
          '<textarea class="__ms_ta" data-tabid="' + key + '" placeholder="{out:Chat}{s:&quot;hello&quot;}{i:0}">' + val + '</textarea>' +
          '<button class="__ms_rowsend __snd_btn __snd_btn_sm __snd_btn_primary" data-tabid="' + key + '" data-self="' + (isSelf ? '1' : '0') + '" disabled>Send</button>' +
        '</div>';
      });

      if (allTabs.length === 2) {
        msRowsEl.innerHTML = rows[0] +
          '<div class="__ms_swapbar"><button class="__ms_globalswap __snd_btn __snd_btn_sm __snd_btn_secondary" style="font-size:10px;padding:1px 10px">&#x21C5; Swap</button></div>' +
          rows[1];
      } else {
        msRowsEl.innerHTML = rows.join('');
      }

      // Restore focus + cursor so typing isn't interrupted by peer re-renders
      if (focusId) {
        const ta = msRowsEl.querySelector('.__ms_ta[data-tabid="' + focusId + '"]');
        if (ta) { ta.focus(); ta.setSelectionRange(selStart, selEnd); }
      }

      // Toggle ON/OFF
      msRowsEl.querySelectorAll('.__tst_tog').forEach(btn => {
        btn.addEventListener('click', function() {
          const id = this.dataset.peer;
          if (_peers[id]) { _peers[id].enabled = !_peers[id].enabled; _renderPeers(); _renderMulti(); }
        });
      });

      // Global swap (only when 2 accounts) — swaps textarea 0 ↔ textarea 1
      const globalSwap = msRowsEl.querySelector('.__ms_globalswap');
      if (globalSwap) {
        globalSwap.addEventListener('click', function() {
          const tas = msRowsEl.querySelectorAll('.__ms_ta');
          if (tas.length !== 2) return;
          const tmp    = tas[0].value;
          tas[0].value = tas[1].value;
          tas[1].value = tmp;
        });
      }

      // Per-row send
      msRowsEl.querySelectorAll('.__ms_rowsend').forEach(btn => {
        btn.addEventListener('click', function() {
          const key    = this.dataset.tabid;
          const isSelf = this.dataset.self === '1';
          const ta     = msRowsEl.querySelector('.__ms_ta[data-tabid="' + key + '"]');
          const str    = ta ? ta.value.trim() : '';
          if (!str) return;
          if (isSelf) { _executeMultiPackets(str); }
          else { BC.postMessage({ type: 'send', targetId: key, str }); }
        });
      });

      // Live validation — corr indicator + disable Send when invalid
      const sendAllBtn = document.getElementById('__ms_sendall');
      function updateSendAll() {
        const anyValid = Array.from(msRowsEl.querySelectorAll('.__ms_ta')).some(ta => {
          return _parseMultiPackets(ta.value.trim()).some(p => !p.unknown);
        });
        if (sendAllBtn) sendAllBtn.disabled = !anyValid;
      }
      msRowsEl.querySelectorAll('.__ms_ta').forEach(ta => {
        function validate() {
          const key  = ta.dataset.tabid;
          const ok   = _parseMultiPackets(ta.value.trim()).some(p => !p.unknown);
          const send = msRowsEl.querySelector('.__ms_rowsend[data-tabid="' + key + '"]');
          if (send) send.disabled = !ok;
          updateSendAll();
        }
        ta.addEventListener('input', validate);
        validate();
      });

      _updateAutoOffset();
    };

    // ── Auto offset ── ADDS to the manual value, doesn't replace it — the field stays
    // yours to type in always; toggling Auto just layers a live correction on top.
    // self always fires at the fixed T below (~20ms out); the peer's fireAt floats around
    // it as T + offsetMs. So a SIGNED correction of (selfRtt - peerRtt) is already right in
    // both directions with zero change to the send logic itself: if self is the slower
    // connection, the correction is positive and the peer (faster) is delayed to land after
    // self; if self is faster, it goes negative, which pushes the peer's fireAt before "now"
    // — send_at's own Math.max(0, ...) clamp then fires it essentially immediately, while
    // self still waits out its fixed ~20ms — net effect, self (fast) is the one delayed
    // instead. Either way the two land together server-side, on top of whatever manual
    // stagger you dialed in yourself.
    let _autoOffsetOn = false, _autoCorrectionMs = null;
    try { _autoOffsetOn = localStorage.getItem('__ghk_ms_autooffset') === '1'; } catch(_e) {}
    const autoBtn = document.getElementById('__ms_autooffset');
    const offsetEl = document.getElementById('__ms_offset');
    const offsetHintEl = document.getElementById('__ms_offset_hint');

    // Accepts a comma as the decimal separator too (Dutch keyboards type "1,5"), not just a dot.
    function _parseManualOffset() {
      return offsetEl ? (parseFloat(String(offsetEl.value).replace(',', '.')) || 0) : 0;
    }
    function _effectiveOffset() {
      return _parseManualOffset() + (_autoOffsetOn && _autoCorrectionMs != null ? _autoCorrectionMs : 0);
    }

    function _updateAutoOffset() {
      if (!autoBtn || !offsetEl) return;
      autoBtn.classList.toggle('on', _autoOffsetOn);
      _autoCorrectionMs = (_orderedTabs.length === 2 && _orderedTabs[1] && _orderedTabs[1].rtt != null && _rttEma != null)
        ? (_rttEma - _orderedTabs[1].rtt)
        : null;
      if (!offsetHintEl) return;
      if (!_autoOffsetOn) {
        offsetHintEl.textContent = 'ms tussen elke user (0 = tegelijk, mag decimaal)';
      } else if (_autoCorrectionMs != null) {
        offsetHintEl.textContent = 'manual ' + _parseManualOffset() + 'ms + auto ' +
          (_autoCorrectionMs >= 0 ? '+' : '') + _autoCorrectionMs + 'ms = ' + _effectiveOffset() + 'ms effective';
      } else {
        offsetHintEl.textContent = 'auto: wachten op ping van beide tabs…';
      }
    }
    if (autoBtn) {
      autoBtn.addEventListener('click', () => {
        _autoOffsetOn = !_autoOffsetOn;
        try { localStorage.setItem('__ghk_ms_autooffset', _autoOffsetOn ? '1' : '0'); } catch(_e) {}
        _updateAutoOffset();
      });
    }
    if (offsetEl) offsetEl.addEventListener('input', _updateAutoOffset);
    _updateAutoOffset();

    document.getElementById('__ms_sendall').addEventListener('click', () => {
      const vals = {};
      msRowsEl.querySelectorAll('.__ms_ta').forEach(ta => { vals[ta.dataset.tabid] = ta.value.trim(); });

      const offsetMs = _effectiveOffset();

      const T = Date.now() + 20;
      let step = 0;
      _orderedTabs.forEach(t => {
        const key = t.id === 'self' ? TAB_ID : t.id;
        if (!t.enabled || !vals[key]) return;
        const fireAt = T + step * offsetMs;
        step++;
        if (t.id === 'self') setTimeout(() => _executeMultiPackets(vals[key]), Math.max(0, fireAt - Date.now()));
        else BC.postMessage({ type: 'send_at', targetId: key, str: vals[key], at: fireAt });
      });
    });

    // Main panel drag + close + back
    window.__ghk_makeDraggable(panel, panel.querySelector('#__tst_hdr'), '__ghk_tst_pos', e =>
      ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.id === '__tst_close');
    panel.querySelector('#__tst_close').addEventListener('click', () => { panel.style.display = 'none'; });
    panel.querySelector('#__tst_back').addEventListener('click', () => {
      const hub = document.getElementById('__hub');
      if (hub) {
        const r = panel.getBoundingClientRect();
        hub.style.right = 'auto'; hub.style.top = 'auto';
        hub.style.left = r.left + 'px'; hub.style.top = r.top + 'px';
        hub.style.display = '';
      }
      panel.style.display = 'none';
    });

    window.__tst_panel = panel;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(buildTestPanel); }); else window.__ghk_ready(buildTestPanel);
})();
