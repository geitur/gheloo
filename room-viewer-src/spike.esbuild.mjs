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
