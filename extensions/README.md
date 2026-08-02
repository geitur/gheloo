# Extensions

Two unrelated things share the name "extension" in this repo:

1. **The in-game Extensions panel** — paste raw JS into a textbox inside the hotel
   client, no file, no rebuild, stored in `localStorage`. Covered in
   [In-game Extensions panel](#in-game-extensions-panel) below.
2. **This `extensions/` folder** — full `.js` tools with their own panel (Furni Hider,
   Room Clone, Area Mover, Room History, Marktplaats Alerts, etc.), wired into
   `manifest.json` + `content.js`. Covered in
   [Building a new tool](#building-a-new-tool) below.

There's no auto-registering tile hub for folder tools. A file here only gets an entry
point once you wire a row for it into the main Gheloo hub in `content.js`.

---

## In-game Extensions panel

The Extensions panel (`extensions/userext/manager.js`) lets a *user* add their own
JavaScript that runs inside the hotel client alongside the built-in tools (Macros, Mimic,
etc.), no repo changes needed. Extensions are stored in the browser's `localStorage` and
load automatically on every page refresh.

### How to open the panel

1. Click the **Hub** icon in the toolbar
2. Click **Extensions**
3. Click **+ Add** to create your first extension

Give it a name and paste your JavaScript code. Click **Save**. The extension will run
next time you refresh the page.

You can toggle extensions ON/OFF without deleting them, or edit the code at any time.

### Available APIs

Your extension code runs with full access to these globals:

#### Packet sending

```js
// Send an outgoing packet by name
window.sendPacket('OUT', packetId, '{s:"hello"}{i:0}');

// Look up a packet ID by short name
const id = Object.entries(window.PKT.OUT)
  .find(([,v]) => window.shortName(v, 'OUT') === 'Chat')?.[0];
```

#### Packet listening

```js
// Listen for a specific packet by short name
window.onPacket('Chat', function(p) {
  // p.name     — short packet name
  // p.direction — 'IN' or 'OUT'
  // p.raw      — ArrayBuffer of raw packet bytes
  // p.parsed   — parsed data (if available)
  console.log('Chat packet:', p);
});

// Subscribe to ALL packets
window.PacketStore.subscribe(function(p) {
  if (p.direction === 'OUT' && p.name === 'Chat') {
    console.log('You said something');
  }
});
```

#### Room and player info

```js
window._selfName          // your username (string)
window.Room               // current room object
window.Room.id            // room id
window.Room.users         // object of users in the room { userId: { id, name, figure, type, ... } }
```

#### Packet reader

```js
// Read values from a raw packet buffer
const r = window.makeReader(p.raw);
if (r) {
  const str  = r.str();   // read a string
  const num  = r.int();   // read an integer
  const bool = r.bool();  // read a boolean
}
```

#### Block an incoming packet

```js
// Block a specific incoming packet from reaching the game
window._blockIncomingFilters[packetId] = function(raw) {
  return true; // return true to block, false to allow
};
```

### Example extensions

#### Log all chat messages to console

```js
window.onPacket('Chat', function(p) {
  if (!p.raw) return;
  const r = window.makeReader(p.raw);
  if (!r) return;
  const userId = r.int();
  const text   = r.str();
  const user   = window.Room && window.Room.users && window.Room.users[userId];
  console.log('[Chat]', (user && user.name) || userId, ':', text);
});
```

#### Auto-say "hi" when entering a room

```js
window.onPacket('Users', function() {
  setTimeout(function() {
    const chatId = Object.entries(window.PKT.OUT || {})
      .find(([, v]) => window.shortName(v, 'OUT') === 'Chat')?.[0];
    if (chatId) window.sendPacket('OUT', parseInt(chatId), '{s:"hi!"}{i:0}');
  }, 500);
});
```

#### Show a HUD counter of people in the room

```js
(function() {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;bottom:60px;left:8px;z-index:999999;background:rgba(0,0,0,0.6);color:#fff;font:11px monospace;padding:3px 8px;border-radius:4px;pointer-events:none';
  document.body.appendChild(el);

  function update() {
    const count = window.Room && window.Room.users ? Object.values(window.Room.users).filter(u => u.type === 1).length : 0;
    el.textContent = count + ' users';
  }

  window.onPacket('Users', update);
  window.onPacket('UserRemove', update);
  setInterval(update, 2000);
})();
```

#### Block all incoming trade requests

```js
(function() {
  if (!window.PKT || !window.PKT.IN) return;
  for (const [id, name] of Object.entries(window.PKT.IN)) {
    if (window.shortName(name, 'IN') === 'TradeStart') {
      window._blockIncomingFilters[parseInt(id)] = () => true;
      break;
    }
  }
})();
```

### Writing extensions with Claude

Claude can write extensions for you. Open [claude.ai](https://claude.ai) or use Claude Code and give it a prompt like this:

> I'm building a JavaScript extension for a Habbo Hotel client. The extension runs inside a browser as an IIFE and has access to these globals:
>
> - `window.onPacket(name, callback)` — listen for a packet by short name
> - `window.PacketStore.subscribe(callback)` — subscribe to all packets; callback receives `{ name, direction, raw, parsed }`
> - `window.sendPacket(dir, id, payload)` — send a packet
> - `window.PKT.OUT` / `window.PKT.IN` — maps of `{ packetId: fullName }`
> - `window.shortName(fullName, dir)` — get short name from full name
> - `window.makeReader(raw)` — returns `{ int(), str(), bool() }` reader
> - `window.Room.users` — `{ userId: { id, name, figure, type } }` — type 1 = human, 2 = bot, 4 = pet
> - `window._selfName` — my username
>
> Write an extension that: **[describe what you want here]**
>
> The code should be plain JavaScript (no imports, no TypeScript). Wrap it in an IIFE.

Paste the code Claude gives you into the Extensions panel, save, and refresh the page.

### Cleanup: close buttons + toggling OFF

Register a cleanup function so your panel disappears immediately when toggled OFF — no page refresh needed.

```js
(function() {
  let active = true;

  // Build your panel
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;top:100px;right:10px;...';

  // Add a close button
  const close = document.createElement('button');
  close.textContent = '✕';
  close.addEventListener('click', function() {
    active = false;
    panel.remove();
  });
  panel.appendChild(close);
  document.body.appendChild(panel);

  // Guard packet listeners with the active flag
  window.onPacket('Chat', function(p) {
    if (!active) return;
    // ... handle packet
  });

  // Register cleanup — called when user clicks the toggle OFF button
  window.__ext_onStop(function() {
    active = false;
    panel.remove();
    // clear any intervals: clearInterval(myInterval);
  });
})();
```

The `active` flag is important — once a packet listener is registered it stays registered forever. Checking `if (!active) return;` at the top of each listener is the way to silence it after disable.

### Tips (in-game panel)

- Extensions run **once on page load**. Use `window.onPacket(...)` or `setInterval(...)` for ongoing behavior.
- Toggling OFF calls your `__ext_onStop` cleanup immediately. Toggling ON re-runs the extension code immediately. No refresh needed.
- Errors are logged to the browser console (F12 → Console). If an extension crashes it won't break the other tools.
- The `window.PKT` table is only populated after the WebSocket connects. If your extension needs packet IDs at startup, wrap the lookup in `window.onPacket('AuthenticationOK', ...)` or a short `setTimeout`.

---

## Building a new tool

### Quick start

1. Create `your-extension.js` in this folder (copy the template below).
2. Add it to `manifest.json`'s `js` array:
   ```json
   "extensions/your-extension.js"
   ```
3. In `content.js`, find `CATEGORIES` (inside `buildGhelooPanel`) and add a row to
   whichever category fits (`rooms`, `fun`, `exploits`, `settings`, ...):
   ```js
   { id: 'yourtool', title: 'Your Tool', subtitle: 'What it does', icon: ICONS.yourtool,
     close: false, onClick: showPanelById('__yt_panel') },
   ```
   If your panel needs to refresh every time it's opened (not just on page load):
   ```js
   onClick: function() {
     showPanelById('__yt_panel')();
     if (window.__yt_render) window.__yt_render();
   }
   ```
   Add an SVG to the `ICONS` object above `CATEGORIES` for a custom icon (24x24 viewBox,
   `stroke="currentColor"` — every existing icon follows this so it inherits row color).
4. `chrome://extensions` → reload Gheloo → refresh the hotel. Your row appears, opening
   your panel.

---

## Load order matters

`manifest.json`'s `js` array runs top-to-bottom, all at `document_start`, all before
`DOMContentLoaded`. Everything in the API table below — `window.onPacket`,
`window.sendPacket`, `window.PKT`, `window.Room`, `window.FurniData`,
`window.makeReader`, `window.__ghk_makeDraggable`, `window.__ghk_ready` — is defined by
one of the core files that load *before* `content.js` and every `extensions/*.js`:

```
ws-url.js    → __ghk_makeDraggable
ui-loading.js
pkt.js       → window.PKT (packet id ↔ name tables)
ws.js        → onPacket, sendPacket, makeReader, _blockIncomingFilters/_blockOutgoingFilters
parsers.js   → window.Room, window.FurniData, registers most IN/OUT parsers
...
content.js   → the hub itself: CATEGORIES, ICONS, showPanelById, window.Gheloo
extensions/*.js  → your file goes at the end of this list
```

You never need to touch those core files to *use* their globals — just don't call them
at the top level of your file before they're guaranteed to exist. `window.PKT`/`Room`/
`FurniData` are safe immediately (defined synchronously). `document.body` is **not** —
it doesn't exist yet at `document_start`, so anything touching the DOM (including
`new MutationObserver().observe(document.body, ...)`) has to wait for `__ghk_ready`/
`DOMContentLoaded`, same as `init()` already does in the template.

---

## The Gheloo look

Every panel in this repo shares one palette. Copy these values verbatim so your tool
looks native instead of bolted-on:

| Role | Color |
|---|---|
| Panel background | `#12131A` |
| Header background | `#0A0B10` |
| Card / row background | `#1c1e2a` |
| Border | `#23252f` |
| Primary text | `#eceefb` |
| Muted text | `#82849a` |
| Dim text | `#5c5e6b` |
| Accent (buttons, focus) | `#6C7CFF` |
| Accent, lighter (primary btn bg) | `#A6B0FF` |
| Success | `#2ecc71` |
| Danger | `#e74c3c` |

Standard shape: `border-radius:14px` on the outer card, `8px` on inner rows/buttons,
`box-shadow:0 12px 34px rgba(0,0,0,.55)` on the panel itself.

### Full panel skeleton (from `room-history.js`)

```js
const style = document.createElement('style');
style.textContent = [
  '#__yt_panel{position:fixed;top:16px;right:16px;width:300px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
  '#__yt_panel *{box-sizing:border-box}',
  '.__yt_card_wrap{display:flex;flex-direction:column;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb}',
  '.__yt_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
  '.__yt_title{font:600 13px system-ui;color:#eceefb;flex:1}',
  '.__yt_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
  '.__yt_close:hover{color:#eceefb}',
].join('');
document.head.appendChild(style);

const p = document.createElement('div');
p.id = '__yt_panel';
p.innerHTML =
  '<div class="__yt_card_wrap">' +
    '<div class="__yt_hdr" id="__yt_hdr">' +
      '<span class="__yt_title">Your Tool</span>' +
      '<span class="__yt_close" id="__yt_close">&times;</span>' +
    '</div>' +
    '<div id="__yt_body">...</div>' +
  '</div>';
document.body.appendChild(p);
p.style.display = 'none'; // hidden until the hub row opens it

window.__ghk_makeDraggable(p, p.querySelector('#__yt_hdr'), '__ghk_yt_pos', e => e.target.id === '__yt_close');
p.querySelector('#__yt_close').addEventListener('click', () => { p.style.display = 'none'; });
```

`__ghk_makeDraggable` handles drag-by-header AND remembers the panel's position across
page reloads (keyed by the `storageKey` you pass — `'__ghk_yt_pos'` above). Every panel
in this repo uses it; don't hand-roll drag logic.

### Button variants (from `area-mover.js` / `room-inspector.js`)

```css
.__yt_btn{font-size:11px;font-weight:600;padding:7px 10px;border-radius:8px;border:none;cursor:pointer;color:#0A0B10;background:#A6B0FF}
.__yt_btn:hover{filter:brightness(1.08)}
.__yt_btn.secondary{background:#23252f;color:#eceefb}
.__yt_btn.danger{background:rgba(231,76,60,0.14);color:#e74c3c;border:1px solid rgba(231,76,60,0.3)}
.__yt_btn.small{padding:3px 8px;font-size:10px}
.__yt_btn:disabled{opacity:0.45;cursor:not-allowed;filter:none}
```

Default button = solid lavender (primary action). `secondary` = flat dark (everything
else). `danger` = tinted outline, not a solid red fill — that tinted-outline treatment is
the house style for anything destructive, keep it consistent rather than using a loud
solid red.

### Toggle switch (from `room-inspector.js`)

```html
<label id="__yt_tog_wrap"><input type="checkbox" id="__yt_tog_inp"><span id="__yt_tog_track"></span><span id="__yt_tog_thumb"></span></label>
```
```css
#__yt_tog_wrap{position:relative;display:inline-block;width:34px;height:18px;flex-shrink:0;cursor:pointer}
#__yt_tog_inp{opacity:0;width:0;height:0;position:absolute}
#__yt_tog_track{position:absolute;inset:0;background:#23252f;border-radius:9px;transition:background .2s}
#__yt_tog_thumb{position:absolute;top:2px;left:2px;width:14px;height:14px;background:#eceefb;border-radius:50%;transition:transform .2s;box-shadow:0 1px 3px rgba(0,0,0,0.35)}
```
```js
function setToggleUI(on) {
  togTrack.style.background = on ? '#6C7CFF' : '#23252f';
  togThumb.style.transform  = on ? 'translateX(16px)' : 'translateX(0)';
}
togInp.addEventListener('change', function() { setToggleUI(this.checked); });
```

---

## Real patterns, pulled from working extensions

### Poll + diff a packet (from `marktplaats-alerts.js`)

Send an OUT request on an interval, compare the new snapshot against the last one to
find what's new:

```js
let _lastIds = null;
window.onPacket('MarketPlaceOffers', function(p) {
  if (!p.parsed || !p.parsed.offers) return;
  const curIds = new Set(p.parsed.offers.map(o => o.offerId));
  if (_lastIds) {
    const newOnes = p.parsed.offers.filter(o => !_lastIds.has(o.offerId));
    newOnes.forEach(showAlert); // do something with each new one
  }
  _lastIds = curIds; // null on the first pass on purpose — don't alert on the initial baseline
});

setInterval(function() {
  const id = _outId('GetMarketplaceOffers');
  if (id !== null) window.sendPacket('OUT', id, '{i:-1}{i:-1}{i:0}{u:7}');
}, 500);
```

### Watch for a native element and inject next to it (from `room-history.js`)

Native panels get re-rendered on room change, so a one-time `querySelector` injection
disappears the next time React redraws that area. Re-check on every DOM mutation instead:

```js
function ensureToolbarIcon() {
  const toolsBox = document.querySelector('.nitro-room-tools-container .nitro-room-tools');
  if (!toolsBox || toolsBox.querySelector('.__yt_toolbar_icon')) return;
  const btn = document.createElement('div');
  btn.className = 'cursor-pointer icon __yt_toolbar_icon';
  // ...build btn...
  toolsBox.appendChild(btn);
}
ensureToolbarIcon();
new MutationObserver(function() { ensureToolbarIcon(); }).observe(document.body, { childList: true, subtree: true });
```

Start this from `init()`, **not** at the top level of the file — this content script runs
at `document_start`, before `document.body` exists, so `.observe(document.body, ...)` at
the top level throws and silently kills the rest of the file. `init()` only runs after
`__ghk_ready`, once the DOM is actually there.

### Match native UI by class + text, not exact position

Clicking through native modals (catalog tabs, category tiles) by an absolute DOM path
(e.g. an XPath copied from devtools) breaks the moment another modal shifts the tree.
Match by a stable class plus the element's visible text instead:

```js
function findByText(selector, text) {
  for (const el of document.querySelectorAll(selector)) {
    if (el.textContent && el.textContent.trim().indexOf(text) !== -1) return el;
  }
  return null;
}
// survives DOM reshuffling — doesn't care how deep the element is nested
const tab = findByText('.layout-grid-item', 'Marktplaats');
if (tab) tab.click();
```

Combine with polling (not a fixed `setTimeout` guess) since React render time varies:

```js
function waitAndClickText(selector, text, timeoutMs, cb) {
  const start = Date.now();
  (function tick() {
    const el = findByText(selector, text);
    if (el) { el.click(); if (cb) cb(); return; }
    if (Date.now() - start > timeoutMs) return;
    setTimeout(tick, 25);
  })();
}
```

### Hook a Settings toggle to your extension (from `content.js` + `room-history.js`)

Let your extension own its on/off state; have the hub row just call into it, rather than
keeping two copies of the same setting:

```js
// in your-extension.js — module scope, so it exists before the panel is even built
window.__yt_setEnabled = function(on) { _on = !!on; _save(); /* start/stop whatever */ };
window.__yt_isEnabled  = function() { return _on; };
```
```js
// in content.js, inside a CATEGORIES row list
{ id: 'yourtoolsetting', title: 'Your Tool', subtitle: 'Turn on/off Your Tool', icon: ICONS.yourtool,
  close: false, onClick: function() {
    const next = !(window.__yt_isEnabled && window.__yt_isEnabled());
    if (window.__yt_setEnabled) window.__yt_setEnabled(next);
    window.Gheloo.setActive('yourtoolsetting', next);
  } },
```

### Draw a parsed-packet-driven notification bubble matching the native style

Native notification bubbles use `nitro-notification-bubble default-bubble rounded p-2`
with a `bubble-image-container` > `icon.bubble-image` (background-image, not `<img>`) and
a `notification-bubble-text` span. Reuse the exact classes so it doesn't look bolted-on,
then override just size/color with your own scoped class:

```js
wrap.innerHTML =
  '<div class="d-flex gap-2 align-items-center cursor-pointer nitro-notification-bubble default-bubble rounded p-2 __yt_bubble">' +
    '<div class="d-flex bubble-image-container">' +
      '<div class="icon bubble-image" style="background-image:url(&quot;' + iconUrl + '&quot;)"></div>' +
    '</div>' +
    '<div class="d-flex flex-column notification-bubble-text fw-bold"><span>' + esc(text) + '</span></div>' +
  '</div>';
```

---

## API

| Function | Description |
|---|---|
| `window.__ghk_makeDraggable(panel, handleEl, storageKey, shouldSkip)` | Makes a panel draggable by its header, persisting position in localStorage |
| `window.onPacket(name, fn)` | Listen for a game packet by short name |
| `window.sendPacket(dir, id, payload)` | Send a packet — `payload` is an expression string like `'{i:5}{s:"text"}{b:true}'` |
| `window.PKT.OUT` / `window.PKT.IN` | `{ packetId: fullName }` — resolve an id with `window.shortName(fullName, dir)` |
| `window.Room` | Current room state: `Room.id`, `Room.users`, `Room.floorItems`, `Room.wallItems`, `Room.floorPlan` |
| `window.FurniData.floor[typeId]` / `.wall[typeId]` | `{ name, description, classname }` — furni lookup, populated async on load |
| `window._selfName` | Your own username |
| `window.makeReader(raw)` | Cursor reader over a packet's payload: `.int() .short() .bool() .byte() .str() .long() .skip(n) .remaining()` |
| `window.__ghk_ready(fn)` | Runs `fn` once the client is ready — wrap your `init()` in this |
| `window.__ghk_bringToFront(el)` | Raises a panel above other game/extension panels on click |
| `window._blockIncomingFilters[id]` | Set to `true` to always block that IN packet, or to `function(raw){}` returning true/false to block conditionally |
| `window._blockOutgoingFilters[id]` | Same, for OUT packets — `delete` the key to stop blocking |

Blocking a packet client-side (e.g. hiding your own typing bubble by blocking the
outgoing `StartTyping` before it ever reaches the server):
```js
const id = _outId('StartTyping');
if (id !== null) window._blockOutgoingFilters[id] = true; // always block
// or conditionally:
window._blockIncomingFilters[someInId] = function(raw) {
  const r = window.makeReader(raw);
  return r ? r.int() === myRoomIndex : false; // block only if it's about me
};
```

To find a packet's id by name (most extensions define this locally):
```js
function _outId(name) {
  if (!window.PKT || !window.PKT.OUT) return null;
  for (const id in window.PKT.OUT) {
    if (window.shortName(window.PKT.OUT[id], 'OUT') === name) return parseInt(id);
  }
  return null;
}
```

---

## You can't run this yourself — hand verification back to the human

If you're an AI working on this repo: you have no browser, no live connection to the
hotel, and no way to click through the actual UI. Every fact about live behavior —
packet byte layouts, which native CSS class a button actually has, whether a selector
still matches after a client update, whether a feature *works* — has to come from the
person you're working with, either by them pasting real capture data or by them testing
your change and reporting back what happened. Don't present a guess as confirmed just
because the code is syntactically valid; `node --check your-file.js` proves it parses,
not that it works. State clearly what's verified (matched a real capture, decoded cleanly
with no leftover bytes) versus what's a best-effort guess (an image URL you haven't
confirmed, a selector copied from one DOM snapshot that might shift). Ask for the
specific piece of evidence you need next rather than shipping something you can't back up.

