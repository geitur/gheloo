(function() {

  function buildGhelooPanel() {
    const ICONS = {
      scripting: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 17l6-6-6-6M12 19h8"/></svg>',
      games: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="10" rx="5"/><path d="M7 10v4M5 12h4"/><circle cx="15" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="13" r="1" fill="currentColor" stroke="none"/></svg>',
      settings: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009.17 19a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
      pktlogger: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="M4 9h16M9 4v16"/></svg>',
      macros: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
      roominspector: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
      walksync: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/><path d="M8 14v6M16 14v6M6 8l2-4 2 4M14 8l2-4 2 4"/></svg>',
      pktsender: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
      colorparty: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C8 6 5 10 5 13a7 7 0 0014 0c0-3-3-7-7-11z"/></svg>',
      guitarhero: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="9" width="18" height="4" rx="1"/><circle cx="6" cy="17" r="2"/><circle cx="12" cy="17" r="2"/><circle cx="18" cy="17" r="2"/></svg>',
      bingo: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="8" cy="16" r="1.2" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>',
      rooms: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10l9-7 9 7"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/></svg>',
      furnihider: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 11V8a2 2 0 012-2h12a2 2 0 012 2v3"/><path d="M3 11h18v4a1 1 0 01-1 1H4a1 1 0 01-1-1v-4z"/><path d="M4 16v3M20 16v3"/></svg>',
      roomclone: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="13" height="13" rx="2"/><path d="M8 16v3a2 2 0 002 2h9a2 2 0 002-2v-9a2 2 0 00-2-2h-3"/></svg>',
      areamover: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M19 9l3 3-3 3M9 19l3 3 3-3"/><path d="M2 12h20M12 2v20"/></svg>',
      postermover: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none"/><path d="M21 15l-5-5L5 21"/></svg>',
      photolibrary: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 4h-5L7 7H4a2 2 0 00-2 2v9a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="4"/></svg>',
      userdatabase: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',
      fun: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M8 13.5c1 1.5 2.3 2.2 4 2.2s3-.7 4-2.2"/><circle cx="9" cy="9.5" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="9.5" r="1" fill="currentColor" stroke="none"/></svg>',
      friendadder: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>',
      mimic: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="9" r="3"/><circle cx="16" cy="15" r="3"/><path d="M10.5 10.5l3 3"/></svg>',
      userext: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 2v4M15 2v4"/><path d="M6 6h12v4a6 6 0 01-12 0V6z"/><path d="M12 16v6"/></svg>',
      createext: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13 6l-2 12"/></svg>',
      fps: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h7l-1 8 11-14h-7l1-6z"/></svg>',
      design: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 000 20 2.5 2.5 0 000-5h1a3 3 0 003-3c0-6-4-12-4-12z"/><circle cx="7" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="7.5" cy="15" r="1" fill="currentColor" stroke="none"/></svg>',
      darkmode: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>',
      antispin: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 0115-6.7M21 12a9 9 0 01-15 6.7"/><path d="M17 3v5h-5M7 21v-5h5"/><path d="M3 3l18 18"/></svg>',
      rightclick: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a7 7 0 00-7 7v6a7 7 0 0014 0V9a7 7 0 00-7-7z"/><path d="M12 2v9h6"/></svg>',
      hidetyping: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/><path d="M3 3l18 18"/></svg>',
      rejoin: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6"/><path d="M3 11a9 9 0 0115-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 13a9 9 0 01-15 6.7L3 16"/></svg>',
      cursor: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3l6.5 16 2-6.5L20 10.5z"/></svg>',
      steal: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
      me: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></svg>',
      proxy: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 17H7a5 5 0 010-10h2M15 7h2a5 5 0 010 10h-2M8 12h8"/></svg>',
      exploits: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h7l-1 8 11-14h-7l1-6z"/></svg>',
      marktplaats: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l1.5-5h15L21 9"/><path d="M4 9h16v10a1 1 0 01-1 1H5a1 1 0 01-1-1V9z"/><path d="M9 13a3 3 0 006 0"/></svg>',
      deurwaarder: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 12l-8.5 8.5a1.5 1.5 0 01-2-2L12 10"/><path d="M17.5 8.5L22 4"/><path d="M2 22h10"/><path d="M13.5 4.5l6 6"/><path d="M10.5 7.5l6 6"/></svg>',
      roomhistory: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/><path d="M3 12a9 9 0 011.5-5" opacity="0.35"/></svg>',
      avatarcompass: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></svg>',
      ping: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12h4l2-7 4 14 2-7h8"/></svg>',
      creditredeem: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 013-3c1.5 0 2.5.9 2.5 2s-1 1.6-2 2-1.5.6-1.5 1.5"/><path d="M12 16.5v.01"/></svg>',
      ecotron: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 3l3 3-3 3M17 21l-3-3 3-3"/><path d="M20 10a8 8 0 00-15-3.5M4 14a8 8 0 0015 3.5"/></svg>',
    };

    const style = document.createElement('style');
    style.textContent = `
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; }
      .ghl-panel { position:fixed; left:20px; top:50%; width:380px; background:#12131A; border-radius:14px; box-shadow:0 12px 34px rgba(0,0,0,.55); display:none; overflow:hidden; z-index:1000; font-size:13px; color:#eceefb; }
      .ghl-panel.open { display:flex; transform:translateY(-50%); }
      .ghl-hub-close { position:absolute; top:10px; right:10px; width:24px; height:24px; border-radius:8px; display:flex; align-items:center; justify-content:center; color:#5c5e6b; cursor:pointer; font-size:18px; line-height:1; z-index:10; }
      .ghl-hub-close:hover { background:rgba(255,255,255,0.06); color:#eceefb; }
      .ghl-rail { width:58px; flex-shrink:0; background:#0A0B10; display:flex; flex-direction:column; align-items:center; padding:12px 0; gap:6px; cursor:move; }
      .ghl-rail-icon { width:38px; height:38px; border-radius:10px; display:flex; align-items:center; justify-content:center; color:#6b6d7a; cursor:pointer; border-left:2px solid transparent; }
      .ghl-rail-icon:hover { color:#A6B0FF; }
      .ghl-rail-icon.active { background:rgba(108,124,255,0.16); border-left-color:#6C7CFF; color:#A6B0FF; }
      .ghl-rail-spacer { flex:1; }
      .ghl-content { flex:1; padding:16px; min-width:0; display:none; }
      .ghl-content.active { display:block; }
      .ghl-eyebrow { font:700 9px/1 monospace; letter-spacing:1.5px; color:#6C7CFF; text-transform:uppercase; margin-bottom:2px; }
      .ghl-heading { font:600 16px system-ui; color:#eceefb; margin-bottom:14px; }
      .ghl-section-label { font:700 9px/1 monospace; letter-spacing:1px; color:#5c5e6b; text-transform:uppercase; margin:14px 0 6px; }
      .ghl-section-label.first { margin-top:0; }
      .ghl-row { display:flex; align-items:center; gap:10px; padding:8px; border-radius:10px; margin-bottom:6px; cursor:pointer; border-left:2px solid transparent; }
      .ghl-row:hover { background:rgba(255,255,255,0.04); }
      .ghl-row.active { background:rgba(108,124,255,0.12); border-left-color:#6C7CFF; }
      .ghl-row-icon { width:30px; height:30px; border-radius:8px; background:#1c1e2a; display:flex; align-items:center; justify-content:center; flex-shrink:0; color:#82849a; }
      .ghl-row.active .ghl-row-icon { color:#A6B0FF; }
      .ghl-row-text { min-width:0; flex:1; }
      .ghl-row-title { font:600 12.5px system-ui; color:#eceefb; }
      .ghl-row-subtitle { font:400 10.5px system-ui; color:#82849a; }
      .ghl-badge { font:700 10px monospace; color:#0A0B10; background:#A6B0FF; padding:2px 8px; border-radius:999px; flex-shrink:0; display:none; }
      .ghl-badge.show { display:inline-block; }
      .ghl-me-card { display:flex; flex-direction:column; align-items:center; background:#1c1e2a; border-radius:12px; padding:18px 14px 14px; }
      .ghl-me-identity { display:flex; flex-direction:column; align-items:center; width:100%; cursor:pointer; border-radius:10px; padding:4px; }
      .ghl-me-identity:hover { background:rgba(255,255,255,0.04); }
      .ghl-me-avatar { position:relative; display:flex; justify-content:center; align-items:flex-end; width:100%; height:150px; }
      .ghl-me-avatar img#ghl-me-img { max-width:130px; max-height:150px; object-fit:contain; image-rendering:pixelated; }
      .ghl-me-avatar img#ghl-me-vip { position:absolute; top:0; left:0; width:32px; height:32px; object-fit:contain; image-rendering:pixelated; display:none; }
      .ghl-me-name { font:600 16px system-ui; color:#eceefb; margin-top:8px; text-align:center; }
      .ghl-me-stats { display:flex; width:100%; gap:8px; margin-top:14px; }
      .ghl-me-stat { flex:1; min-width:0; background:#12131A; border-radius:10px; padding:10px 8px; display:flex; flex-direction:column; align-items:center; }
      .ghl-me-stat-val { font:700 16px system-ui; color:#A6B0FF; word-break:break-all; text-align:center; }
      .ghl-me-stat-lbl { font:700 9px/1 monospace; letter-spacing:1px; text-transform:uppercase; color:#5c5e6b; margin-top:4px; }
      .ghl-proxy-card { align-items:flex-start; gap:10px; }
      .ghl-proxy-status { display:flex; align-items:center; gap:8px; font:600 14px system-ui; color:#eceefb; }
      .ghl-proxy-dot { width:9px; height:9px; border-radius:50%; flex-shrink:0; background:#e74c3c; box-shadow:0 0 6px #e74c3c; }
      .ghl-proxy-dot.green { background:#2ecc71; box-shadow:0 0 6px #2ecc71; }
      .ghl-proxy-dot.amber { background:#f1c40f; box-shadow:0 0 6px #f1c40f; }
      .ghl-proxy-url-lbl { font:700 9px/1 monospace; letter-spacing:1px; text-transform:uppercase; color:#5c5e6b; }
      .ghl-proxy-url { font:400 11px monospace; color:#82849a; word-break:break-all; margin-top:4px; }
      .ghl-proxy-btn { align-self:stretch; margin-top:10px; background:rgba(108,124,255,0.12); color:#A6B0FF; border:1px solid rgba(166,176,255,0.24); border-radius:8px; padding:7px 10px; font:600 11px system-ui; cursor:pointer; text-align:center; }
      .ghl-proxy-btn:hover { background:rgba(108,124,255,0.2); }
      .ghl-overlay-row { position:fixed; top:12px; left:12px; z-index:2147483647; display:flex; gap:6px; }
      .ghl-fps-overlay { background:#0A0B10; color:#A6B0FF; font:700 11px monospace; padding:4px 10px; border-radius:8px; border:1px solid #23252f; display:none; cursor:pointer; }
      .ghl-fps-overlay.show { display:block; }
      .ghl-fps-dropdown { display:none; flex-direction:column; gap:2px; background:#1c1e2a; border-radius:10px; padding:6px; margin:-2px 0 6px; }
      .ghl-fps-dropdown.open { display:flex; }
      .ghl-fps-opt { padding:6px 10px; border-radius:8px; font-size:11.5px; color:#82849a; cursor:pointer; }
      .ghl-fps-opt:hover { background:rgba(255,255,255,0.04); color:#eceefb; }
      .ghl-fps-opt.active { background:rgba(108,124,255,0.12); color:#A6B0FF; font-weight:600; }
    `;

    const host = document.createElement('div');
    host.id = '__gheloo_host';
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    root.appendChild(style);

    const overlayRow = document.createElement('div');
    overlayRow.className = 'ghl-overlay-row';
    root.appendChild(overlayRow);

    const fpsOverlay = document.createElement('div');
    fpsOverlay.className = 'ghl-fps-overlay';
    fpsOverlay.textContent = '— FPS';
    fpsOverlay.addEventListener('click', function() {
      window.Gheloo.showCategory('settings');
      window.Gheloo.open();
    });

    const pingOverlay = document.createElement('div');
    pingOverlay.className = 'ghl-fps-overlay';
    pingOverlay.textContent = '— ms';
    pingOverlay.addEventListener('click', function() {
      window.Gheloo.showCategory('settings');
      window.Gheloo.open();
    });
    overlayRow.appendChild(fpsOverlay);
    overlayRow.appendChild(pingOverlay);

    const panelEl = document.createElement('div');
    panelEl.className = 'ghl-panel';
    root.appendChild(panelEl);

    const rail = document.createElement('div');
    rail.className = 'ghl-rail';
    panelEl.appendChild(rail);

    function showPanelById(id) {
      return function() {
        const el = document.getElementById(id);
        if (!el) return;
        const r = panelEl.getBoundingClientRect();
        el.style.right = 'auto'; el.style.top = 'auto';
        el.style.left = r.left + 'px'; el.style.top = r.top + 'px';
        el.style.display = '';
        if (window.__ghk_bringToFront) window.__ghk_bringToFront(el);
      };
    }

    const FPS_CAP_OPTIONS = [0, 60, 30, 24]; // 0 = unlimited
    const FPS_STORAGE_KEY = '__ghk_fps_settings';
    let _fpsOverlayOn = false;
    let _fpsCap = 0;
    try {
      const _savedFps = JSON.parse(localStorage.getItem(FPS_STORAGE_KEY) || '{}');
      if (_savedFps.on) _fpsOverlayOn = true;
      if (typeof _savedFps.cap === 'number') _fpsCap = _savedFps.cap;
    } catch(_) {}
    let _fpsCapLabel = _fpsCap ? _fpsCap + ' FPS' : 'Unlimited';

    function _saveFpsSettings() {
      try { localStorage.setItem(FPS_STORAGE_KEY, JSON.stringify({ on: _fpsOverlayOn, cap: _fpsCap })); } catch(_) {}
    }

    function _updateFpsSubtitle() {
      rowEls['fps'].row.querySelector('.ghl-row-subtitle').textContent = (_fpsOverlayOn ? 'On' : 'Off') + ' - ' + _fpsCapLabel;
    }

    function toggleFpsOverlay() {
      _fpsOverlayOn = !_fpsOverlayOn;
      fpsOverlay.classList.toggle('show', _fpsOverlayOn);
      window.Gheloo.setActive('fps', _fpsOverlayOn);
      _updateFpsSubtitle();
      _saveFpsSettings();
      window.__ghk_fpsOverlayOn = _fpsOverlayOn;
      if (window.__ghk_updatePillsWrapPos) window.__ghk_updatePillsWrapPos();
    }

    // Owns window.__ghk_pingEnabled / window.__ghk_pingIntervalMs — multitab.js reads these
    // (opt-in probe loop) but never writes them, per its own doc comment at the top of that file.
    const PING_INTERVAL_OPTIONS = [1000, 2000, 5000, 10000];
    const PING_STORAGE_KEY = '__ghk_ping_settings';
    let _pingOn = false;
    let _pingIntervalMs = 2000;
    try {
      const _savedPing = JSON.parse(localStorage.getItem(PING_STORAGE_KEY) || '{}');
      if (_savedPing.on) _pingOn = true;
      if (typeof _savedPing.interval === 'number') _pingIntervalMs = _savedPing.interval;
    } catch(_) {}
    let _pingIntervalLabel = _pingIntervalMs + 'ms';

    function _savePingSettings() {
      try { localStorage.setItem(PING_STORAGE_KEY, JSON.stringify({ on: _pingOn, interval: _pingIntervalMs })); } catch(_) {}
    }

    function _updatePingSubtitle() {
      rowEls['ping'].row.querySelector('.ghl-row-subtitle').textContent = (_pingOn ? 'On' : 'Off') + ' - ' + _pingIntervalLabel;
    }

    function togglePing() {
      _pingOn = !_pingOn;
      pingOverlay.classList.toggle('show', _pingOn);
      window.Gheloo.setActive('ping', _pingOn);
      window.__ghk_pingEnabled = _pingOn;
      window.__ghk_pingOverlayOn = _pingOn;
      if (!_pingOn && window.__ghk_resetPing) window.__ghk_resetPing();
      _updatePingSubtitle();
      _savePingSettings();
      if (window.__ghk_updatePillsWrapPos) window.__ghk_updatePillsWrapPos();
    }

    const CATEGORIES = [
      {
        id: 'scripting', label: 'Scripting', icon: ICONS.scripting,
        sections: [
          { label: 'Traffic', rows: [
            { id: 'pktsender', title: 'Packet Sender', subtitle: 'Send packets, scheduler', icon: ICONS.pktsender, close: false, onClick: showPanelById('__snd') },
            { id: 'pktlogger', title: 'Packet Logger', subtitle: 'Incoming and outgoing packets', icon: ICONS.pktlogger, close: false, onClick: showPanelById('__hbl') },
            { id: 'macros', title: 'Macros', subtitle: 'Record & replay actions', icon: ICONS.macros, close: false, onClick: showPanelById('__mac') },
            { id: 'roominspector', title: 'Room Inspector', subtitle: 'Owner spoof, placer relay, room snapshots', icon: ICONS.roominspector, close: false, onClick: showPanelById('__ins_panel') },
            { id: 'walksync', title: 'Walk Sync', subtitle: 'Follow another tab, offset by a fixed tile', icon: ICONS.walksync, close: false, onClick: showPanelById('__ws_panel') },
          ]},
        ],
      },
      {
        id: 'games', label: 'Games', icon: ICONS.games,
        sections: [
          { label: '', rows: [
            { id: 'colorparty', title: 'Color Party', subtitle: 'Auto-play Color Party', icon: ICONS.colorparty, close: false, onClick: showPanelById('__rc') },
            { id: 'guitarhero', title: 'Guitar Hero', subtitle: 'Auto-play Guitar Hero', icon: ICONS.guitarhero, close: false, onClick: showPanelById('__gh') },
            { id: 'bingo', title: 'Bingo', subtitle: 'Auto-roll to match the host dice', icon: ICONS.bingo, close: false, onClick: showPanelById('__bg') },
          ]},
        ],
      },
      {
        id: 'rooms', label: 'Rooms', icon: ICONS.rooms,
        sections: [
          { label: '', rows: [
            { id: 'furnihider', title: 'Furni Hider', subtitle: 'Hide furni clientside', icon: ICONS.furnihider, close: false, onClick: function() {
              showPanelById('__fh_panel')();
              if (window.__fh_render) window.__fh_render();
            } },
            { id: 'roomclone', title: 'Room Clone', subtitle: 'Capture and rebuild a room layout', icon: ICONS.roomclone, close: false, onClick: function() {
              showPanelById('__rclone')();
              if (window.__ghl_rcShowQuick) window.__ghl_rcShowQuick();
            } },
            { id: 'areamover', title: 'Area Mover', subtitle: 'Shift a rectangular area of furni, stack by stack', icon: ICONS.areamover, close: false, onClick: showPanelById('__am_panel') },
            { id: 'postermover', title: 'Poster Mover', subtitle: 'Move wall items everywhere', icon: ICONS.postermover, close: false, onClick: showPanelById('__pm_panel') },
          ]},
        ],
      },
      {
        id: 'fun', label: 'Fun', icon: ICONS.fun,
        sections: [
          { label: '', rows: [
            { id: 'userdatabase', title: 'User Database', subtitle: 'Search users, copy their outfits, namechanges', icon: ICONS.userdatabase, close: false, onClick: function() {
              showPanelById('__userdb')();
              if (window.__udb_ensureLoaded) window.__udb_ensureLoaded();
            } },
            { id: 'mimic', title: 'Mimic', subtitle: 'Copy a user\'s actions', icon: ICONS.mimic, close: false, onClick: showPanelById('__mimic') },
            { id: 'friendadder', title: 'Friend Adder', subtitle: 'Auto-add users in your room', icon: ICONS.friendadder, close: false, onClick: showPanelById('__fb') },
          ]},
        ],
      },
      {
        id: 'exploits', label: 'Exploits', icon: ICONS.exploits,
        sections: [
          { label: '', rows: [
            { id: 'marktplaats', title: 'Marktplaats', subtitle: 'Marktplaats Dupe', icon: ICONS.marktplaats, close: false, onClick: showPanelById('__mb') },
            { id: 'photolibrary', title: 'Photo Library', subtitle: 'Save and organize camera photos', icon: ICONS.photolibrary, close: false, onClick: showPanelById('__photolib') },
            { id: 'deurwaarder', title: 'Deurwaarder', subtitle: 'Dupe Dashboard', icon: ICONS.deurwaarder, close: false, onClick: function() { if (window.__ghk_openDeurwaarder) window.__ghk_openDeurwaarder(); } },
            { id: 'creditredeem', title: 'Credit Redeem', subtitle: 'Redeem/pickup dupe race', icon: ICONS.creditredeem, close: false, onClick: showPanelById('__cqe') },
            { id: 'ecotron', title: 'Ecotron Race', subtitle: 'Recycle + marktplaats list/cancel race', icon: ICONS.ecotron, close: false, onClick: function() {
              showPanelById('__eco_panel')();
              if (window.__eco_render) window.__eco_render();
            } },
          ]},
        ],
      },
      {
        id: 'userext', label: 'Extensions', icon: ICONS.userext,
        sections: [
          { label: '', rows: [
            { id: 'uhub', title: 'Create Extension', subtitle: 'Create & manage your own scripts', icon: ICONS.createext, close: false, onClick: showPanelById('__ext') },
          ]},
        ],
      },
      {
        id: 'interaction', label: 'Interaction', icon: ICONS.cursor,
        sections: [
          { label: 'Mouse', rows: [
            { id: 'antispin', title: 'Anti-Spin', subtitle: 'Prevent your avatar form rotating when you click someone', icon: ICONS.antispin, close: false, onClick: function() { toggleAntiSpin(); } },
            { id: 'avatarcompass', title: 'Avatar Rotate Menu', subtitle: 'Turn yourself without walking', icon: ICONS.avatarcompass, close: false, onClick: function() { toggleCompass(); } },
          ]},
          { label: 'Chat', rows: [
            { id: 'hidetyping', title: 'Hide Typing Bubble', subtitle: 'Hide the balloon that appears when you are typing', icon: ICONS.hidetyping, close: false, onClick: function() { toggleHideTyping(); } },
          ]},
          { label: 'Commands', rows: [
            { id: 'rejoin', title: 'Rejoin Command', subtitle: 'Type :rejoin in chat to re-enter this room', icon: ICONS.rejoin, close: false, onClick: function() { toggleRejoinCommand(); } },
            { id: 'steal', title: 'Steal Command', subtitle: "Type :steal [username] to copy someone's outfit even if they are offline", icon: ICONS.steal, close: false, onClick: function() { toggleStealCommand(); } },
          ]},
        ],
      },
      {
        id: 'settings', label: 'Settings', icon: ICONS.settings,
        sections: [
          { label: 'Performance', rows: [
            { id: 'fps', title: 'FPS', subtitle: 'Off - Unlimited', icon: ICONS.fps, close: false, onClick: function() { toggleFpsOverlay(); } },
            { id: 'ping', title: 'Ping', subtitle: 'Off - 2000ms', icon: ICONS.ping, close: false, onClick: function() { togglePing(); } },
          ]},
          { label: 'Appearance', rows: [
            { id: 'defaultdesign', title: 'Default Leet Design', subtitle: 'Back to standaard Leet layout', icon: ICONS.design, close: false, onClick: function() { toggleDefaultDesign(); } },
            { id: 'darkmode', title: 'Custom Mode', subtitle: 'Custom layout colors', icon: ICONS.darkmode, close: false, onClick: function() { toggleDarkMode(); } },
            { id: 'roomhistoryicon', title: 'Room History', subtitle: 'Turn on/off Room History', icon: ICONS.roomhistory, close: false, onClick: function() { toggleRoomHistoryIcon(); } },
            { id: 'marktplaatsalertstoggle', title: 'Marktplaats Alerts', subtitle: 'Turn on/off Marktplaats Alerts', icon: ICONS.marktplaats, close: false, onClick: function() { toggleMarktplaatsAlerts(); } },
          ]},
          { label: 'Browser', rows: [
            { id: 'rightclick', title: 'Block Right Click', subtitle: 'Block right click inspect', icon: ICONS.rightclick, close: false, onClick: function() { toggleRightClick(); } },
          ]},
        ],
      },
    ];

    const railIconEls = {};
    const contentEls = {};
    const rowEls = {};
    let activeCategory = CATEGORIES[0].id;

    CATEGORIES.forEach(function(cat) {
      const railIcon = document.createElement('div');
      railIcon.className = 'ghl-rail-icon';
      railIcon.title = cat.label;
      railIcon.innerHTML = cat.icon;
      railIcon.addEventListener('click', function() { setCategory(cat.id); });
      rail.appendChild(railIcon);
      railIconEls[cat.id] = railIcon;

      const content = document.createElement('div');
      content.className = 'ghl-content';

      const eyebrow = document.createElement('div');
      eyebrow.className = 'ghl-eyebrow';
      eyebrow.textContent = 'Gheloo';
      content.appendChild(eyebrow);

      const heading = document.createElement('div');
      heading.className = 'ghl-heading';
      heading.textContent = cat.label;
      content.appendChild(heading);

      cat.sections.forEach(function(section, si) {
        const sectionLabel = document.createElement('div');
        sectionLabel.className = 'ghl-section-label' + (si === 0 ? ' first' : '');
        sectionLabel.textContent = section.label;
        content.appendChild(sectionLabel);

        section.rows.forEach(function(row) {
          const rowEl = document.createElement('div');
          rowEl.className = 'ghl-row';
          rowEl.dataset.rowId = row.id;

          const rowIcon = document.createElement('div');
          rowIcon.className = 'ghl-row-icon';
          rowIcon.innerHTML = row.icon;
          rowEl.appendChild(rowIcon);

          const rowText = document.createElement('div');
          rowText.className = 'ghl-row-text';
          rowText.innerHTML = '<div class="ghl-row-title">' + row.title + '</div><div class="ghl-row-subtitle">' + row.subtitle + '</div>';
          rowEl.appendChild(rowText);

          const badge = document.createElement('div');
          badge.className = 'ghl-badge';
          rowEl.appendChild(badge);
          rowEls[row.id] = { row: rowEl, badge: badge };

          rowEl.addEventListener('click', function() {
            if (row.onClick) row.onClick();
            if (row.close) setOpen(false);
          });

          content.appendChild(rowEl);
        });
      });

      panelEl.appendChild(content);
      contentEls[cat.id] = content;
    });

    // ── Dynamic per-extension rows under Extensions, sourced from localStorage ────────
    function _escExt(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function _syncExtensionRows() {
      const content = contentEls['userext'];
      if (!content) return;
      let list = [];
      try { list = JSON.parse(localStorage.getItem('__ghk_extensions') || '[]'); } catch(_) {}

      let dyn = content.querySelector('#__ghl_ext_dyn');
      if (!dyn) {
        dyn = document.createElement('div');
        dyn.id = '__ghl_ext_dyn';
        content.appendChild(dyn);
      }
      dyn.innerHTML = '';
      if (!list.length) return;

      const label = document.createElement('div');
      label.className = 'ghl-section-label';
      label.textContent = 'Your Extensions';
      dyn.appendChild(label);

      list.forEach(function(ext) {
        const rowEl = document.createElement('div');
        rowEl.className = 'ghl-row';

        const rowIcon = document.createElement('div');
        rowIcon.className = 'ghl-row-icon';
        rowIcon.innerHTML = ICONS.userext;
        rowEl.appendChild(rowIcon);

        const rowText = document.createElement('div');
        rowText.className = 'ghl-row-text';
        rowText.innerHTML = '<div class="ghl-row-title">' + _escExt(ext.name) + '</div><div class="ghl-row-subtitle">' + (ext.enabled !== false ? 'Enabled' : 'Disabled') + '</div>';
        rowEl.appendChild(rowText);

        rowEl.addEventListener('click', function() {
          showPanelById('__ext')();
          if (window.__ext_editExtension) window.__ext_editExtension(ext.id);
        });

        dyn.appendChild(rowEl);
      });
    }
    window.__ghl_syncExtRows = _syncExtensionRows;
    _syncExtensionRows();

    const meIcon = document.createElement('div');
    meIcon.className = 'ghl-rail-icon';
    meIcon.title = 'My User';
    meIcon.innerHTML = ICONS.me;
    meIcon.addEventListener('click', function() { setCategory('me'); });
    rail.appendChild(meIcon);
    railIconEls['me'] = meIcon;

    const meContent = document.createElement('div');
    meContent.className = 'ghl-content';
    meContent.innerHTML =
      '<div class="ghl-eyebrow">Gheloo</div>' +
      '<div class="ghl-heading">My User</div>' +
      '<div class="ghl-me-card">' +
        '<div class="ghl-me-identity" id="ghl-me-identity">' +
          '<div class="ghl-me-avatar"><img id="ghl-me-img" alt=""><img id="ghl-me-vip" alt="VIP" src="https://i.imgur.com/ismp7QV.png"></div>' +
          '<div class="ghl-me-name" id="ghl-me-name">—</div>' +
        '</div>' +
        '<div class="ghl-me-stats">' +
          '<div class="ghl-me-stat"><span class="ghl-me-stat-val" id="ghl-me-id">—</span><span class="ghl-me-stat-lbl">User ID</span></div>' +
          '<div class="ghl-me-stat"><span class="ghl-me-stat-val" id="ghl-me-score">—</span><span class="ghl-me-stat-lbl">Achievement</span></div>' +
        '</div>' +
      '</div>';
    panelEl.appendChild(meContent);
    contentEls['me'] = meContent;

    let meSelfId = null;

    function renderMe(u) {
      if (!u) return;
      meSelfId = u.id;
      meContent.querySelector('#ghl-me-img').src = 'https://www.leet.city/leet-imaging/avatarimage'
        + '?figure=' + encodeURIComponent(u.figure || '')
        + '&direction=3&head_direction=3&size=l&gesture=std&img_format=png';
      meContent.querySelector('#ghl-me-name').textContent = u.name || '—';
      meContent.querySelector('#ghl-me-id').textContent = u.id != null ? u.id : '—';
    }

    let _selfRoomIndex = null;
    function renderMeScore(entities) {
      if (!meSelfId || !entities) return;
      const self = entities.find(function(e) { return e.isUser && e.id === meSelfId; });
      if (self) {
        meContent.querySelector('#ghl-me-score').textContent = self.achievementScore;
        _selfRoomIndex = self.index;
      }
    }

    function _getPktId(shortNameWanted, dir) {
      dir = dir || 'OUT';
      if (!window.PKT || !window.PKT[dir]) return null;
      for (const [id, name] of Object.entries(window.PKT[dir])) {
        if (window.shortName(name, dir) === shortNameWanted) return parseInt(id);
      }
      return null;
    }

    meContent.querySelector('#ghl-me-identity').addEventListener('click', function() {
      if (!meSelfId || !window.sendPacket) return;
      const id = _getPktId('GetExtendedProfile');
      if (id === null) return;
      window.sendPacket('OUT', id, '{i:' + meSelfId + '}{b:true}');
    });

    const _cachedMe = window.PacketStore && window.PacketStore.latestByName && window.PacketStore.latestByName.UserObject;
    if (_cachedMe && _cachedMe.parsed) renderMe(_cachedMe.parsed);
    const _cachedUsers = window.PacketStore && window.PacketStore.latestByName && window.PacketStore.latestByName.Users;
    if (_cachedUsers && _cachedUsers.parsed) renderMeScore(_cachedUsers.parsed.users);
    if (window.onPacket) {
      window.onPacket('UserObject', function(p) { if (p && p.parsed) renderMe(p.parsed); });
      window.onPacket('Users', function(p) { if (p && p.parsed) renderMeScore(p.parsed.users); });
    }

    // VIP status is tracked globally in ws.js (window.__ghk_isVip) so it's available
    // regardless of load order — just reflect it here.
    function renderVipBadge() {
      const badge = meContent.querySelector('#ghl-me-vip');
      if (!badge) return;
      badge.style.display = window.__ghk_isVip ? 'block' : 'none';
    }
    renderVipBadge();
    if (window.onPacket) window.onPacket('UserRights', function() { renderVipBadge(); });

    const proxyIcon = document.createElement('div');
    proxyIcon.className = 'ghl-rail-icon';
    proxyIcon.title = 'Proxy';
    proxyIcon.innerHTML = ICONS.proxy;
    proxyIcon.addEventListener('click', function() { setCategory('proxy'); });
    rail.appendChild(proxyIcon);
    railIconEls['proxy'] = proxyIcon;

    const proxyContent = document.createElement('div');
    proxyContent.className = 'ghl-content';
    proxyContent.innerHTML =
      '<div class="ghl-eyebrow">Gheloo</div>' +
      '<div class="ghl-heading">Proxy</div>' +
      '<div class="ghl-me-card ghl-proxy-card">' +
        '<div class="ghl-proxy-status"><span class="ghl-proxy-dot" id="ghl-proxy-dot"></span><span id="ghl-proxy-state">Disconnected</span></div>' +
        '<div>' +
          '<div class="ghl-proxy-url-lbl">WS URL</div>' +
          '<div class="ghl-proxy-url" id="ghl-proxy-url">—</div>' +
        '</div>' +
      '</div>' +
      '<div class="ghl-me-card ghl-proxy-card" style="margin-top:10px">' +
        '<div class="ghl-proxy-url-lbl">Catalogus Scan</div>' +
        '<div class="ghl-proxy-url" id="ghl-proxy-catalog">—</div>' +
        '<div class="ghl-proxy-btn" id="ghl-proxy-scan-btn">Scan Again</div>' +
        '<div class="ghl-proxy-btn" id="ghl-proxy-export-btn" style="margin-top:6px">Export JSON</div>' +
      '</div>';
    panelEl.appendChild(proxyContent);
    contentEls['proxy'] = proxyContent;

    function renderProxyStatus(color, url) {
      const dot = proxyContent.querySelector('#ghl-proxy-dot');
      const state = proxyContent.querySelector('#ghl-proxy-state');
      dot.className = 'ghl-proxy-dot' + (color === 'green' || color === 'amber' ? ' ' + color : '');
      state.textContent = color === 'green' ? 'Connected' : color === 'amber' ? 'Connecting…' : 'Disconnected';
      if (url) proxyContent.querySelector('#ghl-proxy-url').textContent = url.replace(/^wss?:\/\//, '');
    }

    // Room Clone (extensions/room-clone.js) exposes catalog coverage + live scan
    // progress on window.__ghl_rc* so this tab can show it without importing the module.
    let _catalogMsgUntil = 0; // suppresses the 1s auto-refresh below while a one-off status
    // (export result, etc.) is being shown, so it doesn't get overwritten within a second.
    function renderCatalogCoverage() {
      if (Date.now() < _catalogMsgUntil) return;
      const el = proxyContent.querySelector('#ghl-proxy-catalog');
      if (!el) return;
      const scan = window.__ghl_rcScanStatus && window.__ghl_rcScanStatus();
      if (scan && scan.scanning) {
        el.textContent = 'Scanning... ' + scan.found + ' offer(s) found, ' + scan.remaining + ' page(s) left';
        return;
      }
      const result = window.__ghl_rcCoverage && window.__ghl_rcCoverage();
      el.textContent = result ? (result.have + '/' + result.total + ' (' + result.pct.toFixed(1) + '%)') : 'no data yet';
    }
    renderCatalogCoverage();
    setInterval(renderCatalogCoverage, 1000);
    proxyContent.querySelector('#ghl-proxy-scan-btn').addEventListener('click', function() {
      if (window.__ghl_rcStartScan) window.__ghl_rcStartScan();
    });
    proxyContent.querySelector('#ghl-proxy-export-btn').addEventListener('click', function() {
      const catalogEl = proxyContent.querySelector('#ghl-proxy-catalog');
      if (!window.__ghl_rcExportCatalog) { catalogEl.textContent = 'Export niet beschikbaar (Room Clone niet geladen).'; _catalogMsgUntil = Date.now() + 3000; return; }
      const result = window.__ghl_rcExportCatalog();
      catalogEl.textContent = result && result.ok
        ? 'Geopend in nieuw tabblad: ' + result.count + ' offer(s) — Ctrl+S om op te slaan.'
        : (result && result.blocked ? 'Popup geblokkeerd — sta pop-ups toe voor deze site.' : 'Niets te exporteren — scan de catalogus eerst.');
      _catalogMsgUntil = Date.now() + 3000;
    });

    const spacer = document.createElement('div');
    spacer.className = 'ghl-rail-spacer';
    rail.appendChild(spacer);

    function setCategory(id) {
      activeCategory = id;
      Object.keys(railIconEls).forEach(function(k) {
        railIconEls[k].classList.toggle('active', k === id);
        contentEls[k].classList.toggle('active', k === id);
      });
    }
    setCategory(activeCategory);

    function setOpen(open) {
      panelEl.classList.toggle('open', open);
      if (open && window.__ghk_bringToFront) window.__ghk_bringToFront(panelEl);
    }

    panelEl.addEventListener('mousedown', function() {
      if (window.__ghk_bringToFront) window.__ghk_bringToFront(panelEl);
    });

    let dragging = false, dragOx = 0, dragOy = 0;
    rail.addEventListener('mousedown', function(e) {
      if (e.target.closest('.ghl-rail-icon')) return;
      const r = panelEl.getBoundingClientRect();
      panelEl.style.left = r.left + 'px';
      panelEl.style.top = r.top + 'px';
      panelEl.style.transform = 'none';
      dragging = true;
      dragOx = e.clientX - r.left;
      dragOy = e.clientY - r.top;
    });
    document.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      panelEl.style.left = (e.clientX - dragOx) + 'px';
      panelEl.style.top = (e.clientY - dragOy) + 'px';
    });
    document.addEventListener('mouseup', function() { dragging = false; });

    const hubClose = document.createElement('div');
    hubClose.className = 'ghl-hub-close';
    hubClose.innerHTML = '&times;';
    hubClose.title = 'Close';
    hubClose.addEventListener('click', function(e) { e.stopPropagation(); setOpen(false); });
    panelEl.appendChild(hubClose);

    window.Gheloo = {
      open: function() { setOpen(true); },
      close: function() { setOpen(false); },
      toggle: function() { setOpen(!panelEl.classList.contains('open')); },
      showCategory: function(id) { if (railIconEls[id]) setCategory(id); },
      setBadge: function(rowId, value) {
        const r = rowEls[rowId];
        if (!r) return;
        if (value) { r.badge.textContent = value; r.badge.classList.add('show'); }
        else { r.badge.classList.remove('show'); }
      },
      setActive: function(rowId, active) {
        const r = rowEls[rowId];
        if (!r) return;
        r.row.classList.toggle('active', !!active);
      },
      setStatus: function(color, url) {
        renderProxyStatus(color, url);
      },
    };

    if (window._ws && window._ws.readyState === 1) window.Gheloo.setStatus('green', window._ws.url);
    else if (window._ws_worker_url) window.Gheloo.setStatus('green', window._ws_worker_url);

    const fpsDropdown = document.createElement('div');
    fpsDropdown.className = 'ghl-fps-dropdown';
    fpsDropdown.innerHTML = FPS_CAP_OPTIONS.map(function(fps) {
      const label = fps ? fps + ' FPS' : 'Unlimited';
      return '<div class="ghl-fps-opt' + (fps === _fpsCap ? ' active' : '') + '" data-fps="' + fps + '">' + label + '</div>';
    }).join('');
    rowEls['fps'].row.insertAdjacentElement('afterend', fpsDropdown);

    if (window.__ghk_setFpsCap) window.__ghk_setFpsCap(_fpsCap);
    if (_fpsOverlayOn) {
      fpsOverlay.classList.add('show');
      window.Gheloo.setActive('fps', true);
    }
    window.__ghk_fpsOverlayOn = _fpsOverlayOn;
    if (window.__ghk_updatePillsWrapPos) window.__ghk_updatePillsWrapPos();
    _updateFpsSubtitle();

    fpsDropdown.querySelectorAll('.ghl-fps-opt').forEach(function(opt) {
      opt.addEventListener('click', function(e) {
        e.stopPropagation();
        const fps = parseInt(opt.dataset.fps, 10);
        if (window.__ghk_setFpsCap) window.__ghk_setFpsCap(fps);
        fpsDropdown.querySelectorAll('.ghl-fps-opt').forEach(function(o) { o.classList.toggle('active', o === opt); });
        fpsDropdown.classList.remove('open');
        _fpsCap = fps;
        _fpsCapLabel = fps ? fps + ' FPS' : 'Unlimited';
        _updateFpsSubtitle();
        _saveFpsSettings();
      });
    });

    rowEls['fps'].badge.style.cursor = 'pointer';
    rowEls['fps'].badge.addEventListener('click', function(e) {
      e.stopPropagation();
      fpsDropdown.classList.toggle('open');
    });

    document.addEventListener('click', function(e) {
      if (!fpsDropdown.classList.contains('open')) return;
      if (e.composedPath().includes(rowEls['fps'].badge) || e.composedPath().includes(fpsDropdown)) return;
      fpsDropdown.classList.remove('open');
    });

    const pingDropdown = document.createElement('div');
    pingDropdown.className = 'ghl-fps-dropdown';
    pingDropdown.innerHTML = PING_INTERVAL_OPTIONS.map(function(ms) {
      return '<div class="ghl-fps-opt' + (ms === _pingIntervalMs ? ' active' : '') + '" data-interval="' + ms + '">' + ms + 'ms</div>';
    }).join('');
    rowEls['ping'].row.insertAdjacentElement('afterend', pingDropdown);

    window.__ghk_pingEnabled = _pingOn;
    window.__ghk_pingIntervalMs = _pingIntervalMs;
    window.__ghk_pingOverlayOn = _pingOn;
    if (_pingOn) {
      pingOverlay.classList.add('show');
      window.Gheloo.setActive('ping', true);
    }
    if (window.__ghk_updatePillsWrapPos) window.__ghk_updatePillsWrapPos();
    _updatePingSubtitle();

    pingDropdown.querySelectorAll('.ghl-fps-opt').forEach(function(opt) {
      opt.addEventListener('click', function(e) {
        e.stopPropagation();
        const ms = parseInt(opt.dataset.interval, 10);
        window.__ghk_pingIntervalMs = ms;
        pingDropdown.querySelectorAll('.ghl-fps-opt').forEach(function(o) { o.classList.toggle('active', o === opt); });
        pingDropdown.classList.remove('open');
        _pingIntervalMs = ms;
        _pingIntervalLabel = ms + 'ms';
        _updatePingSubtitle();
        _savePingSettings();
      });
    });

    rowEls['ping'].badge.style.cursor = 'pointer';
    rowEls['ping'].badge.addEventListener('click', function(e) {
      e.stopPropagation();
      pingDropdown.classList.toggle('open');
    });

    document.addEventListener('click', function(e) {
      if (!pingDropdown.classList.contains('open')) return;
      if (e.composedPath().includes(rowEls['ping'].badge) || e.composedPath().includes(pingDropdown)) return;
      pingDropdown.classList.remove('open');
    });

    // Live ms readout on the row's badge and the top-left overlay chip — window.onLatency
    // is multitab.js's push-update hook, fires null when Ping toggles off.
    if (window.onLatency) {
      window.onLatency(function(ms) {
        window.Gheloo.setBadge('ping', ms != null ? ms + 'ms' : '');
        pingOverlay.textContent = (ms != null ? ms : '—') + ' ms';
      });
    }

    let _fpsFrames = 0, _fpsLast = performance.now();
    function _fpsTick(now) {
      _fpsFrames++;
      if (now - _fpsLast >= 1000) {
        window.Gheloo.setBadge('fps', String(_fpsFrames));
        fpsOverlay.textContent = _fpsFrames + ' FPS';
        _fpsFrames = 0;
        _fpsLast = now;
      }
      requestAnimationFrame(_fpsTick);
    }
    requestAnimationFrame(_fpsTick);

    // Toggleable: our modifications to the native page chrome, vs. the hotel's default look.
    const _chatAllowedByPlatform = !!window._chatInToolbarEnabled;
    const DESIGN_STORAGE_KEY = '__ghk_design_settings';
    let _defaultDesignOn = false;
    try {
      const _savedDesign = JSON.parse(localStorage.getItem(DESIGN_STORAGE_KEY) || '{}');
      if (_savedDesign.on) _defaultDesignOn = true;
    } catch(_) {}

    function _saveDesignSettings() {
      try { localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify({ on: _defaultDesignOn })); } catch(_) {}
    }

    // Always-on, not tied to Default Leet Design: remove room-enter ad banners, and the
    // GPT/DFP ad-slot popup (div[id^="ad-"] or div[id*="gpt-ad"], shown inside a Bootstrap
    // modal with its own close button). Used to also require a nested google_ads_iframe
    // before removing — but an ad slot that's empty/blocked/still loading never gets one,
    // so the empty modal sat there forever. The div id itself (Google Publisher Tag's own
    // reserved naming convention) combined with sitting inside a .modal is signal enough on
    // its own. Removing just .modal-content (as an earlier version of this did) leaves
    // Bootstrap's own .modal-backdrop overlay and body.modal-open behind — since we deleted
    // the modal out from under Bootstrap instead of calling its hide(), it never gets a
    // chance to clean those up itself. That backdrop is a full-screen fixed-position layer,
    // which is exactly what a grey, unclickable page looks like. So this takes the whole
    // .modal wrapper (not just modal-content), then strips any now-orphaned backdrop/body
    // state — but only once no other genuine modal is still open, so a real modal stacked
    // underneath doesn't lose its backdrop too.
    function _removeRoomAd() {
      document.querySelectorAll('.roomenterad-habblet-container').forEach(function(el) { el.remove(); });
      document.querySelectorAll('div[id^="ad-"], div[id*="gpt-ad"]').forEach(function(el) {
        (el.closest('.modal') || el.closest('.modal-content') || el).remove();
      });
      // Known AdSense slots (ca-pub-1001833795878171) that don't use the GPT id/class
      // naming above — plain <ins class="adsbygoogle"> tagged by their own ad-slot id
      // instead, wrapped in a plain d-flex container with no ad-specific id/class of its own.
      document.querySelectorAll('ins.adsbygoogle[data-ad-slot="1094026134"], ins.adsbygoogle[data-ad-slot="8780944465"]').forEach(function(el) {
        (el.closest('.w-100.h-100') || el).remove();
      });
      // Top/bottom fixed ad banners (position-fixed, top-0 or bottom-0, 90px tall bar with
      // its own "Close advertisement" button) — anchor on the aria-label since it's the one
      // stable marker shared by both the top and bottom variant, rather than guessing at
      // z-index/height values that could change.
      document.querySelectorAll('button[aria-label="Close advertisement"]').forEach(function(btn) {
        (btn.closest('.position-fixed') || btn.parentElement || btn).remove();
      });
      if (!document.querySelector('.modal.show')) {
        document.querySelectorAll('.modal-backdrop').forEach(function(bd) { bd.remove(); });
        document.body.classList.remove('modal-open');
        document.body.style.removeProperty('overflow');
        document.body.style.removeProperty('padding-right');
      }
    }
    new MutationObserver(_removeRoomAd).observe(document.body, { childList: true, subtree: true });
    _removeRoomAd();

    function _applyHotelBtnHide() {
      document.querySelectorAll('.hotel-button').forEach(el => {
        const header = el.closest('header') || el;
        if (_defaultDesignOn) header.style.removeProperty('display');
        else header.style.setProperty('display', 'none', 'important');
      });
    }
    new MutationObserver(_applyHotelBtnHide).observe(document.body, { childList: true, subtree: true });
    _applyHotelBtnHide();

    function _applyFriendBtnHide() {
      const fb = document.querySelector('.toolbar-friend-bar-button');
      if (!fb) return;
      if (_defaultDesignOn) fb.style.removeProperty('display');
      else fb.style.setProperty('display', 'none', 'important');
    }
    new MutationObserver(_applyFriendBtnHide).observe(document.body, { childList: true, subtree: true });
    _applyFriendBtnHide();

    function _applyFriendSearchHide() {
      document.querySelectorAll('.icon-friendsearch').forEach(el => {
        if (_defaultDesignOn) el.style.removeProperty('display');
        else el.style.setProperty('display', 'none', 'important');
      });
    }
    let _friendSearchOrigParent = null, _friendSearchOrigNext = null;
    function _repositionFriendSearch() {
      const icon = document.querySelector('.icon-friendsearch');
      const container = document.getElementById('toolbar-friend-bar-container');
      if (!icon) return;
      if (_defaultDesignOn) {
        if (_friendSearchOrigParent && icon.parentNode !== _friendSearchOrigParent) {
          _friendSearchOrigParent.insertBefore(icon, _friendSearchOrigNext);
        }
        return;
      }
      if (!container) return;
      const outer = container.parentNode;
      if (outer && icon.parentNode !== outer) {
        if (!_friendSearchOrigParent) {
          _friendSearchOrigParent = icon.parentNode;
          _friendSearchOrigNext = icon.nextSibling;
        }
        outer.insertBefore(icon, container);
      }
    }
    new MutationObserver(_repositionFriendSearch).observe(document.body, { childList: true, subtree: true });
    _repositionFriendSearch();
    new MutationObserver(_applyFriendSearchHide).observe(document.body, { childList: true, subtree: true });
    _applyFriendSearchHide();

    function _applyFeatureStyles() {
      if (!window._fStyle) return;
      const enable = !_defaultDesignOn;
      ['hideArrows', 'customFriendList'].forEach(function(key) {
        const el = window._fStyle[key];
        if (!el) return;
        if (enable && !el.parentNode) document.head.appendChild(el);
        else if (!enable && el.parentNode) el.parentNode.removeChild(el);
      });
      const wantChat = enable && _chatAllowedByPlatform;
      window._chatInToolbarEnabled = wantChat;
      const chatEl = window._fStyle.chatInToolbar;
      if (chatEl) {
        if (wantChat && !chatEl.parentNode) document.head.appendChild(chatEl);
        else if (!wantChat && chatEl.parentNode) chatEl.parentNode.removeChild(chatEl);
      }
      const chatInput = document.querySelector('.nitro-room-chatinput-component');
      if (chatInput) {
        if (wantChat) {
          if (window._applyChatFix) window._applyChatFix(chatInput);
        } else {
          ['position', 'bottom', 'left', 'width', 'pointer-events', 'z-index'].forEach(function(prop) {
            chatInput.style.removeProperty(prop);
          });
        }
      }
    }

    function toggleDefaultDesign() {
      _defaultDesignOn = !_defaultDesignOn;
      window.Gheloo.setActive('defaultdesign', _defaultDesignOn);
      _saveDesignSettings();
      _applyHotelBtnHide();
      _applyFriendBtnHide();
      _repositionFriendSearch();
      _applyFriendSearchHide();
      _applyFeatureStyles();
    }
    window.Gheloo.setActive('defaultdesign', _defaultDesignOn);
    _applyFeatureStyles();

    const DARKMODE_STORAGE_KEY = '__ghk_darkmode_settings';
    let _darkModeOn = true;
    try {
      const _savedDark = JSON.parse(localStorage.getItem(DARKMODE_STORAGE_KEY) || '{}');
      if (_savedDark.on === false) _darkModeOn = false;
    } catch(_) {}

    function _saveDarkModeSettings() {
      try { localStorage.setItem(DARKMODE_STORAGE_KEY, JSON.stringify({ on: _darkModeOn })); } catch(_) {}
    }

    function _applyDarkMode() {
      if (!window._fStyle) return;
      const el = window._fStyle.darkLayout;
      if (!el) return;
      if (_darkModeOn && !el.parentNode) document.head.appendChild(el);
      else if (!_darkModeOn && el.parentNode) el.parentNode.removeChild(el);
    }

    function toggleDarkMode() {
      _darkModeOn = !_darkModeOn;
      window.Gheloo.setActive('darkmode', _darkModeOn);
      _saveDarkModeSettings();
      _applyDarkMode();
    }
    window.Gheloo.setActive('darkmode', _darkModeOn);
    _applyDarkMode();

    const ANTISPIN_STORAGE_KEY = '__ghk_antispin_settings';
    let _antiSpinOn = false;
    try {
      const _savedAntiSpin = JSON.parse(localStorage.getItem(ANTISPIN_STORAGE_KEY) || '{}');
      if (_savedAntiSpin.on) _antiSpinOn = true;
    } catch(_) {}

    function _saveAntiSpinSettings() {
      try { localStorage.setItem(ANTISPIN_STORAGE_KEY, JSON.stringify({ on: _antiSpinOn })); } catch(_) {}
    }

    function _applyAntiSpin() {
      if (!window._blockOutgoingFilters) return;
      const id = _getPktId('LookTo');
      if (id === null) return;
      if (_antiSpinOn) window._blockOutgoingFilters[id] = true;
      else delete window._blockOutgoingFilters[id];
    }

    function toggleAntiSpin() {
      _antiSpinOn = !_antiSpinOn;
      window.Gheloo.setActive('antispin', _antiSpinOn);
      _saveAntiSpinSettings();
      _applyAntiSpin();
    }
    window.Gheloo.setActive('antispin', _antiSpinOn);
    _applyAntiSpin();

    // Block Right Click — confirmed working (user tested by pasting it directly into
    // console): a capture-phase contextmenu listener that prevents/stops it outright.
    // Blocks the native menu itself, so Inspect/Save image as/Copy image go with it.
    const RIGHTCLICK_STORAGE_KEY = '__ghk_rightclick_settings';
    let _rightClickBlockOn = false;
    try {
      const _savedRightClick = JSON.parse(localStorage.getItem(RIGHTCLICK_STORAGE_KEY) || '{}');
      if (_savedRightClick.on) _rightClickBlockOn = true;
    } catch(_) {}

    function _rightClickBlocker(e) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
    function _applyRightClickBlock() {
      document.removeEventListener('contextmenu', _rightClickBlocker, true);
      if (_rightClickBlockOn) document.addEventListener('contextmenu', _rightClickBlocker, true);
    }
    function toggleRightClick() {
      _rightClickBlockOn = !_rightClickBlockOn;
      window.Gheloo.setActive('rightclick', _rightClickBlockOn);
      try { localStorage.setItem(RIGHTCLICK_STORAGE_KEY, JSON.stringify({ on: _rightClickBlockOn })); } catch(_) {}
      _applyRightClickBlock();
    }
    window.Gheloo.setActive('rightclick', _rightClickBlockOn);
    _applyRightClickBlock();

    const HIDETYPING_STORAGE_KEY = '__ghk_hidetyping_settings';
    let _hideTypingOn = false;
    try {
      const _savedHideTyping = JSON.parse(localStorage.getItem(HIDETYPING_STORAGE_KEY) || '{}');
      if (_savedHideTyping.on) _hideTypingOn = true;
    } catch(_) {}

    function _saveHideTypingSettings() {
      try { localStorage.setItem(HIDETYPING_STORAGE_KEY, JSON.stringify({ on: _hideTypingOn })); } catch(_) {}
    }

    function _applyHideTyping() {
      // Blocking the incoming UserTyping broadcast about yourself only ever hid the
      // bubble from your OWN client (and stopped working once the client started
      // rendering it optimistically the instant you type, before any server round
      // trip). Blocking the outgoing StartTyping packet instead stops the server from
      // ever learning you're typing, so nobody in the room sees the bubble at all.
      if (!window._blockOutgoingFilters) return;
      const id = _getPktId('StartTyping');
      if (id === null) return;
      if (_hideTypingOn) window._blockOutgoingFilters[id] = true;
      else delete window._blockOutgoingFilters[id];
    }

    function toggleHideTyping() {
      _hideTypingOn = !_hideTypingOn;
      window.Gheloo.setActive('hidetyping', _hideTypingOn);
      _saveHideTypingSettings();
      _applyHideTyping();
    }
    window.Gheloo.setActive('hidetyping', _hideTypingOn);
    _applyHideTyping();

    const REJOIN_STORAGE_KEY = '__ghk_rejoin_settings';
    let _rejoinOn = false;
    try {
      const _savedRejoin = JSON.parse(localStorage.getItem(REJOIN_STORAGE_KEY) || '{}');
      if (_savedRejoin.on) _rejoinOn = true;
    } catch(_) {}

    function _saveRejoinSettings() {
      try { localStorage.setItem(REJOIN_STORAGE_KEY, JSON.stringify({ on: _rejoinOn })); } catch(_) {}
    }

    function _applyRejoinCommand() {
      window._rejoinCommandEnabled = _rejoinOn;
    }

    function toggleRejoinCommand() {
      _rejoinOn = !_rejoinOn;
      window.Gheloo.setActive('rejoin', _rejoinOn);
      _saveRejoinSettings();
      _applyRejoinCommand();
    }
    window.Gheloo.setActive('rejoin', _rejoinOn);
    _applyRejoinCommand();

    const STEAL_STORAGE_KEY = '__ghk_steal_settings';
    let _stealOn = false;
    try {
      const _savedSteal = JSON.parse(localStorage.getItem(STEAL_STORAGE_KEY) || '{}');
      if (_savedSteal.on) _stealOn = true;
    } catch(_) {}

    function _saveStealSettings() {
      try { localStorage.setItem(STEAL_STORAGE_KEY, JSON.stringify({ on: _stealOn })); } catch(_) {}
    }

    function _applyStealCommand() {
      window._stealCommandEnabled = _stealOn;
    }

    const ROOMHISTORYICON_STORAGE_KEY = '__ghk_roomhistory_icon_settings';
    let _roomHistoryIconOn = true;
    try {
      const _savedRoomHistoryIcon = JSON.parse(localStorage.getItem(ROOMHISTORYICON_STORAGE_KEY) || '{}');
      if (_savedRoomHistoryIcon.on === false) _roomHistoryIconOn = false;
    } catch(_) {}

    function _updateRoomHistoryIconSubtitle(on) {
      const row = rowEls['roomhistoryicon'];
      if (row) row.row.querySelector('.ghl-row-subtitle').textContent = on ? 'Turn Room History off' : 'Turn Room History on';
    }
    function toggleRoomHistoryIcon() {
      _roomHistoryIconOn = !_roomHistoryIconOn;
      window.Gheloo.setActive('roomhistoryicon', _roomHistoryIconOn);
      _updateRoomHistoryIconSubtitle(_roomHistoryIconOn);
      try { localStorage.setItem(ROOMHISTORYICON_STORAGE_KEY, JSON.stringify({ on: _roomHistoryIconOn })); } catch(_) {}
      if (window.__rh_setIconEnabled) window.__rh_setIconEnabled(_roomHistoryIconOn);
    }
    window.Gheloo.setActive('roomhistoryicon', _roomHistoryIconOn);
    _updateRoomHistoryIconSubtitle(_roomHistoryIconOn);

    // Marktplaats Alerts owns its own on/off state (extensions/marktplaats-alerts.js) —
    // this row just mirrors and drives it, no separate storage key here.
    function _updateMarktplaatsAlertsSubtitle(on) {
      const row = rowEls['marktplaatsalertstoggle'];
      if (row) row.row.querySelector('.ghl-row-subtitle').textContent = on ? 'Turn Marktplaats alerts off' : 'Turn Marktplaats alerts on';
    }
    function toggleMarktplaatsAlerts() {
      const next = !(window.__mpa_isEnabled && window.__mpa_isEnabled());
      if (window.__mpa_setEnabled) window.__mpa_setEnabled(next);
      window.Gheloo.setActive('marktplaatsalertstoggle', next);
      _updateMarktplaatsAlertsSubtitle(next);
    }
    const _mpaInitialOn = !!(window.__mpa_isEnabled && window.__mpa_isEnabled());
    window.Gheloo.setActive('marktplaatsalertstoggle', _mpaInitialOn);
    _updateMarktplaatsAlertsSubtitle(_mpaInitialOn);

    function toggleStealCommand() {
      _stealOn = !_stealOn;
      window.Gheloo.setActive('steal', _stealOn);
      _saveStealSettings();
      _applyStealCommand();
    }
    window.Gheloo.setActive('steal', _stealOn);
    _applyStealCommand();

    // Avatar Compass — floating 8-direction dial. Clicking a direction sends
    // LookTo to a tile just past your own position in that direction, which
    // turns your avatar to face it without walking anywhere.
    const COMPASS_STORAGE_KEY = '__ghk_avatarcompass_settings';
    const COMPASS_POS_KEY = '__ghk_avatarcompass_pos';
    let _compassOn = false;
    try {
      const _savedCompass = JSON.parse(localStorage.getItem(COMPASS_STORAGE_KEY) || '{}');
      if (_savedCompass.on) _compassOn = true;
    } catch(_) {}

    const COMPASS_DIRS = [
      { dx: 0,  dy: -1, label: '↑', title: 'North',     area: 'n'  },
      { dx: 1,  dy: -1, label: '↗', title: 'Northeast', area: 'ne' },
      { dx: 1,  dy: 0,  label: '→', title: 'East',      area: 'e'  },
      { dx: 1,  dy: 1,  label: '↘', title: 'Southeast', area: 'se' },
      { dx: 0,  dy: 1,  label: '↓', title: 'South',     area: 's'  },
      { dx: -1, dy: 1,  label: '↙', title: 'Southwest', area: 'sw' },
      { dx: -1, dy: 0,  label: '←', title: 'West',      area: 'w'  },
      { dx: -1, dy: -1, label: '↖', title: 'Northwest', area: 'nw' },
    ];

    const compassEl = document.createElement('div');
    compassEl.id = '__ghk_compass';
    compassEl.style.cssText = 'position:fixed !important; right:16px; bottom:120px; z-index:2147483000; display:none; width:108px !important; height:108px !important; box-sizing:border-box !important; padding:6px !important; margin:0 !important; grid-template-columns:repeat(3,1fr) !important; grid-template-rows:repeat(3,1fr) !important; gap:3px !important; background:#0A0B10; border:1px solid #23252f; border-radius:12px; box-shadow:0 8px 22px rgba(0,0,0,.5); grid-template-areas:"nw n ne" "w h e" "sw s se" !important;';

    const compassHandle = document.createElement('div');
    compassHandle.style.cssText = 'grid-area:h; width:100%; height:100%; box-sizing:border-box; display:flex; align-items:center; justify-content:center; color:#5c5e6b; cursor:move; font-size:14px; user-select:none;';
    compassHandle.textContent = '✥';
    compassHandle.title = 'Drag';
    compassEl.appendChild(compassHandle);

    COMPASS_DIRS.forEach(function(d) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.title = 'Turn ' + d.title;
      btn.textContent = d.label;
      btn.style.cssText = 'grid-area:' + d.area + '; appearance:none; -webkit-appearance:none; width:100% !important; height:100% !important; min-width:0 !important; min-height:0 !important; box-sizing:border-box !important; margin:0 !important; padding:0 !important; border:none !important; border-radius:8px; background:#1c1e2a; color:#82849a; font-size:14px; line-height:1; cursor:pointer;';
      btn.addEventListener('mouseenter', function() { btn.style.background = 'rgba(108,124,255,0.16)'; btn.style.color = '#A6B0FF'; });
      btn.addEventListener('mouseleave', function() { btn.style.background = '#1c1e2a'; btn.style.color = '#82849a'; });
      btn.addEventListener('mousedown', function(e) { e.stopPropagation(); });
      btn.addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        if (_selfRoomIndex === null) return;
        const u = window.Room && window.Room.users && window.Room.users[_selfRoomIndex];
        if (!u || typeof u.x !== 'number' || typeof u.y !== 'number') return;
        const id = _getPktId('LookTo');
        if (id === null) return;
        window.sendPacket('OUT', id, '{i:' + (u.x + d.dx) + '}{i:' + (u.y + d.dy) + '}');
      });
      compassEl.appendChild(btn);
    });
    document.body.appendChild(compassEl);
    window.__ghk_makeDraggable(compassEl, compassHandle, COMPASS_POS_KEY, function() { return false; });

    function _saveCompassSettings() {
      try { localStorage.setItem(COMPASS_STORAGE_KEY, JSON.stringify({ on: _compassOn })); } catch(_) {}
    }

    // Only shown while your own infostand is open. Clicking any avatar sends
    // an OUT GetSelectedBadges with that avatar's user id — {out:GetSelectedBadges}{i:userId} —
    // if it matches your own id (meSelfId, tracked by the Me card above), that's your own
    // avatar being clicked.
    let _compassOwnProfileOpen = false;

    function _applyCompass() {
      compassEl.style.display = (_compassOn && _compassOwnProfileOpen) ? 'grid' : 'none';
    }

    window.onPacket('GetSelectedBadges', function(p) {
      if (!p.raw || !window.makeReader) return;
      const r = window.makeReader(p.raw);
      if (!r) return;
      const targetId = r.int();
      _compassOwnProfileOpen = meSelfId !== null && targetId === meSelfId;
      _applyCompass();
    });

    // The GetSelectedBadges packet only tells us an infostand OPENED, not when it
    // closes (click away, X button, click a different avatar). So watch the DOM:
    // whenever anything changes, check if the infostand container is still there —
    // if it's gone, the compass shouldn't be either. Debounced to one check per frame.
    function _infostandStillOpen() {
      const t = document.querySelector('.d-flex.flex-column.gap-2.align-items-end.nitro-infostand-container')
        || document.querySelector('.nitro-infostand-container');
      if (!t) return false;
      if (t.querySelector('.furni-image') || t.querySelector('.btn-buy')) return false;
      return true;
    }
    if (document.body && typeof MutationObserver !== 'undefined') {
      let _compassObsScheduled = false;
      const _compassObs = new MutationObserver(function() {
        if (_compassObsScheduled) return;
        _compassObsScheduled = true;
        requestAnimationFrame(function() {
          _compassObsScheduled = false;
          if (_compassOwnProfileOpen && !_infostandStillOpen()) {
            _compassOwnProfileOpen = false;
            _applyCompass();
          }
        });
      });
      _compassObs.observe(document.body, { childList: true, subtree: true });
    }

    function toggleCompass() {
      _compassOn = !_compassOn;
      window.Gheloo.setActive('avatarcompass', _compassOn);
      _saveCompassSettings();
      _applyCompass();
    }
    window.Gheloo.setActive('avatarcompass', _compassOn);
    _applyCompass();
  }

  function buildToolbarIcon() {
    let injected = false;

    function tryInject() {
      if (injected || document.getElementById('tm-uext-icon')) { injected = true; return; }
      const toolbar = document.querySelector('.toolbar-navigation');
      if (!toolbar) return;
      const row = toolbar.querySelector('.d-flex.gap-2.align-items-center');
      if (!row) return;

      // Gheloo logo — takes over the tm-uext-icon toolbar slot, opens the Gheloo panel.
      const icon2 = document.createElement('div');
      icon2.id = 'tm-uext-icon';
      Object.assign(icon2.style, {
        width:              '40px',
        height:             '40px',
        cursor:             'pointer',
        marginLeft:         '4px',
        transition:         'transform 0.15s, filter 0.15s',
        flexShrink:         '0',
        filter:             'none',
        display:            'flex',
        alignItems:         'center',
        justifyContent:     'center',
      });
      icon2.title = 'Gheloo';
      icon2.innerHTML = '<svg width="38" height="38" viewBox="0 0 240 240"><circle cx="120" cy="120" r="118" fill="#0A0B10"/><circle cx="120" cy="120" r="90" fill="none" stroke="#6C7CFF" stroke-width="12"/><text x="120" y="152" text-anchor="middle" font-size="96" font-weight="700" fill="#6C7CFF" font-family="inherit">G</text></svg>';
      icon2.addEventListener('mouseenter', () => {
        icon2.style.transform = 'translate(-1px, -1px)';
        icon2.style.filter    = 'drop-shadow(1px 1px 2px rgba(0,0,0,0.6))';
      });
      icon2.addEventListener('mouseleave', () => {
        icon2.style.transform = 'translate(0, 0)';
        icon2.style.filter    = 'none';
      });
      icon2.addEventListener('click', () => {
        icon2.style.transform = 'translate(0, 0)';
        icon2.style.filter    = 'none';
        setTimeout(() => {
          icon2.style.transform = 'translate(-4px, -4px)';
          icon2.style.filter    = 'drop-shadow(4px 4px 4px rgba(0,0,0,0.8))';
        }, 120);
        if (window.Gheloo) window.Gheloo.toggle();
      });
      row.appendChild(icon2);

      injected = true;
    }

    const iv = setInterval(() => { tryInject(); if (injected) clearInterval(iv); }, 500);
  }

  // Bring-to-front on click: clicking any panel raises it above the others.
  (function() {
    var _IDS = ['__hbl','__snd','__mac','__rc','__fb','__mb','__mpa_panel','__mimic','__tst','__ext','__fh_panel','__rclone','__photolib','__ins_panel','__am_panel','__userdb','__udb_nc','__rv_panel','__wc_panel','__bg','__pm_panel','__ws_panel'];
    var _gameStack = []; // back = bottom, front = top

    // Find the stacking host for a game panel.
    // Strategy 1: walk up from card (inclusive) for first element with position!=static AND z-index!=auto.
    // Strategy 2 (fallback): walk up for first element with position!=static (game may set z-index inline later).
    function _gamePanelRoot(card) {
      var cur = card;
      while (cur && cur !== document.body) {
        var cs = window.getComputedStyle(cur);
        if (cs.position !== 'static' && cs.zIndex !== 'auto') return cur;
        cur = cur.parentElement;
      }
      cur = card;
      while (cur && cur !== document.body) {
        if (window.getComputedStyle(cur).position !== 'static') return cur;
        cur = cur.parentElement;
      }
      return card;
    }

    function _bringGameToFront(root) {
      var idx = _gameStack.indexOf(root);
      if (idx !== -1) _gameStack.splice(idx, 1);
      _gameStack.push(root);
      // 1000+ keeps game panels above toolbars (z≈70-80) but below "always on top" panels (999999)
      for (var j = 0; j < _gameStack.length; j++) _gameStack[j].style.zIndex = 1000 + j;
    }
    // Exposed so Gheloo's own panel (inside Shadow DOM, unreachable by the ID lookup
    // below) can join the same shared stack instead of being permanently pinned above it.
    window.__ghk_bringToFront = _bringGameToFront;

    document.addEventListener('mousedown', function(e) {
      // Extension panels — matched by known ID on outermost wrapper
      for (var i = 0; i < _IDS.length; i++) {
        var p = document.getElementById(_IDS[i]);
        if (p && p.contains(e.target)) {
          // Only bring-to-front when "always on top" is off (z < 999000).
          var curZ = parseInt(p.style.zIndex) || 0;
          if (curZ < 999000) _bringGameToFront(p);
          return;
        }
      }

      // Game panels — find closest .nitro-card then resolve its stacking host
      if (!e.target.closest) return;
      var card = e.target.closest('.nitro-card');
      if (!card) return;
      var root = _gamePanelRoot(card);
      for (var k = 0; k < _IDS.length; k++) {
        if (root.id === _IDS[k]) return;
      }
      _bringGameToFront(root);
    }, true);
  })();


  // Auto-confirm store purchase — rAF loop after first Koop click, no body reference needed
  document.addEventListener('click', function(e) {
    var btn = e.target.closest && e.target.closest('.btn-success.flex-fill');
    if (!btn || btn.textContent.trim() !== 'Koop') return;
    if (btn.closest('.nitro-catalog-confirm')) return;
    var ticks = 0;
    function check() {
      if (++ticks > 60) return;
      var wins = document.querySelectorAll('.draggable-window');
      for (var i = 0; i < wins.length; i++) {
        var w = wins[i];
        if (w.style.visibility !== 'visible') continue;
        var koop = w.querySelector('.nitro-catalog-confirm .btn-success.flex-fill');
        if (koop && koop.textContent.trim() === 'Koop') {
          w.style.setProperty('visibility', 'hidden', 'important');
          koop.click();
          return;
        }
      }
      requestAnimationFrame(check);
    }
    requestAnimationFrame(check);
  }, true);

  function init() { window.__ghk_ready(function() { buildGhelooPanel(); buildToolbarIcon(); }); }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
