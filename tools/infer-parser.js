'use strict';
// Packet structure inference — turns a corpus (from extensions/scripting/packet-capture.js)
// into a draft PacketParsers entry.
//
// THE IDEA: a single capture is ambiguous. The bytes 00 00 00 05 are equally "int32 = 5" and
// "uint16 length 5 followed by...". No local rule decides. But a *wrong* guess usually
// survives one sample and dies on twenty: it drifts out of alignment and either overruns the
// buffer or leaves a tail. So instead of guessing per packet, this searches for a layout that
// consumes EVERY sample exactly, end to end. That constraint does most of the work.
//
// Three signals beyond exact consumption:
//   1. TILING. Most of these packets are a short prefix followed by N repeated records. A
//      record layout that tiles every sample's remainder exactly is very unlikely to be wrong
//      about where the record boundaries are.
//   2. CROSS-SAMPLE VARIANCE. A field byte-identical across every capture is a constant —
//      exactly the `r.int(); // always 0` padding fields core/parsers.js is full of. This is
//      why packet-capture.js keeps duplicate byte-patterns as counts instead of discarding.
//   3. VALUE PLAUSIBILITY. Runs of zero bytes tile under many readings (2 ints, 4 shorts, an
//      int straddling a boundary...). Misaligned readings splice the tail of one field onto
//      the head of the next and produce ~10^9 nonsense, so scoring on whether values look
//      like real protocol data separates layouts that merely fit from ones that are right.
//
// HOW THE SEARCH IS BOUNDED: a record layout is learned from the SHORTEST sample (fewest
// records, so the least ambiguity about where record one ends), then validated against every
// other sample by replay. When a sample fails to tile, the algorithm finds the deepest
// position it could reach, and learns an ADDITIONAL layout starting there — using backward
// reachability (which positions can still reach the buffer end using layouts already known)
// to decide where that new layout is allowed to stop. Recursion is therefore bounded by the
// field count of ONE record, never by the size of the corpus. Multiple layouts are collapsed
// back into a single if/else at codegen time by finding the field whose value predicts which
// layout applies — that is how a conditional record like MarketPlaceOffers' category-3 split
// gets recovered without ever assuming a branch exists.
//
// WHAT IT CANNOT DO: names and meaning. It will tell you field 2 is an int that only ever
// holds 1 or 3 and that the layout branches on it. It cannot know it is called `category` or
// that 3 means "grouped listing". That is yours to fill in — but you are naming fields in a
// verified skeleton instead of finding the skeleton by hand.
//
// Usage:
//   node tools/infer-parser.js corpus.json
//   node tools/infer-parser.js corpus.json --packet MarketPlaceOffers
//   node tools/infer-parser.js corpus.json --packet 1451 --max-samples 60

// ── Field readers ──────────────────────────────────────────────────────────────────
// Same primitive set as core/ws.js's makeReader, so generated code lines up with the
// hand-written parsers it is meant to be compared against.
const TYPE_ORDER = ['s', 'i', 'u', 'b', 'B'];
// Pre-built single-type layouts, so the hot search loops never allocate one per probe.
const ONE = TYPE_ORDER.map(t => [t]);
const TYPE_NAMES = { s: 'str', i: 'int', u: 'short', b: 'bool', B: 'byte' };
const TYPE_LABEL = { s: 'string', i: 'int32', u: 'uint16', b: 'bool', B: 'byte' };

function readField(b, pos, end, t) {
  switch (t) {
    case 'i': {
      if (pos + 4 > end) return null;
      return { v: ((b[pos] << 24) | (b[pos + 1] << 16) | (b[pos + 2] << 8) | b[pos + 3]) | 0, next: pos + 4 };
    }
    case 'u': {
      if (pos + 2 > end) return null;
      return { v: (b[pos] << 8) | b[pos + 1], next: pos + 2 };
    }
    case 'b': {
      if (pos + 1 > end) return null;
      if (b[pos] > 1) return null;                       // only 0/1 qualifies as a bool
      return { v: b[pos], next: pos + 1 };
    }
    case 'B': {
      if (pos + 1 > end) return null;
      return { v: b[pos], next: pos + 1 };
    }
    case 's': {
      if (pos + 2 > end) return null;
      const len = (b[pos] << 8) | b[pos + 1];
      if (len === 0) return null;                        // empty strings are too ambiguous
      if (pos + 2 + len > end) return null;
      if (!isTexty(b, pos + 2, len)) return null;
      let s = '';
      for (let i = 0; i < len; i++) s += String.fromCharCode(b[pos + 2 + i]);
      return { v: s, next: pos + 2 + len };
    }
  }
  return null;
}

// A length prefix followed by control bytes is almost never a real string. Permissive about
// high bytes: UTF-8 sequences and Latin-1 accents are both legitimate protocol content.
function isTexty(b, from, len) {
  for (let i = 0; i < len; i++) {
    const c = b[from + i];
    if (c < 0x09) return false;
    if (c === 0x0b || c === 0x0c) return false;
    if (c >= 0x0e && c < 0x20) return false;
  }
  return true;
}

// A layout is a flat array of type chars. Records with conditional shapes are represented as
// SEVERAL layouts, reunified into if/else at codegen.
function parseLayout(b, pos, end, layout) {
  const vals = new Array(layout.length);
  for (let i = 0; i < layout.length; i++) {
    const r = readField(b, pos, end, layout[i]);
    if (!r) return null;
    vals[i] = r.v;
    pos = r.next;
  }
  return { next: pos, vals };
}

// Allocation-free "where does this layout end", for the search hot path. The value-producing
// parseLayout above allocates an array per call, which dominates runtime when probing
// hundreds of candidates across a corpus; this is the same walk without the values.
function layoutEnd(b, pos, end, layout) {
  for (let i = 0; i < layout.length; i++) {
    const t = layout[i];
    if (t === 'i') { if (pos + 4 > end) return -1; pos += 4; continue; }
    if (t === 'u') { if (pos + 2 > end) return -1; pos += 2; continue; }
    if (t === 'b') { if (pos + 1 > end || b[pos] > 1) return -1; pos += 1; continue; }
    if (t === 'B') { if (pos + 1 > end) return -1; pos += 1; continue; }
    // string
    if (pos + 2 > end) return -1;
    const len = (b[pos] << 8) | b[pos + 1];
    if (len === 0 || pos + 2 + len > end) return -1;
    if (!isTexty(b, pos + 2, len)) return -1;
    pos += 2 + len;
  }
  return pos;
}

