// Shim used by esbuild.config.mjs to redirect a specific internal vendor import.
//
// Several files under @nitrots/nitro-renderer's src/nitro/room/object/ (RoomPlaneParser.ts,
// RoomWallData.ts, RoomPlaneData.ts) each do `import { IVector3D, Vector3d } from
// '../../../api';` — a *barrel* import into src/api/index.ts, the package's single largest
// barrel (re-exports asset loading, avatar data, etc., some of which has real PIXI value
// dependencies). See the bundle-size note in esbuild.config.mjs.
//
// Re-exports the exact same Vector3d class (and IVector3D type, erased at runtime) from
// their direct source files, bypassing the barrel.
export { Vector3d } from '@nitrots/nitro-renderer/src/api/room/Vector3d';
export type { IVector3D } from '@nitrots/nitro-renderer/src/api/room/IVector3D';
