(function() {
  if (document.getElementById('__userdb')) return;

  const SUPABASE_URL      = 'https://qwcfsqsrtegyvvwkzcgb.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_mi9rS5i9a-xrAWC0lG0TNA_vg903xRL';
  const HEADERS = {
    'apikey':        SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
  };

  let _all = [];
  let _selId = null;
  let _loaded = false;
  let _loading = false;

  function _esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function _log(msg) { console.log('[UserDatabase]', msg); }

  function avatarHead(figure) {
    return 'https://www.leet.city/leet-imaging/avatarimage'
      + '?figure=' + encodeURIComponent(figure || '')
      + '&direction=2&head_direction=3&size=m&gesture=sml&headonly=1&action=wav&img_format=png';
  }
  function avatarLarge(figure) {
    return 'https://www.leet.city/leet-imaging/avatarimage'
      + '?figure=' + encodeURIComponent(figure || '')
      + '&direction=3&head_direction=3&size=l&gesture=std&img_format=png';
  }
  function avatarMini(figure) {
    return 'https://www.leet.city/leet-imaging/avatarimage'
      + '?figure=' + encodeURIComponent(figure || '')
      + '&direction=3&head_direction=3&size=l&gesture=std&img_format=png';
  }

  function ts(s) {
    if (!s) return '—';
    const d = new Date(s);
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
      + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  // ── Outgoing packet lookup (same pattern as extensions/photo-library.js's _outId) ──
  function _outId(name) {
    if (!window.PKT || !window.PKT.OUT) return null;
    for (const id in window.PKT.OUT) {
      if (window.shortName(window.PKT.OUT[id], 'OUT') === name) return parseInt(id);
    }
    return null;
  }

  // Same UpdateFigureData packet ws.js's :steal command already sends — applies a
  // figure to your own avatar directly, no chrome.tabs cross-tab messaging needed since
  // this panel already runs inside the game page.
  function _wearFigure(figure, gender, statusEl) {
    if (!figure) return;
    const fid = _outId('UpdateFigureData');
    if (fid === null) {
      _log('UpdateFigureData not found in PKT — is the game connected?');
      if (statusEl) statusEl.textContent = 'Not connected — open the game first.';
      return;
    }
    const g = (gender || 'M').toUpperCase();
    window.sendPacket('OUT', fid, '{s:"' + g + '"}{s:"' + figure.replace(/"/g, '\\"') + '"}');
    if (statusEl) {
      statusEl.textContent = 'Outfit applied.';
      setTimeout(function() { if (statusEl.textContent === 'Outfit applied.') statusEl.textContent = ''; }, 2000);
    }
  }

  // ── Data ─────────────────────────────────────────────────────────────────────────
  // Paginated so we're never capped by Supabase's server-side db-max-rows setting
  // (which silently truncates any single request regardless of the requested limit).
  const PAGE_SIZE = 1000;

  async function _loadUsers() {
    if (_loading) return;
    _loading = true;
    const countEl = panel && panel.querySelector('#__udb_count');
    if (countEl) countEl.textContent = 'Loading…';
    try {
      let all = [];
      let offset = 0;
      for (;;) {
        const res = await fetch(
          SUPABASE_URL + '/rest/v1/users?select=*&type=eq.1&order=last_seen.desc&limit=' + PAGE_SIZE + '&offset=' + offset,
          { headers: HEADERS }
        );
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const page = await res.json();
        all = all.concat(page);
        if (countEl) countEl.textContent = 'Loading… (' + all.length + ')';
        if (page.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
      _all = all;
      _loaded = true;
      _applyFilters();
      _renderNameChanges();
    } catch (e) {
      if (countEl) countEl.textContent = 'Error: ' + e.message;
      _log('load failed: ' + e.message);
    } finally {
      _loading = false;
    }
  }

  function _applyFilters() {
    if (!panel) return;
    const q = (panel.querySelector('#__udb_search').value || '').toLowerCase().trim();
    const list = _all.filter(function(u) {
      if (!q) return true;
      const hay = ((u.name || '') + ' ' + (u.motto || '') + ' ' + u.id + ' ' + (u.favorite_group || '')).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
    _renderList(list);
  }

  function _renderList(users) {
    const countEl = panel.querySelector('#__udb_count');
    const listEl = panel.querySelector('#__udb_list');
    countEl.textContent = users.length + ' user' + (users.length !== 1 ? 's' : '') + (_all.length !== users.length ? ' of ' + _all.length : '');

    if (!users.length) {
      listEl.innerHTML = '<div class="__udb_empty_sm">' + (_all.length ? 'No matches.' : 'No users logged yet.') + '</div>';
      return;
    }

    listEl.innerHTML = users.map(function(u) {
      const hasAv = !!u.figure;
      const selCls = _selId === u.id ? ' sel' : '';
      const subText = u.motto ? _esc(u.motto) : (u.favorite_group ? _esc(u.favorite_group) : '');
      return '<div class="__udb_row' + selCls + '" data-uid="' + u.id + '">'
        + '<div class="__udb_row_avatar">'
        + (hasAv
          ? '<img src="' + _esc(avatarHead(u.figure)) + '" loading="lazy" onerror="this.style.opacity=\'.2\'">'
          : '<span class="__udb_row_no_av">👤</span>')
        + '</div>'
        + '<div class="__udb_row_info">'
        + '<div class="__udb_row_name">' + _esc(u.name) + '</div>'
        + (subText ? '<div class="__udb_row_sub">' + subText + '</div>' : '')
        + '</div>'
        + '</div>';
    }).join('');

    listEl.querySelectorAll('.__udb_row').forEach(function(row) {
      row.addEventListener('click', function() { _showUser(parseInt(row.dataset.uid, 10)); });
    });
  }

  function _renderNameChanges() {
    if (!ncPanel) return;
    const listEl = ncPanel.querySelector('#__udb_nc_list');
    const users = _all.filter(function(u) { return u.previous_names && u.previous_names.length > 0; });

    if (!users.length) {
      listEl.innerHTML = '<div class="__udb_empty_sm">No name changes logged yet.</div>';
      return;
    }

    listEl.innerHTML = users.map(function(u) {
      const hasAv = !!u.figure;
      const pills = u.previous_names.slice().reverse().map(function(n) {
        return '<span class="__udb_dc_tag">' + _esc(n) + '</span>';
      }).join('');
      return '<div class="__udb_ncrow">'
        + '<div class="__udb_row_avatar">'
        + (hasAv
          ? '<img src="' + _esc(avatarHead(u.figure)) + '" loading="lazy" onerror="this.style.opacity=\'.2\'">'
          : '<span class="__udb_row_no_av">👤</span>')
        + '</div>'
        + '<div class="__udb_ncrow_info">'
        + '<div class="__udb_ncrow_name">' + _esc(u.name) + '</div>'
        + '<div class="__udb_dc_tags">' + pills + '</div>'
        + '</div>'
        + '</div>';
    }).join('');
  }

  function _rowHtml(label, value) {
    return '<div class="__udb_dc_row"><span class="__udb_dc_row_label">' + label + '</span><span class="__udb_dc_row_value">' + value + '</span></div>';
  }

  function _showUser(id) {
    const u = _all.find(function(x) { return x.id === id; });
    if (!u) return;
    _selId = id;

    panel.querySelectorAll('.__udb_row').forEach(function(r) {
      r.classList.toggle('sel', parseInt(r.dataset.uid, 10) === id);
    });

    panel.querySelector('#__udb_empty').style.display = 'none';
    const detail = panel.querySelector('#__udb_detail');
    detail.style.display = 'block';

    const hasAv = !!u.figure;

    let badges = '';
    if (u.gender) badges += '<span class="__udb_dc_badge">' + (u.gender.toUpperCase() === 'M' ? '♂ Male' : '♀ Female') + '</span>';
    if (u.achievement_score) badges += '<span class="__udb_dc_badge">★ ' + u.achievement_score + '</span>';

    let body = '<div class="__udb_dc_section"><div class="__udb_dc_section_title">Info</div><div class="__udb_dc_rows">';
    body += _rowHtml('ID', '#' + u.id);
    if (u.gender) body += _rowHtml('Gender', u.gender.toUpperCase() === 'M' ? 'Male' : 'Female');
    if (u.favorite_group) body += _rowHtml('Group', _esc(u.favorite_group));
    if (u.last_room_id) body += _rowHtml('Last room', '#' + u.last_room_id);
    body += _rowHtml('Last seen', ts(u.last_seen));
    body += '</div></div>';

    const prevNames = u.previous_names || [];
    if (prevNames.length) {
      body += '<div class="__udb_dc_section"><div class="__udb_dc_section_title">Previous names</div><div class="__udb_dc_tags">';
      prevNames.slice().reverse().forEach(function(n) { body += '<span class="__udb_dc_tag">' + _esc(n) + '</span>'; });
      body += '</div></div>';
    }

    const prevFigs = u.previous_figures || [];
    if (prevFigs.length && hasAv) {
      body += '<div class="__udb_dc_section"><div class="__udb_dc_section_title">Previous outfits</div><div class="__udb_dc_outfits">';
      prevFigs.slice().reverse().forEach(function(fig) {
        body += '<img src="' + _esc(avatarMini(fig)) + '" data-fig="' + _esc(fig) + '" title="Click to wear this outfit" class="__udb_outfit_clickable" loading="lazy" onerror="this.style.opacity=\'.1\'">';
      });
      body += '</div></div>';
    }

    body += '<div class="__udb_dc_section"><span class="__udb_status" id="__udb_wear_status"></span></div>';

    detail.innerHTML =
      '<div class="__udb_dc_header">'
      + '<div class="__udb_dc_avatar' + (hasAv ? ' __udb_outfit_clickable' : '') + '" id="__udb_dc_avatar">'
      + (hasAv
        ? '<img src="' + _esc(avatarLarge(u.figure)) + '" onerror="this.style.opacity=\'.1\'" title="Click to wear this outfit">'
        : '<span class="__udb_dc_no_av">👤</span>')
      + '</div>'
      + '<div class="__udb_dc_title">'
      + '<div class="__udb_dc_name">' + _esc(u.name || '—') + '</div>'
      + (u.motto ? '<div class="__udb_dc_motto">' + _esc(u.motto) + '</div>' : '')
      + (badges ? '<div class="__udb_dc_badges">' + badges + '</div>' : '')
      + '</div></div>'
      + '<div class="__udb_dc_body">' + body + '</div>';

    const statusEl = detail.querySelector('#__udb_wear_status');

    if (hasAv) {
      detail.querySelector('#__udb_dc_avatar').addEventListener('click', function() { _wearFigure(u.figure, u.gender, statusEl); });
    }
    detail.querySelectorAll('.__udb_dc_outfits img[data-fig]').forEach(function(img) {
      img.addEventListener('click', function() { _wearFigure(img.dataset.fig, u.gender, statusEl); });
    });

  }

  // ── UI shell ─────────────────────────────────────────────────────────────────────
  let panel = null;
  let ncPanel = null;

  function injectStyle() {
    const style = document.createElement('style');
    style.textContent = [
      '#__userdb{position:fixed;top:8px;right:16px;width:640px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__userdb *{box-sizing:border-box}',
      '.__udb_card{display:flex;flex-direction:column;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb}',
      '.__udb_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__udb_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}',
      '.__udb_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__udb_iconbtn{cursor:pointer;color:#82849a;font-size:14px;line-height:1;padding:2px 6px;background:none;border:none}',
      '.__udb_iconbtn:hover{color:#eceefb}',
      '.__udb_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__udb_close:hover{color:#eceefb}',
      '#__udb_body{height:480px;display:flex;overflow:hidden}',
      '#__udb_list_panel{width:230px;flex-shrink:0;border-right:1px solid #23252f;display:flex;flex-direction:column;overflow:hidden}',
      '.__udb_search{margin:10px;background:#0A0B10;border:1px solid #23252f;border-radius:8px;color:#eceefb;padding:7px 9px;font-size:12px;outline:none}',
      '.__udb_search:focus{border-color:#6C7CFF}',
      '#__udb_count{padding:0 12px 8px;font-size:9px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#5c5e6b}',
      '#__udb_list{flex:1;overflow-y:auto;border-top:1px solid #23252f}',
      '.__udb_empty_sm{padding:20px 14px;color:#5c5e6b;font-size:11px;text-align:center}',
      '.__udb_row{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer}',
      '.__udb_row:hover{background:rgba(255,255,255,0.04)}',
      '.__udb_row.sel{background:rgba(108,124,255,0.12);border-left:2px solid #6C7CFF;padding-left:8px}',
      '.__udb_row_avatar{width:50px;height:50px;flex-shrink:0;border-radius:6px;overflow:hidden;background:#1c1e2a;display:flex;align-items:center;justify-content:center;position:relative}',
      // headonly&size=m renders a fixed 90x130 canvas where the head sits in a ~32,32-59,71px
      // box; these are the same fixed direction/head_direction/gesture params for every row,
      // so this hardcoded scale+offset crops straight to the head instead of guessing.
      '.__udb_row_avatar img{position:absolute;left:-26px;top:-33px;width:102px;height:147px;image-rendering:pixelated}',
      '.__udb_row_no_av{font-size:13px;opacity:.5}',
      '.__udb_row_info{flex:1;min-width:0}',
      '.__udb_row_name{font-size:11px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#eceefb}',
      '.__udb_row_sub{font-size:10px;color:#82849a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#__udb_detail_panel{flex:1;overflow-y:auto;padding:0}',
      '#__udb_empty{display:flex;align-items:center;justify-content:center;height:100%;color:#5c5e6b;font-size:12px;text-align:center;padding:24px}',
      '.__udb_dc_header{background:linear-gradient(135deg,#2b2f6b,#1a1c3d);padding:20px 20px 16px;display:flex;gap:16px;align-items:flex-end}',
      '.__udb_dc_avatar{width:90px;height:130px;flex-shrink:0;display:flex;align-items:flex-end;justify-content:center;background:rgba(255,255,255,.06);border-radius:8px 8px 0 0;overflow:hidden}',
      '.__udb_dc_avatar img{width:90px;height:130px;object-fit:contain;image-rendering:pixelated}',
      '.__udb_dc_no_av{font-size:34px;opacity:.3}',
      '.__udb_dc_title{flex:1;min-width:0;padding-bottom:6px}',
      '.__udb_dc_name{font-size:17px;font-weight:800;color:#fff;word-break:break-all}',
      '.__udb_dc_motto{font-size:11px;color:rgba(255,255,255,.65);margin-top:4px;font-style:italic}',
      '.__udb_dc_badges{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}',
      '.__udb_dc_badge{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;padding:3px 8px;border-radius:4px;background:rgba(255,255,255,.15);color:#fff}',
      '.__udb_dc_body{padding:16px 20px}',
      '.__udb_dc_section{margin-bottom:16px}',
      '.__udb_dc_section:last-child{margin-bottom:0}',
      '.__udb_dc_section_title{font-size:9px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#5c5e6b;margin-bottom:8px}',
      '.__udb_dc_row{display:flex;align-items:baseline;gap:8px;padding:6px 0;border-bottom:1px solid #1c1e2a;font-size:11px}',
      '.__udb_dc_row:last-child{border-bottom:none}',
      '.__udb_dc_row_label{width:90px;flex-shrink:0;color:#82849a;font-weight:600}',
      '.__udb_dc_row_value{color:#eceefb;font-weight:600;flex:1;word-break:break-all}',
      '.__udb_dc_tags{display:flex;flex-wrap:wrap;gap:5px}',
      '.__udb_dc_tag{background:#1c1e2a;border:1px solid #23252f;color:#A6B0FF;font-size:10px;font-weight:600;padding:3px 9px;border-radius:20px}',
      '.__udb_dc_outfits{display:flex;flex-wrap:wrap;gap:8px}',
      '.__udb_dc_outfits img{width:90px;height:130px;image-rendering:pixelated;background:#1c1e2a;border-radius:8px;border:1.5px solid #23252f}',
      '.__udb_outfit_clickable{cursor:pointer;transition:opacity .15s,outline .15s;outline:2px solid transparent;border-radius:4px}',
      '.__udb_outfit_clickable:hover{opacity:.8;outline-color:#6C7CFF}',
      '.__udb_status{font-size:10px;color:#2ecc71}',
      '#__udb_nc{position:fixed;top:8px;right:664px;width:360px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__udb_nc *{box-sizing:border-box}',
      '#__udb_nc_list{max-height:480px;overflow-y:auto}',
      '.__udb_ncrow{display:flex;gap:10px;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.05)}',
      '.__udb_ncrow_info{flex:1;min-width:0}',
      '.__udb_ncrow_name{font-size:12px;font-weight:700;color:#eceefb;margin-bottom:6px}',
    ].join('');
    document.head.appendChild(style);
  }

  function buildPanel() {
    injectStyle();
    panel = document.createElement('div');
    panel.id = '__userdb';
    panel.innerHTML =
      '<div class="__udb_card">'
      + '<div class="__udb_hdr" id="__udb_hdr">'
      + '<span class="__udb_eyebrow">Gheloo</span>'
      + '<span class="__udb_title">User Database</span>'
      + '<button class="__udb_iconbtn" id="__udb_namechanges_btn" title="Name changes">&#8644;</button>'
      + '<span class="__udb_close" id="__udb_close">&times;</span>'
      + '</div>'
      + '<div id="__udb_body">'
      + '<div id="__udb_list_panel">'
      + '<input id="__udb_search" class="__udb_search" placeholder="Search name, motto, id, group…">'
      + '<div id="__udb_count">Loading…</div>'
      + '<div id="__udb_list"></div>'
      + '</div>'
      + '<div id="__udb_detail_panel">'
      + '<div id="__udb_empty">Click a user to view details</div>'
      + '<div id="__udb_detail" style="display:none"></div>'
      + '</div>'
      + '</div>'
      + '</div>';
    document.body.appendChild(panel);
    panel.style.display = 'none';

    window.__ghk_makeDraggable(panel, panel.querySelector('#__udb_hdr'), '__ghk_udb_pos', function(e) {
      return e.target.id === '__udb_close' || e.target.id === '__udb_namechanges_btn';
    });

    panel.querySelector('#__udb_close').addEventListener('click', function() { panel.style.display = 'none'; });
    panel.querySelector('#__udb_search').addEventListener('input', function() { _applyFilters(); });
    panel.querySelector('#__udb_namechanges_btn').addEventListener('click', function() {
      ncPanel.style.display = '';
      window.__udb_ensureLoaded();
      _renderNameChanges();
    });
  }

  function buildNameChangesPanel() {
    ncPanel = document.createElement('div');
    ncPanel.id = '__udb_nc';
    ncPanel.innerHTML =
      '<div class="__udb_card">'
      + '<div class="__udb_hdr" id="__udb_nc_hdr">'
      + '<span class="__udb_eyebrow">Gheloo</span>'
      + '<span class="__udb_title">Name Changes</span>'
      + '<span class="__udb_close" id="__udb_nc_close">&times;</span>'
      + '</div>'
      + '<div id="__udb_nc_list"></div>'
      + '</div>';
    document.body.appendChild(ncPanel);
    ncPanel.style.display = 'none';

    window.__ghk_makeDraggable(ncPanel, ncPanel.querySelector('#__udb_nc_hdr'), '__ghk_udb_nc_pos', function(e) {
      return e.target.id === '__udb_nc_close';
    });

    ncPanel.querySelector('#__udb_nc_close').addEventListener('click', function() { ncPanel.style.display = 'none'; });
  }

  window.__udb_ensureLoaded = function() {
    if (!_loaded && !_loading) _loadUsers();
  };

  function init() {
    buildPanel();
    buildNameChangesPanel();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(init); });
  } else {
    window.__ghk_ready(init);
  }
})();
