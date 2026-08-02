# Room Viewer (nitro-renderer panel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Gheloo panel that renders the current room (heightmap + floor
items + wall items) using the real `@nitrots/nitro-renderer` engine and leet's own asset
CDN, instead of the flat icons Gheloo uses elsewhere.

**Architecture:** A new `extensions/room-viewer/` TypeScript source tree, bundled by
esbuild into `extensions/room-viewer.bundle.js` and loaded as a normal MAIN-world
content script (new to this repo — see Task 1). It boots a standalone
`@nitrots/nitro-renderer` `RoomEngine` with no real game connection (socket disabled via
config override — see Task 3's spike), fetches leet's own `renderer-config.json` for
asset URLs, and feeds the scene from `window.Room` (already populated live by
`parsers.js`) via the engine's public `createRoomInstance` / `addFurnitureFloor` /
`addFurnitureWall` APIs — the same public entry points the library's own
`RoomPreviewer` (catalog thumbnails) uses.

**Tech Stack:** TypeScript, esbuild, `@nitrots/nitro-renderer` 1.6.6, `pixi.js` (peer
dependency of nitro-renderer), Node's built-in `node:test` for the one pure-function
unit test in this plan.

**A note on testing in this plan:** Almost everything here is either (a) a pure data
transform (testable with real assertions, and this plan writes real tests for those) or
(b) PixiJS canvas rendering inside a real browser page connected to a live game session
(not meaningfully unit-testable — there's no assertion for "does this sprite look like a
chair"). For (b), every task's verification step is a specific, concrete visual check the
human runs in the browser and reports back, per this repo's own stated policy in
`extensions/README.md` ("you have no browser... hand verification back to the person you're
working with"). Don't invent fake assertions for rendering output.

---

## Task 1: Scaffold the build (package.json, tsconfig, esbuild)

**Files:**
- Create: `extensions/room-viewer/package.json`
- Create: `extensions/room-viewer/tsconfig.json`
- Create: `extensions/room-viewer/esbuild.config.mjs`
- Create: `extensions/room-viewer/src/main.ts` (placeholder entry, replaced in later tasks)

- [ ] **Step 1: Create `extensions/room-viewer/package.json`**

```json
{
  "name": "gheloo-room-viewer",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "build": "node esbuild.config.mjs",
    "test": "node --test --experimental-strip-types src/**/*.test.ts"
  },
  "dependencies": {
    "@nitrots/nitro-renderer": "1.6.6",
    "pixi.js": "^7.4.0"
  },
  "devDependencies": {
    "esbuild": "^0.24.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create `extensions/room-viewer/tsconfig.json`**

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
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `extensions/room-viewer/esbuild.config.mjs`**

```js
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome110',
  outfile: '../room-viewer.bundle.js',
  logLevel: 'info'
});
```

- [ ] **Step 4: Create a placeholder `extensions/room-viewer/src/main.ts`**

```ts
console.log('[RoomViewer] bundle loaded');
```

- [ ] **Step 5: Install and build**

Run: `cd extensions/room-viewer && npm install && npm run build`
Expected: `extensions/room-viewer.bundle.js` is created; esbuild prints a file size
summary with no errors.

- [ ] **Step 6: Commit**

```bash
git add extensions/room-viewer/package.json extensions/room-viewer/tsconfig.json extensions/room-viewer/esbuild.config.mjs extensions/room-viewer/src/main.ts extensions/room-viewer.bundle.js
git commit -m "build: scaffold room-viewer esbuild project"
```

Note: `extensions/room-viewer/node_modules/` and `package-lock.json` should NOT be
committed — add `extensions/room-viewer/node_modules/` to the repo's `.gitignore` in this
step if it isn't already covered.

---

## Task 2: Wall item location parser (pure function, unit tested)

Gheloo's `Items` (wall items) parser (`parsers.js:343`) currently stores each wall item's
placement as a raw, unparsed `location` string (e.g. Nitro's classic wall-item format).
`addFurnitureWall` needs numeric position/direction. This is the one piece of new logic
in this plan that's a pure string→data transform, so it gets a real test — and per this
repo's "don't guess a byte layout" policy, it's explicitly flagged for confirmation
against a real capture before Task 6 relies on it.

**Files:**
- Create: `extensions/room-viewer/src/wallLocation.ts`
- Create: `extensions/room-viewer/src/wallLocation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// extensions/room-viewer/src/wallLocation.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWallLocation } from './wallLocation.ts';

test('parses a left-wall location string', () => {
  const result = parseWallLocation(':w=180,34,l');
  assert.deepEqual(result, { x: 180, y: 34, wallSide: 'l' });
});

test('parses a right-wall location string', () => {
  const result = parseWallLocation(':w=20,5,r');
  assert.deepEqual(result, { x: 20, y: 5, wallSide: 'r' });
});

test('throws on an unrecognized format instead of silently returning wrong data', () => {
  assert.throws(() => parseWallLocation('garbage'), /unrecognized wall location/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extensions/room-viewer && npm test`
Expected: FAIL — `wallLocation.ts` does not exist yet (module not found).

- [ ] **Step 3: Write the implementation**

```ts
// extensions/room-viewer/src/wallLocation.ts
export interface WallLocation {
  x: number;
  y: number;
  wallSide: 'l' | 'r';
}

const WALL_LOCATION_RE = /^:w=(-?\d+),(-?\d+),([lr])$/;

export function parseWallLocation(location: string): WallLocation {
  const match = WALL_LOCATION_RE.exec(location);

  if (!match) {
    throw new Error(`unrecognized wall location format: ${location}`);
  }

  const [, x, y, wallSide] = match;

  return { x: Number(x), y: Number(y), wallSide: wallSide as 'l' | 'r' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extensions/room-viewer && npm test`
Expected: PASS (3 tests)

- [ ] **Step 5: Get a real capture to confirm the format**

This regex encodes the classic Nitro wall-item location format from public
documentation, but it has not been checked against an actual Gheloo capture. Before
Task 6 ships wall items:

1. Open Hub → Scripting → Packet Logger in leet, find an `Items` packet for a room with
   at least one wall item you can see (e.g. a poster) at a known visual position.
2. Copy the parsed `location` string Gheloo already extracts for that item
   (`window.Room.wallItems`, inspect in devtools console).
3. Confirm it matches `:w=X,Y,l` or `:w=X,Y,r` — if the real string looks different,
   update the regex and test cases in this task to match the real format before
   proceeding to Task 6.

- [ ] **Step 6: Commit**

```bash
git add extensions/room-viewer/src/wallLocation.ts extensions/room-viewer/src/wallLocation.test.ts
git commit -m "feat: parse wall item location strings for room-viewer"
```

---

## Task 3: Bootstrap spike — prove RoomEngine renders without a real connection

This is the highest-risk part of the whole plan (per the design spec). Before writing
any Gheloo panel UI, build a throwaway script that proves the full chain works: fetch
leet's real `renderer-config.json`, boot `RoomEngine` with no live socket, build a tiny
hardcoded room, add one hardcoded furni, and get pixels on screen. Run it via Gheloo's
own in-game Extensions panel (paste-JS-directly feature, documented in the root
`EXTENSIONS.md`) so it executes in the real page context — same origin as the already-
working `leet_furni.json` fetch, sidestepping any CORS uncertainty a standalone local
HTML file would have.

**Files:**
- Create: `extensions/room-viewer/src/spike/bootstrap.ts`
- Create: `extensions/room-viewer/spike.esbuild.mjs`

- [ ] **Step 1: Write the spike bootstrap**

```ts
// extensions/room-viewer/src/spike/bootstrap.ts
import { Application } from '@pixi/app';
import {
  FloorHeightMapMessageParser,
  LegacyDataType,
  Nitro,
  RoomPlaneParser,
  Vector3d
} from '@nitrots/nitro-renderer';

declare global {
  interface Window {
    NitroConfig: Record<string, unknown>;
  }
}

async function runSpike(): Promise<void> {
  // socket.url set to '' here wins over the fetched renderer-config.json's real value —
  // NitroConfiguration only lets a later fetch override a key if that fetch call passes
  // overrides=true, and the library's own config-loading path never does. This keeps us
  // from ever opening a real socket to leet's proxy.
  window.NitroConfig = {
    'socket.url': '',
    'config.urls': [
      'https://images.leet.city/leet-asset-bundles/config/renderer-config.json'
    ]
  };

  Nitro.bootstrap();
  const nitro = Nitro.instance;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('config load timed out')), 15000);

    nitro.core.configuration.events.addEventListener('NC_LOADED' as any, () => {
      clearTimeout(timeout);
      resolve();
    });

    nitro.core.configuration.init();
  });

  nitro.communication.init();
  nitro.init();

  const roomEngine = nitro.roomEngine;
  const roomId = 12345;

  const fhm = new FloorHeightMapMessageParser();
  fhm.parseModel('33333333\n30000003\n30000003\n30000003\n33333333', 0, false);

  const planeParser = new RoomPlaneParser();
  planeParser.initializeTileMap(fhm.width, fhm.height);

  for (let y = 0; y < fhm.height; y++) {
    for (let x = 0; x < fhm.width; x++) {
      planeParser.setTileHeight(x, y, fhm.getHeight(x, y));
    }
  }

  planeParser.initializeFromTileData(fhm.wallHeight);
  roomEngine.createRoomInstance(roomId, planeParser.getMapData());
  roomEngine.updateRoomInstancePlaneType(roomId, '110', '99999');

  // A hardcoded real furni typeId your account owns — swap this for one you can see
  // in-room right now, so success/failure is visually obvious.
  const testTypeId = 1; // REPLACE with a real typeId before running
  roomEngine.addFurnitureFloor(
    roomId, 1, testTypeId,
    new Vector3d(2, 2, 0), new Vector3d(0, 0, 0),
    0, new LegacyDataType(), NaN, -1, 0, -1, '', true, true
  );

  const display = roomEngine.getRoomInstanceDisplay(roomId, 1, 600, 400, 64);

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;top:16px;left:16px;z-index:99999;border:2px solid red;';
  document.body.appendChild(canvas);

  const app = new Application({ view: canvas, width: 600, height: 400 });
  if (display) app.stage.addChild(display as any);

  console.log('[RoomViewer spike] done — look for a red-bordered canvas top-left');
}

runSpike().catch(err => console.error('[RoomViewer spike] failed:', err));
```

- [ ] **Step 2: Add a build script for the spike**

```js
// extensions/room-viewer/spike.esbuild.mjs
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/spike/bootstrap.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome110',
  outfile: 'spike.bundle.js',
  logLevel: 'info'
});
```

Run: `cd extensions/room-viewer && node spike.esbuild.mjs`
Expected: `extensions/room-viewer/spike.bundle.js` created with no errors.

- [ ] **Step 3: Hand off to the human to run in-browser**

This step cannot be completed or verified by an AI agent — there is no browser available
here. Ask the person you're working with to:

1. Open `extensions/room-viewer/spike.bundle.js`, replace `testTypeId = 1` with a real
   floor furni typeId they own (check `window.Room.floorItems` in their current room for
   a real one), copy the full file contents.
2. In leet, open Hub → Extensions → `+ Add`, paste the contents, save, and ensure it's
   enabled.
3. Refresh the hotel page while standing in a room.
4. Report back: does a red-bordered canvas appear top-left? Does it show a small tile
   floor with one piece of furniture on it? If not, paste the exact console errors from
   devtools — likely failure points are the `config.urls` fetch (Cloudflare/CORS), or the
   `configuration.init()` → `communication.init()` → `roomEngine.init()` ordering (this
   sequence was reconstructed from reading the library's source, not from an official
   integration guide, since that lives in the separate `nitro-react` repo this plan
   doesn't have access to).

- [ ] **Step 4: Fix and re-run based on real console output**

Whatever breaks first, fix it and have the human re-test. Do not proceed to Task 4 until
step 3 produces a visible rendered furni. Common likely fixes, only apply the one that
matches the actual observed error:
- If the `NC_LOADED`-style event name is wrong: check
  `node_modules/@nitrots/nitro-renderer/src/core/configuration/ConfigurationEvent.ts` for
  the real constant value and use that string instead.
- If `nitro.communication.init()` throws because `communication` has no public `init`
  passthrough: call `(nitro as any).core.communication` directly, or re-check
  `node_modules/@nitrots/nitro-renderer/src/nitro/Nitro.ts` for the exact wiring — this
  plan's Task 3 sequence is a best-effort reconstruction, not a copy of a working example.

- [ ] **Step 5: Commit**

```bash
git add extensions/room-viewer/src/spike/bootstrap.ts extensions/room-viewer/spike.esbuild.mjs
git commit -m "spike: prove RoomEngine renders furniture without a live connection"
```

(Commit the spike even though it's throwaway — it's the reference implementation Task 4
builds on, and future readers need to see exactly what was proven to work.)

---

## Task 4: Real bootstrap module (extracted from the spike)

**Files:**
- Create: `extensions/room-viewer/src/bootstrap.ts`
- Modify: `extensions/room-viewer/src/main.ts`

- [ ] **Step 1: Extract the proven-working bootstrap sequence from Task 3 into a reusable module**

```ts
// extensions/room-viewer/src/bootstrap.ts
import { Nitro } from '@nitrots/nitro-renderer';

