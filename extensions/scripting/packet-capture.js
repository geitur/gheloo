// Packet Capture — builds a persistent corpus of raw packet bytes, grouped by packet id,
// for offline structure inference (auto-generating draft PacketParsers entries).
//
// WHY RAW BYTES, NOT DECODED TEXT: both existing decoders lose information. logger.js's
// decodePayload() reads strings as Latin-1 (String.fromCharCode per byte) while
// makeReader() uses TextDecoder (UTF-8) — either one mangles any byte above 0x7F, which is
// exactly the bytes that appear in names/mottos/figures. Inference run on that corpus would
// be learning the decoder's bugs instead of the protocol. So this hooks the packet pipeline
// as early as it can and hex-encodes the ArrayBuffer directly, before anything interprets it.
//
// HEADER CONVENTION: every sample here includes the full 6-byte WS header (4-byte length +
// 2-byte packet id), i.e. exactly what came off the socket. parsers.js quotes all of its
// offsets relative to raw.slice(6) (see makeReader), so when comparing inference output to a
// hand-written parser, subtract HEADER_BYTES. Recorded explicitly in the export so a
// consumer never has to guess which convention a corpus file used.
//
// DUPLICATES ARE KEPT (as counts, not copies): a field that is byte-identical across every
// capture is how you detect the `r.int(); // always 0` padding fields that parsers.js is full
// of. Deduplicating them away destroys that signal, so identical samples increment a counter.
(function() {
  'use strict';

  const DB_NAME    = 'gheloo-pkt-capture';
  const STORE      = 'captures';
  const STATE_KEY  = '__ghk_pktcap_enabled';
  const HEADER_BYTES = 6;

  // Caps — a corpus is only useful if it's bounded, and this runs on every single packet.
  const MAX_DISTINCT_PER_ID = 200;    // distinct byte-patterns kept per packet id
  const MAX_SAMPLE_BYTES    = 65536;  // skip pathological packets (full inventory dumps etc.)
  const MAX_TOTAL_IDS       = 2000;   // hard ceiling on tracked packet ids
  const FLUSH_DEBOUNCE_MS   = 3000;

  // ws.js deliberately withholds these from PacketStore (they're high-frequency pollers that
  // would blow through its 300-entry ring buffer). They still dispatch through onPacket, so
  // they're picked up separately below — MarketPlaceOffers in particular is one of the most
  // structurally interesting packets in the protocol and must not be missing from the corpus.
  const HIDDEN_FROM_STORE = [
    'GetMarketplaceOffers', 'MarketPlaceOffers',
    'GetGiftWrappingConfiguration', 'GiftWrappingConfiguration',
    'BundleDiscountRuleset'
  ];

  let _enabled = true;
  try {
    const saved = localStorage.getItem(STATE_KEY);
    if (saved !== null) _enabled = saved === '1';
  } catch (_) {}

  // key: "IN:1234" → { direction, id, name, samples: Map<hex, count>, firstSeen, lastSeen, skipped }
  const _buckets = new Map();
  let _dirty = false, _flushTimer = 0, _db = null;

  const HEX = [];
  for (let i = 0; i < 256; i++) HEX.push(i.toString(16).padStart(2, '0'));

  function toHex(ab) {
    const b = new Uint8Array(ab);
    let s = '';
    for (let i = 0; i < b.length; i++) s += HEX[b[i]];
    return s;
  }

  function fromHex(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out.buffer;
  }

  // ── Storage ────────────────────────────────────────────────────────────────────────
  function _openDb() {
    if (_db) return Promise.resolve(_db);
    return new Promise(function(resolve, reject) {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function() {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = function() { _db = req.result; resolve(_db); };
      req.onerror   = function() { reject(req.error); };
    });
  }

  function _serializeBucket(b) {
    const samples = [];
    b.samples.forEach(function(count, hex) { samples.push({ hex: hex, count: count }); });
    return {
      direction: b.direction, id: b.id, name: b.name,
      firstSeen: b.firstSeen, lastSeen: b.lastSeen,
      skipped: b.skipped, samples: samples
    };
  }

  function _flush() {
    if (!_dirty) return Promise.resolve();
    _dirty = false;
    return _openDb().then(function(db) {
      const tx = db.transaction(STORE, 'readwrite');
      const os = tx.objectStore(STORE);
      _buckets.forEach(function(b, key) { os.put(_serializeBucket(b), key); });
      return new Promise(function(resolve) {
        tx.oncomplete = function() { resolve(); };
        tx.onerror    = function() { resolve(); };
      });
    }).catch(function(e) { console.warn('[PktCapture] flush failed:', e); });
  }

  function _scheduleFlush() {
    _dirty = true;
    if (_flushTimer) return;
    _flushTimer = setTimeout(function() { _flushTimer = 0; _flush(); }, FLUSH_DEBOUNCE_MS);
  }
  // Best-effort final flush — pagehide fires on real navigations where unload often doesn't.
  window.addEventListener('pagehide', function() { _flush(); });

  function _loadFromDb() {
    return _openDb().then(function(db) {
      return new Promise(function(resolve) {
        const tx  = db.transaction(STORE, 'readonly');
        const os  = tx.objectStore(STORE);
        const req = os.openCursor();
        req.onsuccess = function() {
          const cur = req.result;
          if (!cur) { resolve(); return; }
          const v = cur.value;
          const map = new Map();
          (v.samples || []).forEach(function(s) { map.set(s.hex, s.count); });
          _buckets.set(cur.key, {
            direction: v.direction, id: v.id, name: v.name,
            samples: map, firstSeen: v.firstSeen, lastSeen: v.lastSeen,
            skipped: v.skipped || 0
          });
          cur.continue();
        };
        req.onerror = function() { resolve(); };
      });
    }).catch(function(e) { console.warn('[PktCapture] load failed:', e); });
  }

  // ── Capture ────────────────────────────────────────────────────────────────────────
  function _record(p) {
    if (!_enabled || !p || !p.raw) return;
    try {
      const len = p.raw.byteLength;
      if (len <= HEADER_BYTES) return;

      const dir = p.direction || '?';
      const id  = p.header;
      if (id == null) return;
      const key = dir + ':' + id;

      let b = _buckets.get(key);
      if (!b) {
        if (_buckets.size >= MAX_TOTAL_IDS) return;
        b = { direction: dir, id: id, name: p.name || '', samples: new Map(),
              firstSeen: Date.now(), lastSeen: Date.now(), skipped: 0 };
        _buckets.set(key, b);
      }
      // A name can show up later than the first sighting (parser registered after the fact).
      if (!b.name && p.name) b.name = p.name;
      b.lastSeen = Date.now();

      if (len > MAX_SAMPLE_BYTES) { b.skipped++; _scheduleFlush(); return; }

      const hex = toHex(p.raw);
      const existing = b.samples.get(hex);
      if (existing !== undefined) {
        // Repeat of a byte-pattern already held: bump the count. This is the evidence that
        // makes constant-field detection possible, so it is never discarded.
        b.samples.set(hex, existing + 1);
        _scheduleFlush();
        return;
      }
      if (b.samples.size >= MAX_DISTINCT_PER_ID) { b.skipped++; return; }
      b.samples.set(hex, 1);
      _scheduleFlush();
    } catch (_e) { /* capture must never break the packet pipeline */ }
  }

  function _install() {
    if (!window.PacketStore || !window.onPacket) return false;

    // Covers everything that reaches PacketStore, named or not.
    window.PacketStore.subscribe(_record);

    // ...plus the handful ws.js withholds from PacketStore. These still dispatch through
    // onPacket, and can't reach _record twice: they never enter PacketStore at all.
    HIDDEN_FROM_STORE.forEach(function(name) { window.onPacket(name, _record); });
    return true;
  }

  // ── Export ─────────────────────────────────────────────────────────────────────────
  function _buildExport(filter) {
    const packets = [];
    _buckets.forEach(function(b) {
      if (filter && !filter(b)) return;
      const s = _serializeBucket(b);
      s.distinct = s.samples.length;
      s.total    = s.samples.reduce(function(a, x) { return a + x.count; }, 0);
      packets.push(s);
    });
    packets.sort(function(a, b) { return b.total - a.total; });
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      headerBytes: HEADER_BYTES,
      note: 'hex includes the full 6-byte WS header (4-byte length + 2-byte packet id). '
          + 'core/parsers.js offsets are relative to raw.slice(6) — subtract headerBytes when comparing.',
      stringEncoding: 'none — raw bytes, undecoded',
      packets: packets
    };
  }

  function _download(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  }

  // ── Public API ─────────────────────────────────────────────────────────────────────
  window.__pkt_capture = {
    HEADER_BYTES: HEADER_BYTES,

    start: function() {
      _enabled = true;
      try { localStorage.setItem(STATE_KEY, '1'); } catch (_) {}
      console.log('[PktCapture] recording');
    },
    stop: function() {
      _enabled = false;
      try { localStorage.setItem(STATE_KEY, '0'); } catch (_) {}
      _flush();
      console.log('[PktCapture] stopped');
    },
    isRecording: function() { return _enabled; },

    // Console summary, busiest packets first.
    stats: function() {
      const rows = [];
      _buckets.forEach(function(b) {
        let total = 0;
        b.samples.forEach(function(c) { total += c; });
        rows.push({
          packet: (b.name || '(unknown)') + ' [' + b.direction + ':' + b.id + ']',
          distinct: b.samples.size,
          total: total,
          skipped: b.skipped
        });
      });
      rows.sort(function(a, b) { return b.total - a.total; });
      console.table(rows);
      const totals = rows.reduce(function(a, r) { return a + r.total; }, 0);
      console.log('[PktCapture] ' + rows.length + ' packet ids, ' + totals + ' packets, recording=' + _enabled);
      return rows;
    },

    // Raw ArrayBuffers for one packet, ready to feed an inference pass in the console.
    // Expanded by count so repeated byte-patterns carry their real weight.
    samples: function(nameOrId, direction) {
      const out = [];
      _buckets.forEach(function(b) {
        const match = (typeof nameOrId === 'number')
          ? b.id === nameOrId
          : String(b.name).toLowerCase() === String(nameOrId).toLowerCase();
        if (!match) return;
        if (direction && b.direction !== direction) return;
        b.samples.forEach(function(count, hex) {
          for (let i = 0; i < count; i++) out.push(fromHex(hex));
        });
      });
      return out;
    },

    // Distinct patterns with their counts — what the inference actually wants: constant
    // fields are visible as bytes that never differ across entries.
    distinct: function(nameOrId, direction) {
      const out = [];
      _buckets.forEach(function(b) {
        const match = (typeof nameOrId === 'number')
          ? b.id === nameOrId
          : String(b.name).toLowerCase() === String(nameOrId).toLowerCase();
        if (!match) return;
        if (direction && b.direction !== direction) return;
        b.samples.forEach(function(count, hex) {
          out.push({ hex: hex, count: count, raw: fromHex(hex) });
        });
      });
      return out;
    },

    toHex: toHex,
    fromHex: fromHex,

    export: function() { return _buildExport(null); },

    // Whole corpus to a file.
    download: function() {
      return _flush().then(function() {
        _download(_buildExport(null), 'gheloo-packet-corpus-' + Date.now() + '.json');
      });
    },

    // One packet to a file — the usual starting point (e.g. downloadOne('MarketPlaceOffers')).
    downloadOne: function(nameOrId, direction) {
      const filter = function(b) {
        const match = (typeof nameOrId === 'number')
          ? b.id === nameOrId
          : String(b.name).toLowerCase() === String(nameOrId).toLowerCase();
        return match && (!direction || b.direction === direction);
      };
      return _flush().then(function() {
        const obj = _buildExport(filter);
        if (!obj.packets.length) { console.warn('[PktCapture] no captures for', nameOrId); return; }
        _download(obj, 'gheloo-corpus-' + (obj.packets[0].name || obj.packets[0].id) + '.json');
      });
    },

    flush: function() { _dirty = true; return _flush(); },

    clear: function() {
      _buckets.clear();
      return _openDb().then(function(db) {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        return new Promise(function(resolve) { tx.oncomplete = function() { resolve(); }; });
      }).then(function() { console.log('[PktCapture] cleared'); });
    }
  };

  // ── Boot ───────────────────────────────────────────────────────────────────────────
  // Load the existing corpus before recording, so counts accumulate across sessions instead
  // of each reload starting from zero (the whole point is building up rare packets over time).
  _loadFromDb().then(function() {
    if (!_install()) {
      // ws.js owns PacketStore/onPacket and is listed before this file in manifest.json, so
      // this should not happen — fail loudly rather than silently recording nothing.
      console.error('[PktCapture] PacketStore/onPacket unavailable — capture NOT installed. '
                  + 'Check that core/ws.js loads before this file in manifest.json.');
      return;
    }
    console.log('[PktCapture] ready — ' + _buckets.size + ' packet ids restored. '
              + 'recording=' + _enabled + '. API: window.__pkt_capture (.stats(), .downloadOne(name), .stop())');
  });
})();
