// extensions/room-viewer/src/spike/bootstrap.ts
import { Application } from '@pixi/app';
import {
  ConfigurationEvent,
  FloorHeightMapMessageParser,
  LegacyDataType,
  Nitro,
  RoomEngineEvent,
  RoomPlaneParser,
  Vector3d
} from '@nitrots/nitro-renderer';

declare global {
  interface Window {
    NitroConfig: Record<string, unknown>;
    __rv_open?: () => void;
  }
}

function init(): void {
  if (document.getElementById('__rv_spike_panel')) return;

  const style = document.createElement('style');
  style.textContent = [
    '#__rv_spike_panel{position:fixed;top:16px;right:16px;width:632px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
    '#__rv_spike_panel *{box-sizing:border-box}',
    '.__rv_card_wrap{display:flex;flex-direction:column;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb}',
    '.__rv_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
    '.__rv_title{font:600 13px system-ui;color:#eceefb;flex:1}',
    '.__rv_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
    '.__rv_close:hover{color:#eceefb}',
    '#__rv_body{padding:10px 12px;display:flex;flex-direction:column;gap:8px}',
    '#__rv_canvas_wrap{display:flex;justify-content:center;background:#0A0B10;border-radius:8px;padding:4px}',
    '#__rv_log{background:#0A0B10;color:#eceefb;font:11px monospace;padding:8px 10px;border-radius:8px;max-height:200px;overflow-y:auto;white-space:pre-wrap}',
  ].join('');
  document.head.appendChild(style);

  const p = document.createElement('div');
  p.id = '__rv_spike_panel';
  p.innerHTML =
    '<div class="__rv_card_wrap">' +
      '<div class="__rv_hdr" id="__rv_spike_hdr">' +
        '<span class="__rv_title">Room Viewer (spike)</span>' +
        '<span class="__rv_close" id="__rv_spike_close">&times;</span>' +
      '</div>' +
      '<div id="__rv_body">' +
        '<div id="__rv_canvas_wrap"></div>' +
        '<div id="__rv_log"></div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(p);
  p.style.display = 'none';

  (window as any).__ghk_makeDraggable(p, document.getElementById('__rv_spike_hdr'), '__ghk_rv_spike_pos', (e: MouseEvent) => (e.target as HTMLElement).id === '__rv_spike_close');
  document.getElementById('__rv_spike_close')!.addEventListener('click', () => { p.style.display = 'none'; });

  const logEl = document.getElementById('__rv_log')!;
  function log(msg: string): void {
    console.log('[RoomViewer spike]', msg);
    const line = document.createElement('div');
    line.textContent = msg;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  let started = false;

  async function runSpike(): Promise<void> {
    // socket.url set to '' here wins over the fetched renderer-config.json's real value —
    // NitroConfiguration only lets a later fetch override a key if that fetch call passes
    // overrides=true, and the library's own config-loading path never does. This keeps us
    // from ever opening a real socket to leet's proxy.
    window.NitroConfig = {
      'socket.url': '',
      'config.urls': [
        'https://images.leet.city/leet-asset-bundles/config/renderer-config.json'
      ],
      // Not part of renderer-config.json itself — leet's own page bootstrap sets this
      // directly, so SessionDataManager (which loads furniture data RoomContentLoader
      // needs before roomEngine.ready ever becomes true) has to get it from here instead.
      'furnidata.url': 'https://images.leet.city/leet-asset-bundles/gamedata/leet_furni.json'
    };

    log('calling Nitro.bootstrap()');
    Nitro.bootstrap();
    const nitro = Nitro.instance;
    log('Nitro.instance created, waiting for config to load...');

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('config load timed out after 15s')), 15000);

      nitro.core.configuration.events.addEventListener(ConfigurationEvent.LOADED, () => {
        clearTimeout(timeout);
        log('config loaded (NC_LOADED fired)');
        resolve();
      });

      nitro.core.configuration.init();
    });

    log('calling communication.init()');
    nitro.communication.init();
    log('calling nitro.init()');
    nitro.init();
    log('nitro.init() done, waiting for roomEngine.ready (mandatory asset libraries loading)...');

    const roomEngine = nitro.roomEngine;

    if (!roomEngine.ready) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('roomEngine.ready timed out after 20s')), 20000);

        roomEngine.events.addEventListener(RoomEngineEvent.ENGINE_INITIALIZED, () => {
          clearTimeout(timeout);
          log('roomEngine.ready is now true (ENGINE_INITIALIZED fired)');
          resolve();
        });
      });
    } else {
      log('roomEngine.ready was already true');
    }

    log('building room map');
    const roomId = 12345;

    const fhm = new FloorHeightMapMessageParser();
    fhm.parseModel('33333333\n30000003\n30000003\n30000003\n33333333', 0, false);

    const planeParser = new RoomPlaneParser();
    planeParser.initializeTileMap(fhm.width, fhm.height);

    for (let y = 0; y < fhm.height; y++) {
      for (let x = 0; x < fhm.width; x++) {
        planeParser.setTileHeight(x, y, fhm.getHeight(x, y));
      }
    }

    planeParser.initializeFromTileData(fhm.wallHeight);
    roomEngine.createRoomInstance(roomId, planeParser.getMapData());
    roomEngine.updateRoomInstancePlaneType(roomId, '110', '99999');
    log('room instance created, adding test furniture');

    // A hardcoded real furni typeId your account owns — swap this for one you can see
    // in-room right now, so success/failure is visually obvious.
    const testTypeId = 886607278; // REPLACE with a real typeId before running
    const added = roomEngine.addFurnitureFloor(
      roomId, 1, testTypeId,
      new Vector3d(2, 2, 0), new Vector3d(0, 0, 0),
      0, new LegacyDataType(), NaN, -1, 0, -1, '', true, true
    );
    log('addFurnitureFloor returned: ' + added);

    const display = roomEngine.getRoomInstanceDisplay(roomId, 1, 600, 400, 64);
    log('getRoomInstanceDisplay returned: ' + (display ? 'a display object' : 'null/undefined'));

    const canvasWrap = document.getElementById('__rv_canvas_wrap')!;
    const canvas = document.createElement('canvas');
    canvasWrap.appendChild(canvas);

    const app = new Application({ view: canvas, width: 600, height: 400 });
    if (display) app.stage.addChild(display as any);

    log('done — canvas above should show a small floor with one furni on it');
  }

  window.__rv_open = function (): void {
    p.style.display = '';
    if ((window as any).__ghk_bringToFront) (window as any).__ghk_bringToFront(p);

    if (!started) {
      started = true;
      log('panel opened, starting spike...');
      runSpike().catch(err => log('FAILED: ' + (err && err.stack ? err.stack : String(err))));
    }
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () {
    (window as any).__ghk_ready(init);
  });
} else {
  (window as any).__ghk_ready(init);
}
