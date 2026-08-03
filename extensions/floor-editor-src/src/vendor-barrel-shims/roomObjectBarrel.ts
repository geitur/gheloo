// Shim used by esbuild.config.mjs to redirect a specific internal vendor import.
//
// @nitrots/nitro-renderer's own src/nitro/room/messages/ObjectRoomMapUpdateMessage.ts does
// `import { RoomMapData } from '../object';` — a *barrel* import into
// src/nitro/room/object/index.ts, which `export *`s the entire room object visualization
// and logic subsystem (avatar/furniture/pet visualizations, rasterizers, etc.). See the
// bundle-size note in esbuild.config.mjs.
//
// Re-exports the exact same RoomMapData class from its direct source file, bypassing the
// barrel.
export { RoomMapData } from '@nitrots/nitro-renderer/src/nitro/room/object/RoomMapData';
