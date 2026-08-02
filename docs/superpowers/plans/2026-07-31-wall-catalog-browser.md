# Wall Catalog Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new Gheloo panel that browses every wall item known from the existing
catalog scan (`extensions/room-clone.js`), grouped by real catalog category, rendered as
full-quality furniture visuals (not small icons) via `@nitrots/nitro-renderer` — with a
Favorites tab and click-to-buy.

**Architecture:** A new `extensions/wall-catalog/` TypeScript source tree, bundled by
esbuild into `extensions/wall-catalog.bundle.js` and loaded as a MAIN-world content
script, following the exact same pattern `extensions/room-viewer/` already established
(own `bootstrap.ts` booting an independent `Nitro` instance, panel UI in `main.ts`, hub
tile wired into `content.js`). It reads catalog data room-clone.js already scans
(`localStorage['__ghk_rc_catalog']`, read-only — no duplicate scanning), passively
observes real wall-item packets already parsed by `parsers.js` to learn which
states/colors actually exist per item, and renders each item via
`roomEngine.getFurnitureWallImage(typeId, direction, 64, listener, 0, state, parsedState)`
— the same function `getFurnitureWallIcon` wraps at `scale=1` for the small catalog icon,
called here with `scale=64` for a full-size, in-game-accurate render.

**Tech Stack:** TypeScript, esbuild, `@nitrots/nitro-renderer` 1.6.6, Node's built-in
`node:test` for the plan's pure-function unit tests.

**A note on testing in this plan:** Data transforms (grouping, filtering, favorites
toggling, state recording, purchase-expression building) are pure functions with real
unit tests. Everything else — booting the renderer, rendering actual furniture images,
sending real packets, the panel UI — is only verifiable live, in a real browser
connected to a real game session, per this repo's established policy (see
`extensions/README.md` and `docs/superpowers/plans/2026-07-30-room-viewer.md`'s own
testing note). Don't invent fake assertions for rendering output or live packet behavior.

---

## Task 1: Scaffold the build (package.json, tsconfig, esbuild)

**Files:**
- Create: `extensions/wall-catalog/package.json`
- Create: `extensions/wall-catalog/tsconfig.json`
- Create: `extensions/wall-catalog/esbuild.config.mjs`
- Create: `extensions/wall-catalog/src/main.ts` (placeholder entry, replaced in Task 9)

- [ ] **Step 1: Create `extensions/wall-catalog/package.json`**

```json
{
  "name": "gheloo-wall-catalog",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "build": "node esbuild.config.mjs",
    "test": "node --test --experimental-strip-types src/**/*.test.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@nitrots/nitro-renderer": "1.6.6"
  },
  "devDependencies": {
    "esbuild": "^0.24.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create `extensions/wall-catalog/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2020", "DOM"],
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `extensions/wall-catalog/esbuild.config.mjs`**

```js
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome110',
  outfile: '../wall-catalog.bundle.js',
  logLevel: 'info'
});
```

- [ ] **Step 4: Create a placeholder `extensions/wall-catalog/src/main.ts`**

```ts
console.log('[WallCatalog] bundle loaded');
```

- [ ] **Step 5: Install and build**

Run: `cd extensions/wall-catalog && npm install && npm run build`
Expected: `extensions/wall-catalog.bundle.js` is created; esbuild prints a file size
summary with no errors.

- [ ] **Step 6: Add the node_modules ignore entry if missing**

Check `.gitignore` at the repo root for `extensions/room-viewer/node_modules/` (or a
broader `**/node_modules/` pattern). If neither covers
`extensions/wall-catalog/node_modules/`, add `extensions/wall-catalog/node_modules/` to
`.gitignore`.

- [ ] **Step 7: Commit**

```bash
git add extensions/wall-catalog/package.json extensions/wall-catalog/tsconfig.json extensions/wall-catalog/esbuild.config.mjs extensions/wall-catalog/src/main.ts extensions/wall-catalog.bundle.js .gitignore
git commit -m "build: scaffold wall-catalog esbuild project"
```

---

## Task 2: Bootstrap module

