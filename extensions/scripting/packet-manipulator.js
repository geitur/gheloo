(function() {
  if (document.getElementById('__gman_panel')) return;

  const STORAGE_KEY = '__ghk_gman_rules';

  let rules = _loadRules();
  if (_applyPersistReset()) _saveRules(); // no UI yet at this point — nothing to re-render

  function _loadRules() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(data) ? data : [];
    } catch (_) { return []; }
  }
  function _saveRules() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rules)); } catch (_) {}
  }

  // Rules default to persist === true (missing field on older saved rules also counts as
  // persistent, so existing setups keep behaving the way they always did). A rule marked
  // persist:false instead comes back disabled every time this runs — on the very first
  // load, and again on every login (UserObject fires on relog too, not just a full page
  // reload) — so a "just testing this" rule can't accidentally stay armed across sessions.
  // Pure mutation only, no UI touch — safe to call before the panel exists.
  function _applyPersistReset() {
    let changed = false;
    rules.forEach(function(r) {
      if (r.persist === false && r.enabled) { r.enabled = false; changed = true; }
    });
    return changed;
  }
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function _shortFromId(id, dir) {
    const full = window.PKT && window.PKT[dir] && window.PKT[dir][id];
    return full ? window.shortName(full, dir) : '';
  }

  // Resolve a user-typed value (numeric id or packet short/full name) to concrete
  // {dir,id} pairs, for one specific direction only — a live packet always already
  // knows which side it's on, so there's no "BOTH" ambiguity to resolve here.
  function resolveIds(value, dir) {
    const found = [];
    if (/^\d+$/.test(value)) { found.push({ dir, id: parseInt(value, 10) }); return found; }
    const table = (window.PKT && window.PKT[dir]) || {};
    Object.entries(table).forEach(function(entry) {
      const id = parseInt(entry[0], 10);
      const full = entry[1];
      const short = window.shortName(full, dir);
      if (short.toLowerCase() === value.toLowerCase() || full.toLowerCase() === value.toLowerCase()) {
        found.push({ dir, id });
      }
    });
    return found;
  }

  // ---- byte-level packet rewriting (G-Manipulate-style rules operate directly on the
  // wire bytes: [4b total length][2b header][payload]). All functions here take/return
  // a full frame ArrayBuffer, or null when nothing changed. ----

  // Scans every offset in the payload for a big-endian int32 equal to `value`; overwrites
  // in place with `replacement` (same length, no length-prefix repacking needed). This
  // isn't structure-aware (it doesn't know field boundaries) — same tradeoff G-Earth's
  // own HPacket.replaceAllIntegers makes; a value that happens to straddle a string's
  // bytes could theoretically false-positive, but in practice int fields are what get hit.
  function _replaceAllIntegers(raw, value, replacement) {
    const bytes = new Uint8Array(raw.slice(0));
    const view = new DataView(bytes.buffer);
    let changed = false;
    for (let i = 6; i + 4 <= bytes.length; i++) {
      if (view.getInt32(i) === value) { view.setInt32(i, replacement); changed = true; }
    }
    return changed ? bytes.buffer : null;
  }

  function _encodeString(str) {
    const out = new Uint8Array(2 + str.length);
    new DataView(out.buffer).setUint16(0, str.length);
    for (let i = 0; i < str.length; i++) out[2 + i] = str.charCodeAt(i) & 0xFF;
    return out;
  }

  function _spliceBytes(bytes, start, len, replacementBytes) {
    const out = new Uint8Array(bytes.length - len + replacementBytes.length);
    out.set(bytes.subarray(0, start), 0);
    out.set(replacementBytes, start);
    out.set(bytes.subarray(start + len), start + replacementBytes.length);
    return out;
  }

  // Walks the payload looking for length-prefixed string tokens ([u16 len][len bytes]) —
  // the same heuristic the Packet Logger's decoder uses (reject a candidate if it'd
  // swallow control bytes in its first few characters, since that's almost never a real
  // string boundary). `exact` = whole-string match (Replace string), otherwise substring
  // match anywhere inside a found string (Replace substring).
  function _replaceAllStrings(raw, value, replacement, exact) {
    let bytes = new Uint8Array(raw.slice(0));
    let changed = false;
    let i = 6;
    while (i + 2 <= bytes.length) {
      const view = new DataView(bytes.buffer);
      const slen = view.getUint16(i);
      if (slen > 0 && i + 2 + slen <= bytes.length && slen <= 4096) {
        let ok = true;
        for (let j = 0; j < Math.min(slen, 8); j++) { if (bytes[i + 2 + j] < 9) { ok = false; break; } }
        if (ok) {
          let str = '';
          for (let j = 0; j < slen; j++) str += String.fromCharCode(bytes[i + 2 + j]);
          let newStr = null;
          if (exact) { if (str === value) newStr = replacement; }
          else if (str.indexOf(value) !== -1) { newStr = str.split(value).join(replacement); }
          if (newStr !== null && newStr !== str) {
            const encoded = _encodeString(newStr);
            bytes = _spliceBytes(bytes, i, 2 + slen, encoded);
            changed = true;
            i += encoded.length;
            continue;
          }
          i += 2 + slen;
          continue;
        }
      }
      i++;
    }
    if (!changed) return null;
    new DataView(bytes.buffer).setInt32(0, bytes.length - 4); // total length = frame - 4b length field
    return bytes.buffer;
  }

  // Whole-packet replace: keeps the original wire header bytes (so it still matches the
  // logical packet id regardless of any offset shift) and swaps only the payload, built
  // from the same {i:}{s:""}{b:}{u:}{l:} mini-language Packet Sender uses.
  function _replacePacketBody(raw, exprString) {
    const bytes = new Uint8Array(raw.slice(0));
    const headerBytes = bytes.subarray(4, 6);
    let payload;
    try {
      const built = window.GPacket.fromExpression(exprString);
      payload = new Uint8Array(built).subarray(6);
    } catch (e) { return null; }
    const out = new Uint8Array(6 + payload.length);
    new DataView(out.buffer).setInt32(0, 2 + payload.length);
    out.set(headerBytes, 4);
    out.set(payload, 6);
    return out.buffer;
  }

  // ---- rule engine ----

  function applyRulesToPacket(raw, dirLabel, logId) {
    let buffer = raw;
    for (let ri = 0; ri < rules.length; ri++) {
      const rule = rules[ri];
      if (!rule.enabled) continue;
      if (rule.side !== 'ALL' && rule.side !== dirLabel) continue;
      if (rule.type === 'block') {
        const blank = rule.value.trim() === '';
        const ids = blank ? null : resolveIds(rule.value, dirLabel);
        if (blank || (ids && ids.some(function(x) { return x.id === logId; }))) {
          setStatus('Geblokkeerd ' + dirLabel + ': ' + (_shortFromId(logId, dirLabel) || ('#' + logId)));
          return { block: true };
        }
      } else if (rule.type === 'replace_packet') {
        const ids = resolveIds(rule.value, dirLabel);
        if (ids.some(function(x) { return x.id === logId; })) {
          const newBuf = _replacePacketBody(buffer, rule.replacement);
          if (newBuf) { buffer = newBuf; setStatus('Vervangen ' + dirLabel + ': ' + (_shortFromId(logId, dirLabel) || ('#' + logId))); }
        }
      } else if (rule.type === 'replace_int') {
        const v = parseInt(rule.value, 10), r = parseInt(rule.replacement, 10);
        if (!isNaN(v) && !isNaN(r)) {
          const newBuf = _replaceAllIntegers(buffer, v, r);
          if (newBuf) { buffer = newBuf; setStatus('Integer vervangen in ' + dirLabel + ' #' + logId); }
        }
      } else if (rule.type === 'replace_string' || rule.type === 'replace_substring') {
        const newBuf = _replaceAllStrings(buffer, rule.value, rule.replacement, rule.type === 'replace_string');
        if (newBuf) { buffer = newBuf; setStatus('Tekst vervangen in ' + dirLabel + ' #' + logId); }
      }
    }
    return buffer === raw ? undefined : { buffer };
  }

  const TYPE_LABELS = {
    block: 'Blokkeer packet',
    replace_packet: 'Vervang packet',
    replace_int: 'Vervang integer',
    replace_string: 'Vervang string',
    replace_substring: 'Vervang substring',
  };

  // Colored packet syntax matches the Packet Logger's decode-token palette (s=green,
  // i=blue) so an example here reads the same way a real captured packet does there.
  // The part a rule actually touches gets a highlight chip nested inside that coloring —
  // dashed red for "before", solid green for "after".
  const TYPE_EXPLANATIONS = {
    block: {
      text: 'Blokkeert dit packet volledig, het bereikt server/client niet. Laat "Waarde" leeg om ALLE packets aan de gekozen kant te blokkeren.',
      example: '<span class="__gman_ex_old" style="text-decoration:line-through;color:#82849a">{in:Chat}<span style="color:#5b9cf6">{i:12}</span><span style="color:#2ecc71">{s:"hallo"}</span><span style="color:#5b9cf6">{i:0}</span></span>' +
        '<span class="__gman_ex_arrow">&rarr;</span><span style="color:#e74c3c">komt nooit aan</span>',
    },
    replace_packet: {
      text: 'Vervangt de volledige inhoud van dit ene packet (gezocht op naam of ID) door een nieuwe body. De header blijft hetzelfde, alleen de payload verandert.',
      example: '<span style="color:#82849a">{out:Chat}</span><span class="__gman_ex_old" style="color:#2ecc71">{s:"hallo"}</span><span class="__gman_ex_old" style="color:#5b9cf6">{i:0}</span>' +
        '<span class="__gman_ex_arrow">&rarr;</span><span style="color:#82849a">{out:Chat}</span><span class="__gman_ex_new" style="color:#2ecc71">{s:"aangepast"}</span><span class="__gman_ex_new" style="color:#5b9cf6">{i:5}</span>',
    },
    replace_int: {
      text: 'Zoekt dit exacte getal in ALLE packets aan de gekozen kant en vervangt elke match — ongeacht om welk packet het gaat.',
      example: '<span style="color:#2ecc71">{s:"level"}</span><span class="__gman_ex_old" style="color:#5b9cf6">{i:5}</span>' +
        '<span class="__gman_ex_arrow">&rarr;</span><span style="color:#2ecc71">{s:"level"}</span><span class="__gman_ex_new" style="color:#5b9cf6">{i:99}</span>',
    },
    replace_string: {
      text: 'Zoekt deze tekst als complete string-waarde (exacte match) in ALLE packets aan de gekozen kant en vervangt hem.',
      example: '<span class="__gman_ex_old" style="color:#2ecc71">{s:"hallo"}</span>' +
        '<span class="__gman_ex_arrow">&rarr;</span><span class="__gman_ex_new" style="color:#2ecc71">{s:"dag"}</span>',
    },
    replace_substring: {
      text: 'Zoekt deze tekst als stukje van een langere string in ALLE packets aan de gekozen kant en vervangt alleen dat stukje, de rest van de string blijft staan.',
      example: '<span style="color:#2ecc71">{s:"hallo <span class="__gman_ex_old">wereld</span>"}</span>' +
        '<span class="__gman_ex_arrow">&rarr;</span><span style="color:#2ecc71">{s:"hallo <span class="__gman_ex_new">aarde</span>"}</span>',
    },
  };

  // ---- UI ----
  // Everything below touches the DOM, so it's built inside init(), called only once
  // __ghk_ready fires — this script runs at document_start, before document.body exists.

  let panel, typeInput, sideWrap, valueInput, replInput, explainEl, statusEl, rulesEl, countEl, addBtn, cancelEditBtn;
  let editingId = null;

  function setStatus(text) { if (statusEl) statusEl.textContent = text || ''; }
  function getSide() { const r = panel.querySelector('input[name="__gman_side"]:checked'); return r ? r.value : 'IN'; }

  function render() {
    renderRules();
    countEl.textContent = rules.filter(function(r) { return r.enabled; }).length + ' actief';
  }

  function renderRules() {
    if (!rules.length) {
      rulesEl.innerHTML = '<div id="__gman_empty">Nog geen regels</div>';
      return;
    }
    rulesEl.innerHTML = rules.map(function(rule) {
      const valTxt = rule.type === 'block' && rule.value.trim() === '' ? 'ALLES' : rule.value;
      const summary = rule.type === 'block'
        ? _esc(valTxt)
        : _esc(valTxt) + '  &rarr;  ' + _esc(rule.replacement);
      const cls = rule.side === 'IN' ? '__gman_tag_in' : (rule.side === 'OUT' ? '__gman_tag_out' : '__gman_tag_both');
      const persistent = rule.persist !== false;
      return '<div class="__gman_rrow' + (rule.enabled ? '' : ' __gman_off') + (rule.id === editingId ? ' __gman_editing' : '') + '">' +
        '<span class="__gman_tag ' + cls + '">' + _esc(rule.side) + '</span>' +
        '<span class="__gman_rtype">' + _esc(TYPE_LABELS[rule.type] || rule.type) + '</span>' +
        '<span class="__gman_rsum" title="' + summary + '">' + summary + '</span>' +
        '<button class="__snd_btn __snd_btn_sm __snd_btn_secondary" data-action="persist" data-id="' + _esc(rule.id) + '" title="' + (persistent ? 'Blijft aan na relog — klik om sessie-only te maken' : 'Sessie-only: gaat elke relog automatisch uit — klik om te laten blijven staan') + '">' + (persistent ? 'Blijft aan' : 'Sessie') + '</button>' +
        '<button class="__snd_btn __snd_btn_sm __snd_btn_secondary" data-action="toggle" data-id="' + _esc(rule.id) + '">' + (rule.enabled ? 'On' : 'Off') + '</button>' +
        '<button class="__snd_btn __snd_btn_sm __snd_btn_secondary" data-action="edit" data-id="' + _esc(rule.id) + '">Edit</button>' +
        '<button class="__snd_btn __snd_btn_sm __snd_btn_danger" data-action="delete" data-id="' + _esc(rule.id) + '">&#x2715;</button>' +
      '</div>';
    }).join('');
  }

  // Mirrors G-Manipulate's dynamic form: side options, value/replacement placeholders
  // and the explanation text all change depending on the selected rule type.
  function refreshForm() {
    const type = typeInput.value;
    const isPacketType = type === 'block' || type === 'replace_packet';

    const curSide = getSide();
    sideWrap.innerHTML =
      '<label class="__gman_radio"><input type="radio" name="__gman_side" value="IN"> Inkomend</label>' +
      '<label class="__gman_radio"><input type="radio" name="__gman_side" value="OUT"> Uitgaand</label>' +
      (isPacketType ? '' : '<label class="__gman_radio"><input type="radio" name="__gman_side" value="ALL"> Beide</label>');
    const wanted = (isPacketType && curSide === 'ALL') ? 'IN' : curSide;
    const toCheck = sideWrap.querySelector('input[value="' + wanted + '"]') || sideWrap.querySelector('input');
    toCheck.checked = true;

    replInput.disabled = type === 'block';
    if (type === 'block') replInput.value = '';

    const placeholders = {
      block: 'Packet naam of ID (leeg = alles)',
      replace_packet: 'Packet naam of ID',
      replace_int: 'Getal om te zoeken',
      replace_string: 'Tekst om te zoeken (exact)',
      replace_substring: 'Tekst om te zoeken (substring)',
    };
    valueInput.placeholder = placeholders[type];

    const replPlaceholders = {
      replace_packet: 'Nieuwe body, bv. {s:"hi"}{i:5}',
      replace_int: 'Nieuw getal',
      replace_string: 'Vervang door',
      replace_substring: 'Vervang door',
    };
    replInput.placeholder = replPlaceholders[type] || '';

    const info = TYPE_EXPLANATIONS[type];
    explainEl.innerHTML = info
      ? _esc(info.text) + '<div class="__gman_ex_lbl">Voorbeeld</div><div class="__gman_ex">' + info.example + '</div>'
      : '';
  }

  function isValidRule(type, side, value, repl) {
    if (!side) return false;
    if (type === 'block') return true; // blank value = block everything on that side
    if (type === 'replace_packet') {
      if (!value.trim() || !repl.trim()) return false;
      try { window.GPacket.fromExpression(repl); return true; } catch (_e) { return false; }
    }
    if (type === 'replace_int') {
      const v = parseInt(value, 10), r = parseInt(repl, 10);
      return !isNaN(v) && !isNaN(r) && v !== r && /^-?\d+$/.test(value.trim()) && /^-?\d+$/.test(repl.trim());
    }
    if (type === 'replace_string' || type === 'replace_substring') {
      return value !== '' && repl !== '' && value !== repl;
    }
    return false;
  }

  function buildPanel() {
    const style = document.createElement('style');
    style.textContent = [
      '#__gman_panel{position:fixed;top:16px;right:16px;width:560px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__gman_panel *{box-sizing:border-box}',
      '.__gman_card{display:flex;flex-direction:column;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb}',
      '.__gman_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__gman_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}',
      '.__gman_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__gman_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__gman_close:hover{color:#eceefb}',
      '#__gman_body{padding:14px;display:flex;flex-direction:column;gap:9px}',
      '.__gman_row{display:flex;gap:8px;align-items:center}',
      '.__gman_lbl{flex-shrink:0;width:88px;color:#82849a;font-size:11px}',
      '.__gman_input,.__gman_select{flex:1;min-width:0;background:#0A0B10;border:1px solid #23252f;border-radius:8px;color:#eceefb;padding:6px 8px;font-size:11px}',
      '.__gman_input{font-family:monospace}',
      '.__gman_input:focus,.__gman_select:focus{outline:none;border-color:#6C7CFF}',
      '.__gman_input:disabled{opacity:.4}',
      '.__gman_radio{display:flex;align-items:center;gap:4px;color:#82849a;font-size:11px;cursor:pointer;flex-shrink:0}',
      '.__gman_radio input{accent-color:#6C7CFF}',
      '.__gman_explain{background:#1c1e2a;border:1px solid #23252f;border-radius:8px;padding:8px 10px;font-size:10px;color:#82849a;line-height:1.6}',
      '.__gman_ex_lbl{margin-top:8px;font-size:9px;font-weight:900;text-transform:uppercase;color:#5c5e6b;letter-spacing:.6px}',
      '.__gman_ex{margin-top:3px;font-family:monospace;font-size:11px;line-height:1.9;word-break:break-all}',
      '.__gman_ex_arrow{color:#5c5e6b;padding:0 8px}',
      '.__gman_ex_old{background:rgba(231,76,60,0.16);border:1px dashed #e74c3c;border-radius:4px;padding:0 3px}',
      '.__gman_ex_new{background:rgba(46,204,113,0.16);border:1px solid #2ecc71;border-radius:4px;padding:0 3px}',
      '#__gman_status{min-height:14px;color:#82849a;font-size:10px}',
      '.__gman_title2{font-size:9px;font-weight:900;text-transform:uppercase;color:#5c5e6b;letter-spacing:.6px}',
      '.__gman_table{overflow:auto;background:#0A0B10;border:1px solid #23252f;border-radius:8px;max-height:220px}',
      '.__gman_rrow{display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:10px}',
      '.__gman_rrow:last-child{border-bottom:none}',
      '.__gman_rrow:hover{background:rgba(255,255,255,0.03)}',
      '.__gman_rrow.__gman_off{opacity:.4}',
      '.__gman_rrow.__gman_editing{background:rgba(108,124,255,0.10);border-left:2px solid #6C7CFF}',
      '.__gman_rtype{flex:0 0 108px;color:#82849a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.__gman_rsum{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#eceefb;font-family:monospace}',
      '#__gman_empty{padding:20px;font-size:11px;text-align:center;color:#5c5e6b}',
      '.__gman_tag{flex:0 0 auto;display:inline-block;font-weight:800;text-align:center;border-radius:5px;padding:2px 6px;font-size:9px;font-family:monospace}',
      '.__gman_tag_in{background:rgba(46,204,113,0.14);color:#2ecc71}',
      '.__gman_tag_out{background:rgba(91,156,246,0.14);color:#5b9cf6}',
      '.__gman_tag_both{background:rgba(108,124,255,0.14);color:#A6B0FF}',
      '#__gman_footer{display:flex;gap:6px;align-items:center;justify-content:space-between}',
      '#__gman_count{color:#5c5e6b;font-size:10px}',
      // House button classes shared with Packet Sender's look, scoped locally so this
      // file doesn't depend on load order with sender.js.
      '.__snd_btn{border:none;border-radius:8px;font-size:11px;font-weight:600;padding:6px 10px;cursor:pointer}',
      '.__snd_btn:disabled{opacity:.4;cursor:not-allowed}',
      '.__snd_btn_sm{font-size:9px;padding:3px 8px}',
      '.__snd_btn_primary,.__snd_btn_success{background:#A6B0FF;color:#0A0B10}',
      '.__snd_btn_primary:hover:not(:disabled),.__snd_btn_success:hover:not(:disabled){filter:brightness(1.08)}',
      '.__snd_btn_secondary{background:#1c1e2a;color:#eceefb;border:1px solid #23252f}',
      '.__snd_btn_secondary:hover:not(:disabled){background:rgba(255,255,255,0.06)}',
      '.__snd_btn_danger{background:rgba(231,76,60,0.15);color:#e74c3c}',
      '.__snd_btn_danger:hover:not(:disabled){background:rgba(231,76,60,0.28)}',
    ].join('');
    document.head.appendChild(style);

    panel = document.createElement('div');
    panel.id = '__gman_panel';
    panel.innerHTML =
      '<div class="__gman_card">' +
        '<div class="__gman_hdr" id="__gman_hdr">' +
          '<span class="__gman_eyebrow">Gheloo</span>' +
          '<span class="__gman_title">Packet Manipulator</span>' +
          '<span class="__gman_close" id="__gman_close">&times;</span>' +
        '</div>' +
        '<div id="__gman_body">' +
          '<div class="__gman_row">' +
            '<span class="__gman_lbl">Type:</span>' +
            '<select id="__gman_type" class="__gman_select">' +
              '<option value="block">Blokkeer packet</option>' +
              '<option value="replace_packet">Vervang packet</option>' +
              '<option value="replace_int">Vervang integer</option>' +
              '<option value="replace_string">Vervang string</option>' +
              '<option value="replace_substring">Vervang substring</option>' +
            '</select>' +
          '</div>' +
          '<div id="__gman_explain" class="__gman_explain"></div>' +
          '<div class="__gman_row">' +
            '<span class="__gman_lbl">Kant:</span>' +
            '<div id="__gman_side" class="__gman_row" style="gap:14px"></div>' +
          '</div>' +
          '<div class="__gman_row">' +
            '<span class="__gman_lbl">Waarde:</span>' +
            '<input id="__gman_value" class="__gman_input" placeholder="">' +
          '</div>' +
          '<div class="__gman_row">' +
            '<span class="__gman_lbl">Vervang door:</span>' +
            '<input id="__gman_repl" class="__gman_input" placeholder="">' +
            '<button id="__gman_cancel_edit" class="__snd_btn __snd_btn_sm __snd_btn_secondary" style="flex-shrink:0;display:none">Annuleer</button>' +
            '<button id="__gman_add" class="__snd_btn __snd_btn_primary" style="flex-shrink:0" disabled>+ Regel</button>' +
          '</div>' +
          '<div id="__gman_status"></div>' +
          '<div class="__gman_title2">Regels</div>' +
          '<div id="__gman_rules" class="__gman_table"></div>' +
          '<div id="__gman_footer">' +
            '<button id="__gman_clear" class="__snd_btn __snd_btn_sm __snd_btn_secondary">Alle regels wissen</button>' +
            '<span id="__gman_count"></span>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(panel);
    panel.style.display = 'none';

    typeInput  = panel.querySelector('#__gman_type');
    sideWrap   = panel.querySelector('#__gman_side');
    valueInput = panel.querySelector('#__gman_value');
    replInput  = panel.querySelector('#__gman_repl');
    explainEl  = panel.querySelector('#__gman_explain');
    statusEl   = panel.querySelector('#__gman_status');
    rulesEl    = panel.querySelector('#__gman_rules');
    countEl    = panel.querySelector('#__gman_count');

    addBtn = panel.querySelector('#__gman_add');
    cancelEditBtn = panel.querySelector('#__gman_cancel_edit');

    function updateAddState() {
      addBtn.disabled = !isValidRule(typeInput.value, getSide(), valueInput.value, replInput.value);
    }

    typeInput.addEventListener('change', function() { refreshForm(); updateAddState(); });
    sideWrap.addEventListener('change', updateAddState);
    valueInput.addEventListener('input', updateAddState);
    replInput.addEventListener('input', updateAddState);

    refreshForm();
    updateAddState();

    function stopEditing() {
      editingId = null;
      cancelEditBtn.style.display = 'none';
      addBtn.textContent = '+ Regel';
      valueInput.value = '';
      replInput.value = '';
      updateAddState();
    }

    addBtn.addEventListener('click', function() {
      const type = typeInput.value, side = getSide(), value = valueInput.value.trim(), repl = replInput.value.trim();
      if (!isValidRule(type, side, value, repl)) return;
      if (editingId !== null) {
        const rule = rules.find(function(r) { return r.id === editingId; });
        if (rule) { rule.type = type; rule.side = side; rule.value = value; rule.replacement = repl; }
        _saveRules();
        stopEditing();
        render();
        setStatus('Regel bijgewerkt.');
        return;
      }
      rules.unshift({
        id: Date.now() + ':' + Math.random().toString(16).slice(2),
        type, side, value, replacement: repl, enabled: true, persist: true,
      });
      _saveRules();
      render();
      valueInput.value = '';
      replInput.value = '';
      updateAddState();
      setStatus('Regel toegevoegd.');
    });

    cancelEditBtn.addEventListener('click', function() {
      stopEditing();
      render();
    });

    panel.querySelector('#__gman_clear').addEventListener('click', function() {
      rules = [];
      _saveRules();
      render();
      setStatus('Alle regels gewist.');
    });

    rulesEl.addEventListener('click', function(e) {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      const rule = rules.find(function(r) { return r.id === id; });
      if (!rule) return;
      const action = btn.getAttribute('data-action');
      if (action === 'toggle') rule.enabled = !rule.enabled;
      if (action === 'persist') rule.persist = rule.persist === false;
      if (action === 'delete') {
        rules = rules.filter(function(r) { return r.id !== id; });
        if (editingId === id) stopEditing();
      }
      if (action === 'edit') {
        editingId = id;
        typeInput.value = rule.type;
        refreshForm();
        const radio = sideWrap.querySelector('input[value="' + rule.side + '"]');
        if (radio) radio.checked = true;
        valueInput.value = rule.value;
        replInput.value = rule.type === 'block' ? '' : rule.replacement;
        cancelEditBtn.style.display = '';
        addBtn.textContent = 'Opslaan';
        updateAddState();
        setStatus('Regel bewerken — pas aan en klik Opslaan.');
      }
      _saveRules();
      render();
    });

    panel.querySelector('#__gman_close').addEventListener('click', function() { panel.style.display = 'none'; });

    window.__ghk_makeDraggable(panel, panel.querySelector('#__gman_hdr'), '__ghk_gman_pos', function(e) {
      return ['BUTTON', 'INPUT', 'SELECT'].includes(e.target.tagName) || e.target.id === '__gman_close';
    });
  }

  function init() {
    buildPanel();

    window._outgoingManipulators.push(function(raw, logId) { return applyRulesToPacket(raw, 'OUT', logId); });
    window._incomingManipulators.push(function(raw, logId) { return applyRulesToPacket(raw, 'IN', logId); });

    // UserObject fires on every login, including a relog within the same page (not just a
    // full page reload) — that's the actual "relog" moment session-only rules need to react to.
    window.onPacket('UserObject', function(p) {
      if (!p.parsed || !p.parsed.name) return;
      if (_applyPersistReset()) { _saveRules(); render(); }
    });

    render();
    window.__gman_panel = panel;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(init); });
  else window.__ghk_ready(init);
})();
