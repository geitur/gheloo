var SUPABASE_URL = 'https://qwcfsqsrtegyvvwkzcgb.supabase.co';
var SUPABASE_KEY = 'sb_publishable_mi9rS5i9a-xrAWC0lG0TNA_vg903xRL';

var _all = [];
var _ft = 'all', _fg = 'all';
var _selId = null;
var _usersLoaded = false;
var _currentPage = null;
var _pendingPatches = 0;
var _holderTrades = {};
var _holdersLoaded = false;
var _pendingHolder = null;
var _allTrades = [];
var _tradesSort = 'desc';
var _tradesQ = '';
var _allRequests = [];
var _reqPollInterval = null;
var _selectedTrades = new Set();
var _expandedBundles = {};
var _tradeFilter = 'all';

function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function ts(s){
  if (!s) return '—';
  var d = new Date(s);
  return d.toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'})
       + ' ' + d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
}

function relTs(s){
  if (!s) return '—';
  var d = new Date(s);
  var full = ts(s);
  var diff = (Date.now() - d.getTime()) / 1000;
  var rel;
  if (diff < 60) rel = 'just now';
  else if (diff < 3600) rel = Math.floor(diff/60)+'m ago';
  else if (diff < 86400) rel = Math.floor(diff/3600)+'h ago';
  else if (diff < 604800) rel = Math.floor(diff/86400)+'d ago';
  else if (diff < 2592000) rel = Math.floor(diff/604800)+'w ago';
  else rel = d.toLocaleDateString(undefined,{day:'2-digit',month:'short'});
  return '<span title="'+esc(full)+'">'+rel+'</span>';
}

function typeLabel(t){ return t===1?'Leet':t===2?'Bot':t===4?'Pet':'?'; }
function typeBadgeCls(t){ return t===2?'urow-badge bot':t===4?'urow-badge pet':'urow-badge'; }

function avatarSmall(figure){
  return 'https://www.leet.city/leet-imaging/avatarimage'
    +'?figure='+encodeURIComponent(figure||'')
    +'&direction=3&head_direction=3&size=s&gesture=std&img_format=png';
}
function avatarLarge(figure){
  return 'https://www.leet.city/leet-imaging/avatarimage'
    +'?figure='+encodeURIComponent(figure||'')
    +'&direction=3&head_direction=3&size=l&gesture=std&img_format=png';
}
function avatarHead(figure){
  return 'https://www.leet.city/leet-imaging/avatarimage'
    +'?figure='+encodeURIComponent(figure||'')
    +'&direction=2&head_direction=3&size=m&gesture=sml&headonly=1&action=wav&img_format=png';
}
function avatarMini(figure){
  return 'https://www.leet.city/leet-imaging/avatarimage'
    +'?figure='+encodeURIComponent(figure||'')
    +'&direction=3&head_direction=3&size=l&gesture=std&img_format=png';
}

function toLocalInput(iso) {
  var d = new Date(iso);
  var p = function(n){ return (n<10?'0':'')+n; };
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes());
}
function fmtPbTime(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  return d.toLocaleDateString(undefined,{day:'2-digit',month:'short'})
       + ' ' + d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
}
function localNowInput() {
  return toLocalInput(new Date().toISOString());
}

function showPage(name) {
  var prev = _currentPage;
  _currentPage = name;
  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
  document.querySelectorAll('.nav-item').forEach(function(a){
    a.classList.toggle('active', a.dataset.page === name);
  });
  var page = document.getElementById('page-' + name);
  if (page) page.classList.add('active');
  if (name === 'dashboard') loadDashboard();
  if (name === 'users' && !_usersLoaded) loadUsers();
  if (name === 'trades' && prev !== 'trades') loadTrades();
  if (name === 'holders' && !_holdersLoaded) loadHolders();
  else if (name === 'holders' && _pendingHolder) { showHolder(_pendingHolder); _pendingHolder = null; }
}

async function loadDashboard() {
  document.getElementById('stat-users').textContent = '…';
  document.getElementById('stat-trades').textContent = '…';
  document.getElementById('stat-scammed').textContent = '…';

  try {
    var ur = await fetch(SUPABASE_URL+'/rest/v1/users?select=id&limit=1', {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer '+SUPABASE_KEY,
        'Prefer': 'count=exact',
        'Range-Unit': 'items',
        'Range': '0-0'
      }
    });
    var cr = ur.headers.get('Content-Range');
    if (cr) {
      document.getElementById('stat-users').textContent = Number(cr.split('/')[1]).toLocaleString();
    }
  } catch(e) {
    document.getElementById('stat-users').textContent = '?';
  }

  try {
    var tr = await fetch(
      SUPABASE_URL+'/rest/v1/trades?select=*&order=executed_at.desc&limit=100',
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer '+SUPABASE_KEY } }
    );
    if (!tr.ok) throw new Error();
    var trades = await tr.json();
    var scammedCount = trades.filter(function(t){ return t.scammed && t.scammed.trim(); }).length;
    document.getElementById('stat-trades').textContent = trades.length + (trades.length === 100 ? '+' : '');
    document.getElementById('stat-scammed').textContent = scammedCount;
  } catch(e) {
    document.getElementById('stat-trades').textContent = '?';
    document.getElementById('stat-scammed').textContent = '?';
  }
}

async function loadUsers(){
  document.getElementById('count-bar').textContent = 'Loading…';
  document.getElementById('user-list').innerHTML = '';
  try {
    var res = await fetch(
      SUPABASE_URL+'/rest/v1/users?select=*&order=last_seen.desc&limit=2000',
      { headers:{ 'apikey':SUPABASE_KEY, 'Authorization':'Bearer '+SUPABASE_KEY } }
    );
    if (!res.ok) throw new Error('HTTP '+res.status);
    _all = await res.json();
    _usersLoaded = true;
    document.getElementById('users-sub').textContent = _all.length.toLocaleString()+' users in database';
    applyFilters();
  } catch(e) {
    document.getElementById('count-bar').textContent = 'Error: '+e.message;
    document.getElementById('users-sub').textContent = 'Failed to load';
  }
}

function setFilter(key, val){
  if (key==='ft'){
    _ft = val;
    document.querySelectorAll('[data-ft]').forEach(function(b){ b.classList.toggle('active', b.dataset.ft===val); });
  } else {
    _fg = val;
    document.querySelectorAll('[data-fg]').forEach(function(b){ b.classList.toggle('active', b.dataset.fg===val); });
  }
  applyFilters();
}

function applyFilters(){
  var q = (document.getElementById('searchbox').value||'').toLowerCase().trim();
  var list = _all.filter(function(u){
    if (_ft!=='all' && String(u.type)!==_ft) return false;
    if (_fg!=='all' && (u.gender||'').toUpperCase()!==_fg) return false;
    if (q){
      var hay = ((u.name||'')+' '+(u.motto||'')+' '+u.id+' '+(u.favorite_group||'')).toLowerCase();
      if (hay.indexOf(q)<0) return false;
    }
    return true;
  });
  renderList(list);
}

