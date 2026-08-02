# Wall Catalog Browser — Design

## Goal

A new Gheloo extension that lets you browse every wall item known from the catalog scan, grouped by real catalog category, rendered as full-quality furniture visuals (not small icons) using the same `@nitrots/nitro-renderer` engine as Room Viewer. You can favorite items (a dedicated Favorites tab) and buy an item directly by clicking its rendered card.

## Non-goals (v1)

- Floor items — wall items only, per the request.
- Enumerating every possible state/color an item could ever have. States are only shown once they've actually been observed live (see "State discovery" below); there is no algorithmic way to know a state exists ahead of time.
- Bulk/quantity buying — clicking a card buys exactly 1.
- Sharing a single renderer instance with Room Viewer — this extension boots its own independent `Nitro` instance, following Room Viewer's proven bootstrap pattern. Running both panels open at once means two renderer instances in memory; considered an acceptable cost for keeping the two features decoupled.

## Architecture

New extension `extensions/wall-catalog/`, structured identically to `extensions/room-viewer/`:
- `package.json` / `tsconfig.json` / `esbuild.config.mjs` / `src/`
- Compiled to a committed `extensions/wall-catalog.bundle.js`
- Registered as the last entry in `manifest.json`'s MAIN-world `content_scripts.js` array
- A hub tile (new icon, new row in `content.js`'s `CATEGORIES`) opening a draggable panel, matching every other Gheloo tool's UI conventions (`__ghk_makeDraggable`, `__ghk_bringToFront`, panel shown/hidden via a `__wc_open` global, added to the bring-to-front `_IDS` array)

### Data sources

1. **Catalog offers** — read-only from `localStorage['__ghk_rc_catalog']`, the same key `extensions/room-clone.js` already writes to via its passive `CatalogPage` scan. No new scanning logic in the new extension; it only reads.

2. **Category names** — `extensions/room-clone.js`'s existing `_parseCatalogPageOffers` function currently reads each page's `textCount` title strings and discards them (`for (let i = 0; i < textCount; i++) r.str();`). This gets a small change: capture the first text (the page's own title) and store it as `pageTitle` on each saved offer, alongside the existing `offerId`/`name`/`pageId`/`ints`. Offers scanned before this change won't have a `pageTitle` — the browser falls back to `"Page <id>"` for those until they're rescanned.

3. **Wall-item filter** — an offer counts as a "wall item" if any of its `ints` (typeIds) exists in `window.FurniData.wall`.

4. **Known states per typeId** — a new passive listener (in the new extension, listening to the same `Items`/`ItemAdd`/`ItemUpdate` packets `parsers.js` already parses) that records every distinct `(typeId, state)` pair it observes into a new `localStorage` key (e.g. `__ghk_wc_seen_states`), shaped as `{ [typeId]: string[] of states }`. This grows over time as you walk around the hotel. If a typeId has zero recorded states, the browser renders it with state `"0"` as a safe default rather than omitting it.

### Rendering

Boots its own `Nitro` instance via the same pattern as `extensions/room-viewer/src/bootstrap.ts` (`Nitro.bootstrap()`, wait for `ConfigurationEvent.LOADED`, then `roomEngine.ready`).

For each item card, calls `roomEngine.getFurnitureWallImage(typeId, direction, scale, listener, bgColor, extras, state)` directly — **not** `getFurnitureWallIcon`, which is a thin wrapper around the same function pinned to `scale=1` (the small catalog-icon size). Using the full function directly with a real scale value renders the item at full quality, matching how it actually looks mounted on a wall in a real room — confirmed by reading `RoomEngine.ts`'s `getFurnitureWallIcon` implementation, which is literally `return this.getFurnitureWallImage(typeId, new Vector3d(), 1, listener, 0, extras);`.

Rendering is async (`listener` callback fires once the item's asset library is loaded) and lazy: a category's items only start rendering once that category is expanded in the UI, not eagerly on panel open — avoids a rendering storm across potentially hundreds of items.

### Buying

Reuses the exact `PurchaseFromCatalog` packet format `room-clone.js` already sends:
- Normal case: `{i:pageId}{i:offerId}{i:0}{u:1}`
- Page 14 (currency) special case: `{i:pageId}{i:offerId}{i:0}{b:false}{b:true}`

`pageId`/`offerId` come straight from the matched catalog offer. Feedback (`PurchaseOK`/`PurchaseError`/`PurchaseNotAllowed`) is shown in the panel's own status area, not just the console.

Restricted offers (same `RESTRICTED_NAME_RE` — SS/LTD/BC/BC Shop/BT/Club Cadeau/Rare — and VIP-locked checks already in `room-clone.js`) are still browsable and favoritable, but visually marked non-purchasable; clicking one shows a message instead of sending a purchase.

### Favorites

A new `localStorage` key (e.g. `__ghk_wc_favorites`), storing an array of `{typeId, state}` pairs — two states of the same item are distinct favorites, since they render and buy differently. A star toggle on each card adds/removes it. The Favorites tab lists exactly these, resolved live against the same category data each time the panel renders (so it can't drift from what's actually still in the catalog).

## UI structure

- Category list (from `pageTitle`, or `"Page <id>"` fallback) on one side; item grid on the other.
- Favorites as its own tab, separate from the category browser.
- Each card: rendered furniture image, name, buy affordance, favorite toggle. One card per known state of that typeId. Clicking the card itself buys the item; the favorite star is a separate click target within the card (stops propagation) so it doesn't also trigger a purchase.
- Expanding a category triggers lazy rendering for just that category's items.

## Error handling / edge cases

- No catalog data scanned yet → panel shows a message pointing at room-clone.js's scan feature, not an empty/broken grid.
- `FurniData` not loaded yet → same treatment, matching how other extensions already guard on `window.FurniData.ready`.
- An item with zero observed states → rendered once at state `"0"`.
- A restricted/VIP-locked offer → browsable, not buyable, visually marked.

## Testing

No automated test can verify rendering correctness or packet behavior here — same situation as Room Viewer. Verification is live, in-game: confirm items render correctly per category, favorites persist across a reload, and a real buy click sends the right packet and reports success/failure in the panel.