// ── Prefix enumeration ─────────────────────────────────────────────────────────────
// Fields before the repeating section. A type is only viable if it reads cleanly at the same
// offset in every sample.
function enumeratePrefixes(streams, maxLen, cap) {
  const out = [];
  const start = streams.map(s => s.pos);
  out.push({ types: [], positions: start.slice() });

  function rec(types, positions) {
    if (types.length >= maxLen || out.length >= cap) return;
    for (const t of TYPE_ORDER) {
      const next = new Array(streams.length);
      let ok = true;
      for (let i = 0; i < streams.length; i++) {
        const r = readField(streams[i].b, positions[i], streams[i].end, t);
        if (!r) { ok = false; break; }
        next[i] = r.next;
      }
      if (!ok) continue;
      const nt = types.concat([t]);
      out.push({ types: nt, positions: next });
      rec(nt, next);
      if (out.length >= cap) return;
    }
  }
  rec([], start);
  return out;
}

// ── Tiling ─────────────────────────────────────────────────────────────────────────
// Positions from which the buffer end is still reachable using the known layouts. Computed
// back to front so a learned layout only has to reach a position that is already known-good,
// which is what keeps new-layout search bounded to one record.
function backReach(b, from, end, layouts) {
  const good = new Uint8Array(end + 1);
  good[end] = 1;
  for (let p = end - 1; p >= from; p--) {
    for (let li = 0; li < layouts.length; li++) {
      const n = layoutEnd(b, p, end, layouts[li]);
      if (n > 0 && n <= end && good[n]) { good[p] = 1; break; }
    }
  }
  return good;
}

// Walks the stream using whichever layout keeps the end reachable. Returns the record list,
// or the position where it got stuck.
function tile(b, from, end, layouts, good) {
  const recs = [];
  let pos = from;
  let guard = 0;
  while (pos < end) {
    if (++guard > 200000) return { ok: false, stuck: pos, recs };
    let moved = false;
    for (let li = 0; li < layouts.length; li++) {
      const n = layoutEnd(b, pos, end, layouts[li]);
      if (n < 0 || n === pos || !good[n]) continue;
      recs.push({ layout: li, at: pos });
      pos = n;
      moved = true;
      break;
    }
    if (!moved) return { ok: false, stuck: pos, recs };
  }
  return { ok: true, recs };
}

// Does this stream tile, and into how many records? Allocation-free; used to rank candidates.
function tileCount(b, from, end, layouts) {
  const good = backReach(b, from, end, layouts);
  if (!good[from]) return -1;
  let pos = from, n = 0, guard = 0;
  while (pos < end) {
    if (++guard > 200000) return -1;
    let moved = false;
    for (let li = 0; li < layouts.length; li++) {
      const nx = layoutEnd(b, pos, end, layouts[li]);
      if (nx < 0 || nx === pos || !good[nx]) continue;
      pos = nx; n++; moved = true; break;
    }
    if (!moved) return -1;
  }
  return n;
}

// Tiles using EXACTLY `want` records. Necessary whenever record sizes differ: with 38- and
// 40-byte records, 760 bytes is both 20x38 and 19x40, so a greedy walk can land on a valid
// tiling that contradicts the count the packet declared — and then every record after the
// first divergence is read at the wrong offset, turning real values into garbage.
// levels[k][pos] = "end is reachable from pos in exactly k records", so the walk can always
// pick a branch that still allows the declared total.
//
// `score`, when supplied, breaks ties between equally valid splits. Same-size records make
// this essential: if two layouts are both 40 bytes, ANY assignment of records to layouts
// tiles correctly, and a first-match walk would dump every record into layout 0. That
// destroys the per-layout value statistics the branch detector depends on, so what is really
// a conditional record looks like one shape with nonsense values. Preferring the layout whose
// values are more plausible at each step recovers the intended split.
function tileExact(b, from, end, layouts, want, score) {
  if (want < 0) return null;
  if (from === end) return want === 0 ? [] : null;
  const levels = [new Uint8Array(end + 1)];
  levels[0][end] = 1;
  for (let k = 1; k <= want; k++) {
    const cur = new Uint8Array(end + 1);
    const prev = levels[k - 1];
    for (let p = from; p < end; p++) {
      for (let li = 0; li < layouts.length; li++) {
        const n = layoutEnd(b, p, end, layouts[li]);
        if (n > p && n <= end && prev[n]) { cur[p] = 1; break; }
      }
    }
    levels.push(cur);
  }
  if (!levels[want][from]) return null;

  const recs = [];
  let pos = from;
  for (let left = want; left > 0; left--) {
    let bestLi = -1, bestVal = -Infinity, bestNext = -1;
    for (let li = 0; li < layouts.length; li++) {
      const n = layoutEnd(b, pos, end, layouts[li]);
      if (!(n > pos && n <= end && levels[left - 1][n])) continue;
      const v = score ? score(b, pos, end, li) : 0;
      if (v > bestVal) { bestVal = v; bestLi = li; bestNext = n; }
      if (!score) break;                                 // no tie-break: first match wins
    }
    if (bestLi < 0) return null;
    recs.push({ layout: bestLi, at: pos });
    pos = bestNext;
  }
  return pos === end ? recs : null;
}

