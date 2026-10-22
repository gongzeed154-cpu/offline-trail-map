// "งาน": รวมเส้นทาง สัญลักษณ์ทหาร และหมุด เป็นชุดเดียว ตั้งชื่อ ติ๊กแสดง/ซ่อน ส่งออกและนำเข้าเพื่อรวมกับชุดอื่น
(function (root) {
  var G = TrailGeo;
  var KEY = 'trail_projects_v1';
  var PKEY = 'trail_pins_v1';
  var ctx = null;
  var st = { list: [{ id: 'default', name: 'งานทั่วไป', show: true }], active: 'default' };
  var pins = [];
  var markers = {};
  var listeners = [];
  var openProj = {};
  var bodyEl = null;
  var pinFmt = 'mgrs';

  function $(id) { return document.getElementById(id); }
  function load() {
    try { var s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.list && s.list.length) st = s; } catch (e) { /* ค่าเริ่มต้น */ }
    try { pins = JSON.parse(localStorage.getItem(PKEY) || '[]'); } catch (e2) { pins = []; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(st)); localStorage.setItem(PKEY, JSON.stringify(pins)); } catch (e) { if (ctx) ctx.toast('บันทึกงานไม่ได้ (พื้นที่เก็บข้อมูลเต็ม?)'); }
  }
  function byId(id) { return st.list.filter(function (p) { return p.id === id; })[0] || null; }
  function projOf(item) { return byId(item.proj || 'default') ? (item.proj || 'default') : 'default'; }
  function nameOf(id) { var p = byId(id || 'default') || byId('default') || st.list[0]; return p ? p.name : ''; }
  function isVisible(item) {
    var p = byId(item.proj || 'default') || byId('default') || st.list[0];
    return item.show !== false && !!(p && p.show);
  }
  function active() { return byId(st.active) ? st.active : st.list[0].id; }
  function notify() { save(); listeners.forEach(function (f) { try { f(); } catch (e) { /* ไม่ให้ตัวฟังล้ม */ } }); refreshPins(); }
  function reveal(id) { var p = byId(id || 'default'); if (p && !p.show) { p.show = true; notify(); } }
  function onChange(f) { listeners.push(f); }
  function uid(i) { return String(Date.now()) + '-' + (i || 0) + Math.floor(Math.random() * 1000); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function safeName(s) { return String(s).replace(/[\\/:*?"<>|]/g, '_').trim() || 'งาน'; }

  /* ---------- หมุด ---------- */
  function elForPin(p) {
    var el = document.createElement('div');
    el.className = 'symmark pinmark';
    el.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer';
    var lb = document.createElement('div');
    lb.textContent = p.name;
    lb.style.cssText = 'background:#fff;border:1.5px solid #000;border-radius:6px;padding:1px 6px;font-size:12px;font-weight:700;white-space:nowrap;color:#000;margin-bottom:2px;max-width:150px;overflow:hidden;text-overflow:ellipsis';
    var pn = document.createElement('div');
    pn.style.cssText = 'width:15px;height:15px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#ff8a00;border:2px solid #000;margin-bottom:5px';
    el.appendChild(lb); el.appendChild(pn);
    return el;
  }
  function mountPin(p) {
    unmountPin(p.id);
    var el = elForPin(p);
    var m = new maplibregl.Marker({ element: el, anchor: 'bottom', draggable: true }).setLngLat([p.lng, p.lat]).addTo(ctx.map());
    m.on('dragend', function () { var ll = m.getLngLat(); p.lat = ll.lat; p.lng = ll.lng; save(); draw(); });
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      openProj[projOf(p)] = true;
      ctx.toast(p.name + ' · ' + G.formatPoint(p.lat, p.lng, ctx.prefs.fmt));
      ctx.showSheet('proj');
    });
    markers[p.id] = m;
  }
  function unmountPin(id) { if (markers[id]) { markers[id].remove(); delete markers[id]; } }
  function refreshPins() {
    pins.forEach(function (p) {
      if (isVisible(p)) { if (!markers[p.id]) mountPin(p); } else unmountPin(p.id);
    });
  }
  function visiblePins() { return pins.filter(isVisible); }

  function init(c) {
    ctx = c;
    load();
    if (!byId('default')) st.list.unshift({ id: 'default', name: 'งานทั่วไป', show: true });
    refreshPins();
  }

  /* ---------- ส่งออก/นำเข้าไฟล์งาน ---------- */
  function inProj(id) { return function (x) { return projOf(x) === id; }; }
  function projData(id) {
    return {
      format: 'trail-project', version: 1, name: nameOf(id), exported: new Date().toISOString(),
      routes: clone(TrailNav.items().filter(inProj(id))),
      symbols: clone(TrailSym.items().filter(inProj(id))),
      pins: clone(pins.filter(inProj(id)))
    };
  }
  function importData(d) {
    if (!d || d.format !== 'trail-project') throw new Error('ไม่ใช่ไฟล์งานของแอพนี้');
    var id = 'p' + uid(), nm = d.name || 'งานนำเข้า';
    var base = nm, k = 2;
    while (st.list.some(function (p) { return p.name === nm; })) nm = base + ' (' + (k++) + ')';
    st.list.push({ id: id, name: nm, show: true });
    function fix(arr) { return (arr || []).map(function (x, i) { x.id = uid(i); x.proj = id; if (x.show === undefined) x.show = true; return x; }); }
    TrailNav.addRaw(fix(d.routes));
    TrailSym.addRaw(fix(d.symbols));
    fix(d.pins).forEach(function (p) { pins.push(p); });
    openProj[id] = true;
    notify();
    return nm;
  }

  /* ---------- หน้าจอ ---------- */
  function el(tag, css, text) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (text !== undefined) e.textContent = text; return e; }
  function btn(text, fn, primary) {
    var b = el('button', 'padding:8px 6px;font-size:13px', text);
    b.type = 'button'; b.className = 'btn' + (primary ? '' : ' alt'); b.onclick = fn;
    return b;
  }
  function check(item, fn) {
    var cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = item.show !== false;
    cb.style.cssText = 'width:20px;height:20px;flex:none;accent-color:#2e6b3f';
    cb.onchange = function () { item.show = cb.checked; fn(); };
    return cb;
  }
  function chooseProject(excludeId, msg) {
    var others = st.list.filter(function (p) { return p.id !== excludeId; });
    if (!others.length) { ctx.toast('ไม่มีงานอื่นให้เลือก'); return null; }
    var t = msg + '\n' + others.map(function (p, i) { return (i + 1) + ' = ' + p.name; }).join('\n');
    var v = parseInt(prompt(t, '1'), 10);
    return others[v - 1] || null;
  }

  function renderSheet(body) {
    if (body) bodyEl = body;
    draw();
  }

  function draw() {
    if (!bodyEl || !document.body.contains(bodyEl)) return;
    var box = bodyEl;
    box.innerHTML = '';
    var top = el('div', 'display:flex;gap:8px;margin-top:4px');
    top.appendChild(btn('＋ งานใหม่', function () {
      var n = prompt('ชื่องานใหม่', 'งาน ' + (st.list.length + 1));
      if (n === null || !n.trim()) return;
      var p = { id: 'p' + uid(), name: n.trim(), show: true };
      st.list.push(p); st.active = p.id; openProj[p.id] = true;
      notify(); draw();
    }, true));
    var imp = btn('นำเข้าไฟล์งาน', function () { fi.click(); });
    top.appendChild(imp);
    var fi = document.createElement('input');
    fi.type = 'file'; fi.accept = '.json,.trailproj,application/json'; fi.hidden = true;
    fi.onchange = function () {
      var f = fi.files && fi.files[0];
      if (!f) return;
      f.text().then(function (t) { var nm = importData(JSON.parse(t)); ctx.toast('นำเข้าแล้ว: ' + nm); draw(); }).catch(function (e) { ctx.toast('นำเข้าไม่ได้: ' + (e && e.message ? e.message : 'ไฟล์ไม่ถูกต้อง')); });
      fi.value = '';
    };
    top.appendChild(fi);
    box.appendChild(top);
    box.appendChild(el('p', 'font-size:12px;color:#777;line-height:1.5;margin:8px 0 0', 'งานคือชุดเดียวที่รวมเส้นทาง สัญลักษณ์ทหาร และหมุด ข้อมูลถูกเก็บไว้ในเครื่อง ปิดแอพแล้วเปิดใหม่ยังอยู่ ติ๊กแสดง/ซ่อนทีละงาน หรือทีละรายการ แล้วนำเข้างานจากเครื่องอื่นมาแสดงรวมกันได้'));

    // ฟอร์มปักหมุด
    box.appendChild(el('h4', 'margin:14px 0 6px;font-size:13px;color:#666', 'ปักหมุดใหม่ใน "' + nameOf(active()) + '"'));
    var nameIn = el('input', 'flex:1;min-width:0;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px');
    nameIn.type = 'text'; nameIn.placeholder = 'ชื่อหมุด เช่น จุดรวมพล, ยอดเขา A';
    var f1 = el('div', 'display:flex;gap:8px;align-items:center;margin:6px 0');
    f1.appendChild(nameIn);
    box.appendChild(f1);
    var fmtSel = el('select', 'flex:1;min-width:0;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px;background:#fff');
    G.FORMATS.forEach(function (f) {
      var o = el('option', '', G.FORMAT_NAMES[f]); o.value = f; if (f === pinFmt) o.selected = true; fmtSel.appendChild(o);
    });
    var f2 = el('div', 'display:flex;gap:8px;align-items:center;margin:6px 0');
    f2.appendChild(fmtSel);
    box.appendChild(f2);
    var coordIn = el('input', 'flex:1;min-width:0;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px');
    coordIn.type = 'text';
    var curBtn = btn('กลางจอ', function () {}, false);
    curBtn.style.flex = 'none';
    var f3 = el('div', 'display:flex;gap:8px;align-items:center;margin:6px 0');
    f3.appendChild(coordIn); f3.appendChild(curBtn);
    box.appendChild(f3);
    G.bindCoord(coordIn, fmtSel, curBtn, function () { return ctx.map().getCenter(); }, function (f) { pinFmt = f; });
    var f4 = el('div', 'display:flex;gap:8px;margin:6px 0');
    f4.appendChild(btn('ปักหมุด', function () {
      var ll;
      if (coordIn.value.trim()) {
        ll = G.parsePoint(coordIn.value);
        if (!ll) { ctx.toast('อ่านพิกัดไม่ได้ ตรวจรูปแบบ: ' + G.FORMAT_HINT[pinFmt]); return; }
      } else { var c = ctx.map().getCenter(); ll = { lat: c.lat, lng: c.lng }; }
      var p = { id: uid(), name: nameIn.value.trim() || 'หมุด ' + (pins.length + 1), lat: ll.lat, lng: ll.lng, proj: active(), show: true };
      pins.push(p);
      reveal(active());
      openProj[active()] = true;
      notify(); mountPin(p);
      ctx.map().easeTo({ center: [ll.lng, ll.lat], duration: 500 });
      draw();
    }, true));
    f4.appendChild(btn('ใช้หมุดแดงที่แตะไว้', function () {
      var pp = ctx.getPin();
      if (!pp) { ctx.toast('ยังไม่มีหมุดแดง แตะแผนที่หนึ่งครั้งเพื่อปักหมุดแดงก่อน'); return; }
      coordIn.value = G.formatPoint(pp.lat, pp.lng, fmtSel.value);
    }, false));
    box.appendChild(f4);

    // รายการงาน
    box.appendChild(el('h4', 'margin:14px 0 6px;font-size:13px;color:#666', 'งานทั้งหมด (' + st.list.length + ')'));
    st.list.forEach(function (p) { box.appendChild(projBlock(p)); });
  }

  function projBlock(p) {
    var rs = TrailNav.items().filter(inProj(p.id)), ss = TrailSym.items().filter(inProj(p.id)), ps = pins.filter(inProj(p.id));
    var blk = el('div', 'border:2px solid ' + (p.id === active() ? '#2e6b3f' : '#e2e2e2') + ';border-radius:12px;padding:8px 10px;margin:8px 0');
    var r1 = el('div', 'display:flex;align-items:center;gap:8px');
    var cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = p.show;
    cb.style.cssText = 'width:22px;height:22px;flex:none;accent-color:#2e6b3f';
    cb.onchange = function () { p.show = cb.checked; notify(); };
    r1.appendChild(cb);
    var nm = el('div', 'flex:1;font-weight:700;font-size:15px', p.name);
    r1.appendChild(nm);
    if (p.id === active()) r1.appendChild(el('span', 'font-size:12px;color:#2e6b3f;font-weight:700', '● ปัจจุบัน'));
    else r1.appendChild(btn('ใช้งานนี้', function () { st.active = p.id; save(); draw(); ctx.toast('ของใหม่ที่สร้างจะเก็บใน "' + p.name + '"'); }, false));
    blk.appendChild(r1);
    blk.appendChild(el('div', 'font-size:12px;color:#777;margin:2px 0 6px 30px', 'เส้นทาง ' + rs.length + ' · สัญลักษณ์ ' + ss.length + ' · หมุด ' + ps.length));
    var r2 = el('div', 'display:flex;gap:6px;flex-wrap:wrap');
    r2.appendChild(btn(openProj[p.id] ? '▲ ซ่อนรายการ' : '▼ รายการ', function () { openProj[p.id] = !openProj[p.id]; draw(); }, false));
    r2.appendChild(btn('ชื่อ', function () {
      var n = prompt('ชื่องาน', p.name);
      if (n === null || !n.trim()) return;
      p.name = n.trim(); notify(); draw();
    }, false));
    r2.appendChild(btn('ส่งออก', function () {
      var d = projData(p.id);
      TrailExport.share({ name: safeName(p.name) + '.trailproj.json', mime: 'application/json', text: JSON.stringify(d) }).then(function (ok) {
        if (!ok) { TrailExport.download({ name: safeName(p.name) + '.trailproj.json', mime: 'application/json', text: JSON.stringify(d) }); ctx.toast('ดาวน์โหลดไฟล์งานแล้ว (ดูในแอพไฟล์)'); }
      });
    }, false));
    r2.appendChild(btn('รวมเข้ากับ…', function () {
      var t = chooseProject(p.id, 'ย้ายข้อมูลทั้งหมดใน "' + p.name + '" ไปรวมกับงานหมายเลข:');
      if (!t) return;
      [TrailNav.items(), TrailSym.items(), pins].forEach(function (arr) { arr.forEach(function (x) { if (projOf(x) === p.id) x.proj = t.id; }); });
      removeProject(p.id, true);
      TrailNav.commit(); TrailSym.commit(); notify(); draw();
      ctx.toast('รวมเข้ากับ "' + t.name + '" แล้ว');
    }, false));
    r2.appendChild(btn('ลบงาน', function () {
      if (!confirm('ลบงาน "' + p.name + '" พร้อมข้อมูลทั้งหมดในงาน?\n(เส้นทาง ' + rs.length + ' · สัญลักษณ์ ' + ss.length + ' · หมุด ' + ps.length + ')')) return;
      rs.forEach(function (r) { TrailNav.removeRoute(r.id); });
      ss.forEach(function (s) { TrailSym.removeSym(s.id); });
      ps.forEach(function (x) { unmountPin(x.id); });
      pins = pins.filter(function (x) { return projOf(x) !== p.id; });
      removeProject(p.id, false);
      TrailNav.commit(); TrailSym.commit(); notify(); draw();
    }, false));
    blk.appendChild(r2);
    if (openProj[p.id]) {
      itemGroup(blk, '⚑ เส้นทาง', rs, 'route');
      itemGroup(blk, '✚ สัญลักษณ์ทหาร', ss, 'sym');
      itemGroup(blk, '📍 หมุด', ps, 'pin');
    }
    return blk;
  }

  function removeProject(id) {
    st.list = st.list.filter(function (p) { return p.id !== id; });
    if (!st.list.length) st.list.push({ id: 'default', name: 'งานทั่วไป', show: true });
    if (!byId(st.active)) st.active = st.list[0].id;
  }

  function itemLabel(kind, x) {
    if (kind === 'sym') {
      var t = TrailSym.TYPES.filter(function (y) { return y.id === x.type; })[0];
      return x.label || (t ? t.name : 'สัญลักษณ์');
    }
    return x.name;
  }

  function itemGroup(blk, title, arr, kind) {
    if (!arr.length) return;
    blk.appendChild(el('div', 'font-size:12px;color:#666;font-weight:700;margin:8px 0 2px', title));
    function commit() {
      if (kind === 'route') TrailNav.commit(); else if (kind === 'sym') TrailSym.commit(); else { save(); refreshPins(); }
    }
    arr.forEach(function (x) {
      var row = el('div', 'display:flex;align-items:center;gap:6px;padding:4px 0;border-top:1px solid #f0f0f0');
      row.appendChild(check(x, function () { commit(); notify(); }));
      row.appendChild(el('div', 'flex:1;min-width:0;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', itemLabel(kind, x)));
      row.appendChild(btn('ดู', function () {
        x.show = true; reveal(projOf(x)); commit(); notify();
        if (kind === 'route') TrailNav.zoomRoute(x);
        else ctx.map().easeTo({ center: [x.lng, x.lat], zoom: Math.max(ctx.map().getZoom(), 14), duration: 600 });
      }, false));
      row.appendChild(btn('ชื่อ', function () {
        var n = prompt('ตั้งชื่อ', itemLabel(kind, x));
        if (n === null) return;
        n = n.trim();
        if (kind === 'sym') x.label = n; else if (n) x.name = n; else return;
        if (kind === 'pin') mountPin(x);
        commit(); notify(); draw();
      }, false));
      row.appendChild(btn('ย้าย', function () {
        var t = chooseProject(projOf(x), 'ย้ายไปงานหมายเลข:');
        if (!t) return;
        x.proj = t.id; commit(); notify(); draw();
      }, false));
      row.appendChild(btn('ลบ', function () {
        if (!confirm('ลบ "' + itemLabel(kind, x) + '" ?')) return;
        if (kind === 'route') TrailNav.removeRoute(x.id);
        else if (kind === 'sym') TrailSym.removeSym(x.id);
        else { unmountPin(x.id); pins = pins.filter(function (y) { return y.id !== x.id; }); }
        commit(); notify(); draw();
      }, false));
      blk.appendChild(row);
    });
  }

  // เพิ่มหมุดจากโมดูลอื่น (เช่น ต้นเสียง) เข้างานปัจจุบัน
  function addPin(name, lat, lng) {
    var p = { id: uid(), name: name, lat: lat, lng: lng, proj: active(), show: true };
    pins.push(p);
    reveal(active());
    notify();
    mountPin(p);
    return p;
  }

  root.TrailProj = {
    addPin: addPin,
    init: init, renderSheet: renderSheet, onChange: onChange, isVisible: isVisible, active: active, nameOf: nameOf,
    reveal: reveal, visiblePins: visiblePins
  };
})(typeof self !== 'undefined' ? self : this);
