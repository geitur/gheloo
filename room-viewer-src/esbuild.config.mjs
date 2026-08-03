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