// Per-record plausibility of reading it as `layouts[li]`, used as tileExact's tie-break.
// Deliberately cheap and local: it only asks whether this record's own bytes look like sane
// values under this layout, which is exactly the signal that distinguishes a correct
// assignment from one that splices adjacent fields together.
function makeLayoutScorer(layouts) {
  if (layouts.length < 2) return null;
  return function (b, pos, end, li) {
    const parsed = parseLayout(b, pos, end, layouts[li]);
    if (!parsed) return -Infinity;
    let s = 0;
    const types = layouts[li];
    for (let i = 0; i < parsed.vals.length; i++) {
      const v = parsed.vals[i];
      if (types[i] === 'i') {
        const a = Math.abs(v);
        if (a <= 5000000) s += 1;
        else if (a > 100000000) s -= 2;
      } else if (types[i] === 's') {
        s += 2;
      }
    }
    return s;
  };
}

// Learns candidate layouts starting at `from`, each ending at a position from which the end
// is already reachable. Depth is capped at one record's worth of fields, so this cannot blow
// the stack regardless of corpus size.
//
// Iterative-deepening rather than plain DFS: a depth-first walk spends its whole budget on one
// deep corner of the tree (long runs of bools and bytes) and never reaches the short wide
// layouts that are usually the true record shape. Searching by increasing field count finds
// those first, so the budget is spent where the answer actually lives.
//
// The DP below is what makes that affordable. Deepening alone is exponential: at depth 12 with
// 5 candidate types, a level with no valid layout still explores 5^12 nodes before admitting
// it. reach[d][pos] answers "from pos, can exactly d more fields land on a position from which
// the buffer end is reachable" — computed bottom-up in O(maxFields x bytes x types). The DFS
// then only descends where reach says success is still possible, so every path it walks ends
// in a real candidate and the cost becomes proportional to the answers, not the search space.
function learnAt(b, from, end, good, maxFields, cap) {
  const span = end + 1;
  const reach = [null];                                  // reach[0] unused; 1-indexed by depth
  let prev = good;
  for (let d = 1; d <= maxFields; d++) {
    const cur = new Uint8Array(span);
    let any = false;
    for (let p = from; p < end; p++) {
      for (let ti = 0; ti < TYPE_ORDER.length; ti++) {
        const n = layoutEnd(b, p, end, ONE[ti]);
        if (n >= 0 && n <= end && prev[n]) { cur[p] = 1; any = true; break; }
      }
    }
    reach.push(cur);
    prev = cur;
    if (!any) { maxFields = d - 1; break; }              // no deeper layout can exist
  }

  const out = [];
  const acc = [];
  for (let depth = 1; depth <= maxFields; depth++) {
    if (!reach[depth] || !reach[depth][from]) continue;   // provably no candidate at this depth
    (function rec(pos, left) {
      if (out.length >= cap) return;
      if (left === 0) {
        if (pos > from && good[pos]) out.push(acc.slice());
        return;
      }
      for (let ti = 0; ti < TYPE_ORDER.length; ti++) {
        const n = layoutEnd(b, pos, end, ONE[ti]);
        if (n < 0) continue;
        // Prune: unless the remainder can be covered in exactly left-1 more fields, this
        // whole subtree is dead.
        if (left === 1 ? !good[n] : !reach[left - 1][n]) continue;
        acc.push(TYPE_ORDER[ti]);
        rec(n, left - 1);
        acc.pop();
        if (out.length >= cap) return;
      }
    })(from, depth);
    if (out.length >= cap) break;
  }
  return out;
}

// Cheap pre-ranking so only the most promising candidates get tile-tested (which is the
// expensive part). Fewer fields for the same byte span means WIDER types, and wide types are
// the right prior here: a run of four bytes is far more likely to be one int32 than four
// separate bools, and any misreading that splits a real field necessarily produces more
// fields than the truth. Sorting ascending puts the true record shape near the front, so a
// small head of the list is enough and the rest can be discarded.
function rankCandidates(cands, limit) {
  const scored = cands.map(function (c) {
    let narrow = 0;
    for (const t of c) if (t === 'b' || t === 'B') narrow++;
    return { c, len: c.length, narrow };
  });
  scored.sort(function (a, b) {
    if (a.len !== b.len) return a.len - b.len;
    return a.narrow - b.narrow;           // tie-break against byte/bool soup
  });
  return scored.slice(0, limit).map(s => s.c);
}

// Derives the set of possible record BYTE SIZES from the declared counts alone, before any
// type search happens. This is the single strongest constraint available and it is pure
// arithmetic: a sample declaring 1 record over 38 bytes proves a 38-byte record exists; one
// declaring 2 records over 80 bytes proves either 40+40 or 38+42. Intersecting those
// constraints across a corpus usually pins the record size(s) exactly.
//
// Without this, the type search has to guess where record one ends, and on a short sample
// hundreds of candidate field sequences span exactly the same bytes with nothing to choose
// between them. Knowing the size first collapses that ambiguity to a handful of layouts.
function deriveRecordSizes(streams, positions, expect) {
  const spans = [];
  for (let i = 0; i < streams.length; i++) {
    const L = streams[i].end - positions[i];
    const n = expect[i];
    if (L === 0 && n === 0) continue;
    if (n <= 0) return null;                       // records exist but count says none
    spans.push({ L, n });
  }
  if (!spans.length) return null;

  // Seed hypotheses: exact sizes from single-record samples, and the even division of any
  // sample whose bytes divide evenly by its count.
  const seeds = new Set();
  for (const s of spans) {
    if (s.n === 1) seeds.add(s.L);
    if (s.L % s.n === 0) seeds.add(s.L / s.n);
  }
  if (!seeds.size) return null;

  const sizes = [...seeds].filter(v => v > 0).sort((a, b) => a - b);
  if (sizes.length > 6) return null;               // too ambiguous to be useful

  // Keep only the smallest subset of sizes that explains every sample.
  function explains(subset) {
    for (const s of spans) {
      if (!canSum(s.L, s.n, subset)) return false;
    }
    return true;
  }
  for (let k = 1; k <= sizes.length; k++) {
    const combos = choose(sizes, k);
    for (const c of combos) if (explains(c)) return c;
  }
  return null;
}

// Can `total` bytes be split into exactly `n` records drawn from `sizes`?
function canSum(total, n, sizes) {
  if (n === 0) return total === 0;
  const seen = new Set();
  return (function rec(rem, left) {
    if (left === 0) return rem === 0;
    if (rem <= 0) return false;
    const key = rem * 64 + left;
    if (seen.has(key)) return false;
    seen.add(key);
    for (const s of sizes) if (rec(rem - s, left - 1)) return true;
    return false;
  })(total, n);
}