function renderList(users){
  var countBar = document.getElementById('count-bar');
  countBar.textContent = users.length+' user'+(users.length!==1?'s':'')
    + (_all.length!==users.length?' of '+_all.length:'');

  var el = document.getElementById('user-list');
  if (!users.length){
    el.innerHTML = '<div class="empty-state">No users found.</div>';
    return;
  }

  el.innerHTML = users.map(function(u){
    var hasAv = (u.type===1||u.type===2) && u.figure;
    var selCls = (_selId===u.id)?' sel':'';
    var mottoText = u.motto ? esc(u.motto) : (u.favorite_group ? esc(u.favorite_group) : '');
    return '<div class="urow'+selCls+'" data-uid="'+u.id+'">'
      +'<div class="urow-avatar">'
      +(hasAv
        ? '<img src="'+esc(avatarHead(u.figure))+'" loading="lazy" onerror="this.style.opacity=\'.2\'">'
        : '<span class="no-av">'+(u.type===4?'🐾':'👤')+'</span>')
      +'</div>'
      +'<div class="urow-info">'
      +'<div class="urow-name">'+esc(u.name)+'</div>'
      +(mottoText?'<div class="urow-sub">'+mottoText+'</div>':'')
      +'</div>'
      +'<span class="'+typeBadgeCls(u.type)+'">'+typeLabel(u.type)+'</span>'
      +'</div>';
  }).join('');

  el.querySelectorAll('.urow').forEach(function(row){
    row.addEventListener('click', function(){ showUser(Number(row.dataset.uid)); });
  });
}

function showUser(id){
  var u = _all.find(function(x){ return x.id===id; });
  if (!u) return;
  _selId = id;

  document.querySelectorAll('.urow').forEach(function(r){
    r.classList.toggle('sel', Number(r.dataset.uid)===id);
  });

  document.getElementById('detail-empty').style.display = 'none';
  var card = document.getElementById('detail-card');
  card.style.display = 'block';

  var avEl = document.getElementById('dc-avatar');
  var hasAv = (u.type===1||u.type===2) && u.figure;
  avEl.innerHTML = hasAv
    ? '<img src="'+esc(avatarLarge(u.figure))+'" onerror="this.style.opacity=\'.1\'" title="Click to wear this outfit">'
    : '<span class="no-av">'+(u.type===4?'🐾':'👤')+'</span>';
  if (avEl._figHandler) avEl.removeEventListener('click', avEl._figHandler);
  if (hasAv) {
    avEl._figHandler = function() { applyFigure(u.figure, u.gender); };
    avEl.classList.add('outfit-clickable');
    avEl.addEventListener('click', avEl._figHandler);
  } else {
    avEl._figHandler = null;
    avEl.classList.remove('outfit-clickable');
  }

  document.getElementById('dc-name').textContent = u.name || '—';
  document.getElementById('dc-motto').textContent = u.motto || '';
  document.getElementById('dc-motto').style.display = u.motto ? '' : 'none';

  var badges = '';
  badges += '<span class="dc-badge">'+typeLabel(u.type)+'</span>';
  if (u.gender) badges += '<span class="dc-badge">'+(u.gender.toUpperCase()==='M'?'♂ Male':'♀ Female')+'</span>';
  if (u.achievement_score) badges += '<span class="dc-badge">★ '+u.achievement_score+'</span>';
  document.getElementById('dc-badges').innerHTML = badges;

  var body = '';
  body += '<div class="dc-section"><div class="dc-section-title">Info</div><div class="dc-rows">';
  body += row('ID', '#'+u.id);
  body += row('Type', typeLabel(u.type));
  if (u.gender) body += row('Gender', u.gender.toUpperCase()==='M'?'Male':'Female');
  if (u.favorite_group) body += row('Group', esc(u.favorite_group));
  if (u.last_room_id) body += row('Last room', '#'+u.last_room_id);
  body += row('Last seen', ts(u.last_seen));
  body += '</div></div>';

  var prevNames = u.previous_names || [];
  if (prevNames.length){
    body += '<div class="dc-section"><div class="dc-section-title">Previous names</div>';
    body += '<div class="dc-tags">';
    prevNames.slice().reverse().forEach(function(n){ body += '<span class="dc-tag">'+esc(n)+'</span>'; });
    body += '</div></div>';
  }

  var prevFigs = u.previous_figures || [];
  if (prevFigs.length && hasAv){
    body += '<div class="dc-section"><div class="dc-section-title">Previous outfits</div>';
    body += '<div class="dc-outfits">';
    prevFigs.slice().reverse().forEach(function(fig){
      body += '<img src="'+esc(avatarMini(fig))+'" data-fig="'+esc(fig)+'" title="Click to wear this outfit" class="outfit-clickable" loading="lazy" onerror="this.style.opacity=\'.1\'">';
    });
    body += '</div></div>';
  }

  if (u.figure){
    body += '<div class="dc-section"><div class="dc-section-title">Figure code</div>';
    body += '<div class="fig-copy" id="fig-copy">'+esc(u.figure)+'</div></div>';
  }

  document.getElementById('dc-body').innerHTML = body;

  var figEl = document.getElementById('fig-copy');
  if (figEl){
    figEl.addEventListener('click', function(){
      navigator.clipboard.writeText(u.figure).then(function(){
        figEl.style.borderColor='#4a90d9';
        setTimeout(function(){ figEl.style.borderColor=''; }, 1500);
      }).catch(function(){});
    });
  }

  document.querySelectorAll('.dc-outfits img[data-fig]').forEach(function(img) {
    img.addEventListener('click', function() { applyFigure(img.dataset.fig, u.gender); });
  });
}

function row(label, value){
  return '<div class="dc-row"><span class="dc-row-label">'+label+'</span><span class="dc-row-value">'+value+'</span></div>';
}

function applyFigure(figure, gender) {
  if (!figure) return;
  var g = (gender || 'M').toUpperCase();
  chrome.tabs.query({ url: 'https://www.leet.city/*' }, function(tabs) {
    if (!tabs || tabs.length === 0) return;
    if (tabs.length === 1) {
      chrome.runtime.sendMessage({ type: 'apply_figure_to_tab', tabId: tabs[0].id, figure: figure, gender: g });
    } else {
      showTabPicker(tabs, figure, g);
    }
  });
}

function showTabPicker(tabs, figure, gender) {
  var overlay = document.getElementById('tab-picker-overlay');
  var list = document.getElementById('tab-picker-list');
  list.innerHTML = tabs.map(function(tab) {
    var name = tab.title.replace('Leet Hotel | ', '') || tab.title;
    return '<button class="tab-pick-btn" data-tabid="'+tab.id+'">'+esc(name)+'</button>';
  }).join('');
  list.querySelectorAll('.tab-pick-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      chrome.runtime.sendMessage({ type: 'apply_figure_to_tab', tabId: Number(btn.dataset.tabid), figure: figure, gender: gender });
      overlay.classList.remove('open');
    });
  });
  overlay.classList.add('open');
}

async function deleteUser(id) {
  if (!confirm('Delete user #'+id+'?\nThis cannot be undone.')) return;
  try {
    var res = await fetch(SUPABASE_URL+'/rest/v1/users?id=eq.'+id, {
      method: 'DELETE',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer '+SUPABASE_KEY, 'Prefer': 'return=minimal' }
    });
    if (!res.ok) throw new Error('HTTP '+res.status);
    _all = _all.filter(function(u){ return u.id !== id; });
    _selId = null;
    document.getElementById('detail-card').style.display = 'none';
    document.getElementById('detail-empty').style.display = '';
    document.getElementById('users-sub').textContent = _all.length.toLocaleString()+' users in database';
    applyFilters();
  } catch(e) {
    alert('Delete failed: '+e.message);
  }
}

