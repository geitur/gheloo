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
// bypassing the barrel. It's the same class (same module instance, same prototype), just
// resolved via a shorter path — safe for the `instanceof ObjectRoomMapUpdateMessage` check
// the live game engine's RoomLogic.processUpdateMessage performs on it.
export { RoomObjectUpdateMessage } from '@nitrots/nitro-renderer/src/room/messages/RoomObjectUpdateMessage';
