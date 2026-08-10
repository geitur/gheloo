(function() {
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // Heuristic fallback decoder — used when no structured parser exists.
  // Decodes strings as Latin-1 (matching G-Earth's byte-by-byte display).
  // Type tags match G-Earth notation: {s:""} {i:} {b:} {x:hex}
  function decodePayload(buf) {
    if (!buf || buf.byteLength <= 6) return [];
    const payload = buf.slice(6);
    const bytes = new Uint8Array(payload);
    const view  = new DataView(payload);
    const parts = [];
    let i = 0;
    while (i < bytes.length) {
      const rem = bytes.length - i;
      if (rem >= 2) {
        const slen = view.getUint16(i);
        if (slen > 0 && slen <= rem - 2 && slen <= 4096) {
          // Reject only if first 8 bytes contain null/SOH (control codes < 9)
          let ok = true;
          for (let j = 0; j < Math.min(slen, 8); j++) {
            if (bytes[i + 2 + j] < 9) { ok = false; break; }
          }
          if (ok) {
            // Latin-1 decode to match G-Earth's byte-by-byte string display
            let str = '';
            for (let j = 0; j < slen; j++) str += String.fromCharCode(bytes[i + 2 + j]);
            parts.push({ t:'s', v:str }); i += 2 + slen; continue;
          }
        }
        // When exactly 2 bytes remain and string fails: prefer uint16 over bool+orphaned-hex,
        // unless both bytes are 0/1 (could genuinely be two consecutive bools).
        if (rem === 2 && (bytes[i] > 1 || bytes[i + 1] > 1)) {
          parts.push({ t:'u', v:view.getUint16(i) }); i += 2; continue;
        }
      }
      if (rem >= 4) {
        const n = view.getInt32(i);
        if (n >= -1e6) { parts.push({ t:'i', v:n }); i += 4; continue; }
      }
      if (bytes[i] === 0 || bytes[i] === 1) { parts.push({ t:'b', v:!!bytes[i] }); i++; continue; }
      parts.push({ t:'x', v:bytes[i] }); i++;
    }
    return parts;
  }

  // Exposed so other scripts (e.g. the :steal command in ws.js, for packets with no
  // registered parser and inconsistent/optional per-entry fields like HabboSearchResult)
  // can reuse the exact same heuristic decode the logger displays, instead of guessing.
  window.__hbl_decode = decodePayload;

  // Use structure-guided decoder for known packets; fall back to heuristic.
  function getDecodeTokens(p) {
    if (p.raw && p.name && window.decodeWithParser) {
      const t = window.decodeWithParser(p.name, p.direction, p.raw);
      if (t) return t;
    }
    return decodePayload(p.raw);
  }

  function tokenToHtml(pt) {
    const colors = { s:'#2ecc71', i:'#5b9cf6', u:'#5b9cf6', l:'#5b9cf6', b:'#f1c40f', x:'#82849a' };
    const c = colors[pt.t] || '#82849a';
    if (pt.t === 's') return '<span style="color:' + c + '">{s:"' + esc(pt.v) + '"}</span>';
    if (pt.t === 'i') return '<span style="color:' + c + '">{i:' + pt.v + '}</span>';
    if (pt.t === 'u') return '<span style="color:' + c + '">{u:' + pt.v + '}</span>';
    if (pt.t === 'l') return '<span style="color:' + c + '">{l:' + String(pt.v) + '}</span>';
    if (pt.t === 'b') return '<span style="color:' + c + '">{b:' + pt.v + '}</span>';
    return '<span style="color:#444">{x:' + pt.v.toString(16).padStart(2,'0') + '}</span>';
  }

  function tokenToPlain(pt) {
    if (pt.t === 's') return '{s:"' + pt.v.replace(/\\/g,'\\\\').replace(/"/g,'\\"') + '"}';
    if (pt.t === 'i') return '{i:' + pt.v + '}';
    if (pt.t === 'u') return '{u:' + pt.v + '}';
    if (pt.t === 'l') return '{l:' + String(pt.v) + '}';
    if (pt.t === 'b') return '{b:' + pt.v + '}';
    return '{x:' + pt.v.toString(16).padStart(2,'0') + '}';
  }



  function buildMainUI() {
    const css = document.createElement('style');
    css.textContent = [
      '#__hbl{position:fixed;top:16px;left:16px;width:600px;z-index:1000;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:12px}',
      '#__hbl *{box-sizing:border-box}',
      '.__hbl_card{display:flex;flex-direction:column;background:#12131A;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.55);overflow:hidden;color:#eceefb}',
      '.__hbl_hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A0B10;cursor:move}',
      '.__hbl_eyebrow{font:700 9px/1 monospace;letter-spacing:1.5px;color:#6C7CFF;text-transform:uppercase}',
      '.__hbl_title{font:600 13px system-ui;color:#eceefb;flex:1}',
      '.__hbl_close{cursor:pointer;color:#5c5e6b;font-size:16px;line-height:1;padding:2px 6px}',
      '.__hbl_close:hover{color:#eceefb}',
      '.__hbl_toolbar{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.06)}',
      '.__hbl_btn{background:#1c1e2a;color:#82849a;border:1px solid #23252f;border-radius:8px;font-size:9px;padding:4px 8px;cursor:pointer;min-width:44px;text-align:center}',
      '.__hbl_btn:hover{color:#eceefb}',
      '.__hbl_btn.on{background:rgba(108,124,255,0.16);color:#A6B0FF;border-color:#6C7CFF}',
      '.__hbl_grow{flex:1}',
      '.__hbl_body{display:flex;height:360px;overflow:hidden}',
      '#__hbl_list{width:200px;flex-shrink:0;overflow:auto;border-right:1px solid rgba(255,255,255,0.06)}',
      '#__hbl_detail{flex:1;overflow:auto;background:#0A0B10}',
      '.__hbl_empty{padding:30px;text-align:center;font-size:11px;color:#5c5e6b}',
      '.__hbl_row{display:flex;align-items:center;gap:5px;padding:5px 8px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.04);border-left:2px solid transparent;box-sizing:border-box}',
      '.__hbl_row:hover{background:rgba(255,255,255,0.04)}',
      '.__hbl_row.sel{background:rgba(108,124,255,0.12)!important;border-left-color:#6C7CFF}',
      '.__hbl_dtag_in{color:#2ecc71!important}.__hbl_dtag_out{color:#5b9cf6!important}',
      '.__hbl_dsec{border-bottom:1px solid rgba(255,255,255,0.06);padding:8px 12px}',
      '.__hbl_dlbl{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#5c5e6b;margin-bottom:6px;font-weight:700;display:flex;align-items:center;gap:6px}',
      '.__hbl_dtbl{border-collapse:collapse;width:100%;font-size:10px}',
      '.__hbl_dk{color:#5c5e6b;padding:2px 8px 2px 0;white-space:nowrap;vertical-align:top;min-width:70px;font-family:monospace}',
      '.__hbl_dv{color:#eceefb;font-family:monospace;word-break:break-all;padding:2px 0}',
      '.__hbl_fi{border-bottom:1px solid rgba(255,255,255,0.04)}',
      '.__hbl_fi_hdr{padding:5px 8px;cursor:pointer;font-size:10px;display:flex;align-items:center;gap:5px;color:#82849a}',
      '.__hbl_fi_hdr:hover{color:#eceefb}',
      '.__hbl_fi_hdr::before{content:"▶";font-size:7px;color:#5c5e6b;transition:transform 0.12s;flex-shrink:0}',
      '.__hbl_fi_hdr.open::before{transform:rotate(90deg)}',
      '.__hbl_fi_body{padding:4px 12px 8px;white-space:pre;font:9px/1.6 monospace;background:rgba(255,255,255,0.02);border-top:1px solid rgba(255,255,255,0.04);color:#82849a}',
      '.__hbl_copybtn{font-size:9px;background:none;border:1px solid #23252f;color:#82849a;border-radius:4px;padding:0 6px;cursor:pointer;margin-left:4px}',
      '.__hbl_copybtn:hover{color:#eceefb}',
    ].join('');
    document.head.appendChild(css);

    const panel = document.createElement('div');
    panel.id = '__hbl';
    panel.innerHTML =
      '<div class="__hbl_card">' +
        '<div class="__hbl_hdr" id="__hbl_hdr">' +
          '<span class="__hbl_eyebrow">Gheloo</span>' +
          '<span class="__hbl_title">Packet Logger</span>' +
          '<span class="__hbl_close" id="__hbl_hclose">&times;</span>' +
        '</div>' +
        '<div class="__hbl_toolbar">' +
          '<button id="__hbl_tin"  class="__hbl_btn">IN</button>' +
          '<button id="__hbl_tout" class="__hbl_btn">OUT</button>' +
          '<div class="__hbl_grow"></div>' +
          '<button id="__hbl_clr"   class="__hbl_btn">Clear</button>' +
        '</div>' +
        '<div class="__hbl_body">' +
          '<div id="__hbl_list"></div>' +
          '<div id="__hbl_detail"><div class="__hbl_empty">Click a packet</div></div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(panel);
    panel.style.display = 'none';
    window.__hbl_mode = null;

    window.__ghk_makeDraggable(panel, panel.querySelector('#__hbl_hdr'), '__ghk_hbl_pos', e =>
      ['BUTTON', 'INPUT'].includes(e.target.tagName) || e.target.id === '__hbl_hclose');

    panel.querySelector('#__hbl_hclose').addEventListener('click', ()=>{ panel.style.display='none'; });

    const listEl   = panel.querySelector('#__hbl_list');
    const detailEl = panel.querySelector('#__hbl_detail');
    let showIn=false, showOut=false, selRow=null;

    const tinBtn   = panel.querySelector('#__hbl_tin');
    const toutBtn  = panel.querySelector('#__hbl_tout');
    tinBtn.classList.toggle('on', showIn);
    toutBtn.classList.toggle('on', showOut);
    tinBtn.addEventListener('click', () => {
      showIn = !showIn;
      tinBtn.classList.toggle('on', showIn);
    });
    toutBtn.addEventListener('click', () => {
      showOut = !showOut;
      toutBtn.classList.toggle('on', showOut);
    });

    // Force both filters off on every login (UserObject fires once per login, including
    // reconnects) — a fresh session starts quiet regardless of how the toggles were left
    // last time, not just on first page load.
    window.onPacket('UserObject', function(p) {
      if (!p.parsed || !p.parsed.name) return;
      showIn = false; showOut = false;
      tinBtn.classList.toggle('on', showIn);
      toutBtn.classList.toggle('on', showOut);
    });

    panel.querySelector('#__hbl_clr').addEventListener('click', () => {
      listEl.innerHTML = '';
      detailEl.innerHTML = '<div class="__hbl_empty">Click a packet</div>';
      selRow = null;
    });


    function fmtVal(v, pad) {
      if (v===null||v===undefined) return '<span style="color:#5c5e6b">null</span>';
      if (typeof v==='boolean') return '<span style="color:#f1c40f">'+v+'</span>';
      if (typeof v==='number') return '<span style="color:#5b9cf6">'+v+'</span>';
      if (typeof v==='string') return '<span style="color:#2ecc71">"'+esc(v)+'"</span>';
      if (Array.isArray(v)) {
        if (!v.length) return '<span style="color:#5c5e6b">[]</span>';
        const inner=pad+'  ';
        return '['+v.map(function(x){return '\n'+inner+fmtVal(x,inner);}).join(',')+(v.length?'\n'+pad:'')+']';
      }
      if (typeof v==='object') {
        const entries=Object.entries(v);
        if (!entries.length) return '<span style="color:#5c5e6b">{ }</span>';
        const inner=pad+'  ';
        return entries.map(function(kv){
          return '\n'+inner+'<span style="color:#82849a">'+esc(kv[0])+'</span>  '+fmtVal(kv[1],inner);
        }).join('')+'\n'+pad;
      }
      return esc(String(v));
    }

    function renderDetail(p) {
      const t=new Date(p.timestamp);
      const ts=t.toTimeString().slice(0,8)+'.'+String(t.getMilliseconds()).padStart(3,'0');
      let h =
        '<div class="__hbl_dsec"><div class="__hbl_dlbl">Info</div>'+
        '<table class="__hbl_dtbl">'+
        '<tr><td class="__hbl_dk">name</td><td class="__hbl_dv">'+esc(p.name||'—')+'</td></tr>'+
        '<tr><td class="__hbl_dk">header</td><td class="__hbl_dv">'+p.header+'</td></tr>'+
        '<tr><td class="__hbl_dk">direction</td><td class="__hbl_dv">'+p.direction+'</td></tr>'+
        '<tr><td class="__hbl_dk">timestamp</td><td class="__hbl_dv">'+ts+'</td></tr>'+
        '<tr><td class="__hbl_dk">size</td><td class="__hbl_dv">'+(p.raw?p.raw.byteLength:0)+' B</td></tr>'+
        '</table>'+
        '<button class="__hbl_btn" id="__hbl_sndbtn" style="margin-top:4px">&#10148; Sender</button></div>';
      if (p.parsed) {
        h+='<div class="__hbl_dsec"><div class="__hbl_dlbl">Parsed</div>';
        var _expandArr = Array.isArray(p.parsed.items) && p.parsed.items.length ? p.parsed.items
                       : Array.isArray(p.parsed.friends) && p.parsed.friends.length ? p.parsed.friends
                       : null;
        if (_expandArr) {
          var _isFriends = !p.parsed.items;
          // For friends: show fragment/category header before list
          if (_isFriends) {
            h+='<div style="white-space:pre;font:9px/1.6 monospace;padding:2px 0 4px">';
            ['fragmentIndex','totalFragments','friendCount'].forEach(function(k){
              if (p.parsed[k]!==undefined) h+='<span style="color:#82849a">'+k+'</span>  '+fmtVal(p.parsed[k],'')+'\n';
            });
            h+='</div>';
          }
          h+='<div style="overflow-y:auto;max-height:200px">';
          _expandArr.forEach(function(item){
            var label = _isFriends
              ? (item.name||('id #'+item.id)) + (item.online ? ' ●' : ' ○')
              : (item.furniName||item.classname||item.name||('typeId #'+(item.typeId||item.id)));
            h+='<div class="__hbl_fi"><div class="__hbl_fi_hdr">'+esc(label)+'</div>';
            h+='<div class="__hbl_fi_body" style="display:none">';
            Object.entries(item).forEach(function(kv){
              h+='<span style="color:#82849a">'+esc(kv[0])+'</span>  '+fmtVal(kv[1],'')+'\n';
            });
            h+='</div></div>';
          });
          h+='</div>';
        } else {
          h+='<div style="white-space:pre;font:9px/1.6 monospace;overflow-y:auto;max-height:200px;padding:2px 0">';
          Object.entries(p.parsed).forEach(function(kv){
            h+='<span style="color:#82849a">'+esc(kv[0])+'</span>  '+fmtVal(kv[1],'')+'\n';
          });
          h+='</div>';
        }
        h+='</div>';
      }
      const pTokens = getDecodeTokens(p);
      if (p.raw && p.raw.byteLength>=6) {
        const dir=p.direction==='IN'?'in':'out';
        const hdrTag=p.name?'{'+dir+':'+p.name+'}':'{'+dir+':#'+p.header+'}';
        h+='<div class="__hbl_dsec"><div class="__hbl_dlbl">Decode <button id="__hbl_copybtn" class="__hbl_copybtn">copy</button></div>'+
          '<div style="word-break:break-all;font-size:10px;line-height:1.7;font-family:monospace"><span style="color:#A6B0FF">'+esc(hdrTag)+'</span>'+pTokens.map(tokenToHtml).join('')+'</div></div>';
      }
      if (p.raw && p.raw.byteLength) {
        const bytes = new Uint8Array(p.raw);
        let hexStr = '';
        for (let bi=0; bi<bytes.length; bi++) hexStr += bytes[bi].toString(16).padStart(2,'0') + ' ';
        h+='<div class="__hbl_dsec"><div class="__hbl_dlbl">Raw hex <button id="__hbl_hexcopybtn" class="__hbl_copybtn">copy</button></div>'+
          '<div style="word-break:break-all;font-size:10px;line-height:1.7;font-family:monospace;color:#c7c9db">'+hexStr.trim()+'</div></div>';
      }
      detailEl.innerHTML = h;
      detailEl.querySelectorAll('.__hbl_fi_hdr').forEach(function(hdr){
        hdr.addEventListener('click', function(){
          var b=this.nextElementSibling;
          var open=b.style.display!=='none';
          b.style.display=open?'none':'block';
          this.classList.toggle('open',!open);
        });
      });
      const sndbtn=detailEl.querySelector('#__hbl_sndbtn');
      if (sndbtn) sndbtn.addEventListener('click', ()=>{
        if (window.__snd_fill) window.__snd_fill(p.direction, p.header, pTokens.map(tokenToPlain).join(''));
      });
      const copybtn=detailEl.querySelector('#__hbl_copybtn');
      if (copybtn) {
        const dir2=p.direction==='IN'?'in':'out';
        const hdrTag2=p.name?'{'+dir2+':'+p.name+'}':'{'+dir2+':#'+p.header+'}';
        const plain=hdrTag2+pTokens.map(tokenToPlain).join('');
        copybtn.addEventListener('click',()=>{
          navigator.clipboard.writeText(plain).catch(()=>{});
          copybtn.textContent='✓';
          setTimeout(()=>{copybtn.textContent='copy';},1200);
        });
      }
      const hexcopybtn=detailEl.querySelector('#__hbl_hexcopybtn');
      if (hexcopybtn && p.raw) {
        hexcopybtn.addEventListener('click',()=>{
          const bytes = new Uint8Array(p.raw);
          let hexStr = '';
          for (let bi=0; bi<bytes.length; bi++) hexStr += bytes[bi].toString(16).padStart(2,'0') + ' ';
          navigator.clipboard.writeText(hexStr.trim()).catch(()=>{});
          hexcopybtn.textContent='✓';
          setTimeout(()=>{hexcopybtn.textContent='copy';},1200);
        });
      }
    }

    function addRow(p) {
      if (p.direction==='IN' && !showIn) return;
      if (p.direction==='OUT' && !showOut) return;
      const t=new Date(p.timestamp);
      const ts=t.toTimeString().slice(0,8);
      const row=document.createElement('div');
      row.className='__hbl_row';
      row.dataset.dir=p.direction;
      row.innerHTML=
        '<span class="__hbl_dtag_'+(p.direction==='IN'?'in':'out')+'" style="font-size:9px;width:26px;font-weight:700;font-family:monospace;flex-shrink:0">'+p.direction+'</span>'+
        '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace;font-size:10px;color:#eceefb">'+esc(p.name||('#'+p.header))+'</span>'+
        '<span style="font-size:9px;color:#5c5e6b;flex-shrink:0;font-family:monospace">'+ts+'</span>';
      row.addEventListener('click', ()=>{
        if (selRow) selRow.classList.remove('sel');
        selRow=row;
        row.classList.add('sel');
        renderDetail(p);
      });
      listEl.appendChild(row);
      while (listEl.children.length > 300) {
        if (listEl.firstChild === selRow) selRow = null;
        listEl.removeChild(listEl.firstChild);
      }
      listEl.scrollTop = listEl.scrollHeight;
    }

    window.PacketStore.subscribe(addRow);
    window.__hbl_panel = panel;
  }




  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() { window.__ghk_ready(buildMainUI); });
  else window.__ghk_ready(buildMainUI);
})();
