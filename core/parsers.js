(function() {
  // Direction-split parsers: PacketParsers.IN.Chat / PacketParsers.OUT.Chat
  window.PacketParsers = { IN: {}, OUT: {} };

  // --- Incoming ---

  // Chat / Shout / Whisper share layout per G-Rust: userIndex, text, gesture, styleId, [links], trackingId
  function parseChatLike(raw) {
    const r = window.makeReader(raw); if (!r) return null;
    return { userIndex: r.int(), text: r.str(), gesture: r.int(), styleId: r.int() };
  }
  window.PacketParsers.IN.Chat    = parseChatLike;
  window.PacketParsers.IN.Shout   = parseChatLike;
  window.PacketParsers.IN.Whisper = parseChatLike;

  // UserUpdate: count, then per entity: index, x, y, z(str), headFacing, bodyFacing, action
  window.PacketParsers.IN.UserUpdate = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    const count   = r.int();
    const index   = r.int();
    const x       = r.int();
    const y       = r.int();
    const z       = parseFloat(r.str());
    const headDir = r.int();
    const bodyDir = r.int();
    const action  = r.str();
    return { count, index, x, y, z, headDir, bodyDir, action };
  };

  // UserChange: index, figure, gender, motto, userId
  window.PacketParsers.IN.UserChange = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    const index  = r.int();
    const figure = r.str();
    const gender = r.str();
    const motto  = r.str();
    const id     = r.int();
    return { index, figure, gender, motto, id };
  };

  // ExtendedProfile: id, name, figure, motto, then unmapped fields (join date text,
  // achievement/friend counts, etc.) — only pulling what's needed to log a viewed profile.
  window.PacketParsers.IN.ExtendedProfile = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    const id     = r.int();
    const name   = r.str();
    const figure = r.str();
    const motto  = r.str();
    return { id, name, figure, motto };
  };

  // GuildMembers: unmapped int, group name (own length prefix — often empty, but a real
  // string field, not a fixed-width short as an earlier version of this parser assumed),
  // unmapped int, badge code, unmapped int, then a page-count int that reliably drives
  // the {id,name,figure,joinDate,rank} loop. Byte-verified against three real raw-hex
  // captures (14-member small group, 16047-member group, and a group with a populated
  // "Bunny" group-name field) — every field lined up exactly, loop consumed precisely to
  // the trailing unmapped bytes in all three. Badge code still gets a defensive resync
  // (tries a few byte offsets, validated by whether the resulting pageCount looks sane —
  // NOT by printability, since badge codes can contain non-ASCII bytes) as a safety net,
  // though with the group-name field now accounted for it landed correctly on the first
  // try in all three captures.
  window.PacketParsers.IN.GuildMembers = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    try {
      r.int();                        // unmapped
      r.str();                        // group name (can be empty)
      r.int();                        // unmapped

      let badgeStartIdx = null;
      for (let skip = 0; skip <= 4 && badgeStartIdx === null; skip++) {
        const idx = r.getReadIndex();
        try {
          r.str();                    // candidate badge code
          r.int();                    // unmapped
          const candidatePageCount = r.int();
          if (candidatePageCount > 0 && candidatePageCount <= 500) { badgeStartIdx = idx; break; }
        } catch (_e) { /* out of range at this offset — keep resyncing */ }
        r.setReadIndex(idx + 1);
      }
      if (badgeStartIdx === null) return null;
      r.setReadIndex(badgeStartIdx);

      r.str();                        // badge code
      r.int();                        // unmapped
      const pageCount = r.int();
      r.int();                        // unmapped (page index?)
      const members = [];
      for (let i = 0; i < pageCount; i++) {
        const id       = r.int();
        const name     = r.str();
        const figure   = r.str();
        const joinDate = r.str();
        const rank     = r.int();
        members.push({ id, name, figure, joinDate, rank });
      }
      return { members };
    } catch (e) { return null; }
  };

  // RelationshipStatusInfo: subjectId, then N categories (best friends / enemies / etc,
  // exact category meaning unmapped), each as {categoryId, memberCount, member[]} — confirmed
  // against a live capture: header counts (2 categories, 1 member each) matched the entries
  // that followed exactly, token for token.
  window.PacketParsers.IN.RelationshipStatusInfo = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    try {
      const subjectId = r.int();
      const categoryCount = r.int();
      const users = [];
      for (let c = 0; c < categoryCount; c++) {
        const categoryId  = r.int();
        const memberCount = r.int();
        for (let i = 0; i < memberCount; i++) {
          const id     = r.int();
          const name   = r.str();
          const figure = r.str();
          users.push({ id, name, figure, categoryId });
        }
      }
      return { subjectId, users };
    } catch (e) { return null; }
  };

  // Dance: userIndex, danceId
  window.PacketParsers.IN.Dance = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    return { userIndex: r.int(), danceId: r.int() };
  };

  // Expression (wave/laugh/etc): userIndex, expressionId
  window.PacketParsers.IN.Expression = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    return { userIndex: r.int(), expressionId: r.int() };
  };

  // UserTyping: userIndex, isTyping
  window.PacketParsers.IN.UserTyping = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    return { userIndex: r.int(), isTyping: r.bool() };
  };

  // RoomReady: roomType(str), roomId(int)
  window.PacketParsers.IN.RoomReady = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    return { roomType: r.str(), roomId: r.int() };
  };

  function parseHNavigatorRoom(r) {
    const flatId       = r.int();
    const roomName     = r.str();
    const ownerId      = r.int();
    const ownerName    = r.str();
    const doorMode     = r.int();
    const userCount    = r.int();
    const maxUserCount = r.int();
    const base = { flatId, roomName, ownerId, ownerName, doorMode, userCount, maxUserCount };
    try {
      r.int(); r.int(); r.int(); // extra ints in this hotel's protocol (not in G-Earth Java reference)
      const description  = r.str();
      const score        = r.int();
      const ranking      = r.int();
      r.bool();                  // extra bool in this hotel's protocol
      const categoryId   = r.int();
      const tagCount     = r.int();
      const tags = [];
      for (let i = 0; i < tagCount; i++) tags.push(r.str());
      try {
        const showOwner = !!r.int();
        const allowPets = !!r.int();
        return { ...base, description, score, ranking, categoryId, tags, showOwner, allowPets };
      } catch(_) {}
      return { ...base, description, score, ranking, categoryId, tags };
    } catch(_) { return base; }
  }

  // GetGuestRoomResult: bool(entered), HNavigatorRoom
  window.PacketParsers.IN.GetGuestRoomResult = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    try {
      const entered = r.bool();
      const room = parseHNavigatorRoom(r);
      return { entered, room };
    } catch(e) { return null; }
  };

  // NavigatorSearchResultBlocks: str(searchCode), int(?), int(blockCount), per block: int(?), int(viewMode), int(roomCount), rooms[]
  window.PacketParsers.IN.NavigatorSearchResultBlocks = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    try {
      const searchCode  = r.str();
      r.int();                      // unknown
      const blockCount  = r.int();
      const blocks = [];
      for (let b = 0; b < blockCount; b++) {
        r.int();                    // unknown per-block int
        const viewMode    = r.int();
        const roomCount   = r.int();
        const rooms = [];
        for (let i = 0; i < roomCount; i++) rooms.push(parseHNavigatorRoom(r));
        blocks.push({ searchCode, viewMode, rooms });
      }
      return { searchCode, blockCount, blocks };
    } catch(e) { return null; }
  };

  // UserObject (IN 2725): own user data sent on login
  window.PacketParsers.IN.UserObject = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    try {
      const id     = r.int();
      const name   = r.str();
      const figure = r.str();
      const sex    = r.str();
      const motto  = r.str();
      return { id, name, figure, sex, motto };
    } catch(e) { return null; }
  };

  // --- Outgoing ---

  // Chat OUT: {s:"text"}{i:bubbleStyle}
  window.PacketParsers.OUT.Chat = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    return { text: r.str(), bubbleStyle: r.int() };
  };

  // Shout OUT: same as Chat OUT
  window.PacketParsers.OUT.Shout = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    return { text: r.str(), bubbleStyle: r.int() };
  };

  // Whisper OUT: {s:"recipientName"}{s:"text"}{i:bubbleStyle}
  window.PacketParsers.OUT.Whisper = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    return { recipient: r.str(), text: r.str(), bubbleStyle: r.int() };
  };

  // MoveAvatar OUT: {i:x}{i:y}
  window.PacketParsers.OUT.MoveAvatar = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    return { x: r.int(), y: r.int() };
  };

  // Dance OUT: {i:danceId}
  window.PacketParsers.OUT.Dance = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    return { danceId: r.int() };
  };

  // UpdateFigureData OUT: {s:"gender"}{s:"figureString"}
  window.PacketParsers.OUT.UpdateFigureData = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    return { gender: r.str(), figure: r.str() };
  };

  // Parses floor item stuff data — ported from C# ObjectsParser.ParseItemData
  // unique flag (dataTypeRaw & 0x100) is handled by caller, NOT here
  function parseItemData(r, type) {
    switch (type) {
      case 0: return { state: r.str() };
      case 1: { const c=r.int(); const m={}; for(let j=0;j<c;j++){const k=r.str();m[k]=r.str();} return {map:m}; }
      case 2: { const c=r.int(); const a=[]; for(let j=0;j<c;j++) a.push(r.str()); return {array:a}; }
      case 3: return { state: r.str() };
      case 4: return { state: r.str() };
      case 5: { const c=r.int(); const a=[]; for(let j=0;j<c;j++) a.push(r.int()); return {intArray:a}; }
      case 6: {
        const state=r.str(); r.str(); r.int(); r.str(); r.str(); r.int(); r.int();
        const ec=r.int(); const scores=[];
        for(let j=0;j<ec;j++){const pts=r.long();const nc=r.int();const users=[];for(let k=0;k<nc;k++) users.push(r.str());scores.push({pts,users});}
        return {state, scores};
      }
      case 7: { const state=r.str(); const hits=r.int(); const target=r.int(); return {crackableState:state,hits,target}; }
      default: return {};
    }
  }

  function parseHEntity(r) {
    const id            = r.int();
    const name          = r.str();
    const motto         = r.str();
    const figure        = r.str();
    const index         = r.int();
    const x             = r.int();
    const y             = r.int();
    const z             = Number(r.str().replace(',', '.'));
    const bodyDirection = r.int();
    const entityType    = r.int();

    let type = entityType;
    let gender = '', groupId = 0, groupStatus = 0, favoriteGroup = '', swimFigure = '', achievementScore = 0, isModerator = false;
    let botType = null, petType = null;
    let isUser = false, isBot = false, isPet = false;

    if (entityType === 1) {       // Human user
      isUser           = true;
      gender           = r.str();
      groupId          = r.int();
      groupStatus      = r.int();
      favoriteGroup    = r.str();  // groupName
      swimFigure       = r.str();
      achievementScore = r.int();
      isModerator      = r.bool();
    } else if (entityType === 2) { // Pet — Nitro format
      isPet   = true;
      type    = 4;
      try {
        petType = r.int();         // subType
        r.int();                   // ownerId
        r.str();                   // ownerName
        r.int();                   // rarityLevel
        r.bool();                  // hasRider
        r.int(); r.int(); r.int(); // unknown x3
      } catch(_) {}
    } else if (entityType === 3) { // Public bot
      isBot = true;
      type  = 2;
      try {
        gender  = r.str();
        r.int();                   // ownerId
        r.str();                   // ownerName
        botType = r.int();         // botType (e.g. 10)
        const dataCount = r.int();
        for (let s = 0; s < dataCount; s++) r.int();
      } catch(_) {}
    } else if (entityType === 4) { // Private bot
      isBot = true;
      type  = 2;
      try {
        gender  = r.str();
        r.int();                   // ownerId
        r.str();                   // ownerName
        botType = r.int();         // bot type
        r.int();                   // unknown
        r.int(); r.int(); r.int(); r.int(); // 4 skill ints
      } catch(_) {}
    }

    return { id, index, name, motto, figure, x, y, z, bodyDirection, type, entityType, gender, groupId, groupStatus, favoriteGroup, swimFigure, achievementScore, isModerator, botType, petType, isUser, isBot, isPet };
  }

  // Users (IN): count then HEntity[]
  window.PacketParsers.IN.Users = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    const count = r.int();
    const users = [];
    for (let i = 0; i < count; i++) {
      try { users.push(parseHEntity(r)); }
      catch(e) { console.error('[Users parser] entity', i, '/', count, 'failed:', e.message); break; }
    }
    return { count, users };
  };

  // UserRemove (IN): index sent as string in Nitro protocol
  window.PacketParsers.IN.UserRemove = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    try { return { index: parseInt(r.str()) }; } catch(e) { return null; }
  };

  // Objects (IN): floor items — ported from C# ObjectsParser (works 100%)
  window.PacketParsers.IN.Objects = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    const owners = {}; const oc = r.int();
    for (let i=0;i<oc;i++) { const oid=r.int(); owners[oid]=r.str(); }
    const count = r.int(); const items = [];
    for (let i=0;i<count;i++) {
      try {
        const id          = r.int();
        const typeId      = r.int();
        const x           = r.int(); const y = r.int();
        const facing      = r.int();
        const z           = r.str();
        const sizeZ       = r.str();
        const extra       = r.int();
        const dataTypeRaw = r.int();
        const stuff       = parseItemData(r, dataTypeRaw & 0xFF);
        // Unique edition number/size pair (flag 0x100) comes right after the stuff body,
        // BEFORE expires/usagePolicy — confirmed byte-exact against a real capture of a
        // known item (Hippo der Anubis (LTD), real in-game edition 277/500): the previous
        // order (reading this pair AFTER expires/usagePolicy) was landing on the wrong
        // bytes, producing a bogus uniqueSerial of -1 on every real LTD room item while
        // corrupting expires/usagePolicy into nonsense too. Zero leftover bytes once
        // reordered, and expires/usagePolicy come out sane (-1 / small enum) across every
        // item in that capture, flagged or not.
        if (dataTypeRaw & 0x100) { stuff.uniqueSerial=r.int(); stuff.uniqueSerialSize=r.int(); }
        const expires     = r.int();
        const usagePolicy = r.int();
        const ownerId     = r.int();
        const ownerName   = owners[ownerId] || '';
        if (typeId < 0) r.str(); // identifier for negative kind
        items.push({ id, typeId, x, y, z: parseFloat(z), sizeZ, extra, facing, stuff, expires, usagePolicy, ownerId, ownerName });
      } catch(e) { console.error('[Objects item #'+(i+1)+']', e); break; }
    }
    return { count: items.length, items };
  };

  // ObjectAdd (IN): a single floor item placed live during the session — NOT re-sent via
  // Objects (that packet only carries the full/initial room dump). Same per-item layout
  // as Objects' inner loop, but exactly one item and no owners table — the owner name is
  // inlined right after ownerId instead of being looked up. Confirmed field-for-field
  // against a real capture: {i:id}{i:typeId}{i:x}{i:y}{i:facing}{s:z}{s:sizeZ}{i:extra}
  // {i:dataTypeRaw}{...stuff...}[{i:uniqueSerial}{i:uniqueSerialSize} if flag 0x100]
  // {i:expires}{i:usagePolicy}{i:ownerId}{s:ownerName}.
  window.PacketParsers.IN.ObjectAdd = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    const id          = r.int();
    const typeId      = r.int();
    const x           = r.int(); const y = r.int();
    const facing      = r.int();
    const z           = r.str();
    const sizeZ       = r.str();
    const extra       = r.int();
    const dataTypeRaw = r.int();
    const stuff       = parseItemData(r, dataTypeRaw & 0xFF);
    if (dataTypeRaw & 0x100) { stuff.uniqueSerial=r.int(); stuff.uniqueSerialSize=r.int(); }
    const expires     = r.int();
    const usagePolicy = r.int();
    const ownerId     = r.int();
    const ownerName   = r.str();
    if (typeId < 0) r.str(); // identifier for negative kind
    return { id, typeId, x, y, z: parseFloat(z), sizeZ, extra, facing, stuff, expires, usagePolicy, ownerId, ownerName };
  };

  // CameraStorageUrl (IN): fires whenever the camera has a new preview/photo filename
  // available — including just from posing, not only after a real photo is taken (see
  // photo-library.js's RenderRoom-gated capture for how that's filtered out). Payload is
  // just the bare filename (e.g. "b64a34a1-61d9-4454-988c-619bd18ea86c.png"), confirmed
  // via two real captures — combine with the known base URL to get the real photo.
  window.PacketParsers.IN.CameraStorageUrl = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    return { filename: r.str() };
  };

  // Items (IN): wall items — owners map, then items; id comes as string
  window.PacketParsers.IN.Items = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    const owners = {}; const oc = r.int();
    for (let i=0;i<oc;i++) { const oid=r.int(); owners[oid]=r.str(); }
    const count = r.int(); const items = [];
    for (let i=0;i<count;i++) {
      try {
        const id       = parseInt(r.str());
        const typeId   = r.int();
        const location = r.str();
        const state    = r.str();
        r.int(); r.int(); // expiry, usagePolicy
        const ownerId  = r.int();
        items.push({ id, typeId, location, state, ownerId, ownerName: owners[ownerId]||'' });
      } catch(e) { break; }
    }
    return { count: items.length, items };
  };

  // HeightMap (IN): floor height grid — width, count, then count uint16 tile values
  // tile 0xFFFF = wall/void; otherwise raw height value (Nitro fixed-point)
  window.PacketParsers.IN.HeightMap = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    try {
      const width = r.int();
      const count = r.int();
      const rows = Math.ceil(count / width);
      const flat = [];
      for (let i = 0; i < count; i++) flat.push(r.short());
      const grid = [];
      for (let y = 0; y < rows; y++) {
        const row = flat.slice(y * width, (y + 1) * width);
        grid.push(row.map(v => v === 0xFFFF ? '----' : String(v).padStart(4)).join(' '));
      }
      return { width, rows, grid: grid.join('\n') };
    } catch(e) { return null; }
  };

  // --- Room State Engine ---
  // Room.users keyed by room index (matches UserUpdate/UserRemove)
  window.Room = { id: null, name: null, ownerName: null, users: {}, floorItems: {}, wallItems: {}, wallHeight: null, floorPlan: null, floorPlanScale: null, hideWalls: null, wallThickness: null, floorThickness: null, floorType: null, wallType: null, landscapeType: null };

  // FurniData: typeId → {name, description, classname} for floor and wall items
  window.FurniData = { floor: {}, wall: {}, ready: false };
  fetch('https://images.leet.city/leet-asset-bundles/gamedata/leet_furni.json')
    .then(function(r){ return r.json(); })
    .then(function(d){
      (d.roomitemtypes&&d.roomitemtypes.furnitype||[]).forEach(function(f){
        window.FurniData.floor[f.id]={name:f.name,description:f.description,classname:f.classname};
      });
      (d.wallitemtypes&&d.wallitemtypes.furnitype||[]).forEach(function(f){
        window.FurniData.wall[f.id]={name:f.name,description:f.description,classname:f.classname};
      });
      window.FurniData.ready=true;
      console.log('[FurniData] loaded',Object.keys(window.FurniData.floor).length,'floor +',Object.keys(window.FurniData.wall).length,'wall');
    })
    .catch(function(e){ console.warn('[FurniData] load failed:',e); });

  window.onPacket('RoomReady', p => {
    if (p.parsed) window.Room.id = p.parsed.roomId;
    window.Room.name = null;
    window.Room.ownerName = null;
    window.Room.users = {};
    window.Room.floorItems = {};
    window.Room.wallItems = {};
    window.Room.wallHeight = null;
    window.Room.floorPlan = null;
    window.Room.floorPlanScale = null;
    window.Room.hideWalls = null;
    window.Room.wallThickness = null;
    window.Room.floorThickness = null;
    window.Room.floorType = null;
    window.Room.wallType = null;
    window.Room.landscapeType = null;
  });

  // FloorHeightMap: scale flag, wallHeight, floorPlan (the char-per-tile map string
  // 'UpdateFloorProperties' expects back verbatim — x=void, 0-9/a-z=height). The scale
  // flag matches @nitrots/nitro-renderer's FloorHeightMapMessageParser exactly: it picks
  // the tile-height unit used to build the room's wall geometry (true=32, false=64) — the
  // Room Viewer must feed this through to FloorHeightMapMessageParser.parseModel() rather
  // than hardcoding a value, or wall-mounted item heights come out systematically wrong.
  window.PacketParsers.IN.FloorHeightMap = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    try {
      const scale = r.bool();
      const wallHeight = r.int();
      const floorPlan = r.str();
      return { scale, wallHeight, floorPlan };
    } catch(e) { return null; }
  };
  window.onPacket('FloorHeightMap', p => {
    if (!p.parsed) return;
    window.Room.wallHeight = p.parsed.wallHeight;
    window.Room.floorPlan = p.parsed.floorPlan;
    window.Room.floorPlanScale = p.parsed.scale;
  });

  // RoomVisualizationSettings: hideWalls, wallThickness, floorThickness — the other
  // half of what 'UpdateFloorProperties' needs to fully reproduce a room's wall look.
  // @nitrots/nitro-renderer's own RoomVisualizationSettingsParser doesn't use the two raw
  // ints directly — it clamps each to [-2,1] then applies 2**x (so raw -1/0/1 become
  // 0.5/1/2), and that transformed value is what actually goes into
  // updateRoomInstancePlaneThickness. Matching that exactly here.
  window.PacketParsers.IN.RoomVisualizationSettings = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    try {
      const hideWalls = r.bool();
      let wallThicknessRaw = r.int();
      let floorThicknessRaw = r.int();
      wallThicknessRaw = wallThicknessRaw < -2 ? -2 : wallThicknessRaw > 1 ? 1 : wallThicknessRaw;
      floorThicknessRaw = floorThicknessRaw < -2 ? -2 : floorThicknessRaw > 1 ? 1 : floorThicknessRaw;
      const wallThickness = Math.pow(2, wallThicknessRaw);
      const floorThickness = Math.pow(2, floorThicknessRaw);
      return { hideWalls, wallThickness, floorThickness };
    } catch(e) { return null; }
  };
  window.onPacket('RoomVisualizationSettings', p => {
    if (!p.parsed) return;
    window.Room.hideWalls = p.parsed.hideWalls;
    window.Room.wallThickness = p.parsed.wallThickness;
    window.Room.floorThickness = p.parsed.floorThickness;
  });

  // MarketPlaceOffers (IN, wireId 680): public marketplace listings, sent in response to
  // GetMarketplaceOffers. Category 3 = multiple identical items grouped under one price;
  // anything else (seen: 1) = a single item, whose price lives in a 2-byte field instead
  // of int32. The final int of each record was originally logged as an unused "trailing
  // flag" — a real capture (2026-09-02, category 1, "Paarse Machine (Rare)") proved it's
  // actually the offer count: offerId 304381/price 15/avgPrice 72 decoded byte-for-byte
  // against the native UI's own "Prijs: 15 BC (Gemiddeld: 72)", and that record's trailing
  // int was 3 — exactly matching the native UI's "Aanbod: 3" for that same listing (every
  // other record in the same capture had trailing=1, matching their own "Aanbod: 1"). The
  // category-3 branch's separate count/cap fields are unconfirmed by any live capture and
  // deliberately left untouched — no evidence they're wrong, so no reason to guess at them too.
  window.PacketParsers.IN.MarketPlaceOffers = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    try {
      const total = r.int();
      const offers = [];
      while (true) {
        const offerId = r.int();
        const flag = r.int();
        const category = r.int();
        const classId = r.int();
        if (category === 3) {
          const count = r.int();
          const cap = r.int();
          const price = r.int();
          r.int(); // always 0
          const avgPrice = r.int();
          r.int(); // trailing flag — unconfirmed for this branch, see comment above
          offers.push({ offerId, flag, category, classId, count, cap, price, avgPrice });
        } else {
          r.int(); r.int(); // always 0, 0
          const price = r.short();
          r.int(); // always 0
          const avgPrice = r.int();
          const count = r.int(); // confirmed live: real offer count, not a discardable flag
          offers.push({ offerId, flag, category, classId, count, cap: null, price, avgPrice });
        }
        if (offers.length >= total || offers.length > 500) break;
      }
      return { total, offers };
    } catch(e) { console.error('[MarketPlaceOffers parser]', e); return null; }
  };

  // MarketPlaceOwnOffers (IN 3884): YOUR OWN active/expired marketplace listings — distinct
  // packet from MarketPlaceOffers above (that's the public browse list). No prior schema for
  // this one; reverse-engineered from live captures diffed against each other and against
  // known ground truth (a real account with 3 confirmed-expired listings that never auto-
  // cleared + 1 confirmed-active one at ~47h remaining). Each entry is a fixed 34 bytes.
  // `expiryField` is minutes remaining until the 48h listing window closes (confirmed: 2879
  // matched an in-game "47 hours" display almost exactly) — once negative, the listing is
  // dead and it keeps counting further negative for however long the ghost entry has sat
  // uncleared, not a fixed field. `fieldA` is present but its meaning is NOT confirmed —
  // values seen ranged from double digits to hundreds of millions across different capture
  // sessions with no clean correlation to price/expiry, so it's exposed raw rather than
  // guessed at.
  // Minutes -> "Xd Yh" (or "<1h" for anything under an hour) — used for expiryField below so
  // the Packet Logger's detail view shows something readable next to the raw minute count.
  function _formatDaysHours(mins) {
    const abs = Math.abs(mins);
    const days = Math.floor(abs / 1440);
    const hours = Math.floor((abs % 1440) / 60);
    const span = days > 0 ? days + 'd ' + hours + 'h' : (hours > 0 ? hours + 'h' : '<1h');
    return mins < 0 ? span + ' ago' : span + ' left';
  }

  window.PacketParsers.IN.MarketPlaceOwnOffers = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    try {
      r.int(); // unknown header int, always 0 in every capture seen
      const count = r.int();
      const offers = [];
      for (let i = 0; i < count; i++) {
        const offerId = r.int();
        r.int(); // flag1, always 1 so far
        r.int(); // flag2, always 1 so far
        const fieldA = r.int(); // unconfirmed meaning
        r.int(); // zero
        r.int(); // zero
        const price = r.short();
        const expiryField = r.int(); // minutes remaining (negative = expired that many minutes ago)
        r.int(); // reserved, always 0 so far
        offers.push({ offerId, fieldA, price, expiryField, expiryLabel: _formatDaysHours(expiryField), expired: expiryField < 0 });
      }
      return { count, offers };
    } catch(e) { console.error('[MarketPlaceOwnOffers parser]', e); return null; }
  };

  // GetGuestRoomResult carries the real room name/owner (sent on room entry, not general
  // navigator browsing) — RoomReady itself only has the numeric roomId, so this is the
  // actual source for display info. Not gated on window.Room.id matching — this fires
  // before RoomReady in the real entry sequence, so window.Room.id may still be stale.
  window.onPacket('GetGuestRoomResult', p => {
    if (!p.parsed || !p.parsed.room) return;
    window.Room.name = p.parsed.room.roomName;
    window.Room.ownerName = p.parsed.room.ownerName;
  });

  window.onPacket('Users', p => {
    if (!p.parsed) return;
    p.parsed.users.forEach(u => { window.Room.users[u.index] = u; });
  });

  window.onPacket('UserUpdate', p => {
    if (!p.parsed) return;
    const u = window.Room.users[p.parsed.index];
    if (u) {
      u.x = p.parsed.x; u.y = p.parsed.y; u.z = p.parsed.z;
      u.headDir = p.parsed.headDir; u.bodyDir = p.parsed.bodyDir;
      u.action  = p.parsed.action;
    }
  });

  window.onPacket('UserChange', p => {
    if (!p.parsed) return;
    const u = window.Room.users[p.parsed.index];
    if (u) {
      u.figure = p.parsed.figure;
      u.gender = p.parsed.gender;
      u.motto  = p.parsed.motto;
    }
  });

  window.onPacket('UserRemove', p => {
    if (!p.parsed) return;
    delete window.Room.users[p.parsed.index];
  });

  window.onPacket('Objects', p => {
    if (!p.parsed) return;
    p.parsed.items.forEach(f => {
      const fd = window.FurniData.floor[f.typeId];
      if (fd) { f.furniName = fd.name; f.furniDesc = fd.description; f.classname = fd.classname; }
      window.Room.floorItems[f.id] = f;
    });
  });

  window.onPacket('ObjectAdd', p => {
    if (!p.parsed) return;
    const f = p.parsed;
    const fd = window.FurniData.floor[f.typeId];
    if (fd) { f.furniName = fd.name; f.furniDesc = fd.description; f.classname = fd.classname; }
    window.Room.floorItems[f.id] = f;
  });

  // ObjectUpdate (IN): a floor item moved and/or rotated — fires for both. Same per-item
  // field layout as Objects/ObjectAdd (id, typeId, x, y, facing, z, sizeZ, extra,
  // dataTypeRaw, stuff, expires, usagePolicy, ownerId) but with no trailing ownerName —
  // confirmed field-for-field against two real captures (a rotate: facing 2->4 with every
  // other field identical, and a move: x 6->7 with facing/y unchanged), 13 tokens exactly
  // consumed both times with nothing left over.
  window.PacketParsers.IN.ObjectUpdate = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    try {
      const id          = r.int();
      const typeId      = r.int();
      const x           = r.int(); const y = r.int();
      const facing      = r.int();
      const z           = r.str();
      const sizeZ       = r.str();
      const extra       = r.int();
      const dataTypeRaw = r.int();
      const stuff       = parseItemData(r, dataTypeRaw & 0xFF);
      const expires     = r.int();
      const usagePolicy = r.int();
      const ownerId     = r.int();
      return { id, typeId, x, y, z: parseFloat(z), sizeZ, extra, facing, stuff, expires, usagePolicy, ownerId };
    } catch(e) { return null; }
  };
  window.onPacket('ObjectUpdate', p => {
    if (!p.parsed) return;
    const f = p.parsed;
    const existing = window.Room.floorItems[f.id];
    if (existing) { f.furniName = existing.furniName; f.furniDesc = existing.furniDesc; f.classname = existing.classname; f.ownerName = existing.ownerName; }
    window.Room.floorItems[f.id] = f;
  });

  // SlideObjectBundle (IN, id 360 on this hotel — nitro-react's stock protocol uses a
  // different id for the same event name, this hotel renumbers it): MULTIPLE floor items
  // moved/rotated/changed height in one packet, e.g. setting several items to the same
  // height at once, bulk-rotating a selection, or a stack sliding. Decoded from real raw hex
  // captures: count(int), then per item: unknown(int, always seen as 1), oldX(int),
  // oldY(int), newX(int), newY(int), oldZ(str), newZ(str), itemId(int), unknown(int, always
  // seen as 0), facing(int). That last field was first assumed to be a constant (always 2 in
  // an all-height-change capture) until a bulk-rotate capture showed it change (2 -> 0) with
  // every other field identical — confirming it's the item's facing/direction, not a
  // constant. Every field and byte offset verified directly against raw hex across 6 total
  // records (4 height-only + 2 rotate-only), nothing left over in any of them.
  window.PacketParsers.IN.SlideObjectBundle = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    try {
      const count = r.int();
      const items = [];
      for (let i = 0; i < count; i++) {
        r.int(); // unknown, always seen as 1
        const oldX = r.int();
        const oldY = r.int();
        const newX = r.int();
        const newY = r.int();
        r.str(); // oldZ, unused — we only care where the item ends up
        const newZ = r.str();
        const id = r.int();
        r.int(); // unknown, always seen as 0
        const facing = r.int();
        items.push({ id, x: newX, y: newY, z: parseFloat(newZ), facing, oldX, oldY });
      }
      return { items };
    } catch(e) { return null; }
  };
  window.onPacket('SlideObjectBundle', p => {
    if (!p.parsed) return;
    p.parsed.items.forEach(({ id, x, y, z, facing }) => {
      const item = window.Room.floorItems[id];
      if (item) { item.x = x; item.y = y; item.z = z; item.facing = facing; }
    });
  });

  // ObjectDataUpdate (IN): a SINGLE floor item's state changed (e.g. a lamp toggled) — id
  // comes as a string. Confirmed via two real captures toggling one item's state between
  // "0" and "1".
  window.PacketParsers.IN.ObjectDataUpdate = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    try {
      const id    = parseInt(r.str());
      r.int(); // unknown, always seen as 0
      const state = r.str();
      return { id, state };
    } catch(e) { return null; }
  };
  window.onPacket('ObjectDataUpdate', p => {
    if (!p.parsed) return;
    const item = window.Room.floorItems[p.parsed.id];
    if (item) { item.stuff = item.stuff || {}; item.stuff.state = p.parsed.state; }
  });

  // ObjectRemove (IN 2703, already named in pkt.js): a floor item was picked up / removed
  // from the room. Only the item id (a string) is parsed — that's all window.Room needs to
  // drop it, and the handful of trailing bytes after the id in a real capture didn't split
  // evenly into a clean int/bool layout on a single sample, so rather than guess, we simply
  // don't read past the id (per this repo's own "don't guess a byte layout" policy — reading
  // fields we don't actually need would just risk misparsing without any benefit).
  window.PacketParsers.IN.ObjectRemove = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    try {
      const id = parseInt(r.str());
      return { id };
    } catch(e) { return null; }
  };
  window.onPacket('ObjectRemove', p => {
    if (!p.parsed) return;
    delete window.Room.floorItems[p.parsed.id];
  });

  // RoomProperty (IN 2454, already named RoomPropertyMessageEvent in pkt.js): the room's
  // real floor/wallpaper/landscape type — sent as 3 separate packets on room entry, each a
  // {type, value} string pair (type is literally "floor"/"wallpaper"/"landscape", value is
  // the type id as a string, e.g. "103"). Matches @nitrots/nitro-renderer's own
  // RoomPaintParser format exactly. Confirmed via three real captures on room entry.
  window.PacketParsers.IN.RoomProperty = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    try {
      const type = r.str();
      const value = r.str();
      return { type, value };
    } catch(e) { return null; }
  };
  window.onPacket('RoomProperty', p => {
    if (!p.parsed) return;
    if (p.parsed.type === 'floor') window.Room.floorType = p.parsed.value;
    else if (p.parsed.type === 'wallpaper') window.Room.wallType = p.parsed.value;
    else if (p.parsed.type === 'landscape') window.Room.landscapeType = p.parsed.value;
  });

  // ObjectsDataUpdate (IN): MULTIPLE floor items' states changed in one packet (e.g. two
  // items toggled at once) — server batches these rather than sending separate
  // ObjectDataUpdate packets per item. Note the different per-item layout: id here is an
  // int, not a string. Layout ported from ui-colorparty.js's own already-working ad-hoc use
  // of this exact packet for color tiles (count, then per item: id(int), unknown(int),
  // state(str)) — not re-verified against a fresh capture this session, but it's the same
  // parser logic already live in this repo.
  window.PacketParsers.IN.ObjectsDataUpdate = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    try {
      const count = r.int();
      const items = [];
      for (let i = 0; i < count; i++) {
        const id = r.int();
        r.int(); // unknown
        const state = r.str();
        items.push({ id, state });
      }
      return { items };
    } catch(e) { return null; }
  };
  window.onPacket('ObjectsDataUpdate', p => {
    if (!p.parsed) return;
    p.parsed.items.forEach(({ id, state }) => {
      const item = window.Room.floorItems[id];
      if (item) { item.stuff = item.stuff || {}; item.stuff.state = state; }
    });
  });

  window.onPacket('Items', p => {
    if (!p.parsed) return;
    p.parsed.items.forEach(f => {
      const fd = window.FurniData.wall[f.typeId];
      if (fd) { f.furniName = fd.name; f.furniDesc = fd.description; f.classname = fd.classname; }
      window.Room.wallItems[f.id] = f;
    });
  });

  // ItemAdd (IN 2187, already named ItemAddMessageEvent in pkt.js): a single wall item
  // placed live during the session — NOT re-sent via Items (that packet only carries the
  // full/initial room dump). Same per-item layout as Items' inner loop, but exactly one item
  // and no owner table — ownerName is inlined right after ownerId instead of being looked up.
  // Confirmed field-for-field against a real capture: {s:id}{i:typeId}{s:location}{s:state}
  // {i:unknown -1}{i:unknown 0}{i:ownerId}{s:ownerName}, no leftover bytes.
  window.PacketParsers.IN.ItemAdd = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    try {
      const id       = parseInt(r.str());
      const typeId   = r.int();
      const location = r.str();
      const state    = r.str();
      r.int(); r.int(); // unknown, unknown (mirrors Items' discarded expiry/usagePolicy pair)
      const ownerId   = r.int();
      const ownerName = r.str();
      return { id, typeId, location, state, ownerId, ownerName };
    } catch(e) { return null; }
  };
  function onWallItemAddOrUpdate(p) {
    if (!p.parsed) return;
    const f = p.parsed;
    const fd = window.FurniData.wall[f.typeId];
    if (fd) { f.furniName = fd.name; f.furniDesc = fd.description; f.classname = fd.classname; }
    window.Room.wallItems[f.id] = f;
  }
  window.onPacket('ItemAdd', onWallItemAddOrUpdate);

  // ItemUpdate (IN 2009, already named ItemUpdateMessageEvent in pkt.js): fires whenever an
  // existing wall item changes (moved and/or state toggled) — byte-for-byte the same layout
  // as ItemAdd, confirmed against a real capture of the same item (id "11187313") both times:
  // location was unchanged, state string stayed "0", only the second unknown int differed
  // (0 on add, 1 here). Reuses ItemAdd's parser/handler since the wire format is identical.
  window.PacketParsers.IN.ItemUpdate = window.PacketParsers.IN.ItemAdd;
  window.onPacket('ItemUpdate', onWallItemAddOrUpdate);

  // ItemRemove (IN 3208, already named ItemRemoveMessageEvent in pkt.js): a wall item picked
  // up/removed live. Confirmed via real capture, no leftover bytes: {s:id}{i:userId} — the
  // second field matched the known owner id (4106885 / "187alex") from earlier captures.
  window.PacketParsers.IN.ItemRemove = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    try {
      const id = parseInt(r.str());
      const userId = r.int();
      return { id, userId };
    } catch(e) { return null; }
  };
  window.onPacket('ItemRemove', p => {
    if (!p.parsed) return;
    delete window.Room.wallItems[p.parsed.id];
  });

  window._selfName = null;

  // --- Inventory ---

  // dataTypeRaw's low byte is the real category (same 0/1/2/3/5 switch below); bit 0x100
  // is a separate flag meaning "this item also carries a unique edition number/size pair"
  // (limited editions, e.g. "37/100") — same flag convention already confirmed and used
  // for room floor items in the Objects/ObjectAdd parsers above (dataTypeRaw & 0x100).
  // Before this, an LTD item's raw cat (0-255 range plus the 0x100 bit, e.g. 256) fell
  // through the switch's default with no case matching, and — worse — left the two
  // trailing ints unread, misaligning every item after it in the same FurniList packet,
  // which threw on the next item's field reads and silently truncated window.Inventory to
  // whatever had parsed before the LTD item (confirmed byte-exact against a live capture,
  // zero leftover bytes once the flag is handled).
  function parseInventoryStuff(r) {
    const dataTypeRaw = r.int();
    const cat = dataTypeRaw & 0xFF;
    let data = null;
    switch (cat) {
      case 0: data = { state: r.str() }; break;
      case 1: { const c=r.int(); const map={}; for(let i=0;i<c;i++){map[r.str()]=r.str();} data={map}; break; }
      case 2: { const c=r.int(); const arr=[]; for(let i=0;i<c;i++) arr.push(r.str()); data={array:arr}; break; }
      case 3: data = { state: r.str() }; break;
      case 5: { const c=r.int(); const arr=[]; for(let i=0;i<c;i++) arr.push(r.int()); data={intArray:arr}; break; }
      default: data = null; break;
    }
    const result = { category: cat, data };
    if (dataTypeRaw & 0x100) { result.uniqueSerial = r.int(); result.uniqueSerialSize = r.int(); }
    return result;
  }

  function parseInventoryItem(r) {
    const placementId      = r.int();
    const type             = r.str();  // "S"=floor, "I"=wall
    const id               = r.int();
    const typeId           = r.int();
    const specialType      = r.int();
    const stuff            = parseInventoryStuff(r);
    const recyclable       = r.bool();
    const tradeable        = r.bool();
    const groupable        = r.bool();
    const sellable         = r.bool();
    const secondsToExpiration = r.int();
    const rentPeriodStarted   = r.bool();
    const roomId           = r.int();
    let slotId = null, extra = -1;
    if (type === 'S') { slotId = r.str(); extra = r.int(); }
    return { placementId, type, id, typeId, specialType, stuff, recyclable, tradeable, groupable, sellable, secondsToExpiration, rentPeriodStarted, roomId, slotId, extra };
  }

  // FurniListEvent (IN 994): paged full inventory — 2 header ints (totalPages, pageIndex) before itemCount
  window.PacketParsers.IN.FurniList = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    try {
      const totalPages = r.int();
      const pageIndex  = r.int();
      const count      = r.int();
      const items = [];
      for (let i = 0; i < count; i++) {
        try { items.push(parseInventoryItem(r)); }
        catch(e) { console.error('[FurniList item #'+(i+1)+']', e); break; }
      }
      return { totalPages, pageIndex, count: items.length, items };
    } catch(e) { return null; }
  };

  // FurniListAddOrUpdateEvent (IN 104): single item add or update
  window.PacketParsers.IN.FurniListAddOrUpdate = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    try { return parseInventoryItem(r); } catch(e) { return null; }
  };

  // FurniListRemoveEvent (IN 159): item removed from inventory
  window.PacketParsers.IN.FurniListRemove = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    try { return { itemId: r.int() }; } catch(e) { return null; }
  };

  // ItemTagsMessageEvent (IN, custom — see extensions/fun/item-tags.js): sparse list of
  // {itemId, tag} pairs, one entry per tagged inventory item. Not part of the vanilla
  // protocol — sent by a matching custom SetItemTag/ItemTags pair on the server side.
  window.PacketParsers.IN.ItemTags = raw => {
    const r = window.makeReader(raw); if (!r) return null;
    try {
      const count = r.int();
      const tags = [];
      for (let i = 0; i < count; i++) tags.push({ itemId: r.int(), tag: r.str() });
      return { tags };
    } catch(e) { return null; }
  };

  // CatalogPage (IN): uses GPacket + extended adapter for peekType/isEOF/seek
  window.PacketParsers.IN.CatalogPage = function(raw) {
    if (!raw || raw.byteLength <= 6) return null;
    try {
      const pkt = new window.GPacket(raw);
      pkt.isEOF        = () => pkt.offset >= pkt.buffer.byteLength;
      pkt.getReadIndex = () => pkt.offset;
      pkt.setReadIndex = (i) => { pkt.offset = i; };
      pkt.peekType     = () => {
        const rem = pkt.buffer.byteLength - pkt.offset;
        if (rem <= 0) return null;
        if (rem >= 2) {
          const slen = pkt._view.getUint16(pkt.offset);
          if (slen > 0 && slen <= 512 && slen <= rem - 2) {
            let ok = true;
            for (let j = 0; j < Math.min(slen, 8); j++) {
              const c = pkt._view.getUint8(pkt.offset + 2 + j);
              if (c < 32 || c > 126) { ok = false; break; }
            }
            if (ok) return 'string';
          }
        }
        if (rem >= 4) {
          const n = pkt._view.getInt32(pkt.offset);
          if (n < -1000000) return 'hex';
        }
        const b = pkt._view.getUint8(pkt.offset);
        if (b === 0 || b === 1) return 'boolean';
        return 'int';
      };
      pkt.readHex = () => pkt._view.getUint8(pkt.offset++);
      return new CatalogPage(pkt);
    } catch(e) {
      console.error('[CatalogPage parser]', e);
      return null;
    }
  };

  // Inventory state: keyed by furni id
  window.Inventory = { items: {}, totalPages: 0, loaded: false };

  window.onPacket('FurniList', p => {
    if (!p.parsed) return;
    if (p.parsed.pageIndex === 0) { window.Inventory.items = {}; window.Inventory.loaded = false; }
    p.parsed.items.forEach(item => {
      const fd = window.FurniData[item.type === 'S' ? 'floor' : 'wall'][item.typeId];
      if (fd) { item.furniName = fd.name; item.classname = fd.classname; }
      window.Inventory.items[item.id] = item;
    });
    window.Inventory.totalPages = p.parsed.totalPages;
    if (p.parsed.pageIndex >= p.parsed.totalPages - 1) {
      window.Inventory.loaded = true;
      console.log('[Inventory] loaded', Object.keys(window.Inventory.items).length, 'items');
    }
  });

  window.onPacket('FurniListAddOrUpdate', p => {
    if (!p.parsed) return;
    const fd = window.FurniData[p.parsed.type === 'S' ? 'floor' : 'wall'][p.parsed.typeId];
    if (fd) { p.parsed.furniName = fd.name; p.parsed.classname = fd.classname; }
    window.Inventory.items[p.parsed.id] = p.parsed;
  });

  window.onPacket('FurniListRemove', p => {
    if (!p.parsed) return;
    delete window.Inventory.items[p.parsed.itemId];
  });

  // Item tags: kept separate from window.Inventory.items so it doesn't matter which of
  // FurniList/ItemTags arrives first — extensions/fun/item-tags.js reads both and merges.
  window.ItemTags = {};

  window.onPacket('ItemTags', p => {
    if (!p.parsed) return;
    window.ItemTags = {};
    p.parsed.tags.forEach(t => { window.ItemTags[t.itemId] = t.tag; });
  });

  // --- Friends ---

  // Convert raw binary to {i:..}{s:".."}{b:..}{x:..} string for tokenized parsers
  function rawToTokenString(raw, packetName) {
    if (!raw || raw.byteLength <= 6) return '';
    const pay   = raw.slice(6);
    const bytes = new Uint8Array(pay);
    const view  = new DataView(pay);
    let out = '{in:' + packetName + '}';
    let i = 0;
    while (i < bytes.length) {
      const rem = bytes.length - i;
      if (rem >= 2) {
        const slen = view.getUint16(i);
        if (slen > 0 && slen <= rem - 2 && slen <= 4096) {
          const strBytes = new Uint8Array(pay, i + 2, slen);
          let ok = true;
          for (let j = 0; j < Math.min(slen, 8); j++) {
            if (strBytes[j] < 9) { ok = false; break; }
          }
          if (ok) {
            // Latin-1 decode to match G-Earth's byte-by-byte string display
            let str = '';
            for (let j = 0; j < slen; j++) str += String.fromCharCode(strBytes[j]);
            out += '{s:"' + str.replace(/\\/g,'\\\\').replace(/"/g,'\\"') + '"}';
            i += 2 + slen; continue;
          }
        }
      }
      if (rem >= 4) {
        const n = view.getInt32(i);
        // Only consume as int if value fits in "reasonable" Habbo range.
        // Values >= 0x01000000 likely mean a bool byte was read as the high byte of an int.
        if ((n >= 0 && n < 0x01000000) || (n < 0 && n >= -65536)) { out += '{i:' + n + '}'; i += 4; continue; }
      }
      if (bytes[i] === 0 || bytes[i] === 1) { out += '{b:' + (bytes[i] ? 'true' : 'false') + '}'; i++; continue; }
      out += '{x:' + bytes[i].toString(16).padStart(2, '0') + '}'; i++;
    }
    return out;
  }

  class FriendListParser {
    static parse(packet) {
      const tokens = this.tokenize(packet);
      let i = 0;
      const read  = () => tokens[i++];
      const peek  = () => tokens[i];
      const expectInt    = () => { const t = read(); if (!t || t.type !== 'i') throw new Error('Expected int at ' + (i-1) + ', got ' + JSON.stringify(t)); return t.value; };
      const expectString = () => { const t = read(); if (!t || t.type !== 's') throw new Error('Expected string at ' + (i-1) + ', got ' + JSON.stringify(t)); return t.value; };
      const expectBool   = () => { const t = read(); if (!t || t.type !== 'b') throw new Error('Expected bool at ' + (i-1) + ', got ' + JSON.stringify(t)); return t.value; };

      if (peek()?.type === 'in') read();

      const categoryCount = expectInt();
      for (let c = 0; c < categoryCount; c++) { expectInt(); expectString(); }

      const friendCount = expectInt();
      const friends = [];

      for (let f = 0; f < friendCount; f++) {
        try {
          const friend = {};
          friend.id              = expectInt();
          friend.name            = expectString();
          friend.gender          = expectInt();
          friend.online           = peek()?.type === 'b' ? expectBool() : expectInt() === 1;
          friend.followingAllowed = peek()?.type === 'b' ? expectBool() : expectInt() === 1;
          friend.motto           = peek()?.type === 's' ? expectString() : '';
          friend.categoryId      = expectInt();
          friend.figureColor     = expectInt();
          friend.figure          = peek()?.type === 's' ? expectString() : this.readBrokenFigure(tokens, () => peek(), () => read());
          friend.realName        = peek()?.type === 's' ? expectString() : '';
          friends.push(friend);
        } catch(err) {
          console.error('[FriendListParser] friend', f, err.message);
          break;
        }
      }

      let fragmentEnded = false;
      if (peek()?.type === 'b') fragmentEnded = expectBool();

      return { categoryCount, friendCount, friends, fragmentEnded };
    }

    static readBrokenFigure(tokens, peek, read) {
      const parts = [];
      while (peek()) {
        const t = peek();
        if (t.type === 'i' && tokens[tokens.indexOf(t) + 1]?.type === 's') break;
        if (t.type === 'b') break;
        parts.push(read().value);
      }
      return parts.join(' ');
    }

    static tokenize(str) {
      const regex = /\{(i|s|b|x|in):([^}]*)\}/g;
      const toks  = [];
      let m;
      while ((m = regex.exec(str)) !== null) {
        const type = m[1];
        let value  = m[2];
        if (type === 'i') value = parseInt(value, 10);
        else if (type === 'b') value = value === 'true';
        else if (type === 'x') value = parseInt(value, 16);
        toks.push({ type, value });
      }
      return toks;
    }
  }

  // FriendListFragment (IN): tokenized parser — converts binary → token string, then parses
  window.PacketParsers.IN.FriendListFragment = function(raw) {
    const str = rawToTokenString(raw, 'FriendListFragment');
    if (!str) return null;
    try { return FriendListParser.parse(str); }
    catch(e) { console.error('[FriendListFragment]', e); return null; }
  };

  // Friend state: keyed by user id
  window.Friends = { friends: {} };

  window.onPacket('FriendListFragment', p => {
    if (!p.parsed) return;
    p.parsed.friends.forEach(f => { window.Friends.friends[f.id] = f; });
    console.log('[Friends] fragment', p.parsed.fragmentIndex, '/', p.parsed.totalFragments,
      '—', Object.keys(window.Friends.friends).length, 'friends total');
  });

})();
