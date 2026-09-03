(function() {
  console.log('[MarktplaatsNotes] script loaded');
  if (document.getElementById('__mbn_style')) return;

  // On/off toggle — Settings > Appearance > Marktplaats Notes (content.js). Defaults ON
  // since this ran unconditionally before the toggle existed; adding the toggle shouldn't
  // silently change behavior for anyone already using it.
  const ENABLED_KEY = '__ghk_mbn_enabled';
  let _on = true;
  try {
    const saved = localStorage.getItem(ENABLED_KEY);
    if (saved !== null) _on = saved === 'true';
  } catch (_) {}

  window.__mbn_isEnabled = function() { return _on; };
  window.__mbn_setEnabled = function(on) {
    _on = !!on;
    try { localStorage.setItem(ENABLED_KEY, String(_on)); } catch (_) {}
    if (_on) {
      _requestOwnOffers();
      _syncNotes();
    } else {
      // Pull already-injected note inputs back out immediately instead of waiting for
      // the next native re-render to happen to wipe them.
      document.querySelectorAll('.__mbn_note').forEach(function(el) { el.remove(); });
    }
  };

  // Custom per-offer notes injected under your own marketplace listings ("Dit Meubi is
  // niet verkocht." / "Tijd over: ..."). MarketPlaceOwnOffers (parsed in core/parsers.js)
  // gives offerId + price + expiry per entry but NOT the item name/DOM row — there's no
  // id anywhere in the rendered grid to key off of. So notes are correlated to rows by
  // POSITION: the grid is a straight .map() render of this same packet's offers array,
  // so DOM row i always corresponds to offers[i] at the moment that packet landed.
  // Same Supabase project marktplaats.js already posts pending_trades to — table
  // `marketplace_notes(account text, offer_id bigint, note text, updated_at timestamptz,
  // primary key (account, offer_id))`, RLS policy allowing the anon key full access. Must
  // exist already for this to work; this file doesn't create it.
  const SUPABASE_URL      = 'https://qwcfsqsrtegyvvwkzcgb.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_mi9rS5i9a-xrAWC0lG0TNA_vg903xRL';
  const HEADERS = {
    'apikey':        SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
    'Content-Type':  'application/json',
  };

  // In-memory only, for the current account, refetched from Supabase on load — no
  // localStorage fallback/cache, notes live purely server-side per the account that wrote
  // them. Empty/not-yet-loaded just reads as "no note" until the fetch resolves, at which
  // point _syncNotes() re-runs to backfill real values into any already-injected inputs.
  //
  // Switching accounts (same tab, log out/in as someone else) must never let this account's
  // notes get pruned/overwritten by another account's offer list or cache — _cachedForAccount
  // tracks whose data _notesCache actually holds, and every read/write/prune re-checks it
  // first so a stale in-flight load from a previous account can never clobber a newer one.
  let _notesCache = {};
  let _cachedForAccount = null;
  function _resetNotesCacheIfAccountChanged() {
    const acct = window._selfName;
    if (acct && acct !== _cachedForAccount) {
      _notesCache = {};
      _cachedForAccount = acct;
    }
  }

  async function _loadNotesForAccount() {
    const acct = window._selfName;
    if (!acct) return;
    _resetNotesCacheIfAccountChanged();
    try {
      const res = await fetch(SUPABASE_URL + '/rest/v1/marketplace_notes?account=eq.' + encodeURIComponent(acct) + '&select=offer_id,note', { headers: HEADERS });
      if (!res.ok) return;
      const rows = await res.json();
      if (window._selfName !== acct) return; // account changed again mid-fetch — a newer load already owns the cache, don't clobber it with this stale response
      _notesCache = {};
      rows.forEach(function(r) { _notesCache[r.offer_id] = r.note; });
      _syncNotes();
    } catch (e) { console.warn('[MarktplaatsNotes] load failed:', e); }
  }

  function _getNote(offerId) {
    _resetNotesCacheIfAccountChanged();
    return _notesCache[offerId] || '';
  }

  async function _setNote(offerId, text) {
    const acct = window._selfName;
    if (!acct) return;
    if (text) _notesCache[offerId] = text; else delete _notesCache[offerId];
    try {
      if (text) {
        const res = await fetch(SUPABASE_URL + '/rest/v1/marketplace_notes?on_conflict=account,offer_id', {
          method:  'POST',
          headers: Object.assign({}, HEADERS, { 'Prefer': 'resolution=merge-duplicates' }),
          body:    JSON.stringify({ account: acct, offer_id: offerId, note: text, updated_at: new Date().toISOString() }),
        });
        if (!res.ok) console.warn('[MarktplaatsNotes] save rejected:', res.status, await res.text().catch(function() { return ''; }));
      } else {
        await fetch(SUPABASE_URL + '/rest/v1/marketplace_notes?account=eq.' + encodeURIComponent(acct) + '&offer_id=eq.' + offerId, {
          method: 'DELETE', headers: HEADERS,
        });
      }
    } catch (e) { console.warn('[MarktplaatsNotes] save failed:', e); }
  }

  // Drops any stored note whose offer is no longer in the latest snapshot — sold,
  // cancelled, or expired-and-cleared all look the same here: it's just gone from the list.
  async function _pruneNotes(validIds) {
    const acct = window._selfName;
    if (!acct) return;
    const stale = Object.keys(_notesCache).filter(function(id) { return !validIds.has(Number(id)); });
    if (!stale.length) return;
    stale.forEach(function(id) { delete _notesCache[id]; });
    try {
      await fetch(SUPABASE_URL + '/rest/v1/marketplace_notes?account=eq.' + encodeURIComponent(acct) + '&offer_id=in.(' + stale.join(',') + ')', {
        method: 'DELETE', headers: HEADERS,
      });
    } catch (e) { console.warn('[MarktplaatsNotes] prune failed:', e); }
  }

  let _lastOffers = [];
  window.onPacket('MarketPlaceOwnOffers', function(p) {
    if (!p.parsed || !p.parsed.offers) return;
    _lastOffers = p.parsed.offers;
    _pruneNotes(new Set(_lastOffers.map(function(o) { return o.offerId; })));
    _syncNotes();
  });

  // window._selfName is null until UserObject arrives post-login — load as soon as it's
  // known, whichever comes first: the packet firing this session, or the script attaching
  // after login already happened (extension reload mid-session).
  window.onPacket('UserObject', function() { if (window._selfName) _loadNotesForAccount(); });

  // Re-runs on every DOM mutation (the native grid gets fully re-rendered by React, not
  // patched) but only actually touches a row when it doesn't already carry the right note
  // for its current offer — so it never clobbers text you're mid-typing. If a row's DOM
  // node got reused for a different offer since the last render (list shifted after one
  // above it was removed), the stale note is swapped out for the correct one instead of
  // silently showing the wrong note.
  function _getPktId(dir, name) {
    if (!window.PKT || !window.PKT[dir]) return null;
    for (const [id, n] of Object.entries(window.PKT[dir])) {
      if (window.shortName(n, dir) === name) return parseInt(id);
    }
    return null;
  }
  // Self-heal the "extension reloaded while already on this page" case — the packet we
  // need already fired before this script existed to catch it, so _lastOffers would
  // otherwise stay empty forever. Actively ask for a fresh one instead of only ever
  // reacting to one that happens to arrive. Throttled since this runs from inside the
  // DOM-mutation-driven _syncNotes below.
  let _requestedAt = 0;
  function _requestOwnOffers() {
    const now = Date.now();
    if (now - _requestedAt < 2000 || !window.sendPacket) return;
    _requestedAt = now;
    const id = _getPktId('OUT', 'GetMarketplaceOwnOffers');
    if (id !== null) window.sendPacket('OUT', id, '');
  }

  // "Mijn advertenties" (own offers) and "Aanbod" (public browse) reuse the exact same
  // .nitro-catalog-layout-marketplace-grid / .layout-grid-item classes — and both grids can
  // sit in the DOM at once (other tab's panel just hidden, not removed), which is why a
  // plain container-class selector picked up hundreds of unrelated rows. Own-offer rows are
  // the only ones with a single "Annuleer" button (public rows have "Koop" + "Meubi Info").
  function _isOwnOfferRow(row) {
    const btns = row.querySelectorAll('.btn');
    return btns.length === 1 && btns[0].textContent.trim() === 'Annuleer';
  }

  function _syncNotes() {
    if (!_on) return;
    const rows = Array.from(document.querySelectorAll('.nitro-catalog-layout-marketplace-grid .layout-grid-item')).filter(_isOwnOfferRow);
    if (!rows.length) return; // grid not open
    if (rows.length !== _lastOffers.length) {
      console.log('[MarktplaatsNotes] row/offer count mismatch:', rows.length, 'rows vs', _lastOffers.length, 'offers — requesting fresh snapshot');
      _requestOwnOffers();
      // Retrying only on the next DOM mutation isn't enough — listing a new offer can
      // render the grid once and then sit still, with nothing left to trigger another
      // MutationObserver callback. The fresh MarketPlaceOwnOffers reply (once _requestOwnOffers
      // actually lands one, past its own throttle) calls _syncNotes itself, but if THAT
      // request got throttled away here, nothing was still watching — this timer is the
      // fallback that keeps checking regardless, so a newly-listed offer isn't stuck
      // without a note field until some unrelated mutation happens to fire again.
      setTimeout(_syncNotes, 600);
      return; // stale/missing snapshot for now
    }
    console.log('[MarktplaatsNotes] syncing', rows.length, 'rows');
    rows.forEach(function(row, i) {
      const offer = _lastOffers[i];
      const infoCol = row.querySelector('.flex-grow-1.flex-column');
      if (!infoCol) { console.log('[MarktplaatsNotes] row', i, 'has no .flex-grow-1.flex-column', row); return; }
      // Sanity check the position-based pairing against something both sides actually
      // carry — the packet's price and the row's rendered "Prijs: N Bel-Credits" text.
      // A mismatch means the ordering assumption broke; skip rather than attach a note
      // to the wrong offer.
      const priceMatch = infoCol.textContent.match(/Prijs:\s*([\d.,]+)/);
      const shownPrice = priceMatch ? parseInt(priceMatch[1].replace(/[.,]/g, ''), 10) : null;
      if (shownPrice !== null && shownPrice !== offer.price) {
        console.warn('[MarktplaatsNotes] row', i, 'price mismatch: DOM shows', shownPrice, 'packet offer #' + offer.offerId, 'says', offer.price, '— skipping, ordering assumption may be wrong');
        return;
      }
      let noteEl = infoCol.querySelector('.__mbn_note');
      if (noteEl && Number(noteEl.dataset.offerId) === offer.offerId) return;
      if (noteEl) noteEl.remove();
      noteEl = document.createElement('input');
      noteEl.type = 'text';
      noteEl.className = '__mbn_note';
      noteEl.dataset.offerId = offer.offerId;
      noteEl.placeholder = 'notitie...';
      noteEl.value = _getNote(offer.offerId);
      let saveTimer = null;
      noteEl.addEventListener('input', function() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function() { _setNote(offer.offerId, noteEl.value.trim()); }, 400);
      });
      // Row itself is cursor-pointer (native click handler) — don't let typing/clicking
      // in the note field trigger whatever that does.
      noteEl.addEventListener('click', function(e) { e.stopPropagation(); });
      noteEl.addEventListener('mousedown', function(e) { e.stopPropagation(); });
      infoCol.appendChild(noteEl);
    });
  }

  function init() {
    const style = document.createElement('style');
    style.id = '__mbn_style';
    style.textContent =
      '.__mbn_note{font-size:11px;padding:2px 5px;margin-top:3px;border:1px solid #ccc;border-radius:4px;' +
      'width:100%;box-sizing:border-box;color:#000;background:#fff;font-family:inherit}' +
      '.__mbn_note:focus{outline:none;border-color:#6C7CFF}';
    document.head.appendChild(style);

    if (window._selfName) _loadNotesForAccount(); // covers being (re)loaded after login already happened
    if (_on) _requestOwnOffers(); // covers being (re)loaded while the marketplace page is already open
    _syncNotes();
    if (document.body && typeof MutationObserver !== 'undefined') {
      let scheduled = false;
      new MutationObserver(function() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(function() { scheduled = false; _syncNotes(); });
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(init); });
  } else {
    window.__ghk_ready(init);
  }
})();