declare global {
  interface Window {
    NitroConfig: Record<string, unknown>;
  }
}

let bootPromise: Promise<typeof Nitro.instance> | null = null;

export function bootRoomEngine(): Promise<typeof Nitro.instance> {
  if (bootPromise) return bootPromise;

  bootPromise = new Promise((resolve, reject) => {
    window.NitroConfig = {
      'socket.url': '',
      'config.urls': [
        'https://images.leet.city/leet-asset-bundles/config/renderer-config.json'
      ]
    };

    Nitro.bootstrap();
    const nitro = Nitro.instance;

    const timeout = setTimeout(() => reject(new Error('[RoomViewer] config load timed out')), 15000);

    // NOTE: replace this event name with whatever Task 3 step 4 confirmed works.
    nitro.core.configuration.events.addEventListener('NC_LOADED' as any, () => {
      clearTimeout(timeout);

      try {
        nitro.communication.init();
        nitro.init();
        resolve(nitro);
      } catch (err) {
        reject(err);
      }
    });

    nitro.core.configuration.init();
  });

  return bootPromise;
}
```

- [ ] **Step 2: Wire it into main.ts as a smoke check**

```ts
// extensions/room-viewer/src/main.ts
import { bootRoomEngine } from './bootstrap.ts';

bootRoomEngine()
  .then(() => console.log('[RoomViewer] engine ready'))
  .catch(err => console.error('[RoomViewer] boot failed:', err));