Boots an independent `@nitrots/nitro-renderer` engine instance, mirroring
`extensions/room-viewer/src/bootstrap.ts` exactly (same config keys, same
`ConfigurationEvent.LOADED` → `roomEngine.ready` sequencing) — this extension does not
share a renderer instance with Room Viewer (see design spec's non-goals).

**Files:**
- Create: `extensions/wall-catalog/src/bootstrap.ts`

- [ ] **Step 1: Create `extensions/wall-catalog/src/bootstrap.ts`**

```ts
import { ConfigurationEvent, Nitro, RoomEngineEvent } from '@nitrots/nitro-renderer';

declare global {
  interface Window {
    NitroConfig: Record<string, unknown>;
  }
}

let bootPromise: Promise<typeof Nitro.instance> | null = null;

export function bootWallCatalogEngine(): Promise<typeof Nitro.instance> {
  if (bootPromise) return bootPromise;

  bootPromise = new Promise((resolve, reject) => {
    // Same config as extensions/room-viewer/src/bootstrap.ts — socket.url stays empty so
    // this never opens a real connection, and furnidata.url is supplied the same way
    // (not part of renderer-config.json itself).
    window.NitroConfig = {
      'socket.url': '',
      'config.urls': [
        'https://images.leet.city/leet-asset-bundles/config/renderer-config.json'
      ],
      'furnidata.url': 'https://images.leet.city/leet-asset-bundles/gamedata/leet_furni.json'
    };

    Nitro.bootstrap();
    const nitro = Nitro.instance;

    const configTimeout = setTimeout(() => reject(new Error('[WallCatalog] config load timed out after 15s')), 15000);

    nitro.core.configuration.events.addEventListener(ConfigurationEvent.LOADED, () => {
      clearTimeout(configTimeout);

      try {
        nitro.communication.init();
        nitro.init();
      } catch (err) {
        reject(err);
        return;
      }

      const roomEngine = nitro.roomEngine;

      if (roomEngine.ready) {
        resolve(nitro);
        return;
      }

      const engineTimeout = setTimeout(() => reject(new Error('[WallCatalog] roomEngine.ready timed out after 20s')), 20000);

      roomEngine.events.addEventListener(RoomEngineEvent.ENGINE_INITIALIZED, () => {
        clearTimeout(engineTimeout);
        resolve(nitro);
      });
    });

    nitro.core.configuration.init();
  });

  return bootPromise;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd extensions/wall-catalog && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add extensions/wall-catalog/src/bootstrap.ts
git commit -m "feat: add wall-catalog engine bootstrap"
```

---

## Task 3: Catalog data — read and group wall items

Reads room-clone.js's existing scanned catalog data and groups it into wall-item
categories. The grouping/filtering logic is a pure function, unit tested; the
`localStorage` read is a thin wrapper around it.

**Files:**
- Create: `extensions/wall-catalog/src/catalogData.ts`
- Create: `extensions/wall-catalog/src/catalogData.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// extensions/wall-catalog/src/catalogData.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupWallCatalogItems } from './catalogData.ts';

test('filters to offers with at least one wall typeId, and expands each match into its own item', () => {
  const offers = [
    { offerId: 1, name: 'Poster A', pageId: 10, pageTitle: 'Posters', ints: [501, 502] },
    { offerId: 2, name: 'Chair', pageId: 11, pageTitle: 'Chairs', ints: [700] },
    { offerId: 3, name: 'Bundle', pageId: 10, pageTitle: 'Posters', ints: [503, 700] }
  ];
  const wallFurniData = {
    501: { name: 'Poster A red' },
    502: { name: 'Poster A blue' },
    503: { name: 'Poster B' }
  };

  const result = groupWallCatalogItems(offers, wallFurniData);

  assert.deepEqual(result, [
    {
      categoryKey: 'Posters',
      items: [
        { offerId: 1, pageId: 10, typeId: 501, name: 'Poster A red' },
        { offerId: 1, pageId: 10, typeId: 502, name: 'Poster A blue' },
        { offerId: 3, pageId: 10, typeId: 503, name: 'Poster B' }
      ]
    }
  ]);
});

test('falls back to "Page <id>" when an offer has no pageTitle', () => {
  const offers = [{ offerId: 5, name: 'Rug', pageId: 42, ints: [900] }];
  const wallFurniData = { 900: { name: 'Rug' } };

  const result = groupWallCatalogItems(offers, wallFurniData);

  assert.deepEqual(result, [
    { categoryKey: 'Page 42', items: [{ offerId: 5, pageId: 42, typeId: 900, name: 'Rug' }] }
  ]);
});

test('offers with no wall typeId at all are excluded entirely', () => {
  const offers = [{ offerId: 6, name: 'Floor lamp', pageId: 1, pageTitle: 'Lamps', ints: [1000] }];
  const wallFurniData = { 2000: { name: 'Unrelated wall item' } };

  assert.deepEqual(groupWallCatalogItems(offers, wallFurniData), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extensions/wall-catalog && npm test`
Expected: FAIL — `catalogData.ts` doesn't exist yet / `groupWallCatalogItems` is not
defined.

- [ ] **Step 3: Write `extensions/wall-catalog/src/catalogData.ts`**

```ts
export interface CatalogOffer {
  offerId: number;
  name: string;
  pageId: number;
  pageTitle?: string;
  ints: number[];
}

export interface WallCatalogItem {
  offerId: number;
  pageId: number;
  typeId: number;
  name: string;
}

export interface WallCatalogCategory {
  categoryKey: string;
  items: WallCatalogItem[];
}

const CATALOG_STORAGE_KEY = '__ghk_rc_catalog';

// Read-only — extensions/room-clone.js owns writing to this key via its passive
// CatalogPage scan. This never scans or writes anything itself.
export function readCatalogOffers(): CatalogOffer[] {
  try {
    const raw = localStorage.getItem(CATALOG_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function groupWallCatalogItems(
  offers: CatalogOffer[],
  wallFurniData: Record<number, { name: string }>
): WallCatalogCategory[] {
  const categories = new Map<string, WallCatalogItem[]>();

  for (const offer of offers) {
    const wallTypeIds = offer.ints.filter(typeId => wallFurniData[typeId] !== undefined);
    if (!wallTypeIds.length) continue;

    const categoryKey = offer.pageTitle || `Page ${offer.pageId}`;
    if (!categories.has(categoryKey)) categories.set(categoryKey, []);
    const items = categories.get(categoryKey)!;

    for (const typeId of wallTypeIds) {
      items.push({
        offerId: offer.offerId,
        pageId: offer.pageId,
        typeId,
        name: wallFurniData[typeId].name
      });
    }
  }

  return Array.from(categories.entries()).map(([categoryKey, items]) => ({ categoryKey, items }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extensions/wall-catalog && npm test`
Expected: PASS (3/3 tests).

- [ ] **Step 5: Typecheck**

Run: `cd extensions/wall-catalog && npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add extensions/wall-catalog/src/catalogData.ts extensions/wall-catalog/src/catalogData.test.ts
git commit -m "feat: add wall catalog data grouping"
```

---

## Task 4: Capture catalog page titles in room-clone.js

`room-clone.js`'s existing `_parseCatalogPageOffers` reads each page's title/description
texts and discards them. This task captures the first one (the page's own title) and
stores it as `pageTitle` alongside each saved offer, so Task 3's `groupWallCatalogItems`
has real category names to group by (falling back to `"Page <id>"` for offers scanned
before this change).

**Files:**
- Modify: `extensions/room-clone.js`

- [ ] **Step 1: Locate the text-reading loop and the offer-saving code**

In `extensions/room-clone.js`, find `_parseCatalogPageOffers` (around line 211) and the
`CatalogPage` packet listener that saves offers (around line 270).

- [ ] **Step 2: Capture the first page text as `pageTitle`**

Change:
```js
      const textCount = r.int();
      for (let i = 0; i < textCount; i++) r.str();
```
to:
```js
      const textCount = r.int();
      let pageTitle = null;
      for (let i = 0; i < textCount; i++) {
        const text = r.str();
        if (i === 0 && text) pageTitle = text;
      }
```

- [ ] **Step 3: Thread `pageTitle` through the returned page object**

Change:
```js
      return { pageId: pageId, offers: offers };
```
to:
```js
      return { pageId: pageId, pageTitle: pageTitle, offers: offers };
```

- [ ] **Step 4: Store `pageTitle` on each saved offer**

Change:
```js
    page.offers.forEach(function(o) {
      _catalogItems.push({ offerId: o.offerId, name: o.name, pageId: page.pageId, ints: o.ints });
    });
```
to:
```js
    page.offers.forEach(function(o) {
      _catalogItems.push({ offerId: o.offerId, name: o.name, pageId: page.pageId, pageTitle: page.pageTitle, ints: o.ints });
    });
```

- [ ] **Step 5: Verify live**

Reload the extension, open the in-game catalog, click into a category you haven't
visited yet this session (or `clearCatalog()` from the console first, if available via
the room-clone UI, to force a fresh capture). In the console, run:
```js
JSON.parse(localStorage.getItem('__ghk_rc_catalog')).slice(-5)
```
Expected: the most recently captured entries include a non-null `pageTitle` matching
the category name shown in-game.

- [ ] **Step 6: Commit**

```bash
git add extensions/room-clone.js
git commit -m "feat: capture catalog page titles for category grouping"
```

---

## Task 5: State discovery — passive observer

Records every distinct `(typeId, state)` pair actually seen on a real wall item, so the
browser can show known states without guessing. The recording logic is a pure function
(unit tested); the packet listeners that feed it are wired in Task 9 alongside the panel,
since that's where `window.onPacket` gets attached in Room Viewer's own pattern.

**Files:**
- Create: `extensions/wall-catalog/src/stateStore.ts`
- Create: `extensions/wall-catalog/src/stateStore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// extensions/wall-catalog/src/stateStore.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordSeenState, getStatesForType } from './stateStore.ts';

test('records a new state for a typeId not seen before', () => {
  const result = recordSeenState({}, 501, '0');
  assert.deepEqual(result, { 501: ['0'] });
});

test('appends a new state to an existing typeId without duplicating', () => {
  const store = { 501: ['0'] };
  const result = recordSeenState(store, 501, '1');
  assert.deepEqual(result, { 501: ['0', '1'] });
  const again = recordSeenState(result, 501, '1');
  assert.deepEqual(again, { 501: ['0', '1'] });
});

test('getStatesForType falls back to ["0"] when nothing has been observed', () => {
  assert.deepEqual(getStatesForType({}, 999), ['0']);
});

test('getStatesForType returns the recorded states when present', () => {
  assert.deepEqual(getStatesForType({ 501: ['0', '2'] }, 501), ['0', '2']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extensions/wall-catalog && npm test`
Expected: FAIL — `stateStore.ts` doesn't exist yet.

- [ ] **Step 3: Write `extensions/wall-catalog/src/stateStore.ts`**

```ts
export type SeenStateStore = Record<number, string[]>;

const STATE_STORAGE_KEY = '__ghk_wc_seen_states';

export function loadSeenStates(): SeenStateStore {
  try {
    const raw = localStorage.getItem(STATE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

export function saveSeenStates(store: SeenStateStore): void {
  try {
    localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // localStorage full/unavailable — silently skip persisting, matches how
    // extensions/room-clone.js's own _saveCatalog/_saveBlueprints already handle this.
  }
}

export function recordSeenState(store: SeenStateStore, typeId: number, state: string): SeenStateStore {
  const existing = store[typeId] || [];
  if (existing.includes(state)) return store;
  return { ...store, [typeId]: [...existing, state] };
}

export function getStatesForType(store: SeenStateStore, typeId: number): string[] {
  const states = store[typeId];
  return (states && states.length) ? states : ['0'];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extensions/wall-catalog && npm test`
Expected: PASS (4/4 tests).

- [ ] **Step 5: Typecheck**

Run: `cd extensions/wall-catalog && npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add extensions/wall-catalog/src/stateStore.ts extensions/wall-catalog/src/stateStore.test.ts
git commit -m "feat: add passive wall-item state observer store"
```

---

## Task 6: Favorites

Favorites are keyed by `(typeId, state)` — two states of the same item are distinct
favorites, since they render and buy independently.

**Files:**
- Create: `extensions/wall-catalog/src/favorites.ts`
- Create: `extensions/wall-catalog/src/favorites.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// extensions/wall-catalog/src/favorites.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFavorite, toggleFavorite } from './favorites.ts';

test('a fresh list has no favorites', () => {
  assert.equal(isFavorite([], 501, '0'), false);
});

test('toggling on an absent favorite adds it', () => {
  const result = toggleFavorite([], 501, '0');
  assert.deepEqual(result, [{ typeId: 501, state: '0' }]);
  assert.equal(isFavorite(result, 501, '0'), true);
});

test('toggling an existing favorite removes it', () => {
  const favs = [{ typeId: 501, state: '0' }];
  const result = toggleFavorite(favs, 501, '0');
  assert.deepEqual(result, []);
});

test('same typeId, different state, is a distinct favorite', () => {
  const favs = toggleFavorite([], 501, '0');
  assert.equal(isFavorite(favs, 501, '1'), false);
  const result = toggleFavorite(favs, 501, '1');
  assert.deepEqual(result, [{ typeId: 501, state: '0' }, { typeId: 501, state: '1' }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extensions/wall-catalog && npm test`
Expected: FAIL — `favorites.ts` doesn't exist yet.

- [ ] **Step 3: Write `extensions/wall-catalog/src/favorites.ts`**

```ts
export interface FavoriteKey {
  typeId: number;
  state: string;
}

const FAVORITES_STORAGE_KEY = '__ghk_wc_favorites';

export function loadFavorites(): FavoriteKey[] {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveFavorites(favorites: FavoriteKey[]): void {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
  } catch {
    // localStorage full/unavailable — silently skip persisting.
  }
}

export function isFavorite(favorites: FavoriteKey[], typeId: number, state: string): boolean {
  return favorites.some(f => f.typeId === typeId && f.state === state);
}

export function toggleFavorite(favorites: FavoriteKey[], typeId: number, state: string): FavoriteKey[] {
  if (isFavorite(favorites, typeId, state)) {
    return favorites.filter(f => !(f.typeId === typeId && f.state === state));
  }
  return [...favorites, { typeId, state }];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extensions/wall-catalog && npm test`
Expected: PASS (4/4 tests).

- [ ] **Step 5: Typecheck**

Run: `cd extensions/wall-catalog && npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add extensions/wall-catalog/src/favorites.ts extensions/wall-catalog/src/favorites.test.ts
git commit -m "feat: add wall catalog favorites store"
```

---

## Task 7: Purchase — restriction rules and packet expression building

Mirrors `extensions/room-clone.js`'s existing restricted-name / VIP-lock rules and its
`PurchaseFromCatalog` expression format exactly (see that file's `RESTRICTED_NAME_RE`,
`_isRestrictedName`, `_isVipLockedOffer`, and the purchase calls in `_buyMissingNow`
around line 1113/1128). Duplicated here rather than imported, since room-clone.js doesn't
expose these on `window` — the regex/logic must stay byte-identical to that file's if
either is ever changed.

**Files:**
- Create: `extensions/wall-catalog/src/purchase.ts`
- Create: `extensions/wall-catalog/src/purchase.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// extensions/wall-catalog/src/purchase.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRestrictedName, isVipLockedOffer, buildPurchaseExpressionForOffer } from './purchase.ts';

test('isRestrictedName matches known restricted tags', () => {
  assert.equal(isRestrictedName('Golden Throne (Rare)'), true);
  assert.equal(isRestrictedName('Party Hat (LTD)'), true);
  assert.equal(isRestrictedName('Regular Chair'), false);
});

test('isVipLockedOffer requires the vip name AND a non-vip account', () => {
  assert.equal(isVipLockedOffer({ name: 'Leet VIP Sofa' }, false), true);
  assert.equal(isVipLockedOffer({ name: 'Leet VIP Sofa' }, true), false);
  assert.equal(isVipLockedOffer({ name: 'Regular Sofa' }, false), false);
});

test('buildPurchaseExpressionForOffer uses the bulk form for normal pages', () => {
  const expr = buildPurchaseExpressionForOffer({ pageId: 10, offerId: 501 });
  assert.equal(expr, '{i:10}{i:501}{i:0}{u:1}');
});

test('buildPurchaseExpressionForOffer uses the no-bulk form for page 14', () => {
  const expr = buildPurchaseExpressionForOffer({ pageId: 14, offerId: 501 });
  assert.equal(expr, '{i:14}{i:501}{i:0}{b:false}{b:true}');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extensions/wall-catalog && npm test`
Expected: FAIL — `purchase.ts` doesn't exist yet.

- [ ] **Step 3: Write `extensions/wall-catalog/src/purchase.ts`**

```ts
// Mirrors extensions/room-clone.js's RESTRICTED_NAME_RE / _isRestrictedName exactly —
// keep these two in sync if either changes.
export const RESTRICTED_NAME_RE = /\((SS|LTD|BC|BC Shop|BT|Club Cadeau|Rare)\)/i;

export function isRestrictedName(name: string): boolean {
  return RESTRICTED_NAME_RE.test(name || '');
}

// Mirrors extensions/room-clone.js's VIP_NAME_RE / _isVipLockedOffer exactly.
const VIP_NAME_RE = /leet vip/i;

export function isVipLockedOffer(offer: { name: string }, isVip: boolean): boolean {
  return VIP_NAME_RE.test(offer.name || '') && !isVip;
}

// Page 14 (currency/wisselkoers) rejects the bulk {u:count} form — mirrors
// extensions/room-clone.js's NO_BULK_PAGE_IDS exactly.
const NO_BULK_PAGE_IDS = [14];

export function buildPurchaseExpressionForOffer(offer: { pageId: number; offerId: number }): string {
  if (NO_BULK_PAGE_IDS.includes(offer.pageId)) {
    return `{i:${offer.pageId}}{i:${offer.offerId}}{i:0}{b:false}{b:true}`;
  }
  return `{i:${offer.pageId}}{i:${offer.offerId}}{i:0}{u:1}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extensions/wall-catalog && npm test`
Expected: PASS (4/4 tests).

- [ ] **Step 5: Typecheck**

Run: `cd extensions/wall-catalog && npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add extensions/wall-catalog/src/purchase.ts extensions/wall-catalog/src/purchase.test.ts
git commit -m "feat: add wall catalog purchase rules and packet builder"
```

---

## Task 8: Rendering — full-quality furniture image per item/state

Wraps `roomEngine.getFurnitureWallImage` to produce a real `<img>` per `(typeId, state)`.
Not unit-testable (requires a live renderer) — this task's own verification is a live
check.

**Files:**
- Create: `extensions/wall-catalog/src/render.ts`

- [ ] **Step 1: Write `extensions/wall-catalog/src/render.ts`**

**Correction (found during implementation's code-quality review, verified against the
library source):** `getFurnitureWallImage` at `scale=64` (the non-icon path) resolves to
`getGenericRoomObjectImage`, which only ever populates `IImageResult.data` (a
`RenderTexture`), never `.image` — and the real async completion call site
(`RoomEngine.ts`'s `initalizeTemporaryObjectsByType`) invokes `imageReady(id, texture)`
with only 2 arguments, no 3rd `image` argument. The version below (checking
`result.image` / a 3-arg `imageReady`) would reject on an item's first render and hang
forever on every later render of an already-loaded typeId. The fix converts the
`RenderTexture` to an `HTMLImageElement` directly via `TextureUtils.generateImage()` (a
real, exported, synchronous utility) in both places instead of relying on fields that
code path never sets. The `extras` argument (6th param) was also wrong — it was set to
`state`, but `extras` maps to the unrelated `FURNITURE_EXTRAS` visual variable; state
selection is already handled correctly by the 7th argument. Use this corrected version:

```ts
import { IRoomEngine, TextureUtils, Vector3d } from '@nitrots/nitro-renderer';

// scale=64 matches SCALE_ZOOMED_IN — the real, in-room furniture scale (confirmed correct
// via extensions/room-viewer's own furniture-vs-floor proportion fix). scale=1 is reserved
// by the library for the small catalog-icon thumbnail path (see getFurnitureWallIcon's own
// implementation, which is just this same call pinned to scale=1) — that's deliberately
// NOT what we want here, per the explicit "the item itself, not an icon" requirement.
const FULL_RENDER_SCALE = 64;

export function renderWallItemImage(roomEngine: IRoomEngine, typeId: number, state: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const parsedState = parseFloat(state);
    const numericState = Number.isNaN(parsedState) ? 0 : Math.trunc(parsedState);

    const direction = new Vector3d(0, 0, 0);

    const result = (roomEngine as any).getFurnitureWallImage(
      typeId,
      direction,
      FULL_RENDER_SCALE,
      {
        imageReady: (_id: number, texture: unknown) => {
          const image = TextureUtils.generateImage(texture as any);
          if (image) resolve(image);
          else reject(new Error(`[WallCatalog] no image returned for typeId ${typeId}`));
        },
        imageFailed: () => reject(new Error(`[WallCatalog] render failed for typeId ${typeId}`))
      },
      0,
      null,
      numericState
    );

    // Cache hit — already loaded, RenderTexture available synchronously without waiting
    // on the listener. getGenericRoomObjectImage (the non-icon path this always takes)
    // only ever populates IImageResult.data (a RenderTexture), never .image — confirmed
    // by reading RoomEngine.ts directly, so we convert it ourselves via TextureUtils
    // rather than relying on a field that path never sets.
    if (result && result.data) {
      const image = TextureUtils.generateImage(result.data);
      if (image) resolve(image);
    }
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd extensions/wall-catalog && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add extensions/wall-catalog/src/render.ts
git commit -m "feat: add full-quality wall item image rendering"
```

*Note for Task 9's live verification: `direction = new Vector3d(0, 0, 0)` is a starting
guess for a front-facing view, not a confirmed value — if items render sideways or
oddly angled when this is wired into the panel, try other small integer values (e.g.
`new Vector3d(90, 0, 0)` style adjustments) until the rendered direction looks like a
normal front-on wall-item view, the same iterative way Room Viewer's own camera/scale
values were tuned live.*

---

## Task 9: Panel UI, hub tile, and manifest registration

Ties every earlier module together into the actual panel: category list with lazy
per-category rendering, item cards (image + name + favorite star + buy-on-click),
Favorites tab, and the passive state-observer packet listeners. Wires the hub tile and
registers the bundle in `manifest.json`, following `extensions/room-viewer`'s exact
pattern (`__ghk_makeDraggable`, `__ghk_bringToFront`, `__ghk_ready`, bring-to-front
`_IDS` registration).

**Files:**
- Modify: `extensions/wall-catalog/src/main.ts` (replace Task 1's placeholder)
- Modify: `content.js`
- Modify: `manifest.json`

- [ ] **Step 1: Replace `extensions/wall-catalog/src/main.ts`**

```ts
import { bootWallCatalogEngine } from './bootstrap.ts';
import { readCatalogOffers, groupWallCatalogItems, WallCatalogCategory, WallCatalogItem } from './catalogData.ts';
import { loadSeenStates, saveSeenStates, recordSeenState, getStatesForType } from './stateStore.ts';
import { loadFavorites, saveFavorites, isFavorite, toggleFavorite, FavoriteKey } from './favorites.ts';
import { isRestrictedName, isVipLockedOffer, buildPurchaseExpressionForOffer } from './purchase.ts';
import { renderWallItemImage } from './render.ts';

declare global {
  interface Window {
    FurniData: { floor: Record<number, { name: string }>; wall: Record<number, { name: string }>; ready: boolean };
    __ghk_isVip?: boolean;
    __ghk_makeDraggable: (el: HTMLElement, handle: HTMLElement, storageKey: string, shouldSkip: (e: MouseEvent) => boolean) => void;
    __ghk_bringToFront?: (el: HTMLElement) => void;
    __ghk_ready: (fn: () => void) => void;
    onPacket: (name: string, cb: (p: any) => void) => void;
    PKT: { OUT: Record<number, string> };
    shortName: (raw: string, dir: string) => string;
    sendPacket: (dir: string, id: number, expr: string) => void;
    __wc_open?: () => void;
  }
}

function outId(name: string): number | null {
  if (!window.PKT || !window.PKT.OUT) return null;
  for (const id in window.PKT.OUT) {
    if (window.shortName(window.PKT.OUT[id], 'OUT') === name) return parseInt(id, 10);
  }
  return null;
}

function init(): void {
  if (document.getElementById('__wc_panel')) return;

  const style = document.createElement('style');
  style.textContent = [
    '#__wc_panel{position:fixed;top:16px;right:16px;width:760px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
    '#__wc_panel *{box-sizing:border-box}',
    '.__wc_card_wrap{display:flex;flex-direction:column;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb}',
    '.__wc_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
    '.__wc_title{font:600 13px system-ui;color:#eceefb;flex:1}',
    '.__wc_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
    '.__wc_close:hover{color:#eceefb}',
    '#__wc_body{padding:8px;display:flex;flex-direction:column;gap:8px;max-height:600px;overflow-y:auto}',
    '#__wc_tabs{display:flex;gap:8px}',
    '.__wc_tab{font-size:11px;font-weight:600;padding:6px 10px;border-radius:8px;border:none;cursor:pointer;color:#eceefb;background:#232433}',
    '.__wc_tab.active{background:#A6B0FF;color:#0A0B10}',
    '#__wc_status{font:11px monospace;color:#82849a;padding:0 4px}',
    '.__wc_category{border-radius:8px;background:#0A0B10;overflow:hidden}',
    '.__wc_category_hdr{padding:8px 10px;cursor:pointer;font:600 12px system-ui;color:#eceefb}',
    '.__wc_grid{display:none;flex-wrap:wrap;gap:8px;padding:8px}',
    '.__wc_grid.open{display:flex}',
    '.__wc_card{width:110px;background:#181923;border-radius:8px;padding:6px;cursor:pointer;position:relative}',
    '.__wc_card.restricted{opacity:.5;cursor:not-allowed}',
    '.__wc_card img{width:100%;height:64px;object-fit:contain;display:block}',
    '.__wc_card_name{font-size:10px;color:#eceefb;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.__wc_fav{position:absolute;top:4px;right:4px;font-size:14px;cursor:pointer}',
  ].join('');
  document.head.appendChild(style);

  const p = document.createElement('div');
  p.id = '__wc_panel';
  p.innerHTML =
    '<div class="__wc_card_wrap">' +
      '<div class="__wc_hdr" id="__wc_hdr">' +
        '<span class="__wc_title">Wall Catalog</span>' +
        '<span class="__wc_close" id="__wc_close">&times;</span>' +
      '</div>' +
      '<div id="__wc_body">' +
        '<div id="__wc_tabs">' +
          '<button class="__wc_tab active" data-tab="browse">Browse</button>' +
          '<button class="__wc_tab" data-tab="favorites">Favorites</button>' +
        '</div>' +
        '<div id="__wc_status">not started</div>' +
        '<div id="__wc_content"></div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(p);
  p.style.display = 'none';

  window.__ghk_makeDraggable(p, document.getElementById('__wc_hdr') as HTMLElement, '__ghk_wc_pos', e => (e.target as HTMLElement).id === '__wc_close');
  document.getElementById('__wc_close')!.addEventListener('click', () => { p.style.display = 'none'; });

  const statusEl = document.getElementById('__wc_status')!;
  function setStatus(msg: string): void {
    console.log('[WallCatalog]', msg);
    statusEl.textContent = msg;
  }

  const contentEl = document.getElementById('__wc_content')!;
  let activeTab: 'browse' | 'favorites' = 'browse';
  let categories: WallCatalogCategory[] = [];
  let seenStates = loadSeenStates();
  let favorites = loadFavorites();
  let lastRoomEngine: any = null;

  document.querySelectorAll('.__wc_tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.__wc_tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = (btn as HTMLElement).dataset.tab as 'browse' | 'favorites';
      render();
    });
  });

  function buyItem(item: WallCatalogItem): void {
    if (isRestrictedName(item.name) || isVipLockedOffer({ name: item.name }, !!window.__ghk_isVip)) {
      setStatus(`Cannot buy "${item.name}" — restricted or VIP-locked.`);
      return;
    }
    const pid = outId('PurchaseFromCatalog');
    if (pid === null) { setStatus('PurchaseFromCatalog not found in PKT.'); return; }
    window.sendPacket('OUT', pid, buildPurchaseExpressionForOffer(item));
    setStatus(`Purchase sent for "${item.name}" (offer #${item.offerId}) — waiting for confirmation...`);
  }

  window.onPacket('PurchaseOK', () => setStatus('Purchase confirmed by server.'));
  window.onPacket('PurchaseError', () => setStatus('Purchase FAILED — server rejected it.'));
  window.onPacket('PurchaseNotAllowed', () => setStatus('Purchase FAILED — not allowed (wrong offer/insufficient funds/etc).'));

  function buildCard(item: WallCatalogItem, state: string): HTMLElement {
    const card = document.createElement('div');
    card.className = '__wc_card';
    const restricted = isRestrictedName(item.name) || isVipLockedOffer({ name: item.name }, !!window.__ghk_isVip);
    if (restricted) card.classList.add('restricted');

    const img = document.createElement('img');
    card.appendChild(img);

    const name = document.createElement('div');
    name.className = '__wc_card_name';
    name.textContent = item.name;
    card.appendChild(name);

    const fav = document.createElement('span');
    fav.className = '__wc_fav';
    fav.textContent = isFavorite(favorites, item.typeId, state) ? '★' : '☆';
    fav.addEventListener('click', e => {
      e.stopPropagation();
      favorites = toggleFavorite(favorites, item.typeId, state);
      saveFavorites(favorites);
      fav.textContent = isFavorite(favorites, item.typeId, state) ? '★' : '☆';
      if (activeTab === 'favorites') render();
    });
    card.appendChild(fav);

    card.addEventListener('click', () => {
      if (restricted) { setStatus(`"${item.name}" is restricted or VIP-locked — not buying.`); return; }
      buyItem(item);
    });

    if (lastRoomEngine) {
      renderWallItemImage(lastRoomEngine, item.typeId, state)
        .then(image => { img.src = image.src; })
        .catch(err => console.warn('[WallCatalog] render failed', item.typeId, state, err));
    }

    return card;
  }

  function buildCategorySection(category: WallCatalogCategory): HTMLElement {
    const section = document.createElement('div');
    section.className = '__wc_category';

    const hdr = document.createElement('div');
    hdr.className = '__wc_category_hdr';
    hdr.textContent = `${category.categoryKey} (${category.items.length})`;
    section.appendChild(hdr);

    const grid = document.createElement('div');
    grid.className = '__wc_grid';
    section.appendChild(grid);

    let expanded = false;
    hdr.addEventListener('click', () => {
      expanded = !expanded;
      grid.classList.toggle('open', expanded);
      if (expanded && !grid.childElementCount) {
        for (const item of category.items) {
          for (const state of getStatesForType(seenStates, item.typeId)) {
            grid.appendChild(buildCard(item, state));
          }
        }
      }
    });

    return section;
  }

  function render(): void {
    contentEl.innerHTML = '';

    if (activeTab === 'browse') {
      for (const category of categories) {
        contentEl.appendChild(buildCategorySection(category));
      }
      return;
    }

    // Favorites tab — resolved live against current category data so it can't drift
    // from what's actually still in the catalog.
    const favGrid = document.createElement('div');
    favGrid.className = '__wc_grid open';
    contentEl.appendChild(favGrid);

    for (const category of categories) {
      for (const item of category.items) {
        for (const state of getStatesForType(seenStates, item.typeId)) {
          if (isFavorite(favorites, item.typeId, state)) {
            favGrid.appendChild(buildCard(item, state));
          }
        }
      }
    }
  }

  // Passive state observer — same wall-item packets extensions/room-viewer already
  // relies on for live tracking, reused here purely to learn which states exist.
  function observeState(f: { typeId: number; state?: string }): void {
    if (f.typeId === undefined || f.state === undefined || f.state === null) return;
    seenStates = recordSeenState(seenStates, f.typeId, f.state);
    saveSeenStates(seenStates);
  }
  window.onPacket('ItemAdd', p => { if (p.parsed) observeState(p.parsed); });
  window.onPacket('ItemUpdate', p => { if (p.parsed) observeState(p.parsed); });

  async function loadCatalog(): Promise<void> {
    if (!window.FurniData || !window.FurniData.ready) {
      setStatus('FurniData not loaded yet — waiting...');
      setTimeout(loadCatalog, 1000);
      return;
    }
    const offers = readCatalogOffers();
    if (!offers.length) {
      setStatus('No catalog data scanned yet — use room-clone.js\'s catalog scan first.');
      return;
    }
    categories = groupWallCatalogItems(offers, window.FurniData.wall);
    if (!categories.length) {
      setStatus('No wall items found in scanned catalog data.');
      return;
    }
    setStatus(`${categories.length} categor${categories.length === 1 ? 'y' : 'ies'} loaded.`);
    render();
  }

  window.__wc_open = function (): void {
    p.style.display = '';
    if (window.__ghk_bringToFront) window.__ghk_bringToFront(p);

    if (!lastRoomEngine) {
      setStatus('booting engine...');
      bootWallCatalogEngine().then(nitro => {
        lastRoomEngine = nitro.roomEngine;
        loadCatalog();
      }).catch(err => setStatus('FAILED: ' + (err && err.stack ? err.stack : String(err))));
    }
  };
}

