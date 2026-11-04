// ค้นหาลักษณะภูมิประเทศจากข้อมูลความสูง (DEM): ยอดเขา สันเขา คอเขา หุบเขา ร่องน้ำ หน้าผา ที่ต่ำ/เส้นคุ้งกระทะ
// วิเคราะห์ในเครื่อง บนข้อมูลความสูงละเอียดราว 30-40 ม. ต่อจุด (ไทล์ซูม 12) รอบจุดกลางจอ 3x3 ไทล์ (กว้างราว 28 กม.)
// ผลเป็นการประมาณจากข้อมูลความสูง ไม่ใช่การสำรวจ: ต้องตรวจกับสภาพจริงและแผนที่ทางการเสมอ
(function (root) {
  var C = TrailCommon;
  var G = TrailGeo;
  var Z = 12;
  var SPAN = 3;
  var TILE = 256;
  var W = SPAN * TILE;
  var N = W * W;

  var T_STREAM = 120; // เซลล์ที่รับน้ำเข้ามาอย่างน้อยเท่านี้ ถือเป็นร่องน้ำ (~0.17 ตร.กม.)
  var T_VALLEY = 2500; // รับน้ำมากพอเป็นแกนหุบเขา (~3.5 ตร.กม.)
  var T_RIDGE = 250; // ค่าเทียบเท่าของสันเขา (วิเคราะห์จากข้อมูลความสูงกลับด้าน)
  var CLIFF_DEG = 38; // ความชันตั้งแต่เท่านี้ขึ้นไปถือเป็นพื้นที่หน้าผา/ลาดชันมาก
  var DEPR_M = 5; // ลึกอย่างน้อยกี่เมตรถือเป็นแอ่ง
  var MAX_ITEMS = 25;

  var COLORS = { peak: '#7b3f00', ridge: '#c0661a', saddle: '#8e24aa', valley: '#1565c0', stream: '#29a8e0', cliff: '#d32f2f', depression: '#00897b' };
  var NAMES = { peak: 'ยอดเขา', ridge: 'สันเขา', saddle: 'คอเขา', valley: 'หุบเขา', stream: 'ร่องน้ำ', cliff: 'หน้าผา/ลาดชันมาก', depression: 'ที่ต่ำบนภูเขา (เส้นคุ้งกระทะ)' };
  var DIRS = ['เหนือ', 'ตอ.เฉียงเหนือ', 'ตะวันออก', 'ตอ.เฉียงใต้', 'ใต้', 'ตต.เฉียงใต้', 'ตะวันตก', 'ตต.เฉียงเหนือ'];

  var ctx = null; // { map: () => map, toast }
  var cache = null; // { key, data }
  var EMPTY = { type: 'FeatureCollection', features: [] };

  function init(c) {
    ctx = c;
    var map = ctx.map();
    map.addSource('terr-found', { type: 'geojson', data: EMPTY });
    var before = map.getLayer('traffic') ? 'traffic' : undefined;
    map.addLayer({ id: 'terr-fill', type: 'fill', source: 'terr-found', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': ['get', 'c'], 'fill-opacity': 0.45 } }, before);
    map.addLayer({
      id: 'terr-lines', type: 'line', source: 'terr-found', filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'c'], 'line-width': ['coalesce', ['get', 'w'], 3], 'line-opacity': 0.9 }
    }, before);
    map.addLayer({
      id: 'terr-points', type: 'circle', source: 'terr-found', filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 7, 'circle-color': ['get', 'c'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 }
    }, before);
    map.addLayer({
      id: 'terr-labels', type: 'symbol', source: 'terr-found', filter: ['all', ['==', ['geometry-type'], 'Point'], ['has', 'label']],
      layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-allow-overlap': false },
      paint: { 'text-color': '#222', 'text-halo-color': '#fff', 'text-halo-width': 1.6 }
    }, before);
  }

  function clear() { var m = ctx && ctx.map(); if (m && m.getSource('terr-found')) m.getSource('terr-found').setData(EMPTY); }

  /* ---------- โหลดข้อมูลความสูง ---------- */
  function tileOf(lng, lat) {
    var n = Math.pow(2, Z), r = lat * Math.PI / 180;
    return { x: Math.floor((lng + 180) / 360 * n), y: Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n) };
  }

  function loadDem(tx0, ty0, onStatus) {
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = W;
    var c2 = cv.getContext('2d', { willReadFrequently: true });
    var jobs = [], got = 0, i, j;
    for (j = 0; j < SPAN; j++) for (i = 0; i < SPAN; i++) jobs.push({ i: i, j: j });
    onStatus('โหลดข้อมูลความสูง…');
    return Promise.all(jobs.map(function (jb) {
      var x = tx0 + jb.i, y = ty0 + jb.j, max = Math.pow(2, Z) - 1;
      if (y < 0 || y > max) return Promise.resolve();
      var url = C.fillTemplate(C.DEM_TEMPLATE, { z: Z, x: ((x % (max + 1)) + max + 1) % (max + 1), y: y });
      return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
        .then(function (b) { return createImageBitmap(b, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }); })
        .then(function (bm) { c2.drawImage(bm, jb.i * TILE, jb.j * TILE); if (bm.close) bm.close(); got++; })
        .catch(function () { /* ไทล์นี้ไม่มี */ });
    })).then(function () {
      if (got < 5) throw new Error('ไม่มีข้อมูลความสูงของบริเวณนี้ ต้องต่ออินเทอร์เน็ต หรือดาวน์โหลดพื้นที่นี้ไว้ก่อน');
      var d = c2.getImageData(0, 0, W, W).data, dem = new Float32Array(N), p, q = 0, filled = 0, sum = 0;
      for (p = 0; p < N; p++, q += 4) {
        if (d[q + 3] === 0) { dem[p] = NaN; continue; }
        dem[p] = d[q] * 256 + d[q + 1] + d[q + 2] / 256 - 32768;
        sum += dem[p]; filled++;
      }
      var mean = filled ? sum / filled : 0;
      for (p = 0; p < N; p++) if (isNaN(dem[p])) dem[p] = mean; // ช่องที่ไม่มีข้อมูล
      return dem;
    });
  }

  /* ---------- Priority-Flood: เติมแอ่ง + ทิศน้ำไหล ---------- */
  function Heap(n) { this.k = new Float32Array(n); this.v = new Int32Array(n); this.n = 0; }
  Heap.prototype.push = function (key, val) {
    var k = this.k, v = this.v, i = this.n++;
    while (i > 0) { var p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  };
  Heap.prototype.pop = function () {
    var k = this.k, v = this.v, top = v[0], n = --this.n;
    if (n > 0) {
      var key = k[n], val = v[n], i = 0;
      for (;;) {
        var l = 2 * i + 1;
        if (l >= n) break;
        var r = l + 1, c = (r < n && k[r] < k[l]) ? r : l;
        if (k[c] >= key) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = key; v[i] = val;
    }
    return top;
  };

  var DX = [-1, 0, 1, -1, 1, -1, 0, 1], DY = [-1, -1, -1, 0, 0, 1, 1, 1];

  // คืน filled (ความสูงหลังเติมแอ่ง), parent (เซลล์ที่น้ำไหลต่อไป), acc (จำนวนเซลล์ที่ไหลมารวมกัน)
  function flood(dem) {
    var filled = new Float32Array(N), parent = new Int32Array(N).fill(-1), closed = new Uint8Array(N), order = new Int32Array(N);
    var heap = new Heap(N), x, y, c;
    for (x = 0; x < W; x++) { c = x; closed[c] = 1; filled[c] = dem[c]; heap.push(dem[c], c); c = (W - 1) * W + x; closed[c] = 1; filled[c] = dem[c]; heap.push(dem[c], c); }
    for (y = 1; y < W - 1; y++) { c = y * W; closed[c] = 1; filled[c] = dem[c]; heap.push(dem[c], c); c = y * W + W - 1; closed[c] = 1; filled[c] = dem[c]; heap.push(dem[c], c); }
    var oi = 0, k, nx, ny, nb;
    while (heap.n > 0) {
      c = heap.pop();
      order[oi++] = c;
      x = c % W; y = (c - x) / W;
      for (k = 0; k < 8; k++) {
        nx = x + DX[k]; ny = y + DY[k];
        if (nx < 0 || ny < 0 || nx >= W || ny >= W) continue;
        nb = ny * W + nx;
        if (closed[nb]) continue;
        closed[nb] = 1;
        parent[nb] = c;
        filled[nb] = dem[nb] > filled[c] ? dem[nb] : filled[c];
        heap.push(filled[nb], nb);
      }
    }
    var acc = new Float32Array(N).fill(1), i, p;
    for (i = oi - 1; i >= 0; i--) { c = order[i]; p = parent[c]; if (p >= 0) acc[p] += acc[c]; }
    return { filled: filled, parent: parent, acc: acc };
  }

  /* ---------- แปลงพิกัดพิกเซล -> ละติจูด/ลองจิจูด ---------- */
  function mkGeo(tx0, ty0) {
    var scale = TILE * Math.pow(2, Z);
    return function (px, py) {
      var gx = tx0 * TILE + px, gy = ty0 * TILE + py;
      var n = Math.PI - 2 * Math.PI * gy / scale;
      return { lng: gx / scale * 360 - 180, lat: Math.atan(Math.sinh(n)) * 180 / Math.PI };
    };
  }

  function bearingName(a, b) {
    var p1 = a.lat * Math.PI / 180, p2 = b.lat * Math.PI / 180, dl = (b.lng - a.lng) * Math.PI / 180;
    var y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    var brg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    return DIRS[Math.round(brg / 45) % 8];
  }

  /* ---------- วิเคราะห์ ---------- */
  function connected(mask, conn8, minSize) {
    var label = new Int32Array(N).fill(-1), comps = [], stack = [], c, x, y, k, nx, ny, nb, kmax = conn8 ? 8 : 4, dxs = conn8 ? DX : [0, -1, 1, 0], dys = conn8 ? DY : [-1, 0, 0, 1];
    for (c = 0; c < N; c++) {
      if (!mask[c] || label[c] >= 0) continue;
      var cells = [], id = comps.length;
      stack.push(c); label[c] = id;
      while (stack.length) {
        var cur = stack.pop();
        cells.push(cur);
        x = cur % W; y = (cur - x) / W;
        for (k = 0; k < kmax; k++) {
          nx = x + dxs[k]; ny = y + dys[k];
          if (nx < 0 || ny < 0 || nx >= W || ny >= W) continue;
          nb = ny * W + nx;
          if (mask[nb] && label[nb] < 0) { label[nb] = id; stack.push(nb); }
        }
      }
      if (cells.length >= minSize) comps.push(cells); else { for (k = 0; k < cells.length; k++) label[cells[k]] = -2; comps.push(null); }
    }
    return { comps: comps.filter(Boolean), label: label };
  }

  function analyse(dem, tx0, ty0, cellM, onStatus) {
    var geo = mkGeo(tx0, ty0), out = { peak: [], ridge: [], saddle: [], valley: [], stream: [], cliff: [], depression: [], cellM: cellM };
    var x, y, c, k;
    onStatus('วิเคราะห์ทางน้ำและหุบเขา…');
    var fl = flood(dem);

    // ร่องน้ำ / หุบเขา / สันเขา: เส้นทางน้ำไหลรวมกัน แบ่งเป็นช่วงระหว่างจุดบรรจบ (แต่ละช่วงเป็นหนึ่งรายการ)
    function segments(accArr, parentArr, lo, hi) {
      var mask = new Uint8Array(N), child = new Uint8Array(N), res = [], q;
      for (c = 0; c < N; c++) if (accArr[c] >= lo && accArr[c] < hi && dem[c] > 2) mask[c] = 1;
      for (c = 0; c < N; c++) if (mask[c]) { q = parentArr[c]; if (q >= 0 && mask[q] && child[q] < 255) child[q]++; }
      for (c = 0; c < N; c++) {
        if (!mask[c] || child[c] === 1) continue; // เริ่มช่วงใหม่ที่ต้นทาง (ไม่มีสาขา) หรือจุดบรรจบ (สาขาตั้งแต่ 2)
        var cells = [c], cur = c;
        for (;;) {
          q = parentArr[cur];
          if (q < 0 || !mask[q]) break;
          cells.push(q); cur = q;
          if (child[cur] !== 1) break;
        }
        if (cells.length < 8) continue; // สั้นกว่า ~300 ม. ไม่นับ
        var segs = [], lo2 = 1e9, hi2 = -1e9, k2;
        for (k2 = 0; k2 < cells.length; k2++) {
          var cl = cells[k2], xx = cl % W, yy = (cl - xx) / W;
          if (dem[cl] < lo2) lo2 = dem[cl];
          if (dem[cl] > hi2) hi2 = dem[cl];
          if (k2 > 0) { var pc = cells[k2 - 1], px = pc % W, py = (pc - px) / W; segs.push([px + 0.5, py + 0.5, xx + 0.5, yy + 0.5]); }
        }
        var mid = cells[cells.length >> 1], mx = mid % W, my = (mid - mx) / W, ll = geo(mx + 0.5, my + 0.5);
        res.push({ cells: cells.length, lengthM: (cells.length - 1) * cellM * 1.1, lat: ll.lat, lng: ll.lng, elev: dem[mid], lo: lo2, hi: hi2, segs: segs, acc: accArr[cells[cells.length - 1]] });
      }
      return res;
    }
    out.stream = segments(fl.acc, fl.parent, T_STREAM, T_VALLEY);
    out.valley = segments(fl.acc, fl.parent, T_VALLEY, 1e12);

    onStatus('วิเคราะห์สันเขา…');
    var neg = new Float32Array(N);
    for (c = 0; c < N; c++) neg[c] = -dem[c];
    var inv = flood(neg);
    out.ridge = segments(inv.acc, inv.parent, T_RIDGE, 1e12);

    onStatus('วิเคราะห์ยอดเขาและคอเขา…');
    // ยอดเขา: สูงสุดในรัศมี 8 พิกเซล และสูงกว่ารอบๆ อย่างน้อย 25 ม.
    var cand = [], ring = [], a, rr, rx, ry, i2;
    for (y = 9; y < W - 9; y++) {
      for (x = 9; x < W - 9; x++) {
        c = y * W + x;
        var z = dem[c];
        if (z < 10) continue;
        var ok = true;
        for (k = 0; k < 8 && ok; k++) if (dem[(y + DY[k]) * W + x + DX[k]] > z) ok = false;
        if (!ok) continue;
        var mn = 1e9;
        for (i2 = 0; i2 < 16 && ok; i2++) {
          a = i2 * Math.PI / 8;
          for (rr = 4; rr <= 8 && ok; rr += 4) {
            rx = Math.round(x + rr * Math.cos(a)); ry = Math.round(y + rr * Math.sin(a));
            var zz = dem[ry * W + rx];
            if (zz > z) ok = false;
            if (rr === 8 && zz < mn) mn = zz;
          }
        }
        if (ok && z - mn >= 25) cand.push({ x: x, y: y, z: z, relief: z - mn });
      }
    }
    cand.sort(function (p, q) { return q.z - p.z; });
    var kept = [];
    cand.forEach(function (p) {
      if (kept.some(function (q) { return Math.abs(q.x - p.x) < 10 && Math.abs(q.y - p.y) < 10; })) return;
      kept.push(p);
    });
    out.peak = kept.map(function (p) { var ll = geo(p.x + 0.5, p.y + 0.5); return { lat: ll.lat, lng: ll.lng, elev: p.z, relief: p.relief }; });

    // คอเขา: วงแหวนรอบจุดมีสูง-ต่ำสลับกันสองคู่ (รัศมี 4 พิกเซล)
    var sad = [];
    for (y = 6; y < W - 6; y++) {
      for (x = 6; x < W - 6; x++) {
        c = y * W + x;
        var z0 = dem[c];
        if (z0 < 10) continue;
        var sgn = [], vals = [];
        for (i2 = 0; i2 < 16; i2++) {
          a = i2 * Math.PI / 8;
          var v = dem[Math.round(y + 4 * Math.sin(a)) * W + Math.round(x + 4 * Math.cos(a))];
          vals.push(v);
          sgn.push(v > z0 + 4 ? 1 : v < z0 - 4 ? -1 : 0);
        }
        var seq = [], idx = [];
        for (i2 = 0; i2 < 16; i2++) if (sgn[i2] !== 0) { seq.push(sgn[i2]); idx.push(i2); }
        if (seq.length < 8) continue;
        var changes = 0;
        for (i2 = 0; i2 < seq.length; i2++) if (seq[i2] !== seq[(i2 + 1) % seq.length]) changes++;
        if (changes !== 4) continue;
        var hiMin = 1e9, loMax = -1e9;
        for (i2 = 0; i2 < 16; i2++) { if (sgn[i2] === 1 && vals[i2] < hiMin) hiMin = vals[i2]; if (sgn[i2] === -1 && vals[i2] > loMax) loMax = vals[i2]; }
        if (hiMin - z0 < 8 || z0 - loMax < 8) continue;
        var hi8 = 1e9, lo8 = -1e9;
        for (i2 = 0; i2 < 16; i2++) {
          a = i2 * Math.PI / 8;
          var v8 = dem[Math.round(y + 8 * Math.sin(a)) * W + Math.round(x + 8 * Math.cos(a))];
          if (v8 > z0 + 4 && v8 < hi8) hi8 = v8;
          if (v8 < z0 - 4 && v8 > lo8) lo8 = v8;
        }
        if (hi8 - z0 >= 10 && z0 - lo8 >= 10) sad.push({ x: x, y: y, z: z0, score: Math.min(hiMin - z0, z0 - loMax, hi8 - z0, z0 - lo8) });
      }
    }
    sad.sort(function (p, q) { return q.score - p.score; });
    var sk = [];
    sad.forEach(function (p) {
      if (sk.some(function (q) { return Math.abs(q.x - p.x) < 9 && Math.abs(q.y - p.y) < 9; })) return;
      sk.push(p);
    });
    out.saddle = sk.map(function (p) { var ll = geo(p.x + 0.5, p.y + 0.5); return { lat: ll.lat, lng: ll.lng, elev: p.z, relief: p.score }; });

    onStatus('วิเคราะห์ความชันและแอ่ง…');
    // ความชัน (Horn) -> หน้าผา/ลาดชันมาก
    var cliffMask = new Uint8Array(N), slopeAt = new Float32Array(N);
    for (y = 1; y < W - 1; y++) {
      for (x = 1; x < W - 1; x++) {
        c = y * W + x;
        var z1 = dem[c - W - 1], z2 = dem[c - W], z3 = dem[c - W + 1], z4 = dem[c - 1], z6 = dem[c + 1], z7 = dem[c + W - 1], z8 = dem[c + W], z9 = dem[c + W + 1];
        var dzdx = ((z3 + 2 * z6 + z9) - (z1 + 2 * z4 + z7)) / (8 * cellM), dzdy = ((z7 + 2 * z8 + z9) - (z1 + 2 * z2 + z3)) / (8 * cellM);
        var sl = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * 180 / Math.PI;
        slopeAt[c] = sl;
        if (sl >= CLIFF_DEG && dem[c] > 20) cliffMask[c] = 1;
      }
    }
    out.cliff = connected(cliffMask, true, 3).comps.map(function (cells) {
      var sx = 0, sy = 0, mx = 0, zmax = -1e9, zmin = 1e9;
      cells.forEach(function (cl) { var xx = cl % W, yy = (cl - xx) / W; sx += xx; sy += yy; if (slopeAt[cl] > mx) mx = slopeAt[cl]; if (dem[cl] > zmax) zmax = dem[cl]; if (dem[cl] < zmin) zmin = dem[cl]; });
      var ll = geo(sx / cells.length + 0.5, sy / cells.length + 0.5);
      return { lat: ll.lat, lng: ll.lng, elev: (zmax + zmin) / 2, hi: zmax, lo: zmin, cells: cells, maxSlope: mx, areaM2: cells.length * cellM * cellM };
    });

    // ที่ต่ำ (แอ่งปิด): ความสูงหลังเติมต่างจากเดิมอย่างน้อย DEPR_M
    var dmask = new Uint8Array(N), depth = new Float32Array(N);
    for (c = 0; c < N; c++) { depth[c] = fl.filled[c] - dem[c]; if (depth[c] >= DEPR_M && dem[c] > 20) dmask[c] = 1; }
    var dcomp = connected(dmask, false, 6);
    out.depression = dcomp.comps.map(function (cells) {
      var sx = 0, sy = 0, dmax = 0, bottom = cells[0];
      cells.forEach(function (cl) { var xx = cl % W, yy = (cl - xx) / W; sx += xx; sy += yy; if (depth[cl] > dmax) dmax = depth[cl]; if (dem[cl] < dem[bottom]) bottom = cl; });
      var bx = bottom % W, by = (bottom - bx) / W, ll = geo(bx + 0.5, by + 0.5);
      return { lat: ll.lat, lng: ll.lng, elev: dem[bottom], depth: dmax, cells: cells, areaM2: cells.length * cellM * cellM, rim: dem[bottom] + dmax };
    });
    out.geo = geo;
    out.dmask = dmask;
    return out;
  }

  /* ---------- สร้างรายการ + ชั้นข้อมูลบนแผนที่ ---------- */
  function fmtLen(m) { return m >= 1000 ? (m / 1000).toFixed(1) + ' กม.' : Math.round(m) + ' ม.'; }

  function describe(kind, f, centre) {
    var d = G.haversine(centre, f), dir = bearingName(centre, f), e = Math.round(f.elev);
    var detail = '';
    if (kind === 'peak') detail = 'สูง ' + e + ' ม. · เด่นกว่าโดยรอบ ~' + Math.round(f.relief) + ' ม.';
    else if (kind === 'saddle') detail = 'สูง ' + e + ' ม. · ต่ำกว่ายอดสองข้างอย่างน้อย ~' + Math.round(f.relief) + ' ม.';
    else if (kind === 'ridge') detail = 'ช่วงสันเขายาวราว ' + fmtLen(f.lengthM) + ' · สูง ' + Math.round(f.lo) + '–' + Math.round(f.hi) + ' ม.';
    else if (kind === 'valley' || kind === 'stream') detail = 'ช่วงยาวราว ' + fmtLen(f.lengthM) + ' · ระดับ ' + Math.round(f.lo) + '–' + Math.round(f.hi) + ' ม.';
    else if (kind === 'cliff') detail = 'ลาดชันสูงสุด ~' + Math.round(f.maxSlope) + '° · ช่วงสูง ' + Math.round(f.lo) + '–' + Math.round(f.hi) + ' ม.';
    else if (kind === 'depression') detail = 'พื้นสูง ' + e + ' ม. · ลึก ~' + Math.round(f.depth) + ' ม. · กว้าง ' + Math.round(f.areaM2 / 100) / 10 + ' พัน ตร.ม.';
    return { kind: kind, name: NAMES[kind], lat: f.lat, lng: f.lng, elev: f.elev, detail: detail, dist: d, dir: dir };
  }

  function overlayFor(kind, feats, geo, items, osmNames) {
    var out = [], col = COLORS[kind];
    function pt(f, label) { return { type: 'Feature', properties: { c: col, label: label || '' }, geometry: { type: 'Point', coordinates: [f.lng, f.lat] } }; }
    if (kind === 'peak' || kind === 'saddle') {
      feats.forEach(function (f) { out.push(pt(f, (kind === 'peak' ? '▲ ' : '◇ ') + Math.round(f.elev) + (f.osmName ? ' ' + f.osmName : ''))); });
    } else if (kind === 'ridge' || kind === 'valley' || kind === 'stream') {
      feats.forEach(function (f) {
        var lines = f.segs.map(function (s) { var a = geo(s[0], s[1]), b = geo(s[2], s[3]); return [[a.lng, a.lat], [b.lng, b.lat]]; });
        out.push({ type: 'Feature', properties: { c: col, w: kind === 'stream' ? 2 : 3.5 }, geometry: { type: 'MultiLineString', coordinates: lines } });
      });
    } else if (kind === 'cliff') {
      feats.slice(0, 120).forEach(function (f) {
        f.cells.forEach(function (cl) {
          var x = cl % W, y = (cl - x) / W, a = geo(x, y), b = geo(x + 1, y + 1);
          out.push({ type: 'Feature', properties: { c: col }, geometry: { type: 'Polygon', coordinates: [[[a.lng, a.lat], [b.lng, a.lat], [b.lng, b.lat], [a.lng, b.lat], [a.lng, a.lat]]] } });
        });
      });
    } else if (kind === 'depression') {
      feats.forEach(function (f) {
        var inSet = {}, edges = [], ticks = [];
        f.cells.forEach(function (cl) { inSet[cl] = 1; });
        f.cells.forEach(function (cl) {
          var x = cl % W, y = (cl - x) / W;
          [[0, -1, x, y, x + 1, y, 0, 0.35], [0, 1, x, y + 1, x + 1, y + 1, 0, -0.35], [-1, 0, x, y, x, y + 1, 0.35, 0], [1, 0, x + 1, y, x + 1, y + 1, -0.35, 0]].forEach(function (s, si) {
            if (inSet[(y + s[1]) * W + x + s[0]]) return;
            var a = geo(s[2], s[3]), b = geo(s[4], s[5]);
            edges.push([[a.lng, a.lat], [b.lng, b.lat]]);
            if ((x + y + si) % 2 === 0) { var mx = (s[2] + s[4]) / 2, my = (s[3] + s[5]) / 2, t1 = geo(mx, my), t2 = geo(mx + s[6], my + s[7]); ticks.push([[t1.lng, t1.lat], [t2.lng, t2.lat]]); }
          });
        });
        out.push({ type: 'Feature', properties: { c: col, w: 2 }, geometry: { type: 'MultiLineString', coordinates: edges } });
        out.push({ type: 'Feature', properties: { c: col, w: 1.5 }, geometry: { type: 'MultiLineString', coordinates: ticks } });
        out.push(pt(f, Math.round(f.elev) + ' ม.'));
      });
    }
    return out;
  }

  // คืน Promise<{ items:[...], note }> และวาดผลลงแผนที่
  function find(kind, onStatus) {
    onStatus = onStatus || function () {};
    var map = ctx.map(), cn = map.getCenter();
    if (cn.lat <= -80 || cn.lat >= 84) return Promise.reject(new Error('พิกัดนอกช่วง'));
    var t = tileOf(cn.lng, cn.lat), tx0 = t.x - 1, ty0 = t.y - 1, key = tx0 + ',' + ty0;
    var cellM = 156543.03392 * Math.cos(cn.lat * Math.PI / 180) / Math.pow(2, Z); // เมตรต่อพิกเซลที่ซูม Z (ไทล์ 256 พิกเซล)
    var work = cache && cache.key === key ? Promise.resolve(cache.data) : loadDem(tx0, ty0, onStatus).then(function (dem) {
      return new Promise(function (res) { setTimeout(function () { res(analyse(dem, tx0, ty0, cellM, onStatus)); }, 30); });
    }).then(function (data) { cache = { key: key, data: data }; return data; });
    return work.then(function (data) {
      var centre = { lat: cn.lat, lng: cn.lng };
      var feats = data[kind] || [];
      var items;
      // เติมชื่อยอดเขาจากข้อมูลแผนที่ที่โหลดอยู่ (OSM) ถ้าอยู่ใกล้กัน
      if (kind === 'peak') {
        var named = [];
        try {
          map.querySourceFeatures('openmaptiles', { sourceLayer: 'mountain_peak' }).forEach(function (f) {
            var nm = f.properties['name:th'] || f.properties.name;
            if (nm && f.geometry && f.geometry.type === 'Point') named.push({ name: nm, lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], ele: f.properties.ele });
          });
        } catch (e) { /* ยังไม่มีข้อมูลเวกเตอร์ */ }
        feats.forEach(function (f) {
          var nb = null, bd = 400;
          named.forEach(function (n) { var d = G.haversine(f, n); if (d < bd) { bd = d; nb = n; } });
          f.osmName = nb ? nb.name : null;
        });
      }
      // เลือกรายการสำคัญ (ใหญ่/เด่น) แล้วเรียงตามระยะห่างจากกลางจอ
      var score = { peak: function (f) { return f.relief; }, saddle: function (f) { return f.relief; }, ridge: function (f) { return f.acc; }, valley: function (f) { return f.acc; }, stream: function (f) { return f.acc; }, cliff: function (f) { return f.cells.length; }, depression: function (f) { return f.depth * f.cells.length; } }[kind];
      var top = feats.slice().sort(function (a, b) { return score(b) - score(a); }).slice(0, Math.max(MAX_ITEMS * 2, 40));
      top.forEach(function (f) { f.d = G.haversine(centre, f); });
      top.sort(function (a, b) { return a.d - b.d; });
      top = top.slice(0, MAX_ITEMS);
      items = top.map(function (f) { var it = describe(kind, f, centre); if (f.osmName) it.name = f.osmName + ' (' + NAMES.peak + ')'; return it; });
      var isLine = kind === 'ridge' || kind === 'valley' || kind === 'stream';
      var fc = { type: 'FeatureCollection', features: overlayFor(kind, isLine ? feats.slice(0, 3000) : top, data.geo, items) };
      map.getSource('terr-found').setData(fc);
      return { items: items, total: feats.length, kind: kind };
    });
  }

  root.TrailTerrain = { init: init, find: find, clear: clear, NAMES: NAMES, COLORS: COLORS };
})(typeof self !== 'undefined' ? self : this);
