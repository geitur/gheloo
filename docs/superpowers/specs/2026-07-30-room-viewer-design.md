# Room Viewer (nitro-renderer panel) — Design

## Problem

Leet's own web client is built on `nitro-react` / `@nitrots/nitro-renderer` (PixiJS-based
room renderer, https://github.com/billsonnn/nitro-renderer). A friend has embedded
nitro-renderer into their own app and can render full rooms outside of leet, with
furniture-move planned later. We want the same capability inside Gheloo: a panel that
renders the current room with real nitro visuals (not flat icons), starting read-only.

## Scope (v1)

- Read-only viewer: floor heightmap + floor items + wall items, rendered with real
  nitro spritesheets/visuals (not the flat `hof_furni/icons/*` PNGs Gheloo uses elsewhere).
- No avatars, no furniture dragging/moving, no writing back to the server. Both are
  explicitly future work, not part of this build.
- Lives as a normal Gheloo panel (new hub row, category `rooms`), not a separate app —
  the rendering canvas runs inside the leet.city page alongside the existing extensions.

## Architecture

```
leet.city page
└─ Gheloo content scripts (MAIN world, no build step today)
   ├─ ws-url.js, pkt.js, ws.js, parsers.js  → window.Room / window.FurniData (live)
   ├─ content.js                             → hub, CATEGORIES, panel chrome
   └─ extensions/room-viewer.bundle.js  ← NEW, built artifact (see Build below)
        - PixiJS canvas mounted into a standard Gheloo panel
        - fetches renderer-config.json once, configures nitro-renderer's AssetManager
        - reads window.Room (already populated by parsers.js) to build/update the scene
        - no socket connection, no SSO ticket — this is a renderer only, not a client
```

### Build step (new to this repo)

The repo currently has zero npm/build tooling — every file is a plain script loaded
directly by `manifest.json`. `@nitrots/nitro-renderer` is a TypeScript/npm package
(PixiJS peer dependency) and can't be loaded as a raw script.

- New `extensions/room-viewer/` folder: TypeScript source (`src/main.ts` + supporting
  files), plus `package.json`, `tsconfig.json`, and an esbuild config scoped to this
  folder.
- `npm run build:room-viewer` (esbuild) bundles the source + `@nitrots/nitro-renderer`
  + `pixi.js` into a single IIFE: `extensions/room-viewer.bundle.js`.
- The bundle is committed like any other extension file (no CI build in this repo).
  After editing source under `extensions/room-viewer/src/`, rebuild and commit the
  bundle before reloading the extension.
- `manifest.json`: add `"extensions/room-viewer.bundle.js"` to the existing MAIN-world
  content script list, after `parsers.js` (so `window.Room`/`window.FurniData` exist
  before this script runs), same as every other extension file.

### Config / asset source

Leet's own client bootstrap (confirmed by the user from leet.city's own loader script)
fetches:

```
config.urls: [
  "https://images.leet.city/leet-asset-bundles/config/renderer-config.json",
  "https://images.leet.city/leet-asset-bundles/config/ui-config.json"
]
```

`renderer-config.json` (confirmed content, pasted by user) uses the **standard
nitro-renderer config schema** — `furni.asset.url`, `generic.asset.url`,
`avatar.asset.url`, `hof.furni.url`, all pointing at `.nitro` bundle files under
`${asset.url}/libraries/...`. This is exactly the format `@nitrots/nitro-renderer`'s
built-in `AssetManager` / bundle loader expects — no adapter/translation layer needed.

Room Viewer fetches this same `renderer-config.json` at panel init (same-origin fetch
from the leet.city page, same pattern `parsers.js` already uses successfully for
`leet_furni.json` — no auth/SSO ticket required for these static asset endpoints) and
feeds it into nitro-renderer's asset manager. **Not yet verified**: a direct `curl` to
this URL from outside the browser returned a Cloudflare bot-challenge 403 — inconclusive
for whether the fetch works from inside the real page context. Must be confirmed live
during implementation (open dev tools, check the fetch actually resolves to JSON).

We deliberately skip the rest of the normal Nitro client bootstrap: no `socket.url`
connection, no `sso.ticket`, no `avatar.*` data loading for v1. We only need the
renderer + asset pipeline, not a live game connection — we already have room state from
Gheloo's own packet parsing.

### Data source: window.Room → RoomEngine

`window.Room` (populated live by `parsers.js`, already shipped) has everything v1 needs:

- `Room.floorPlan` — heightmap string (already in the same char-per-tile format Nitro's
  `HeightMap` parsing produces)
- `Room.wallHeight`, `Room.hideWalls`, `Room.wallThickness`, `Room.floorThickness`
- `Room.floorItems` / `Room.wallItems` — keyed by item id, with type id + position/rotation
- `Room.id` — changes on `RoomReady`

The normal way nitro-renderer receives this data is via its own `NitroCommunicationManager`
consuming raw game packets. We are not running that — we already have parsed state sitting
in `window.Room`. **This is the main open technical risk**: Room Viewer's glue code must
call whatever public, lower-level RoomEngine APIs exist (setting the tile map directly,
adding floor/wall furniture objects directly) to build the scene from `window.Room` instead
of from a live packet stream. Whether `@nitrots/nitro-renderer` exposes clean public
entry points for this, or whether it's only reachable through its internal message-handler
plumbing, is unverified and is the first thing to spike during implementation.

### Refresh behavior

Following the existing Gheloo pattern (`README.md`'s "only run heavy logic when the panel
is open" / room-history.js's DOM-mutation-driven refresh):

- Rebuild the scene on `RoomReady` (room changed).
- Update on floor/wall item add/update/remove (hook the same events `parsers.js` already
  fires into, don't re-parse packets ourselves).
- Only run/render while the panel is open; pause when closed.

## Explicit non-goals (v1)

- Avatars/users are not rendered.
- No furniture drag/move, no editing, no writing packets back to the server.
- No standalone app — this does not replace or wrap `nitro-react`; it's a narrow,
  read-only re-render of room state Gheloo already has.

## Risks to verify during implementation (not blocking design)

1. `renderer-config.json` fetch from inside the real page — confirm it resolves to JSON
   (blocked from outside by Cloudflare bot-challenge; expected to work same-origin from
   the page itself, same as the already-working `leet_furni.json` fetch).
2. `.nitro` asset bundle version compatibility between leet's hosted assets and whatever
   `@nitrots/nitro-renderer` npm version we pin.
3. Feeding `RoomEngine` from `window.Room` directly instead of via a live socket/packet
   stream — needs a spike to find the right public API surface before committing to the
   full build.