```

- [ ] **Step 3: Rebuild and have the human confirm the log line**

Run: `cd extensions/room-viewer && npm run build`
Hand off: human pastes the rebuilt `extensions/room-viewer.bundle.js` into the same
Gheloo Extensions-panel slot used in Task 3 (or you'll wire it into manifest.json in
Task 8 — either works for this check), refreshes, and confirms
`[RoomViewer] engine ready` logs with no errors.

- [ ] **Step 4: Commit**

```bash
git add extensions/room-viewer/src/bootstrap.ts extensions/room-viewer/src/main.ts extensions/room-viewer.bundle.js
git commit -m "feat: extract room-viewer engine bootstrap into reusable module"
```

---

## Task 5: Build the room scene from window.Room

**Files:**
- Create: `extensions/room-viewer/src/scene.ts`

- [ ] **Step 1: Implement the tile map + floor/wall item builder**

```ts
// extensions/room-viewer/src/scene.ts
import {
  FloorHeightMapMessageParser,
  IRoomEngine,
  LegacyDataType,
  RoomPlaneParser,
  Vector3d
} from '@nitrots/nitro-renderer';
import { parseWallLocation } from './wallLocation.ts';

export const ROOM_VIEWER_ROOM_ID = 918273; // arbitrary, distinct from any real roomId

