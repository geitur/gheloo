(function() {
  // Capture at document_start before page scripts can overwrite window.PKT
  const _nameToId = { OUT: {}, IN: {} };
  Object.entries((window.PKT||{}).OUT||{}).forEach(([id,n]) => { _nameToId.OUT[window.shortName(n,'OUT')] = parseInt(id); });
  Object.entries((window.PKT||{}).IN||{}).forEach(([id,n])  => { _nameToId.IN[window.shortName(n,'IN')]  = parseInt(id); });

  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function buildSendUI() {
    const style3 = document.createElement('style');
    style3.textContent = [
      '#__snd{position:fixed;top:16px;right:16px;width:660px;z-index:999999;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__snd *{box-sizing:border-box}',
      '.__snd_card{display:flex;flex-direction:column;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb}',
      '.__snd_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__snd_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}',
      '.__snd_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__snd_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__snd_close:hover{color:#eceefb}',
      '.__snd_tabs{display:flex;align-items:center;gap:4px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.06)}',
      '.__snd_tab{padding:6px 10px;border-radius:8px;cursor:pointer;color:#82849a;font-size:11px;font-weight:600;white-space:nowrap}',
      '.__snd_tab:hover{background:rgba(255,255,255,0.04);color:#eceefb}',
      '.__snd_tab.active{background:rgba(108,124,255,0.16);color:#A6B0FF}',
      '.__snd_pane{display:flex;flex-direction:column;gap:8px;padding:12px 14px;overflow:auto}',
      '.__snd_tabpane{height:248px!important;overflow:hidden!important;box-sizing:border-box!important;flex-shrink:0!important}',
      '.__snd_tabpane.hidden{display:none!important}',
      '.__snd_row{display:flex;gap:8px;align-items:center}',
      '.__snd_row2{display:flex;gap:8px;align-items:center;flex-shrink:0}',
      '.__snd_row3{display:flex;gap:8px;align-items:center}',
      '.__snd_grow{flex:1;min-width:0}',
      '.__snd_muted{color:#82849a;font-style:italic}',
      '.__snd_bold{color:#eceefb;font-weight:700}',
      '.__snd_lbl{flex-shrink:0;color:#82849a}',
      '.__snd_histhdr{display:flex;align-items:center;gap:6px;flex-shrink:0;width:155px}',
      '#__inj_corr.bad{color:#e74c3c!important}',
      '#__inj_corr.good{color:#2ecc71!important}',
      '.__snd_split{display:flex;gap:8px;flex:1;overflow:hidden}',
      '.__snd_col{display:flex;flex-direction:column;gap:6px;flex:1;overflow:hidden}',
      '.__snd_textarea{flex:1;min-height:0;resize:none;font-family:monospace;font-size:11px;background:#0A0B10;border:1px solid #23252f;border-radius:8px;color:#eceefb;padding:8px}',
      '.__snd_textarea:focus{outline:none;border-color:#6C7CFF}',
      '.__snd_input{background:#0A0B10;border:1px solid #23252f;border-radius:8px;color:#eceefb;padding:6px 8px;font-size:11px}',
      '.__snd_input:focus{outline:none;border-color:#6C7CFF}',
      '#__sk_pkt,#__bst_pkt{font-family:monospace}',
      '.__snd_radio{display:flex;align-items:center;gap:4px;color:#82849a;font-size:11px;cursor:pointer;flex-shrink:0}',
      '.__snd_hist_wrap{width:155px;flex-shrink:0;display:flex;flex-direction:column}',
      '.__snd_hist{flex:1;min-height:0;overflow:auto;background:#0A0B10;border:1px solid #23252f;border-radius:8px}',
      '.__snd_hitem{display:block;width:100%;background:none;border:none;border-bottom:1px solid rgba(255,255,255,0.05);color:#82849a;font:9px monospace;padding:5px 8px;cursor:pointer;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;box-sizing:border-box}',
      '.__snd_hitem:hover{color:#eceefb;background:rgba(255,255,255,0.04)}',
      '.__snd_btn{border:none;border-radius:8px;font-size:11px;font-weight:600;padding:6px 10px;cursor:pointer}',
      '.__snd_btn:disabled{opacity:.4;cursor:not-allowed}',
      '.__snd_btn_sm{font-size:9px;padding:3px 8px}',
      '.__snd_btn_primary,.__snd_btn_success{background:#A6B0FF;color:#0A0B10}',
      '.__snd_btn_primary:hover:not(:disabled),.__snd_btn_success:hover:not(:disabled){filter:brightness(1.08)}',
      '.__snd_btn_secondary{background:#1c1e2a;color:#eceefb;border:1px solid #23252f}',
      '.__snd_btn_secondary:hover:not(:disabled){background:rgba(255,255,255,0.06)}',
      '.__snd_btn_danger{background:rgba(231,76,60,0.15);color:#e74c3c}',
      '.__snd_btn_danger:hover:not(:disabled){background:rgba(231,76,60,0.28)}',
      '.__sk_tog.on{background:rgba(108,124,255,0.16);color:#A6B0FF}',
      '.__snd_form{display:flex;flex-direction:column;gap:8px}',
      '.__snd_table{overflow:auto;background:#0A0B10;border:1px solid #23252f;border-radius:8px}',
      '#__sk_thead,.__sk_row{display:grid;grid-template-columns:50px 1fr 70px 48px 90px;align-items:center}',
      '#__sk_thead{position:sticky;top:0;background:#12131A;border-bottom:1px solid #23252f}',
      '#__sk_thead span{padding:6px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#5c5e6b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.__sk_row{border-bottom:1px solid rgba(255,255,255,0.05);font-size:10px}.__sk_row:hover{background:rgba(255,255,255,0.03)}',
      '.__sk_row>span{padding:4px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#eceefb;font-family:monospace}',
      '.__sk_act{display:flex;gap:3px;padding:2px 4px;align-items:center}',
      '#__sk_empty{padding:20px;font-size:11px;text-align:center;color:#5c5e6b}',
      '#__bst_thead,.__bst_row{display:grid;grid-template-columns:30px 1fr 36px;align-items:center}',
      '#__bst_thead{position:sticky;top:0;background:#12131A;border-bottom:1px solid #23252f}',
      '#__bst_thead span{padding:6px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#5c5e6b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.__bst_row{border-bottom:1px solid rgba(255,255,255,0.05);font-size:10px}.__bst_row:hover{background:rgba(255,255,255,0.03)}',
      '.__bst_row>span{padding:4px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#eceefb;font-family:monospace}',
      '#__bst_empty{padding:20px;font-size:11px;text-align:center;color:#5c5e6b}',
    ].join('');
    document.head.appendChild(style3);

    const _toolbarStyle = document.createElement('style');
    _toolbarStyle.textContent = [
      '.nitro-purse-container{height:auto!important;overflow:hidden!important;font-family:"Ubuntu Custom",sans-serif!important;font-size:13px!important;pointer-events:all!important;}',
      '.nitro-purse-container.__purse_hidden{display:none!important;}',
      '#PurseButtonCollapse{z-index:70!important;pointer-events:all!important;}',
      '#PurseButtonCollapse ._Vertical_1tsga_24._Rounded_1tsga_15{display:flex!important;justify-content:center!important;align-items:center!important;background:rgba(46,46,44,0.659)!important;box-shadow:inset 0 2px 0 0 hsla(0,0%,100%,.2),inset 2px 0 0 0 hsla(0,0%,100%,.2),inset -2px 0 0 0 hsla(0,0%,100%,.2)!important;border-top:1px solid rgba(0,0,0,.29)!important;border-left:1px solid rgba(0,0,0,.29)!important;border-right:1px solid rgba(0,0,0,.29)!important;border-bottom:none!important;border-radius:6px 6px 0 0!important;}',
      '#PurseButtonCollapse.collapsed ._Vertical_1tsga_24._Rounded_1tsga_15{border-bottom:1px solid rgba(0,0,0,.29)!important;border-radius:6px!important;}',
      '#PurseButtonCollapse svg{color:rgb(156,151,146)!important;}',
      '#__purse_wrap .align-items-end{align-items:flex-end!important;}',
      '#__purse_wrap .gap-1{grid-gap:.25rem!important;gap:.25rem!important;}',
      '#__purse_wrap.flex-column{flex-direction:column!important;}',
      '#__purse_wrap.d-flex{display:flex!important;}',
      '#__purse_wrap .nitro-purse-container{border-top:none!important;border-top-left-radius:0!important;border-top-right-radius:0!important;}',
      '#toolbar-friend-bar-container{display:block!important;margin-left:10px!important;}',
      '.icon-friendall{order:2!important;}',
    ].join('');
    document.head.appendChild(_toolbarStyle);
    new MutationObserver(function() {
      if (document.head.lastChild !== _toolbarStyle) document.head.appendChild(_toolbarStyle);
    }).observe(document.head, { childList: true });

    // Toggleable feature styles (controlled by Interface switches in hub)
    window._fStyle = {};
    window._fStyle.darkLayout = document.createElement('style');
    window._fStyle.darkLayout.textContent = [
      '.nitro-toolbar{background:rgba(46,46,46,0.6)!important;box-shadow:rgba(66,66,66,0.6) 0px 2px 0px 0px inset!important;border-top:1px solid rgba(0,0,0,0.6)!important;border-bottom:1px solid rgba(66,66,66,0.6)!important;}',
      '.nitro-context-menu:not(.name-only),.nitro-context-menu.hibisco:not(.name-only){background:rgb(44,44,44)!important;border:1px solid rgba(255,255,255,0.5)!important;border-radius:6px!important;padding:2px!important;}',
      '.nitro-context-menu .menu-header,.nitro-context-menu.hibisco .menu-header{background:rgba(86,86,86,0.533)!important;color:#fff!important;height:25px!important;max-height:25px!important;font-size:16px!important;margin-bottom:2px!important;border-radius:4px 4px 0 0!important;}',
      '.nitro-context-menu .menu-item.list-item,.nitro-context-menu.hibisco .menu-item.list-item{height:24px!important;max-height:24px!important;padding:3px!important;margin-bottom:1px!important;background:rgba(26,26,26,0.667)!important;color:#ffffff!important;cursor:pointer!important;border-radius:3px!important;}',
      '.nitro-context-menu .menu-item.list-item:hover,.nitro-context-menu.hibisco .menu-item.list-item:hover{background:rgba(70,70,70,0.85)!important;}',
      '.nitro-context-menu .menu-footer,.nitro-context-menu.hibisco .menu-footer{background:rgba(86,86,86,0.25)!important;border-radius:0 0 4px 4px!important;}',
      '.nitro-notification-bubble{background-color:rgba(46,46,44,0.7)!important;box-shadow:rgba(34,34,39,0.05) 0px 5px inset,rgba(18,18,21,0.05) 0px -4px inset!important;}',
      '.nitro-room-tools-container .nitro-room-tools{background:rgba(46,46,46,0.6)!important;box-shadow:rgba(66,66,66,0.6) 0px 2px 0px 0px inset!important;border-top:1px solid rgba(0,0,0,0.6)!important;border-bottom:1px solid rgba(66,66,66,0.6)!important;}',
      '.nitro-room-tools-info{background:rgba(46,46,46,0.6)!important;border:none!important;box-shadow:none!important;}',
      '.nitro-room-tools-info .text-white{color:#e8e8e8!important;}',
      '.nitro-room-tools-info .text-muted{color:rgba(180,180,180,0.7)!important;}',
    ].join('');
    document.head.appendChild(window._fStyle.darkLayout);

    const _isMac = /Mac/.test(navigator.platform || navigator.userAgentData?.platform || '');
    window._chatInToolbarEnabled = !_isMac;
    window._fStyle.chatInToolbar = document.createElement('style');
    window._fStyle.chatInToolbar.textContent = '.nitro-room-chatinput-component{font-family:"Ubuntu Custom",sans-serif!important;position:fixed!important;display:flex!important;align-items:center!important;justify-content:center!important;width:100%!important;bottom:8px!important;pointer-events:none!important;left:0px!important;z-index:80!important;}';
    if (!_isMac) document.head.appendChild(window._fStyle.chatInToolbar);

    window._fStyle.hideArrows = document.createElement('style');
    window._fStyle.hideArrows.textContent = '.toolbar-home-bar-button .left{display:none!important;}';
    document.head.appendChild(window._fStyle.hideArrows);

    window._fStyle.customFriendList = document.createElement('style');
    window._fStyle.customFriendList.textContent = '.friend-bar .friend-bar-item:nth-child(n+5){display:none!important;}.friend-bar-search{display:none!important;}';
    document.head.appendChild(window._fStyle.customFriendList);

    function _injectPurseBtn() {
      if (document.getElementById('PurseButtonCollapse')) return;
      const purse = document.querySelector('.nitro-purse-container');
      if (!purse || !purse.parentNode) return;
      const wrapper = document.createElement('div');
      wrapper.id = '__purse_wrap';
      wrapper.className = 'd-flex flex-column position-relative';
      wrapper.style.marginLeft = '2px';

      const btn = document.createElement('div');
      btn.id = 'PurseButtonCollapse';
      btn.style.zIndex = '70';
      btn.style.pointerEvents = 'all';
      btn.innerHTML = '<div class="_Vertical_1tsga_24 _Rounded_1tsga_15 cursor-pointer" style="width:198px"><svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 256 256" height="14" width="14" style="color:rgb(156,151,146)"><path d="M216.49,168.49a12,12,0,0,1-17,0L128,97,56.49,168.49a12,12,0,0,1-17-17l80-80a12,12,0,0,1,17,0l80,80A12,12,0,0,1,216.49,168.49Z"/></svg></div>';
      let collapsed = false;
      btn.addEventListener('click', function() {
        collapsed = !collapsed;
        purse.classList.toggle('__purse_hidden', collapsed);
        btn.classList.toggle('collapsed', collapsed);
        btn.querySelector('svg').style.transform = collapsed ? 'rotate(180deg)' : '';
      });
      purse.parentNode.insertBefore(wrapper, purse);
      wrapper.appendChild(btn);
      wrapper.appendChild(purse);
    }
    new MutationObserver(_injectPurseBtn).observe(document.body, { childList: true, subtree: true });
    _injectPurseBtn();

    function _moveMsgIcon() {
      const msg = document.querySelector('.navigation-item.icon-message');
      if (!msg) return;
      const friendBar = document.getElementById('toolbar-friend-bar-container');
      if (!friendBar || !friendBar.parentNode) return;
      if (msg.parentNode === friendBar.parentNode) return;
      friendBar.parentNode.insertBefore(msg, friendBar);
    }
    new MutationObserver(_moveMsgIcon).observe(document.body, { childList: true, subtree: true });
    _moveMsgIcon();

    document.addEventListener('click', function(e) {
      if (!e.target.classList.contains('clear')) return;
      if (document.querySelectorAll('.clear').length <= 1) {
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);

    window._applyChatFix = function(el) {
      el.style.setProperty('position', 'fixed', 'important');
      el.style.setProperty('bottom', '8px', 'important');
      el.style.setProperty('left', '0px', 'important');
      el.style.setProperty('width', '100%', 'important');
      el.style.setProperty('pointer-events', 'none', 'important');
      el.style.setProperty('z-index', '80', 'important');
    };
    function _fixChatInput() {
      const el = document.querySelector('.nitro-room-chatinput-component');
      if (!el || el.__chatFixed) return;
      el.__chatFixed = true;
      const obs = new MutationObserver(() => {
        obs.disconnect();
        if (window._chatInToolbarEnabled) window._applyChatFix(el);
        obs.observe(el, { attributes: true, attributeFilter: ['style'] });
      });
      obs.observe(el, { attributes: true, attributeFilter: ['style'] });
      if (window._chatInToolbarEnabled) _applyChatFix(el);
    }
    new MutationObserver(_fixChatInput).observe(document.body, { childList: true, subtree: true });
    _fixChatInput();

    const panel = document.createElement('div');
    panel.id = '__snd';
    panel.innerHTML =
      '<div class="__snd_card">' +
        '<div class="__snd_hdr" id="__snd_hdr">' +
          '<span class="__snd_eyebrow">Gheloo</span>' +
          '<span class="__snd_title">Packet Sender</span>' +
          '<span class="__snd_close" id="__snd_hclose">&times;</span>' +
        '</div>' +
        '<div class="__snd_tabs">' +
          '<div class="__snd_tab active __sdtab" data-tab="inject">Injection</div>' +
          '<div class="__snd_tab __sdtab" data-tab="sched">Scheduler</div>' +
          '<div class="__snd_tab __sdtab" data-tab="multi">Multi Injection</div>' +
          '<div class="__snd_tab __sdtab" data-tab="burst">Burst</div>' +
        '</div>' +
        '<div class="__snd_pane __snd_tabpane" id="__snd_inject">' +
          '<div class="__snd_row">' +
            '<small id="__inj_corr" class="__snd_muted __snd_grow">isCorrupted: False</small>' +
            '<div class="__snd_histhdr">' +
              '<small class="__snd_bold">History:</small>' +
              '<button id="__snd_clr" class="__snd_btn __snd_btn_sm __snd_btn_secondary" style="margin-left:auto">Clear</button>' +
            '</div>' +
          '</div>' +
          '<div class="__snd_split">' +
            '<div class="__snd_col">' +
              '<textarea id="__snd_payload" class="__snd_textarea" placeholder="{out:Chat}{s:&quot;text&quot;}{i:0}"></textarea>' +
              '<div class="__snd_row2">' +
                '<button id="__snd_send" class="__snd_btn __snd_btn_success __snd_grow">Send to server</button>' +
                '<button id="__snd_din_btn" class="__snd_btn __snd_btn_primary __snd_grow">Send to client</button>' +
              '</div>' +
            '</div>' +
            '<div class="__snd_hist_wrap">' +
              '<div id="__snd_history" class="__snd_hist"></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="__snd_pane __snd_tabpane hidden" id="__snd_sched">' +
          '<div id="__sk_scroll" class="__snd_table" style="height:160px">' +
            '<div id="__sk_thead"><span>Index</span><span>Packet</span><span>Interval</span><span>Dest</span><span>Actions</span></div>' +
            '<div id="__sk_tbody"><div id="__sk_empty">No scheduled packets</div></div>' +
          '</div>' +
          '<div class="__snd_form" id="__sk_form">' +
            '<div class="__snd_row3">' +
              '<small class="__snd_lbl">Packet:</small>' +
              '<input id="__sk_pkt" type="text" class="__snd_input __snd_grow" placeholder="{out:Chat}{s:&quot;text&quot;}{i:0}" />' +
            '</div>' +
            '<div class="__snd_row3">' +
              '<small class="__snd_lbl">Interval:</small>' +
              '<input id="__sk_int" type="text" class="__snd_input" value="500" style="width:70px" />' +
              '<label class="__snd_radio"><input type="radio" name="__sk_dest" id="__sk_rin" value="IN" /> In</label>' +
              '<label class="__snd_radio"><input type="radio" name="__sk_dest" id="__sk_rout" value="OUT" checked /> Out</label>' +
              '<button id="__sk_add" class="__snd_btn __snd_btn_primary" style="margin-left:auto">Add</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="__snd_pane __snd_tabpane hidden" id="__snd_multi">' +
          '<div id="__ms_rows" class="__snd_table" style="flex:1;min-height:0"></div>' +
          '<button id="__ms_sendall" class="__snd_btn __snd_btn_success" style="width:100%;font-weight:800;flex-shrink:0" disabled>&#9654; Send All</button>' +
        '</div>' +
        '<div class="__snd_pane __snd_tabpane hidden" id="__snd_burst">' +
          '<div id="__bst_scroll" class="__snd_table" style="height:160px">' +
            '<div id="__bst_thead"><span>#</span><span>Packet</span><span></span></div>' +
            '<div id="__bst_tbody"><div id="__bst_empty">No packets added</div></div>' +
          '</div>' +
          '<div class="__snd_form">' +
            '<div class="__snd_row3">' +
              '<small class="__snd_lbl">Packet:</small>' +
              '<input id="__bst_pkt" type="text" class="__snd_input __snd_grow" placeholder="{out:Chat}{s:&quot;text&quot;}{i:0}" />' +
              '<button id="__bst_add" class="__snd_btn __snd_btn_secondary" style="flex-shrink:0">Add</button>' +
            '</div>' +
            '<div class="__snd_row3">' +
              '<small class="__snd_lbl">Delay:</small>' +
              '<input id="__bst_delay" type="number" class="__snd_input" value="0" min="0" style="width:80px;flex-shrink:0" />' +
              '<small class="__snd_muted" style="flex-shrink:0">ms (0 = simultaneous)</small>' +
              '<button id="__bst_fire" class="__snd_btn __snd_btn_success" style="margin-left:auto">Fire All</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(panel);
    panel.style.display = 'none';

    // Drag
    window.__ghk_makeDraggable(panel, panel.querySelector('#__snd_hdr'), '__ghk_snd_pos', e =>
      ['BUTTON', 'INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.id === '__snd_hclose');

    // Close
    panel.querySelector('#__snd_hclose').addEventListener('click', ()=>{ panel.style.display='none'; });

    // Tabs
    const tabBtns = panel.querySelectorAll('.__sdtab');
    const panes   = { inject: panel.querySelector('#__snd_inject'), sched: panel.querySelector('#__snd_sched'), multi: panel.querySelector('#__snd_multi'), burst: panel.querySelector('#__snd_burst') };
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const t = btn.dataset.tab;
        Object.entries(panes).forEach(([k,p]) => { p.classList.toggle('hidden', k!==t); });
      });
    });

    // ── INJECTOR ──
    const nameToId = _nameToId;

    // {out:#355} / {in:#355} sends straight to logical id 355, bypassing name lookup —
    // for when you only know the raw header id (e.g. from another tool's capture) and
    // Gheloo's own PKT dictionary doesn't resolve a name for it.
    function _resolveId(dir, name) {
      const m = name.match(/^#(\d+)$/);
      if (m) return parseInt(m[1]);
      const id = nameToId[dir][name];
      return id === undefined ? null : id;
    }

    // Parse {out:Name} or {in:Name} prefix
    function parseInjPacket(str) {
      const m = str.match(/^\{(out|in):([^}]+)\}(.*)/si);
      if (!m) return null;
      const dir  = m[1].toLowerCase() === 'out' ? 'OUT' : 'IN';
      const name = m[2].trim();
      const id   = _resolveId(dir, name);
      if (id === null) return { dir, name, id: null, payload: m[3].trim(), unknown: true };
      return { dir, name, id, payload: m[3].trim(), unknown: false };
    }
    function parseInjMultiPackets(str) {
      const results = [], re = /\{(out|in):([^}]+)\}/gi;
      let match, lastDir = null, lastName = null, lastEnd = 0;
      while ((match = re.exec(str)) !== null) {
        if (lastDir !== null) {
          const payload = str.slice(lastEnd, match.index).trim();
          const dir = lastDir === 'out' ? 'OUT' : 'IN', id = _resolveId(dir, lastName);
          results.push({ dir, name: lastName, id, payload, unknown: id === null });
        }
        lastDir = match[1].toLowerCase(); lastName = match[2].trim(); lastEnd = match.index + match[0].length;
      }
      if (lastDir !== null) {
        const payload = str.slice(lastEnd).trim();
        const dir = lastDir === 'out' ? 'OUT' : 'IN', id = _resolveId(dir, lastName);
        results.push({ dir, name: lastName, id, payload, unknown: id === null });
      }
      return results;
    }

    const histEl    = panel.querySelector('#__snd_history');
    const corrEl    = panel.querySelector('#__inj_corr');
    const pinfoEl   = { textContent:'' };
    const serverBtn = panel.querySelector('#__snd_send');
    const clientBtn = panel.querySelector('#__snd_din_btn');
    const injHistory = [];

    function updateInjInfo() {
      const str     = panel.querySelector('#__snd_payload').value;
      const packets = parseInjMultiPackets(str.trim());
      const allOk   = packets.length > 0 && packets.every(p => !p.unknown);
      if (!str.trim() || !packets.length || !packets.some(p => !p.unknown)) {
        corrEl.textContent = 'isCorrupted: True';
        corrEl.classList.add('bad'); corrEl.classList.remove('good');
        pinfoEl.textContent = '';
        serverBtn.disabled = true; clientBtn.disabled = true;
      } else {
        corrEl.textContent = allOk ? 'isCorrupted: False' : 'isCorrupted: Partial';
        corrEl.classList.toggle('bad', !allOk); corrEl.classList.toggle('good', allOk);
        pinfoEl.textContent = '';
        serverBtn.disabled = !packets.some(p => !p.unknown && p.dir === 'OUT');
        clientBtn.disabled = !packets.some(p => !p.unknown && p.dir === 'IN');
      }
    }
    panel.querySelector('#__snd_payload').addEventListener('input', updateInjInfo);
    updateInjInfo();

    function pushHistory(parsed, fullStr, count) {
      injHistory.unshift({ parsed, str: fullStr, count: count || 1 });
      if (injHistory.length > 50) injHistory.pop();
      histEl.innerHTML = '';
      injHistory.forEach(function(h) {
        const btn = document.createElement('button');
        btn.className = '__snd_hitem';
        btn.title = h.str;
        const countTag = h.count > 1 ? '[' + h.count + '] ' : '';
        btn.textContent = (h.parsed.dir==='OUT'?'→':'←') + ' ' + countTag + h.parsed.name + '  ' + h.parsed.payload.slice(0,20);
        btn.addEventListener('click', function() {
          panel.querySelector('#__snd_payload').value = h.str;
          updateInjInfo();
        });
        histEl.appendChild(btn);
      });
    }

    function doSend(dir) {
      const str     = panel.querySelector('#__snd_payload').value.trim();
      const packets = parseInjMultiPackets(str).filter(p => !p.unknown && p.id !== null && p.dir === dir);
      if (!packets.length) return;
      packets.forEach(p => window.sendPacket(dir, p.id, p.payload));
      pushHistory(packets[0], str, packets.length);
    }

    panel.querySelector('#__snd_send').addEventListener('click', () => doSend('OUT'));
    panel.querySelector('#__snd_din_btn').addEventListener('click', () => doSend('IN'));
    panel.querySelector('#__snd_clr').addEventListener('click', () => {
      histEl.innerHTML=''; injHistory.length=0;
    });

    // ── SCHEDULER ──
    const schedules = [];
    let schedNextId = 1;
    const tbody = panel.querySelector('#__sk_tbody');

    function parseInterval(s) {
      const base = parseInt((s+'').split('+')[0]) || 500;
      const jitter = parseInt((s+'').split('+')[1]) || 0;
      return Math.max(50, base + Math.floor(Math.random()*(jitter+1)));
    }

    // Scheduler only needs valid format to add; ID resolved at Start time
    function parseSchedPacket(str) {
      return parseInjPacket(str);
    }

    function renderScheduler() {
      tbody.innerHTML = schedules.length
        ? schedules.map((s,i) =>
            '<div class="__sk_row">' +
              '<span class="__sk_i">' + (i+1) + '</span>' +
              '<span class="__sk_p" title="' + esc(s.packet) + '">' + esc(s.packet) + '</span>' +
              '<span class="__sk_iv">' + s.interval + 'ms</span>' +
              '<span class="__sk_d">' + s.dest + '</span>' +
              '<div class="__sk_act">' +
                '<button class="__snd_btn __snd_btn_sm __snd_btn_secondary __sk_tog' + (s.enabled?' on':'') + '" data-sid="' + s.id + '">' + (s.enabled?'Stop':'Start') + '</button>' +
                '<button class="__snd_btn __snd_btn_sm __snd_btn_danger __sk_del" data-sid="' + s.id + '">&#x2715;</button>' +
              '</div>' +
            '</div>'
          ).join('')
        : '<div id="__sk_empty">No scheduled packets</div>';

      tbody.querySelectorAll('.__sk_tog').forEach(btn => {
        btn.addEventListener('click', function() {
          const s = schedules.find(x => x.id === parseInt(this.dataset.sid));
          if (!s) return;
          toggleSchedule(s);
        });
      });
      tbody.querySelectorAll('.__sk_del').forEach(btn => {
        btn.addEventListener('click', function() {
          const idx = schedules.findIndex(x => x.id === parseInt(this.dataset.sid));
          if (idx < 0) return;
          if (schedules[idx]._timer) clearInterval(schedules[idx]._timer);
          schedules.splice(idx, 1);
          renderScheduler();
        });
      });
    }

    function toggleSchedule(s) {
      if (s.enabled) {
        clearInterval(s._timer); s._timer = null; s.enabled = false;
      } else {
        const parsed = parseSchedPacket(s.packet);
        if (!parsed || parsed.id === null) { alert('Unknown packet name: ' + s.packet); return; }
        const fire = () => { window.sendPacket(parsed.dir, parsed.id, parsed.payload); };
        fire();
        s._timer = setInterval(fire, parseInterval(s.interval));
        s.enabled = true;
      }
      renderScheduler();
    }

    const addBtn = panel.querySelector('#__sk_add');
    function updateSchedAdd() {
      const pkt = panel.querySelector('#__sk_pkt').value.trim();
      const parsed = parseSchedPacket(pkt);
      if (parsed) {
        panel.querySelector(parsed.dir === 'OUT' ? '#__sk_rout' : '#__sk_rin').checked = true;
      }
      addBtn.disabled = !pkt || !parsed;
    }
    panel.querySelector('#__sk_pkt').addEventListener('input', updateSchedAdd);
    updateSchedAdd();

    function doSchedAdd() {
      const pkt = panel.querySelector('#__sk_pkt').value.trim();
      const parsed = parseSchedPacket(pkt);
      if (!parsed || addBtn.disabled) return;
      const iv = panel.querySelector('#__sk_int').value.trim() || '500';
      schedules.push({ id: schedNextId++, packet: pkt, interval: iv, dest: parsed.dir, enabled: false, _timer: null });
      renderScheduler();
      panel.querySelector('#__sk_pkt').value = '';
      updateSchedAdd();
    }
    addBtn.addEventListener('click', doSchedAdd);
    panel.querySelector('#__sk_pkt').addEventListener('keydown', e => { if (e.key === 'Enter') doSchedAdd(); });

    renderScheduler();

    // ── BURST ──
    const bursts = [];
    const btbody = panel.querySelector('#__bst_tbody');

    function renderBurst() {
      btbody.innerHTML = bursts.length
        ? bursts.map((b, i) =>
            '<div class="__bst_row">' +
              '<span>' + (i+1) + '</span>' +
              '<span title="' + esc(b.packet) + '">' + esc(b.packet) + '</span>' +
              '<button class="__snd_btn __snd_btn_sm __snd_btn_danger __bst_del" data-bi="' + i + '" style="padding:1px 4px;font-size:10px;margin:2px 4px">&#x2715;</button>' +
            '</div>'
          ).join('')
        : '<div id="__bst_empty">No packets added</div>';
      btbody.querySelectorAll('.__bst_del').forEach(btn => {
        btn.addEventListener('click', function() {
          bursts.splice(parseInt(this.dataset.bi), 1);
          renderBurst();
        });
      });
    }

    const bstAddBtn  = panel.querySelector('#__bst_add');
    const bstFireBtn = panel.querySelector('#__bst_fire');

    function updateBurstAdd() {
      const pkt = panel.querySelector('#__bst_pkt').value.trim();
      bstAddBtn.disabled = !pkt || !parseInjPacket(pkt);
    }
    panel.querySelector('#__bst_pkt').addEventListener('input', updateBurstAdd);
    updateBurstAdd();

    function doBurstAdd() {
      const pkt = panel.querySelector('#__bst_pkt').value.trim();
      if (!pkt || !parseInjPacket(pkt)) return;
      bursts.push({ packet: pkt });
      renderBurst();
      panel.querySelector('#__bst_pkt').value = '';
      updateBurstAdd();
    }
    bstAddBtn.addEventListener('click', doBurstAdd);
    panel.querySelector('#__bst_pkt').addEventListener('keydown', e => { if (e.key === 'Enter') doBurstAdd(); });

    bstFireBtn.addEventListener('click', function() {
      if (!bursts.length) return;
      const delay = parseInt(panel.querySelector('#__bst_delay').value) || 0;
      if (delay <= 0) {
        bursts.forEach(b => {
          const p = parseInjPacket(b.packet);
          if (p && p.id !== null) window.sendPacket(p.dir, p.id, p.payload);
        });
      } else {
        bursts.forEach((b, i) => {
          setTimeout(function() {
            const p = parseInjPacket(b.packet);
            if (p && p.id !== null) window.sendPacket(p.dir, p.id, p.payload);
          }, delay * i);
        });
      }
    });

    renderBurst();


    // Public API
    window.__snd_panel = panel;
    window.__snd_fill  = function(dir, id, gEarthStr) {
      // Look up packet name from numeric id — fall back to #id (like the logger does)
      // when there's no resolvable name, instead of dropping the header entirely.
      const rawName = (window.PKT[dir]||{})[id];
      const name    = rawName ? window.shortName(rawName, dir) : null;
      const prefix  = '{' + dir.toLowerCase() + ':' + (name || ('#' + id)) + '}';
      panel.querySelector('#__snd_payload').value = prefix + (gEarthStr || '');
      // Switch to injector tab
      tabBtns.forEach(b => b.classList.remove('active'));
      panel.querySelector('[data-tab="inject"]').classList.add('active');
      Object.entries(panes).forEach(([k,p]) => { p.classList.toggle('hidden', k!=='inject'); });
      if (panel.style.display === 'none') panel.style.display = '';
      updateInjInfo();
    };
  }


  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(buildSendUI); });
  else window.__ghk_ready(buildSendUI);
})();

