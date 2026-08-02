# Gheloo

A Chrome extension for [leet.city](https://www.leet.city) — a hub of tools for the hotel client, from packet-level scripting to full auto-play minigames.

This repo is private, shared with friends. Not on the Chrome Web Store — load it unpacked.

## Install

1. Grab the latest zip from [Releases](https://github.com/geitur/gheloo/releases/latest) and unzip it.
2. Go to `chrome://extensions`, turn on **Developer mode** (top right).
3. **Load unpacked** → pick the unzipped folder.
4. Open [leet.city/hotel](https://www.leet.city/hotel) — the Gheloo hub icon shows up in the toolbar.

## Staying updated

There's no Chrome Web Store auto-update since this isn't published there. Instead: the toolbar icon badges red when a newer version exists, and an in-game toast pops up on login pointing at the latest release. Grab the new zip, reload the extension in `chrome://extensions`, refresh the hotel.

## What's in the hub

- **Scripting** — Packet Sender, Packet Logger, Macros, Multi Tab Sender, Room Inspector
- **Games** — Color Party auto-play, Guitar Hero auto-play
- **Rooms** — Furni Hider, Room Clone, Area Mover
- **Fun** — User Database, Mimic, Friend Adder
- **Exploits** — Marktplaats, Photo Library
- **Settings** — FPS overlay, appearance toggles, Room History, Marktplaats Alerts
- **Extensions** — paste your own JS, runs alongside everything else, no rebuild needed

## Layout

```
core/          protocol plumbing every panel depends on (websocket, packet parsers/ids, bridge, loading screen)
extensions/    one folder per hub tab above, plus userext/ (the in-game Extensions panel's own code)
icons/         toolbar/manifest icons
content.js     the hub shell — wires every panel into the sidebar
background.js  service worker — update checking, cross-tab messaging
manifest.json  Chrome extension manifest
```

## Building a new tool / writing an in-game extension

See [extensions/README.md](extensions/README.md) — covers both the in-game paste-your-own-JS Extensions panel and adding a proper new panel to this repo, plus the shared color/type system every panel uses so new tools don't look bolted-on.
