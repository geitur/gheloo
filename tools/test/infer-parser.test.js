'use strict';
// Ground-truth test for tools/infer-parser.js
//
// Generates corpora from layouts we already know (transcribed from core/parsers.js), then
// checks whether inference recovers them from bytes alone. parsers.js is the answer key.
const { infer, codegen, describe } = require('../infer-parser.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '   -> ' + extra : '')); }
}

// ── Byte writer ────────────────────────────────────────────────────────────────────
function W() {
  const b = [];
  return {
    i(v) { b.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return this; },
    u(v) { b.push((v >>> 8) & 255, v & 255); return this; },
    B(v) { b.push(v & 255); return this; },
    s(str) { this.u(str.length); for (let i = 0; i < str.length; i++) b.push(str.charCodeAt(i) & 255); return this; },
    build(id) {
      const buf = new ArrayBuffer(6 + b.length);
      const dv = new DataView(buf);
      dv.setInt32(0, 2 + b.length);
      dv.setUint16(4, id);
      new Uint8Array(buf).set(b, 6);
      return buf;
    }
  };
}

let seed = 12345;
function rnd(n) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; }

// Mirrors core/ws.js's window.makeReader so generated parsers execute under the exact
// semantics they will meet in the extension (including the 6-byte header skip).
function makeReaderLike(raw) {
  if (!raw || raw.byteLength <= 6) return null;
  const buf = raw.slice(6);
  const view = new DataView(buf);
  let pos = 0;
  return {
    int:   () => { const v = view.getInt32(pos);  pos += 4; return v; },
    short: () => { const v = view.getUint16(pos); pos += 2; return v; },
    bool:  () => { const v = view.getUint8(pos) !== 0; pos += 1; return v; },
    byte:  () => { const v = view.getUint8(pos);  pos += 1; return v; },
    str:   () => {
      const len = view.getUint16(pos); pos += 2;
      let s = ''; for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(pos + i));
      pos += len; return s;
    },
    remaining: () => buf.byteLength - pos,
  };
}

// ── Case 1: MarketPlaceOffers, transcribed from core/parsers.js ────────────────────
// total:int, then records:
//   offerId:int, flag:int, category:int, classId:int
//   category === 3 -> count:int, cap:int, price:int, 0:int, avgPrice:int, trailing:int
//   otherwise      -> 0:int, 0:int, price:short, 0:int, avgPrice:int, trailing:int
// Note the branch changes price's WIDTH (int32 vs int16), so record sizes differ per branch.
function marketPlaceOffers(nOffers) {
  const w = W();
  w.i(nOffers);
  for (let k = 0; k < nOffers; k++) {
    const cat = rnd(4) === 0 ? 3 : 1;
    w.i(100000 + rnd(900000));      // offerId
    w.i(rnd(3));                    // flag
    w.i(cat);                       // category
    w.i(1000 + rnd(8000));          // classId
    if (cat === 3) {
      w.i(1 + rnd(9)); w.i(1 + rnd(20)); w.i(1 + rnd(60000));
      w.i(0);
      w.i(1 + rnd(60000));
      w.i(0);
    } else {
      w.i(0); w.i(0);
      w.u(1 + rnd(30000));          // price as int16 in this branch
      w.i(0);
      w.i(1 + rnd(60000));
      w.i(0);
    }
  }
  return w.build(1451);
}