class CatalogItem {

    constructor(id, name) {
        this.id = id;
        this.name = name;

        this.meta = [];
        this.extended = [];
    }
}

class CatalogPage {

    constructor(packet) {

        /* =========================
           HEADER
        ========================= */

        this.pageId = packet.readInt();
        this.catalogType = packet.readString();
        this.layoutCode = packet.readString();

        /* =========================
           IMAGES
        ========================= */

        const imageCount = packet.readInt();
        this.images = [];

        for (let i = 0; i < imageCount; i++) {
            this.images.push(packet.readString());
        }

        /* =========================
           TEXTS
        ========================= */

        const textCount = packet.readInt();
        this.texts = [];

        for (let i = 0; i < textCount; i++) {
            this.texts.push(packet.readString());
        }

        /* =========================
           ITEMS
        ========================= */

        const itemCount = packet.readInt();
        this.items = [];

        for (let i = 0; i < itemCount; i++) {

            const itemId = packet.readInt();
            const itemName = packet.readString();

            const item = new CatalogItem(itemId, itemName);

            /* =========================
               FIXED META BLOCK (always present)
            ========================= */

            // This ALWAYS exists in your packet
            for (let m = 0; m < 6; m++) {
                item.meta.push(packet.readInt());
            }

            // visual/hash (can be int or x:)
            const visual = this.readFlexible(packet);
            item.visual = visual;

            // second fixed block
            for (let m = 0; m < 4; m++) {
                item.meta.push(packet.readInt());
            }

            /* =========================
               OPTIONAL EXTENSION BLOCK
               (THIS is what breaks old parsers)
            ========================= */

            while (!packet.isEOF()) {

                const pos = packet.getReadIndex();

                const type = packet.peekType?.();

                // next item detected
                if (type === "int") {

                    const test = packet.readInt();

                    // heuristic: next item ID is usually small + followed by string
                    const nextPeek = packet.peekType?.();

                    if (nextPeek === "string") {
                        packet.setReadIndex(pos);
                        break;
                    }

                    item.extended.push({
                        type: "int",
                        value: test
                    });

                    continue;
                }

                if (type === "string") {
                    item.extended.push({
                        type: "string",
                        value: packet.readString()
                    });
                    continue;
                }

                if (type === "boolean") {
                    item.extended.push({
                        type: "boolean",
                        value: packet.readBoolean()
                    });
                    continue;
                }

                // fallback safety
                const fallback = packet.readInt();
                item.extended.push({
                    type: "int",
                    value: fallback
                });

                // safety break
                if (packet.getReadIndex() === pos) break;
            }

            this.items.push(item);
        }

        /* =========================
           FOOTER
        ========================= */

        this.endFlag = false;

        if (!packet.isEOF()) {
            try {
                this.endFlag = packet.readBoolean();
            } catch (e) {}
        }
    }

    /* =========================
       HELPER: flexible int/x parsing
    ========================= */

    readFlexible(packet) {

        if (packet.peekType?.() === "hex") {
            return packet.readHex();
        }

        return packet.readInt();
    }
}