interface FloorItem {
  id: number;
  typeId: number;
  x: number;
  y: number;
  z: number;
  facing: number;
  extra: number;
  expires: number;
  usagePolicy: number;
  ownerId: number;
  ownerName: string;
  stuff?: { state?: string };
}

interface WallItem {
  id: number;
  typeId: number;
  location: string;
  state?: string;
}

export function buildRoomMap(roomEngine: IRoomEngine, floorPlan: string, wallHeight: number): void {
  const fhm = new FloorHeightMapMessageParser();
  fhm.parseModel(floorPlan, wallHeight, false);

  const planeParser = new RoomPlaneParser();
  planeParser.initializeTileMap(fhm.width, fhm.height);

  for (let y = 0; y < fhm.height; y++) {
    for (let x = 0; x < fhm.width; x++) {
      planeParser.setTileHeight(x, y, fhm.getHeight(x, y));
    }
  }

  planeParser.initializeFromTileData(fhm.wallHeight);
  roomEngine.createRoomInstance(ROOM_VIEWER_ROOM_ID, planeParser.getMapData());
  // Gheloo doesn't currently parse the room's actual wallpaper/floor texture ids, so this
  // uses the same generic placeholder pair the library's own RoomPreviewer defaults to —
  // furniture layout is accurate, floor/wall material is not (yet).
  roomEngine.updateRoomInstancePlaneType(ROOM_VIEWER_ROOM_ID, '110', '99999');
  planeParser.dispose();
  fhm.dispose();
}