async function deleteTrade(id) {
  if (!confirm('Delete this trade?\nThis cannot be undone.')) return;
  try {
    var res = await fetch(SUPABASE_URL+'/rest/v1/trades?id=eq.'+id, {
      method: 'DELETE',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer '+SUPABASE_KEY, 'Prefer': 'return=minimal' }
    });
    if (!res.ok) throw new Error('HTTP '+res.status);
    _allTrades = _allTrades.filter(function(t){ return String(t.id) !== String(id); });
    updateTradesStats();
    renderTradesFiltered();
    _showSaveBar(true);
  } catch(e) {
    alert('Delete failed: '+e.message);
  }
}

function _showSaveBar(ok, msg) {
  var el = document.getElementById('trade-save-bar');
  if (!el) return;
  el.textContent = ok ? '✓ Opgeslagen' : '✗ ' + msg;
  el.style.cssText = 'display:block;padding:6px 16px;font-size:11px;font-weight:700;'
    + (ok ? 'background:#f0fdf4;color:#10b981;border-bottom:1px solid #bbf7d0'
          : 'background:#fef2f2;color:#ef4444;border-bottom:1px solid #fecaca');
  clearTimeout(el._t);
  el._t = setTimeout(function(){ el.style.display = 'none'; }, 4000);
}

function saveTradePatch(id, field, value, inputEl) {
  if (!id || id === 'undefined') {
    _showSaveBar(false, 'Geen row-id — trade heeft geen id kolom?');
    inputEl.classList.add('error');
    setTimeout(function(){ inputEl.classList.remove('error'); }, 1500);
    return;
  }
  var body = {};
  body[field] = (value === '' ? null : value);
  _pendingPatches++;
  fetch(SUPABASE_URL+'/rest/v1/trades?id=eq.'+id, {
    method: 'PATCH',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer '+SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify(body)
  }).then(function(r) {
    _pendingPatches--;
    if (r.ok) {
      _showSaveBar(true);
      inputEl.classList.add('saved');
      setTimeout(function(){ inputEl.classList.remove('saved'); }, 1500);
    } else {
      r.text().then(function(t){
        _showSaveBar(false, r.status + ' — ' + t.slice(0, 120));
      });
      inputEl.classList.add('error');
      setTimeout(function(){ inputEl.classList.remove('error'); }, 1500);
    }
  }).catch(function(e) {
    _pendingPatches--;
    _showSaveBar(false, 'Fetch mislukt: ' + e.message);
    inputEl.classList.add('error');
    setTimeout(function(){ inputEl.classList.remove('error'); }, 1500);
  });
}

function updateTradesStats() {
  var t = _allTrades;

  // Group bundles: each unique bundle_id counts as 1 trade unit
  var bundles = {};
  t.forEach(function(x){ if (x.bundle_id) { if (!bundles[x.bundle_id]) bundles[x.bundle_id] = []; bundles[x.bundle_id].push(x); } });
  var standalone = t.filter(function(x){ return !x.bundle_id; });
  var bundleGroups = Object.values(bundles);
  var effectiveTotal = standalone.length + bundleGroups.length;

  var scammed = new Set(t.filter(function(x){ return x.scammed && x.scammed.trim(); }).map(function(x){ return x.scammed.trim().toLowerCase(); })).size;
  var withItems = t.filter(function(x){ return !x.pull_back; }).length;
  var pullbacks = t.filter(function(x){ return x.pull_back === true; }).length;

  var itemCounts = {};
  t.forEach(function(x){ if (x.item_name && x.item_name.trim() && !x.pull_back) itemCounts[x.item_name] = (itemCounts[x.item_name]||0)+1; });

  var ssActive = t.filter(function(x){ return /\(SS\)/i.test(x.item_name||'') && !x.pull_back; }).length;
  var ssRecovered = t.filter(function(x){ return /\(SS\)/i.test(x.item_name||'') && x.pull_back === true && x.count_in_total !== false; }).length;
  var ssTotal = ssActive + ssRecovered;

  document.getElementById('tstat-total').textContent        = effectiveTotal;
  document.getElementById('tstat-scammed').textContent      = scammed;
  document.getElementById('tstat-ss').textContent           = ssTotal;
  document.getElementById('tstat-items').textContent        = withItems;
  document.getElementById('tstat-pullback').textContent     = pullbacks;
  document.getElementById('tstat-nopullback').textContent   = t.length - pullbacks;

  renderSSPullBack(t);
  renderSSNotPullBack(t);

  var sorted = Object.entries(itemCounts).sort(function(a,b){ return b[1]-a[1]; });
  document.getElementById('trades-items-wrap').innerHTML = sorted.map(function(e){
    return '<span class="item-pill" data-item="'+esc(e[0])+'">'+esc(e[0])+'<span class="item-pill-count">'+e[1]+'</span></span>';
  }).join('');
}

function renderSSPullBack(t) {
  var ss = t.filter(function(x){ return /\(SS\)/i.test(x.item_name||'') && x.pull_back === true; });
  ss = ss.slice().sort(function(a,b){ return new Date(b.executed_at)-new Date(a.executed_at); });
  document.getElementById('ss-pb-count').textContent = ss.length;
  var tbody = document.getElementById('ss-pb-body');
  if (!tbody) return;
  if (!ss.length) { tbody.innerHTML = '<tr><td colspan="7" style="padding:12px;color:#64748b">No pulled back SS.</td></tr>'; return; }
  tbody.innerHTML = ss.map(function(x){
    var checked = x.count_in_total !== false;
    return '<tr>'
      +'<td style="color:#64748b">'+ts(x.executed_at)+'</td>'
      +'<td style="font-weight:600">'+esc(x.item_name||'—')+'</td>'
      +'<td>'+(x.seller?'<button class="seller-link" data-seller="'+esc(x.seller)+'">'+esc(x.seller)+'</button>':'—')+'</td>'
      +'<td>'+esc(x.scammed||'—')+'</td>'
      +'<td>'+(x.price!=null?x.price:'—')+'</td>'
      +'<td><input class="trade-input" data-field="traded_for" data-ssid="'+x.id+'" type="text" value="'+esc(x.traded_for||'')+'" placeholder="—" style="min-width:80px"></td>'
      +'<td style="text-align:center"><input type="checkbox" class="ss-cit-cb" data-ssid="'+x.id+'"'+(checked?' checked':'')+' title="Count in Total SS"></td>'
      +'</tr>';
  }).join('');
  tbody.querySelectorAll('.ss-cit-cb').forEach(function(cb) {
    cb.addEventListener('change', function() {
      var id = cb.dataset.ssid;
      fetch(SUPABASE_URL+'/rest/v1/trades?id=eq.'+id, {
        method: 'PATCH',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer '+SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ count_in_total: cb.checked })
      }).then(function() {
        var trade = _allTrades.find(function(t){ return String(t.id) === String(id); });
        if (trade) { trade.count_in_total = cb.checked; updateTradesStats(); }
      });
    });
  });
  tbody.querySelectorAll('.trade-input[data-ssid]').forEach(function(inp) {
    inp.addEventListener('blur', function() {
      saveTradePatch(inp.dataset.ssid, inp.dataset.field, inp.value.trim(), inp);
    });
  });
}

