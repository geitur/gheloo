import { RoomObjectCategory, Vector3d } from '@nitrots/nitro-renderer';
import { bootRoomEngine } from './bootstrap.ts';
import { addFloorItem, addWallItem, buildRoomMap } from './scene.ts';

// This is the bundle's entry point (esbuild.config.mjs) — there is no visible panel/UI
// here anymore (that was main.ts, removed; Room Clone's thumbnails and the Capture Area/
// Area Mover drag-select highlight are the only consumers of this renderer now, the
// latter via core/eval-hook.js exposing the REAL client's own engine, unrelated to this
// off-screen one). Importing bootstrap.ts below still sets window.__rv_getEngine as a
// side effect, for anything else that wants the shared engine directly.
declare global {
  interface Window {
    __rv_renderThumbnail?: typeof renderBlueprintThumbnail;
  }
}

// Own room id (not ROOM_VIEWER_ROOM_ID, scene.ts's default) so nothing else building a
// room on the shared Nitro Application (one WebGL context per page) can collide with a
// thumbnail render that's mid-flight.
const THUMBNAIL_ROOM_ID = 918274;

interface BlueprintFloorItem {
  typeId: number;
  x: number;
  y: number;
  z: number;
  facing: number;
  state: number;
}

interface BlueprintWallItem {
  typeId: number;
  location: string;
  state?: string;
}

interface BlueprintFloorProps {
  floorPlan: string;
  wallHeight: number;
  hideWalls?: boolean;
  wallThickness?: number;
  floorThickness?: number;
}

export interface RenderableBlueprint {
  floorItems: BlueprintFloorItem[];
  wallItems: BlueprintWallItem[];
  floorProps: BlueprintFloorProps | null;
}

function waitFor<T>(fn: () => T | null | undefined, timeoutMs: number, stepMs: number): Promise<T | null> {
  return new Promise(resolve => {
    const start = Date.now();
    (function tick() {
      const v = fn();
      if (v) { resolve(v); return; }
      if (Date.now() - start >= timeoutMs) { resolve(null); return; }
      setTimeout(tick, stepMs);
    })();
  });
}

// Area captures have no floorProps (captureRoom() in room-clone.js deliberately drops it
// — a partial area has no business reshaping a whole destination room) — so there's no
// real floor plan to render on. Synthesize a flat one sized to fit just the captured
// items, all-'0' tiles so each item's stored z (already relative to its original tile's
// terrain, per captureRoom()'s own comment) reads as an absolute height directly.
function synthesizeFlatFloorPlan(items: BlueprintFloorItem[]): { floorPlan: string; offsetX: number; offsetY: number } {
  const PADDING = 1;
  const xs = items.map(i => i.x);
  const ys = items.map(i => i.y);
  const minX = Math.min(...xs) - PADDING;
  const minY = Math.min(...ys) - PADDING;
  const maxX = Math.max(...xs) + PADDING;
  const maxY = Math.max(...ys) + PADDING;
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const row = '0'.repeat(width);
  const rows: string[] = [];
  for (let i = 0; i < height; i++) rows.push(row);
  return { floorPlan: rows.join('\r'), offsetX: -minX, offsetY: -minY };
}

let fakeIdCounter = -1000;

export interface ThumbnailResult {
  dataUrl: string | null;
  // Furni sprites load their asset bundle on demand (per type, over the network) — these
  // let the caller tell "nothing captured" apart from "captured, but assets never finished
  // loading in time" without needing devtools to see it (see waitForFurniReady below).
  itemsRequested: number;
  itemsResolved: number;
}

function emptyResult(): ThumbnailResult {
  return { dataUrl: null, itemsRequested: 0, itemsResolved: 0 };
}

