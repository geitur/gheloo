(function() {
  const STORAGE_KEY = '__ghk_extensions';

  let _exts    = [];
  let _editing = null;

  function _load() { try { _exts = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch(_) { _exts = []; } }
  function _save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(_exts)); if (window.__ghl_syncExtRows) window.__ghl_syncExtRows(); }
  function _nextId() { return _exts.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1; }
  function _esc(s)   { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  window.__ext_cleanups = {};
  window.__ext_onStop   = null;

  function _runSingleExtension(ext) {
    window.__ext_onStop = function(fn) { window.__ext_cleanups[ext.id] = fn; };
    try { (new Function(ext.code))(); } catch(err) { console.error('[Extensions] "' + ext.name + '":', err); }
    window.__ext_onStop = null;
  }

  function _stopExtension(ext) {
    const fn = window.__ext_cleanups[ext.id];
    if (fn) { try { fn(); } catch(e) {} delete window.__ext_cleanups[ext.id]; }
  }

  function _runExtensions() {
    _load();
    _exts.filter(e => e.enabled !== false).forEach(_runSingleExtension);
  }

  function buildExtPanel() {
    const style = document.createElement('style');
    style.textContent = [
      '#__ext{position:fixed;top:16px;right:16px;width:460px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__ext *{box-sizing:border-box}',
      '.__ext_card{display:flex;flex-direction:column;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb}',
      '.__ext_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__ext_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}',
      '.__ext_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__ext_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__ext_close:hover{color:#eceefb}',
      '#__ext_body{height:480px;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;padding:0}',
      '#__ext_toolbar{display:flex;align-items:center;gap:6px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0}',
      '.__ext_muted{color:#82849a;font-style:italic;flex:1;font-size:11px}',
      '#__ext_list{flex:1;overflow-y:auto}',
      '.__ext_listwrap{margin:8px 10px;border:1px solid #23252f;border-radius:8px;overflow:hidden}',
      '.__ext_empty{padding:28px;text-align:center;font-size:11px;color:#5c5e6b;line-height:1.6}',
      '.__ext_row{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:11px}',
      '.__ext_row:last-child{border-bottom:none}',
      '.__ext_row:hover{background:rgba(255,255,255,0.04)}',
      '.__ext_lbl{flex:1;color:#eceefb;font-size:11px;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.__ext_pillbtn{border:none;border-radius:6px;cursor:pointer;font-size:10px;font-weight:700;padding:4px 9px;flex-shrink:0}',
      '.__ext_pillbtn.on{background:rgba(46,204,113,0.14);color:#2ecc71;border:1px solid rgba(46,204,113,0.3)}',
      '.__ext_pillbtn.on:hover{background:rgba(46,204,113,0.22)}',
      '.__ext_pillbtn.off{background:rgba(92,94,107,0.14);color:#82849a;border:1px solid rgba(92,94,107,0.3)}',
      '.__ext_pillbtn.off:hover{background:rgba(92,94,107,0.22)}',
      '.__ext_pillbtn.neutral{background:rgba(108,124,255,0.12);color:#A6B0FF;border:1px solid rgba(108,124,255,0.28)}',
      '.__ext_pillbtn.neutral:hover{background:rgba(108,124,255,0.2)}',
      '.__ext_pillbtn.danger{background:rgba(231,76,60,0.12);color:#e74c3c;border:1px solid rgba(231,76,60,0.28)}',
      '.__ext_pillbtn.danger:hover{background:rgba(231,76,60,0.2)}',
      '#__ext_form{flex:1;padding:12px;overflow-y:auto;display:flex;flex-direction:column;gap:0}',
      '#__ext_form .lbl{display:block;font-size:9px;font-weight:700;color:#5c5e6b;margin:10px 0 4px;text-transform:uppercase;letter-spacing:.6px}',
      '#__ext_form .lbl:first-child{margin-top:0}',
      '.__ext_hint{font-weight:400;text-transform:none;color:#5c5e6b}',
      '#__ext_name{width:100%;background:#0A0B10;border:1px solid #23252f;border-radius:8px;color:#eceefb;padding:7px 9px;font-size:12px;font-family:monospace}',
      '#__ext_name:focus{outline:none;border-color:#6C7CFF}',
      '#__ext_code{width:100%;font-family:monospace;font-size:11px;padding:8px 9px;border:1px solid #23252f;border-radius:8px;background:#0A0B10;color:#eceefb;outline:none;resize:none;flex:1;min-height:220px;line-height:1.6;box-sizing:border-box}',
      '#__ext_code:focus{border-color:#6C7CFF}',
      '.__ext_actions{display:flex;gap:8px;margin-top:10px;flex-shrink:0}',
      '.__ext_btn{border:none;border-radius:8px;font-size:11px;font-weight:600;padding:7px 10px;cursor:pointer;flex:1}',
      '.__ext_btn_sm{flex:none;font-size:9px;padding:2px 8px;border-radius:6px}',
      '.__ext_btn_primary,.__ext_btn_success{background:#A6B0FF;color:#0A0B10}',
      '.__ext_btn_primary:hover,.__ext_btn_success:hover{filter:brightness(1.08)}',
      '.__ext_btn_secondary{background:#1c1e2a;color:#eceefb;border:1px solid #23252f}',
      '.__ext_btn_secondary:hover{background:rgba(255,255,255,0.06)}',
      '.__ext_stophint{margin-top:10px;padding:8px 10px;background:#1c1e2a;border:1px solid #23252f;border-radius:8px;font-size:10px;color:#82849a;line-height:1.6;flex-shrink:0}',
      '.__ext_stophint code{color:#A6B0FF;font-family:monospace}',
    ].join('');
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = '__ext';
    document.body.appendChild(panel);
    panel.style.display = 'none';

    let _drag = false, _ox = 0, _oy = 0, _panelLeft = null, _panelTop = null;
    try {
      const _savedPos = JSON.parse(localStorage.getItem('__ghk_ext_pos') || 'null');
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
      try { localStorage.setItem('__ghk_ext_pos', JSON.stringify({ left: _panelLeft, top: _panelTop })); } catch (_) {}
    });

    function _applyPos() {
      if (_panelLeft !== null) { panel.style.right='auto'; panel.style.left=_panelLeft+'px'; panel.style.top=_panelTop+'px'; }
    }

    function _render() {
      const existing = (_editing != null && _editing !== -1) ? (_exts.find(x => x.id === _editing) || {}) : {};
      const total = _exts.length;

      panel.innerHTML =
        '<div class="__ext_card">' +
          '<div class="__ext_hdr" id="__ext_hdr">' +
            '<span class="__ext_eyebrow">Gheloo</span>' +
            '<span class="__ext_title">Extensions</span>' +
            '<span class="__ext_close" id="__ext_hclose">&times;</span>' +
          '</div>' +
          '<div id="__ext_body">' +
            (_editing === null
              ? '<div id="__ext_toolbar">' +
                  '<small class="__ext_muted">' + total + ' extension' + (total === 1 ? '' : 's') + '</small>' +
                  '<button id="__ext_addbtn" class="__ext_btn __ext_btn_primary" style="flex:none;padding:7px 14px">+ Add Extension</button>' +
                '</div>' +
                '<div id="__ext_list">' + _renderList() + '</div>'
              : '<div id="__ext_form">' + _renderForm(existing) + '</div>'
            ) +
          '</div>' +
        '</div>';

      _applyPos();

      panel.querySelector('#__ext_hdr').addEventListener('mousedown', e => {
        if (['BUTTON','INPUT','TEXTAREA','SELECT'].includes(e.target.tagName) || e.target.id === '__ext_hclose') return;
        _drag = true;
        _ox = e.clientX - panel.getBoundingClientRect().left;
        _oy = e.clientY - panel.getBoundingClientRect().top;
      });

      panel.querySelector('#__ext_hclose').addEventListener('click', () => { panel.style.display = 'none'; });

      if (_editing === null) {
        panel.querySelector('#__ext_addbtn').addEventListener('click', () => { _editing = -1; _render(); });

        panel.querySelectorAll('.__ext_toggle').forEach(btn => {
          btn.addEventListener('click', () => {
            const ext = _exts.find(e => e.id === parseInt(btn.dataset.id));
            if (!ext) return;
            if (ext.enabled !== false) { _stopExtension(ext); ext.enabled = false; }
            else { _runSingleExtension(ext); ext.enabled = true; }
            _save(); _render();
          });
        });

        panel.querySelectorAll('.__ext_edit').forEach(btn => {
          btn.addEventListener('click', () => { _editing = parseInt(btn.dataset.id); _render(); });
        });
        panel.querySelectorAll('.__ext_del').forEach(btn => {
          btn.addEventListener('click', () => {
            const ext = _exts.find(e => e.id === parseInt(btn.dataset.id));
            if (!ext || !confirm('Delete "' + ext.name + '"?')) return;
            _stopExtension(ext);
            _exts = _exts.filter(e => e.id !== ext.id);
            _save(); _render();
          });
        });
      } else {
        panel.querySelector('#__ext_cancelbtn').addEventListener('click', () => { _editing = null; _render(); });
        panel.querySelector('#__ext_savebtn').addEventListener('click', () => {
          const name = panel.querySelector('#__ext_name').value.trim();
          const code = panel.querySelector('#__ext_code').value;
          if (!name) { alert('Enter a name.'); return; }
          if (!code.trim()) { alert('Enter some code.'); return; }
          if (_editing === -1) {
            _exts.push({ id: _nextId(), name, code, enabled: true });
          } else {
            const idx = _exts.findIndex(x => x.id === existing.id);
            if (idx >= 0) { _exts[idx].name = name; _exts[idx].code = code; }
            else { _exts.push({ id: _nextId(), name, code, enabled: true }); }
          }
          _save(); _editing = null; _render();
        });
      }
    }

    function _renderList() {
      if (!_exts.length) {
        return '<div class="__ext_empty">No extensions yet.<br>Click + Add to create one.</div>';
      }
      return '<div class="__ext_listwrap">' +
        _exts.map(e => {
          const on = e.enabled !== false;
          return '<div class="__ext_row">' +
            '<span class="__ext_lbl" title="' + _esc(e.name) + '">' + _esc(e.name) + '</span>' +
            '<button class="__ext_pillbtn ' + (on ? 'on' : 'off') + ' __ext_toggle" data-id="' + e.id + '">' + (on ? 'On' : 'Off') + '</button>' +
            '<button class="__ext_pillbtn neutral __ext_edit" data-id="' + e.id + '">Edit</button>' +
            '<button class="__ext_pillbtn danger __ext_del" data-id="' + e.id + '">Remove</button>' +
          '</div>';
        }).join('') +
      '</div>';
    }

    function _renderForm(m) {
      return '<small class="lbl">Name</small>' +
        '<input id="__ext_name" value="' + _esc(m.name || '') + '" placeholder="My Extension">' +
        '<small class="lbl">JavaScript Code <span class="__ext_hint">(runs on page load)</span></small>' +
        '<textarea id="__ext_code" placeholder="// Use window.__ext_onStop(fn) to clean up when disabled">' + _esc(m.code || '') + '</textarea>' +
        '<div class="__ext_actions">' +
          '<button id="__ext_savebtn"   class="__ext_btn __ext_btn_success">Save</button>' +
          '<button id="__ext_cancelbtn" class="__ext_btn __ext_btn_secondary">Cancel</button>' +
        '</div>' +
        '<div class="__ext_stophint"><b>Stop hook:</b> call <code>window.__ext_onStop(fn)</code> to clean up when toggled OFF.</div>';
    }

    _render();
    window.__ext_panel = panel;

    // Opens the panel already editing a specific extension — used by the Gheloo panel's
    // dynamic per-extension rows.
    window.__ext_editExtension = function(id) {
      _editing = id;
      _render();
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      window.__ghk_ready(function() { _runExtensions(); buildExtPanel(); });
    });
  } else {
    window.__ghk_ready(function() { _runExtensions(); buildExtPanel(); });
  }
})();
