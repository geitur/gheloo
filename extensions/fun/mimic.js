(function() {
  // ---- G-Earth extension adapter ----
  function makeExtension() {
    const _cache = {};

    function _outId(name) {
      if (name in _cache) return _cache[name];
      if (!window.PKT || !window.PKT.OUT) return (_cache[name] = null);
      for (const [id, full] of Object.entries(window.PKT.OUT)) {
        if (window.shortName(full, 'OUT') === name) return (_cache[name] = parseInt(id));
      }
      return (_cache[name] = null);
    }

    function _expr(args) {
      return args.map(a => {
        if (typeof a === 'string') return '{s:"' + a.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"}';
        if (typeof a === 'number') return '{i:' + Math.trunc(a) + '}';
        return '';
      }).join('');
    }

    return {
      interceptAll(cb) {
        window.PacketStore.subscribe(p => {
          if (!p.raw || p.raw.byteLength <= 6) return;
          const gp = new window.GPacket(p.raw);
          cb({
            name: p.name,
            packet: {
              reset()       { gp.offset = 6; },
              readInt()     { return gp.readInt(); },
              readString()  { return gp.readString(); },
              readBoolean() { return gp.readBoolean(); },
            },
            block() {
              if (p.direction === 'OUT') window._pendingBlockOutgoing = true;
            },
          });
        });
      },

      sendPacket(name, ...args) {
        const id = _outId(name);
        if (id == null) { console.warn('[Mimic] unknown OUT packet:', name); return; }
        window.sendPacket('OUT', id, _expr(args));
      },
    };
  }

  // ---- MimiqManager ----
  class MimiqManager {
    constructor(extension) {
      this.extension = extension;
      this.state = 'idle';
      this.userId = -1;
      this.targetId = -1;
      this.targetIndex = -1;
      this.targetName = null;
      this.idToIndex = new Map();
      this.indexToId = new Map();
      this.idToName = new Map();
      this.idToFigure = new Map();
      this.idToGender = new Map();
      this.idToMotto = new Map();
      this.Figure = true;
      this.Motto = true;
      this.Action = true;
      this.Dance = true;
      this.Sign = true;
      this.Sit = true;
      this.Follow = false;
      this.Typing = true;
      this.Talk = true;
      this.Shout = true;
      this.Whisper = true;
      this.ButtonText = 'Start';
      this.TargetAvatarUrl = null;
      this._onUpdate = null;
      extension.interceptAll(i => this.processPacket(i));
    }

    _notify() { if (this._onUpdate) this._onUpdate(); }

    processPacket(intercept) {
      try {
        const name = intercept.name;

        if (name === 'UserObject') { this.handleUserObject(intercept); return; }
        if (name === 'RoomReady')  { this.handleRoomReady();           return; }
        if (name === 'Users')      { this.handleUsers(intercept);      return; }

        if (name === 'GetSelectedBadges' && (this.state === 'selecting' || this.state === 'idle')) {
          this.handleTargetSelection(intercept); return;
        }
        if (this.state === 'selecting' && name === 'LookTo') { intercept.block(); return; }

        if (this.state !== 'active' || this.targetIndex === -1) return;

        switch (name) {
          case 'UserUpdate': this.handleUserUpdate(intercept); break;
          case 'Expression': this.handleExpression(intercept); break;
          case 'Dance':      this.handleDance(intercept);      break;
          case 'UserTyping': this.handleUserTyping(intercept); break;
          case 'Chat':
          case 'Shout':
          case 'Whisper':    this.handleChat(intercept);       break;
          case 'UserChange': this.handleUserChange(intercept); break;
        }
      } catch (e) { console.error(e); }
    }

    handleUserObject(intercept) {
      const p = intercept.packet; p.reset();
      this.userId = p.readInt();
    }

    handleRoomReady() {
      this.idToIndex.clear(); this.indexToId.clear();
      this.idToName.clear();  this.idToFigure.clear();
      this.idToGender.clear(); this.idToMotto.clear();
      this.targetId = -1; this.targetIndex = -1;
      this.targetName = null; this.state = 'idle';
      if (this.userId === -1) this.extension.sendPacket('InfoRetrieve');
      this._notify();
    }

    handleUsers(intercept) {
      const p = intercept.packet; p.reset();
      const count = p.readInt();
      for (let i = 0; i < count; i++) {
        const id     = p.readInt();
        const name   = p.readString();
        const motto  = p.readString();
        const figure = p.readString();
        const index  = p.readInt();
        p.readInt(); p.readInt(); p.readString(); // x, y, z
        p.readInt();                               // bodyDirection
        const type = p.readInt();
        this.idToIndex.set(id, index); this.indexToId.set(index, id);
        this.idToName.set(id, name);   this.idToFigure.set(id, figure);
        this.idToMotto.set(id, motto);
        if (type === 1) {                          // Human user
          const gender = p.readString();
          this.idToGender.set(id, gender);
          if (id === this.targetId && this.state === 'active') {
            this.targetIndex = index;
            if (this.Figure) this.extension.sendPacket('UpdateFigureData', gender, figure);
            if (this.Motto)  this.extension.sendPacket('ChangeMotto', motto);
          }
          p.readInt(); p.readInt(); p.readString(); p.readString();
          p.readInt(); p.readBoolean();
        } else if (type === 2) {                   // Pet — Nitro format
          p.readInt(); p.readInt(); p.readString(); p.readInt(); // subType, ownerId, ownerName, rarityLevel
          p.readBoolean();                                        // hasRider
          p.readInt(); p.readInt(); p.readInt();                  // unknown x3
        } else if (type === 3) {                   // Public bot
          p.readString(); p.readInt(); p.readString(); p.readInt(); // gender, ownerId, ownerName, botType
          const dataCount = p.readInt();
          for (let s = 0; s < dataCount; s++) p.readInt();
        } else if (type === 4) {                   // Private bot
          p.readString(); p.readInt(); p.readString(); p.readInt(); // gender, ownerId, ownerName, botType
          p.readInt();                                               // unknown
          p.readInt(); p.readInt(); p.readInt(); p.readInt();        // 4 skill ints
        }
      }
    }

    handleTargetSelection(intercept) {
      const p = intercept.packet; p.reset();
      const clicked = p.readInt();
      if (this.userId === -1 || clicked === this.userId || !this.idToIndex.has(clicked)) return;
      this.targetId    = clicked;
      this.targetIndex = this.idToIndex.get(clicked);
      this.targetName  = this.idToName.get(clicked);
      const wasSelecting = this.state === 'selecting';
      this.state       = wasSelecting ? 'active' : 'idle';
      this.ButtonText  = wasSelecting ? 'Stop' : 'Start';
      const live   = window.Room && window.Room.users && window.Room.users[this.targetIndex];
      const figure = (live && live.figure) || this.idToFigure.get(clicked) || '';
      const gender = (live && live.gender) || this.idToGender.get(clicked);
      const motto  = (live && live.motto)  || this.idToMotto.get(clicked);
      this.TargetAvatarUrl =
        'https://www.leet.city/leet-imaging/avatarimage' +
        '?figure=' + encodeURIComponent(figure) +
        '&direction=2&head_direction=3&size=m&gesture=sml&img_format=png';
      if (wasSelecting) {
        if (this.Figure && gender) this.extension.sendPacket('UpdateFigureData', gender, figure);
        if (this.Motto && motto != null) this.extension.sendPacket('ChangeMotto', motto);
      }
      this._notify();
    }

    handleUserUpdate(intercept) {
      const p = intercept.packet; p.reset();
      const count = p.readInt();
      for (let i = 0; i < count; i++) {
        const index = p.readInt();
        const x = p.readInt(); const y = p.readInt();
        p.readString(); p.readInt(); p.readInt();
        const actions = p.readString();
        if (index !== this.targetIndex) continue;
        if (this.Follow) {
          this.extension.sendPacket('LookTo', x, y);
          this.extension.sendPacket('MoveAvatar', x, y);
        }
        if (this.Sit && !actions.includes('sign') && actions.includes('sit'))
          this.extension.sendPacket('ChangePosture', 1);
        if (this.Sign && actions.includes('sign')) {
          const start = actions.indexOf('sign') + 5;
          const end   = actions.indexOf('/', start);
          if (end > start) {
            const signId = parseInt(actions.substring(start, end).trim());
            if (!isNaN(signId)) this.extension.sendPacket('Sign', signId);
          }
        }
      }
    }

    handleExpression(intercept) {
      const p = intercept.packet; p.reset();
      const index = p.readInt(); const id = p.readInt();
      if (this.Action && index === this.targetIndex)
        this.extension.sendPacket('AvatarExpression', id);
    }

    handleDance(intercept) {
      const p = intercept.packet; p.reset();
      const index = p.readInt(); const style = p.readInt();
      if (this.Dance && index === this.targetIndex)
        this.extension.sendPacket('Dance', style);
    }

    handleUserTyping(intercept) {
      const p = intercept.packet; p.reset();
      const index = p.readInt(); const typingState = p.readBoolean();
      if (this.Typing && index === this.targetIndex)
        this.extension.sendPacket(typingState ? 'StartTyping' : 'CancelTyping');
    }

    handleChat(intercept) {
      const p = intercept.packet; p.reset();
      const index = p.readInt(); const message = p.readString();
      p.readInt(); const bubble = p.readInt();
      if (index !== this.targetIndex) return;
      const name = intercept.name;
      if      (name === 'Chat'    && this.Talk)    this.extension.sendPacket('Chat', message, bubble, -1);
      else if (name === 'Shout'   && this.Shout)   this.extension.sendPacket('Shout', message, bubble);
      else if (name === 'Whisper' && this.Whisper)
        this.extension.sendPacket('Whisper', this.targetName + ' ' + message, bubble);
    }

    handleUserChange(intercept) {
      const p = intercept.packet; p.reset();
      const index  = p.readInt();
      const figure = p.readString();
      const gender = p.readString();
      const motto  = p.readString();
      const id = this.indexToId.get(index);
      if (id !== undefined) {
        this.idToFigure.set(id, figure);
        this.idToGender.set(id, gender);
        this.idToMotto.set(id, motto);
      }
      if (index === this.targetIndex) {
        if (this.Figure) {
          this.extension.sendPacket('UpdateFigureData', gender, figure);
          this.TargetAvatarUrl =
            'https://www.leet.city/leet-imaging/avatarimage' +
            '?figure=' + encodeURIComponent(figure) +
            '&direction=2&head_direction=3&size=m&gesture=sml&img_format=png';
        }
        if (this.Motto) this.extension.sendPacket('ChangeMotto', motto);
        this._notify();
      }
    }
  }

  // ---- UI ----
  const DEFAULT_FIGURE = 'ch-210-66.lg-270-1338.sh-290-1408.hr-100-39.hd-180-1';
  const DEFAULT_AVATAR_URL =
    'https://www.leet.city/leet-imaging/avatarimage' +
    '?figure=' + encodeURIComponent(DEFAULT_FIGURE) +
    '&direction=2&head_direction=3&size=m&gesture=sml&img_format=png';
  const DEFAULT_AV_IMG = '<img src="' + DEFAULT_AVATAR_URL + '" style="width:100px;height:165px;object-fit:contain">';

  function buildMimicUI() {
    const TOGGLES = ['Figure','Motto','Action','Dance','Sign','Sit','Follow','Typing','Talk','Shout','Whisper'];
    // LEFT_TOGGLES / RIGHT_TOGGLES defined below before togHTML

    const style = document.createElement('style');
    style.textContent = [
      '#__mimic{position:fixed;top:16px;right:16px;width:330px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__mimic *{box-sizing:border-box}',
      '.__mimic_card{display:flex;flex-direction:column;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb}',
      '.__mimic_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__mimic_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}',
      '.__mimic_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__mimic_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__mimic_close:hover{color:#eceefb}',
      '#__mimic_body{box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;padding:0}',
      '#__mimic_inner{flex:1;overflow-y:auto;padding:10px 12px 2px;display:flex;flex-direction:column;gap:6px}',
      '#__mimic_status{display:flex;flex-direction:row;align-items:flex-start;gap:10px}',
      '#__mimic_avleft{display:flex;flex-direction:column;align-items:center;gap:6px;flex-shrink:0;width:100px}',
      '#__mimic_avwrap{width:100px;height:165px;border-radius:8px;background:#1c1e2a;border:1px solid #23252f;display:flex;align-items:center;justify-content:center;overflow:hidden}',
      '#__mimic_toggles{display:flex;flex-direction:row;gap:4px;flex:1}',
      '.__mt{display:flex;align-items:center;gap:8px;cursor:pointer;font-size:11px;user-select:none;padding:2px 4px;border-radius:4px}',
      '.__mt:hover{background:rgba(255,255,255,0.04)}',
      '.__mt:hover .nitro-check-box{border-color:#6C7CFF}',
      '.nitro-check-input{position:absolute;opacity:0;width:0;height:0}',
      '.nitro-check-box{width:15px;height:15px;background:#1c1e2a;border:1px solid #23252f;border-radius:4px;display:inline-block;position:relative;transition:all 0.15s ease-in-out;flex-shrink:0}',
      '.nitro-check-input:checked+.nitro-check-box{background:#6C7CFF;border-color:#6C7CFF}',
      '.nitro-check-input:checked+.nitro-check-box::after{content:"";position:absolute;left:4px;top:1px;width:5px;height:9px;border:solid #0A0B10;border-width:0 2px 2px 0;transform:rotate(45deg)}',
      '.nitro-check-input:focus+.nitro-check-box{outline:none}',
      '.nitro-check-label{color:#82849a}',
      '#__mimic_selall{background:none;border:none;padding:0;font-size:9px;color:#5c5e6b;cursor:pointer;text-decoration:underline;text-align:left;margin-top:1px}',
      '#__mimic_selall:hover{color:#A6B0FF}',
      '#__mimic_footer{padding:0 12px 10px;flex-shrink:0}',
      '#__mimic_btn{width:100%;font-size:11px;font-weight:600;padding:7px 10px;border-radius:8px;border:none;cursor:pointer;background:#A6B0FF;color:#0A0B10}',
      '#__mimic_btn:hover{filter:brightness(1.08)}',
    ].join('');
    document.head.appendChild(style);

    const ext = makeExtension();
    const mgr = new MimiqManager(ext);

    const panel = document.createElement('div');
    panel.id = '__mimic';
    panel.style.display = 'none';
    document.body.appendChild(panel);

    const LEFT_TOGGLES  = ['Figure','Motto','Action','Dance','Sign','Sit'];
    const RIGHT_TOGGLES = ['Follow','Typing','Talk','Shout','Whisper'];
    function _togCol(keys) {
      return keys.map(k =>
        '<label class="__mt">' +
        '<input type="checkbox" class="nitro-check-input" id="__mt_' + k + '"' + (mgr[k] ? ' checked' : '') + '>' +
        '<span class="nitro-check-box"></span>' +
        '<span class="nitro-check-label">' + k + '</span>' +
        '</label>'
      ).join('');
    }
    const togHTML =
      '<div style="display:flex;gap:3px;flex:1">' +
        '<div style="display:flex;flex-direction:column;gap:3px;flex:1">' + _togCol(LEFT_TOGGLES) +
          '<button id="__mimic_selall">Select all</button>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:3px;flex:1">' + _togCol(RIGHT_TOGGLES) + '</div>' +
      '</div>';

    panel.innerHTML =
      '<div class="__mimic_card">' +
        '<div class="__mimic_hdr" id="__mimic_hdr">' +
          '<span class="__mimic_eyebrow">Gheloo</span>' +
          '<span class="__mimic_title">Mimic</span>' +
          '<span class="__mimic_close" id="__mimic_hclose">&times;</span>' +
        '</div>' +
        '<div id="__mimic_body">' +
          '<div id="__mimic_inner">' +
            '<div id="__mimic_status">' +
              '<div id="__mimic_avleft">' +
                '<div id="__mimic_avwrap">' + DEFAULT_AV_IMG + '</div>' +
                '<div id="__mimic_tname" style="font-weight:700;font-size:12px;color:#eceefb;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100px"></div>' +
              '</div>' +
              '<div id="__mimic_toggles">' + togHTML + '</div>' +
            '</div>' +
          '</div>' +
          '<div id="__mimic_footer">' +
            '<button id="__mimic_btn">Start</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    // Drag
    window.__ghk_makeDraggable(panel, panel.querySelector('#__mimic_hdr'), '__ghk_mimic_pos', e => e.target.id === '__mimic_hclose');

    panel.querySelector('#__mimic_hclose').addEventListener('click', () => { panel.style.display = 'none'; });

    // HUD pill (same shared wrapper as Friend Adder)
    let pillsWrap = document.getElementById('__nitro_pills_wrap');
    if (!pillsWrap) {
      pillsWrap = document.createElement('div');
      pillsWrap.id = '__nitro_pills_wrap';
      pillsWrap.style.cssText = 'position:fixed;top:12px;left:12px;z-index:999999;display:flex;flex-direction:column;gap:4px;pointer-events:none';
      document.body.appendChild(pillsWrap);
      document.head.insertAdjacentHTML('beforeend', '<style>@keyframes nitroPulse{0%{transform:scale(1);opacity:1}50%{transform:scale(1.18);opacity:.7}100%{transform:scale(1);opacity:1}}</style>');
      if (window.__ghk_updatePillsWrapPos) window.__ghk_updatePillsWrapPos();
    }
    const mimicPill = document.createElement('div');
    mimicPill.id = '__mimic_hud';
    mimicPill.style.cssText = 'display:none;align-items:center;gap:6px;padding:4px 10px;border-radius:8px;background:#0A0B10;border:1px solid #23252f;color:#A6B0FF;font:700 11px monospace;cursor:pointer;user-select:none;transition:opacity .2s;pointer-events:all';
    mimicPill.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:#57d46c;box-shadow:0 0 0 2px rgba(87,212,108,.15),0 0 8px rgba(87,212,108,.7);animation:nitroPulse 1.4s ease-in-out infinite;flex-shrink:0"></span><span>Mimic</span>';
    pillsWrap.appendChild(mimicPill);
    mimicPill.addEventListener('click', () => {
      panel.style.display = '';
      if (window.__ghk_bringToFront) window.__ghk_bringToFront(panel);
    });

    TOGGLES.forEach(k => {
      const cb = panel.querySelector('#__mt_' + k);
      if (cb) cb.addEventListener('change', e => { mgr[k] = e.target.checked; });
    });

    const NON_FOLLOW = TOGGLES.filter(k => k !== 'Follow');
    panel.querySelector('#__mimic_selall').addEventListener('click', () => {
      const allChecked = NON_FOLLOW.every(k => mgr[k]);
      const newVal = !allChecked;
      NON_FOLLOW.forEach(k => {
        mgr[k] = newVal;
        const cb = panel.querySelector('#__mt_' + k);
        if (cb) cb.checked = newVal;
      });
      panel.querySelector('#__mimic_selall').textContent = newVal ? 'Deselect all' : 'Select all';
    });

    panel.querySelector('#__mimic_btn').addEventListener('click', () => {
      if (mgr.state === 'idle') {
        if (mgr.targetId !== -1) {
          // target already picked — go active immediately
          mgr.state = 'active';
          mgr.ButtonText = 'Stop';
          const _live   = window.Room && window.Room.users && window.Room.users[mgr.targetIndex];
          const _figure = (_live && _live.figure) || mgr.idToFigure.get(mgr.targetId);
          const _gender = (_live && _live.gender) || mgr.idToGender.get(mgr.targetId);
          const _motto  = (_live && _live.motto)  || mgr.idToMotto.get(mgr.targetId);
          if (mgr.Figure && _gender) mgr.extension.sendPacket('UpdateFigureData', _gender, _figure);
          if (mgr.Motto && _motto != null) mgr.extension.sendPacket('ChangeMotto', _motto);
        } else {
          mgr.state = 'selecting';
          mgr.ButtonText = 'Stop';
        }
      } else {
        mgr.state = 'idle';
        mgr.ButtonText = 'Start';
      }
      _updateUI();
    });

    function _updateUI() {
      const btn    = panel.querySelector('#__mimic_btn');
      const tname  = panel.querySelector('#__mimic_tname');
      const avwrap = panel.querySelector('#__mimic_avwrap');
      if (!btn) return;

      btn.textContent = mgr.ButtonText;
      mimicPill.style.display = mgr.state === 'active' ? 'flex' : 'none';

      if (mgr.state === 'active') {
        tname.textContent = mgr.targetName || '';
        avwrap.innerHTML  = mgr.TargetAvatarUrl
          ? '<img src="' + mgr.TargetAvatarUrl + '" style="width:100px;height:165px;object-fit:contain">'
          : DEFAULT_AV_IMG;
      } else if (mgr.state === 'selecting') {
        tname.textContent = '';
        avwrap.innerHTML  = DEFAULT_AV_IMG;
      } else {
        tname.textContent = mgr.targetId !== -1 ? (mgr.targetName || '') : '';
        avwrap.innerHTML  = mgr.targetId !== -1 && mgr.TargetAvatarUrl
          ? '<img src="' + mgr.TargetAvatarUrl + '" style="width:100px;height:165px;object-fit:contain">'
          : DEFAULT_AV_IMG;
      }
    }

    mgr._onUpdate = _updateUI;
  }

  function init() { window.__ghk_ready(() => buildMimicUI()); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