// getRoomObject(...).visualization only exists once that RoomObject has actually
// initialized its sprites — which for a floor item means its asset bundle (specific to
// that furni type, fetched over the network on first use, NOT part of the mandatory
// room/tile_cursor/etc. preload bootRoomEngine already waits for) has finished loading.
// Without this, a thumbnail for a room with furni types not already cached from earlier
// browsing would render the floor and nothing else — confirmed live.
async function waitForFurniReady(roomEngine: any, roomId: number, ids: number[], timeoutMs: number, stepMs: number): Promise<number> {
  const start = Date.now();
  let resolved = 0;
  do {
    roomEngine.runUpdate();
    resolved = ids.reduce((count, id) => {
      const obj = roomEngine.getRoomObject(roomId, id, RoomObjectCategory.FLOOR);
      return count + (obj && obj.visualization ? 1 : 0);
    }, 0);
    if (resolved === ids.length) break;
    await new Promise(resolve => setTimeout(resolve, stepMs));
  } while (Date.now() - start < timeoutMs);
  return resolved;
}

// size: minimum render dimensions — 200 for the small library-card preview (deliberately
// just a cropped corner, fine for a preview), bigger for the click-to-expand view.
// fitWhole: when true (the expand view), the ACTUAL render request is computed from the
// room's real tile span instead of using `size` directly, so the rendered image contains
// the entire room — cropping there happens in the modal's smaller CSS viewport, not in the
// image data itself, which is what makes drag-to-pan able to reveal anything at all. `size`
// still acts as a floor so a tiny room/area doesn't render smaller than the modal viewport.
export async function renderBlueprintThumbnail(blueprint: RenderableBlueprint, size: number = 200, fitWhole: boolean = false): Promise<ThumbnailResult> {
  if (!blueprint.floorItems.length) return emptyResult();

  const nitro = await bootRoomEngine();
  const roomEngine = nitro.roomEngine as any;

  roomEngine.destroyRoom(THUMBNAIL_ROOM_ID);

  let floorPlan: string;
  let wallHeight = 0;
  let offsetX = 0;
  let offsetY = 0;

  if (blueprint.floorProps) {
    floorPlan = blueprint.floorProps.floorPlan;
    wallHeight = blueprint.floorProps.wallHeight ?? 0;
  } else {
    const synth = synthesizeFlatFloorPlan(blueprint.floorItems);
    floorPlan = synth.floorPlan;
    offsetX = synth.offsetX;
    offsetY = synth.offsetY;
  }

  const roomSize = buildRoomMap(roomEngine, floorPlan, wallHeight, THUMBNAIL_ROOM_ID);

  await waitFor(() => roomEngine.getRoomOwnObject(THUMBNAIL_ROOM_ID)?.logic, 3000, 50);

  roomEngine.updateRoomInstancePlaneType(THUMBNAIL_ROOM_ID, '110', '99999', undefined);
  // Areas render on a synthetic patch, not the real room shape — walls there would be
  // arbitrary and just as likely to obscure the items as frame them, so only the floor
  // shows. Full-room captures respect the room's own hideWalls setting, same as the live
  // client would. Signature is (roomId, wallVisible, floorVisible) — NOT floor-then-wall
  // as originally written here, which is why areas rendered a wall with no floor instead
  // of the intended floor-only: floor was always getting the "wall" argument's value.
  roomEngine.updateRoomInstancePlaneVisibility(THUMBNAIL_ROOM_ID, !!blueprint.floorProps && !blueprint.floorProps.hideWalls, true);
  roomEngine.updateRoomInstancePlaneThickness(THUMBNAIL_ROOM_ID, blueprint.floorProps?.wallThickness ?? 1, blueprint.floorProps?.floorThickness ?? 1);

  const placedIds: number[] = [];
  blueprint.floorItems.forEach(item => {
    const id = fakeIdCounter--;
    placedIds.push(id);
    addFloorItem(roomEngine, {
      id,
      typeId: item.typeId,
      x: item.x + offsetX,
      y: item.y + offsetY,
      z: item.z,
      facing: item.facing,
      extra: NaN,
      expires: -1,
      usagePolicy: 0,
      ownerId: -1,
      ownerName: '',
      stuff: { state: String(item.state) }
    }, THUMBNAIL_ROOM_ID);
  });

  // Wall item location strings are only valid against the real room's own wall geometry
  // (see addWallItem's own comment) — meaningless against a synthetic area floor, and
  // area captures never have any wallItems anyway (captureRoom() drops them for a rect).
  if (blueprint.floorProps) {
    blueprint.wallItems.forEach(item => {
      try {
        addWallItem(roomEngine, { id: fakeIdCounter--, typeId: item.typeId, location: item.location, state: item.state }, THUMBNAIL_ROOM_ID);
      } catch { /* skip a wall item whose location doesn't resolve against this geometry */ }
    });
  }

  // getRoomInstanceDisplay's last arg is tile scale in px — 64 is what main.ts's live
  // Room Viewer panel always uses for its own 600x400 canvas, and that frames real rooms
  // correctly (proven, in daily use). Tried computing a smaller scale to fit a whole room
  // into a 200x200 frame — broke floor/wall plane rendering entirely (furni still appeared,
  // positioned via a generic transform, but the planes render via textures baked per zoom
  // level, and 32/64 are the only two values used anywhere in the real client). Scale stays
  // fixed at that one proven-safe value always; what changes is the requested canvas size.
  const TILE_SCALE = 64;
  let renderWidth = size;
  let renderHeight = size;
  if (fitWhole) {
    // Habbo's 2:1 isometric projection puts a WxH-tile room's footprint at roughly
    // (W+H)*scale/2 px wide and (W+H)*scale/4 px tall — pad width for the margin
    // adjustLocation leaves around the centered room, and pad height more generously since
    // that footprint formula ignores wall/stack height, which extends upward past it.
    // Capped so one absurdly large room can't ask the renderer for a multi-thousand-pixel
    // canvas.
    const spanTiles = roomSize.width + roomSize.height;
    renderWidth = Math.max(size, Math.min(2200, Math.ceil((spanTiles * TILE_SCALE) / 2) + 150));
    renderHeight = Math.max(size, Math.min(1800, Math.ceil((spanTiles * TILE_SCALE) / 4) + 350));
  }
  const display = await waitFor(() => roomEngine.getRoomInstanceDisplay(THUMBNAIL_ROOM_ID, 1, renderWidth, renderHeight, TILE_SCALE), 2000, 50);
  if (!display) {
    roomEngine.destroyRoom(THUMBNAIL_ROOM_ID);
    return { dataUrl: null, itemsRequested: placedIds.length, itemsResolved: 0 };
  }

  const geometry = await waitFor(() => roomEngine.getRoomInstanceGeometry(THUMBNAIL_ROOM_ID, 1), 2000, 50);
  if (geometry) {
    geometry.adjustLocation(new Vector3d(roomSize.width / 2, roomSize.height / 2, 0), 30);
  }

  // Furni asset bundles are fetched on demand, per type, over the network — give them real
  // time to land instead of a fixed handful of milliseconds (see waitForFurniReady above).
  const itemsResolved = await waitForFurniReady(roomEngine, THUMBNAIL_ROOM_ID, placedIds, 4000, 100);

  // A couple more ticks after that — a RoomObject having a `visualization` doesn't
  // guarantee a frame has actually been rendered with it yet.
  for (let i = 0; i < 3; i++) {
    roomEngine.runUpdate();
    await new Promise(resolve => setTimeout(resolve, 16));
  }

  const app = nitro.application as any;
  const dataUrl: string = app.renderer.plugins.extract.base64(display, 'image/png');

  roomEngine.destroyRoom(THUMBNAIL_ROOM_ID);

  return { dataUrl, itemsRequested: placedIds.length, itemsResolved };
}

window.__rv_renderThumbnail = renderBlueprintThumbnail;
