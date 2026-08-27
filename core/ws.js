(function() {
  window._packetLog = [];
  const PACKET_LOG_CAP = 300; // ring buffer — drop oldest once full, keeps memory/UI bounded over long sessions
  window._blockIncomingFilters = {}; // logicalId → true | function(raw)→bool
  window._blockOutgoingFilters = {}; // logicalId → true | function(raw)→bool
  window._pendingBlockOutgoing = false; // set true by subscriber to block current OUT packet

  // Packet Manipulator hooks — unlike the block-only filters above, these can rewrite a
  // packet's bytes before it's actually sent/delivered. Each entry is function(raw, logicalId)
  // returning either undefined (no change), {block:true}, or {buffer: ArrayBuffer} (replacement).
  // Arrays (not single slots) so more than one manipulating extension can coexist; applied in
  // order, chaining buffer replacements, short-circuiting on the first block.
  window._outgoingManipulators = [];
  window._incomingManipulators = [];
  window._rejoinCommandEnabled = false; // :rejoin chat command, toggled from Settings
  window._stealCommandEnabled = false; // :steal/:steel chat command, toggled from Settings

  // Unified outgoing block toggle — covers BOTH connection modes. When the game's socket
  // lives on the main thread, setting _blockOutgoingFilters is enough (WebSocket.prototype.send
  // is patched directly below). But when it lives inside a Worker (see _workerProxy), that
  // worker's own hooked ws.send() calls the REAL send synchronously before this thread ever
  // sees the packet via postMessage, so _blockOutgoingFilters alone can't stop it — the
  // worker has to be told to block it directly, by wire id (logicalId + current _outOffset).
  window._setOutgoingBlock = function(logicalId, blocked) {
    if (blocked) window._blockOutgoingFilters[logicalId] = true;
    else delete window._blockOutgoingFilters[logicalId];
    const ww = window._ws_worker || window._worker;
    if (ww && _offsetsReady) {
      ww.postMessage({ __n: 'block', wireId: logicalId + _outOffset, blocked: !!blocked });
    }
  };

  function _findOutId(shortNameWanted) {
    if (!window.PKT || !window.PKT.OUT) return null;
    for (const id in window.PKT.OUT) {
      if (window.shortName(window.PKT.OUT[id], 'OUT') === shortNameWanted) return parseInt(id);
    }
    return null;
  }

  function _findInId(shortNameWanted) {
    if (!window.PKT || !window.PKT.IN) return null;
    for (const id in window.PKT.IN) {
      if (window.shortName(window.PKT.IN[id], 'IN') === shortNameWanted) return parseInt(id);
    }
    return null;
  }

  // Resends the last captured room-enter packet, whether the real socket
  // lives on the main thread or is relayed from a Worker.
  function _rejoinNow() {
    if (!window._lastRoomEnterPacket) return;
    if (window._ws && window._ws.readyState === 1) { window._ws.send(window._lastRoomEnterPacket); return; }
    const _ww = window._ws_worker || window._worker;
    if (_ww) { const c = window._lastRoomEnterPacket.slice(0); _ww.postMessage({ __n: 'send', buf: c }, [c]); }
  }
  window.PacketStore = {
    packets: [], latestByName: {}, counters: {}, _subs: [],
    push(p) {
      this.packets.push(p);
      if (this.packets.length > PACKET_LOG_CAP) this.packets.shift();
      if (p.name) { this.latestByName[p.name] = p; this.counters[p.name] = (this.counters[p.name]||0) + 1; }
      for (let i = 0; i < this._subs.length; i++) try { this._subs[i](p); } catch(e) {}
    },
    subscribe(fn) { this._subs.push(fn); },
    clear() { this.packets=[]; this.latestByName={}; this.counters={}; }
  };

  window.PacketListeners = {};
  window.onPacket = function(name, cb) {
    if (!window.PacketListeners[name]) window.PacketListeners[name] = [];
    window.PacketListeners[name].push(cb);
  };

  // :steal — search the target by name (works anywhere in the hotel, not just same
  // room), pull their figure from their extended profile, then apply it to self.
  let _stealPendingName = null;
  let _stealPendingId   = null;

  window.onPacket('HabboSearchResult', function(p) {
    if (!_stealPendingName || !p.raw) return;
    try {
      // Fuzzy/substring search can return many entries with an inconsistent number of
      // optional fields per entry (motto present or not, badge data, etc.), so this can't
      // be walked with a fixed schema. Instead reuse the Packet Logger's own heuristic
      // decoder (same one you'd see reading the packet by eye) and take the int token
      // directly before our target name's string token as that entry's id.
      if (!window.__hbl_decode) return;
      const tokens = window.__hbl_decode(p.raw);
      let foundId = null;
      for (let ti = 1; ti < tokens.length; ti++) {
        if (tokens[ti].t === 's' && tokens[ti].v.toLowerCase() === _stealPendingName && tokens[ti - 1].t === 'i') {
          foundId = tokens[ti - 1].v;
          break;
        }
      }
      if (foundId === null) return;
      _stealPendingName = null;
      _stealPendingId   = foundId;
      const pid = _findOutId('GetExtendedProfile');
      if (pid !== null) window.sendPacket('OUT', pid, '{i:' + foundId + '}{b:false}');
    } catch(_e) {}
  });

  // UserRights: {i:<klass>}{i:<level>}{b:...} — level 2 == VIP account (confirmed
  // against known VIP/non-VIP accounts). No parser registered for this packet, so
  // read the raw bytes directly. Tracked here (loads before content.js/room-clone.js)
  // so window.__ghk_isVip is available to any extension regardless of load order.
  window.__ghk_isVip = false;
  window.onPacket('UserRights', function(p) {
    if (!p || !p.raw || !window.makeReader) return;
    try {
      const r = window.makeReader(p.raw);
      if (!r) return;
      r.int();
      window.__ghk_isVip = r.int() === 2;
    } catch (_e) {}
  });

  window.onPacket('ExtendedProfile', function(p) {
    if (_stealPendingId === null || !p.raw) return;
    try {
      const r = window.makeReader(p.raw);
      if (!r) return;
      const id = r.int();
      if (id !== _stealPendingId) return;
      _stealPendingId = null;
      r.str(); // name
      const figure = r.str();
      const fid = _findOutId('UpdateFigureData');
      if (fid !== null) window.sendPacket('OUT', fid, '{s:"M"}{s:"' + figure.replace(/"/g,'\\"') + '"}');
    } catch(_e) {}
  });

  // Cursor-based binary reader — accurate parsing, skip 6-byte WS header
  window.makeReader = function(raw) {
    if (!raw || raw.byteLength <= 6) return null;
    const buf = raw.slice(6);
    const view = new DataView(buf);
    const dec  = new TextDecoder();
    let pos = 0;
    return {
      int:   () => { const v = view.getInt32(pos);  pos += 4; return v; },
      short: () => { const v = view.getUint16(pos); pos += 2; return v; },
      bool:  () => { const v = view.getUint8(pos) !== 0; pos += 1; return v; },
      byte:  () => { const v = view.getUint8(pos);  pos += 1; return v; },
      str:   () => {
        const len = view.getUint16(pos); pos += 2;
        const v = dec.decode(new Uint8Array(buf, pos, len)); pos += len;
        return v;
      },
      long:  () => { const hi = view.getInt32(pos); const lo = view.getUint32(pos+4); pos += 8; return hi * 4294967296 + lo; },
      skip:         (n) => { pos += n; },
      remaining:    () => buf.byteLength - pos,
      getReadIndex: () => pos,
      setReadIndex: (i) => { pos = i; },
      peekInt:      () => { if (pos + 4 > buf.byteLength) return null; return view.getInt32(pos); },
    };
  };

  // Structure-guided G-Earth decoder: monkey-patches makeReader to record typed tokens
  // while running the real parser. Returns G-Earth token array for known packets,
  // null if no parser exists (caller falls back to heuristic).
  window.decodeWithParser = function(name, dir, raw) {
    const parser = (window.PacketParsers && window.PacketParsers[dir] || {})[name];
    if (!parser || !raw || raw.byteLength <= 6) return null;
    const tokens = [];
    const _orig = window.makeReader;
    window.makeReader = function(buf) {
      const rd = _orig(buf);
      if (!rd) return null;
      const pay   = buf.slice(6);
      const payU8 = new Uint8Array(pay);
      const payDV = new DataView(pay);
      function rec(t, fn) { return () => { const v = fn(); tokens.push({ t, v }); return v; }; }
      return {
        int:   rec('i', rd.int.bind(rd)),
        short: rec('u', rd.short.bind(rd)),
        bool:  rec('b', rd.bool.bind(rd)),
        long:  rec('l', rd.long.bind(rd)),
        byte:  rec('x', rd.byte.bind(rd)),
        str: () => {
          const pos = rd.getReadIndex();
          const v   = rd.str();
          const slen = payDV.getUint16(pos);
          let s = '';
          for (let j = 0; j < slen; j++) s += String.fromCharCode(payU8[pos + 2 + j]);
          tokens.push({ t: 's', v: s });
          return v;
        },
        skip:         (n) => rd.skip(n),
        remaining:    ()  => rd.remaining(),
        getReadIndex: ()  => rd.getReadIndex(),
        setReadIndex: (i) => rd.setReadIndex(i),
        peekInt:      ()  => rd.peekInt(),
      };
    };
    try { parser(raw); } catch (_) {}
    finally { window.makeReader = _orig; }
    return tokens.length ? tokens : null;
  };

  // Wire IDs used to be shifted by a per-connection offset derived from a special
  // "magic bootstrap frame" the server sent first (see git history for that mechanism —
  // FNV1a32 of a release string + build key + a random challenge). Confirmed via a live
  // capture (2026-07-29) that this hotel no longer does that: the very first real incoming
  // frame decoded cleanly as a completely standard [4b length][2b wireId][payload] packet
  // — wireId 0x05D0 (1488) with a length-prefixed string payload "TEST4-IID-...", which is
  // an exact match for pkt.js's own IN[1488] = "UniqueMachineIDEvent". No shift, no magic
  // frame, no calibration step needed — offsets are just 0, from the very first packet.
  let _inOffset = 0, _outOffset = 0, _offsetsReady = true;

  // Prototype-level interception, not constructor-proxying: constructing-time interception
  // (the old approach) only ever sees a WebSocket if the game code calls `new` on the exact
  // reference we patched — if any bundler helper/anti-tamper trick captures a different
  // reference to the native constructor first, construction is invisible to us even though
  // the resulting instance is a completely normal WebSocket. Patching WebSocket.prototype
  // directly sidesteps that: every instance in this realm shares the same prototype object
  // no matter which reference was used to construct it, so send()/message listeners are
  // caught regardless. (Also stopped forcing binaryType='arraybuffer' — the real client may
  // rely on the default 'blob' delivery, as the official Nitro client's SocketConnection
  // does via FileReader; forcing arraybuffer would have silently broken its own message
  // handling if this hotel's fork kept that pattern. Blob payloads are converted to
  // ArrayBuffer here independently, without touching the instance's binaryType.)
  const _wsInstrumented = new WeakSet();
  const _protoSend = WebSocket.prototype.send;
  const _protoAddListener = WebSocket.prototype.addEventListener;

  function _instrumentSocket(ws) {
    if (_wsInstrumented.has(ws)) return;
    _wsInstrumented.add(ws);
    window._ws = ws;
    // Relogging tears down this socket and opens a new one. Any ping sent on the old
    // socket that hadn't gotten a reply yet stays in _pendingPings with its original
    // Date.now() sentAt; without a reset, the first reply on the new socket pairs up
    // with that stale timestamp and reports an RTT of several seconds (the relog
    // duration) instead of the real one — this is why toggling Ping off/on in Settings
    // "fixes" it (that path already calls __ghk_resetPing).
    _protoAddListener.call(ws, 'open',  () => { if (window.Gheloo) window.Gheloo.setStatus('amber', ws.url); window.__ghk_resetPing && window.__ghk_resetPing(); });
    _protoAddListener.call(ws, 'close', () => { if (window.Gheloo) window.Gheloo.setStatus('red'); window.__ghk_resetPing && window.__ghk_resetPing(); });
    _protoAddListener.call(ws, 'error', () => { if (window.Gheloo) window.Gheloo.setStatus('red'); window.__ghk_resetPing && window.__ghk_resetPing(); });
  }

  // Runs manipulators first (they can block or rewrite bytes), then the legacy block-only
  // filter map for backwards compat with extensions still using _blockIncomingFilters
  // directly. Returns {blocked, raw} so the caller can decide what to actually deliver —
  // this used to take `ev` and call ev.stopImmediatePropagation(), but that only stops
  // OTHER listeners registered on this socket from firing; it can't stop the manual
  // _orig.apply(...) callback further down the chain, so blocking/rewriting has to happen
  // by controlling what gets *delivered* to that callback instead (see _wrapped below).
  function _handleIncomingBuffer(raw) {
    if (raw.byteLength < 6) return { blocked: false, raw };
    const _logId = new DataView(raw).getUint16(4) - _inOffset;
    let blocked = false;
    for (let i = 0; i < window._incomingManipulators.length; i++) {
      let res; try { res = window._incomingManipulators[i](raw, _logId); } catch (e) { res = undefined; }
      if (res && res.block) { blocked = true; break; }
      if (res && res.buffer instanceof ArrayBuffer) raw = res.buffer;
    }
    if (!blocked) {
      const _bf = window._blockIncomingFilters[_logId];
      if (_bf !== undefined) blocked = typeof _bf === 'function' ? _bf(raw) : true;
    }
    try { addPacket('IN', _logId, null, raw); } catch {}
    return { blocked, raw };
  }

  // Returns null when there's nothing to act on (string frames, async Blob path), or
  // {blocked, raw} for a synchronously-decided ArrayBuffer message — see _wrapped below
  // for how that result actually controls delivery.
  function _onSocketMessage(ev) {
    if (typeof ev.data === 'string') {
      if (ev.data.includes('{in:UserObject}') && !window._selfName) {
        const m = ev.data.match(/\{i:\d+\}\{s:"([^"]+)"\}/);
        if (m) {
          window._selfName = m[1];
          const _want = 'Leet Hotel | ' + m[1];
          const _d = Object.getOwnPropertyDescriptor(Document.prototype, 'title');
          Object.defineProperty(document, 'title', { get: () => _d.get.call(document), set: () => _d.set.call(document, _want), configurable: true });
          document.title = _want;
          const _hu = document.getElementById('__hub_user');
          if (_hu) _hu.textContent = m[1];
        }
      }
      return null;
    }
    if (ev.data instanceof ArrayBuffer) {
      return _handleIncomingBuffer(ev.data.slice(0));
    }
    if (typeof Blob !== 'undefined' && ev.data instanceof Blob) {
      // Can't synchronously block/rewrite a Blob-delivered message (conversion is async,
      // the real listener already ran by the time it resolves) — still logs/detects
      // offsets, which is what packet logging actually needs. Manipulator rules simply
      // don't apply to this path.
      ev.data.arrayBuffer().then(buf => _handleIncomingBuffer(buf)).catch(() => {});
    }
    return null;
  }

  // Wraps a real 'message' listener so it's handed a synthetic event carrying the
  // (possibly rewritten) bytes instead of the original — a native MessageEvent's .data
  // can't be reassigned, so a lightweight object prototyped off the real event (falling
  // through to it for .type/.target/etc, shadowing only .data) stands in for it.
  function _wrapIncomingListener(orig) {
    return function(ev) {
      const result = _onSocketMessage(ev);
      if (result) {
        if (result.blocked) return;
        const fakeEv = Object.create(ev);
        try { Object.defineProperty(fakeEv, 'data', { value: result.raw, configurable: true }); } catch (_e) {}
        return orig.call(this, fakeEv);
      }
      return orig.apply(this, arguments);
    };
  }

  WebSocket.prototype.send = function(data) {
    _instrumentSocket(this);
    let raw = data && data.slice ? data.slice(0) : data;

    if (raw instanceof ArrayBuffer) {
      if (_offsetsReady && raw.byteLength >= 6) {
        const _outLogId = new DataView(raw).getUint16(4) - _outOffset;

        let _manipBlocked = false;
        for (let i = 0; i < window._outgoingManipulators.length; i++) {
          let res; try { res = window._outgoingManipulators[i](raw, _outLogId); } catch (e) { res = undefined; }
          if (res && res.block) { _manipBlocked = true; break; }
          if (res && res.buffer instanceof ArrayBuffer) raw = res.buffer;
        }
        if (_manipBlocked) { try { addPacket('OUT', _outLogId, null, raw); } catch {} return; }

        try { addPacket('OUT', _outLogId, null, raw); } catch {}
        if (_outLogId === _findOutId('OpenFlatConnection')) {
          window._lastRoomEnterPacket = raw.slice(0);
        }
        const _obf = window._blockOutgoingFilters[_outLogId];
        if (_obf !== undefined) {
          const _doBlock = typeof _obf === 'function' ? _obf(raw) : true;
          if (_doBlock) return;
        }
      }

      if (window._pendingBlockOutgoing) {
        window._pendingBlockOutgoing = false;
        return;
      }

      // :steal/:steel <name> — copy target's figure, block message
      if (_offsetsReady && raw.byteLength > 8) {
        try {
          const _logId = new DataView(raw).getUint16(4) - _outOffset;
          if (_logId === 1314) {
            const _tLen = new DataView(raw).getUint16(6);
            const _txt  = new TextDecoder().decode(new Uint8Array(raw, 8, _tLen));
            const _low  = _txt.toLowerCase();
            if (window._stealCommandEnabled && (_low.startsWith(':steal ') || _low.startsWith(':steel '))) {
              const _tNameRaw = _txt.slice(7).trim();
              if (_tNameRaw) {
                _stealPendingName = _tNameRaw.toLowerCase();
                const _sid = _findOutId('HabboSearch');
                if (_sid !== null) window.sendPacket('OUT', _sid, '{s:"' + _tNameRaw.replace(/"/g,'\\"') + '"}');
              }
              return; // block original chat packet
            }
            if (_low === ':rejoin' && window._rejoinCommandEnabled) {
              _rejoinNow();
              return; // block original chat packet
            }
          }
        } catch(_e) {}
      }
    }
    return _protoSend.call(this, raw);
  };

  WebSocket.prototype.addEventListener = function(type, listener, options) {
    _instrumentSocket(this);
    if (type === 'message' && typeof listener === 'function' && !listener.__ghkMsgWrapped) {
      const _wrapped = _wrapIncomingListener(listener);
      _wrapped.__ghkMsgWrapped = true;
      return _protoAddListener.call(this, type, _wrapped, options);
    }
    return _protoAddListener.call(this, type, listener, options);
  };

  const _onmessageDesc = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
  if (_onmessageDesc && _onmessageDesc.set) {
    Object.defineProperty(WebSocket.prototype, 'onmessage', {
      configurable: true,
      get() { return _onmessageDesc.get.call(this); },
      set(fn) {
        _instrumentSocket(this);
        if (typeof fn === 'function') {
          const _wrapped = _wrapIncomingListener(fn);
          return _onmessageDesc.set.call(this, _wrapped);
        }
        return _onmessageDesc.set.call(this, fn);
      }
    });
  }

  window.shortName = function(raw, dir) {
    if (!raw) return '';
    return dir === 'OUT'
      ? raw.replace(/(?:Message)?Composer$/, '')
      : raw.replace(/(?:Message)?Event$/, '');
  };

  // The native client pops the profile card open based on *receiving* {in:ExtendedProfile},
  // not on what flag was sent out — so block the incoming response, but only while a
  // :steal fetch is actually pending (and only that exact user id), so normal profile
  // viewing (clicking an avatar, the My User tab) is untouched.
  (function _setupStealProfileBlock() {
    const _epId = _findInId('ExtendedProfile');
    if (_epId === null) return;
    window._blockIncomingFilters[_epId] = function(raw) {
      if (_stealPendingId === null) return false;
      try {
        const r = window.makeReader(raw);
        if (!r) return false;
        return r.int() === _stealPendingId;
      } catch(_e) { return false; }
    };
  })();

  // Marktplaats Alerts polls this pair every second — logging them would flood the
  // Packet Logger (120+ entries/min) and blow through its ring buffer, drowning out
  // everything else. Still parsed and dispatched to onPacket listeners as normal,
  // just excluded from the log/UI history.
  //
  // GetGiftWrappingConfiguration/GiftWrappingConfiguration is multitab.js's live ping
  // probe (fires every __ghk_pingIntervalMs while Settings > Performance > Ping is on) —
  // same flood reasoning. BundleDiscountRulesetMessageEvent rides along as a side effect
  // of this hotel's GetGiftWrappingConfiguration handler (confirmed via a live capture:
  // the server answers with both), so it's noise from the same source, not separate
  // legitimate traffic — hidden alongside it.
  const _hiddenFromLog = new Set(['GetMarketplaceOffers', 'MarketPlaceOffers', 'GetGiftWrappingConfiguration', 'GiftWrappingConfiguration', 'BundleDiscountRuleset']);

  function addPacket(dir, id, _name, raw) {
    const name = window.shortName(_name || (window.PKT[dir]||{})[id] || '', dir);
    const p = { header: id, name, direction: dir, timestamp: Date.now(), raw, parsed: null };
    const parser = name && (window.PacketParsers[dir]||{})[name];
    if (parser) { try { p.parsed = parser(raw); } catch(e) { console.error('[parser:' + name + ']', e); } }
    if (name === 'UserObject' && p.parsed && p.parsed.name) {
      // Fires on every login, including reconnects — status should flip to
      // Connected each time, not just the first time this tab ever saw it.
      if (window.Gheloo) window.Gheloo.setStatus('green', window._ws && window._ws.url);
    }
    if (name === 'UserObject' && p.parsed && p.parsed.name && !window._selfName) {
      window._selfName = p.parsed.name;
      const _want = 'Leet Hotel | ' + p.parsed.name;
      const _top = window.top.document;
      function _setTitle(val) {
        let el = _top.querySelector('title');
        if (!el) { el = _top.createElement('title'); _top.head.appendChild(el); }
        el.textContent = val;
      }
      _setTitle(_want);
      const obs = new MutationObserver(() => { if (_top.title !== _want) _setTitle(_want); });
      const _el = _top.querySelector('title');
      if (_el) obs.observe(_el, { childList: true, characterData: true, subtree: true });
    }
    const hideFromLog = name && _hiddenFromLog.has(name);
    if (!hideFromLog) {
      window._packetLog.push(p);
      if (window._packetLog.length > PACKET_LOG_CAP) window._packetLog.shift();
    }
    const listeners = name && window.PacketListeners[name];
    if (listeners && listeners.length) {
      listeners.forEach(cb => { try { cb(p); } catch(err) { console.error('[onPacket:' + name + ']', err); } });
    }
    if (!hideFromLog) window.PacketStore.push(p);
  }

  window.GPacket = (function() {
    class GEarthPacket {
      constructor(buffer) {
        this.buffer = buffer instanceof ArrayBuffer ? buffer : buffer.buffer;
        this._view  = new DataView(this.buffer);
        this.offset = 6; // skip length (4) + header (2)
      }

      // READ PRIMITIVES
      readByte()    { return this._view.getInt8(this.offset++); }
      readBoolean() { return this.readByte() !== 0; }
      readShort()   { const v = this._view.getInt16(this.offset);  this.offset += 2; return v; }
      readUShort()  { const v = this._view.getUint16(this.offset); this.offset += 2; return v; }
      readInt()     { const v = this._view.getInt32(this.offset);  this.offset += 4; return v; }
      readLong()    { const v = this._view.getBigInt64(this.offset); this.offset += 8; return v; }
      readDouble()  { const v = this._view.getFloat64(this.offset); this.offset += 8; return v; }

      readString() {
        const len   = this.readUShort();
        const bytes = new Uint8Array(this.buffer, this.offset, len);
        this.offset += len;
        let str = '';
        for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
        return str;
      }

      // RAW BYTE HANDLING
      byteToken(b) {
        const v = b & 0xFF;
        if (v >= 32 && v <= 126 && v !== 91 && v !== 93 && v !== 123 && v !== 125)
          return String.fromCharCode(v);
        return `[${v}]`;
      }

      // MAIN PARSER
      toExpression(structure = null) {
        let result = '';
        this.offset = 6;
        if (!structure) {
          while (this.offset < this.buffer.byteLength)
            result += this.byteToken(this.readByte());
          return result;
        }
        for (const c of structure) {
          switch (c) {
            case 'i': result += `{i:${this.readInt()}}`;    break;
            case 's': result += `{s:"${this.readString().replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\r/g,'\\r')}"}`; break;
            case 'b': result += `{b:${this.readByte()}}`;   break;
            case 'B': result += `{b:${this.readBoolean()}}`; break;
            case 'u': result += `{u:${this.readUShort()}}`; break;
            case 'l': result += `{l:${this.readLong()}}`;   break;
            case 'd': result += `{d:${this.readDouble()}}`; break;
            default:  result += this.byteToken(this.readByte()); break;
          }
        }
        return result;
      }

      // EXPRESSION → BUFFER
      static fromExpression(expr) {
        const parts = [];
        const hm = expr.match(/\{h:(-?\d+)\}/);
        let header = 0;
        if (hm) { header = parseInt(hm[1]); expr = expr.replace(/\{h:-?\d+\}/, ''); }

        function pushInt(v)    { const ab = new ArrayBuffer(4); new DataView(ab).setInt32(0, v);  parts.push(ab); }
        function pushShort(v)  { const ab = new ArrayBuffer(2); new DataView(ab).setInt16(0, v);  parts.push(ab); }
        function pushByte(v)   { const ab = new ArrayBuffer(1); new DataView(ab).setInt8(0, v);   parts.push(ab); }
        function pushString(s) {
          const bytes = new Uint8Array(s.length);
          for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xFF;
          pushShort(bytes.length);
          parts.push(bytes.buffer);
        }

        // Two alternatives, not one lazy `(.*?)` — a {s:"..."} value can itself contain
        // literal '{'/'}' (e.g. JSON stuff data on wall items), which desyncs a lazy
        // match: it stops at the first '}' INSIDE the string instead of the token's real
        // closing "}", corrupting every token after it. The string branch instead matches
        // up to an unescaped closing quote (honoring \" and \\), so embedded braces are
        // just part of the string content. The other token types never contain braces, so
        // their branch keeps the simple non-string form.
        const re = /\{s:"((?:\\.|[^"\\])*)"\}|\{([a-zA-Z]+):([^{}]*)\}/g;
        let m;
        while ((m = re.exec(expr)) !== null) {
          if (m[1] !== undefined) {
            pushString(m[1].replace(/\\"/g,'"').replace(/\\\\/g,'\\').replace(/\\r/g,'\r').replace(/\\n/g,'\n'));
            continue;
          }
          const type = m[2];
          const value = m[3];
          switch (type) {
            case 'i': pushInt(parseInt(value)); break;
            case 'u': pushShort(parseInt(value)); break;
            case 'b': pushByte(value === 'true' ? 1 : parseInt(value)); break;
            case 'l': { const ab = new ArrayBuffer(8); new DataView(ab).setBigInt64(0, BigInt(value)); parts.push(ab); break; }
            case 'd': { const ab = new ArrayBuffer(8); new DataView(ab).setFloat64(0, parseFloat(value)); parts.push(ab); break; }
          }
        }

        const bodyLen = parts.reduce((s, p) => s + p.byteLength, 0);
        const final   = new ArrayBuffer(bodyLen + 6);
        const fView   = new DataView(final);
        const fU8     = new Uint8Array(final);
        fView.setInt32(0, bodyLen + 2);
        fView.setInt16(4, header);
        let off = 6;
        for (const p of parts) { fU8.set(new Uint8Array(p), off); off += p.byteLength; }
        return final;
      }
    }
    return GEarthPacket;
  })();

  // Build full WS packet: [4b length][2b wireId][payload]
  function buildRawPacket(dir, logicalId, payloadBuf) {
    if (!_offsetsReady) return null;
    const wireId = logicalId + (dir === 'OUT' ? _outOffset : _inOffset);
    const pl = payloadBuf || new ArrayBuffer(0);
    const buf = new ArrayBuffer(6 + pl.byteLength);
    const view = new DataView(buf);
    view.setInt32(0, 2 + pl.byteLength);
    view.setUint16(4, wireId);
    new Uint8Array(buf).set(new Uint8Array(pl), 6);
    return buf;
  }

  // --- Worker WebSocket interception ---
  // Injected into each Worker before the real script runs. Proxies WebSocket inside the
  // worker and relays packets to main thread via postMessage.
  //
  // Recursive: also proxies Worker itself, so if the hooked worker spawns a NESTED worker
  // (a networking worker isolated one level deeper — confirmed via debug probes to be
  // what this hotel's client now does, whereas it used to construct the socket directly),
  // the same hook gets injected into that nested worker too, however deep it goes.
  // Messages bubble up child→parent→...→main thread automatically (each level's relay
  // just re-posts whatever its child sent); 'send'/'block' commands are broadcast back
  // down to every nested worker since we don't know in advance which depth holds the
  // real socket.
  //
  // Self-referential: _WORKER_HOOK_TEMPLATE contains a placeholder that gets replaced
  // with its own JSON-stringified source, so the same hook can re-inject itself for
  // however many worker levels deep the real connection turns out to live at.
  const _WORKER_HOOK_TEMPLATE = '(function(){'
    + 'try{'
    + 'var _HOOK_SRC=__HOOK_SRC_PLACEHOLDER__;'
    + 'var _instrumented=new WeakSet();'
    + 'var _protoSend=WebSocket.prototype.send;'
    + 'var _protoAddListener=WebSocket.prototype.addEventListener;'
    + 'function _instrument(ws){'
    + '  if(_instrumented.has(ws))return;'
    + '  _instrumented.add(ws);'
    + '  self.__hookedWs=ws;'
    + '  self.postMessage({__n:"url",url:ws.url});'
    + '}'
    + 'function _handleIn(buf){'
    + '  if(buf instanceof ArrayBuffer&&buf.byteLength){var c=buf.slice(0);self.postMessage({__n:"in",buf:c},[c]);}'
    + '}'
    + 'WebSocket.prototype.send=function(d){'
    + '  _instrument(this);'
    + '  var buf=d instanceof ArrayBuffer?d:(d&&d.buffer instanceof ArrayBuffer?d.buffer:null);'
    + '  if(buf&&buf.byteLength){'
    + '    var c=buf.slice(0);self.postMessage({__n:"out",buf:c},[c]);'
    + '    if(buf.byteLength>=6){var wid=new DataView(buf).getUint16(4);'
    + '      if(self.__blockedOutWireIds&&self.__blockedOutWireIds[wid])return;'
    + '    }'
    + '  }'
    + '  return _protoSend.call(this,d);'
    + '};'
    + 'WebSocket.prototype.addEventListener=function(type,listener,options){'
    + '  _instrument(this);'
    + '  if(type==="message"&&typeof listener==="function"&&!listener.__ghkWrapped){'
    + '    var _orig=listener;'
    + '    var _wrapped=function(ev){'
    + '      if(ev.data instanceof ArrayBuffer){_handleIn(ev.data);}'
    + '      else if(typeof Blob!=="undefined"&&ev.data instanceof Blob){ev.data.arrayBuffer().then(_handleIn).catch(function(){});}'
    + '      return _orig.apply(this,arguments);'
    + '    };'
    + '    _wrapped.__ghkWrapped=true;'
    + '    return _protoAddListener.call(this,type,_wrapped,options);'
    + '  }'
    + '  return _protoAddListener.call(this,type,listener,options);'
    + '};'
    + 'self.__nestedWorkers=[];'
    + 'if(typeof Worker!=="undefined"){'
    + '  var _WK=Worker;'
    + '  self.Worker=new Proxy(_WK,{'
    + '    construct:function(t,a){'
    + '      var url=String(a[0]);'
    + '      var src=_HOOK_SRC+"\\ntry{importScripts("+JSON.stringify(url)+");}catch(e){self.postMessage({__n:\\"hookError\\",msg:\\"importScripts failed: \\"+String(e)});}";'
    + '      var blob=new Blob([src],{type:"text/javascript"});'
    + '      var hookedURL=URL.createObjectURL(blob);'
    + '      var nested=Reflect.construct(t,[hookedURL,a[1]]);'
    + '      self.postMessage({__n:"nestedWorkerCreated",url:url});'
    + '      self.__nestedWorkers.push(nested);'
    + '      nested.addEventListener("message",function(ev){'
    + '        if(!ev.data||!ev.data.__n)return;'
    + '        var transfer=ev.data.buf?[ev.data.buf]:[];'
    + '        self.postMessage(ev.data,transfer);'
    + '      });'
    + '      return nested;'
    + '    }'
    + '  });'
    + '}'
    + 'self.__blockedOutWireIds={};'
    + 'self.addEventListener("message",function(ev){'
    + '  if(!ev.data||!ev.data.__n)return;'
    + '  if(ev.data.__n==="send"){'
    + '    if(self.__hookedWs)self.__hookedWs.send(ev.data.buf);'
    + '    self.__nestedWorkers.forEach(function(w){var c=ev.data.buf.slice(0);w.postMessage({__n:"send",buf:c},[c]);});'
    + '  } else if(ev.data.__n==="block"){'
    + '    if(ev.data.blocked)self.__blockedOutWireIds[ev.data.wireId]=true;else delete self.__blockedOutWireIds[ev.data.wireId];'
    + '    self.__nestedWorkers.forEach(function(w){w.postMessage(ev.data);});'
    + '  }'
    + '});'
    + 'self.postMessage({__n:"hookInstalled"});'
    + '}catch(e){self.postMessage({__n:"hookError",msg:String(e)});}'
    + '})();';
  const _WORKER_HOOK = _WORKER_HOOK_TEMPLATE.replace('__HOOK_SRC_PLACEHOLDER__', JSON.stringify(_WORKER_HOOK_TEMPLATE));

  const _Worker = window.Worker;
  const _workerProxy = new Proxy(_Worker, {
    construct(target, args) {
      console.log('[Worker] CREATED', args[0], 'requestedOpts=', JSON.stringify(args[1] || null));
      const url = String(args[0]);
      const src = _WORKER_HOOK + '\ntry{importScripts(' + JSON.stringify(url) + ');}catch(e){self.postMessage({__n:"hookError",msg:"importScripts failed: "+String(e)});}';
      const blob = new Blob([src], { type: 'text/javascript' });
      const hookedURL = URL.createObjectURL(blob);
      const opts = args[1] ? Object.assign({}, args[1], { type: 'classic' }) : undefined;
      const worker = new target(hookedURL, opts);
      window._worker = worker;

      worker.addEventListener('error', function(ev) {
        console.error('[Worker] error event', ev.message, ev.filename, ev.lineno);
      });

      worker.addEventListener('message', function(ev) {
        if (!ev.data || !ev.data.__n) return;
        const msg = ev.data;
        if (msg.__n === 'hookInstalled') {
          console.log('[WorkerHook] installed OK inside worker');
        } else if (msg.__n === 'hookError') {
          console.error('[WorkerHook] FAILED inside worker:', msg.msg);
        } else if (msg.__n === 'nestedWorkerCreated') {
          console.log('[WorkerHook] nested worker created:', msg.url);
        } else if (msg.__n === 'url') {
          console.log('[Worker WS] connected to', msg.url);
          window._ws_worker = worker;
          window._ws_worker_url = msg.url;
          if (window.Gheloo) window.Gheloo.setStatus('green', msg.url);
        } else if (msg.__n === 'out' && msg.buf && msg.buf.byteLength >= 6) {
          const raw = msg.buf;
          if (_offsetsReady) {
            const _logId = new DataView(raw).getUint16(4) - _outOffset;
            try { addPacket('OUT', _logId, null, raw); } catch {}
            if (_logId === _findOutId('OpenFlatConnection')) {
              window._lastRoomEnterPacket = raw.slice(0);
            }
            if (_logId === 1314 && window._rejoinCommandEnabled && raw.byteLength > 8) {
              try {
                const _tLen = new DataView(raw).getUint16(6);
                const _txt  = new TextDecoder().decode(new Uint8Array(raw, 8, _tLen));
                if (_txt.toLowerCase() === ':rejoin') _rejoinNow();
              } catch(_e) {}
            }
          }
        } else if (msg.__n === 'in' && msg.buf && msg.buf.byteLength >= 6) {
          const raw = msg.buf;
          const _logId = new DataView(raw).getUint16(4) - _inOffset;
          const _bf = window._blockIncomingFilters[_logId];
          if (_bf !== undefined) {
            const _doBlock = typeof _bf === 'function' ? _bf(raw) : true;
            if (_doBlock) {
              ev.stopImmediatePropagation();
              try { addPacket('IN', _logId, null, raw); } catch {}
              return;
            }
          }
          try { addPacket('IN', _logId, null, raw); } catch {}
        }
      });

      return worker;
    }
  });
  try {
    Object.defineProperty(window, 'Worker', { value: _workerProxy, writable: true, configurable: true });
  } catch (e) {
    window.Worker = _workerProxy;
  }

  window.sendPacket = function(dir, logicalId, gEarthStr) {
    const payload = gEarthStr ? window.GPacket.fromExpression(gEarthStr).slice(6) : new ArrayBuffer(0);
    const raw = buildRawPacket(dir, logicalId, payload);
    if (!raw) { console.warn('[sendPacket] offsets not ready yet'); return false; }
    if (dir === 'OUT') {
      if (window._ws && window._ws.readyState === 1) { window._ws.send(raw); return true; }
      const _ww = window._ws_worker || window._worker;
      if (_ww) { const c = raw.slice(0); _ww.postMessage({ __n: 'send', buf: c }, [c]); return true; }
      console.warn('[sendPacket] no WebSocket yet'); return false;
    } else {
      if (window._ws) { window._ws.dispatchEvent(new MessageEvent('message', { data: raw })); return true; }
      console.warn('[sendPacket] IN injection not supported in worker mode'); return false;
    }
  };

  // makeWriter — binary writer, mirror of makeReader, for building outgoing payloads
  window.makeWriter = function() {
    const enc = new TextEncoder();
    const parts = [];
    return {
      int:   (v) => { const b=new ArrayBuffer(4); new DataView(b).setInt32(0,v);  parts.push(new Uint8Array(b)); },
      short: (v) => { const b=new ArrayBuffer(2); new DataView(b).setUint16(0,v); parts.push(new Uint8Array(b)); },
      bool:  (v) => { parts.push(new Uint8Array([v?1:0])); },
      byte:  (v) => { parts.push(new Uint8Array([v&0xFF])); },
      str:   (v) => { const e=enc.encode(String(v)); const b=new ArrayBuffer(2); new DataView(b).setUint16(0,e.length); parts.push(new Uint8Array(b)); parts.push(e); },
      build: () => {
        const total=parts.reduce((s,p)=>s+p.length,0);
        const out=new Uint8Array(total); let off=0;
        for (const p of parts) { out.set(p,off); off+=p.length; }
        return out.buffer;
      }
    };
  };

  // Action API
  window.Game = (function() {
    function _out(id, fn) {
      const w = window.makeWriter(); fn(w);
      const raw = buildRawPacket('OUT', id, w.build());
      if (!raw)        { console.warn('[Game] offsets not ready'); return false; }
      if (window._ws && window._ws.readyState === 1) { window._ws.send(raw); return true; }
      const _ww = window._ws_worker || window._worker;
      if (_ww) { const c = raw.slice(0); _ww.postMessage({ __n: 'send', buf: c }, [c]); return true; }
      console.warn('[Game] no WebSocket');
      return false;
    }
    return {
      say:     (text, style=0)       => _out(1314, w=>{w.str(text);w.int(style);}),
      shout:   (text, style=0)       => _out(2085, w=>{w.str(text);w.int(style);}),
      whisper: (name, text, style=0) => _out(1543, w=>{w.str(name);w.str(text);w.int(style);}),
      walkTo:  (x, y)                => _out(3320, w=>{w.int(x);w.int(y);}),
      dance:   (id=1)                => _out(2080, w=>{w.int(id);}),
      stand:   ()                    => _out(2080, w=>{w.int(0);}),
      sit:     ()                    => _out(2235, w=>{w.int(1);}),
      wave:    ()                    => _out(2456, w=>{w.int(1);}),
      blow:    ()                    => _out(2456, w=>{w.int(2);}),
      laugh:   ()                    => _out(2456, w=>{w.int(3);}),
      sign:    (id)                  => _out(1975, w=>{w.int(id);}),
      effect:  (id)                  => _out(1752, w=>{w.int(id);}),
    };
  })();

  window.packets = {
    all:     ()   => window._packetLog,
    in:      ()   => window._packetLog.filter(p=>p.direction==='IN'),
    out:     ()   => window._packetLog.filter(p=>p.direction==='OUT'),
    byId:    (id) => window._packetLog.filter(p=>p.header===id),
    byName:  (n)  => window._packetLog.filter(p=>p.name.toLowerCase().includes(n.toLowerCase())),
    clear:   ()   => { window._packetLog=[]; },
    offsets: ()   => ({ in: _inOffset, out: _outOffset, ready: _offsetsReady }),
  };

  window.addEventListener('message', function(ev) {
    if (ev.source !== window || !ev.data || ev.data.type !== '__ghk_apply_figure') return;
    const figure = ev.data.figure;
    const gender = (ev.data.gender || 'M').toUpperCase();
    if (!figure) return;
    const w = window.makeWriter();
    w.str(gender);
    w.str(figure);
    const raw = buildRawPacket('OUT', 2730, w.build());
    if (!raw) { console.warn('[applyFigure] offsets not ready'); return; }
    if (window._ws && window._ws.readyState === 1) window._ws.send(raw);
    else { const _ww = window._ws_worker || window._worker; if (_ww) { const c = raw.slice(0); _ww.postMessage({ __n: 'send', buf: c }, [c]); } }
  });
})();
