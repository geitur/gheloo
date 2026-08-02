(function() {
  if (document.getElementById('__fh_panel')) return;

  const PKT_OBJECTS_IN    = 1778;
  const PKT_OBJ_REMOVE_IN = 2703;
  const PKT_USE_FURNI_OUT = 99;

  let _hidden       = {};
  let _clickToHide  = false;
  let _activeTab    = 'visible'; // 'visible' | 'hidden'
  let _filter       = '';
  let _renderFn     = null;

  function buildRestoreGStr(item) {
    let stuffCat = 0, stuffStr = '{s:"0"}';
    if (item.stuff) {
      if (item.stuff.category !== undefined) stuffCat = item.stuff.category;
      if (item.stuff.state    !== undefined) stuffStr = '{s:"' + String(item.stuff.state).replace(/"/g, '\\"') + '"}';
    }
    return '{i:1}'
      + '{i:' + item.ownerId + '}{s:"' + (item.ownerName || '') + '"}'
      + '{i:1}'
      + '{i:' + item.id + '}{i:' + item.typeId + '}'
      + '{i:' + item.x + '}{i:' + item.y + '}{i:' + item.facing + '}'
      + '{s:"' + String(item.z) + '"}{s:"' + String(item.sizeZ || '0') + '"}'
      + '{i:' + (item.extra || 0) + '}'
      + '{i:' + stuffCat + '}' + stuffStr
      + '{i:' + (item.expires !== undefined ? item.expires : -1) + '}'
      + '{i:' + (item.usagePolicy || 0) + '}'
      + '{i:' + item.ownerId + '}';
  }

  function hideItem(item) {
    if (_hidden[item.id]) return;
    _hidden[item.id] = JSON.parse(JSON.stringify(item));
    window.sendPacket('IN', PKT_OBJ_REMOVE_IN,
      '{s:"' + item.id + '"}{i:' + item.ownerId + '}{b:200}{i:0}');
  }

  function restoreItem(snap) {
    window.sendPacket('IN', PKT_OBJECTS_IN, buildRestoreGStr(snap));
    delete _hidden[snap.id];
  }

  function groupByType(sourceItems) {
    const groups = {};
    sourceItems.forEach(function(item) {
      const tid  = item.typeId;
      const name = item.furniName || ('type:' + tid);
      if (!groups[tid]) groups[tid] = { name, items: [] };
      groups[tid].items.push(item);
    });
    return groups;
  }

  // Intercept UseFurniture OUT — block send + hide client-side
  window.onPacket('UseFurniture', function(p) {
    if (!_clickToHide || p.direction !== 'OUT') return;
    const r = window.makeReader(p.raw);
    if (!r) return;
    const itemId = r.int();
    const item   = window.Room.floorItems && window.Room.floorItems[itemId];
    if (!item) return;
    window._pendingBlockOutgoing = true;
    hideItem(item);
    if (_renderFn) _renderFn();
  });

  // Clear on room change
  window.onPacket('RoomReady', function() {
    _hidden = {};
    if (_renderFn) _renderFn();
  });

  function init() {
    const style = document.createElement('style');
    style.textContent = [
      '#__fh_panel{position:fixed;top:16px;right:16px;width:330px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__fh_panel *{box-sizing:border-box}',
      '.__fh_card_wrap{display:flex;flex-direction:column;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb}',
      '.__fh_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__fh_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}',
      '.__fh_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__fh_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__fh_close:hover{color:#eceefb}',
      '#__fh_body{height:340px;box-sizing:border-box;overflow:hidden;display:flex;flex-direction:column;padding:0}',
      '#__fh_search{width:100%;padding:6px 8px;font-size:11px;border:1px solid #23252f;border-radius:8px;background:#0A0B10;outline:none;color:#eceefb;box-sizing:border-box}',
      '#__fh_search:focus{border-color:#6C7CFF}',
      '#__fh_search::placeholder{color:#5c5e6b}',
      '#__fh_tabs{display:flex;gap:6px;padding:0 12px;flex-shrink:0}',
      '.__fh_tab{flex:1;background:#1c1e2a;color:#82849a;border:1px solid #23252f;border-radius:8px;font-size:11px;font-weight:600;padding:6px 0;cursor:pointer;text-align:center}',
      '.__fh_tab.active{background:rgba(108,124,255,0.16);color:#A6B0FF;border-color:#6C7CFF}',
      '#__fh_list{flex:1;overflow-y:auto;margin:6px 8px;border:1px solid #23252f;border-radius:8px;overflow:hidden}',
      '.__fh_row{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:11px}',
      '.__fh_row:last-child{border-bottom:none}',
      '.__fh_row:hover{background:rgba(255,255,255,0.04)}',
      '.__fh_name{flex:1;color:#eceefb;font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.__fh_cnt{font-size:9px;font-weight:700;padding:2px 7px;border-radius:10px;flex-shrink:0;font-family:monospace}',
      '.__fh_cnt.vis{background:rgba(46,204,113,0.12);color:#2ecc71;border:1px solid rgba(46,204,113,0.25)}',
      '.__fh_cnt.hid{background:rgba(231,76,60,0.12);color:#e74c3c;border:1px solid rgba(231,76,60,0.25)}',
      '.__fh_act{font-size:10px;font-weight:700;padding:3px 9px;border-radius:6px;border:none;cursor:pointer;flex-shrink:0}',
      '.__fh_act:hover{filter:brightness(1.08)}',
      '.__fh_act.hide{background:#e74c3c;color:#fff}',
      '.__fh_act.show{background:#2ecc71;color:#0A0B10}',
      '#__fh_bottom{padding:8px 12px;display:flex;flex-direction:column;gap:8px;flex-shrink:0;border-top:1px solid rgba(255,255,255,0.06)}',
      '.__fh_toggle_card{background:#1c1e2a;border:1px solid #23252f;border-radius:8px;padding:8px 10px;display:flex;align-items:center;justify-content:space-between}',
      '.__fh_label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#eceefb}',
      '#__fh_tog_wrap{position:relative;display:inline-block;width:34px;height:18px;flex-shrink:0;cursor:pointer}',
      '#__fh_tog_inp{opacity:0;width:0;height:0;position:absolute}',
      '#__fh_tog_track{position:absolute;inset:0;background:#23252f;border-radius:9px;transition:background .2s}',
      '#__fh_tog_thumb{position:absolute;top:2px;left:2px;width:14px;height:14px;background:#eceefb;border-radius:50%;transition:transform .2s;box-shadow:0 1px 3px rgba(0,0,0,0.35)}',
      '#__fh_toggleall{width:100%;font-size:11px;font-weight:600;padding:6px 0;border-radius:8px;border:none;cursor:pointer}',
      '#__fh_toggleall:hover{filter:brightness(1.08)}',
      '#__fh_empty{padding:24px 12px;font-size:11px;color:#5c5e6b;text-align:center;line-height:1.6}',
    ].join('');
    document.head.appendChild(style);

    const p = document.createElement('div');
    p.id = '__fh_panel';
    p.innerHTML =
      '<div class="__fh_card_wrap">' +
        '<div class="__fh_hdr" id="__fh_hdr">' +
          '<span class="__fh_eyebrow">Gheloo</span>' +
          '<span class="__fh_title">Furni Hider</span>' +
          '<span class="__fh_close" id="__fh_close">&times;</span>' +
        '</div>' +
        '<div id="__fh_body">' +

          '<div style="padding:8px 12px 4px;flex-shrink:0">' +
            '<input id="__fh_search" type="text" placeholder="Search furni..." />' +
          '</div>' +

          '<div id="__fh_tabs">' +
            '<div class="__fh_tab active" data-tab="visible">Visible (<span id="__fh_cnt_vis">0</span>)</div>' +
            '<div class="__fh_tab"        data-tab="hidden" >Hidden (<span id="__fh_cnt_hid">0</span>)</div>' +
          '</div>' +

          '<div id="__fh_list"></div>' +

          '<div id="__fh_bottom">' +
            '<div class="__fh_toggle_card">' +
              '<div>' +
                '<div class="__fh_label">CLICK TO HIDE</div>' +
              '</div>' +
              '<label id="__fh_tog_wrap">' +
                '<input type="checkbox" id="__fh_tog_inp">' +
                '<span id="__fh_tog_track"></span>' +
                '<span id="__fh_tog_thumb"></span>' +
              '</label>' +
            '</div>' +
            '<button id="__fh_toggleall" style="background:#e74c3c;color:#fff">Hide All</button>' +
          '</div>' +

        '</div>' +
      '</div>';
    document.body.appendChild(p);
    p.style.display = 'none';

    // Drag
    window.__ghk_makeDraggable(p, p.querySelector('#__fh_hdr'), '__ghk_fh_pos', e => e.target.id === '__fh_close');

    p.querySelector('#__fh_close').addEventListener('click', () => p.style.display = 'none');

    const listEl      = p.querySelector('#__fh_list');
    const searchEl    = p.querySelector('#__fh_search');
    const cntVis      = p.querySelector('#__fh_cnt_vis');
    const cntHid      = p.querySelector('#__fh_cnt_hid');
    const togInp      = p.querySelector('#__fh_tog_inp');
    const togTrack    = p.querySelector('#__fh_tog_track');
    const togThumb    = p.querySelector('#__fh_tog_thumb');

    function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    function setToggleUI(on) {
      togTrack.style.background = on ? '#6C7CFF' : '#23252f';
      togThumb.style.transform  = on ? 'translateX(16px)' : 'translateX(0)';
    }

    togInp.addEventListener('change', function() {
      _clickToHide = this.checked;
      setToggleUI(_clickToHide);
    });

    // Tabs
    p.querySelectorAll('.__fh_tab').forEach(tab => {
      tab.addEventListener('click', function() {
        _activeTab = this.dataset.tab;
        p.querySelectorAll('.__fh_tab').forEach(t => t.classList.toggle('active', t.dataset.tab === _activeTab));
        render();
      });
    });

    searchEl.addEventListener('input', function() {
      _filter = this.value.toLowerCase().trim();
      render();
    });

    function render() {
      const visibleItems = Object.values(window.Room.floorItems || {})
        .filter(item => !_hidden[item.id]);
      const hiddenItems  = Object.values(_hidden);

      cntVis.textContent = visibleItems.length;
      cntHid.textContent = hiddenItems.length;

      const source = _activeTab === 'visible' ? visibleItems : hiddenItems;
      const groups  = groupByType(source);
      let   entries = Object.entries(groups);

      if (_filter) entries = entries.filter(([, g]) => g.name.toLowerCase().includes(_filter));
      entries.sort(([, a], [, b]) => b.items.length - a.items.length || a.name.localeCompare(b.name));

      if (!entries.length) {
        listEl.innerHTML = '<div id="__fh_empty">' +
          (_activeTab === 'visible'
            ? (Object.keys(window.Room.floorItems||{}).length === 0
                ? 'Geen meubels gevonden in deze kamer.'
                : 'Geen resultaten voor "' + esc(_filter) + '".')
            : (hiddenItems.length === 0
                ? 'Geen verborgen meubels.'
                : 'Geen resultaten voor "' + esc(_filter) + '".')) +
          '</div>';
        return;
      }

      const anyHidden = Object.keys(_hidden).length > 0;
      toggleAllBtn.textContent   = anyHidden ? 'Restore All' : 'Hide All';
      toggleAllBtn.style.background = anyHidden ? '#2ecc71' : '#e74c3c';
      toggleAllBtn.style.color      = anyHidden ? '#0A0B10' : '#fff';

      const isVisible = _activeTab === 'visible';
      listEl.innerHTML = entries.map(([typeId, g]) => {
        const cnt = g.items.length;
        const cntCls  = isVisible ? 'vis' : 'hid';
        const actCls  = isVisible ? 'hide' : 'show';
        const actLbl  = isVisible ? 'Hide' : 'Restore';
        return '<div class="__fh_row" data-tid="' + typeId + '">' +
          '<span class="__fh_name" title="' + esc(g.name) + '">' + esc(g.name) + '</span>' +
          '<span class="__fh_cnt ' + cntCls + '">×' + cnt + '</span>' +
          '<button class="__fh_act ' + actCls + '" data-tid="' + typeId + '">' + actLbl + '</button>' +
          '</div>';
      }).join('');

      listEl.querySelectorAll('.__fh_act').forEach(btn => {
        btn.addEventListener('click', function() {
          const tid = parseInt(this.dataset.tid);
          if (isVisible) {
            const g = groupByType(Object.values(window.Room.floorItems||{}).filter(i => !_hidden[i.id]))[tid];
            if (g) g.items.forEach(hideItem);
          } else {
            const g = groupByType(Object.values(_hidden))[tid];
            if (g) g.items.forEach(restoreItem);
          }
          render();
        });
      });
    }

    _renderFn = render;
    window.__fh_render = render;

    const toggleAllBtn = p.querySelector('#__fh_toggleall');
    toggleAllBtn.addEventListener('click', () => {
      if (Object.keys(_hidden).length > 0) {
        Object.values(_hidden).forEach(restoreItem);
      } else {
        Object.values(window.Room.floorItems || {}).forEach(item => {
          if (!_hidden[item.id]) hideItem(item);
        });
      }
      render();
    });

  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.__ghk_ready(init));
  } else {
    window.__ghk_ready(init);
  }
})();