window.__ghk_ready(init);
```

- [ ] **Step 2: Build and typecheck**

Run: `cd extensions/wall-catalog && npm run build && npm run typecheck`
Expected: `extensions/wall-catalog.bundle.js` rebuilt, no typecheck errors.

- [ ] **Step 3: Add the hub tile in `content.js`**

Find the `ICONS` object (search for `ICONS.roomviewer`) and add a new icon, e.g. reusing
a simple generic picture-frame SVG:

```js
ICONS.wallcatalog = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
```

Find the `rooms` category's `CATEGORIES` array (same one `roomviewer`'s row was added
to) and add:

```js
{ id: 'wallcatalog', title: 'Wall Catalog', subtitle: 'Browse and buy scanned wall items', icon: ICONS.wallcatalog, close: false, onClick: function() { if (window.__wc_open) window.__wc_open(); } },
```

- [ ] **Step 4: Register `__wc_panel` for bring-to-front**

Find the bring-to-front `_IDS` array (search for `'__rv_panel'`, added when Room Viewer
was built) and add `'__wc_panel'` to it, the same way.

- [ ] **Step 5: Register the bundle in `manifest.json`**

Find the MAIN-world `content_scripts` entry's `js` array (where
`"extensions/room-viewer.bundle.js"` was appended) and append
`"extensions/wall-catalog.bundle.js"` as the last entry.

- [ ] **Step 6: Verify live**

Reload the extension. Confirm:
- A "Wall Catalog" tile appears in the hub, in the same category as Room Viewer.
- Clicking it opens a draggable panel.
- If you have catalog data already scanned (via room-clone.js), categories appear and
  expanding one renders real furniture images, not blank/broken icons.
- Favoriting an item and switching to the Favorites tab shows it there; reloading the
  extension and reopening the panel keeps the favorite.
- Clicking a non-restricted item's card sends a purchase and the status line reports the
  outcome.

- [ ] **Step 7: Commit**

```bash
git add extensions/wall-catalog/src/main.ts extensions/wall-catalog.bundle.js content.js manifest.json
git commit -m "feat: add wall catalog browser panel, hub tile, and manifest entry"
```

---

## Task 10: Final full verification pass

- [ ] **Step 1: Run the full test suite**

Run: `cd extensions/wall-catalog && npm test`
Expected: all tests across `catalogData.test.ts`, `stateStore.test.ts`,
`favorites.test.ts`, `purchase.test.ts` pass.

- [ ] **Step 2: Run the full typecheck**

Run: `cd extensions/wall-catalog && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Rebuild**

Run: `cd extensions/wall-catalog && npm run build`
Expected: `extensions/wall-catalog.bundle.js` rebuilt with no errors.

- [ ] **Step 4: Live end-to-end check**

Reload the extension in the browser and walk through Task 9 Step 6's checklist one more
time from a cold reload, to confirm nothing regressed across the full task sequence.