function renderSSNotPullBack(t) {
  var ss = t.filter(function(x){ return /\(SS\)/i.test(x.item_name||'') && !x.pull_back; });
  ss = ss.slice().sort(function(a,b){ return new Date(b.executed_at)-new Date(a.executed_at); });
  document.getElementById('ss-npb-count').textContent = ss.length;
  var tbody = document.getElementById('ss-npb-body');
  if (!tbody) return;
  if (!ss.length) { tbody.innerHTML = '<tr><td colspan="6" style="padding:12px;color:#64748b">No outstanding SS.</td></tr>'; return; }
  tbody.innerHTML = ss.map(function(x){
    return '<tr>'
      +'<td style="color:#64748b">'+ts(x.executed_at)+'</td>'
      +'<td style="font-weight:600">'+esc(x.item_name||'—')+'</td>'
      +'<td>'+(x.seller?'<button class="seller-link" data-seller="'+esc(x.seller)+'">'+esc(x.seller)+'</button>':'—')+'</td>'
      +'<td>'+esc(x.scammed||'—')+'</td>'
      +'<td>'+(x.price!=null?x.price:'—')+'</td>'
      +'<td><input class="trade-input" data-field="traded_for" data-ssid="'+x.id+'" type="text" value="'+esc(x.traded_for||'')+'" placeholder="—" style="min-width:80px"></td>'
      +'</tr>';
  }).join('');
  tbody.querySelectorAll('.trade-input[data-ssid]').forEach(function(inp) {
    inp.addEventListener('blur', function() {
      saveTradePatch(inp.dataset.ssid, inp.dataset.field, inp.value.trim(), inp);
    });
  });
}

var _manualEntries = [];

async function loadManualEntries() {
  try {
    var res = await fetch(SUPABASE_URL+'/rest/v1/manual_entries?select=*&order=created_at.desc', {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer '+SUPABASE_KEY }
    });
    if (res.ok) { _manualEntries = await res.json(); renderManualEntries(); }
  } catch(e) {}
}

function renderManualEntries() {
  var el = document.getElementById('manual-entries-list');
  if (!el) return;
  if (!_manualEntries.length) { el.innerHTML = '<div style="font-size:11px;color:#94a3b8;padding:2px 0">No entries yet.</div>'; return; }
  el.innerHTML = _manualEntries.map(function(e){
    return '<div class="me-row" data-meid="'+e.id+'">'
      +'<span class="me-name">'+esc(e.name)+'</span>'
      +'<span class="me-notes">'+esc(e.notes||'')+'</span>'
      +'<button class="del-btn me-del-btn" data-meid="'+e.id+'" title="Delete" style="flex-shrink:0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>'
      +'</div>';
  }).join('');
  el.querySelectorAll('.me-del-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { deleteManualEntry(btn.dataset.meid); });
  });
}

async function addManualEntry() {
  var nameEl = document.getElementById('manual-entry-input');
  var notesEl = document.getElementById('manual-entry-notes');
  var name = nameEl.value.trim();
  if (!name) return;
  var res = await fetch(SUPABASE_URL+'/rest/v1/manual_entries', {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer '+SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify({ name: name, notes: notesEl.value.trim() || null })
  });
  if (res.ok) {
    var rows = await res.json();
    _manualEntries.unshift(rows[0]);
    renderManualEntries();
    nameEl.value = '';
    notesEl.value = '';
  }
}

async function deleteManualEntry(id) {
  await fetch(SUPABASE_URL+'/rest/v1/manual_entries?id=eq.'+id, {
    method: 'DELETE',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer '+SUPABASE_KEY, 'Prefer': 'return=minimal' }
  });
  _manualEntries = _manualEntries.filter(function(e){ return String(e.id) !== String(id); });
  renderManualEntries();
}

function showScammedDetail() {
  var scammedMap = {};
  _allTrades.forEach(function(t){
    if (t.scammed && t.scammed.trim()) {
      var key = t.scammed.trim().toLowerCase();
      if (!scammedMap[key]) scammedMap[key] = { name: t.scammed.trim(), count: 0 };
      scammedMap[key].count++;
    }
  });
  var list = Object.values(scammedMap).sort(function(a,b){ return b.count-a.count; });
  var body = document.getElementById('scammed-detail-body');
  body.innerHTML = list.length
    ? list.map(function(u){
        return '<div class="sdm-row"><span class="sdm-name">'+esc(u.name)+'</span><span class="sdm-count">'+u.count+'×</span></div>';
      }).join('')
    : '<div style="padding:12px 0;color:#64748b;font-size:12px">No scammed users.</div>';
  document.getElementById('scammed-detail-overlay').classList.add('open');
  document.getElementById('scammed-detail-modal').classList.add('open');
}

function showItemHolders(itemName) {
  var trades = _allTrades.filter(function(t){ return t.item_name === itemName && !t.pull_back; });
  var holderCounts = {};
  trades.forEach(function(t){ var n = t.seller||'—'; holderCounts[n] = (holderCounts[n]||0)+1; });
  var holders = Object.keys(holderCounts).sort(function(a,b){ return holderCounts[b]-holderCounts[a]; });

  document.getElementById('item-holders-modal-title').textContent = itemName;
  document.getElementById('item-holders-modal-body').innerHTML = holders.length
    ? holders.map(function(n){
        return '<div class="ihm-row">'
          +'<span class="ihm-name" data-hname="'+esc(n)+'">'+esc(n)+'</span>'
          +'<span style="color:#64748b;font-size:11px">'+holderCounts[n]+' item'+(holderCounts[n]!==1?'s':'')+'</span>'
          +'</div>';
      }).join('')
    : '<div style="padding:12px 0;color:#64748b;font-size:12px">No holders found.</div>';

  document.getElementById('item-holders-modal-body').querySelectorAll('.ihm-name').forEach(function(el) {
    el.addEventListener('click', function() {
      _closeItemHoldersModal();
      goToHolder(el.dataset.hname);
    });
  });

  document.getElementById('item-holders-overlay').classList.add('open');
  document.getElementById('item-holders-modal').classList.add('open');
}

function _closeItemHoldersModal() {
  document.getElementById('item-holders-overlay').classList.remove('open');
  document.getElementById('item-holders-modal').classList.remove('open');
}

function _updateReqBadge() {
  var badge = document.getElementById('req-badge');
  if (!badge) return;
  var n = _allRequests.length;
  badge.textContent = n;
  badge.style.display = n > 0 ? '' : 'none';
}

async function loadRequests() {
  var sub = document.getElementById('requests-sub');
  if (sub) sub.textContent = 'Loading…';
  try {
    var res = await fetch(
      SUPABASE_URL+'/rest/v1/pending_trades?select=*&order=created_at.desc',
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer '+SUPABASE_KEY } }
    );
    if (!res.ok) throw new Error('HTTP '+res.status);
    _allRequests = await res.json();
    if (sub) sub.textContent = _allRequests.length+' pending';
    _updateReqBadge();
    renderRequests();
  } catch(e) {
    if (sub) sub.textContent = 'Error: '+e.message;
  }
}