function choose(arr, k) {
  const out = [];
  (function rec(start, acc) {
    if (acc.length === k) { out.push(acc.slice()); return; }
    for (let i = start; i < arr.length; i++) { acc.push(arr[i]); rec(i + 1, acc); acc.pop(); }
  })(0, []);
  return out;
}

// Enumerates field sequences that span exactly `size` bytes starting at `from`, best first.
// Because the end position is fixed, this is a tightly bounded search — the DP prune means
// every path walked reaches exactly the target.
function layoutsOfSize(b, from, size, cap) {
  const end = from + size;
  const good = new Uint8Array(end + 1);
  good[end] = 1;
  return learnAt(b, from, end, good, Math.min(size, 40), cap);
}

// Learns record layouts when the record sizes are known. For each size, collect candidates
// from several samples and keep the ones that work everywhere that size is needed.
function learnLayoutsSized(streams, positions, expect, sizes, opts) {
  const deadline = opts.deadline || Infinity;
  const perSize = [];

  for (const size of sizes) {
    // Gather candidates from a sample that actually contains a record of this size at a known
    // offset: any sample whose records are all this size (L === n * size).
    let cands = null;
    for (let i = 0; i < streams.length && cands === null; i++) {
      const L = streams[i].end - positions[i];
      if (expect[i] > 0 && L === expect[i] * size) {
        cands = layoutsOfSize(streams[i].b, positions[i], size, opts.candidateCap || 400);
      }
    }
    if (!cands || !cands.length) return null;
    perSize.push(rankCandidates(cands, opts.candidateProbe || 60));
  }

  // Try one layout per size, preferring the highest-scoring combination that tiles the corpus
  // with the declared counts.
  const probe = streams.map((s, i) => i).filter(i => positions[i] < streams[i].end).slice(0, 12);
  let best = null, bestScore = -Infinity;

  const limit = Math.min(opts.comboLimit || 400, perSize.reduce((a, p) => a * p.length, 1));
  let tried = 0;

  // Scores a candidate set directly off the tiling, rather than going through collectValues
  // (which expects positions at the start of the packet, not past an already-consumed prefix).
  function scoreSet(chosen) {
    const fieldVals = chosen.map(l => l.map(t => ({ t, values: [] })));
    const scorer = makeLayoutScorer(chosen);
    for (const i of probe) {
      const st = streams[i];
      const recs = tileExact(st.b, positions[i], st.end, chosen, expect[i], scorer);
      if (!recs) return null;
      for (const rec of recs) {
        const parsed = parseLayout(st.b, rec.at, st.end, chosen[rec.layout]);
        if (!parsed) return null;
        const fv = fieldVals[rec.layout];
        for (let k = 0; k < parsed.vals.length; k++) {
          if (fv[k].values.length < 2000) fv[k].values.push(parsed.vals[k]);
        }
      }
    }
    // A layout that never gets used is not part of the explanation.
    if (fieldVals.some(fv => fv.length && !fv[0].values.length)) return null;
    return scoreFields([].concat(...fieldVals)).score;
  }

  (function rec(k, chosen) {
    if (tried >= limit || Date.now() > deadline) return;
    if (k === perSize.length) {
      tried++;
      for (const i of probe) {
        if (!tileExact(streams[i].b, positions[i], streams[i].end, chosen, expect[i])) return;
      }
      const score = scoreSet(chosen);
      if (score !== null && score > bestScore) { bestScore = score; best = chosen.slice(); }
      return;
    }
    for (const c of perSize[k]) {
      chosen.push(c);
      rec(k + 1, chosen);
      chosen.pop();
      if (tried >= limit || Date.now() > deadline) return;
    }
  })(0, []);

  return best;
}

