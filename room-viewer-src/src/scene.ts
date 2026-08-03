import {
  FloorHeightMapMessageParser,
  IRoomCreator,
  IRoomEngine,
  LegacyDataType,
  RoomPlaneParser,
  Vector3d
} from '@nitrots/nitro-renderer';
import { parseWallLocation } from './wallLocation.ts';

export const ROOM_VIEWER_ROOM_ID = 918273; // arbitrary, distinct from any real roomId

interface FloorItem {
  id: number;
  typeId: number;
  x: number;
  y: number;
  z: number;
  facing: number;
  extra: number;
  expires: number;
  usagePolicy: number;
  ownerId: number;
  ownerName: string;
  stuff?: { state?: string };
}

interface WallItem {
  id: number;
  typeId: number;
  location: string;
  state?: string;
}

export interface RoomMapSize {
  width: number;
  height: number;
}

export function buildRoomMap(
  roomEngine: IRoomEngine,
  floorPlan: string,
  wallHeight: number,
  roomId: number = ROOM_VIEWER_ROOM_ID
): RoomMapSize {
  const fhm = new FloorHeightMapMessageParser();
  fhm.parseModel(floorPlan, wallHeight, false);

  const planeParser = new RoomPlaneParser();
  planeParser.initializeTileMap(fhm.width, fhm.height);

  // Ported from RoomMessageHandler.onRoomModelEvent (the real handler for this exact same
  // packet) — a door-detection scan we were completely skipping. It walks every tile
  // looking for the "blocked on exactly 3 of the 4 sides" pattern that marks a room's
  // entrance, then records that tile's position/direction as roomMap.doors[0]. We have no
  // equivalent of the real client's separate RoomEntryTile packet telling us the *known*
  // entry tile, so this always takes the "search for it" fallback path the real code also
  // falls back to when that packet hasn't arrived yet (entryTile == null there).
  let doorX = -1;
  let doorY = -1;
  let doorZ = 0;
  let doorDirection = 0;

  for (let y = 0; y < fhm.height; y++) {
    for (let x = 0; x < fhm.width; x++) {
      const tileHeight = fhm.getHeight(x, y);

      if (
        (((y > 0 && y < fhm.height - 1) || (x > 0 && x < fhm.width - 1)) && tileHeight !== RoomPlaneParser.TILE_BLOCKED)
      ) {
        if (
          fhm.getHeight(x, y - 1) === RoomPlaneParser.TILE_BLOCKED &&
          fhm.getHeight(x - 1, y) === RoomPlaneParser.TILE_BLOCKED &&
          fhm.getHeight(x, y + 1) === RoomPlaneParser.TILE_BLOCKED
        ) {
          doorX = x + 0.5;
          doorY = y;
          doorZ = tileHeight;
          doorDirection = 90;
        }

        if (
          fhm.getHeight(x, y - 1) === RoomPlaneParser.TILE_BLOCKED &&
          fhm.getHeight(x - 1, y) === RoomPlaneParser.TILE_BLOCKED &&
          fhm.getHeight(x + 1, y) === RoomPlaneParser.TILE_BLOCKED
        ) {
          doorX = x;
          doorY = y + 0.5;
          doorZ = tileHeight;
          doorDirection = 180;
        }
      }

      planeParser.setTileHeight(x, y, tileHeight);
    }
  }

  planeParser.setTileHeight(Math.floor(doorX), Math.floor(doorY), doorZ);
  planeParser.initializeFromTileData(fhm.wallHeight);
  planeParser.setTileHeight(Math.floor(doorX), Math.floor(doorY), doorZ + planeParser.wallHeight);

  const roomMap = planeParser.getMapData();
  // NOT pushed into roomMap.doors: the library's own door-processing code (RoomEngine.
  // setupRoomInstance, right after object creation) calls logic.processUpdateMessage(...)
  // for each door with no null check on `logic` — and it crashed with exactly that null
  // dereference on a real test. That's strong evidence roomObject.logic isn't populated
  // synchronously within createRoomInstance, which would also mean the plane type/visibility
  // calls below (both gated behind `if(logic)` inside the library, so they fail silently
  // instead of crashing) have likely been silently no-op-ing this whole time. See
  // waitForRoomLogic() in main.ts, called before those.

  roomEngine.createRoomInstance(roomId, roomMap);

  // Wall furni location (getLocation() in addWallItem below) is computed against a SEPARATE
  // height-map structure — LegacyWallGeometry, reached via getLegacyWallGeometry — not against
  // planeParser/roomMap. The real client's RoomMessageHandler.onRoomModelEvent populates it
  // right after building the room instance (scale=DEFAULT_SCALE(32), initialize(width,height,
  // floorHeight), then setHeight per tile from the same finished planeParser data we already
  // built above). We were never doing this at all, so every wall item's location was computed
  // against a permanently-empty default (width=0, height=0, scale=64) instead — silently wrong
  // for every room, not a crash, which is exactly why it looked like a location-math bug rather
  // than a "some state was never initialized" bug. Mirror the real client's step exactly.
  const wallGeometry = (roomEngine as unknown as IRoomCreator).getLegacyWallGeometry(roomId);
  if (wallGeometry) {
    wallGeometry.scale = 32; // LegacyWallGeometry.DEFAULT_SCALE
    wallGeometry.initialize(fhm.width, fhm.height, planeParser.floorHeight);
    for (let y = fhm.height - 1; y >= 0; y--) {
      for (let x = fhm.width - 1; x >= 0; x--) {
        wallGeometry.setHeight(x, y, planeParser.getTileHeight(x, y));
      }
    }
  }

  const size = { width: fhm.width, height: fhm.height };
  planeParser.dispose();
  return size;
}

