(function() {
  function buildStoelendansPanel() {
    const style = document.createElement('style');
    style.textContent = [
      '#__sd{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__sd *{box-sizing:border-box}',
      '.__sd_card_outer{background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb;display:flex;flex-direction:column}',
      '.__sd_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__sd_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}',
      '.__sd_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__sd_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__sd_close:hover{color:#eceefb}',
      '.__sd_btn{border:none;border-radius:8px;font-size:12px;font-weight:800;padding:10px;cursor:pointer;width:100%}',
      '.__sd_btn_secondary{background:#1c1e2a;color:#82849a;border:1px solid #23252f}',
      '.__sd_btn_secondary:hover{color:#eceefb}',
      '.__sd_btn_armed{background:#A6B0FF;color:#0A0B10}',
      '.__sd_btn_armed:hover{filter:brightness(1.08)}',
    ].join('');
    document.head.appendChild(style);

    const sd = document.createElement('div');
    sd.id = '__sd';
    sd.style.cssText = 'position:fixed;top:16px;right:16px;width:220px;z-index:1000;user-select:none;display:none';
    sd.innerHTML =
      '<div class="__sd_card_outer">' +
        '<div class="__sd_hdr" id="__sd_hdr">' +
          '<span class="__sd_eyebrow">Gheloo</span>' +
          '<span class="__sd_title">Stoelendans</span>' +
          '<span class="__sd_close" id="__sd_close">&times;</span>' +
        '</div>' +
        '<div style="padding:12px">' +
          '<button id="__sd_toggle" class="__sd_btn __sd_btn_secondary">In Position</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(sd);

    window.__ghk_makeDraggable(sd, sd.querySelector('#__sd_hdr'), '__ghk_sd_pos', e => e.target.id === '__sd_close');
    sd.querySelector('#__sd_close').addEventListener('click', () => { sd.style.display = 'none'; });

    // ── STOELENDANS (auto-walk) ── arm the button, then on the next floor item
    // add/move packet (any furni — id/typeId/owner/name vary per round, only x/y matter),
    // fire MoveAvatar 3x on the same tick and disarm.
    let _sdArmed = false;

    function _sdSetUI() {
      const btn = sd.querySelector('#__sd_toggle');
      if (!btn) return;
      btn.textContent = _sdArmed ? 'Waiting…' : 'In Position';
      btn.className = _sdArmed ? '__sd_btn __sd_btn_armed' : '__sd_btn __sd_btn_secondary';
    }

    sd.querySelector('#__sd_toggle').addEventListener('click', () => {
      _sdArmed = !_sdArmed;
      _sdSetUI();
    });

    function _sdOnObject(p) {
      if (!_sdArmed || !p.parsed) return;
      const x = p.parsed.x, y = p.parsed.y;
      if (typeof x !== 'number' || typeof y !== 'number') return;
      window.Game.walkTo(x, y);
      window.Game.walkTo(x, y);
      window.Game.walkTo(x, y);
      _sdArmed = false;
      _sdSetUI();
    }
    window.onPacket('ObjectAdd', _sdOnObject);
    window.onPacket('ObjectUpdate', _sdOnObject);

    window.onPacket('RoomReady', () => {
      _sdArmed = false;
      _sdSetUI();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(buildStoelendansPanel); }); else window.__ghk_ready(buildStoelendansPanel);
})();
