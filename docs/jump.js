// โหมดโดดร่ม (ช่วยวางแผน/ฝึกเท่านั้น): ความสูงจาก GPS, คำนวณจุดปล่อยจากลมแต่ละชั้นความสูง, เส้นบิน (jump run), นับถอยหลังด้วย GPS
// ไม่ใช่เครื่องวัดความสูงที่ได้รับการรับรองและไม่ใช่อุปกรณ์ความปลอดภัย ห้ามใช้ตัดสินใจเปิดร่ม
(function (root) {
  var G = TrailGeo;
  var S = TrailSensors;
  var KEY = 'trail_jump_v1';
  var FT = 0.3048, KT = 0.514444;
  var ctx = null;
  var st = {
    lz: null, exitAgl: 12000, openAgl: 3500, vff: 53, vcan: 5, fwd: 10, margin: 300, thr: 150, magnetic: false, track: false, calAlt: null, fmt: 'mgrs',
    winds: [{ h: 0, dir: '', kt: '' }, { h: 3000, dir: '', kt: '' }, { h: 6000, dir: '', kt: '' }, { h: 9000, dir: '', kt: '' }, { h: 12000, dir: '', kt: '' }]
  };
  var res = null;
  var vs = { alt: null, t: 0, v: 0 }; // อัตราการเปลี่ยนความสูง (ม./วินาที)
  var wake = null;
  var bodyEl = null;

  function $(id) { return document.getElementById(id); }
  function norm180(a) { a = G.norm360(a); return a > 180 ? a - 360 : a; }
  function ft(m) { return m / FT; }
  function fmtFt(m) { return Math.round(ft(m)).toLocaleString('en-US'); }
  function fmtD(m) { return m >= 1000 ? (m / 1000).toFixed(2) + ' กม.' : Math.round(m) + ' ม.'; }
  function load() { try { var s = JSON.parse(localStorage.getItem(KEY) || '{}'); for (var k in st) if (s[k] !== undefined) st[k] = s[k]; } catch (e) { /* ค่าเริ่มต้น */ } st.track = false; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* ไม่เป็นไร */ } }

  function init(c) {
    ctx = c;
    load();
    var map = ctx.map();
    var empty = { type: 'FeatureCollection', features: [] };
    map.addSource('jump', { type: 'geojson', data: empty });
    map.addLayer({ id: 'jump-line', type: 'line', source: 'jump', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#ff2d95', 'line-width': 4, 'line-dasharray': [3, 2] } }, 'grid-lines');
    map.addLayer({ id: 'jump-pt', type: 'circle', source: 'jump', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 9, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } }, 'grid-lines');
    map.addLayer({ id: 'jump-lbl', type: 'symbol', source: 'jump', filter: ['==', ['geometry-type'], 'Point'], layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, 1.4], 'text-allow-overlap': true }, paint: { 'text-color': '#000', 'text-halo-color': '#fff', 'text-halo-width': 2 } }, 'grid-lines');
    var chip = document.createElement('button');
    chip.className = 'chip';
    chip.id = 'jumpChip';
    chip.hidden = true;
    chip.style.cssText = 'font-size:14px;font-weight:700;padding:7px 12px';
    chip.onclick = function () { ctx.showSheet('jump'); };
    if ($('top')) $('top').appendChild(chip);
    S.onFix(onFix);
  }

  /* ---------- ลมแต่ละชั้นความสูง ---------- */
  function windRows() {
    var rows = [];
    st.winds.forEach(function (w) {
      var d = parseFloat(w.dir), k = parseFloat(w.kt);
      if (isNaN(d) || isNaN(k) || k < 0) return;
      var from = st.magnetic ? G.norm360(d + (ctx.prefs.decl || 0)) : G.norm360(d);
      var to = (from + 180) * Math.PI / 180, ms = k * KT;
      rows.push({ h: w.h, e: ms * Math.sin(to), n: ms * Math.cos(to), from: from, kt: k });
    });
    rows.sort(function (a, b) { return a.h - b.h; });
    return rows;
  }
  function windAt(rows, hFt) {
    if (!rows.length) return { e: 0, n: 0 };
    if (hFt <= rows[0].h) return rows[0];
    if (hFt >= rows[rows.length - 1].h) return rows[rows.length - 1];
    for (var i = 1; i < rows.length; i++) {
      if (hFt <= rows[i].h) {
        var a = rows[i - 1], b = rows[i], t = (hFt - a.h) / (b.h - a.h);
        return { e: a.e + (b.e - a.e) * t, n: a.n + (b.n - a.n) * t };
      }
    }
    return rows[rows.length - 1];
  }
  function fromDeg(w) { return G.norm360(Math.atan2(-w.e, -w.n) * 180 / Math.PI); } // ทิศที่ลมมา

  /* ---------- คำนวณจุดปล่อย ---------- */
  function compute() {
    if (!st.lz) throw new Error('กำหนดจุดลงพื้น (LZ) ก่อน');
    if (st.exitAgl <= st.openAgl + 300) throw new Error('ความสูงปล่อยต้องมากกว่าความสูงเปิดร่ม');
    var rows = windRows();
    var exitM = st.exitAgl * FT, openM = st.openAgl * FT, dh = 30, h;
    var ff = { e: 0, n: 0, t: 0 }, cn = { e: 0, n: 0, t: 0 };
    for (h = exitM; h > openM; h -= dh) {
      var step = Math.min(dh, h - openM), w = windAt(rows, ft(h - step / 2)), dt = step / st.vff;
      ff.e += w.e * dt; ff.n += w.n * dt; ff.t += dt;
    }
    for (h = openM; h > 0; h -= dh) {
      var s2 = Math.min(dh, h), w2 = windAt(rows, ft(h - s2 / 2)), dt2 = s2 / st.vcan, sp = Math.hypot(w2.e, w2.n);
      if (sp > 0.05) { cn.e += (w2.e - st.fwd * w2.e / sp) * dt2; cn.n += (w2.n - st.fwd * w2.n / sp) * dt2; }
      cn.t += dt2;
    }
    var wOpen = windAt(rows, st.openAgl), spo = Math.hypot(wOpen.e, wOpen.n);
    var ue = spo > 0.05 ? wOpen.e / spo : 0, un = spo > 0.05 ? wOpen.n / spo : 1;
    var wExit = windAt(rows, st.exitAgl), spx = Math.hypot(wExit.e, wExit.n);
    var xe = spx > 0.05 ? wExit.e / spx : ue, xn = spx > 0.05 ? wExit.n / spx : un; // เวกเตอร์ชี้ไปทางที่ลมพัดไป ณ ชั้นปล่อย
    // ตำแหน่งสัมพัทธ์จาก LZ (เมตร, ตะวันออก/เหนือ)
    var openE = -cn.e - st.margin * ue, openN = -cn.n - st.margin * un;
    var exitE = openE - ff.e + st.thr * xe, exitN = openN - ff.n + st.thr * xn;
    function toLL(e, n) {
      var d = Math.hypot(e, n);
      return d < 0.5 ? { lat: st.lz.lat, lng: st.lz.lng } : G.destination(st.lz, G.norm360(Math.atan2(e, n) * 180 / Math.PI), d);
    }
    var heading = G.norm360(Math.atan2(-xe, -xn) * 180 / Math.PI + 0); // เครื่องบินบินทวนลม = ทิศที่ลมมา
    heading = G.norm360(Math.atan2(-xe, -xn) * 180 / Math.PI);
    res = {
      open: toLL(openE, openN), exit: toLL(exitE, exitN), lz: { lat: st.lz.lat, lng: st.lz.lng },
      heading: heading, ffT: ff.t, cnT: cn.t, ffDrift: Math.hypot(ff.e, ff.n), ffDir: G.norm360(Math.atan2(ff.e, ff.n) * 180 / Math.PI),
      cnDrift: Math.hypot(cn.e, cn.n), exitToLz: Math.hypot(exitE, exitN), windExit: { kt: spx / KT, from: spx > 0.05 ? fromDeg(wExit) : null },
      calm: !rows.length
    };
    return res;
  }

  function lineFeatures() {
    if (!res) return [];
    var a = G.destination(res.exit, G.norm360(res.heading + 180), 8000), b = G.destination(res.exit, res.heading, 3000);
    return [
      { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[a.lng, a.lat], [res.exit.lng, res.exit.lat], [b.lng, b.lat]] } },
      { type: 'Feature', properties: { name: 'Exit', color: '#ff2d95' }, geometry: { type: 'Point', coordinates: [res.exit.lng, res.exit.lat] } },
      { type: 'Feature', properties: { name: 'เปิดร่ม', color: '#ff9f0a' }, geometry: { type: 'Point', coordinates: [res.open.lng, res.open.lat] } },
      { type: 'Feature', properties: { name: 'LZ', color: '#30d158' }, geometry: { type: 'Point', coordinates: [res.lz.lng, res.lz.lat] } }
    ];
  }
  function drawMap(fit) {
    var f = lineFeatures();
    ctx.map().getSource('jump').setData({ type: 'FeatureCollection', features: f });
    if (fit && res) {
      var pts = [res.exit, res.open, res.lz], w = 1e9, s = 1e9, e = -1e9, n = -1e9;
      pts.forEach(function (p) { w = Math.min(w, p.lng); e = Math.max(e, p.lng); s = Math.min(s, p.lat); n = Math.max(n, p.lat); });
      ctx.closeSheet();
      ctx.map().fitBounds([[w, s], [e, n]], { padding: 90, maxZoom: 15, duration: 700 });
    }
  }

  /* ---------- ติดตามด้วย GPS ---------- */
  function enu(p, o) {
    return { e: (p.lng - o.lng) * 111320 * Math.cos(o.lat * Math.PI / 180), n: (p.lat - o.lat) * 110540 };
  }
  function ground() {
    if (!st.lz) return null;
    var g = TrailRoute.elevSync(st.lz.lat, st.lz.lng);
    return g;
  }
  function onFix(f) {
    if (!f) return;
    // อัตราขึ้น/ลง
    if (typeof f.alt === 'number') {
      if (vs.alt !== null && f.t > vs.t) {
        var v = (f.alt - vs.alt) / ((f.t - vs.t) / 1000);
        if (isFinite(v) && Math.abs(v) < 120) vs.v = vs.v * 0.5 + v * 0.5;
      }
      vs.alt = f.alt; vs.t = f.t;
    }
    updateChip();
    if ($('jumpLive')) drawLive();
  }
  function agl(f) {
    if (typeof f.alt !== 'number') return null;
    if (st.calAlt !== null) return f.alt - st.calAlt;
    var g = ground();
    return g === null ? null : f.alt - g;
  }
  function updateChip() {
    var chip = $('jumpChip');
    if (!chip) return;
    var f = S.state.fix;
    if (!st.track || !f) { chip.hidden = true; return; }
    var a = agl(f);
    chip.hidden = false;
    chip.textContent = '✈ ' + (a === null ? (typeof f.alt === 'number' ? fmtFt(f.alt) + ' ft MSL' : '– ft') : fmtFt(a) + ' ft AGL') + ' · ' + Math.round(ft(vs.v) * 60) + ' fpm · ' + (typeof f.speed === 'number' ? Math.round(f.speed / KT) : '–') + ' kt';
  }

  function drawLive() {
    var box = $('jumpLive');
    if (!box) return;
    var f = S.state.fix;
    if (!f) { box.textContent = 'ยังไม่มีสัญญาณ GPS — กดปุ่มตำแหน่ง (◎) ที่แผนที่ และอยู่ใกล้หน้าต่าง/ที่โล่ง'; return; }
    var a = agl(f), g = ground();
    var h = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 12px">' +
      '<div><div class="lbl">ความสูง AGL (อ้างอิง DZ)</div><div style="font-size:26px;font-weight:800">' + (a === null ? '–' : fmtFt(a)) + ' <small style="font-size:13px">ft</small></div></div>' +
      '<div><div class="lbl">อัตราขึ้น/ลง</div><div style="font-size:26px;font-weight:800">' + Math.round(ft(vs.v) * 60) + ' <small style="font-size:13px">ft/นาที</small></div></div>' +
      '<div><div class="lbl">ความสูง GPS (MSL)</div><div style="font-size:16px;font-weight:700">' + (typeof f.alt === 'number' ? fmtFt(f.alt) + ' ft (' + Math.round(f.alt) + ' ม.)' : '–') + (f.altAcc ? ' ±' + Math.round(f.altAcc * 3.28) + ' ft' : '') + '</div></div>' +
      '<div><div class="lbl">ความเร็วเหนือพื้น / ทิศ</div><div style="font-size:16px;font-weight:700">' + (typeof f.speed === 'number' ? Math.round(f.speed / KT) + ' kt (' + Math.round(f.speed * 3.6) + ' กม./ชม.)' : '–') + (typeof f.heading === 'number' && !isNaN(f.heading) ? ' · ' + Math.round(f.heading) + '°' : '') + '</div></div></div>';
    if (a === null) h += '<div style="color:#b36b00;font-size:12px;margin-top:4px">ยังไม่มีค่าอ้างอิงพื้น: กด "ตั้ง AGL = 0 ที่นี่" ขณะยืนบนพื้นที่ DZ ก่อนขึ้นเครื่อง หรือดาวน์โหลดแผนที่พื้นที่นี้ไว้ (ใช้ความสูงภูมิประเทศ)</div>';
    if (g !== null && typeof f.alt === 'number') h += '<div class="lbl" style="margin-top:4px">ความสูง GPS ต่างจากภูมิประเทศที่ LZ ' + fmtFt(f.alt - g) + ' ft (ประมาณ ± หลายสิบ ft)</div>';
    if (f.altAcc && f.altAcc > 30) h += '<div style="color:#d6261c;font-size:12px;margin-top:4px">ความแม่นยำความสูงต่ำ (±' + Math.round(f.altAcc * 3.28) + ' ft)</div>';
    if (res && st.track) {
      var he = Math.sin(res.heading * Math.PI / 180), hn = Math.cos(res.heading * Math.PI / 180);
      var p = enu(f, res.exit), along = p.e * he + p.n * hn, cross = p.e * hn - p.n * he;
      var gs = typeof f.speed === 'number' ? f.speed : 0;
      h += '<div style="margin-top:8px;border-top:1px solid #ddd;padding-top:6px"><b>ถึงจุดปล่อย (Exit)</b>: ';
      if (along < 0) h += 'อีก <b>' + fmtD(-along) + '</b>' + (gs > 5 ? ' ≈ <b>' + Math.round(-along / gs) + ' วินาที</b>' : '');
      else h += 'เลยมาแล้ว <b>' + fmtD(along) + '</b>';
      h += '<br>คลาดจากเส้นบิน: <b>' + fmtD(Math.abs(cross)) + (cross > 0 ? ' ด้านขวา' : ' ด้านซ้าย') + '</b> ของทิศบิน ' + Math.round(res.heading) + '°</div>';
    }
    box.innerHTML = h;
  }

  /* ---------- ดึงลมชั้นบนจากอินเทอร์เน็ต ---------- */
  function fetchWinds() {
    if (!st.lz) return Promise.reject(new Error('กำหนด LZ ก่อน'));
    if (!navigator.onLine) return Promise.reject(new Error('ออฟไลน์ — ใส่ลมเองจากการบรีฟ'));
    var lv = [1000, 925, 850, 700, 600];
    var v = [];
    lv.forEach(function (p) { v.push('wind_speed_' + p + 'hPa', 'wind_direction_' + p + 'hPa', 'geopotential_height_' + p + 'hPa'); });
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + st.lz.lat.toFixed(2) + '&longitude=' + st.lz.lng.toFixed(2) +
      '&current=wind_speed_10m,wind_direction_10m&hourly=' + v.join(',') + '&forecast_hours=1&wind_speed_unit=kn&timezone=auto';
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (j) {
      var elev = typeof j.elevation === 'number' ? j.elevation : (TrailRoute.elevSync(st.lz.lat, st.lz.lng) || 0);
      var pts = [];
      if (j.current && typeof j.current.wind_speed_10m === 'number') pts.push({ h: 33, kt: j.current.wind_speed_10m, dir: j.current.wind_direction_10m });
      lv.forEach(function (p) {
        var s = j.hourly['wind_speed_' + p + 'hPa'][0], d = j.hourly['wind_direction_' + p + 'hPa'][0], g = j.hourly['geopotential_height_' + p + 'hPa'][0];
        if (typeof s !== 'number' || typeof g !== 'number') return;
        var a = (g - elev) / FT;
        if (a > 150) pts.push({ h: a, kt: s, dir: d });
      });
      pts.sort(function (a, b) { return a.h - b.h; });
      if (pts.length < 2) throw new Error('ได้ข้อมูลลมไม่พอ');
      // แปลงเป็นเวกเตอร์เพื่อแทรกค่าที่ความสูงมาตรฐาน
      var rows = pts.map(function (p) { var to = (p.dir + 180) * Math.PI / 180; return { h: p.h, e: p.kt * Math.sin(to), n: p.kt * Math.cos(to) }; });
      st.winds.forEach(function (w) {
        var q = windAt(rows, w.h), kt = Math.hypot(q.e, q.n);
        w.kt = kt.toFixed(0);
        w.dir = Math.round(G.norm360(Math.atan2(-q.e, -q.n) * 180 / Math.PI)) + '';
      });
      st.magnetic = false;
      save();
      return true;
    });
  }

  /* ---------- หน้าจอ ---------- */
  function renderSheet(body) {
    if (body) bodyEl = body;
    if (!bodyEl) return;
    var b = bodyEl;
    var h = '<div style="background:#fff0f0;border:2px solid #d6261c;border-radius:10px;padding:8px 10px;font-size:12.5px;line-height:1.5;color:#7a0d08"><b>ใช้เพื่อวางแผน/ฝึกเท่านั้น</b> ไม่ใช่เครื่องวัดความสูงที่ได้รับการรับรองและไม่ใช่อุปกรณ์ความปลอดภัย ห้ามใช้ตัดสินใจเปิดร่มหรือแทน altimeter/AAD ของนักโดด ' +
      'GPS บนมือถืออัปเดตทีละ ~1 วินาที มีหน่วงและคลาดเคลื่อนความสูงหลายสิบฟุต ในการปล่อยจริงผู้ควบคุมการปล่อย (jumpmaster) และนักบินเป็นผู้ตัดสินจุดปล่อยเสมอ</div>';
    h += '<h4>ความสูงและตำแหน่งตอนนี้ (GPS ทำงานออฟไลน์ได้)</h4><div id="jumpLive" style="font-size:13px"></div>' +
      '<div class="btnrow"><button class="btn alt" id="jCal">ตั้ง AGL = 0 ที่นี่</button><button class="btn alt" id="jCalClr">ล้างค่าอ้างอิง</button></div>' +
      '<label class="opt"><input type="checkbox" id="jTrack"><span>แสดงแถบความสูงบนจอ + นับถอยหลังถึงจุดปล่อย<small>เปิดค้างหน้าจอไว้ (iPhone หยุด GPS เมื่อพับจอ/สลับแอพ)</small></span></label>';
    h += '<h4>จุดลงพื้น (LZ)</h4>' +
      '<div class="field"><select id="jFmt" style="flex:1;min-width:0;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px;background:#fff">' +
      G.FORMATS.map(function (f) { return '<option value="' + f + '"' + (f === st.fmt ? ' selected' : '') + '>' + G.FORMAT_NAMES[f] + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><input type="text" id="jLz" style="flex:1;min-width:0;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px"><button class="btn alt" id="jLzC" style="flex:none;padding:8px 10px">กลางจอ</button><button class="btn alt" id="jLzG" style="flex:none;padding:8px 10px">GPS</button></div>';
    h += '<h4>พารามิเตอร์</h4>' +
      num('jExit', 'ความสูงปล่อย AGL (ft)', st.exitAgl, 500) + num('jOpen', 'ความสูงเปิดร่ม AGL (ft)', st.openAgl, 100) +
      num('jVff', 'ความเร็วตกอิสระ (ม./วินาที)', st.vff, 1) + num('jVcan', 'อัตราร่อนลงของร่ม (ม./วินาที)', st.vcan, 0.5) +
      num('jFwd', 'ความเร็วบินไปข้างหน้าของร่ม (ม./วินาที)', st.fwd, 0.5) + num('jMar', 'เผื่อเหนือ LZ ทวนลม (ม.)', st.margin, 50) + num('jThr', 'ระยะพุ่งไปข้างหน้าหลังกระโดด (ม.)', st.thr, 10);
    h += '<h4>ลมแต่ละชั้นความสูง (ทิศที่ลม "มาจาก", ความเร็วเป็นนอต)</h4><table style="width:100%;font-size:14px"><tr><td></td><td>ทิศ °</td><td>นอต</td></tr>';
    st.winds.forEach(function (w, i) {
      h += '<tr><td style="padding:3px 4px;white-space:nowrap">' + (w.h === 0 ? 'พื้น' : w.h.toLocaleString('en-US') + ' ft') + '</td>' +
        '<td><input type="number" class="jw" data-i="' + i + '" data-k="dir" value="' + w.dir + '" inputmode="decimal" style="width:100%;font-size:16px;padding:6px;border:1px solid #ccc;border-radius:8px"></td>' +
        '<td><input type="number" class="jw" data-i="' + i + '" data-k="kt" value="' + w.kt + '" inputmode="decimal" style="width:100%;font-size:16px;padding:6px;border:1px solid #ccc;border-radius:8px"></td></tr>';
    });
    h += '</table><label class="opt"><input type="checkbox" id="jMag"><span>ทิศที่ใส่เป็นทิศแม่เหล็ก<small>ลมจากสนามบิน/ATIS มักเป็นแม่เหล็ก ลมชั้นบน (winds aloft) เป็นทิศจริง ใช้มุมเบี่ยงเบนที่ตั้งไว้ในแอพ</small></span></label>' +
      '<div class="btnrow"><button class="btn alt" id="jFetch">ดึงลมจากเน็ต (พยากรณ์)</button></div><div id="jMsg" class="note"></div>' +
      '<div class="btnrow"><button class="btn" id="jCalc">คำนวณจุดปล่อย</button></div><div id="jRes"></div>';
    b.innerHTML = h;
    function num(id, label, v, step) {
      return '<div class="field"><label style="flex:0 0 190px;font-size:13px">' + label + '</label><input type="number" id="' + id + '" value="' + v + '" step="' + step + '" inputmode="decimal"></div>';
    }
    $('jTrack').checked = st.track; $('jMag').checked = st.magnetic;
    if (st.lz) $('jLz').value = G.formatPoint(st.lz.lat, st.lz.lng, st.fmt);
    G.bindCoord($('jLz'), $('jFmt'), $('jLzC'), function () { return ctx.map().getCenter(); }, function (f) { st.fmt = f; save(); });
    $('jLzG').onclick = function () {
      var f = S.state.fix;
      if (!f) { ctx.toast('ยังไม่มี GPS'); return; }
      $('jLz').value = G.formatPoint(f.lat, f.lng, $('jFmt').value);
    };
    $('jCal').onclick = function () {
      var f = S.state.fix;
      if (!f || typeof f.alt !== 'number') { ctx.toast('ยังไม่มีความสูงจาก GPS'); return; }
      st.calAlt = f.alt; save(); drawLive(); updateChip();
      ctx.toast('ตั้งความสูงพื้นอ้างอิง = ' + Math.round(f.alt) + ' ม. (MSL) ของ GPS');
    };
    $('jCalClr').onclick = function () { st.calAlt = null; save(); drawLive(); };
    $('jTrack').onchange = function () { st.track = this.checked; setWake(st.track); updateChip(); drawLive(); };
    Array.prototype.forEach.call(b.querySelectorAll('.jw'), function (el) {
      el.onchange = function () { st.winds[+el.getAttribute('data-i')][el.getAttribute('data-k')] = el.value; save(); };
    });
    function readAll() {
      var txt = $('jLz').value.trim();
      if (txt) {
        var ll = G.parsePoint(txt);
        if (!ll) throw new Error('อ่านพิกัด LZ ไม่ได้ ตรวจรูปแบบ: ' + G.FORMAT_HINT[$('jFmt').value]);
        st.lz = ll;
      }
      st.exitAgl = parseFloat($('jExit').value) || 12000; st.openAgl = parseFloat($('jOpen').value) || 3500;
      st.vff = parseFloat($('jVff').value) || 53; st.vcan = parseFloat($('jVcan').value) || 5; st.fwd = parseFloat($('jFwd').value) || 0;
      st.margin = parseFloat($('jMar').value) || 0; st.thr = parseFloat($('jThr').value) || 0; st.magnetic = $('jMag').checked;
      save();
    }
    $('jFetch').onclick = function () {
      try { readAll(); } catch (e) { $('jMsg').textContent = e.message; return; }
      $('jMsg').textContent = 'กำลังดึงลมชั้นบน…';
      fetchWinds().then(function () { $('jMsg').textContent = 'ได้ลมจากแบบจำลองพยากรณ์ (เฉพาะ LZ ปัดเศษ ~1 กม.) ตรวจเทียบกับลมชั้นบนจากการบรีฟจริงก่อนใช้'; renderSheet(); if ($('jMsg')) $('jMsg').textContent = 'ได้ลมจากแบบจำลองพยากรณ์ — ตรวจเทียบกับลมชั้นบน (winds aloft) จากการบรีฟจริงก่อนใช้'; })
        .catch(function (e) { $('jMsg').textContent = 'ดึงลมไม่ได้: ' + e.message; });
    };
    $('jCalc').onclick = function () {
      try { readAll(); compute(); } catch (e) { $('jRes').innerHTML = '<p class="note" style="color:#d6261c"></p>'; $('jRes').firstChild.textContent = e.message; return; }
      showResult();
    };
    drawLive();
    if (res) showResult();
  }

  function showResult() {
    var box = $('jRes');
    if (!box || !res) return;
    var decl = ctx.prefs.decl || 0;
    var fmt = function (p) { return G.formatPoint(p.lat, p.lng, st.fmt); };
    var h = '<div class="prow" style="background:#f7f7f7;border-radius:10px;padding:8px 10px;margin-top:8px;font-size:13.5px;line-height:1.55">' +
      '<b>จุดปล่อย (Exit):</b> ' + fmt(res.exit) + '<br>' +
      '<b>ทิศบินของเครื่อง (ทวนลม):</b> ' + Math.round(res.heading) + '° จริง' + (decl ? ' · ' + Math.round(G.norm360(res.heading - decl)) + '° แม่เหล็ก' : '') + '<br>' +
      '<b>จุดเปิดร่ม:</b> ' + fmt(res.open) + '<br><b>LZ:</b> ' + fmt(res.lz) + '<br>' +
      'Exit อยู่ห่างจาก LZ ' + fmtD(res.exitToLz) + ' · ตกอิสระ ~' + Math.round(res.ffT) + ' วินาที (ลอยตามลม ' + fmtD(res.ffDrift) + ' ไปทาง ' + Math.round(res.ffDir) + '°) · ร่ม ~' + Math.round(res.cnT / 60 * 10) / 10 + ' นาที' +
      (res.windExit.from !== null ? '<br>ลม ณ ความสูงปล่อย: จาก ' + Math.round(res.windExit.from) + '° ' + Math.round(res.windExit.kt) + ' นอต' : '') +
      (res.calm ? '<br><b style="color:#b36b00">ไม่ได้ใส่ลม — คำนวณเป็นลมสงบ</b>' : '') + '</div>' +
      '<div class="btnrow"><button class="btn" id="jDraw">แสดงบนแผนที่</button><button class="btn alt" id="jPins">ปักหมุดลงงาน</button></div>' +
      '<p class="note">โมเดลง่าย: ลมแต่ละชั้นแทรกค่าเชิงเส้น ตกอิสระด้วยความเร็วคงที่ (ไม่รวมช่วงเร่งความเร็ว) ร่มบินทวนลม ไม่รวมความร้อนจากพื้นที่/กระแสลมเฉพาะที่/ท่าทางร่วงต่างกันของนักโดดแต่ละคน ' +
      'เอาไว้ฝึกคิดและเทียบกับการคำนวณของผู้ควบคุมการปล่อย ไม่ใช่ค่าสั่งการ</p>';
    box.innerHTML = h;
    $('jDraw').onclick = function () { drawMap(true); };
    $('jPins').onclick = function () {
      TrailProj.addPin('Exit (จุดปล่อย)', res.exit.lat, res.exit.lng);
      TrailProj.addPin('จุดเปิดร่ม', res.open.lat, res.open.lng);
      TrailProj.addPin('LZ', res.lz.lat, res.lz.lng);
      ctx.toast('ปักหมุด 3 จุดลงงานปัจจุบันแล้ว');
    };
    drawMap(false);
  }

  function setWake(on) {
    try {
      if (on && navigator.wakeLock) navigator.wakeLock.request('screen').then(function (l) { wake = l; }).catch(function () {});
      else if (!on && wake) { wake.release(); wake = null; }
    } catch (e) { /* ไม่เป็นไร */ }
  }

  root.TrailJump = { init: init, renderSheet: renderSheet };
})(typeof self !== 'undefined' ? self : this);