function renderRequests() {
  var tbody = document.getElementById('requests-body');
  if (!tbody) return;
  if (!_allRequests.length) {
    tbody.innerHTML = '<tr class="state-row"><td colspan="5">No pending requests.</td></tr>';
    return;
  }
  tbody.innerHTML = _allRequests.map(function(r) {
    return '<tr data-rid="'+r.id+'">'
      +'<td class="col-time">'+ts(r.created_at)+'</td>'
      +'<td class="col-name">'+esc(r.item_name||'—')+'</td>'
      +'<td class="col-seller">'+esc(r.seller||'—')+'</td>'
      +'<td class="col-price">'+(r.price!=null?r.price:'—')+'</td>'
      +'<td style="display:flex;gap:6px;align-items:center">'
        +'<button class="btn btn-primary req-accept" data-rid="'+r.id+'" style="font-size:11px;padding:4px 12px">Accept</button>'
        +'<button class="btn req-decline" data-rid="'+r.id+'" style="font-size:11px;padding:4px 12px;background:#ef4444;color:#fff">Decline</button>'
      +'</td>'
      +'</tr>';
  }).join('');

  tbody.querySelectorAll('.req-accept').forEach(function(btn) {
    btn.addEventListener('click', function() { acceptRequest(Number(btn.dataset.rid)); });
  });
  tbody.querySelectorAll('.req-decline').forEach(function(btn) {
    btn.addEventListener('click', function() { declineRequest(Number(btn.dataset.rid)); });
  });
}

async function acceptRequest(id) {
  var req = _allRequests.find(function(r){ return r.id === id; });
  if (!req) return;
  var row = document.querySelector('tr[data-rid="'+id+'"]');
  if (row) row.style.opacity = '0.5';

  var ins = await fetch(SUPABASE_URL+'/rest/v1/trades', {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer '+SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ offer_id: req.offer_id, item_name: req.item_name, seller: req.seller, price: req.price })
  });
  if (!ins.ok) { if (row) row.style.opacity = ''; _showSaveBar(false, 'Insert mislukt'); return; }

  await fetch(SUPABASE_URL+'/rest/v1/pending_trades?id=eq.'+id, {
    method: 'DELETE',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer '+SUPABASE_KEY, 'Prefer': 'return=minimal' }
  });

  _allRequests = _allRequests.filter(function(r){ return r.id !== id; });
  _updateReqBadge();
  renderRequests();
  _showSaveBar(true);
  loadTrades();
}

async function declineAllRequests() {
  if (!_allRequests.length) return;
  if (!confirm('Decline all ' + _allRequests.length + ' requests?')) return;
  var ids = _allRequests.map(function(r){ return r.id; });
  await fetch(SUPABASE_URL+'/rest/v1/pending_trades?id=in.('+ids.join(',')+')', {
    method: 'DELETE',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer '+SUPABASE_KEY, 'Prefer': 'return=minimal' }
  });
  _allRequests = [];
  _updateReqBadge();
  renderRequests();
}

async function declineRequest(id) {
  var row = document.querySelector('tr[data-rid="'+id+'"]');
  if (row) row.style.opacity = '0.5';

  await fetch(SUPABASE_URL+'/rest/v1/pending_trades?id=eq.'+id, {
    method: 'DELETE',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer '+SUPABASE_KEY, 'Prefer': 'return=minimal' }
  });

  _allRequests = _allRequests.filter(function(r){ return r.id !== id; });
  _updateReqBadge();
  renderRequests();
}

function _genBundleId() {
  return 'bnd_' + Math.random().toString(36).slice(2, 10);
}

function _updateBundleBar() {
  var bar = document.getElementById('bundle-bar');
  if (!bar) return;
  var n = _selectedTrades.size;
  document.getElementById('bundle-count').textContent = n + ' selected';
  if (n >= 2) bar.classList.add('show'); else bar.classList.remove('show');
}

async function createBundle() {
  var ids = Array.from(_selectedTrades);
  if (ids.length < 2) return;
  var bid = _genBundleId();
  for (var i = 0; i < ids.length; i++) {
    await fetch(SUPABASE_URL+'/rest/v1/trades?id=eq.'+ids[i], {
      method: 'PATCH',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer '+SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ bundle_id: bid })
    });
    var t = _allTrades.find(function(x){ return String(x.id) === String(ids[i]); });
    if (t) t.bundle_id = bid;
  }
  _expandedBundles[bid] = true;
  _selectedTrades.clear();
  _updateBundleBar();
  renderTradesFiltered();
  _showSaveBar(true);
}

async function unbundle(bid) {
  var trades = _allTrades.filter(function(t){ return t.bundle_id === bid; });
  for (var i = 0; i < trades.length; i++) {
    await fetch(SUPABASE_URL+'/rest/v1/trades?id=eq.'+trades[i].id, {
      method: 'PATCH',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer '+SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ bundle_id: null })
    });
    trades[i].bundle_id = null;
  }
  renderTradesFiltered();
  _showSaveBar(true);
}

function _tradeRowHtml(t, isChild, trashIcon) {
  var isPb = t.pull_back === true;
  var isSel = _selectedTrades.has(String(t.id));
  var cls = isChild ? ['bundle-child'] : ['row-selectable'];
  if (isPb) cls.push('row-pb');
  if (!isChild && isSel) cls.push('row-selected');

  var hasScam = t.scammed && t.scammed.trim();
  return '<tr data-tid="'+t.id+'" class="'+cls.join(' ')+'">'
    +'<td class="cb-col"><input type="checkbox" class="row-cb" data-tid="'+t.id+'"'+(isSel?' checked':'')+'></td>'
    +'<td class="col-time">'+relTs(t.executed_at)+'</td>'
    +'<td class="col-name">'+esc(t.item_name||'—')+'</td>'
    +'<td>'+(t.seller?'<button class="seller-link" data-seller="'+esc(t.seller)+'">'+esc(t.seller)+'</button>':'—')+'</td>'
    +'<td class="col-price" style="color:#0f172a;font-weight:700">'+(t.price!=null?t.price:'—')+'</td>'
    +'<td class="col-id">'+(t.offer_id!=null?t.offer_id:'—')+'</td>'
    +'<td><input class="trade-input'+(hasScam?' has-scam':'')+'" data-field="scammed" type="text" value="'+esc(t.scammed||'')+'" placeholder="—"></td>'
    +'<td><input class="trade-input" data-field="amount" type="text" value="'+esc(t.amount||'')+'" placeholder="—" style="color:var(--green);font-weight:700"></td>'
    +'<td><input class="trade-input" data-field="notes" type="text" value="'+esc(t.notes||'')+'" placeholder="—"></td>'
    +'<td><input class="trade-input" data-field="traded_for" type="text" value="'+esc(t.traded_for||'')+'" placeholder="—"></td>'
    +'<td class="pb-cell">'
      +'<button class="pb-toggle '+(isPb?'pb-toggle--yes':'pb-toggle--no')+'" data-tid="'+t.id+'">'
        +(isPb?'✓ Pulled':'Pull')
      +'</button>'
    +'</td>'
    +'<td><button class="del-btn" data-dtid="'+t.id+'" title="Delete">'+trashIcon+'</button></td>'
    +'</tr>';
}

