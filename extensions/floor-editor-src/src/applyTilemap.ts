import { FloorHeightMapMessageParser, ObjectRoomMapUpdateMessage, RoomEngine, RoomObjectCategory, RoomPlaneParser } from '@nitrots/nitro-renderer';

// Rebuilds the floor mesh of the LIVE room from a tilemap string, without waiting for a
// round trip to the server. This is the same trick @nitrots/nitro-renderer's own
// RoomPreviewer class uses internally (RoomPreviewer.updatePreviewModel, in the
// installed package at node_modules/@nitrots/nitro-renderer/src/nitro/room/preview/RoomPreviewer.ts),
// pointed at the real room object instead of a private preview room, and simplified:
// - Door position is passed in directly (from window.FloorplanEditor.doorLocation, which
//   the native editor already tracks correctly for the real room) instead of re-derived
//   with RoomPreviewer's wall-adjacency heuristic, which was written for its own small
//   fixed-size preview room and isn't guaranteed correct for arbitrary real layouts.
// - Wall geometry is intentionally NOT rebuilt here (RoomPreviewer.updatePreviewModel
//   does this via an internal `getLegacyWallGeometry` cast not on the public IRoomEngine
//   interface). Scope for v1: tile walkability edits (Expand/Shrink/native paint of
//   walkable vs void) preview live; painting a *different height* on a tile will still
//   move the floor mesh but won't resize the surrounding wall to match until the editor
//   is closed and the server's own update comes back. See
//   docs/superpowers/specs/2026-08-03-floor-editor-design.md for the full risk writeup.
export function applyTilemapLive(tilemapString: string, wallHeight: number, scale: boolean, doorX: number, doorY: number): boolean {
  const engine = (window as any).RoomEngine as RoomEngine | undefined;
  const roomId = (window as any).Room && (window as any).Room.id;
  if (!engine || !engine.ready || roomId == null) return false;

  const parser = new FloorHeightMapMessageParser();
  parser.flush();
  parser.parseModel(tilemapString, wallHeight, scale);

  const planeParser = new RoomPlaneParser();
  planeParser.initializeTileMap(parser.width, parser.height);

  for (let y = 0; y < parser.height; y++) {
    for (let x = 0; x < parser.width; x++) {
      planeParser.setTileHeight(x, y, parser.getHeight(x, y));
    }
  }

  const doorZ = parser.getHeight(Math.floor(doorX), Math.floor(doorY));
  planeParser.setTileHeight(Math.floor(doorX), Math.floor(doorY), doorZ);
  planeParser.initializeFromTileData(parser.wallHeight);
  planeParser.setTileHeight(Math.floor(doorX), Math.floor(doorY), doorZ + planeParser.wallHeight);

  const roomMap = planeParser.getMapData();
  roomMap.doors.push({ x: doorX, y: doorY, z: doorZ, dir: 90 });

  const roomObject = engine.getRoomObject(roomId, RoomEngine.ROOM_OBJECT_ID, RoomObjectCategory.ROOM);
  planeParser.dispose();
  if (!roomObject) return false;

  roomObject.processUpdateMessage(new ObjectRoomMapUpdateMessage(roomMap));
  engine.refreshTileObjectMap(roomId, 'floor-editor.applyTilemapLive');
  return true;
}

(window as any).__fe_applyTilemapLive = applyTilemapLive;