export function addFloorItem(roomEngine: IRoomEngine, item: FloorItem): void {
  const objectData = new LegacyDataType();
  if (item.stuff && item.stuff.state) objectData.setString(item.stuff.state);

  roomEngine.addFurnitureFloor(
    ROOM_VIEWER_ROOM_ID,
    item.id,
    item.typeId,
    new Vector3d(item.x, item.y, item.z),
    new Vector3d(item.facing * 45, item.facing * 45, item.facing * 45),
    0,
    objectData,
    item.extra ?? NaN,
    item.expires ?? -1,
    item.usagePolicy ?? 0,
    item.ownerId ?? -1,
    item.ownerName ?? '',
    true,
    true
  );
}

export function addWallItem(roomEngine: IRoomEngine, item: WallItem): void {
  const parsed = parseWallLocation(item.location);
  const direction = parsed.wallSide === 'l' ? 2 : 4; // matches Nitro's wall direction enum for left/right walls

  roomEngine.addFurnitureWall(
    ROOM_VIEWER_ROOM_ID,
    item.id,
    item.typeId,
    new Vector3d(parsed.x, parsed.y, 0),
    new Vector3d(direction, direction, direction),
    0,
    item.state ?? '',
    -1,
    0,
    -1,
    '',
    true
  );
}

export function removeFloorItem(roomEngine: IRoomEngine, id: number): void {
  roomEngine.removeRoomObjectFloor(ROOM_VIEWER_ROOM_ID, id);
}

