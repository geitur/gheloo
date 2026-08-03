import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/thumbnail.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome110',
  outfile: '../room-viewer.bundle.js',
  logLevel: 'info',
  // The extension has no devtools access on the target machine (tested live, in-browser,
  // only) — an uncaught top-level error here otherwise just silently aborts the IIFE with
  // nothing to go on beyond "ran but never registered". Wrapping the whole bundle (banner
  // runs before, footer after — together they wrap the format:'iife' output itself) lets
  // room-viewer-loader.js report the actual error through the existing on-screen log
  // instead of guessing at it blind.
  banner: { js: 'try {' },
  footer: { js: '} catch (e) { window.__rv_loadError = (e && e.stack) ? e.stack : String(e); }' }
});
