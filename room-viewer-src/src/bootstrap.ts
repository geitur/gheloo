import { ConfigurationEvent, GetAssetManager, Nitro, NitroConfiguration, RoomEngineEvent } from '@nitrots/nitro-renderer';

declare global {
  interface Window {
    NitroConfig: Record<string, unknown>;
    // Shared hook: any other extension that also wants the rendering engine calls this
    // instead of shipping/booting its own — bootRoomEngine() below memoizes its promise,
    // so every caller (Room Viewer's own panel included) gets back the exact same booted
    // instance rather than a fresh boot each time.
    __rv_getEngine?: () => Promise<typeof Nitro.instance>;
  }
}

let bootPromise: Promise<typeof Nitro.instance> | null = null;

type NitroInstanceType = typeof Nitro.instance;

// getCollection() is a passive cache check — no side effect, doesn't trigger a load itself —
// so polling it is safe. 'room' is the one that actually matters for the plane visualization/
// logic to attach; place_holder/tile_cursor/etc are part of the same MANDATORY_LIBRARIES
// batch and load in parallel, so by the time 'room' lands the others reliably already have.
//
// This wait is required, not defensive: LOADER_READY (what triggers RoomManager.onInit(),
// which is what *starts* downloading place_holder/room/tile_cursor/etc) only means furniture
// *data* finished processing — onInit() never awaits those downloads, they're fire-and-forget.
// ENGINE_INITIALIZED can fire while "room" is still mid-download, which was causing
// createRoomObjectAndInitalize to return null: it does one synchronous asset lookup with no
// retry, so losing that race meant the room object never got created, permanently, for that
// render. Polling the actual collection instead of trusting ENGINE_INITIALIZED fixes it.
function waitForRoomLibrary(roomEngine: NitroInstanceType['roomEngine']): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function tick() {
      if (roomEngine.roomContentLoader.getCollection('room')) { resolve(); return; }
      if (Date.now() - start > 8000) { reject(new Error('[RoomViewer] "room" asset library never finished loading after 8s')); return; }
      setTimeout(tick, 50);
    })();
  });
}

export function bootRoomEngine(): Promise<typeof Nitro.instance> {
  if (bootPromise) return bootPromise;

  bootPromise = new Promise((resolve, reject) => {
    // socket.url set to '' here wins over the fetched renderer-config.json's real value —
    // NitroConfiguration only lets a later fetch override a key if that fetch call passes
    // overrides=true, and the library's own config-loading path never does. This keeps us
    // from ever opening a real socket to leet's proxy — we only want the renderer.
    //
    // furnidata.url isn't part of renderer-config.json itself — leet's own page bootstrap
    // sets it directly alongside config.urls, so we supply it here the same way. Without
    // it, SessionDataManager never loads furniture data, RoomContentLoader's LOADER_READY
    // never fires, and roomEngine.ready never becomes true (verified live: this silently
    // hangs forever, no error, until the 20s timeout below).
    window.NitroConfig = {
      'socket.url': '',
      'config.urls': [
        'https://images.leet.city/leet-asset-bundles/config/renderer-config.json'
      ],
      'furnidata.url': 'https://images.leet.city/leet-asset-bundles/gamedata/leet_furni.json'
    };

    Nitro.bootstrap();
    const nitro = Nitro.instance;

    const configTimeout = setTimeout(() => reject(new Error('[RoomViewer] config load timed out after 15s')), 15000);

    nitro.core.configuration.events.addEventListener(ConfigurationEvent.LOADED, async () => {
      clearTimeout(configTimeout);

      try {
        // The real client (nitro-react's App.tsx) explicitly downloads a list of preload
        // asset bundles — config key 'preload.assets.urls' — via
        // GetAssetManager().downloadAssets(...) between config-loaded and
        // communication.init(). Without this, RoomContentLoader.getCollection('room') has
        // nothing to return later — the 'room' asset bundle itself never gets fetched.
        // roomEngine.ready still flips true regardless (it only tracks a smaller mandatory
        // set), which is why this was easy to miss.
        const assetUrls = NitroConfiguration.getValue<string[]>('preload.assets.urls') || [];
        const interpolated = assetUrls.map(url => NitroConfiguration.interpolate(url));
        await GetAssetManager().downloadAssets(interpolated);

        nitro.communication.init();
        nitro.init();
      } catch (err) {
        reject(err);
        return;
      }

      const roomEngine = nitro.roomEngine;

      if (roomEngine.ready) {
        waitForRoomLibrary(roomEngine).then(() => resolve(nitro), reject);
        return;
      }

      const engineTimeout = setTimeout(() => reject(new Error('[RoomViewer] roomEngine.ready timed out after 20s')), 20000);

      roomEngine.events.addEventListener(RoomEngineEvent.ENGINE_INITIALIZED, () => {
        clearTimeout(engineTimeout);
        waitForRoomLibrary(roomEngine).then(() => resolve(nitro), reject);
      });
    });

    nitro.core.configuration.init();
  });

  return bootPromise;
}

// Set as soon as this bundle executes — before the panel's own init() even runs — so any
// other extension can grab the engine without needing Room Viewer's panel opened at all.
window.__rv_getEngine = bootRoomEngine;