console.log('=== Case 1: MarketPlaceOffers (prefix + records + width-changing branch) ===');
{
  const samples = [];
  for (let n = 1; n <= 40; n++) samples.push(marketPlaceOffers(n));
  const t0 = Date.now();
  const res = infer(samples, { headerBytes: 6 });
  const ms = Date.now() - t0;

  check('inference succeeded', res.ok, res.ok ? '' : res.reason);
  if (res.ok) {
    console.log(describe(res, 'MarketPlaceOffers'));
    console.log('  time:       ' + ms + 'ms');
    const b = res.best;
    check('identified a repeating-record layout', b.kind === 'loop', b.kind);
    check('prefix is a single int (total)', b.prefix.length === 1 && b.prefix[0] === 'i', JSON.stringify(b.prefix));
    check('found the count field in the prefix', b.countField === 0, String(b.countField));
    check('record count matches ground truth (1+2+..+40 = 820)', b.records === 820, String(b.records));
    check('detected the conditional layout (branch)', /if \(f\d+ ===/.test(codegen(res, 'X', 'IN')));
    check('found constant always-0 padding fields', b.stats.constants >= 2, String(b.stats.constants));
    const code = codegen(res, 'MarketPlaceOffers', 'IN');
    check('emitted int16 read for the narrow-price branch', /r\.short\(\)/.test(code));
    // The generated parser must be syntactically valid and reference only bound names —
    // an earlier version emitted `if (f2 === 1)` while discarding f2 as a constant.
    let syntaxOk = true, syntaxErr = '';
    try { new Function('window', code); } catch (e) { syntaxOk = false; syntaxErr = e.message; }
    check('generated code parses as valid JavaScript', syntaxOk, syntaxErr);
    // Run it for real against a live sample and confirm it round-trips the true values.
    let ranOk = false, ranErr = '';
    try {
      const fakeWindow = { PacketParsers: { IN: {}, OUT: {} }, makeReader: makeReaderLike };
      new Function('window', code)(fakeWindow);
      const parser = fakeWindow.PacketParsers.IN.MarketPlaceOffers;
      const out = parser(samples[9]);            // the 10-offer sample
      ranOk = !!(out && out.items && out.items.length === 10);
      if (!ranOk) ranErr = 'got ' + (out && out.items ? out.items.length : 'null') + ' items, want 10';
    } catch (e) { ranErr = e.message; }
    check('generated parser runs and returns the right record count', ranOk, ranErr);
    console.log('\n--- generated ---\n' + code);
  }
}

// ── Case 2: flat packet with strings (RoomData-ish) ────────────────────────────────
console.log('\n=== Case 2: flat packet with strings ===');
{
  const names = ['Lobby', 'Cafe Ole', 'Sunset Beach', 'The Pit', 'Bobba Bar', 'Winter Lodge'];
  const owners = ['admin', 'silho', 'bot_01', 'guest99'];
  const samples = [];
  for (let k = 0; k < 30; k++) {
    const w = W();
    w.i(1000 + k);
    w.s(names[k % names.length]);
    w.i(50 + rnd(500));
    w.s(owners[k % owners.length]);
    w.i(0);
    w.B(rnd(2));
    samples.push(w.build(687));
  }
  const res = infer(samples, { headerBytes: 6 });
  check('inference succeeded', res.ok, res.ok ? '' : res.reason);
  if (res.ok) {
    console.log(describe(res, 'RoomData'));
    const code = codegen(res, 'RoomData', 'IN');
    const strs = (code.match(/r\.str\(\)/g) || []).length;
    check('recovered exactly 2 string fields', strs === 2, 'found ' + strs);
    check('flagged the always-0 field as constant', /always 0/.test(code));
    console.log('\n--- generated ---\n' + code);
  }
}

// ── Case 3: honesty check — too few samples must lower confidence ──────────────────
console.log('\n=== Case 3: confidence reporting on thin evidence ===');
{
  const samples = [marketPlaceOffers(3), marketPlaceOffers(4), marketPlaceOffers(5)];
  const res = infer(samples, { headerBytes: 6 });
  if (res.ok) {
    const d = describe(res, 'X');
    check('reports LOW confidence with only 3 samples', /CONFIDENCE: LOW/.test(d), d.split('\n').pop());
  } else {
    check('reports LOW confidence with only 3 samples', true, 'failed outright, also acceptable');
  }
}

// ── Case 4: constant detection needs repeats, not just distinct patterns ───────────
console.log('\n=== Case 4: constant-field detection ===');
{
  const samples = [];
  for (let k = 0; k < 25; k++) {
    const w = W();
    w.i(7);                    // genuinely constant
    w.i(1 + rnd(100000));      // varies
    w.i(0);                    // constant zero
    samples.push(w.build(999));
  }
  const res = infer(samples, { headerBytes: 6 });
  check('inference succeeded', res.ok, res.ok ? '' : res.reason);
  if (res.ok) {
    const code = codegen(res, 'ConstTest', 'IN');
    check('marked the constant 7 field', /always 7/.test(code), code.replace(/\n/g, ' | '));
    check('marked the constant 0 field', /always 0/.test(code));
    check('kept the varying field as a named binding', /const field1 = r\.int\(\)/.test(code));
    console.log('\n--- generated ---\n' + code);
  }
}

console.log('\n' + '='.repeat(60));
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