export function addFloorItem(roomEngine: IRoomEngine, item: FloorItem, roomId: number = ROOM_VIEWER_ROOM_ID): void {
  const objectData = new LegacyDataType();
  if (item.stuff && item.stuff.state) objectData.setString(item.stuff.state);

  // objectData.state (IObjectData's own getter) is parseInt(objectData.getLegacyString()),
  // i.e. derived from the exact same state string set above — but the numeric `state`
  // argument below is what the room engine actually uses to pick a multi-state furni's
  // visual (on/off, etc.); passing objectData alone without also passing this was
  // confirmed live to leave state changes invisible even though the underlying data
  // (and a full scene rebuild) was correct.
  roomEngine.addFurnitureFloor(
    roomId,
    item.id,
    item.typeId,
    new Vector3d(item.x, item.y, item.z),
    new Vector3d(item.facing * 45, item.facing * 45, item.facing * 45),
    objectData.state,
    objectData,
    item.extra ?? NaN,
    item.expires ?? -1,
    item.usagePolicy ?? 0,
    item.ownerId ?? -1,
    item.ownerName ?? '',
    true,
    true
  );
}

export function addWallItem(roomEngine: IRoomEngine, item: WallItem, roomId: number = ROOM_VIEWER_ROOM_ID): void {
  const parsed = parseWallLocation(item.location);

  // Mirrors RoomMessageHandler's own internal addRoomObjectFurnitureWall: the wall
  // location string doesn't decode into a Vector3d by itself — it has to go through the
  // room's own LegacyWallGeometry (built from the tile map by buildRoomMap/createRoomInstance),
  // the same way the library handles a real incoming wall-furniture packet.
  const wallGeometry = (roomEngine as unknown as IRoomCreator).getLegacyWallGeometry(roomId);

  if (!wallGeometry) {
    throw new Error('no wall geometry for room — buildRoomMap must run before addWallItem');
  }

  const location = wallGeometry.getLocation(parsed.width, parsed.height, parsed.localX, parsed.localY, parsed.direction);
  const direction = new Vector3d(wallGeometry.getDirection(parsed.direction));

  roomEngine.addFurnitureWall(
    roomId,
    item.id,
    item.typeId,
    location,
    direction,
    0,
    item.state ?? '',
    -1,
    0,
    -1,
    '',
    true
  );
}

export function removeFloorItem(roomEngine: IRoomEngine, id: number, roomId: number = ROOM_VIEWER_ROOM_ID): void {
  roomEngine.removeRoomObjectFloor(roomId, id);
}

export function removeWallItem(roomEngine: IRoomEngine, id: number, roomId: number = ROOM_VIEWER_ROOM_ID): void {
  roomEngine.removeRoomObjectWall(roomId, id);
}
