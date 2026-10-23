// บันทึกการเดินทาง: เก็บจุด GPS ตั้งแต่เริ่มจนสิ้นสุด เก็บในเครื่อง ส่งออกเป็น GPX
// ข้อจำกัดของเว็บบน iPhone: ถ้าล็อคจอหรือสลับแอพ GPS จะหยุด จึงมีตัวกันจอดับและแจ้งเตือนช่วงที่ขาด
(function (root) {
  var G = TrailGeo;
  var S = TrailSensors;
  var IDX = 'trail_tracks_v1'; // รายการสรุป [{id,name,start,end,n,dist,asc}]
  var ACTIVE = 'trail_rec_active_v1'; // id ของเส้นที่กำลังบันทึก
  var PTS = 'trail_track_pts_';
  var MAX_ACC = 100; // เมตร ตัดจุดที่คลาดเคลื่อนมาก
  var MIN_STEP = 3; // เมตร ไม่เก็บจุดที่ขยับน้อยกว่านี้ (ยกเว้นผ่านไป 15 วินาที)

  var ctx = null;
  var list = [];
  var rec = null; // { id, name, start, pts:[[lat,lng,alt,acc,ts]], dist, asc, lastSave, hiddenAt, gaps }
  var wakeLock = null;
  var wakeKeys = {};
  var shown = null;
  var EMPTY = { type: 'FeatureCollection', features: [] };

  function $(id) { return document.getElementById(id); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function clock(ms) { var t = Math.max(0, Math.floor(ms / 1000)); return pad2(Math.floor(t / 3600)) + ':' + pad2(Math.floor((t % 3600) / 60)) + ':' + pad2(t % 60); }
  function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(2) + ' กม.' : Math.round(m) + ' ม.'; }
  function defName(ts) { var d = new Date(ts); return 'การเดินทาง ' + pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function loadIdx() { try { list = JSON.parse(localStorage.getItem(IDX) || '[]'); } catch (e) { list = []; } }
  function saveIdx() { try { localStorage.setItem(IDX, JSON.stringify(list)); } catch (e) { ctx.toast('บันทึกรายการไม่ได้ (พื้นที่เก็บข้อมูลเต็ม?)'); } }
  function readPts(id) { try { return JSON.parse(localStorage.getItem(PTS + id) || '[]'); } catch (e) { return []; } }
  function writePts(id, pts) {
    try { localStorage.setItem(PTS + id, JSON.stringify(pts)); return true; } catch (e) {
      ctx.toast('บันทึกจุดไม่ได้ พื้นที่เก็บข้อมูลเต็ม กรุณาลบการเดินทางเก่า');
      return false;
    }
  }

  function measure(pts) {
    var d = 0, a = 0;
    for (var i = 1; i < pts.length; i++) {
      d += G.haversine({ lat: pts[i - 1][0], lng: pts[i - 1][1] }, { lat: pts[i][0], lng: pts[i][1] });
      var a0 = pts[i - 1][2], a1 = pts[i][2];
      if (typeof a0 === 'number' && typeof a1 === 'number' && a1 - a0 > 3) a += a1 - a0;
    }
    return { dist: d, asc: a };
  }

  /* ---------- กันจอดับ (ใช้ร่วมกับทีม) ---------- */
  function wakeWanted() { for (var k in wakeKeys) if (wakeKeys[k]) return true; return false; }
  function applyWake() {
    if (!('wakeLock' in navigator)) return;
    if (wakeWanted() && !wakeLock && document.visibilityState === 'visible') {
      navigator.wakeLock.request('screen').then(function (l) {
        wakeLock = l;
        l.addEventListener('release', function () { wakeLock = null; });
      }).catch(function () { /* ไม่ให้ก็ไม่เป็นไร */ });
    } else if (!wakeWanted() && wakeLock) {
      wakeLock.release().catch(function () {});
      wakeLock = null;
    }
  }
  function holdWake(key, on) { wakeKeys[key] = !!on; applyWake(); }

  /* ---------- แผนที่ ---------- */
  function draw(coords) {
    var m = ctx.map();
    if (!m.getSource('rec')) return;
    m.getSource('rec').setData(coords && coords.length > 1
      ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } : EMPTY);
  }
  function liveCoords() { return rec ? rec.pts.map(function (p) { return [p[1], p[0]]; }) : []; }

  function init(c) {
    ctx = c;
    loadIdx();
    var map = ctx.map();
    map.addSource('rec', { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'rec-casing', type: 'line', source: 'rec', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 8, 'line-opacity': 0.9 } }, 'grid-lines');
    map.addLayer({ id: 'rec-line', type: 'line', source: 'rec', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#d6261c', 'line-width': 5 } }, 'grid-lines');
    S.onFix(onFix);

    var chip = document.createElement('button');
    chip.className = 'chip';
    chip.id = 'recChip';
    chip.hidden = true;
    chip.style.cssText = 'font-size:13px;padding:7px 12px;background:#ffe3e0';
    chip.onclick = function () { ctx.showSheet('rec'); };
    var top = $('top');
    if (top) top.appendChild(chip);

    document.addEventListener('visibilitychange', function () {
      if (rec) {
        if (document.visibilityState === 'hidden') rec.hiddenAt = Date.now();
        else if (rec.hiddenAt && Date.now() - rec.hiddenAt > 20000) {
          rec.gaps++;
          ctx.toast('ช่วงที่ปิดจอหรือสลับแอพ ไม่มีจุดบันทึก (เว็บบน iPhone ทำงานเบื้องหลังไม่ได้)');
          rec.hiddenAt = 0;
        }
        saveNow();
      }
      applyWake();
    });
    window.addEventListener('pagehide', saveNow);
    setInterval(tick, 1000);

    // แอพถูกปิดหรือโหลดใหม่กลางทาง: บันทึกต่อจากเดิม
    var aid = null;
    try { aid = localStorage.getItem(ACTIVE); } catch (e) { aid = null; }
    var meta = aid && list.filter(function (x) { return x.id === aid; })[0];
    if (meta) {
      var pts = readPts(aid);
      var ms = measure(pts);
      rec = { id: aid, name: meta.name, start: meta.start, pts: pts, dist: ms.dist, asc: ms.asc, lastSave: Date.now(), hiddenAt: 0, gaps: 1 };
      holdWake('rec', true);
      draw(liveCoords());
      ctx.toast('กลับมาบันทึกการเดินทางต่อ (แอพถูกโหลดใหม่ ช่วงที่ขาดไม่มีจุด)');
    }
    updateChip();
  }

  function onFix(f) {
    if (!rec || !f || typeof f.lat !== 'number') return;
    if (typeof f.acc === 'number' && f.acc > MAX_ACC) return;
    var last = rec.pts[rec.pts.length - 1];
    var ts = f.t || Date.now();
    if (last) {
      var d = G.haversine({ lat: last[0], lng: last[1] }, f);
      if (d < MIN_STEP && ts - last[4] < 15000) return;
      rec.dist += d;
      if (typeof last[2] === 'number' && typeof f.alt === 'number' && f.alt - last[2] > 3) rec.asc += f.alt - last[2];
    }
    rec.pts.push([+f.lat.toFixed(6), +f.lng.toFixed(6), typeof f.alt === 'number' ? Math.round(f.alt * 10) / 10 : null, typeof f.acc === 'number' ? Math.round(f.acc) : null, ts]);
    if (Date.now() - rec.lastSave > 10000) saveNow();
    draw(liveCoords());
  }

  function saveNow() {
    if (!rec) return;
    rec.lastSave = Date.now();
    writePts(rec.id, rec.pts);
  }

  function tick() {
    updateChip();
    var el = $('recLive');
    if (el && rec) el.innerHTML = liveHtml();
  }

  function updateChip() {
    var c = $('recChip');
    if (!c) return;
    c.hidden = !rec;
    if (rec) c.textContent = '● ' + clock(Date.now() - rec.start) + ' · ' + fmtDist(rec.dist);
  }

  function start() {
    if (rec) return;
    var ts = Date.now();
    rec = { id: String(ts), name: defName(ts), start: ts, pts: [], dist: 0, asc: 0, lastSave: ts, hiddenAt: 0, gaps: 0 };
    list.push({ id: rec.id, name: rec.name, start: ts, end: null, n: 0, dist: 0, asc: 0 });
    saveIdx();
    try { localStorage.setItem(ACTIVE, rec.id); } catch (e) { /* ไม่เป็นไร */ }
    holdWake('rec', $('recWake') ? $('recWake').checked : true);
    draw([]);
    // ต้องมี GPS วิ่งอยู่ ถ้ายังไม่เปิดให้เปิดให้เลย
    try { if (!S.state.fix || ts - S.state.fix.t > 30000) ctx.geolocate.trigger(); } catch (e) { /* ไม่เป็นไร */ }
    updateChip();
  }

  function stop() {
    if (!rec) return;
    saveNow();
    var meta = list.filter(function (x) { return x.id === rec.id; })[0];
    if (meta) { meta.end = Date.now(); meta.n = rec.pts.length; meta.dist = rec.dist; meta.asc = rec.asc; meta.name = rec.name; }
    saveIdx();
    try { localStorage.removeItem(ACTIVE); } catch (e) { /* ไม่เป็นไร */ }
    var gaps = rec.gaps;
    rec = null;
    holdWake('rec', false);
    updateChip();
    ctx.toast('บันทึกการเดินทางแล้ว' + (gaps ? ' (มีช่วงที่ขาด ' + gaps + ' ช่วงเพราะปิดจอ)' : ''));
  }

  /* ---------- ส่งออก GPX ---------- */
  function buildGPX(name, pts) {
    var s = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="แผนที่เดินป่าออฟไลน์" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>' + esc(name) + '</name><trkseg>\n';
    pts.forEach(function (p) {
      s += '<trkpt lat="' + p[0].toFixed(6) + '" lon="' + p[1].toFixed(6) + '">' + (typeof p[2] === 'number' ? '<ele>' + p[2].toFixed(1) + '</ele>' : '') + '<time>' + new Date(p[4]).toISOString() + '</time></trkpt>\n';
    });
    return s + '</trkseg></trk>\n</gpx>\n';
  }

  function exportTrack(id) {
    var meta = list.filter(function (x) { return x.id === id; })[0];
    var pts = rec && rec.id === id ? rec.pts : readPts(id);
    if (!meta || pts.length < 2) { ctx.toast('เส้นทางนี้ยังไม่มีจุดบันทึก'); return; }
    var file = { name: (meta.name || 'trip').replace(/[\\/:*?"<>|]/g, '-') + '.gpx', mime: 'application/gpx+xml', text: buildGPX(meta.name, pts) };
    TrailExport.share(file).then(function (ok) { if (!ok) { TrailExport.download(file); ctx.toast('ดาวน์โหลดไฟล์ GPX แล้ว'); } });
  }

  function showTrack(id) {
    var pts = rec && rec.id === id ? rec.pts : readPts(id);
    if (pts.length < 2) { ctx.toast('เส้นทางนี้ยังไม่มีจุดบันทึก'); return; }
    var coords = pts.map(function (p) { return [p[1], p[0]]; });
    shown = id;
    draw(coords);
    var b = new maplibregl.LngLatBounds(coords[0], coords[0]);
    coords.forEach(function (c) { b.extend(c); });
    ctx.closeSheet();
    ctx.map().fitBounds(b, { padding: 60, duration: 700 });
  }

  function removeTrack(id) {
    if (rec && rec.id === id) return;
    if (!confirm('ลบการเดินทางนี้?')) return;
    list = list.filter(function (x) { return x.id !== id; });
    try { localStorage.removeItem(PTS + id); } catch (e) { /* ไม่เป็นไร */ }
    saveIdx();
    if (shown === id) { shown = null; draw(liveCoords()); }
  }

  function renameTrack(id) {
    var meta = list.filter(function (x) { return x.id === id; })[0];
    if (!meta) return;
    var n = prompt('ตั้งชื่อ', meta.name);
    if (n === null) return;
    meta.name = n.trim() || meta.name;
    if (rec && rec.id === id) rec.name = meta.name;
    saveIdx();
  }

  /* ---------- แผ่นล่าง ---------- */
  function liveHtml() {
    if (!rec) return '';
    return '<b>● กำลังบันทึก</b> ' + clock(Date.now() - rec.start) + ' · ' + fmtDist(rec.dist) + ' · ขึ้น ' + Math.round(rec.asc) + ' ม. · ' + rec.pts.length + ' จุด' +
      (rec.pts.length === 0 ? '<br><span style="color:#b3261e">ยังไม่ได้ตำแหน่ง GPS แตะปุ่มตำแหน่ง (◎) บนแผนที่</span>' : '');
  }

  function renderSheet(body) {
    var h = '<div style="background:#fff0f0;border:2px solid #d6261c;border-radius:10px;padding:8px 10px;font-size:12.5px;line-height:1.5;color:#7a0d08;margin-bottom:8px">' +
      '<b>เว็บบน iPhone บันทึกตอนล็อคจอไม่ได้</b> ต้องเปิดจอและเปิดแอพค้างไว้ ถ้าล็อคจอหรือสลับแอพ GPS จะหยุดและเส้นทางจะขาดช่วง</div>' +
      '<label class="opt"><input type="checkbox" id="recWake" checked><span>กันหน้าจอดับระหว่างบันทึก<small>ช่วยให้บันทึกต่อเนื่อง แต่กินแบตมากขึ้น</small></span></label>' +
      '<div id="recLive" style="margin:8px 0;font-size:14px;line-height:1.6">' + liveHtml() + '</div>' +
      '<div class="btnrow"><button class="btn" id="recToggle" style="' + (rec ? 'background:#d6261c' : '') + '">' + (rec ? '■ หยุดบันทึก' : '● เริ่มบันทึกการเดินทาง') + '</button></div>' +
      '<h4>การเดินทางที่บันทึกไว้ (' + list.length + ')</h4><div id="recList"></div>';
    body.innerHTML = h;
    $('recWake').onchange = function () { if (rec) holdWake('rec', this.checked); };
    $('recToggle').onclick = function () {
      if (rec) stop(); else start();
      renderSheet(body);
    };
    var box = $('recList');
    if (!list.length) box.innerHTML = '<div class="note">ยังไม่มีการเดินทางที่บันทึกไว้</div>';
    list.slice().reverse().forEach(function (t) {
      var active = rec && rec.id === t.id;
      var d = active ? rec.dist : t.dist, a = active ? rec.asc : t.asc, n = active ? rec.pts.length : t.n;
      var row = document.createElement('div');
      row.className = 'prow';
      row.innerHTML = '<div style="font-weight:600">' + (active ? '● ' : '') + esc(t.name) + '</div>' +
        '<div style="font-size:12.5px;color:#666;margin:2px 0 6px">' + fmtDist(d) + ' · ขึ้น ' + Math.round(a) + ' ม. · ' + (t.end ? clock(t.end - t.start) : 'กำลังบันทึก') + ' · ' + n + ' จุด</div>' +
        '<div class="btnrow" style="margin-top:0"><button class="btn alt" data-a="show">ดูบนแผนที่</button><button class="btn alt" data-a="gpx">ส่งออก GPX</button><button class="btn alt" data-a="name">ชื่อ</button><button class="btn alt" data-a="del"' + (active ? ' disabled' : '') + '>ลบ</button></div>';
      row.onclick = function (e) {
        var a = e.target && e.target.getAttribute('data-a');
        if (!a) return;
        if (a === 'show') showTrack(t.id);
        else if (a === 'gpx') exportTrack(t.id);
        else if (a === 'name') { renameTrack(t.id); renderSheet(body); }
        else if (a === 'del') { removeTrack(t.id); renderSheet(body); }
      };
      box.appendChild(row);
    });
  }

  root.TrailRec = { init: init, renderSheet: renderSheet, holdWake: holdWake, isRecording: function () { return !!rec; } };
})(typeof self !== 'undefined' ? self : this);