export function removeWallItem(roomEngine: IRoomEngine, id: number): void {
  roomEngine.removeRoomObjectWall(ROOM_VIEWER_ROOM_ID, id);
}
```

**Known unverified detail, flagged not hidden:** the `direction = 2 or 4` mapping for
left/right wall items is a placeholder based on the general shape of Nitro's direction
enum, not a confirmed value — Task 6's verification step checks whether wall items render
on the correct wall face and against the correct edge, and this value should be corrected
there if wrong.

- [ ] **Step 2: Rebuild**

Run: `cd extensions/room-viewer && npm run build`
Expected: no TypeScript/esbuild errors.

- [ ] **Step 3: Commit**

```bash
git add extensions/room-viewer/src/scene.ts
git commit -m "feat: build room-viewer scene from window.Room state"
```

---

## Task 6: Wire scene builder to a live room + human visual check

**Files:**
- Modify: `extensions/room-viewer/src/main.ts`

- [ ] **Step 1: Render the current room on engine ready**

```ts
// extensions/room-viewer/src/main.ts
import { bootRoomEngine } from './bootstrap.ts';
import { addFloorItem, addWallItem, buildRoomMap, ROOM_VIEWER_ROOM_ID } from './scene.ts';

declare global {
  interface Window {
    Room: {
      floorPlan: string | null;
      wallHeight: number | null;
      floorItems: Record<string, any>;
      wallItems: Record<string, any>;
    };
  }
}

async function renderCurrentRoom(): Promise<void> {
  const nitro = await bootRoomEngine();
  const roomEngine = nitro.roomEngine;

  if (!window.Room.floorPlan) {
    console.warn('[RoomViewer] no floorPlan yet — walk into a room first');
    return;
  }

  buildRoomMap(roomEngine, window.Room.floorPlan, window.Room.wallHeight ?? 0);

  for (const item of Object.values(window.Room.floorItems)) addFloorItem(roomEngine, item as any);
  for (const item of Object.values(window.Room.wallItems)) addWallItem(roomEngine, item as any);

  const display = roomEngine.getRoomInstanceDisplay(ROOM_VIEWER_ROOM_ID, 1, 600, 400, 64);

  const canvas = document.createElement('canvas');
  canvas.id = '__rv_test_canvas';
  canvas.style.cssText = 'position:fixed;top:16px;left:16px;z-index:99999;border:2px solid lime;';
  document.body.appendChild(canvas);

  const { Application } = await import('@pixi/app');
  const app = new Application({ view: canvas, width: 600, height: 400 });
  if (display) app.stage.addChild(display as any);

  console.log('[RoomViewer] rendered', Object.keys(window.Room.floorItems).length, 'floor items and', Object.keys(window.Room.wallItems).length, 'wall items');
}

bootRoomEngine().then(() => {
  // Wait a beat for parsers.js to have populated Room from the room-entry packet burst.
  setTimeout(() => { renderCurrentRoom().catch(err => console.error('[RoomViewer]', err)); }, 2000);
});
```

- [ ] **Step 2: Rebuild and hand off for a real visual check**

Run: `cd extensions/room-viewer && npm run build`

Hand off to the human: paste the rebuilt bundle into the Gheloo Extensions panel slot
(or wire into manifest.json now if Task 8 hasn't happened yet), stand in a room with a
mix of floor and wall furniture whose real layout you know, refresh, and check:

1. Does the lime-bordered canvas show a floor tile grid matching the real room's shape
   (same blocked/walkable tiles, roughly)?
2. Do the floor items appear at roughly the same relative tile positions as in the real
   room?
3. Do wall items appear at all, and if so, on the correct wall (left vs. right) — if not,
   flip the `direction = 2 : 4` mapping in `scene.ts`'s `addWallItem` and rebuild.
4. Report the console log's item counts — do they match what you'd expect for that room?

- [ ] **Step 3: Fix any issues the human reports, then re-verify step 2**

- [ ] **Step 4: Commit**

```bash
git add extensions/room-viewer/src/main.ts
git commit -m "feat: render the current live room in room-viewer"
```

---

## Task 7: Gheloo panel chrome (replace the test canvas with a real panel)

**Files:**
- Create: `extensions/room-viewer/src/panel.ts`
- Modify: `extensions/room-viewer/src/main.ts`

- [ ] **Step 1: Build the panel DOM using the house skeleton from `extensions/README.md`**

```ts
// extensions/room-viewer/src/panel.ts
export function ensureRoomViewerPanel(): { body: HTMLElement; isOpen: () => boolean } {
  const existing = document.getElementById('__rv_panel');
  if (existing) {
    return {
      body: existing.querySelector('#__rv_body') as HTMLElement,
      isOpen: () => (existing as HTMLElement).style.display !== 'none'
    };
  }

  const style = document.createElement('style');
  style.textContent = [
    '#__rv_panel{position:fixed;top:16px;right:16px;width:632px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
    '#__rv_panel *{box-sizing:border-box}',
    '.__rv_card_wrap{display:flex;flex-direction:column;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb}',
    '.__rv_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
    '.__rv_title{font:600 13px system-ui;color:#eceefb;flex:1}',
    '.__rv_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
    '.__rv_close:hover{color:#eceefb}',
    '#__rv_body{padding:8px}'
  ].join('');
  document.head.appendChild(style);

  const p = document.createElement('div');
  p.id = '__rv_panel';
  p.innerHTML =
    '<div class="__rv_card_wrap">' +
      '<div class="__rv_hdr" id="__rv_hdr">' +
        '<span class="__rv_title">Room Viewer</span>' +
        '<span class="__rv_close" id="__rv_close">&times;</span>' +
      '</div>' +
      '<div id="__rv_body"></div>' +
    '</div>';
  document.body.appendChild(p);
  p.style.display = 'none';

  (window as any).__ghk_makeDraggable(p, p.querySelector('#__rv_hdr'), '__ghk_rv_pos', (e: MouseEvent) => (e.target as HTMLElement).id === '__rv_close');
  p.querySelector('#__rv_close')!.addEventListener('click', () => { p.style.display = 'none'; });

  return {
    body: p.querySelector('#__rv_body') as HTMLElement,
    isOpen: () => p.style.display !== 'none'
  };
}