// Learns a set of record layouts that tiles every stream exactly.
//
// opts.expect, when given, is the record count each stream MUST produce — taken from a prefix
// field that looks like a count. This is by far the strongest constraint available: without
// it, a short layout like [bool,byte,byte,byte] tiles any buffer whose length divides by 4 and
// therefore "explains" every sample while producing ten times too many records. Requiring the
// tiling to produce exactly the count the packet itself declares eliminates that entire class
// of degenerate fits outright.
function learnLayouts(streams, positions, opts) {
  const maxFields  = opts.maxRecordFields || 30;
  const maxLayouts = opts.maxLayouts || 4;
  const candCap    = opts.candidateCap || 300;
  const deadline   = opts.deadline || Infinity;
  const expect     = opts.expect || null;

  // With declared counts, solve for record sizes arithmetically first — far more reliable
  // than growing a layout set greedily, which cannot tell which of several hundred
  // equal-length candidates on the first sample is the one that also explains the rest.
  if (expect) {
    const sizes = deriveRecordSizes(streams, positions, expect);
    if (sizes) {
      const sized = learnLayoutsSized(streams, positions, expect, sizes, opts);
      if (sized) return sized;
    }
  }

  // Shortest remainder first: fewest records means the least ambiguity about where record
  // one ends, which makes the first learned layout most likely to be the true one.
  const order = streams.map((s, i) => i)
    .filter(i => positions[i] < streams[i].end)
    .sort((a, b2) => (streams[a].end - positions[a]) - (streams[b2].end - positions[b2]));
  if (!order.length) return null;

  // Validation and ranking run against a bounded sample of streams. The corpus can be
  // hundreds of packets; a handful of varying lengths already pins the layout, and using all
  // of them turns every candidate probe into a full-corpus scan.
  const probe = order.slice(0, opts.probeStreams || 8);

  const okCount = (i, n) => n >= 0 && (!expect || n === expect[i]);

  let layouts = [];

  for (let round = 0; round <= maxLayouts; round++) {
    if (Date.now() > deadline) return null;

    // Find a probe stream that does not tile yet, and the deepest position it can reach.
    let stuckStream = -1, stuckPos = -1, stuckGood = null;
    for (const i of probe) {
      const st = streams[i];
      if (!layouts.length) {
        stuckStream = i; stuckPos = positions[i];
        stuckGood = new Uint8Array(st.end + 1); stuckGood[st.end] = 1;
        break;
      }
      const good = backReach(st.b, positions[i], st.end, layouts);
      if (good[positions[i]]) {
        const t0 = tile(st.b, positions[i], st.end, layouts, good);
        if (t0.ok && okCount(i, t0.recs.length)) continue;   // already tiles acceptably
      }
      const t = tile(st.b, positions[i], st.end, layouts, good);
      stuckStream = i;
      stuckPos = t.ok ? positions[i] : t.stuck;             // wrong count: relearn from the top
      stuckGood = good;
      break;
    }
    if (stuckStream === -1) {
      // Every probe stream tiles. Confirm against the whole corpus before accepting.
      for (const i of order) {
        const st = streams[i];
        if (!okCount(i, tileCount(st.b, positions[i], st.end, layouts))) return null;
      }
      return layouts.length ? layouts : null;
    }
    if (layouts.length >= maxLayouts) return null;

    const st = streams[stuckStream];
    const raw = learnAt(st.b, stuckPos, st.end, stuckGood, maxFields, candCap);
    if (!raw.length) return null;
    const cands = rankCandidates(raw, opts.candidateProbe || 40);

    // Rank candidates by AVERAGE records per stream they explain, ascending. Fewer records
    // means larger ones, which is the defence against a candidate that splits one true record
    // into several — that still tiles perfectly (the pieces cover the same bytes) so exact
    // consumption alone cannot rule it out. Ranking primarily by "how many streams does this
    // tile" is what lets a degenerate 4-byte layout win, since it tiles everything.
    let best = null, bestKey = null;
    for (const c of cands) {
      if (Date.now() > deadline) return null;
      const trial = layouts.concat([c]);
      let tiled = 0, records = 0;
      for (const i of probe) {
        const s2 = streams[i];
        const n = tileCount(s2.b, positions[i], s2.end, trial);
        if (okCount(i, n)) { tiled++; records += n; }
      }
      if (!tiled) continue;
      const avg = records / tiled;
      if (!bestKey
        || avg < bestKey[0] - 1e-9
        || (Math.abs(avg - bestKey[0]) < 1e-9 && tiled > bestKey[1])
        || (Math.abs(avg - bestKey[0]) < 1e-9 && tiled === bestKey[1] && c.length > bestKey[2])) {
        best = c; bestKey = [avg, tiled, c.length];
      }
    }
    if (!best) return null;
    layouts = layouts.concat([best]);
  }
  return null;
}

// ── Scoring ────────────────────────────────────────────────────────────────────────
// Walks every stream with the chosen layouts and collects per-field values.
// `expect`, when supplied, forces the count-exact tiling — the same segmentation the search
// validated. Without it a greedy walk can pick a different (also valid) split and report
// values read at the wrong offsets.
function collectValues(streams, positions, prefixTypes, layouts, expect) {
  const prefixVals = prefixTypes.map(t => ({ t, values: [] }));
  const fieldVals = (layouts || []).map(l => l.map(t => ({ t, values: [] })));
  const perStreamRecords = [];
  let total = 0;

  for (let i = 0; i < streams.length; i++) {
    const st = streams[i];
    let pos = st.pos;
    for (let k = 0; k < prefixTypes.length; k++) {
      const r = readField(st.b, pos, st.end, prefixTypes[k]);
      if (!r) return null;
      prefixVals[k].values.push(r.v);
      pos = r.next;
    }
    if (pos > st.end) return null;
    if (pos === st.end) { perStreamRecords.push(0); continue; }
    if (!layouts) return null;

    let recs;
    if (expect) {
      recs = tileExact(st.b, pos, st.end, layouts, expect[i], makeLayoutScorer(layouts));
      if (!recs) return null;
    } else {
      const good = backReach(st.b, pos, st.end, layouts);
      if (!good[pos]) return null;
      const t = tile(st.b, pos, st.end, layouts, good);
      if (!t.ok) return null;
      recs = t.recs;
    }

    for (const rec of recs) {
      // The tilers only report where each record starts and which layout it used; re-read it
      // here to get the values (the hot search path deliberately avoids allocating them).
      const parsed = parseLayout(st.b, rec.at, st.end, layouts[rec.layout]);
      if (!parsed) return null;
      const fv = fieldVals[rec.layout];
      for (let k = 0; k < parsed.vals.length; k++) {
        if (fv[k].values.length < 5000) fv[k].values.push(parsed.vals[k]);
      }
    }
    perStreamRecords.push(recs.length);
    total += recs.length;
  }
  return { prefixVals, fieldVals, perStreamRecords, records: total };
}

function isConst(info) {
  return info.values.length > 0 && info.values.every(v => v === info.values[0]);
}

// Scores a layout by the AVERAGE quality of its fields, not the sum. Summing rewards layouts
// merely for having more fields, which is backwards: an int32 whose high half is always zero
// can always be re-read as two uint16s, and under a sum the split wins (two fields, one of
// them a "constant", beats one) even though it is a misreading. Averaging removes that
// incentive, so wide correct fields beat narrow split ones on merit.
function scoreFields(all) {
  let total = 0, constants = 0, fields = 0;
  for (const info of all) {
    fields++;
    let s = 0;
    if (isConst(info)) { s += 0.5; constants++; }
    const vs = info.values;
    switch (info.t) {
      case 's': s += 3; break;
      case 'i': {
        const n = vs.length || 1;
        const plausible = vs.filter(v => Math.abs(v) <= 5000000).length / n;
        const absurd = vs.filter(v => Math.abs(v) > 100000000).length / n;
        s += 2 * plausible - 1.5 * absurd;
        break;
      }
      case 'u': s += 0.8; break;
      case 'b': s += 0.4; break;
      case 'B': s += 0.1; break;
    }
    total += s;
  }
  return { score: fields ? total / fields : 0, constants, fields, total };
}