## Reverse-engineering a new packet

Don't guess a byte layout — a wrong guess silently shows wrong data (prices, names) with
no error to notice. Instead:

1. Open Hub → Scripting → Packet Logger, find the packet, click it, use the **Raw hex**
   copy button in its detail view.
2. If possible, capture it twice with one known change in between (e.g. one more item
   listed) and diff the two hex dumps — the exact bytes that differ tell you precisely
   where one record starts/ends, which is far more reliable than guessing field
   boundaries from a single capture.
3. Verify field-by-field with a real parser (`window.makeReader`), not by eyeballing hex —
   run it against the whole capture and confirm every record decodes to sane values with
   no leftover bytes, the way `parsers.js`'s `MarketPlaceOffers` parser was built.

---

## Only run heavy logic when the panel is open

```js
let open = false;
p.querySelector('#__yt_close').addEventListener('click', () => { open = false; p.style.display = 'none'; });
// on the hub row's onClick, after showPanelById(...)():  open = true; render();

setInterval(function() {
  if (!open) return;
  render();
}, 2000);
```

---

## Tips

- Singleton guard at the top of every file: `if (document.getElementById('__yt_panel')) return;`
- Match the flat dark card style (`furni-hider.js`, `room-history.js`, `marktplaats-alerts.js`) for a
  standalone tool. Use `nitro-card theme-primary` native classes instead if you want it to
  look like a built-in game window rather than a Gheloo tool.
- After editing a file, reload the extension in `chrome://extensions` and refresh the hotel.
- Keep one extension = one concern. If a tool needs a Settings toggle, a toolbar icon, *and*
  a full panel, that's fine in one file — but don't merge two unrelated tools into one file.