export function showRoomViewerPanel(): void {
  const p = document.getElementById('__rv_panel') as HTMLElement;
  if (p) p.style.display = '';
  if ((window as any).__ghk_bringToFront) (window as any).__ghk_bringToFront(p);
}
```

- [ ] **Step 2: Replace the Task 6 test canvas with the real panel, gate rendering on panel-open**

```ts
// extensions/room-viewer/src/main.ts — replace the canvas-creation block from Task 6 with:
import { ensureRoomViewerPanel } from './panel.ts';

// ...inside renderCurrentRoom(), replace the manual canvas + document.body.appendChild with:
const { body } = ensureRoomViewerPanel();
body.innerHTML = '';

const canvas = document.createElement('canvas');
body.appendChild(canvas);

const { Application } = await import('@pixi/app');
const app = new Application({ view: canvas, width: 600, height: 400 });
if (display) app.stage.addChild(display as any);
```

- [ ] **Step 3: Only run the render while the panel is open, per house pattern**

```ts
// extensions/room-viewer/src/main.ts — top-level, replacing the bootRoomEngine().then(...) block
import { ensureRoomViewerPanel, showRoomViewerPanel } from './panel.ts';

let rendered = false;

(window as any).__rv_open = function (): void {
  showRoomViewerPanel();

  if (!rendered) {
    rendered = true;
    bootRoomEngine().then(() => renderCurrentRoom().catch(err => console.error('[RoomViewer]', err)));
  }
};

