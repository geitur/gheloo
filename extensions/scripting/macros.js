(function() {
  const STORAGE_KEY = '__hbl_macros';
  let _macros = [];
  let _editing = null; // null=list, -1=new, number=id

  function _load() { try { _macros = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch(_) { _macros = []; } }
  function _save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(_macros)); }
  function _nextId() { return _macros.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1; }
  function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function buildMacrosUI() {
    _load();

    const style = document.createElement('style');
    style.textContent = [
      '#__mac{position:fixed;top:16px;right:16px;width:330px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__mac *{box-sizing:border-box}',
      '.__mac_card{display:flex;flex-direction:column;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb}',
      '.__mac_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__mac_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}',
      '.__mac_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__mac_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__mac_close:hover{color:#eceefb}',
      '#__mac_body{height:340px;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;padding:0}',
      '#__mac_toolbar{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0}',
      '.__mac_muted{color:#82849a;font-style:italic;flex:1}',
      '#__mac_list{flex:1;overflow-y:auto}',
      '.__mac_listwrap{margin:6px 8px;border:1px solid #23252f;border-radius:8px;overflow:hidden}',
      '.__mac_empty{padding:24px;text-align:center;font-size:11px;color:#5c5e6b}',
      '.__mac_row{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:11px}',
      '.__mac_row:last-child{border-bottom:none}',
      '.__mac_row:hover{background:rgba(255,255,255,0.04)}',
      '.__mac_key{display:inline-flex;align-items:center;justify-content:center;background:#1c1e2a;border:1px solid #23252f;border-radius:6px;padding:2px 6px;font-size:10px;font-weight:700;color:#A6B0FF;min-width:30px;flex-shrink:0;font-family:monospace}',
      '.__mac_chip{font-size:9px;font-weight:700;padding:1px 5px;border-radius:4px;flex-shrink:0;font-family:monospace;letter-spacing:.2px}',
      '.__mac_chip.chat{background:rgba(46,204,113,0.12);color:#2ecc71;border:1px solid rgba(46,204,113,0.25)}',
      '.__mac_chip.pkt{background:rgba(91,156,246,0.12);color:#5b9cf6;border:1px solid rgba(91,156,246,0.25)}',
      '.__mac_lbl{flex:1;color:#82849a;font-size:10px;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.__mac_iconbtn{background:none;border:none;color:#5c5e6b;cursor:pointer;font-size:11px;padding:2px 5px;border-radius:4px}',
      '.__mac_iconbtn:hover{color:#eceefb;background:rgba(255,255,255,0.06)}',
      '.__mac_iconbtn.danger:hover{color:#e74c3c;background:rgba(231,76,60,0.12)}',
      '#__mac_keycap{cursor:pointer;width:100%;padding:6px 8px;border:1px solid #23252f;border-radius:8px;background:#0A0B10;font:11px/1.5 monospace;font-weight:700;color:#eceefb;box-sizing:border-box;text-align:left}',
      '#__mac_keycap.listening{background:rgba(241,196,15,0.1);border-color:#f1c40f;color:#f1c40f}',
      '#__mac_form{border-top:1px solid rgba(255,255,255,0.06);padding:10px;flex-shrink:0;overflow-y:auto}',
      '.__mac_flbl{display:block;font-size:9px;font-weight:700;color:#5c5e6b;margin:8px 0 4px;text-transform:uppercase;letter-spacing:.6px}',
      '.__mac_flbl:first-child{margin-top:0}',
      '.__mac_hint{font-weight:400;text-transform:none;color:#5c5e6b}',
      '.__mac_input{width:100%;background:#0A0B10;border:1px solid #23252f;border-radius:8px;color:#eceefb;padding:6px 8px;font-size:11px}',
      '.__mac_input:focus{outline:none;border-color:#6C7CFF}',
      '.__mac_tabs{display:flex;gap:6px}',
      '.__mac_tab{flex:1;background:#1c1e2a;color:#82849a;border:1px solid #23252f;border-radius:8px;font-size:11px;font-weight:600;padding:6px;cursor:pointer;text-align:center}',
      '.__mac_tab.active{background:rgba(108,124,255,0.16);color:#A6B0FF;border-color:#6C7CFF}',
      '.__mac_actions{display:flex;gap:8px;margin-top:10px}',
      '.__mac_btn{border:none;border-radius:8px;font-size:11px;font-weight:600;padding:6px 10px;cursor:pointer}',
      '.__mac_btn_sm{font-size:9px;padding:2px 8px}',
      '.__mac_btn_primary,.__mac_btn_success{background:#A6B0FF;color:#0A0B10}',
      '.__mac_btn_primary:hover,.__mac_btn_success:hover{filter:brightness(1.08)}',
      '.__mac_btn_secondary{background:#1c1e2a;color:#eceefb;border:1px solid #23252f}',
      '.__mac_btn_secondary:hover{background:rgba(255,255,255,0.06)}',
      '.__mac_grow{flex:1}',
    ].join('');
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = '__mac';
    document.body.appendChild(panel);
    panel.style.display = 'none';

    let _drag = false, _ox = 0, _oy = 0, _panelLeft = null, _panelTop = null;
    try {
      const _savedPos = JSON.parse(localStorage.getItem('__ghk_mac_pos') || 'null');
      if (_savedPos && typeof _savedPos.left === 'number') { _panelLeft = _savedPos.left; _panelTop = _savedPos.top; }
    } catch (_) {}

    document.addEventListener('mousemove', e => {
      if (!_drag) return;
      _panelLeft = e.clientX - _ox; _panelTop = e.clientY - _oy;
      panel.style.right = 'auto'; panel.style.left = _panelLeft + 'px'; panel.style.top = _panelTop + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (!_drag) return;
      _drag = false;
      try { localStorage.setItem('__ghk_mac_pos', JSON.stringify({ left: _panelLeft, top: _panelTop })); } catch (_) {}
    });

    function _applyPos() {
      if (_panelLeft !== null) { panel.style.right='auto'; panel.style.left=_panelLeft+'px'; panel.style.top=_panelTop+'px'; }
    }

    // "Open Macro Editor" — the full node-graph Gheloo Macro Editor is a
    // separate, much bigger tool that deliberately does NOT live in this
    // extension's own source (that's the whole point of hosting it on
    // Supabase: it can ship updates without a gheloo-logger release at
    // all). This just fetches whatever's currently the latest published
    // version and pins it into the normal Extensions list (window.
    // __ext_upsertAndRun, see extensions/userext/manager.js) — same
    // find-or-create-by-name + always-refresh-the-code behavior as
    // re-pasting it into that panel by hand used to require, minus the
    // copy-paste. window.__gheloo_auto_open (read by the editor's own
    // ensureRoomToolsIcon) is what makes it actually open right away
    // instead of just quietly registering in the background.
    const MACRO_EDITOR_SUPABASE_URL = 'https://argxsgmqhrqoicfaqngt.supabase.co/rest/v1';
    const MACRO_EDITOR_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFyZ3hzZ21xaHJxb2ljZmFxbmd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyNjI1NDgsImV4cCI6MjEwMDgzODU0OH0.eeyd52VAqu7xCTX2tsE1krzAbBvhFe2E2lxRdyfxcII';
    async function _openBigMacro() {
      const btn = panel.querySelector('#__mac_openbig');
      if (!btn || btn.disabled) return;
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Laden...';
      try {
        const res = await fetch(MACRO_EDITOR_SUPABASE_URL + '/extension_release?select=version,code&order=version.desc&limit=1', {
          headers: { apikey: MACRO_EDITOR_SUPABASE_ANON_KEY, Authorization: 'Bearer ' + MACRO_EDITOR_SUPABASE_ANON_KEY },
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const rows = await res.json();
        const code = rows[0] && rows[0].code;
        if (!code) throw new Error('geen code gevonden in extension_release');
        window.__gheloo_loaded_version = rows[0].version;
        window.__gheloo_auto_open = true;
        if (!window.__ext_upsertAndRun) throw new Error('Extensions manager niet geladen');
        window.__ext_upsertAndRun('Gheloo Macro Editor', code);
        panel.style.display = 'none'; // uit de weg — de editor toont zichzelf
      } catch (err) {
        console.error('[Macros] Open Macro Editor mislukt:', err);
        alert('Ophalen mislukt: ' + (err && err.message || err));
      } finally {
        btn.disabled = false;
        btn.textContent = original;
      }
    }

    function _render() {
      const existing = (_editing != null && _editing !== -1) ? (_macros.find(x => x.id === _editing) || {}) : {};
      const isPacket = (existing.type||'text') === 'packet';

      panel.innerHTML =
        '<div class="__mac_card">' +
          '<div class="__mac_hdr" id="__mac_hdr">' +
            '<span class="__mac_eyebrow">Gheloo</span>' +
            '<span class="__mac_title">Macros</span>' +
            '<span class="__mac_close" id="__mac_hclose">&times;</span>' +
          '</div>' +
          '<div id="__mac_body">' +
            '<div id="__mac_toolbar">' +
              '<small class="__mac_muted">' + _macros.length + ' macro' + (_macros.length===1?'':'s') + '</small>' +
              '<button id="__mac_openbig" class="__mac_btn __mac_btn_sm __mac_btn_secondary" title="Haalt de nieuwste versie op en pint hem als Extension">Open Macro Editor</button>' +
              '<button id="__mac_addbtn" class="__mac_btn __mac_btn_sm __mac_btn_primary">+ Add</button>' +
            '</div>' +
            '<div id="__mac_list">' + _renderList() + '</div>' +
            (_editing !== null ? _renderForm(existing, isPacket) : '') +
          '</div>' +
        '</div>';

      _applyPos();

      panel.querySelector('#__mac_hdr').addEventListener('mousedown', e => {
        if (['BUTTON','INPUT','SELECT'].includes(e.target.tagName) || e.target.id === '__mac_hclose') return;
        _drag = true;
        _ox = e.clientX - panel.getBoundingClientRect().left;
        _oy = e.clientY - panel.getBoundingClientRect().top;
      });

      panel.querySelector('#__mac_hclose').addEventListener('click', () => { panel.style.display = 'none'; });
      panel.querySelector('#__mac_addbtn').addEventListener('click', () => { _editing = -1; _render(); });
      panel.querySelector('#__mac_openbig').addEventListener('click', _openBigMacro);

      panel.querySelectorAll('.__mac_edit').forEach(btn => {
        btn.addEventListener('click', () => { _editing = parseInt(btn.dataset.id); _render(); });
      });
      panel.querySelectorAll('.__mac_del').forEach(btn => {
        btn.addEventListener('click', () => {
          const delId = parseInt(btn.dataset.id);
          _macros = _macros.filter(m => m.id !== delId);
          _save();
          if (_editing === delId) _editing = null;
          _render();
        });
      });

      if (_editing !== null) _bindForm(existing);
    }

    function _renderList() {
      if (!_macros.length) return '<div class="__mac_empty">No macros yet.</div>';
      return '<div class="__mac_listwrap">' +
        _macros.map(m => {
          const isP = m.type === 'packet';
          const chip = isP ? '<span class="__mac_chip pkt">PKT</span>' : '<span class="__mac_chip chat">CHAT</span>';
          const lbl  = isP ? _esc((m.rawPacket||'').substring(0, 30)) : _esc((m.value||'').substring(0, 30));
          return '<div class="__mac_row">' +
            '<span class="__mac_key">' + _esc(m.key||'?') + '</span>' +
            chip +
            '<span class="__mac_lbl">' + lbl + '</span>' +
            '<button class="__mac_iconbtn __mac_edit" data-id="' + m.id + '" title="Edit">✏</button>' +
            '<button class="__mac_iconbtn danger __mac_del" data-id="' + m.id + '" title="Delete">✕</button>' +
          '</div>';
        }).join('') +
      '</div>';
    }

    function _renderForm(m, isPacket) {
      return '<div id="__mac_form">' +
        '<small class="__mac_flbl">Hotkey <span class="__mac_hint">(click then press key)</span></small>' +
        '<button id="__mac_keycap" type="button">' + _esc(m.key || 'Click to set...') + '</button>' +
        '<small class="__mac_flbl">Type</small>' +
        '<div class="__mac_tabs">' +
          '<button type="button" id="__mac_tab_chat" class="__mac_tab' + (!isPacket?' active':'') + '">Chat</button>' +
          '<button type="button" id="__mac_tab_pkt"  class="__mac_tab' + (isPacket?' active':'') + '">Packet</button>' +
        '</div>' +
        '<div id="__mac_tf"' + (isPacket?' style="display:none"':'') + '>' +
          '<small class="__mac_flbl">Message</small>' +
          '<input id="__mac_value" class="__mac_input" style="font-family:monospace" value="' + _esc(m.value||'') + '" placeholder="Hello!">' +
        '</div>' +
        '<div id="__mac_pf"' + (!isPacket?' style="display:none"':'') + '>' +
          '<small class="__mac_flbl">Packet</small>' +
          '<input id="__mac_rawpkt" class="__mac_input" style="font-family:monospace" value="' + _esc(m.rawPacket||'') + '" placeholder="{out:Chat}{s:&quot;hello&quot;}{i:0}">' +
        '</div>' +
        '<div class="__mac_actions">' +
          '<button id="__mac_savebtn"   class="__mac_btn __mac_btn_success __mac_grow">Save</button>' +
          '<button id="__mac_cancelbtn" class="__mac_btn __mac_btn_secondary __mac_grow">Cancel</button>' +
        '</div>' +
      '</div>';
    }

    function _bindForm(existing) {
      let capturedKey = existing.key || null;
      let _activeIsPkt = (existing.type || 'text') === 'packet';

      const keycap  = panel.querySelector('#__mac_keycap');
      const tf      = panel.querySelector('#__mac_tf');
      const pf      = panel.querySelector('#__mac_pf');
      const tabChat = panel.querySelector('#__mac_tab_chat');
      const tabPkt  = panel.querySelector('#__mac_tab_pkt');

      keycap.addEventListener('click', () => {
        keycap.classList.add('listening');
        keycap.textContent = 'Press a key...';
        function onKey(e) {
          e.preventDefault(); e.stopPropagation();
          const parts = [];
          if (e.ctrlKey) parts.push('Ctrl');
          if (e.altKey)  parts.push('Alt');
          if (e.shiftKey && !['Control','Alt','Shift'].includes(e.key)) parts.push('Shift');
          if (!['Control','Alt','Shift'].includes(e.key)) parts.push(e.key);
          capturedKey = parts.join('+');
          keycap.textContent = capturedKey;
          keycap.classList.remove('listening');
          document.removeEventListener('keydown', onKey, true);
        }
        document.addEventListener('keydown', onKey, true);
      });

      function _setTab(isPkt) {
        _activeIsPkt = isPkt;
        tf.style.display = isPkt ? 'none' : '';
        pf.style.display = isPkt ? '' : 'none';
        tabChat.classList.toggle('active', !isPkt);
        tabPkt.classList.toggle('active', isPkt);
      }
      tabChat.addEventListener('click', () => _setTab(false));
      tabPkt.addEventListener('click',  () => _setTab(true));

      panel.querySelector('#__mac_cancelbtn').addEventListener('click', () => { _editing = null; _render(); });

      panel.querySelector('#__mac_savebtn').addEventListener('click', () => {
        if (!capturedKey) { alert('Set a hotkey first.'); return; }
        const isPkt = _activeIsPkt;
        const m = { id: _editing === -1 ? _nextId() : existing.id, key: capturedKey, type: isPkt ? 'packet' : 'text' };

        if (!isPkt) {
          m.value = panel.querySelector('#__mac_value').value;
          if (!m.value.trim()) { alert('Enter a message.'); return; }
        } else {
          m.rawPacket = panel.querySelector('#__mac_rawpkt').value.trim();
          if (!m.rawPacket) { alert('Paste a packet string.'); return; }
          if (!/^\{(?:out|in):/i.test(m.rawPacket)) { alert('Packet must start with {out:Name} or {in:Name}.'); return; }
        }

        if (_editing === -1) {
          _macros.push(m);
        } else {
          const idx = _macros.findIndex(x => x.id === existing.id);
          if (idx >= 0) _macros[idx] = m; else _macros.push(m);
        }
        _save();
        _editing = null;
        _render();
      });
    }

    // Capture phase — fires before game handlers
    document.addEventListener('keydown', function(e) {
      const tag = document.activeElement && document.activeElement.tagName;
      if (['INPUT','TEXTAREA','SELECT'].includes(tag)) return;
      const parts = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey)  parts.push('Alt');
      if (e.shiftKey && !['Control','Alt','Shift'].includes(e.key)) parts.push('Shift');
      if (!['Control','Alt','Shift'].includes(e.key)) parts.push(e.key);
      const keyStr = parts.join('+');
      const macro = _macros.find(m => m.key === keyStr);
      if (!macro) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      _executeMacro(macro);
      setTimeout(() => {
        const el = document.activeElement;
        if (el && ['INPUT','TEXTAREA'].includes(el.tagName)) { el.value = ''; el.blur(); }
      }, 0);
    }, true);

    function _resolvePktId(dir, name) {
      let id = parseInt(name);
      if (isNaN(id) && window.PKT) {
        const tbl = window.PKT[dir];
        if (tbl) {
          const entry = Object.entries(tbl).find(([, v]) =>
            v === name || (window.shortName && window.shortName(v, dir) === name)
          );
          if (entry) id = parseInt(entry[0]);
        }
      }
      return id;
    }

    let _lastBubbleStyle = 0;
    window.PacketStore.subscribe(function(p) {
      if (p.direction !== 'OUT' || p.name !== 'Chat') return;
      try {
        const r = window.makeReader(p.raw);
        if (!r) return;
        r.str();
        _lastBubbleStyle = r.int();
      } catch(_) {}
    });

    function _executeMacro(m) {
      if (m.type === 'text') {
        const chatEl = document.querySelector('.nitro-room-chatinput-component input, .nitro-room-chatinput-component textarea');
        if (chatEl) {
          const proto = chatEl.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
          setter.call(chatEl, m.value);
          chatEl.dispatchEvent(new Event('input', { bubbles: true }));
          chatEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
          return;
        }
        if (!window.sendPacket) { console.warn('[Macros] sendPacket not ready'); return; }
        const id = _resolvePktId('OUT', 'Chat');
        if (isNaN(id)) { console.warn('[Macros] Chat packet ID not found'); return; }
        const escaped = m.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        window.sendPacket('OUT', id, '{s:"' + escaped + '"}{i:' + _lastBubbleStyle + '}');
        return;
      } else {
        const parsed = (m.rawPacket||'').match(/^\{(out|in):([^}]+)\}(.*)/si);
        if (!parsed) { console.warn('[Macros] Bad packet string:', m.rawPacket); return; }
        const dir = parsed[1].toUpperCase(), name = parsed[2].trim(), payload = parsed[3].trim();
        const id = _resolvePktId(dir, name);
        if (isNaN(id)) { console.warn('[Macros] Unknown packet:', name); return; }
        window.sendPacket(dir, id, payload);
      }
    }

    window.__mac_setPos = function(l, t) { _panelLeft = l; _panelTop = t; };

    _render();
    window.__mac_panel = panel;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(buildMacrosUI); }); else window.__ghk_ready(buildMacrosUI);
})();