// ── Discriminator ──────────────────────────────────────────────────────────────────
// Given several record layouts, find the earliest field (within their common prefix) whose
// value predicts which layout applies. That turns a set of alternatives back into an if/else
// and is how a conditional record shape is recovered without ever assuming one exists.
function findDiscriminator(streams, positions, prefixTypes, layouts, expect) {
  if (layouts.length < 2) return null;
  let common = 0;
  outer: for (;;) {
    const t = layouts[0][common];
    if (t === undefined) break;
    for (const l of layouts) if (l[common] !== t) break outer;
    common++;
    if (common > 24) break;
  }
  if (!common) return null;

  const obs = [];
  for (let i = 0; i < streams.length; i++) {
    const st = streams[i];
    let pos = st.pos;
    for (const t of prefixTypes) {
      const r = readField(st.b, pos, st.end, t);
      if (!r) return null;
      pos = r.next;
    }
    if (pos >= st.end) continue;
    let recs;
    if (expect) {
      recs = tileExact(st.b, pos, st.end, layouts, expect[i], makeLayoutScorer(layouts));
      if (!recs) return null;
    } else {
      const good = backReach(st.b, pos, st.end, layouts);
      if (!good[pos]) return null;
      const tl = tile(st.b, pos, st.end, layouts, good);
      if (!tl.ok) return null;
      recs = tl.recs;
    }
    for (const rec of recs) {
      const parsed = parseLayout(st.b, rec.at, st.end, layouts[rec.layout]);
      if (!parsed) return null;
      obs.push({ layout: rec.layout, vals: parsed.vals });
    }
  }
  if (!obs.length) return null;

  for (let j = 0; j < common; j++) {
    const map = new Map();
    let ok = true;
    for (const rec of obs) {
      const v = rec.vals[j];
      if (typeof v !== 'number') { ok = false; break; }
      const prev = map.get(v);
      if (prev === undefined) map.set(v, rec.layout);
      else if (prev !== rec.layout) { ok = false; break; }
    }
    // A field that takes a distinct value per record is an id, not a discriminator.
    if (ok && map.size > 0 && map.size <= Math.max(4, layouts.length * 2)) {
      return { index: j, map, common };
    }
  }
  return null;
}

// ── Top level ──────────────────────────────────────────────────────────────────────
function infer(samples, opts) {
  opts = Object.assign({}, opts || {});
  const headerBytes = opts.headerBytes != null ? opts.headerBytes : 6;
  // Hard wall-clock budget. The search space is large enough that some corpora would grind
  // for minutes; returning the best answer found so far beats running forever.
  const deadline = Date.now() + (opts.timeBudgetMs || 15000);
  opts.deadline = deadline;
  const streams = samples.map(function (ab) {
    const b = new Uint8Array(ab);
    return { b, pos: headerBytes, end: b.length };
  }).filter(s => s.end > s.pos);
  if (!streams.length) return { ok: false, reason: 'no usable samples' };

  const results = [];

  // 1. Flat: one fixed field sequence that consumes every sample exactly. Note this is tried
  // even when sample lengths differ — a flat layout containing a string explains varying
  // lengths perfectly well, so gating this on equal lengths would miss most real packets.
  // enumeratePrefixes prunes hard (a type that fails in any one sample kills that branch
  // immediately) and is capped, so this stays bounded.
  const flat = enumeratePrefixes(streams, opts.maxFlatFields || 30, opts.flatCap || 2000)
    .filter(c => c.types.length && c.positions.every((p, i) => p === streams[i].end));
  for (const c of flat) {
    const got = collectValues(streams, streams.map(s => s.pos), c.types, null);
    if (!got) continue;
    const sc = scoreFields(got.prefixVals);
    results.push({ kind: 'flat', prefix: c.types, layouts: [], prefixVals: got.prefixVals,
                   fieldVals: [], score: sc.score, stats: sc, records: 0 });
  }

  // 2. Prefix + repeated records — the common shape.
  // Sorted shortest-first: the true prefix is usually 0-2 fields (a count, sometimes an id),
  // and stopping early on a good short prefix avoids grinding through hundreds of long ones
  // that are really the first record's fields misread as prefix.
  const prefixes = enumeratePrefixes(streams, opts.maxPrefixFields || 3, opts.prefixCap || 120)
    .slice()
    .sort((a, b) => a.types.length - b.types.length);
  let loopFound = 0;
  for (const pre of prefixes) {
    if (loopFound >= (opts.maxLoopResults || 4)) break;
    if (Date.now() > deadline) break;
    if (pre.positions.some((p, i) => p > streams[i].end)) continue;
    if (pre.positions.every((p, i) => p === streams[i].end)) continue;

    // Read the prefix values once so each field can be tried as a declared record count.
    const preVals = pre.types.map(() => []);
    let readable = true;
    for (const st of streams) {
      let pos = st.pos;
      for (let k = 0; k < pre.types.length; k++) {
        const r = readField(st.b, pos, st.end, pre.types[k]);
        if (!r) { readable = false; break; }
        preVals[k].push(r.v);
        pos = r.next;
      }
      if (!readable) break;
    }
    if (!readable) continue;

    // Attempt each plausible count field as a hard constraint first, then unconstrained.
    // A count field turns "some layout that happens to tile" into "the layout that produces
    // exactly as many records as the packet says it has", which is the difference between a
    // coincidence and a verified structure.
    const attempts = [];
    for (let k = 0; k < pre.types.length; k++) {
      const vs = preVals[k];
      if (vs.every(v => typeof v === 'number' && v >= 0 && v <= 100000) && vs.some(v => v > 0)) {
        attempts.push(vs);
      }
    }
    attempts.push(null);

    for (const expect of attempts) {
      if (loopFound >= (opts.maxLoopResults || 4)) break;
      if (Date.now() > deadline) break;
      const layouts = learnLayouts(streams, pre.positions, Object.assign({}, opts, { expect }));
      if (!layouts) continue;
      const got = collectValues(streams, pre.positions, pre.types, layouts, expect);
      if (!got) continue;
      loopFound++;

      const sc = scoreFields(got.prefixVals.concat(...got.fieldVals));

      // Does a prefix field equal this sample's record count? That identifies the count field
      // without ever having assumed one exists.
      let countField = null;
      for (let i = 0; i < pre.types.length; i++) {
        const vs = got.prefixVals[i].values;
        if (vs.length === got.perStreamRecords.length &&
            vs.every((v, k) => v === got.perStreamRecords[k])) { countField = i; break; }
      }

      const disc = findDiscriminator(streams, pre.positions, pre.types, layouts, expect);
      // Bonuses are on the same scale as the averaged field score (roughly 0-3 per field).
      let bonus = 0.3;                                     // repetition is itself evidence
      if (countField !== null) bonus += 1.5;               // a matching count field is strong
      if (layouts.length > 1 && disc) bonus += 0.5;        // explained conditional shape
      if (layouts.length > 1 && !disc) bonus -= 0.8;       // unexplained alternatives
      // A "loop" that never holds more than one record per sample is not really a loop — it is
      // a flat layout with extra machinery, and the flat reading should win.
      const maxRecs = got.perStreamRecords.reduce((a, b2) => Math.max(a, b2), 0);
      if (maxRecs <= 1) bonus -= 1.5;

      results.push({
        kind: 'loop', prefix: pre.types, layouts, prefixVals: got.prefixVals,
        fieldVals: got.fieldVals, score: sc.score + bonus, stats: sc,
        records: got.records, perStreamRecords: got.perStreamRecords, countField, disc
      });
    }
  }

  if (!results.length) return { ok: false, reason: 'no layout consumed every sample exactly' };
  results.sort((a, b) => b.score - a.score);
  return {
    ok: true,
    best: results[0],
    alternatives: results.length - 1,
    runnerUpScore: results[1] ? results[1].score : null,
    sampleCount: streams.length,
    headerBytes
  };
}