function renderTradesFiltered() {
  var q = _tradesQ.toLowerCase();
  var list = _allTrades.filter(function(t) {
    if (!q) return true;
    var hay = [t.item_name, t.seller, t.scammed, t.amount, t.notes, t.offer_id].join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  });
  list = list.slice().sort(function(a, b) {
    var ta = new Date(a.executed_at).getTime();
    var tb = new Date(b.executed_at).getTime();
    return _tradesSort === 'asc' ? ta - tb : tb - ta;
  });

  if (_tradeFilter === 'active') list = list.filter(function(t){ return !t.pull_back; });
  else if (_tradeFilter === 'pulled') list = list.filter(function(t){ return t.pull_back === true; });
  else if (_tradeFilter === 'scammed') list = list.filter(function(t){ return t.scammed && t.scammed.trim(); });
  else if (_tradeFilter === 'bundles') list = list.filter(function(t){ return !!t.bundle_id; });

  var th = document.getElementById('trades-time-th');
  if (th) th.textContent = 'Tijd ' + (_tradesSort === 'asc' ? '↑' : '↓');

  var tbody = document.getElementById('trades-body');
  if (!list.length) {
    tbody.innerHTML = '<tr class="state-row"><td colspan="12">No trades found.</td></tr>';
    return;
  }

  var trashIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
  var seenBundles = {};
  var bundleNum = 0;
  var html = '';

  list.forEach(function(t) {
    if (t.bundle_id) {
      if (seenBundles[t.bundle_id]) return;
      bundleNum++;
      seenBundles[t.bundle_id] = bundleNum;
      var bid = t.bundle_id;
      var bTrades = list.filter(function(x){ return x.bundle_id === bid; });
      var shortId = bundleNum;
      var sellers = bTrades.map(function(x){ return x.seller||'?'; }).filter(function(v,i,a){ return a.indexOf(v)===i; }).join(' + ');
      var totalPrice = bTrades.reduce(function(s,x){ return s+(x.price||0); }, 0);
      var items = bTrades.map(function(x){ return x.item_name||'?'; }).join(', ');
      var scammedUsers = bTrades.map(function(x){ return x.scammed||''; }).filter(Boolean).filter(function(v,i,a){ return a.indexOf(v)===i; }).join(', ');
      var isExpanded = _expandedBundles[bid] !== false;

      var bcPerItem = bTrades[0].amount != null ? bTrades[0].amount : null;
      var pbCount = bTrades.filter(function(x){ return x.pull_back === true; }).length;
      var pbColor = pbCount === bTrades.length ? 'var(--green)' : pbCount > 0 ? '#f59e0b' : '#ef4444';
      var unlinkIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';
      html += '<tr class="bundle-hdr" data-bid="'+bid+'">'
        +'<td class="cb-col"></td>'
        +'<td style="white-space:nowrap"><button class="bundle-toggle" data-bid="'+bid+'">'+(isExpanded?'▾':'▸')+'</button> <span class="bundle-label">Bundle #'+shortId+'</span></td>'
        +'<td class="col-name">'+bTrades.length+' item'+(bTrades.length!==1?'s':'')+'</td>'
        +'<td>'+sellers.split(' + ').length+'</td>'
        +'<td class="col-price">'+totalPrice+'</td>'
        +'<td>—</td>'
        +'<td><span style="padding-left:6px">'+(scammedUsers?esc(scammedUsers):'—')+'</span></td>'
        +'<td><span style="padding-left:6px">'+(bcPerItem!=null?esc(String(bcPerItem)):'—')+'</span></td>'
        +'<td><span style="padding-left:6px">—</span></td>'
        +'<td><span style="padding-left:4px">'+pbCount+'/'+bTrades.length+'</span></td>'
        +'<td><button class="del-btn unbundle-btn" data-bid="'+bid+'" title="Unbundle (remove bundle)">'+unlinkIcon+'</button></td>'
        +'</tr>';

      if (isExpanded) {
        bTrades.forEach(function(bt){ html += _tradeRowHtml(bt, true, trashIcon); });
      }
    } else {
      html += _tradeRowHtml(t, false, trashIcon);
    }
  });

  tbody.innerHTML = html;

  tbody.querySelectorAll('.row-selectable').forEach(function(tr) {
    tr.addEventListener('click', function(e) {
      if (e.target.closest('input,select,button,a')) return;
      var tid = String(tr.dataset.tid);
      if (_selectedTrades.has(tid)) { _selectedTrades.delete(tid); tr.classList.remove('row-selected'); }
      else { _selectedTrades.add(tid); tr.classList.add('row-selected'); }
      _updateBundleBar();
    });
  });

  tbody.querySelectorAll('.bundle-toggle').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var bid = btn.dataset.bid;
      _expandedBundles[bid] = !(_expandedBundles[bid] !== false);
      renderTradesFiltered();
    });
  });

  tbody.querySelectorAll('.unbundle-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { unbundle(btn.dataset.bid); });
  });

  tbody.querySelectorAll('.trade-input').forEach(function(inp) {
    var tr = inp.closest('tr');
    var tid = tr ? tr.dataset.tid : null;
    if (!tid) return;
    inp.addEventListener('input', function() {
      if (inp.dataset.field === 'scammed') inp.classList.toggle('has-scam', !!inp.value.trim());
      clearTimeout(inp._t);
      inp._t = setTimeout(function() { saveTradePatch(tid, inp.dataset.field, inp.value.trim(), inp); }, 700);
    });
    inp.addEventListener('blur', function() {
      clearTimeout(inp._t);
      saveTradePatch(tid, inp.dataset.field, inp.value.trim(), inp);
    });
  });

  tbody.querySelectorAll('.pb-toggle').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var id = btn.dataset.tid;
      var trade = _allTrades.find(function(x){ return String(x.id) === String(id); });
      if (!trade) return;
      var newVal = !trade.pull_back;
      var body = { pull_back: newVal, pull_back_at: newVal ? new Date().toISOString() : null };
      btn.disabled = true;
      _pendingPatches++;
      fetch(SUPABASE_URL+'/rest/v1/trades?id=eq.'+id, {
        method: 'PATCH',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer '+SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify(body)
      }).then(function(r) {
        _pendingPatches--;
        if (r.ok) {
          trade.pull_back = newVal;
          trade.pull_back_at = body.pull_back_at;
          _showSaveBar(true);
          updateTradesStats();
          renderTradesFiltered();
        } else {
          btn.disabled = false;
          r.text().then(function(t){ _showSaveBar(false, r.status+' — '+t.slice(0,120)); });
        }
      }).catch(function(e) { _pendingPatches--; btn.disabled = false; _showSaveBar(false, e.message); });
    });
  });

  tbody.querySelectorAll('.del-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { deleteTrade(btn.dataset.dtid); });
  });
}

