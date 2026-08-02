(function() {
  function buildFriendBotPanel() {
    const STORAGE_KEY = '__fb_added_names';
    let _fbAddedList = [];
    try { _fbAddedList = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch(_) {}
    const _fbAdded = new Set(_fbAddedList);
    function _fbSave() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_fbAddedList)); } catch(_) {} }

    let _fbEnabled = false;

    const style = document.createElement('style');
    style.textContent = [
      '#__fb{position:fixed;top:16px;right:16px;width:330px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__fb *{box-sizing:border-box}',
      '.__fb_card{display:flex;flex-direction:column;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb}',
      '.__fb_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__fb_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}',
      '.__fb_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__fb_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__fb_close:hover{color:#eceefb}',
      '#__fb_main{height:340px;box-sizing:border-box;overflow:hidden;display:flex;flex-direction:column;padding:0}',
      '#__fb_toolbar{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0}',
      '.__fb_count_lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#5c5e6b}',
      '#__fb_clear_btn{background:#1c1e2a;color:#eceefb;border:1px solid #23252f;border-radius:6px;font-size:9px;font-weight:600;padding:2px 8px;cursor:pointer}',
      '#__fb_clear_btn:hover{background:rgba(255,255,255,0.06)}',
      '#__fb_list{flex:1;overflow-y:auto;margin:6px 8px;border:1px solid #23252f;border-radius:8px;overflow:hidden}',
      '#__fb_list .__fb_row{padding:5px 8px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:11px;font-family:monospace;color:#eceefb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '#__fb_list .__fb_row:last-child{border-bottom:none}',
      '#__fb_bottom{padding:8px 10px;flex-shrink:0}',
      '#__fb_startstop{width:100%;font-size:11px;font-weight:600;padding:7px 10px;border-radius:8px;border:none;cursor:pointer;background:#A6B0FF;color:#0A0B10}',
      '#__fb_startstop:hover{filter:brightness(1.08)}',
    ].join('');
    document.head.appendChild(style);

    const fb = document.createElement('div');
    fb.id = '__fb';
    fb.innerHTML =
      '<div class="__fb_card">' +
        '<div class="__fb_hdr" id="__fb_hdr">' +
          '<span class="__fb_eyebrow">Gheloo</span>' +
          '<span class="__fb_title">Friend Adder</span>' +
          '<span class="__fb_close" id="__fb_close">&times;</span>' +
        '</div>' +
        '<div id="__fb_main">' +
          '<div id="__fb_toolbar">' +
            '<span class="__fb_count_lbl">Added: <span id="__fb_count">0</span></span>' +
            '<button id="__fb_clear_btn">Clear</button>' +
          '</div>' +
          '<div id="__fb_list"></div>' +
          '<div id="__fb_bottom">' +
            '<button id="__fb_startstop">Start</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(fb);
    fb.style.display = 'none';

    window.__ghk_makeDraggable(fb, fb.querySelector('#__fb_hdr'), '__ghk_fb_pos', e => e.target.id === '__fb_close');

    fb.querySelector('#__fb_close').addEventListener('click', ()=>{ fb.style.display='none'; });

    function _updateList() {
      const listEl = fb.querySelector('#__fb_list');
      const countEl = fb.querySelector('#__fb_count');
      if (countEl) countEl.textContent = _fbAddedList.length;
      if (!listEl) return;
      if (!_fbAddedList.length) {
        listEl.innerHTML = '<div style="padding:20px;text-align:center;font-size:11px;color:#5c5e6b">No one added yet</div>';
        return;
      }
      listEl.innerHTML = _fbAddedList.map(n => '<div class="__fb_row">' + n + '</div>').join('');
    }
    _updateList();

    fb.querySelector('#__fb_clear_btn').addEventListener('click', ()=>{
      _fbAdded.clear();
      _fbAddedList.length = 0;
      _fbSave();
      _updateList();
    });

    fb.querySelector('#__fb_startstop').addEventListener('click', function() {
      _fbEnabled = !_fbEnabled;
      this.textContent = _fbEnabled ? 'Stop' : 'Start';
    });

    // Block MessengerError{i:0}{i:3} — suppress friend request error popup
    (function _setupMessengerErrorBlock() {
      if (!window.PKT || !window.PKT.IN) return;
      for (const [id, name] of Object.entries(window.PKT.IN)) {
        if (window.shortName(name, 'IN') === 'MessengerError') {
          window._blockIncomingFilters[parseInt(id)] = function(raw) {
            try {
              const r = window.makeReader(raw);
              if (!r) return true;
              return r.int() === 0 && r.int() === 3;
            } catch(_) { return false; }
          };
          break;
        }
      }
    })();

    function _getReqFriendId() {
      if (!window.PKT || !window.PKT.OUT) return null;
      for (const [id, name] of Object.entries(window.PKT.OUT)) {
        if (window.shortName(name, 'OUT') === 'RequestFriend') return parseInt(id);
      }
      return null;
    }

    function _fbProcessRoom() {
      if (!_fbEnabled || !window.Room || !window.Room.users) return;
      const pktId = _getReqFriendId();
      if (pktId === null) return;
      const users = Object.values(window.Room.users);
      let delay = 0;
      users.forEach(u => {
        if (!u.name) return;
        if (u.type !== 1) return; // skip bots (2) and pets (4), only add users (1)
        if (u.name === window._selfName) return;
        if (_fbAdded.has(u.name)) return;
        const name = u.name;
        _fbAdded.add(name);
        setTimeout(() => {
          if (!_fbEnabled) return;
          window.sendPacket('OUT', pktId, '{s:"' + name + '"}');
          _fbAddedList.unshift(name);
          _fbSave();
          _updateList();
        }, delay);
        delay += 100;
      });
    }

    window.onPacket('Users', () => {
      if (_fbEnabled) setTimeout(_fbProcessRoom, 300);
    });

    window.onPacket('AuthenticationOK', () => {
      _fbAdded.clear();
      _fbAddedList.length = 0;
      _fbSave();
      _updateList();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(buildFriendBotPanel); }); else window.__ghk_ready(buildFriendBotPanel);
})();