// ── Codegen ────────────────────────────────────────────────────────────────────────
function valueNote(info) {
  const vs = info.values;
  if (!vs.length) return '';
  if (info.t === 's') {
    const distinct = new Set(vs.slice(0, 500)).size;
    return 'e.g. ' + JSON.stringify(vs[0]).slice(0, 32) + ', ' + distinct + ' distinct';
  }
  let mn = vs[0], mx = vs[0];
  for (const v of vs) { if (v < mn) mn = v; if (v > mx) mx = v; }
  if (mn === mx) return 'always ' + mn;
  return mn + '..' + mx + ', ' + new Set(vs.slice(0, 500)).size + ' distinct';
}

// Emits reads for one layout. `forceBind` names a field index that must be bound to a
// variable even if its observed values never vary — used for the discriminator, which the
// generated if/else has to reference by name.
function emitLayout(layout, vals, indent, prefixName, skipFirst, forceBind) {
  const pad = ' '.repeat(indent);
  let code = '', names = [];
  for (let i = skipFirst || 0; i < layout.length; i++) {
    const info = vals[i];
    const nm = prefixName + i;
    if (isConst(info) && i !== forceBind) {
      code += pad + 'r.' + TYPE_NAMES[layout[i]] + '(); // always ' + JSON.stringify(info.values[0]) + '\n';
    } else {
      code += pad + 'const ' + nm + ' = r.' + TYPE_NAMES[layout[i]] + '(); // ' + valueNote(info) + '\n';
      names.push(nm);
    }
  }
  return { code, names };
}

// Pools observed values for the fields shared by every branch. Those fields are read once,
// before the split, so their statistics must come from every record — not just the records
// that happened to take layout 0. Without this the discriminator reads as "always 1" simply
// because layout 0 is the branch where it equals 1.
function mergeHeadVals(fieldVals, head) {
  const out = [];
  for (let i = 0; i < head; i++) {
    const merged = { t: fieldVals[0][i].t, values: [] };
    for (const fv of fieldVals) {
      if (fv[i]) for (const v of fv[i].values) merged.values.push(v);
    }
    out.push(merged);
  }
  return out;
}

function codegen(result, packetName, direction) {
  const b = result.best;
  let out = '';
  out += '// DRAFT — generated by tools/infer-parser.js from ' + result.sampleCount + ' samples.\n';
  out += '// The STRUCTURE is verified: this layout consumes every sample exactly, end to end.\n';
  out += '// The NAMES are not — field0, field1... are placeholders for you to fill in.\n';
  if (result.runnerUpScore != null) {
    out += '// ' + result.alternatives + ' other layouts also fit; best ' + b.score.toFixed(2)
         + ' vs runner-up ' + result.runnerUpScore.toFixed(2) + '.\n';
    if (b.score - result.runnerUpScore < 1) {
      out += '// WARNING: thin margin over the runner-up — capture more varied samples before trusting this.\n';
    }
  }
  out += 'window.PacketParsers.' + (direction || 'IN') + '.' + (packetName || 'Unknown') + ' = raw => {\n';
  out += '  const r = window.makeReader(raw); if (!r) return null;\n';
  out += '  try {\n';

  b.prefix.forEach(function (t, i) {
    const info = b.prefixVals[i];
    if (b.countField === i) {
      out += '    const count = r.' + TYPE_NAMES[t] + '(); // equals the record count in every sample\n';
    } else if (isConst(info)) {
      out += '    r.' + TYPE_NAMES[t] + '(); // always ' + JSON.stringify(info.values[0]) + '\n';
    } else {
      out += '    const field' + i + ' = r.' + TYPE_NAMES[t] + '(); // ' + valueNote(info) + '\n';
    }
  });

  if (b.kind === 'flat') {
    const named = b.prefix.map((t, i) => (isConst(b.prefixVals[i]) ? null : 'field' + i)).filter(Boolean);
    out += '    return { ' + named.join(', ') + ' };\n';
    out += '  } catch (e) { return null; }\n};\n';
    return out;
  }

  out += '    const items = [];\n';
  out += (b.countField != null)
    ? '    for (let i = 0; i < count; i++) {\n'
    : '    while (r.remaining() > 0) {\n';

  if (b.layouts.length === 1) {
    const e = emitLayout(b.layouts[0], b.fieldVals[0], 6, 'f', 0);
    out += e.code;
    out += '      items.push({ ' + e.names.join(', ') + ' });\n';
  } else if (b.disc) {
    // Shared head up to and including the discriminator, then one arm per layout. Head values
    // are pooled across layouts so the discriminator does not look constant, and it is
    // force-bound so the if/else below can reference it.
    const head = b.disc.index + 1;
    const headVals = mergeHeadVals(b.fieldVals, head);
    const e0 = emitLayout(b.layouts[0].slice(0, head), headVals, 6, 'f', 0, b.disc.index);
    out += e0.code;
    const byLayout = new Map();
    b.disc.map.forEach(function (li, v) {
      if (!byLayout.has(li)) byLayout.set(li, []);
      byLayout.get(li).push(v);
    });
    let first = true;
    byLayout.forEach(function (vals, li) {
      const cond = vals.map(v => 'f' + b.disc.index + ' === ' + v).join(' || ');
      out += '      ' + (first ? 'if' : 'else if') + ' (' + cond + ') {\n';
      const e = emitLayout(b.layouts[li], b.fieldVals[li], 8, 'g', head);
      out += e.code;
      out += '        items.push({ ' + e0.names.concat(e.names).join(', ') + ' });\n';
      out += '      }\n';
      first = false;
    });
    out += '      else { break; } // unseen discriminator value — layout unknown\n';
  } else {
    out += '      // ' + b.layouts.length + ' alternative record shapes fit, and no field in the\n';
    out += '      // common prefix predicts which applies. Emitting the most common one only.\n';
    const e = emitLayout(b.layouts[0], b.fieldVals[0], 6, 'f', 0);
    out += e.code;
    out += '      items.push({ ' + e.names.join(', ') + ' });\n';
  }

  out += '    }\n';
  out += '    return { items };\n';
  out += '  } catch (e) { return null; }\n};\n';
  return out;
}