async function loadTrades(){
  document.getElementById('trades-sub').textContent = 'Loading…';
  document.getElementById('trades-body').innerHTML = '<tr class="state-row"><td colspan="12">Loading…</td></tr>';
  try {
    var res = await fetch(
      SUPABASE_URL+'/rest/v1/trades?select=*&order=executed_at.desc&limit=500',
      { headers:{ 'apikey':SUPABASE_KEY, 'Authorization':'Bearer '+SUPABASE_KEY } }
    );
    if (!res.ok) throw new Error('HTTP '+res.status);
    _allTrades = await res.json();
    document.getElementById('trades-sub').textContent = _allTrades.length+' trade'+(_allTrades.length!==1?'s':'');
    updateTradesStats();
    renderTradesFiltered();
  } catch(e) {
    document.getElementById('trades-sub').textContent = 'Error: '+e.message;
    document.getElementById('trades-body').innerHTML = '<tr class="state-row"><td colspan="12">Error loading.</td></tr>';
  }
}

function goToHolder(name) {
  _pendingHolder = name;
  showPage('holders');
}

async function loadHolders() {
  document.getElementById('holder-count-bar').textContent = 'Loading…';
  document.getElementById('holder-list').innerHTML = '';
  document.getElementById('holders-sub').textContent = 'Loading…';
  try {
    var res = await fetch(
      SUPABASE_URL+'/rest/v1/trades?select=*&order=executed_at.desc',
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer '+SUPABASE_KEY } }
    );
    if (!res.ok) throw new Error('HTTP '+res.status);
    var trades = await res.json();

    _holderTrades = {};
    trades.forEach(function(t) {
      var name = t.seller || '—';
      if (!_holderTrades[name]) _holderTrades[name] = [];
      _holderTrades[name].push(t);
    });

    var names = Object.keys(_holderTrades).sort(function(a,b){
      return _holderTrades[b].length - _holderTrades[a].length;
    });

    _holdersLoaded = true;
    document.getElementById('holder-count-bar').textContent = names.length+' holder'+(names.length!==1?'s':'');
    document.getElementById('holders-sub').textContent = '';

    var el = document.getElementById('holder-list');
    el.innerHTML = names.map(function(name) {
      var initials = name.slice(0,2).toUpperCase();
      return '<div class="hrow" data-hname="'+esc(name)+'">'
        +'<div class="hrow-av" id="hrav-'+esc(name.replace(/[^a-z0-9]/gi,'_'))+'">'+esc(initials)+'</div>'
        +'<div class="hrow-info">'
        +'<div class="hrow-name">'+esc(name)+'</div>'
        +'<div class="hrow-sub">'+_holderTrades[name].length+' trade'+(_holderTrades[name].length!==1?'s':'')+'</div>'
        +'</div></div>';
    }).join('');

    el.querySelectorAll('.hrow').forEach(function(row) {
      row.addEventListener('click', function() { showHolder(row.dataset.hname); });
    });

    if (_pendingHolder) { showHolder(_pendingHolder); _pendingHolder = null; }

    // Batch fetch figures for all holders
    var validNames = names.filter(function(n){ return n !== '—'; });
    if (validNames.length) {
      try {
        var qnames = validNames.map(function(n){ return '"'+n.replace(/"/g,'\\"')+'"'; }).join(',');
        var fr = await fetch(
          SUPABASE_URL+'/rest/v1/users?select=name,figure&name=in.('+qnames+')&limit=500',
          { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer '+SUPABASE_KEY } }
        );
        if (fr.ok) {
          var figRows = await fr.json();
          figRows.forEach(function(u) {
            if (!u.figure) return;
            var key = u.name.replace(/[^a-z0-9]/gi,'_');
            var avEl = document.getElementById('hrav-'+key);
            if (avEl) {
              avEl.innerHTML = '<img src="'+esc(avatarHead(u.figure))+'" loading="lazy" onerror="this.style.display=\'none\'">';
            }
          });
        }
      } catch(e) {}
    }
  } catch(e) {
    document.getElementById('holder-count-bar').textContent = 'Error: '+e.message;
    document.getElementById('holders-sub').textContent = 'Failed to load';
  }
}

async function showHolder(name) {
  document.querySelectorAll('.hrow').forEach(function(r){
    r.classList.toggle('sel', r.dataset.hname === name);
  });

  var card = document.getElementById('holder-card');
  card.style.display = 'block';
  document.getElementById('holder-empty').style.display = 'none';

  var trades = _holderTrades[name] || [];
  var scammedCount = trades.filter(function(t){ return t.scammed && t.scammed.trim(); }).length;
  var itemsCount   = trades.filter(function(t){ return t.amount  && t.amount.trim();  }).length;
  var pullbackCount= trades.filter(function(t){ return t.pull_back === true; }).length;

  document.getElementById('hd-name').textContent = name;
  document.getElementById('hd-stats').innerHTML =
    '<div class="hd-stat"><div class="hd-stat-val">'+trades.length+'</div><div class="hd-stat-lbl">Trades</div></div>'
   +'<div class="hd-stat hd-stat--red"><div class="hd-stat-val">'+scammedCount+'</div><div class="hd-stat-lbl">Scammed</div></div>'
   +'<div class="hd-stat hd-stat--green"><div class="hd-stat-val">'+itemsCount+'</div><div class="hd-stat-lbl">Items</div></div>'
   +'<div class="hd-stat"><div class="hd-stat-val">'+pullbackCount+'</div><div class="hd-stat-lbl">Pull back</div></div>';

  var avEl = document.getElementById('hd-avatar');
  avEl.innerHTML = '<span class="no-av">👤</span>';
  try {
    var ur = await fetch(
      SUPABASE_URL+'/rest/v1/users?select=figure&name=eq.'+encodeURIComponent(name)+'&limit=1',
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer '+SUPABASE_KEY } }
    );
    if (ur.ok) {
      var rows = await ur.json();
      if (rows.length && rows[0].figure) {
        avEl.innerHTML = '<img src="'+esc(avatarLarge(rows[0].figure))+'" onerror="this.parentElement.innerHTML=\'<span class=no-av>👤</span>\'">';
      }
    }
  } catch(e) {}

  document.getElementById('hd-trades-body').innerHTML = trades.map(function(t){
    var isPb = t.pull_back === true;
    return '<tr'+(isPb?' class="row-pb"':'')+' >'
      +'<td class="col-time">'+ts(t.executed_at)+'</td>'
      +'<td class="col-name">'+esc(t.item_name||'—')+'</td>'
      +'<td class="col-price" style="color:#0f172a">'+(t.price!=null?t.price:'—')+'</td>'
      +'<td>'+(t.scammed?esc(t.scammed):'—')+'</td>'
      +'<td>'+(t.amount?esc(t.amount):'—')+'</td>'
      +'<td>'+(t.notes?esc(t.notes):'—')+'</td>'
      +'<td>'+(isPb?'<span style="color:var(--green);font-weight:700">Yes</span>':'<span style="color:#ef4444;font-weight:700">No</span>')+'</td>'
      +'</tr>';
  }).join('');
}

function updateFilterBtn(){
  var hasFilter = _ft!=='all' || _fg!=='all';
  document.getElementById('filter-btn').classList.toggle('has-filters', hasFilter);
}

document.addEventListener('DOMContentLoaded', function(){
  document.querySelectorAll('.nav-item').forEach(function(a){
    a.addEventListener('click', function(){
      if (a.dataset.page === 'usersdb') {
        window.open('http://localhost:3000', '_blank');
        return;
      }
      showPage(a.dataset.page);
    });
  });

  document.getElementById('searchbox').addEventListener('input', applyFilters);

  var filterBtn = document.getElementById('filter-btn');
  var dropdown  = document.getElementById('filter-dropdown');
  filterBtn.addEventListener('click', function(e){
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });
  document.addEventListener('click', function(e){
    if (!dropdown.contains(e.target) && e.target !== filterBtn){
      dropdown.classList.remove('open');
    }
  });
  document.querySelectorAll('[data-ft]').forEach(function(btn){
    btn.addEventListener('click', function(){
      setFilter('ft', btn.dataset.ft);
      updateFilterBtn();
    });
  });
  document.querySelectorAll('[data-fg]').forEach(function(btn){
    btn.addEventListener('click', function(){
      setFilter('fg', btn.dataset.fg);
      updateFilterBtn();
    });
  });

  document.getElementById('trades-body').addEventListener('click', function(e) {
    var btn = e.target.closest('.seller-link');
    if (btn) { _holdersLoaded = false; goToHolder(btn.dataset.seller); }
  });
  ['ss-pb-body','ss-npb-body'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', function(e) {
      var btn = e.target.closest('.seller-link');
      if (btn) { _holdersLoaded = false; goToHolder(btn.dataset.seller); }
    });
  });

  document.getElementById('trades-search').addEventListener('input', function(e) {
    _tradesQ = e.target.value.trim();
    renderTradesFiltered();
  });

  document.getElementById('trades-time-th').addEventListener('click', function() {
    _tradesSort = _tradesSort === 'desc' ? 'asc' : 'desc';
    renderTradesFiltered();
  });

  document.getElementById('holders-refresh').addEventListener('click', function() {
    _holdersLoaded = false;
    loadHolders();
  });

  document.getElementById('dash-refresh').addEventListener('click', loadDashboard);
  document.getElementById('trades-refresh').addEventListener('click', function() {
    var focused = document.querySelector('#trades-body .trade-input:focus');
    if (focused) {
      clearTimeout(focused._t);
      var tid = focused.closest('tr').dataset.tid;
      saveTradePatch(tid, focused.dataset.field, focused.value.trim(), focused);
    }
    if (_pendingPatches > 0) {
      var check = setInterval(function() {
        if (_pendingPatches === 0) { clearInterval(check); loadTrades(); }
      }, 50);
      setTimeout(function() { clearInterval(check); loadTrades(); }, 3000);
    } else {
      loadTrades();
    }
  });

  document.getElementById('tab-picker-cancel').addEventListener('click', function() {
    document.getElementById('tab-picker-overlay').classList.remove('open');
  });
  document.getElementById('tab-picker-overlay').addEventListener('click', function(e) {
    if (e.target === this) this.classList.remove('open');
  });

  document.getElementById('requests-refresh').addEventListener('click', loadRequests);
  document.getElementById('requests-decline-all').addEventListener('click', declineAllRequests);

  function _openReqDrawer() {
    document.getElementById('req-drawer-overlay').classList.add('open');
    document.getElementById('req-drawer').classList.add('open');
    loadRequests();
    _reqPollInterval = setInterval(loadRequests, 10000);
  }
  function _closeReqDrawer() {
    document.getElementById('req-drawer-overlay').classList.remove('open');
    document.getElementById('req-drawer').classList.remove('open');
    if (_reqPollInterval) { clearInterval(_reqPollInterval); _reqPollInterval = null; }
  }
  document.getElementById('trades-req-btn').addEventListener('click', _openReqDrawer);
  document.getElementById('req-drawer-close').addEventListener('click', _closeReqDrawer);
  document.getElementById('req-drawer-overlay').addEventListener('click', function(e) {
    if (e.target === this) _closeReqDrawer();
  });

  document.getElementById('trades-items-wrap').addEventListener('click', function(e) {
    var pill = e.target.closest('.item-pill');
    if (pill) showItemHolders(pill.dataset.item);
  });

  document.getElementById('tstat-scammed-card').addEventListener('click', showScammedDetail);
  document.getElementById('scammed-detail-close').addEventListener('click', function() {
    document.getElementById('scammed-detail-overlay').classList.remove('open');
    document.getElementById('scammed-detail-modal').classList.remove('open');
  });
  document.getElementById('scammed-detail-overlay').addEventListener('click', function() {
    document.getElementById('scammed-detail-overlay').classList.remove('open');
    document.getElementById('scammed-detail-modal').classList.remove('open');
  });

  ['ss-pb-hdr','ss-npb-hdr','lb-manual-hdr','lb-items-hdr'].forEach(function(hdrId) {
    var hdr = document.getElementById(hdrId);
    if (!hdr) return;
    hdr.addEventListener('click', function() {
      var block = hdr.closest('.lb-acc');
      if (block) block.classList.toggle('open');
    });
  });

  document.querySelectorAll('.lb-chip[data-lbf]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      _tradeFilter = btn.dataset.lbf;
      document.querySelectorAll('.lb-chip[data-lbf]').forEach(function(b){ b.classList.toggle('active', b === btn); });
      renderTradesFiltered();
    });
  });

  document.getElementById('tstat-total-card').addEventListener('click', function() {
    document.querySelector('.lb-table-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.getElementById('tstat-ss-card').addEventListener('click', function() {
    document.getElementById('ss-pb-block').classList.add('open');
    document.getElementById('ss-npb-block').classList.add('open');
    document.getElementById('ss-pb-block').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.getElementById('tstat-items-card').addEventListener('click', function() {
    document.getElementById('lb-items-acc').classList.add('open');
    document.getElementById('lb-items-acc').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.getElementById('tstat-pullback-card').addEventListener('click', function() {
    document.getElementById('ss-pb-block').classList.add('open');
    document.getElementById('ss-pb-block').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.getElementById('tstat-nopullback-card').addEventListener('click', function() {
    document.getElementById('ss-npb-block').classList.add('open');
    document.getElementById('ss-npb-block').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.getElementById('manual-entry-add').addEventListener('click', addManualEntry);
  document.getElementById('manual-entry-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') addManualEntry();
  });

  loadManualEntries();

  document.getElementById('item-holders-modal-close').addEventListener('click', _closeItemHoldersModal);
  document.getElementById('item-holders-overlay').addEventListener('click', _closeItemHoldersModal);

  document.getElementById('copy-items-btn').addEventListener('click', function() {
    var pills = document.querySelectorAll('#trades-items-wrap .item-pill');
    var text = Array.from(pills).map(function(p) {
      var name = (p.dataset.item || p.childNodes[0].textContent.trim()).replace(/\s*\([^)]*\)\s*$/g, '').trim();
      var count = p.querySelector('.item-pill-count');
      return name + ' (' + (count ? count.textContent.trim() : '1') + ')';
    }).join(', ');
    navigator.clipboard.writeText(text).then(function() {
      var confirm = document.getElementById('copy-items-confirm');
      confirm.style.display = '';
      setTimeout(function() { confirm.style.display = 'none'; }, 1500);
    });
  });

  document.getElementById('bundle-create-btn').addEventListener('click', createBundle);
  document.getElementById('bundle-clear-btn').addEventListener('click', function() {
    _selectedTrades.clear();
    _updateBundleBar();
    renderTradesFiltered();
  });

  loadDashboard();
  loadUsers();
  loadRequests();
});
