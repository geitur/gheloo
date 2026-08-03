// Shim used by esbuild.config.mjs to redirect a specific internal vendor import.
//
// @nitrots/nitro-renderer's own src/nitro/room/messages/ObjectRoomMapUpdateMessage.ts does
// `import { RoomObjectUpdateMessage } from '../../../room';` — a *barrel* import (the
// package's own code, not ours; we can't edit node_modules). That barrel
// (src/room/index.ts) re-exports a large chunk of the room rendering/visualization
// subsystem via `export *`, so pulling anything through it drags in far more than the one
// small class we need, regardless of how applyTilemap.ts imports ObjectRoomMapUpdateMessage
// itself. See the bundle-size note in esbuild.config.mjs for the full picture.
//
// This file re-exports the exact same class object from its direct source file instead,
// bypassing the barrel. It's the same class (same module instance, same prototype) WITHIN
// THIS BUNDLE. Whether that's enough for the live game engine's own RoomLogic.processUpdateMessage
// (RoomLogic.ts:212: `if (message instanceof ObjectRoomMapUpdateMessage) { ...; return; }`, no
// fallback) to accept a message built from our class via `instanceof ObjectRoomMapUpdateMessage`
// is NOT verified — this extension's bundle and the live game client are two independently-built
// JS bundles from the same TS source, and two separate module graphs don't automatically share
// class identity just because they came from identical source. This is unverified pending live
// testing. If a live tilemap edit silently does nothing (visually), check this first — note that
// applyTilemapLive's `true` return only confirms `roomObject` was found, not that the message was
// actually consumed by the engine.
export { RoomObjectUpdateMessage } from '@nitrots/nitro-renderer/src/room/messages/RoomObjectUpdateMessage';
