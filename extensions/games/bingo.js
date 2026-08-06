(function() {
  function buildBingoPanel() {
    const style = document.createElement('style');
    style.textContent = [
      '#__bg{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__bg *{box-sizing:border-box}',
      '.__bg_card_outer{background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb;display:flex;flex-direction:column}',
      '.__bg_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__bg_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}',
      '.__bg_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__bg_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__bg_close:hover{color:#eceefb}',
      '#__bg_status_card{border-radius:10px;background:#3a3d4a;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}',
      '#__bg_host_label{font-size:24px;font-weight:800;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,0.3);line-height:1}',
      '#__bg_own_label{font-size:16px;font-weight:700;color:rgba(255,255,255,0.9);line-height:1}',
      '.__bg_card{background:#1c1e2a;border-radius:8px;padding:8px 12px}',
      '.__bg_label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#5c5e6b}',
      '.__bg_divider{height:1px;background:rgba(255,255,255,0.06)}',
      '.__bg_btn{border:none;border-radius:8px;font-size:11px;font-weight:600;padding:6px 10px;cursor:pointer}',
      '.__bg_btn_sm{font-size:9px;padding:2px 8px}',
      '.__bg_btn_secondary{background:#1c1e2a;color:#82849a;border:1px solid #23252f}',
      '.__bg_btn_secondary:hover{color:#eceefb}',
      '.__bg_btn_secondary.active{background:rgba(108,124,255,0.16);color:#A6B0FF;border-color:#6C7CFF}',
      '.__bg_btn_success{background:#A6B0FF;color:#0A0B10}',
      '.__bg_btn_success:hover{filter:brightness(1.08)}',
      '.__bg_btn_danger{background:rgba(231,76,60,0.15);color:#e74c3c}',
      '.__bg_btn_danger:hover{background:rgba(231,76,60,0.28)}',
    ].join('');
    document.head.appendChild(style);

    const bg = document.createElement('div');
    bg.id = '__bg';
    bg.style.cssText = 'position:fixed;top:16px;right:16px;width:300px;z-index:1000;user-select:none;display:none';
    bg.innerHTML =
      '<div class="__bg_card_outer">' +
        '<div class="__bg_hdr" id="__bg_hdr">' +
          '<span class="__bg_eyebrow">Gheloo</span>' +
          '<span class="__bg_title">Bingo</span>' +
          '<span class="__bg_close" id="__bg_close">&times;</span>' +
        '</div>' +
        '<div id="__bg_main" style="box-sizing:border-box;display:flex;flex-direction:column;padding:0">' +
          '<div style="flex:1;overflow:hidden;padding:8px 12px;display:flex;flex-direction:column;gap:6px">' +
            '<div id="__bg_status_card">' +
              '<div style="display:flex;flex-direction:column;gap:3px">' +
                '<span class="__bg_label" style="color:rgba(255,255,255,0.7)">Host</span>' +
                '<span id="__bg_host_label">—</span>' +
              '</div>' +
              '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">' +
                '<span class="__bg_label" style="color:rgba(255,255,255,0.7)">Own</span>' +
                '<span id="__bg_own_label">—</span>' +
              '</div>' +
            '</div>' +
            '<div class="__bg_card" style="display:flex;flex-direction:column;gap:10px">' +
              '<div style="display:flex;align-items:center;justify-content:space-between">' +
                '<div style="display:flex;flex-direction:column;gap:2px">' +
                  '<span class="__bg_label">Host dice</span>' +
                  '<span id="__bg_host_id" style="font-size:9px;color:#82849a;font-family:monospace">not set</span>' +
                '</div>' +
                '<button id="__bg_sel_host_btn" class="__bg_btn __bg_btn_sm __bg_btn_secondary" style="flex-shrink:0">Select Host Dice</button>' +
              '</div>' +
              '<div class="__bg_divider"></div>' +
              '<div style="display:flex;align-items:center;justify-content:space-between">' +
                '<div style="display:flex;flex-direction:column;gap:2px">' +
                  '<span class="__bg_label">Own dice</span>' +
                  '<span id="__bg_own_id" style="font-size:9px;color:#82849a;font-family:monospace">not set</span>' +
                '</div>' +
                '<button id="__bg_sel_own_btn" class="__bg_btn __bg_btn_sm __bg_btn_secondary" style="flex-shrink:0">Select Own Dice</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div style="padding:0 12px 8px;flex-shrink:0">' +
            '<button id="__bg_startstop" class="__bg_btn __bg_btn_success" style="width:100%;font-weight:800">Start</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(bg);

    window.__ghk_makeDraggable(bg, bg.querySelector('#__bg_hdr'), '__ghk_bg_pos', e => e.target.id === '__bg_close');
    bg.querySelector('#__bg_close').addEventListener('click', () => { bg.style.display = 'none'; });

    // ── BINGO ──
    // Game logic added in Task 2 (dice selection) and Task 3 (value tracking + roll loop).
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(buildBingoPanel); }); else window.__ghk_ready(buildBingoPanel);
})();
