// สัญลักษณ์ทางทหารบนแผนที่ (ทหารราบ รถถัง ปืนใหญ่ อากาศยาน ฯลฯ) แบ่งฝ่ายด้วยสีที่เห็นชัด
(function (root) {
  var G = TrailGeo;
  var KEY = 'trail_syms_v1';

  // สีที่ตัดกับแผนที่ (เขียว/น้ำตาลของป่าและภูเขา) เลือกให้แยกกันออกแม้พิมพ์ขาวดำเทา
  var SIDES = [
    { id: 'blue', name: 'ฟ้า · ฝ่ายเรา', c: '#1e63ff', ic: '#ffffff' },
    { id: 'red', name: 'แดง · ข้าศึก', c: '#e5191b', ic: '#ffffff' },
    { id: 'orange', name: 'ส้ม · ฝ่ายร่วม/พันธมิตร', c: '#ff7a00', ic: '#000000' },
    { id: 'magenta', name: 'ม่วงชมพู · ฝ่ายที่สาม/กรรมการ', c: '#d000d8', ic: '#ffffff' },
    { id: 'yellow', name: 'เหลือง · ไม่ทราบฝ่าย', c: '#ffe100', ic: '#000000' },
    { id: 'black', name: 'ดำ · อื่นๆ/เป้าหมาย', c: '#1c1c1c', ic: '#ffffff' }
  ];
  var SIDE_BY = {};
  SIDES.forEach(function (s) { SIDE_BY[s.id] = s; });

  var TYPES = [
    { id: 'inf', name: 'ทหารราบ' },
    { id: 'rcn', name: 'ลาดตระเวน/ทหารม้า' },
    { id: 'tank', name: 'รถถัง' },
    { id: 'apc', name: 'รถเกราะ/ราบยานเกราะ' },
    { id: 'art', name: 'ปืนใหญ่' },
    { id: 'aa', name: 'ต่อสู้อากาศยาน' },
    { id: 'eng', name: 'ทหารช่าง' },
    { id: 'ac', name: 'เครื่องบิน' },
    { id: 'hel', name: 'ฮ. (เฮลิคอปเตอร์)' },
    { id: 'hq', name: 'ที่บังคับการ' },
    { id: 'base', name: 'ที่ตั้ง/ค่ายทหาร' },
    { id: 'op', name: 'ที่สังเกตการณ์/ด่าน' }
  ];

  var AC_POLY = [[0, -.62], [.1, -.2], [.7, .1], [.7, .2], [.1, .1], [.08, .4], [.28, .52], [.28, .6], [0, .52], [-.28, .6], [-.28, .52], [-.08, .4], [-.1, .1], [-.7, .2], [-.7, .1], [-.1, -.2]];
  var FONT = '"Sarabun","Noto Sans Thai",-apple-system,sans-serif';

  // วาดสัญลักษณ์ที่ตำแหน่ง (cx,cy) กว้าง w พิกเซล (สูง 0.7w) พร้อมชื่อใต้สัญลักษณ์
  function draw(c, type, sideId, cx, cy, w, label) {
    var sd = SIDE_BY[sideId] || SIDES[0];
    var s = w / 2;
    function X(u) { return cx + u * s; }
    function Y(v) { return cy + v * s; }
    function line(u1, v1, u2, v2) { c.beginPath(); c.moveTo(X(u1), Y(v1)); c.lineTo(X(u2), Y(v2)); c.stroke(); }
    c.save();
    c.lineJoin = 'round'; c.lineCap = 'round';
    // กรอบ: ขอบขาวหนา + พื้นสีฝ่าย + ขอบดำ
    c.beginPath(); c.rect(X(-1), Y(-.7), 2 * s, 1.4 * s);
    c.lineWidth = s * 0.26; c.strokeStyle = '#ffffff'; c.stroke();
    c.fillStyle = sd.c; c.fill();
    c.lineWidth = s * 0.08; c.strokeStyle = '#000000'; c.stroke();
    // สัญลักษณ์ในกรอบ
    c.strokeStyle = sd.ic; c.fillStyle = sd.ic; c.lineWidth = s * 0.13;
    switch (type) {
      case 'inf': line(-1, -.7, 1, .7); line(-1, .7, 1, -.7); break;
      case 'rcn': line(-1, .7, 1, -.7); break;
      case 'tank': c.beginPath(); c.ellipse(X(0), Y(0), .62 * s, .34 * s, 0, 0, 7); c.stroke(); break;
      case 'apc':
        line(-1, -.7, 1, .7); line(-1, .7, 1, -.7);
        c.beginPath(); c.ellipse(X(0), Y(0), .55 * s, .3 * s, 0, 0, 7); c.fillStyle = sd.c; c.fill(); c.stroke();
        break;
      case 'art': c.beginPath(); c.arc(X(0), Y(0), .3 * s, 0, 7); c.fill(); break;
      case 'aa': c.beginPath(); c.arc(X(0), Y(.35), .6 * s, Math.PI, 2 * Math.PI); c.stroke(); line(-.6, .35, .6, .35); break;
      case 'eng':
        c.beginPath();
        [[-.5, .35], [-.5, -.3], [-.3, -.3], [-.3, -.1], [.3, -.1], [.3, -.3], [.5, -.3], [.5, .35]].forEach(function (p, i) { if (i) c.lineTo(X(p[0]), Y(p[1])); else c.moveTo(X(p[0]), Y(p[1])); });
        c.stroke();
        break;
      case 'ac':
        c.beginPath();
        AC_POLY.forEach(function (p, i) { if (i) c.lineTo(X(p[0]), Y(p[1])); else c.moveTo(X(p[0]), Y(p[1])); });
        c.closePath(); c.fill();
        break;
      case 'hel':
        line(-.8, -.45, .8, -.45); line(0, -.45, 0, -.2);
        c.beginPath(); c.ellipse(X(-.05), Y(.05), .36 * s, .2 * s, 0, 0, 7); c.fill();
        line(.3, .0, .8, -.18); line(.8, -.3, .8, -.05);
        break;
      case 'hq':
        line(-.5, .55, -.5, -.55);
        c.beginPath(); c.moveTo(X(-.5), Y(-.55)); c.lineTo(X(.55), Y(-.3)); c.lineTo(X(-.5), Y(-.05)); c.closePath(); c.fill();
        break;
      case 'base':
        c.beginPath(); c.moveTo(X(-.55), Y(.4)); c.lineTo(X(0), Y(-.4)); c.lineTo(X(.55), Y(.4)); c.closePath(); c.stroke();
        line(-.7, .4, .7, .4);
        break;
      case 'op':
        c.beginPath(); c.arc(X(0), Y(0), .3 * s, 0, 7); c.stroke();
        line(-.6, 0, .6, 0); line(0, -.6, 0, .6);
        break;
      default: break;
    }
    if (label) {
      var fs = Math.max(9, s * 0.7);
      c.font = '700 ' + fs.toFixed(1) + 'px ' + FONT;
      c.textAlign = 'center'; c.textBaseline = 'top';
      c.lineWidth = fs * 0.28; c.strokeStyle = '#ffffff';
      c.strokeText(label, cx, Y(.7) + s * 0.16);
      c.fillStyle = '#000000';
      c.fillText(label, cx, Y(.7) + s * 0.16);
    }
    c.restore();
  }

  /* ---------- ข้อมูลและเครื่องหมายบนแผนที่ ---------- */
  var ctx = null;
  var syms = [];
  var markers = {};
  var sel = null;
  var cur = { type: 'inf', side: 'blue', label: '' };
  var tab = 'sym';
  var coordFmt = 'mgrs';

  function $(id) { return document.getElementById(id); }
  function load() { try { syms = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { syms = []; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(syms)); } catch (e) { ctx.toast('บันทึกสัญลักษณ์ไม่ได้ (พื้นที่เก็บข้อมูลเต็ม?)'); } }
  function find(id) { return syms.filter(function (s) { return s.id === id; })[0] || null; }

  function elFor(sym) {
    var dpr = 2, cw = 130, ch = 48;
    var cv = document.createElement('canvas');
    cv.width = cw * dpr; cv.height = ch * dpr;
    cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
    cv.className = 'symmark';
    var c = cv.getContext('2d');
    c.scale(dpr, dpr);
    draw(c, sym.type, sym.side, cw / 2, 15, 36, sym.label);
    return cv;
  }

  function mount(sym) {
    unmount(sym.id);
    var el = elFor(sym);
    var m = new maplibregl.Marker({ element: el, draggable: true, offset: [0, 9] }).setLngLat([sym.lng, sym.lat]).addTo(ctx.map());
    m.on('dragend', function () {
      var ll = m.getLngLat();
      sym.lat = ll.lat; sym.lng = ll.lng;
      save();
      renderSheet();
    });
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      select(sym.id);
      ctx.showSheet('mil');
    });
    markers[sym.id] = m;
  }
  function unmount(id) { if (markers[id]) { markers[id].remove(); delete markers[id]; } }

  function init(c) {
    ctx = c;
    load();
    syms.forEach(mount);
  }

  function select(id) {
    sel = id;
    var s = find(id);
    if (s) { cur.type = s.type; cur.side = s.side; cur.label = s.label || ''; }
    tab = 'sym';
  }

  function place(latlng) {
    var s = { id: String(Date.now()) + Math.floor(Math.random() * 1000), type: cur.type, side: cur.side, label: cur.label, lat: latlng.lat, lng: latlng.lng };
    syms.push(s);
    save();
    mount(s);
    sel = s.id;
    return s;
  }

  function visible() { return syms.slice(); }

  /* ---------- แผงสัญลักษณ์ / พิมพ์ ---------- */
  var bodyEl = null;
  function renderSheet(body) {
    if (body) bodyEl = body;
    if (!bodyEl || !document.body.contains(bodyEl)) return;
    var h = '<div class="seg"><button id="tabSym" aria-pressed="' + (tab === 'sym') + '">สัญลักษณ์ทหาร</button><button id="tabPrt" aria-pressed="' + (tab === 'prt') + '">พิมพ์แผนที่ฝึก</button></div><div id="milBody"></div>';
    bodyEl.innerHTML = h;
    $('tabSym').onclick = function () { tab = 'sym'; renderSheet(); };
    $('tabPrt').onclick = function () { tab = 'prt'; renderSheet(); };
    if (tab === 'prt') TrailPrint.renderSheet($('milBody')); else renderSymTab($('milBody'));
  }

  function swatch(type, side, w) {
    var cv = document.createElement('canvas');
    var dpr = 2, cw = w + 8, ch = Math.round(w * 0.7) + 8;
    cv.width = cw * dpr; cv.height = ch * dpr; cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
    var c = cv.getContext('2d'); c.scale(dpr, dpr);
    draw(c, type, side, cw / 2, ch / 2, w, '');
    return cv;
  }

  function renderSymTab(box) {
    var h = '<h4>ชนิด</h4><div id="symTypes" style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px"></div>' +
      '<h4>ฝ่าย (สี)</h4><div id="symSides" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px"></div>' +
      '<div class="field"><label style="flex:0 0 70px">ชื่อ</label><input type="text" id="symLabel" placeholder="เช่น ร้อย.1, ม.1, A" style="flex:1;min-width:0;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px"></div>' +
      '<div class="field"><label style="flex:0 0 70px">พิกัด</label><select id="symFmt" style="flex:1;min-width:0;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px;background:#fff">' +
      G.FORMATS.map(function (f) { return '<option value="' + f + '"' + (f === coordFmt ? ' selected' : '') + '>' + G.FORMAT_NAMES[f] + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><input type="text" id="symCoord" style="flex:1;min-width:0;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px"><button type="button" class="btn alt" id="symCur" style="flex:none;padding:8px 10px">กลางจอ</button></div>' +
      '<div class="btnrow"><button class="btn" id="symAdd">ปักสัญลักษณ์</button>' +
      (sel ? '<button class="btn alt" id="symUpd">บันทึกที่แก้ไข</button><button class="btn alt" id="symDel">ลบ</button>' : '') + '</div>' +
      '<h4>ที่ปักไว้ (' + syms.length + ')</h4><div id="symList"></div>';
    box.innerHTML = h;

    var tg = $('symTypes');
    TYPES.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.style.cssText = 'border:2px solid ' + (cur.type === t.id ? '#2e6b3f' : '#ddd') + ';background:#fff;border-radius:10px;padding:4px 2px;font-size:11px;line-height:1.2;color:#222';
      b.appendChild(swatch(t.id, cur.side, 40));
      b.appendChild(document.createElement('br'));
      b.appendChild(document.createTextNode(t.name));
      b.onclick = function () { cur.type = t.id; cur.label = $('symLabel').value; renderSymTab(box); };
      tg.appendChild(b);
    });
    var sg = $('symSides');
    SIDES.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.style.cssText = 'border:2px solid ' + (cur.side === s.id ? '#000' : '#ddd') + ';background:#fff;border-radius:10px;padding:5px 3px;font-size:11px;line-height:1.2;color:#222;display:flex;align-items:center;gap:5px;text-align:left';
      var dot = document.createElement('span');
      dot.style.cssText = 'flex:none;width:18px;height:18px;border-radius:50%;border:2px solid #000;background:' + s.c;
      b.appendChild(dot);
      b.appendChild(document.createTextNode(s.name));
      b.onclick = function () { cur.side = s.id; cur.label = $('symLabel').value; renderSymTab(box); };
      sg.appendChild(b);
    });
    G.bindCoord($('symCoord'), $('symFmt'), $('symCur'), function () { return ctx.map().getCenter(); }, function (f) { coordFmt = f; });
    $('symLabel').value = cur.label;
    $('symLabel').oninput = function () { cur.label = this.value; };

    $('symAdd').onclick = function () {
      cur.label = $('symLabel').value.trim();
      var txt = $('symCoord').value.trim();
      var ll;
      if (txt) {
        ll = G.parsePoint(txt);
        if (!ll) { ctx.toast('อ่านพิกัดไม่ได้ ตรวจรูปแบบ: ' + G.FORMAT_HINT[coordFmt]); return; }
      } else {
        var c = ctx.map().getCenter();
        ll = { lat: c.lat, lng: c.lng };
      }
      place(ll);
      if (txt) ctx.map().easeTo({ center: [ll.lng, ll.lat], duration: 500 });
      renderSymTab(box);
      ctx.toast('ปักแล้ว ลากสัญลักษณ์เพื่อย้ายตำแหน่งได้');
    };
    if (sel) {
      $('symUpd').onclick = function () {
        var s = find(sel);
        if (!s) return;
        s.type = cur.type; s.side = cur.side; s.label = $('symLabel').value.trim();
        save(); mount(s); renderSymTab(box);
      };
      $('symDel').onclick = function () {
        syms = syms.filter(function (x) { return x.id !== sel; });
        unmount(sel); sel = null; save(); renderSymTab(box);
      };
    }

    var list = $('symList');
    if (!syms.length) list.innerHTML = '<p class="note">ยังไม่มี เลือกชนิดกับฝ่าย แล้วกด "ปักสัญลักษณ์" (ปักที่กากบาทกลางจอ) จากนั้นลากย้ายได้ แตะสัญลักษณ์บนแผนที่เพื่อแก้ไข</p>';
    syms.forEach(function (s) {
      var row = document.createElement('div');
      row.className = 'prow';
      row.style.cssText = 'display:flex;align-items:center;gap:8px' + (s.id === sel ? ';background:#eef6f0' : '');
      row.appendChild(swatch(s.type, s.side, 34));
      var tx = document.createElement('div');
      tx.style.cssText = 'flex:1;font-size:13px;line-height:1.35';
      var tname = TYPES.filter(function (t) { return t.id === s.type; })[0].name;
      var b = document.createElement('b');
      b.textContent = (s.label || tname);
      tx.appendChild(b);
      tx.appendChild(document.createElement('br'));
      tx.appendChild(document.createTextNode(tname + ' · ' + SIDE_BY[s.side].name.split(' · ')[0] + ' · ' + G.formatPoint(s.lat, s.lng, ctx.prefs.fmt)));
      row.appendChild(tx);
      row.onclick = function () { select(s.id); ctx.map().easeTo({ center: [s.lng, s.lat], duration: 500 }); renderSymTab(box); };
      list.appendChild(row);
    });
    if (syms.length) {
      var del = document.createElement('button');
      del.className = 'btn alt'; del.style.marginTop = '8px'; del.textContent = 'ลบทั้งหมด';
      del.onclick = function () {
        if (!confirm('ลบสัญลักษณ์ทั้งหมด ' + syms.length + ' รายการ?')) return;
        syms.forEach(function (s) { unmount(s.id); });
        syms = []; sel = null; save(); renderSymTab(box);
      };
      list.appendChild(del);
    }
  }

  root.TrailSym = { init: init, renderSheet: renderSheet, draw: draw, list: visible, SIDES: SIDES, TYPES: TYPES, SIDE_BY: SIDE_BY, select: select };
})(typeof self !== 'undefined' ? self : this);
