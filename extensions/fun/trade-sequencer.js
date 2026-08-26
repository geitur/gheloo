(function() {
  if (document.getElementById('__trs_panel')) return;

  const DEFAULTS = { closeToNextMs: 150, cooldownMs: 5001 };
  const SETTINGS_KEY = '__ghk_trs_settings';
  const MIN_OPEN_TO_CLOSE = 50; // floor, in case account count makes the derived value too small/negative

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return Object.assign({}, DEFAULTS, saved);
    } catch (_e) { return Object.assign({}, DEFAULTS); }
  }
  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (_e) {}
  }

  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function init() {
    const style = document.createElement('style');
    style.textContent = [
      '#__trs_panel{position:fixed;top:16px;right:400px;width:300px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__trs_panel *{box-sizing:border-box}',
      '.__trs_card{display:flex;flex-direction:column;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb}',
      '.__trs_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__trs_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}',
      '.__trs_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__trs_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__trs_close:hover{color:#eceefb}',
      '.__trs_body{display:flex;flex-direction:column;gap:8px;padding:12px 14px}',
      '.__trs_lbl{font:700 9px/1 monospace;letter-spacing:1px;text-transform:uppercase;color:#5c5e6b;margin-bottom:4px}',
      '.__trs_row{display:flex;align-items:center;gap:8px}',
      '.__trs_select,.__trs_input{background:#0A0B10;border:1px solid #23252f;border-radius:8px;color:#eceefb;padding:6px 8px;font-size:11px;width:100%}',
      '.__trs_select:focus,.__trs_input:focus{outline:none;border-color:#6C7CFF}',
      '.__trs_input[readonly]{color:#82849a;cursor:not-allowed}',
      '.__trs_tabs{max-height:150px;overflow:auto;background:#0A0B10;border:1px solid #23252f;border-radius:8px}',
      '.__trs_taberow{display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.05)}',
      '.__trs_taberow:last-child{border-bottom:none}',
      '.__trs_tabname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}',
      '.__trs_tabstatus{font-size:9px;color:#82849a;flex-shrink:0;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}',
      '.__trs_empty{padding:16px;text-align:center;font-size:11px;color:#5c5e6b}',
      '.__trs_timing{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}',
      '.__trs_timing label{display:flex;flex-direction:column;gap:3px;font-size:9px;color:#82849a}',
      '.__trs_btnrow{display:flex;gap:8px}',
      '.__trs_btn{flex:1;border:none;border-radius:8px;font-size:11px;font-weight:600;padding:8px 10px;cursor:pointer;color:#0A0B10;background:#A6B0FF}',
      '.__trs_btn:hover:not(:disabled){filter:brightness(1.08)}',
      '.__trs_btn:disabled{opacity:.4;cursor:not-allowed}',
      '.__trs_btn.secondary{background:#23252f;color:#eceefb}',
      '.__trs_btn.danger{background:rgba(231,76,60,0.14);color:#e74c3c;border:1px solid rgba(231,76,60,0.3)}',
      '.__trs_log{font-size:9px;font-family:monospace;color:#82849a;max-height:60px;overflow:auto;background:#0A0B10;border:1px solid #23252f;border-radius:8px;padding:6px 8px}',
      '.__trs_consent{display:flex;align-items:flex-start;gap:8px;padding-top:4px;border-top:1px solid #23252f}',
      '.__trs_consent_lbl{font-size:9px;color:#82849a;line-height:1.5;cursor:pointer}',
    ].join('');
    document.head.appendChild(style);

    const settings = loadSettings();

    const panel = document.createElement('div');
    panel.id = '__trs_panel';
    panel.innerHTML =
      '<div class="__trs_card">' +
        '<div class="__trs_hdr" id="__trs_hdr">' +
          '<span class="__trs_eyebrow">Gheloo</span>' +
          '<span class="__trs_title">Spam Trader</span>' +
          '<span class="__trs_close" id="__trs_close">&times;</span>' +
        '</div>' +
        '<div class="__trs_body">' +
          '<div>' +
            '<div class="__trs_lbl">Target (synced across accounts)</div>' +
            '<div class="__trs_row">' +
              '<select id="__trs_target" class="__trs_select"><option value="">— pick someone —</option></select>' +
              '<button id="__trs_refresh" class="__trs_btn secondary" style="flex:0 0 auto;padding:6px 8px">&#8635;</button>' +
            '</div>' +
          '</div>' +
          '<div>' +
            '<div class="__trs_lbl">Accounts (in order)</div>' +
            '<div id="__trs_tabs" class="__trs_tabs"><div class="__trs_empty">No other tabs detected yet</div></div>' +
          '</div>' +
          '<div>' +
            '<div class="__trs_lbl">Timing</div>' +
            '<div class="__trs_timing">' +
              '<label>Open&#8594;Close (auto)<input id="__trs_t1" class="__trs_input" type="number" readonly></label>' +
              '<label>Close&#8594;Next (ms)<input id="__trs_t2" class="__trs_input" type="number" min="0" value="' + settings.closeToNextMs + '"></label>' +
              '<label>Cooldown (ms)<input id="__trs_t3" class="__trs_input" type="number" min="0" value="' + settings.cooldownMs + '"></label>' +
            '</div>' +
          '</div>' +
          '<div class="__trs_btnrow">' +
            '<button id="__trs_start" class="__trs_btn" disabled>&#9654; Start</button>' +
            '<button id="__trs_stop" class="__trs_btn danger" disabled>&#9632; Stop</button>' +
          '</div>' +
          '<div id="__trs_log" class="__trs_log"></div>' +
          '<div class="__trs_consent">' +
            '<input id="__trs_consent" type="checkbox" style="margin-top:2px">' +
            '<label for="__trs_consent" class="__trs_consent_lbl">Ik geef toestemming dat mijn accounts (op dit apparaat) zichtbaar en bruikbaar zijn voor mijn andere PCs. Staat na elke herlaad/relog weer uit.</label>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(panel);
    panel.style.display = 'none';

    // Sharing your own accounts with your other PCs (core/device-sync.js) — opt-in,
    // never persisted. Once on, this browser's accounts show up (unchecked) in the
    // "Accounts (in order)" list of every other PC that has consent on too.
    const consentInput = panel.querySelector('#__trs_consent');
    consentInput.addEventListener('change', () => {
      if (window.__ghk_ds) window.__ghk_ds.setConsent(consentInput.checked);
    });
    if (window.__ghk_ds) {
      consentInput.checked = window.__ghk_ds.consent;
      window.__ghk_ds.onChange(() => { consentInput.checked = window.__ghk_ds.consent; renderTabs(); });
    }

    window.__ghk_makeDraggable(panel, panel.querySelector('#__trs_hdr'), '__ghk_trs_pos', e =>
      ['BUTTON', 'INPUT', 'SELECT'].includes(e.target.tagName) || e.target.id === '__trs_close');
    panel.querySelector('#__trs_close').addEventListener('click', () => { panel.style.display = 'none'; });
    panel.addEventListener('mousedown', () => { if (window.__ghk_bringToFront) window.__ghk_bringToFront(panel); });

    const targetSel = panel.querySelector('#__trs_target');
    const tabsEl     = panel.querySelector('#__trs_tabs');
    const startBtn   = panel.querySelector('#__trs_start');
    const stopBtn    = panel.querySelector('#__trs_stop');
    const logEl      = panel.querySelector('#__trs_log');
    const t1Input    = panel.querySelector('#__trs_t1'); // derived, readonly
    const t2Input    = panel.querySelector('#__trs_t2');
    const t3Input    = panel.querySelector('#__trs_t3');

    // Declared up front — renderTabs()/updateStartEnabled() run during setup below and
    // both touch these, so they must exist before that first call (not further down the
    // file), or referencing them mid-setup throws (TDZ) and silently aborts the rest of
    // init() — which is what left Start permanently disabled and unwired before this fix.
    let _running = false;
    let _pendingTimer = null;
    const _lastOpenAt = {};  // tabId -> timestamp of the last OpenTrading we sent it
    let _rowEnabled = {};    // tabId -> bool, defaults to true for every tab seen
    let _knownUsers = {};    // index -> { name, ts } — merged roster from every tab's Room.users

    function log(msg) {
      const line = document.createElement('div');
      line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
      logEl.appendChild(line);
      logEl.scrollTop = logEl.scrollHeight;
      while (logEl.children.length > 40) logEl.removeChild(logEl.firstChild);
    }

    // ── Cross-tab sync: roster + selected target, merged from every connected account ──
    const TBC = new BroadcastChannel('nitro_trade_sequencer');
    TBC.onmessage = function(ev) {
      const msg = ev.data;
      if (!msg) return;
      if (msg.type === 'roster') {
        (msg.users || []).forEach(u => { _knownUsers[u.index] = { name: u.name, ts: msg.ts }; });
        renderTargetOptions();
      } else if (msg.type === 'target') {
        if (targetSel.value !== String(msg.index) && [...targetSel.options].some(o => o.value === String(msg.index))) {
          targetSel.value = String(msg.index); // programmatic — does not fire 'change', so no rebroadcast loop
          updateStartEnabled();
        }
      }
    };

    function renderTargetOptions() {
      const prev = targetSel.value;
      const list = Object.entries(_knownUsers)
        .map(([index, u]) => ({ index, name: u.name }))
        .filter(u => u.name && u.name !== window._selfName)
        .sort((a, b) => a.name.localeCompare(b.name));
      targetSel.innerHTML = '<option value="">— pick someone —</option>' +
        list.map(u => '<option value="' + u.index + '">' + esc(u.name) + '</option>').join('');
      if (prev && list.some(u => u.index === prev)) targetSel.value = prev;
      updateStartEnabled();
    }

    // Pulls this tab's own Room.users into the merged roster and broadcasts it so every
    // other open panel picks it up too — this is what makes the target list (and not just
    // the trade packets) the same across every connected account.
    function refreshTargets() {
      const users = (window.Room && window.Room.users) || {};
      const mine = Object.values(users).filter(u => u.isUser && u.name).map(u => ({ index: u.index, name: u.name }));
      const ts = Date.now();
      mine.forEach(u => { _knownUsers[u.index] = { name: u.name, ts }; });
      if (mine.length) TBC.postMessage({ type: 'roster', users: mine, ts });
      renderTargetOptions();
    }
    panel.querySelector('#__trs_refresh').addEventListener('click', refreshTargets);
    if (window.onPacket) window.onPacket('Users', refreshTargets);
    setInterval(refreshTargets, 5000); // keeps newly-opened panels on other tabs converged
    targetSel.addEventListener('change', () => {
      TBC.postMessage({ type: 'target', index: targetSel.value, ts: Date.now() });
      updateStartEnabled();
    });

    // ── Tab list: local tabs (multitab.js's peer registry) + every account on another PC
    // that has consented (window.__ghk_ds). Remote rows land unchecked by default in
    // renderTabs() below — still opt-in per account, just picked from this same list
    // instead of a separate popover.
    function tabList() {
      const mt = window.__ghk_mt;
      const out = [];
      if (mt) {
        out.push({ id: mt.tabId, user: window._selfName || 'You (this tab)', remote: false });
        Object.entries(mt.peers()).forEach(([id, p]) => { if (p.user) out.push({ id, user: p.user, remote: false }); });
      }
      const ds = window.__ghk_ds;
      if (ds) {
        const remote = ds.remoteAccounts();
        Object.entries(remote).forEach(([key, r]) => {
          out.push({ id: 'r:' + key, user: r.name + ' (remote)', remote: true, remoteDeviceId: r.deviceId, remoteTabId: r.tabId });
        });
      }
      return out;
    }

    // Local tabs go straight through multitab.js's BroadcastChannel; accounts picked up
    // from another PC go through the Supabase relay in core/device-sync.js instead.
    function sendToTab(tab, str) {
      if (tab.remote) { if (window.__ghk_ds) window.__ghk_ds.sendRemote(tab.remoteDeviceId, tab.remoteTabId, str); }
      else if (window.__ghk_mt) window.__ghk_mt.sendNow(tab.id, str);
    }

    // Open→Close is derived, not typed in: with Close→Next and Cooldown both fixed, this
    // is the value that makes one full pass across every enabled account take exactly
    // Cooldown ms — so starting a new pass right after the last one finishes never needs
    // to wait out anyone's per-account cooldown. The loop wraps continuously (last
    // account's Close→Next also sits between it and the FIRST account's next Open), so
    // every one of the N accounts contributes its own Close→Next gap, not N-1 of them —
    // total = N*open + N*closeNext = cooldown, i.e. open = cooldown/N - closeNext.
    function recalcOpenToClose() {
      const n = Math.max(1, tabList().filter(t => _rowEnabled[t.id]).length);
      const closeToNextMs = parseInt(t2Input.value) || DEFAULTS.closeToNextMs;
      const cooldownMs    = parseInt(t3Input.value) || DEFAULTS.cooldownMs;
      const raw = cooldownMs / n - closeToNextMs;
      t1Input.value = Math.max(MIN_OPEN_TO_CLOSE, Math.round(raw));
    }
    function saveTimingSettings() {
      saveSettings(Object.assign({}, loadSettings(), {
        closeToNextMs: parseInt(t2Input.value) || 0,
        cooldownMs: parseInt(t3Input.value) || 0,
      }));
    }
    [t2Input, t3Input].forEach(inp => inp.addEventListener('input', () => {
      saveTimingSettings();
      recalcOpenToClose();
    }));

    function renderTabs() {
      const tabs = tabList();
      if (!tabs.length) { tabsEl.innerHTML = '<div class="__trs_empty">No other tabs detected yet</div>'; updateStartEnabled(); return; }
      tabsEl.innerHTML = tabs.map(t => {
        // Local tabs default ON; accounts pulled in from another PC default OFF — you
        // still have to tick them in yourself, same as before, just from this one list.
        if (_rowEnabled[t.id] === undefined) _rowEnabled[t.id] = !t.remote;
        const last = _lastOpenAt[t.id];
        const status = last ? (Date.now() - last < 1500 ? 'just sent' : Math.round((Date.now() - last) / 1000) + 's ago') : 'ready';
        return '<div class="__trs_taberow">' +
          '<input type="checkbox" class="__trs_rowtog" data-tid="' + t.id + '" ' + (_rowEnabled[t.id] ? 'checked' : '') + '>' +
          '<span class="__trs_tabname" title="' + esc(t.user) + '">' + esc(t.user) + '</span>' +
          '<span class="__trs_tabstatus">' + esc(status) + '</span>' +
        '</div>';
      }).join('');
      tabsEl.querySelectorAll('.__trs_rowtog').forEach(cb => {
        cb.addEventListener('change', () => { _rowEnabled[cb.dataset.tid] = cb.checked; recalcOpenToClose(); updateStartEnabled(); });
      });
      recalcOpenToClose();
      updateStartEnabled();
    }
    setInterval(renderTabs, 2000);
    renderTabs();

    function updateStartEnabled() {
      const hasTarget = !!targetSel.value;
      const hasEnabledTab = tabList().some(t => _rowEnabled[t.id]);
      startBtn.disabled = _running || !hasTarget || !hasEnabledTab;
    }

    // ── Sequencer ──
    function stopSequence(reason) {
      if (_pendingTimer) clearTimeout(_pendingTimer);
      _pendingTimer = null;
      _running = false;
      stopBtn.disabled = true;
      updateStartEnabled();
      if (reason) log(reason);
    }

    function startSequence() {
      const targetIndex = targetSel.value;
      const tabs = tabList().filter(t => _rowEnabled[t.id]);
      if (!targetIndex || !tabs.length || !window.__ghk_mt) return;

      recalcOpenToClose();
      const openToCloseMs = parseInt(t1Input.value);
      const closeToNextMs = parseInt(t2Input.value) || DEFAULTS.closeToNextMs;
      const cooldownMs    = parseInt(t3Input.value) || DEFAULTS.cooldownMs;

      _running = true;
      startBtn.disabled = true;
      stopBtn.disabled = false;
      log('Start: ' + tabs.length + ' account(s) -> target #' + targetIndex + ' (open ' + openToCloseMs + 'ms)');

      let i = 0;
      function step() {
        if (!_running) return;
        if (i >= tabs.length) i = 0; // loop continuously — only Stop ends it
        const tab = tabs[i];
        const waitForCooldown = Math.max(0, cooldownMs - (Date.now() - (_lastOpenAt[tab.id] || 0)));

        _pendingTimer = setTimeout(() => {
          if (!_running) return;
          sendToTab(tab, '{out:OpenTrading}{i:' + targetIndex + '}');
          _lastOpenAt[tab.id] = Date.now();
          log('OpenTrading -> ' + tab.user);
          renderTabs();

          _pendingTimer = setTimeout(() => {
            if (!_running) return;
            sendToTab(tab, '{out:CloseTrading}');
            log('CloseTrading -> ' + tab.user);
            i++;
            _pendingTimer = setTimeout(step, closeToNextMs);
          }, openToCloseMs);
        }, waitForCooldown);
      }
      step();
    }

    startBtn.addEventListener('click', startSequence);
    stopBtn.addEventListener('click', () => stopSequence('Stopped by user.'));

    refreshTargets();
    window.__trs_panel = panel;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(init); });
  else window.__ghk_ready(init);
})();