// ── Report ─────────────────────────────────────────────────────────────────────────
function describe(result) {
  const b = result.best;
  const L = [];
  L.push('  samples:    ' + result.sampleCount);
  L.push('  layout:     ' + (b.kind === 'loop' ? 'prefix + repeated records' : 'flat'));
  L.push('  prefix:     ' + (b.prefix.length ? b.prefix.map(t => TYPE_LABEL[t]).join(', ') : '(none)'));
  if (b.kind === 'loop') {
    L.push('  record:     ' + b.layouts.map(l => l.map(t => TYPE_LABEL[t]).join(',')).join('   ||   '));
    L.push('  records:    ' + b.records + ' across all samples');
    L.push('  count fld:  ' + (b.countField != null
      ? 'prefix field ' + b.countField + ' — equals the record count in every sample'
      : 'none (records read until the buffer is exhausted)'));
    if (b.layouts.length > 1) {
      L.push('  branch:     ' + (b.disc
        ? ('field ' + b.disc.index + ' of the record selects between ' + b.layouts.length + ' shapes')
        : (b.layouts.length + ' shapes, NO discriminating field found')));
    } else {
      L.push('  branch:     none — record shape is uniform');
    }
  }
  L.push('  constants:  ' + b.stats.constants + ' of ' + b.stats.fields + ' field slots never vary');
  L.push('  score:      ' + b.score.toFixed(2)
    + (result.runnerUpScore != null
      ? '  (runner-up ' + result.runnerUpScore.toFixed(2) + ', ' + result.alternatives + ' alternatives)'
      : ''));
  // Scores are per-field averages, so a meaningful margin is a few tenths, not whole points.
  const margin = result.runnerUpScore != null ? b.score - result.runnerUpScore : Infinity;
  if (margin < 0.15) {
    L.push('  CONFIDENCE: LOW — several layouts fit almost equally well. Capture more varied samples.');
  } else if (result.sampleCount < 10) {
    L.push('  CONFIDENCE: LOW — under 10 samples; exact-consumption is weak evidence at this size.');
  } else {
    L.push('  CONFIDENCE: reasonable — clear winner over ' + result.alternatives + ' alternatives.');
  }
  return L.join('\n');
}

// ── CLI ────────────────────────────────────────────────────────────────────────────
function hexToBuf(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out.buffer;
}

function main(argv) {
  const file = argv[0];
  if (!file) {
    console.error('usage: node tools/infer-parser.js <corpus.json> [--packet NAME_OR_ID] [--max-samples N]');
    process.exit(2);
  }
  const arg = (flag, d) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const want = arg('--packet', null);
  const maxSamples = parseInt(arg('--max-samples', '60'), 10);

  const corpus = JSON.parse(require('fs').readFileSync(file, 'utf8'));
  const headerBytes = corpus.headerBytes != null ? corpus.headerBytes : 6;
  let packets = corpus.packets || [];
  if (want) {
    packets = packets.filter(p => String(p.name).toLowerCase() === String(want).toLowerCase()
                               || String(p.id) === String(want));
  }
  if (!packets.length) { console.error('no matching packets in corpus'); process.exit(1); }

  for (const p of packets) {
    console.log('\n' + '='.repeat(72));
    console.log((p.name || '(unknown)') + ' [' + p.direction + ':' + p.id + ']');
    console.log('='.repeat(72));
    const samples = (p.samples || []).slice(0, maxSamples).map(s => hexToBuf(s.hex));
    if (samples.length < 3) { console.log('  skipped — need 3+ distinct samples, have ' + samples.length); continue; }
    const t0 = Date.now();
    let res;
    try { res = infer(samples, { headerBytes }); }
    catch (e) { console.log('  ERROR: ' + e.message); continue; }
    if (!res.ok) { console.log('  FAILED: ' + res.reason); continue; }
    console.log(describe(res));
    console.log('  time:       ' + (Date.now() - t0) + 'ms');
    console.log('\n' + codegen(res, p.name, p.direction));
  }
}

module.exports = { infer, codegen, describe, readField, parseLayout, hexToBuf, TYPE_NAMES };

if (require.main === module) main(process.argv.slice(2));
