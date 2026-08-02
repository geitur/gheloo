# Extensions

The Extensions panel lets you add your own JavaScript that runs inside the hotel client alongside the built-in tools (Macros, Mimic, etc.). Extensions are stored in your browser's `localStorage` and load automatically on every page refresh.

---

## How to open the panel

1. Click the **Hub** icon in the toolbar
2. Click **Extensions**
3. Click **+ Add** to create your first extension

Give it a name and paste your JavaScript code. Click **Save**. The extension will run next time you refresh the page.

You can toggle extensions ON/OFF without deleting them, or edit the code at any time.

---

## Available APIs

Your extension code runs with full access to these globals:

### Packet sending

```js
// Send an outgoing packet by name
window.sendPacket('OUT', packetId, '{s:"hello"}{i:0}');

// Look up a packet ID by short name
const id = Object.entries(window.PKT.OUT)
  .find(([,v]) => window.shortName(v, 'OUT') === 'Chat')?.[0];
```

### Packet listening

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

### Room and player info

```js
window._selfName          // your username (string)
window.Room               // current room object
window.Room.id            // room id
window.Room.users         // object of users in the room { userId: { id, name, figure, type, ... } }
```

### Packet reader

```js
// Read values from a raw packet buffer
const r = window.makeReader(p.raw);
if (r) {
  const str  = r.str();   // read a string
  const num  = r.int();   // read an integer
  const bool = r.bool();  // read a boolean
}
```

### Block an incoming packet

```js
// Block a specific incoming packet from reaching the game
window._blockIncomingFilters[packetId] = function(raw) {
  return true; // return true to block, false to allow
};
```

---

## Example extensions

### Log all chat messages to console

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

### Auto-say "hi" when entering a room

```js
window.onPacket('Users', function() {
  setTimeout(function() {
    const chatId = Object.entries(window.PKT.OUT || {})
      .find(([, v]) => window.shortName(v, 'OUT') === 'Chat')?.[0];
    if (chatId) window.sendPacket('OUT', parseInt(chatId), '{s:"hi!"}{i:0}');
  }, 500);
});
```

### Show a HUD counter of people in the room

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

### Block all incoming trade requests

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

---

## Writing extensions with Claude

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

---

## Cleanup: close buttons + toggling OFF

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

---

## Tips

- Extensions run **once on page load**. Use `window.onPacket(...)` or `setInterval(...)` for ongoing behavior.
- Toggling OFF calls your `__ext_onStop` cleanup immediately. Toggling ON re-runs the extension code immediately. No refresh needed.
- Errors are logged to the browser console (F12 → Console). If an extension crashes it won't break the other tools.
- The `window.PKT` table is only populated after the WebSocket connects. If your extension needs packet IDs at startup, wrap the lookup in `window.onPacket('AuthenticationOK', ...)` or a short `setTimeout`.
