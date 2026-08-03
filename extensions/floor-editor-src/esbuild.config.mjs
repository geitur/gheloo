import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/applyTilemap.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome110',
  outfile: '../floor-editor.bundle.js',
  logLevel: 'info',
  // Same reasoning as room-viewer-src/esbuild.config.mjs: no devtools access on the
  // target machine, so an uncaught top-level error here would otherwise just silently
  // fail to register window.__fe_applyTilemapLive with nothing to go on. Surface it
  // through the on-screen log instead (extensions/rooms/floor-editor.js checks
  // window.__fe_loadError).
  banner: { js: 'try {' },
  footer: { js: '} catch (e) { window.__fe_loadError = (e && e.stack) ? e.stack : String(e); }' }
});
