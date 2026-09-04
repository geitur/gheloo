(function() {
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function outId(name) {
    if (!window.PKT || !window.PKT.OUT) return null;
    for (const id in window.PKT.OUT) if (window.shortName(window.PKT.OUT[id], 'OUT') === name) return parseInt(id, 10);
    return null;
  }

  function buildPanel() {
    const css = document.createElement('style');
    css.textContent = [
      '#__itg{position:fixed;top:16px;left:16px;width:520px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__itg *{box-sizing:border-box}',
      '.__itg_card{display:flex;flex-direction:column;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb}',
      '.__itg_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__itg_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}',
      '.__itg_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__itg_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__itg_close:hover{color:#eceefb}',
      '.__itg_toolbar{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.06)}',
      '.__itg_search{flex:1;background:#1c1e2a;color:#eceefb;border:1px solid #23252f;border-radius:8px;font-size:11px;padding:5px 8px}',
      '.__itg_btn{background:#1c1e2a;color:#82849a;border:1px solid #23252f;border-radius:8px;font-size:9px;padding:4px 8px;cursor:pointer;min-width:44px;text-align:center}',
      '.__itg_btn:hover{color:#eceefb}',
      '.__itg_body{display:flex;height:360px;overflow:hidden}',
      '#__itg_list{flex:1;overflow:auto}',
      '.__itg_empty{padding:30px;text-align:center;font-size:11px;color:#5c5e6b}',
      '.__itg_grp{padding:6px 10px 3px;font:700 9px/1 monospace;letter-spacing:.5px;color:#5c5e6b;text-transform:uppercase;background:#0A0B10;position:sticky;top:0}',
      '.__itg_row{display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid rgba(255,255,255,0.04)}',
      '.__itg_row:hover{background:rgba(255,255,255,0.04)}',
      '.__itg_name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;color:#c7c9db}',
      '.__itg_id{font-size:9px;color:#5c5e6b;font-family:monospace;flex-shrink:0}',
      '.__itg_input{width:120px;background:#1c1e2a;color:#eceefb;border:1px solid #23252f;border-radius:6px;font-size:10px;padding:4px 6px;flex-shrink:0}',
      '.__itg_input.__itg_dirty{border-color:#6C7CFF}',
      '.__itg_save{font-size:9px;background:rgba(108,124,255,0.16);color:#A6B0FF;border:1px solid #6C7CFF;border-radius:6px;padding:4px 8px;cursor:pointer;flex-shrink:0}',
      '.__itg_save:hover{filter:brightness(1.15)}',
      '.__itg_saved{color:#2ecc71!important}',
    ].join('');
    document.head.appendChild(css);

    const panel = document.createElement('div');
    panel.id = '__itg';
    panel.innerHTML =
      '<div class="__itg_card">' +
        '<div class="__itg_hdr" id="__itg_hdr">' +
          '<span class="__itg_eyebrow">Gheloo</span>' +
          '<span class="__itg_title">Item Tags</span>' +
          '<span class="__itg_close" id="__itg_close">&times;</span>' +
        '</div>' +
        '<div class="__itg_toolbar">' +
          '<input class="__itg_search" id="__itg_search" placeholder="Filter by name or id…">' +
          '<button class="__itg_btn" id="__itg_refresh">Refresh</button>' +
        '</div>' +
        '<div class="__itg_body"><div id="__itg_list"></div></div>' +
      '</div>';

    document.body.appendChild(panel);
    panel.style.display = 'none';

    window.__ghk_makeDraggable(panel, panel.querySelector('#__itg_hdr'), '__ghk_itg_pos', e =>
      ['BUTTON', 'INPUT'].includes(e.target.tagName) || e.target.id === '__itg_close');

    panel.querySelector('#__itg_close').addEventListener('click', () => { panel.style.display = 'none'; });

    const listEl = panel.querySelector('#__itg_list');
    const searchEl = panel.querySelector('#__itg_search');

    // Own tag by typeId — an item's *type* (spriteId/typeId) is shared by every identical
    // instance, so grouping by it is exactly what clusters the ambiguous duplicates
    // together instead of scattering them across the whole inventory list.
    function render() {
      const filter = searchEl.value.trim().toLowerCase();
      const items = Object.values(window.Inventory.items || {})
        .filter(it => {
          if (!filter) return true;
          const name = (it.furniName || it.classname || '').toLowerCase();
          return name.indexOf(filter) !== -1 || String(it.id).indexOf(filter) !== -1;
        })
        .sort((a, b) => (a.typeId - b.typeId) || (a.id - b.id));

      if (!items.length) {
        listEl.innerHTML = '<div class="__itg_empty">' +
          (Object.keys(window.Inventory.items || {}).length
            ? 'No items match.'
            : 'Inventory not loaded yet — open your Meubi tab in-game, then hit Refresh.') +
          '</div>';
        return;
      }

      let html = '';
      let lastType = null;
      items.forEach(it => {
        if (it.typeId !== lastType) {
          lastType = it.typeId;
          html += '<div class="__itg_grp">' + esc(it.furniName || it.classname || ('typeId #' + it.typeId)) + '</div>';
        }
        const tag = window.ItemTags[it.id] || '';
        html +=
          '<div class="__itg_row" data-id="' + it.id + '">' +
            '<span class="__itg_id">#' + it.id + '</span>' +
            '<span class="__itg_name">' + esc(it.furniName || it.classname || '') + '</span>' +
            '<input class="__itg_input" maxlength="32" placeholder="label…" value="' + esc(tag) + '">' +
            '<button class="__itg_save">Save</button>' +
          '</div>';
      });
      listEl.innerHTML = html;
    }

    listEl.addEventListener('input', e => {
      if (!e.target.classList.contains('__itg_input')) return;
      e.target.classList.add('__itg_dirty');
    });

    listEl.addEventListener('click', e => {
      const btn = e.target.closest('.__itg_save');
      if (!btn) return;
      const row = btn.closest('.__itg_row');
      const id = parseInt(row.dataset.id, 10);
      const input = row.querySelector('.__itg_input');
      const label = input.value.slice(0, 32);

      const sid = outId('SetItemTag');
      if (sid === null) { console.warn('[item-tags] SetItemTag not found in window.PKT.OUT — placeholder id not wired up on this server yet'); return; }
      window.sendPacket('OUT', sid, '{i:' + id + '}{s:"' + label.replace(/"/g, '\\"') + '"}');

      input.classList.remove('__itg_dirty');
      btn.textContent = '✓';
      btn.classList.add('__itg_saved');
      setTimeout(() => { btn.textContent = 'Save'; btn.classList.remove('__itg_saved'); }, 1200);
    });

    searchEl.addEventListener('input', render);
    panel.querySelector('#__itg_refresh').addEventListener('click', () => {
      const rid = outId('RequestFurniInventory');
      if (rid !== null) window.sendPacket('OUT', rid, '');
      render();
    });

    // Re-render whenever new inventory or tag data comes in while the panel's open, so
    // edits elsewhere (or the panel's own Refresh) show up without a manual re-poke.
    if (window.onPacket) {
      window.onPacket('FurniList', () => { if (panel.style.display !== 'none') render(); });
      window.onPacket('FurniListAddOrUpdate', () => { if (panel.style.display !== 'none') render(); });
      window.onPacket('ItemTags', () => { if (panel.style.display !== 'none') render(); });
    }

    window.__itg_render = render;
    window.__itg_panel = panel;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(buildPanel); });
  else window.__ghk_ready(buildPanel);
})();
