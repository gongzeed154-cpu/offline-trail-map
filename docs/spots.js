// จุดความสูงยอดเขา (X + ความสูง) และเส้นคุ้งกระทะ (วงปิดรอบที่ต่ำ มีขีดสั้นชี้เข้าหาที่ต่ำ) บนแผนที่เดินป่า
// คำนวณในเครื่องจากข้อมูลความสูง (DEM ไทล์ซูม 12 ละเอียดราว 30-40 ม.) ชุดเดียวกับเส้นชั้นความสูง ใช้ออฟไลน์ได้เมื่อดาวน์โหลดพื้นที่ไว้
// ยอดเขา = จุดสูงสุดที่สูงกว่าคอเขาที่ต่อไปยังที่สูงกว่าอย่างน้อย 1 ช่วงเส้นชั้น (จึงมีเส้นชั้นวงปิดล้อมรอบเสมอ)
// ความสูงเป็นค่าประมาณจากข้อมูลความสูง อาจต่างจากหมุดหมายในแผนที่ทหารได้หลายเมตร
(function (root) {
  var C = TrailCommon;
  var Z = 12, TILE = 256, MAX_TILES = 16, MIN_ZOOM = 12;
  var LINE_COLOR = '#a0602a';
  var EMPTY = { type: 'FeatureCollection', features: [] };
  var ctx = null, on = false, timer = 0, lastKey = '', running = false, again = false;

  function init(c) {
    ctx = c;
    addTo(ctx.map(), null, false);
    ctx.map().on('moveend', schedule);
  }

  // เพิ่มชั้นข้อมูลลงแผนที่ใดก็ได้ (แผนที่หลัก หรือแผนที่ชั่วคราวสำหรับพิมพ์) data = { pts, depr } หรือ null
  function addTo(map, data, visible) {
    map.addSource('spot-pts', { type: 'geojson', data: data ? data.pts : EMPTY });
    map.addSource('spot-depr', { type: 'geojson', data: data ? data.depr : EMPTY });
    var before = map.getLayer('traffic') ? 'traffic' : undefined;
    map.addLayer({
      id: 'depr-lines', type: 'line', source: 'spot-depr', minzoom: MIN_ZOOM,
      layout: { 'line-join': 'round', 'line-cap': 'butt', visibility: visible ? 'visible' : 'none' },
      paint: {
        'line-color': LINE_COLOR, 'line-opacity': 0.95,
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, ['match', ['get', 'k'], 'ring1', 0.9, 0.6], 16, ['match', ['get', 'k'], 'ring1', 2.0, 1.1]]
      }
    }, before);
    // เครื่องหมาย X วาดเป็นรูป (ไม่พึ่งฟอนต์ ใช้ออฟไลน์ได้แน่นอน)
    var px = 2, sz = 13 * px, cv = document.createElement('canvas'); cv.width = cv.height = sz;
    var g = cv.getContext('2d'); g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 4.5 * px; g.beginPath(); g.moveTo(3 * px, 3 * px); g.lineTo(10 * px, 10 * px); g.moveTo(10 * px, 3 * px); g.lineTo(3 * px, 10 * px); g.stroke();
    g.strokeStyle = '#2b1a0a'; g.lineWidth = 2 * px; g.stroke();
    if (!map.hasImage('spot-x')) map.addImage('spot-x', g.getImageData(0, 0, sz, sz), { pixelRatio: px });
    map.addLayer({
      id: 'spot-x', type: 'symbol', source: 'spot-pts', minzoom: MIN_ZOOM,
      layout: { visibility: visible ? 'visible' : 'none', 'icon-image': 'spot-x', 'icon-allow-overlap': true, 'icon-ignore-placement': true }
    }, before);
    map.addLayer({
      id: 'spot-ele', type: 'symbol', source: 'spot-pts', minzoom: MIN_ZOOM,
      layout: {
        visibility: visible ? 'visible' : 'none', 'text-field': ['to-string', ['get', 'ele']], 'text-font': ['Noto Sans Bold'], 'text-size': 12,
        'text-anchor': 'left', 'text-offset': [0.55, 0], 'text-optional': true, 'symbol-sort-key': ['-', 0, ['get', 'ele']]
      },
      paint: { 'text-color': '#2b1a0a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 }
    }, before);
    if (visible) peakNameOnly(map, true);
  }
  function peakNameOnly(map, yes) {
    if (!map.getLayer('peak')) return;
    map.setLayoutProperty('peak', 'text-field', yes ? ['coalesce', ['get', 'name'], ''] :
      ['format', ['coalesce', ['get', 'name'], ''], {}, '\n', {}, ['concat', '▲ ', ['to-string', ['coalesce', ['get', 'ele'], '']], ' ม.'], { 'font-scale': 0.9 }]);
    map.setLayoutProperty('peak', 'text-offset', yes ? [0, 0.9] : [0, 0]);
  }

  // คำนวณยอดเขาและที่ต่ำสำหรับกรอบพิกัด [w, s, e, n] ที่ซูม (สำหรับพิมพ์)
  function computeFor(bbox, zoom) {
    var n = Math.pow(2, Z);
    function tx(lng) { return Math.floor((lng + 180) / 360 * n); }
    function ty(lat) { var r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); }
    var r = { x0: tx(bbox[0]) - 1, x1: tx(bbox[2]) + 1, y0: Math.max(0, ty(bbox[3]) - 1), y1: Math.min(n - 1, ty(bbox[1]) + 1) };
    if ((r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) > 64) return Promise.reject(new Error('พื้นที่ใหญ่เกินไปสำหรับคำนวณยอดเขา'));
    return loadMosaic(r).then(function (m) { return analyse(m, r, intervalFor(zoom), Math.max(12, Math.min(16, Math.round(zoom)))); });
  }

  function setEnabled(v) {
    on = !!v;
    var map = ctx && ctx.map();
    if (!map) return;
    ['spot-x', 'spot-ele', 'depr-lines'].forEach(function (id) { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); });
    // ยอดเขาจาก OpenStreetMap: เหลือแค่ชื่อ (ความสูงใช้ X ของเรา ไม่ให้ซ้อนสองค่า)
    peakNameOnly(map, on);
    if (on) { lastKey = ''; schedule(); }
  }

  function schedule() { if (!on) return; clearTimeout(timer); timer = setTimeout(update, 350); }

  // ระยะเส้นชั้นที่แสดงตามซูม (ตรงกับ contour.js)
  function intervalFor(z) { return z < 13 ? 40 : 20; }

  function tileRange(map) {
    var b = map.getBounds(), n = Math.pow(2, Z);
    function tx(lng) { return Math.floor((lng + 180) / 360 * n); }
    function ty(lat) { var r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); }
    var x0 = tx(b.getWest()), x1 = tx(b.getEast()), y0 = ty(b.getNorth()), y1 = ty(b.getSouth());
    // เผื่อขอบ 1 ไทล์ถ้ายังไม่ใหญ่เกิน (ยอดเขาที่ขอบจอจะได้คำนวณถูก)
    if ((x1 - x0 + 3) * (y1 - y0 + 3) <= MAX_TILES) { x0--; x1++; y0--; y1++; }
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_TILES) return null;
    return { x0: x0, y0: Math.max(0, y0), x1: x1, y1: Math.min(n - 1, y1) };
  }

  function update() {
    var map = ctx && ctx.map();
    if (!on || !map) return;
    if (map.getZoom() < MIN_ZOOM - 0.01) return;
    var r = tileRange(map);
    if (!r) return;
    var iv = intervalFor(map.getZoom()), zb = Math.max(12, Math.min(16, Math.round(map.getZoom())));
    var key = [r.x0, r.y0, r.x1, r.y1, iv, zb].join(',');
    if (key === lastKey) return;
    if (running) { again = true; return; }
    running = true;
    var t0 = Date.now();
    loadMosaic(r).then(function (m) {
      var res = analyse(m, r, iv, zb);
      if (on && map.getSource('spot-pts')) { map.getSource('spot-pts').setData(res.pts); map.getSource('spot-depr').setData(res.depr); }
      root.TrailSpots.last = res;
      root.TrailSpots.stats = { peaks: res.pts.features.length, deprFeatures: res.depr.features.length, ms: Date.now() - t0, firstDepr: res.depr.features[0] && res.depr.features[0].geometry.coordinates[0] };
      lastKey = key;
    }).catch(function () { /* ไม่มีข้อมูลความสูงของบริเวณนี้ */ }).then(function () {
      running = false;
      if (again) { again = false; schedule(); }
    });
  }

  function loadMosaic(r) {
    var tw = r.x1 - r.x0 + 1, th = r.y1 - r.y0 + 1, W = tw * TILE, H = th * TILE, n = Math.pow(2, Z);
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var c2 = cv.getContext('2d', { willReadFrequently: true }), got = 0, jobs = [], i, j;
    for (j = 0; j < th; j++) for (i = 0; i < tw; i++) jobs.push({ i: i, j: j });
    return Promise.all(jobs.map(function (jb) {
      var x = ((r.x0 + jb.i) % n + n) % n, y = r.y0 + jb.j;
      return fetch(C.fillTemplate(C.DEM_TEMPLATE, { z: Z, x: x, y: y })).then(function (res) { if (!res.ok) throw 0; return res.blob(); })
        .then(function (bl) { return createImageBitmap(bl, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }); })
        .then(function (bm) { c2.drawImage(bm, jb.i * TILE, jb.j * TILE); if (bm.close) bm.close(); got++; })
        .catch(function () {});
    })).then(function () {
      if (!got) throw new Error('no dem');
      var d = c2.getImageData(0, 0, W, H).data, dem = new Float32Array(W * H), ok = new Uint8Array(W * H), p, q;
      for (p = 0, q = 0; p < W * H; p++, q += 4) { if (d[q + 3] === 0) { dem[p] = -1e4; continue; } dem[p] = d[q] * 256 + d[q + 1] + d[q + 2] / 256 - 32768; ok[p] = 1; }
      return { dem: dem, ok: ok, W: W, H: H };
    });
  }

  // ---------- คิวลำดับความสำคัญ (ค่าน้อยออกก่อน) ----------
  function Heap(n) { this.k = new Float32Array(n); this.v = new Int32Array(n); this.n = 0; }
  Heap.prototype.push = function (key, val) { var k = this.k, v = this.v, i = this.n++; while (i > 0) { var p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; } k[i] = key; v[i] = val; };
  Heap.prototype.pop = function () {
    var k = this.k, v = this.v, top = v[0], n = --this.n;
    if (n > 0) { var key = k[n], val = v[n], i = 0; for (;;) { var l = 2 * i + 1; if (l >= n) break; var rr = l + 1, c = (rr < n && k[rr] < k[l]) ? rr : l; if (k[c] >= key) break; k[i] = k[c]; v[i] = v[c]; i = c; } k[i] = key; v[i] = val; }
    return top;
  };
  var DX = [-1, 0, 1, -1, 1, -1, 0, 1], DY = [-1, -1, -1, 0, 0, 1, 1, 1];

  function analyse(m, r, iv, zb) {
    var W = m.W, H = m.H, dem = m.dem, ok = m.ok, N = W * H, n = Math.pow(2, Z);
    function lng(px) { return (r.x0 * TILE + px) / (TILE * n) * 360 - 180; }
    function lat(py) { var yy = Math.PI * (1 - 2 * (r.y0 * TILE + py) / (TILE * n)); return Math.atan(Math.sinh(yy)) * 180 / Math.PI; }
    function at(x, y) { x = x < 0 ? 0 : x > W - 1 ? W - 1 : x; y = y < 0 ? 0 : y > H - 1 ? H - 1 : y; var i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, i1 = Math.min(W - 1, i + 1), j1 = Math.min(H - 1, j + 1); return (dem[j * W + i] * (1 - fx) + dem[j * W + i1] * fx) * (1 - fy) + (dem[j1 * W + i] * (1 - fx) + dem[j1 * W + i1] * fx) * fy; }

    /* ---------- ยอดเขา ---------- */
    var pts = [], stamp = new Int32Array(N), heap = new Heap(Math.min(N, 60000)), x, y, p, k, run = 0;
    for (y = 1; y < H - 1; y++) for (x = 1; x < W - 1; x++) {
      p = y * W + x; if (!ok[p]) continue;
      var z = dem[p], isMax = true;
      for (k = 0; k < 8 && isMax; k++) { var nb = dem[p + DY[k] * W + DX[k]]; if (nb > z || (nb === z && k >= 4)) isMax = false; }
      if (!isMax) continue;
      // ไล่จากยอดลงไปตามที่สูงที่สุดก่อน จนเจอที่สูงกว่ายอด: ค่าต่ำสุดที่ผ่านมาคือคอเขา
      run++; heap.n = 0; heap.push(-z, p); stamp[p] = run;
      var col = z, higher = false, visits = 0, edge = false;
      while (heap.n > 0 && visits < 40000) {
        var c = heap.pop(), hz = dem[c]; visits++;
        if (hz > z) { higher = true; break; }
        if (hz < col) col = hz;
        if (z - col > 400) break; // โดดเด่นพอแล้ว
        var cx = c % W, cy = (c - cx) / W;
        if (cx === 0 || cy === 0 || cx === W - 1 || cy === H - 1) edge = true;
        for (k = 0; k < 8; k++) {
          var nx = cx + DX[k], ny = cy + DY[k]; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          var q = ny * W + nx; if (stamp[q] === run || !ok[q]) continue; stamp[q] = run;
          if (heap.n < heap.k.length) heap.push(-dem[q], q);
        }
      }
      var prom = z - col;
      if (prom >= iv || (!higher && edge && prom >= iv * 0.5)) pts.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng(x + 0.5), lat(y + 0.5)] }, properties: { ele: Math.round(z), prom: Math.round(prom) } });
    }

    /* ---------- ที่ต่ำ (คุ้งกระทะ) ---------- */
    var filled = new Float32Array(N), closed = new Uint8Array(N), fh = new Heap(N), c2, i;
    for (x = 0; x < W; x++) { [x, (H - 1) * W + x].forEach(function (cc) { closed[cc] = 1; filled[cc] = dem[cc]; fh.push(dem[cc], cc); }); }
    for (y = 1; y < H - 1; y++) { [y * W, y * W + W - 1].forEach(function (cc) { closed[cc] = 1; filled[cc] = dem[cc]; fh.push(dem[cc], cc); }); }
    while (fh.n > 0) {
      c2 = fh.pop(); x = c2 % W; y = (c2 - x) / W;
      for (k = 0; k < 8; k++) {
        var ax = x + DX[k], ay = y + DY[k]; if (ax < 0 || ay < 0 || ax >= W || ay >= H) continue;
        var b = ay * W + ax; if (closed[b]) continue; closed[b] = 1;
        filled[b] = dem[b] > filled[c2] ? dem[b] : filled[c2]; fh.push(filled[b], b);
      }
    }
    // แอ่ง = กลุ่มเซลล์ที่ถูกเติม ที่ลึกพอจะมีเส้นชั้นวงปิดอยู่ข้างใน
    var lab = new Int32Array(N), basins = [], stack = [];
    for (p = 0; p < N; p++) {
      if (lab[p] || filled[p] - dem[p] < 0.3 || !ok[p]) continue;
      var id = basins.length + 1, bmin = 1e9, spill = filled[p], cnt = 0, bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1, touches = false;
      stack.length = 0; stack.push(p); lab[p] = id;
      while (stack.length) {
        var cc = stack.pop(), qx = cc % W, qy = (cc - qx) / W; cnt++;
        if (dem[cc] < bmin) bmin = dem[cc];
        if (qx < bx0) bx0 = qx; if (qx > bx1) bx1 = qx; if (qy < by0) by0 = qy; if (qy > by1) by1 = qy;
        if (qx <= 1 || qy <= 1 || qx >= W - 2 || qy >= H - 2) touches = true;
        for (k = 0; k < 8; k++) {
          var ex = qx + DX[k], ey = qy + DY[k]; if (ex < 0 || ey < 0 || ex >= W || ey >= H) continue;
          var e = ey * W + ex; if (lab[e] || filled[e] - dem[e] < 0.3) continue; lab[e] = id; stack.push(e);
        }
      }
      basins.push({ id: id, min: bmin, spill: spill, cnt: cnt, bb: [bx0, by0, bx1, by1], touches: touches });
    }
    var feats = [], cellPx = Math.pow(2, zb - Z); // 1 เซลล์ DEM = กี่พิกเซลบนจอ
    var tickEvery = Math.max(0.6, 10 / cellPx), tickLen = Math.max(0.25, 4.5 / cellPx);
    basins.forEach(function (bs) {
      if (bs.touches || bs.cnt < 4) return;
      var lv0 = Math.floor(bs.min / iv) * iv + iv;
      for (var L = lv0; L < bs.spill; L += iv) {
        // สนาม: ในแอ่งใช้ความสูงจริง นอกแอ่งถือว่าสูงกว่าระดับเส้น จึงได้เฉพาะวงรอบที่ต่ำในแอ่งนี้
        var gx0 = bs.bb[0] - 1, gy0 = bs.bb[1] - 1, gx1 = bs.bb[2] + 1, gy1 = bs.bb[3] + 1;
        var f = function (ix, iy) { var q = iy * W + ix; return lab[q] === bs.id ? dem[q] : L + 1000; };
        rings(f, gx0, gy0, gx1, gy1, L).forEach(function (ring) {
          if (ring.length < 4) return;
          ring = smooth(ring);
          var kind = L % 100 === 0 ? 'ring1' : 'ring0';
          feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: ring.map(function (q) { return [lng(q[0] + 0.5), lat(q[1] + 0.5)]; }) }, properties: { k: kind, ele: L } });
          // ขีดสั้นตั้งฉากกับเส้น ชี้ไปทางที่ต่ำกว่า (เข้าด้านในแอ่ง)
          var acc = 0, next = tickEvery / 2;
          for (var t = 1; t < ring.length; t++) {
            var a0 = ring[t - 1], a1 = ring[t], sl = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]);
            while (sl > 0 && acc + sl >= next) {
              var u = (next - acc) / sl, mx = a0[0] + (a1[0] - a0[0]) * u, my = a0[1] + (a1[1] - a0[1]) * u, nx2 = -(a1[1] - a0[1]) / sl, ny2 = (a1[0] - a0[0]) / sl;
              var s = at(mx + nx2 * 0.7, my + ny2 * 0.7) < at(mx - nx2 * 0.7, my - ny2 * 0.7) ? 1 : -1;
              feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[lng(mx + 0.5), lat(my + 0.5)], [lng(mx + s * nx2 * tickLen + 0.5), lat(my + s * ny2 * tickLen + 0.5)]] }, properties: { k: kind } });
              next += tickEvery;
            }
            acc += sl;
          }
        });
      }
    });
    return { pts: { type: 'FeatureCollection', features: pts }, depr: { type: 'FeatureCollection', features: feats } };
  }

  // marching squares บนกรอบ [x0..x1, y0..y1] ที่ระดับ L คืนรายการเส้น (จุดเป็นพิกัดเซลล์)
  function rings(f, x0, y0, x1, y1, L) {
    var segs = [], x, y;
    for (y = y0; y < y1; y++) for (x = x0; x < x1; x++) {
      var a = f(x, y), b = f(x + 1, y), c = f(x + 1, y + 1), d = f(x, y + 1);
      var code = (a < L ? 8 : 0) | (b < L ? 4 : 0) | (c < L ? 2 : 0) | (d < L ? 1 : 0);
      if (code === 0 || code === 15) continue;
      var T = [x + (L - a) / (b - a), y], R = [x + 1, y + (L - b) / (c - b)], B = [x + (L - d) / (c - d), y + 1], Lf = [x, y + (L - a) / (d - a)];
      var map = { 1: [[Lf, B]], 2: [[B, R]], 3: [[Lf, R]], 4: [[T, R]], 5: [[Lf, T], [B, R]], 6: [[T, B]], 7: [[Lf, T]], 8: [[Lf, T]], 9: [[T, B]], 10: [[T, R], [Lf, B]], 11: [[T, R]], 12: [[Lf, R]], 13: [[B, R]], 14: [[Lf, B]] };
      map[code].forEach(function (sg) { segs.push(sg); });
    }
    // ต่อปลายเส้นเข้าด้วยกัน
    function key(pt) { return Math.round(pt[0] * 1000) + ',' + Math.round(pt[1] * 1000); }
    var ends = {}, used = new Uint8Array(segs.length), out = [], i;
    segs.forEach(function (s, idx) { [key(s[0]), key(s[1])].forEach(function (kk) { (ends[kk] = ends[kk] || []).push(idx); }); });
    for (i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      used[i] = 1;
      var line = [segs[i][0], segs[i][1]];
      for (var dir = 0; dir < 2; dir++) {
        for (;;) {
          var tail = line[line.length - 1], cand = ends[key(tail)] || [], nxt = -1;
          for (var cI = 0; cI < cand.length; cI++) if (!used[cand[cI]]) { nxt = cand[cI]; break; }
          if (nxt < 0) break;
          used[nxt] = 1;
          var sg = segs[nxt]; line.push(key(sg[0]) === key(tail) ? sg[1] : sg[0]);
        }
        line.reverse();
      }
      out.push(line);
    }
    return out;
  }
  function smooth(pts) {
    var closedRing = pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6, n = pts.length, a = pts, b, r2, i;
    for (r2 = 0; r2 < 2; r2++) {
      b = [];
      for (i = 0; i < n; i++) {
        if (!closedRing && (i === 0 || i === n - 1)) { b.push(a[i]); continue; }
        var pv = a[closedRing ? (i - 1 + n - 1) % (n - 1) : i - 1], nt = a[closedRing ? (i + 1) % (n - 1) : i + 1];
        b.push([(pv[0] + 2 * a[i][0] + nt[0]) / 4, (pv[1] + 2 * a[i][1] + nt[1]) / 4]);
      }
      if (closedRing) b[n - 1] = b[0];
      a = b;
    }
    return a;
  }

  root.TrailSpots = { init: init, setEnabled: setEnabled, addTo: addTo, computeFor: computeFor, _analyse: analyse, _map: function () { return ctx && ctx.map(); } };
})(typeof self !== 'undefined' ? self : this);
