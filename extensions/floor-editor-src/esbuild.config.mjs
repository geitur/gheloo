import * as esbuild from 'esbuild';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { statSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Bundle-size fix: redirect a handful of @nitrots/nitro-renderer's OWN internal barrel
// imports to direct file imports. -------------------------------------------------------
//
// This plugin exists because floor-editor.bundle.js is committed to the repo and loaded
// unconditionally as a MAIN-world content script on every page — unlike room-viewer.bundle.js,
// which is hosted externally and cache-gated specifically because of its size. This bundle is
// supposed to be tiny (no PIXI rendering, just data/message classes); at one point it
// regressed to ~3.7MB, effectively the entire PIXI-based renderer, by accident.
//
// applyTilemap.ts only needs four small vendor classes (FloorHeightMapMessageParser,
// ObjectRoomMapUpdateMessage, RoomObjectCategory, RoomPlaneParser) and imports each one via a
// deep path directly into its source file (see the comment at the top of applyTilemap.ts) —
// that alone avoids OUR imports pulling in unrelated stuff through @nitrots/nitro-renderer's
// package-root barrel (index.ts -> src/index.ts -> six-way `export *` fan-out) or the
// intermediate directory barrels.
//
// That's not sufficient on its own, though: some of those four files have their OWN internal
// imports that go through a barrel, inside node_modules, which we can't edit directly. Three
// specific cases were found by tracing esbuild's metafile (which file pulled in how many
// bytes, and via which import) after the deep-import change alone left the bundle at ~3.5MB —
// still nearly the full size:
//
//   1. node_modules/@nitrots/nitro-renderer/src/nitro/room/messages/ObjectRoomMapUpdateMessage.ts
//      does `import { RoomObjectUpdateMessage } from '../../../room';` — barrel import into
//      src/room/index.ts, which `export *`s the room rendering/visualization subsystem.
//   2. The same file also does `import { RoomMapData } from '../object';` — barrel import
//      into src/nitro/room/object/index.ts, which `export *`s avatar/furniture/pet
//      visualizations, rasterizers, etc.
//   3. RoomPlaneParser.ts, RoomWallData.ts, and RoomPlaneData.ts (all under
//      src/nitro/room/object/) each do `import { IVector3D, Vector3d } from '../../../api';`
//      — barrel import into src/api/index.ts, the package's largest barrel, part of which
//      (asset loading) has real PIXI value dependencies (Loader, Texture, etc.).
//
// Critically, none of these three barrels are reachable ONLY through RoomEngine — they're
// genuinely needed by code this file legitimately uses (ObjectRoomMapUpdateMessage extends
// RoomObjectUpdateMessage, and RoomLogic.ts:212 checks `instanceof ObjectRoomMapUpdateMessage`
// with no fallback, so it must stay the real vendor class, not a local lookalike). The fix is
// to keep using the real classes, but resolve their own internal barrel imports to the exact
// sibling file they need instead, via the shims in src/vendor-barrel-shims/. Each shim
// re-exports the same class/type from its direct source file — same module instance, same
// prototype chain, just reached by a shorter path — so `instanceof` and every other runtime
// check work identically WITHIN THIS BUNDLE. Whether that's also true against the live game
// engine's own separately-built copy of RoomLogic.processUpdateMessage is NOT verified — this
// extension's bundle and the live client are two independent JS bundles built from the same
// vendor source, and two separate module graphs don't automatically share class identity just
// because the source is identical. See the longer note in
// src/vendor-barrel-shims/roomMessagesBarrel.ts; this needs live in-game testing to confirm.
//
// Net effect confirmed via `node esbuild.config.mjs` + `ls -la ../floor-editor.bundle.js`:
// ~3.72MB -> ~90KB. If this bundle balloons again, re-run with `metafile: true` (see esbuild
// docs for `analyzeMetafile`) to find which import pulled in the most bytes, then check
// whether it's routed through one of @nitrots/nitro-renderer's own barrel index.ts files.
const vendorRoot = path.resolve(__dirname, 'node_modules/@nitrots/nitro-renderer/src');
const objectRoomMapUpdateMessageFile = path.join(vendorRoot, 'nitro/room/messages/ObjectRoomMapUpdateMessage.ts');
const roomObjectDataDir = path.join(vendorRoot, 'nitro/room/object');

const debloatVendorBarrelImports = {
  name: 'debloat-vendor-barrel-imports',
  setup(build) {
    // Case 1 above.
    build.onResolve({ filter: /^\.\.\/\.\.\/\.\.\/room$/ }, (args) => {
      if (args.importer === objectRoomMapUpdateMessageFile) {
        return { path: path.resolve(__dirname, 'src/vendor-barrel-shims/roomMessagesBarrel.ts') };
      }
      return null;
    });
    // Case 2 above.
    build.onResolve({ filter: /^\.\.\/object$/ }, (args) => {
      if (args.importer === objectRoomMapUpdateMessageFile) {
        return { path: path.resolve(__dirname, 'src/vendor-barrel-shims/roomObjectBarrel.ts') };
      }
      return null;
    });
    // Case 3 above — matched by directory rather than an exact file list, since multiple
    // sibling files in src/nitro/room/object/ share this exact same barrel import.
    build.onResolve({ filter: /^\.\.\/\.\.\/\.\.\/api$/ }, (args) => {
      if (path.dirname(args.importer) === roomObjectDataDir) {
        return { path: path.resolve(__dirname, 'src/vendor-barrel-shims/apiRoomBarrel.ts') };
      }
      return null;
    });
  },
};

await esbuild.build({
  entryPoints: ['src/applyTilemap.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome110',
  outfile: '../floor-editor.bundle.js',
  logLevel: 'info',
  plugins: [debloatVendorBarrelImports],
  // Same reasoning as room-viewer-src/esbuild.config.mjs: no devtools access on the
  // target machine, so an uncaught top-level error here would otherwise just silently
  // fail to register window.__fe_applyTilemapLive with nothing to go on. Surface it
  // through the on-screen log instead (extensions/rooms/floor-editor.js checks
  // window.__fe_loadError).
  banner: { js: 'try {' },
  footer: { js: '} catch (e) { window.__fe_loadError = (e && e.stack) ? e.stack : String(e); }' }
});

// --- Bundle-size regression guard -------------------------------------------------------
//
// Nothing above stops a future change (or a @nitrots/nitro-renderer version bump that shifts
// an internal file path the onResolve plugin above matches by exact path) from silently
// breaking the redirect and letting this bundle balloon back toward the ~3.7MB it was before
// this fix — the build would succeed cleanly with zero warning. Fail loudly instead.
const builtSize = statSync(path.resolve(__dirname, '../floor-editor.bundle.js')).size;
const MAX_BYTES = 500 * 1024;
if (builtSize > MAX_BYTES) {
  throw new Error(
    `floor-editor.bundle.js is ${(builtSize / 1024).toFixed(0)}KB, over the ${MAX_BYTES / 1024}KB guard — ` +
    `this bundle should only contain small data/logic classes, not the PIXI renderer. If it's ` +
    `ballooned again, re-run with { metafile: true } in the esbuild.build() call above and inspect ` +
    `which import pulled in the extra weight (same diagnosis approach used to fix this the first ` +
    `time, see the onResolve plugin comments above).`
  );
}
