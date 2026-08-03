# Room Viewer — source

TypeScript source for the Room Viewer panel. This is build-time source, not a content
script — it doesn't ship as-is. `npm run build` bundles it (together with
`@nitrots/nitro-renderer` and `@pixi/app`) into one ~3.6MB `room-viewer.bundle.js`.

That bundle is *not* committed to this repo and isn't part of a normal Gheloo update — it's
hosted as a Release on the separate [gheloo-assets](https://github.com/geitur/gheloo-assets)
repo instead, fetched once by `core/bridge.js` and cached client-side in IndexedDB from then
on. See the comments in `core/bridge.js` and `extensions/rooms/room-viewer-loader.js` for
how that loading works.

## Editing the source

Normal edits to `src/*.ts` ship with the rest of Gheloo like any other file — nothing
special there. It's only the *compiled bundle* that lives outside the repo, because that's
the large third-party-inclusive artifact, not the source.

## Publishing a rebuilt bundle

The renderer panel itself won't pick up source changes until you rebuild and republish:

```
cd room-viewer-src
npm install         # first time only
npm run typecheck   # optional, catches type errors before building
npm run build        # writes ../room-viewer.bundle.js
```

Then:

1. `gh release create roomviewer-vN room-viewer.bundle.js --repo geitur/gheloo-assets --title "Room Viewer bundle vN" --notes "..."` — bump `N` from whatever the last tag was.
2. In `core/bridge.js`, bump `RV_BUNDLE_VERSION` to match the new tag.
3. Commit + push the main repo as normal.

Everyone's cached copy is keyed by `RV_BUNDLE_VERSION`, so bumping it is what actually
triggers a fresh download on their end — editing the source alone does nothing until both
steps above happen.
