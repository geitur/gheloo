import type { Application } from '@pixi/app';
import { Point } from '@pixi/math';
import { Vector3d } from '@nitrots/nitro-renderer';
import { bootRoomEngine } from './bootstrap.ts';
import { addFloorItem, addWallItem, buildRoomMap, ROOM_VIEWER_ROOM_ID } from './scene.ts';

declare global {
  interface Window {
    Room: {
      id: number | null;
      floorPlan: string | null;
      wallHeight: number | null;
      floorType: string | null;
      wallType: string | null;
      landscapeType: string | null;
      wallThickness: number | null;
      floorThickness: number | null;
      floorItems: Record<string, any>;
      wallItems: Record<string, any>;
    };
    __ghk_makeDraggable: (el: HTMLElement, handle: HTMLElement, storageKey: string, shouldSkip: (e: MouseEvent) => boolean) => void;
    __ghk_bringToFront?: (el: HTMLElement) => void;
    __ghk_ready: (fn: () => void) => void;
    onPacket: (name: string, cb: (p: any) => void) => void;
    __rv_open?: () => void;
  }
}

function init(): void {
  if (document.getElementById('__rv_panel')) return;

  const style = document.createElement('style');
  style.textContent = [
    '#__rv_panel{position:fixed;top:16px;right:16px;width:632px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
    '#__rv_panel *{box-sizing:border-box}',
    '.__rv_card_wrap{display:flex;flex-direction:column;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb}',
    '.__rv_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
    '.__rv_title{font:600 13px system-ui;color:#eceefb;flex:1}',
    '.__rv_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
    '.__rv_close:hover{color:#eceefb}',
    '#__rv_body{padding:8px;display:flex;flex-direction:column;gap:8px}',
    '#__rv_canvas_wrap{display:flex;justify-content:center;background:#0A0B10;border-radius:8px;padding:4px;min-height:408px}',
    '#__rv_status{font:600 11px monospace;color:#eceefb;padding:0 4px}',
    '#__rv_status.warn{color:#f1c40f}',
    '#__rv_status.err{color:#e74c3c}',
  ].join('');
  document.head.appendChild(style);

  const p = document.createElement('div');
  p.id = '__rv_panel';
  p.innerHTML =
    '<div class="__rv_card_wrap">' +
      '<div class="__rv_hdr" id="__rv_hdr">' +
        '<span class="__rv_title">Room Viewer</span>' +
        '<span class="__rv_close" id="__rv_close">&times;</span>' +
      '</div>' +
      '<div id="__rv_body">' +
        '<div id="__rv_canvas_wrap"></div>' +
        '<div id="__rv_status">not started</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(p);
  p.style.display = 'none';

  window.__ghk_makeDraggable(p, document.getElementById('__rv_hdr') as HTMLElement, '__ghk_rv_pos', e => (e.target as HTMLElement).id === '__rv_close');
  document.getElementById('__rv_close')!.addEventListener('click', () => { p.style.display = 'none'; });

  const statusEl = document.getElementById('__rv_status')!;

  function setStatus(msg: string, level?: 'warn' | 'err'): void {
    statusEl.textContent = msg;
    statusEl.className = level ? level : '';
    if (level === 'err') console.error('[RoomViewer]', msg);
    else if (level === 'warn') console.warn('[RoomViewer]', msg);
  }

  let rendered = false;
  let currentApp: Application | null = null;
  let tickerRegistered = false;
  let dragBound = false;
  // roomEngine is re-fetched (from the memoized bootRoomEngine() promise, so it's the same
  // singleton every time) on every rebuild — the drag handlers below are bound to the canvas
  // element ONCE, so they need a live reference to the current one, not whichever existed
  // when they were bound.
  let activeRoomEngine: any = null;

  async function waitFor<T>(fn: () => T | null | undefined, timeoutMs: number, stepMs: number): Promise<{ value: T | null; ms: number; attempts: number }> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const v = fn();
      if (v) return { value: v, ms: Date.now() - start, attempts: 0 };
      await new Promise(r => setTimeout(r, stepMs));
    }
    return { value: null, ms: Date.now() - start, attempts: 0 };
  }

  // Room entry fires a burst of packets that all schedule a rebuild independently: our own
  // instant FloorHeightMap listener, plus the debounced scheduleRebuild() still wired to
  // RoomProperty/ObjectAdd/etc (which also fire during entry, not just mid-visit changes).
  // Without a guard, two renderCurrentRoom() calls run concurrently, each doing its own
  // full engine rebuild. A generation token lets a superseded call detect it's stale (after
  // its next await) and bail immediately instead of continuing to do redundant work.
  let renderGeneration = 0;

  async function renderCurrentRoom(): Promise<void> {
    const myGeneration = ++renderGeneration;
    setStatus('booting engine...');
    const nitro = await bootRoomEngine();
    const roomEngine = nitro.roomEngine;

    if (!window.Room.floorPlan) {
      setStatus('no floorPlan yet — walk into a room first, then reopen this panel', 'warn');
      return;
    }

    // floorType/wallType/landscapeType each come from their OWN separate RoomProperty packet
    // (type='floor'/'wallpaper'/'landscape') — the server only sends one when that room
    // actually overrides the default for it. A room using the plain default floor/wallpaper
    // never gets a RoomProperty for that property at all, permanently. Proceed immediately
    // with whatever's currently known (nullish defaults applied below); scheduleRebuild() is
    // already subscribed to RoomProperty separately, so if one does arrive later it still
    // triggers a corrective re-render on its own.

    if (myGeneration !== renderGeneration) return;

    // Tear down whatever we built for the previous room before rebuilding — createRoomInstance
    // on an id that's already in use would otherwise pile up duplicate objects rather than
    // replacing them.
    (roomEngine as any).destroyRoom(ROOM_VIEWER_ROOM_ID);

    setStatus('building room map...');
    const roomSize = buildRoomMap(roomEngine, window.Room.floorPlan, window.Room.wallHeight ?? 0);

    // RoomEngine.setupRoomInstance captures `roomObject.logic` into a local right after
    // creating the room object, and every plane type/visibility update it does in that same
    // call is silently skipped if that's null — wait for it to actually attach first.
    await waitFor(() => (roomEngine as any).getRoomOwnObject(ROOM_VIEWER_ROOM_ID)?.logic, 3000, 50);

    if (myGeneration !== renderGeneration) return;

    roomEngine.updateRoomInstancePlaneType(
      ROOM_VIEWER_ROOM_ID,
      window.Room.floorType ?? '110',
      window.Room.wallType ?? '99999',
      window.Room.landscapeType ?? undefined
    );
    roomEngine.updateRoomInstancePlaneVisibility(ROOM_VIEWER_ROOM_ID, true, true);
    // The real client's RoomMessageHandler.onRoomThicknessEvent calls this right alongside
    // updateRoomInstancePlaneVisibility, every single time. Uses the room's actual
    // RoomVisualizationSettings values (parsers.js already parses these) rather than a
    // hardcoded default — hardcoding shifts the wall surface's depth away from wherever the
    // real room actually has it, which throws off wall furni placement (they sit at a
    // location computed relative to that surface).
    roomEngine.updateRoomInstancePlaneThickness(ROOM_VIEWER_ROOM_ID, window.Room.wallThickness ?? 1, window.Room.floorThickness ?? 1);

    const floorItems = Object.values(window.Room.floorItems);
    const wallItems = Object.values(window.Room.wallItems);

    let wallFailures = 0;
    for (const item of floorItems) addFloorItem(roomEngine, item as any);
    for (const item of wallItems) {
      try {
        addWallItem(roomEngine, item as any);
      } catch {
        wallFailures++;
      }
    }

    const canvasWrap = document.getElementById('__rv_canvas_wrap')!;
    canvasWrap.innerHTML = '';

    // getRoomInstanceDisplay/getRoomInstanceGeometry returning null immediately after
    // createRoomInstance/addFurniture* was intermittent in practice — the room engine
    // appears to finish building its internal geometry a tick later, not synchronously
    // within those calls. Poll briefly instead of trusting one read.
    const displayResult = await waitFor(() => roomEngine.getRoomInstanceDisplay(ROOM_VIEWER_ROOM_ID, 1, 600, 400, 64), 2000, 50);
    const display = displayResult.value;

    // Without this, the camera defaults to a position that doesn't necessarily frame the
    // room's floor/wall geometry at all, matching what RoomPreviewer itself does
    // (getRoomInstanceGeometry().adjustLocation(...)) right after building its display.
    const geometryResult = await waitFor(() => roomEngine.getRoomInstanceGeometry(ROOM_VIEWER_ROOM_ID, 1), 2000, 50);
    const geometry = geometryResult.value;
    if (geometry) {
      geometry.adjustLocation(new Vector3d(roomSize.width / 2, roomSize.height / 2, 0), 30);
    }

    // Every plane's texture is baked via TextureUtils.generateTexture() ->
    // PixiApplicationProxy.instance.renderer.generateTexture(...) — i.e. rendered into a
    // RenderTexture using Nitro's OWN internal Application (constructed in Nitro.bootstrap(),
    // with its own detached <canvas> that's never attached to any DOM). A RenderTexture baked
    // on one WebGL context is not valid GPU state on a different one, so a separately-created
    // Application for the visible panel would silently fail to draw plane textures. Reuse
    // Nitro's own Application (nitro.application, the same object PixiApplicationProxy.
    // instance points to) so everything's baked and drawn on the same context. Its <canvas>
    // was never attached to the DOM anywhere, so it's ours to place and size freely.
    currentApp = nitro.application;
    const canvas = currentApp.view as HTMLCanvasElement;
    canvasWrap.appendChild(canvas);
    currentApp.renderer.resize(600, 400);
    canvas.style.width = '600px';
    canvas.style.height = '400px';

    currentApp.stage.removeChildren();
    activeRoomEngine = roomEngine;
    if (display) {
      currentApp.stage.addChild(display as any);
    }

    // New room render: reset any pan from a previous room back to centered, matching how the
    // camera itself already gets re-centered above via geometry.adjustLocation().
    roomEngine.setRoomInstanceRenderingCanvasOffset(ROOM_VIEWER_ROOM_ID, 1, new Point(0, 0));

    // Click-and-drag panning, via the engine's own pan primitive —
    // roomEngine.setRoomInstanceRenderingCanvasOffset(), the same screenOffsetX/screenOffsetY
    // that RoomSpriteCanvas's per-sprite visibility culling and position math read internally.
    // (Moving the PIXI display object directly doesn't work: the culling is evaluated against
    // the room's own camera position, unaware of an external transform, so sprites already
    // off-screen at the room's initial framing would never become visible no matter how far
    // you drag.)
    if (!dragBound) {
      dragBound = true;
      let dragging = false;
      let lastX = 0;
      let lastY = 0;
      canvas.style.cursor = 'grab';
      canvas.addEventListener('mousedown', (e) => {
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        canvas.style.cursor = 'grabbing';
        e.preventDefault();
      });
      window.addEventListener('mousemove', (e) => {
        if (!dragging || !activeRoomEngine) return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        const current = activeRoomEngine.getRoomInstanceRenderingCanvasOffset(ROOM_VIEWER_ROOM_ID, 1);
        activeRoomEngine.setRoomInstanceRenderingCanvasOffset(ROOM_VIEWER_ROOM_ID, 1, new Point((current?.x ?? 0) + dx, (current?.y ?? 0) + dy));
      });
      window.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        canvas.style.cursor = 'grab';
      });
    }

    // currentApp is shared/global now (Nitro's own Application, persists across room rebuilds
    // and any other extension that also calls bootRoomEngine()) — so the ticker callback must
    // only ever be registered once, not once per render, or repeated panel opens/room switches
    // would stack duplicate runUpdate() listeners forever.
    if (!tickerRegistered) {
      tickerRegistered = true;
      currentApp.ticker.add(() => { (roomEngine as any).runUpdate(); });
    }

    setStatus(
      `rendered ${floorItems.length} floor item(s), ${wallItems.length - wallFailures}/${wallItems.length} wall item(s)` +
      (wallFailures ? ` (${wallFailures} wall item location(s) failed to parse)` : '') +
      (!display ? ' — WARNING: room display never became ready, nothing will render' : '') +
      (!geometry ? ' — WARNING: room geometry never became ready, camera not centered' : ''),
      (!display || !geometry) ? 'warn' : undefined
    );
  }

  let currentRoomId: number | null = null;

  window.__rv_open = function (): void {
    p.style.display = '';
    if (window.__ghk_bringToFront) window.__ghk_bringToFront(p);

    if (!rendered) {
      rendered = true;
      currentRoomId = window.Room.id;
      renderCurrentRoom().catch(err => setStatus('FAILED: ' + (err && err.stack ? err.stack : String(err)), 'err'));
    }
  };

  // Full rebuild on room change rather than diffing individual furni add/remove — simpler,
  // and cheap enough for this size of scene. Reacts directly to FloorHeightMap — the packet
  // that supplies floorPlan itself — so rendering starts the moment the new room's data
  // actually lands rather than on a poll tick.
  window.onPacket('FloorHeightMap', () => {
    if (p.style.display === 'none' || !rendered) return;
    if (window.Room.id === currentRoomId) return;

    currentRoomId = window.Room.id;
    renderCurrentRoom().catch(err => setStatus('FAILED: ' + (err && err.stack ? err.stack : String(err)), 'err'));
  });

  // Rotating, moving, or toggling the state of an existing floor item doesn't change
  // window.Room.id, so the listener above misses it — parsers.js updates
  // window.Room.floorItems in place for these (ObjectUpdate: move/rotate, ObjectDataUpdate:
  // state), and a new ObjectAdd means a fresh item to render too. Debounced since these can
  // arrive in a burst (e.g. several items updating at once) and a full rebuild per event
  // would be wasteful.
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleRebuild(): void {
    if (p.style.display === 'none' || !rendered) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      renderCurrentRoom().catch(err => setStatus('FAILED: ' + (err && err.stack ? err.stack : String(err)), 'err'));
    }, 300);
  }
  window.onPacket('ObjectAdd', scheduleRebuild);
  window.onPacket('ObjectUpdate', scheduleRebuild);
  window.onPacket('ObjectDataUpdate', scheduleRebuild);
  window.onPacket('ObjectsDataUpdate', scheduleRebuild);
  window.onPacket('SlideObjectBundle', scheduleRebuild);
  window.onPacket('ObjectRemove', scheduleRebuild);
  window.onPacket('RoomProperty', scheduleRebuild);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () {
    window.__ghk_ready(init);
  });
} else {
  window.__ghk_ready(init);
}