ensureRoomViewerPanel();
```

- [ ] **Step 4: Rebuild and have the human confirm the panel opens/closes and drags correctly**

Run: `cd extensions/room-viewer && npm run build`
Hand off: human calls `window.__rv_open()` from devtools console (this becomes a real hub
row in Task 8), confirms the panel appears top-right in the Gheloo style, is draggable
by its header, and closes via the × button.

- [ ] **Step 5: Commit**

```bash
git add extensions/room-viewer/src/panel.ts extensions/room-viewer/src/main.ts
git commit -m "feat: give room-viewer a real Gheloo-style panel"
```

---

## Task 8: Wire into the extension (manifest.json + hub row)

**Files:**
- Modify: `manifest.json`
- Modify: `content.js` (add a row inside the `rooms` category of `CATEGORIES`)

- [ ] **Step 1: Add the bundle to manifest.json's content script list**

In `manifest.json`, find the MAIN-world content script block's `js` array (the one
already containing `parsers.js`, `content.js`, and every `extensions/*.js` entry) and add
`"extensions/room-viewer.bundle.js"` as the last entry, after
`"extensions/marktplaats-alerts.js"` — it must load after `parsers.js` (needs
`window.Room`) and after `content.js` (needs `window.Gheloo`/`__ghk_makeDraggable`, both
already guaranteed by every other extension file's position in this same list).

- [ ] **Step 2: Find the `rooms` category in `content.js`'s `CATEGORIES` and add a row**

Locate the `CATEGORIES` array inside `buildGhelooPanel` in `content.js`, find the entry
whose category is `rooms`, and add:

```js
{ id: 'roomviewer', title: 'Room Viewer', subtitle: 'Render this room with real nitro visuals', icon: ICONS.roomviewer,
  close: false, onClick: function() { if (window.__rv_open) window.__rv_open(); } },
```

Add a matching 24x24 `stroke="currentColor"` SVG under the `roomviewer` key in the
`ICONS` object above `CATEGORIES`, following the same viewBox/stroke pattern every
existing icon in that object uses (copy an existing simple icon's `<svg>` wrapper
attributes and swap the inner `<path>` for a simple room/grid glyph).

- [ ] **Step 3: Reload and hand off for an end-to-end check**

Hand off to the human: `chrome://extensions` → reload Gheloo → refresh the hotel while in
a room. Click the new "Room Viewer" hub row. Confirm:
1. The panel opens in the correct position (not overlapping other default-open panels).
2. The room renders exactly as validated in Task 6/7.
3. No console errors appear from the extra bundle loading alongside every other
   extension.

- [ ] **Step 4: Commit**

```bash
git add manifest.json content.js
git commit -m "feat: add Room Viewer hub row"
```

---

## Task 9: Live refresh on room/furni changes

**Files:**
- Modify: `extensions/room-viewer/src/main.ts`

- [ ] **Step 1: Rebuild the scene on room change, and only while the panel is open**

```ts
// extensions/room-viewer/src/main.ts — add near the bottom, after ensureRoomViewerPanel()
let currentRoomId: number | null = null;

(window.onPacket as any)('RoomReady', () => {
  currentRoomId = null; // force a full rebuild next render, window.Room itself is reset by parsers.js
});

setInterval(() => {
  const { isOpen } = ensureRoomViewerPanel();
  if (!isOpen() || !rendered) return;

  if (window.Room.id !== currentRoomId && window.Room.floorPlan) {
    currentRoomId = window.Room.id as any;
    renderCurrentRoom().catch(err => console.error('[RoomViewer]', err));
  }
}, 2000);
```

This mirrors the house "only run heavy logic when the panel is open" pattern
(`extensions/README.md`) — polling every 2s for a room-id change, and only while the
panel is visible. Full furni-by-furni incremental diffing (add/remove single items
without rebuilding the whole scene) is explicitly out of scope for v1 — a full rebuild on
room change is cheap enough and far simpler than tracking incremental
`ObjectAdd`/removal events through to `RoomEngine`.

- [ ] **Step 2: Rebuild and hand off for a room-change check**

Run: `cd extensions/room-viewer && npm run build`
Hand off: human opens the panel, walks to a different room, confirms the panel updates
to the new room within ~2 seconds without needing to reopen the panel.

- [ ] **Step 3: Commit**

```bash
git add extensions/room-viewer/src/main.ts
git commit -m "feat: refresh room-viewer scene on room change"
```

---

## Explicit non-goals (confirm nothing here crept in during implementation)

- No avatar/user rendering.
- No furniture drag/move/edit, no packets sent to the server.
- No accurate wallpaper/floor texture — v1 uses a generic placeholder pair
  (`'110'`/`'99999'`) because Gheloo doesn't parse the room-paint packet yet.
- No standalone app — this only ever runs as a Gheloo content-script panel.
