// คำนวณเส้นทาง: อ่านไทล์เวกเตอร์ (ทางเดินเท้า/ถนน) + ไทล์ความสูง แล้วหาเส้นทางที่เดินง่ายที่สุด (A*)
// ทำงานออฟไลน์ได้ ถ้าไทล์ของพื้นที่นั้นถูกดาวน์โหลดไว้แล้ว (service worker ตอบจากที่เก็บไว้)
(function (root) {
  var G = TrailGeo;
  var C = TrailCommon;
  var D2R = Math.PI / 180;

  /* ---------- พิกัดพิกเซลแบบ Web Mercator ---------- */
  function px(lng, lat, z) {
    var n = 256 * Math.pow(2, z);
    var s = Math.sin(lat * D2R);
    return [((lng + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
  }
  function unpx(x, y, z) {
    var n = 256 * Math.pow(2, z);
    var lng = (x / n) * 360 - 180;
    var t = Math.PI * (1 - (2 * y) / n);
    var lat = (Math.atan((Math.exp(t) - Math.exp(-t)) / 2)) / D2R;
    return [lng, lat];
  }

  /* ---------- ตัวอ่านไทล์เวกเตอร์ MVT (เฉพาะเส้น) ---------- */
  function Reader(buf, p, end) { this.b = buf; this.p = p || 0; this.end = end === undefined ? buf.length : end; }
  Reader.prototype.varint = function () {
    var r = 0, mul = 1, b;
    do {
      b = this.b[this.p++];
      r += (b & 0x7f) * mul;
      mul *= 128;
    } while (b & 0x80);
    return r;
  };
  Reader.prototype.str = function (len) {
    var s = '';
    for (var i = 0; i < len; i++) s += String.fromCharCode(this.b[this.p + i]);
    this.p += len;
    return s;
  };
  Reader.prototype.skip = function (wt) {
    if (wt === 0) this.varint();
    else if (wt === 1) this.p += 8;
    else if (wt === 2) this.p += this.varint();
    else if (wt === 5) this.p += 4;
    else this.p = this.end;
  };

  function zz(v) { return v % 2 === 0 ? v / 2 : -(v + 1) / 2; }

  // คืนรายการ {cls, lines:[[[x,y]...]]} ของเลเยอร์ที่ต้องการ พิกัดเป็น 0..1 ของไทล์
  function decodeLines(buf, layerName) {
    var out = [];
    var r = new Reader(buf);
    while (r.p < r.end) {
      var key = r.varint(), f = Math.floor(key / 8), wt = key % 8;
      if (f === 3 && wt === 2) {
        var len = r.varint(), end = r.p + len;
        parseLayer(new Reader(buf, r.p, end), layerName, out);
        r.p = end;
      } else r.skip(wt);
    }
    return out;
  }

  function parseLayer(r, wanted, out) {
    var name = '', keys = [], values = [], feats = [], extent = 4096;
    while (r.p < r.end) {
      var key = r.varint(), f = Math.floor(key / 8), wt = key % 8;
      if (f === 1 && wt === 2) name = r.str(r.varint());
      else if (f === 2 && wt === 2) { var l = r.varint(); feats.push([r.p, r.p + l]); r.p += l; }
      else if (f === 3 && wt === 2) keys.push(r.str(r.varint()));
      else if (f === 4 && wt === 2) {
        var vl = r.varint(), vend = r.p + vl, val = null;
        while (r.p < vend) {
          var vk = r.varint(), vf = Math.floor(vk / 8), vw = vk % 8;
          if (vf === 1 && vw === 2) val = r.str(r.varint());
          else r.skip(vw);
        }
        r.p = vend;
        values.push(val);
      } else if (f === 5 && wt === 0) extent = r.varint();
      else r.skip(wt);
    }
    if (name !== wanted) return;
    feats.forEach(function (rng) {
      var fr = new Reader(r.b, rng[0], rng[1]);
      var tags = [], type = 0, geom = null;
      while (fr.p < fr.end) {
        var k = fr.varint(), ff = Math.floor(k / 8), w = k % 8;
        if (ff === 2 && w === 2) { var tl = fr.varint(), te = fr.p + tl; while (fr.p < te) tags.push(fr.varint()); }
        else if (ff === 3 && w === 0) type = fr.varint();
        else if (ff === 4 && w === 2) { var gl = fr.varint(), ge = fr.p + gl; geom = []; while (fr.p < ge) geom.push(fr.varint()); }
        else fr.skip(w);
      }
      if (type !== 2 || !geom) return;
      var cls = null;
      for (var t = 0; t + 1 < tags.length; t += 2) if (keys[tags[t]] === 'class') cls = values[tags[t + 1]];
      var lines = [], cur = null, x = 0, y = 0, i = 0;
      while (i < geom.length) {
        var cmd = geom[i] % 8, cnt = Math.floor(geom[i] / 8);
        i++;
        for (var c = 0; c < cnt; c++) {
          if (cmd === 1 || cmd === 2) {
            x += zz(geom[i++]);
            y += zz(geom[i++]);
            if (cmd === 1) { cur = []; lines.push(cur); }
            if (cur) cur.push([x / extent, y / extent]);
          }
        }
      }
      out.push({ cls: cls, lines: lines });
    });
  }

  /* ---------- ดึงไทล์ ---------- */
  function fetchBuf(url) {
    return fetch(url).then(function (res) { return res.ok && res.status !== 204 ? res.arrayBuffer() : null; }).catch(function () { return null; });
  }
  function fetchImg(url) {
    return fetch(url).then(function (res) { return res.ok ? res.blob() : null; })
      .then(function (b) { return b ? createImageBitmap(b) : null; }).catch(function () { return null; });
  }

  var TRAIL = { path: 1, track: 1, pedestrian: 1, footway: 1, bridleway: 1, cycleway: 1 };
  var ROAD = { minor: 1, service: 1, tertiary: 1, secondary: 1, primary: 1, trunk: 1, motorway: 1, residential: 1, unclassified: 1 };

  // วาดเส้นลงตารางด้วย Bresenham
  function drawLine(mask, gw, gh, x0, y0, x1, y1, val) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    var dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy, guard = 0;
    while (guard++ < 100000) {
      if (x0 >= 0 && y0 >= 0 && x0 < gw && y0 < gh) {
        var i = y0 * gw + x0;
        if (mask[i] === 0 || val === 1) mask[i] = val;
      }
      if (x0 === x1 && y0 === y1) break;
      var e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  // สร้างตารางความสูง + ตารางทางเดินของพื้นที่ bbox = [w,s,e,n]
  async function buildGrid(bbox, vectorTpl, onStatus) {
    var padLng = Math.max((bbox[2] - bbox[0]) * 0.2, 0.012);
    var padLat = Math.max((bbox[3] - bbox[1]) * 0.2, 0.012);
    var w = bbox[0] - padLng, s = Math.max(-80, bbox[1] - padLat), e = bbox[2] + padLng, n = Math.min(80, bbox[3] + padLat);

    var zd = C.DEM_MAXZOOM, a, b, tx0, tx1, ty0, ty1;
    for (; zd >= 8; zd--) {
      a = px(w, n, zd); b = px(e, s, zd);
      tx0 = Math.floor(a[0] / 256); tx1 = Math.floor(b[0] / 256);
      ty0 = Math.floor(a[1] / 256); ty1 = Math.floor(b[1] / 256);
      if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) <= 30) break;
    }
    if (zd < 10) throw new Error('far');
    var tw = tx1 - tx0 + 1, th = ty1 - ty0 + 1;

    onStatus('โหลดข้อมูลความสูง…');
    var cv = document.createElement('canvas');
    cv.width = tw * 256; cv.height = th * 256;
    var cx = cv.getContext('2d', { willReadFrequently: true });
    var jobs = [];
    for (var ty = ty0; ty <= ty1; ty++) for (var tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty]);
    var got = 0;
    await Promise.all(jobs.map(function (j) {
      return fetchImg(C.fillTemplate(C.DEM_TEMPLATE, { z: zd, x: j[0], y: j[1] })).then(function (bm) {
        if (bm) { cx.drawImage(bm, (j[0] - tx0) * 256, (j[1] - ty0) * 256); got++; }
      });
    }));
    if (!got) throw new Error('nodem');

    var ox = tx0 * 256, oy = ty0 * 256; // จุดกำเนิดพิกเซลของผืนภาพ
    var rx0 = Math.floor(a[0] - ox), ry0 = Math.floor(a[1] - oy);
    var rw = Math.ceil(b[0] - a[0]), rh = Math.ceil(b[1] - a[1]);
    var f = Math.max(1, Math.ceil(Math.sqrt((rw * rh) / 200000)));
    var gw = Math.floor(rw / f), gh = Math.floor(rh / f);
    if (gw < 4 || gh < 4) throw new Error('small');
    var img = cx.getImageData(0, 0, cv.width, cv.height).data;
    var ele = new Float32Array(gw * gh);
    for (var gy = 0; gy < gh; gy++) {
      for (var gx = 0; gx < gw; gx++) {
        var sx = Math.min(cv.width - 1, rx0 + gx * f + (f >> 1));
        var sy = Math.min(cv.height - 1, ry0 + gy * f + (f >> 1));
        var o = (sy * cv.width + sx) * 4;
        ele[gy * gw + gx] = img[o] * 256 + img[o + 1] + img[o + 2] / 256 - 32768;
      }
    }

    // ทางเดินเท้า/ถนนจากไทล์เวกเตอร์
    onStatus('อ่านทางเดินเท้า…');
    var mask = new Uint8Array(gw * gh);
    var tz = 14, vt0, vt1, vy0, vy1;
    for (; tz >= 11; tz--) {
      var va = px(w, n, tz), vb = px(e, s, tz);
      vt0 = Math.floor(va[0] / 256); vt1 = Math.floor(vb[0] / 256);
      vy0 = Math.floor(va[1] / 256); vy1 = Math.floor(vb[1] / 256);
      if ((vt1 - vt0 + 1) * (vy1 - vy0 + 1) <= 64) break;
    }
    var vjobs = [];
    for (var vy = vy0; vy <= vy1; vy++) for (var vx = vt0; vx <= vt1; vx++) vjobs.push([vx, vy]);
    var scale = Math.pow(2, zd - tz) * 256; // พิกเซล DEM ต่อไทล์เวกเตอร์ 1 ไทล์
    var trailCells = 0;
    await Promise.all(vjobs.map(function (j) {
      return fetchBuf(C.fillTemplate(vectorTpl, { z: tz, x: j[0], y: j[1] })).then(function (buf) {
        if (!buf) return;
        var feats;
        try { feats = decodeLines(new Uint8Array(buf), 'transportation'); } catch (err) { return; }
        feats.forEach(function (ft) {
          var val = TRAIL[ft.cls] ? 1 : ROAD[ft.cls] ? 2 : 0;
          if (!val) return;
          ft.lines.forEach(function (ln) {
            for (var i = 1; i < ln.length; i++) {
              var X0 = (j[0] * scale + ln[i - 1][0] * scale - ox - rx0) / f;
              var Y0 = (j[1] * scale + ln[i - 1][1] * scale - oy - ry0) / f;
              var X1 = (j[0] * scale + ln[i][0] * scale - ox - rx0) / f;
              var Y1 = (j[1] * scale + ln[i][1] * scale - oy - ry0) / f;
              drawLine(mask, gw, gh, X0, Y0, X1, Y1, val);
              trailCells++;
            }
          });
        });
      });
    }));

    var midLat = (s + n) / 2;
    var mpp = (156543.03392 * Math.cos(midLat * D2R)) / Math.pow(2, zd); // เมตรต่อพิกเซล DEM
    return { gw: gw, gh: gh, f: f, ele: ele, mask: mask, mpp: mpp * f, zd: zd, ox: ox + rx0, oy: oy + ry0, hasTrails: trailCells > 0 };
  }

  function toCell(g, lng, lat) {
    var p = px(lng, lat, g.zd);
    var x = Math.round((p[0] - g.ox) / g.f - 0.5), y = Math.round((p[1] - g.oy) / g.f - 0.5);
    return [Math.max(0, Math.min(g.gw - 1, x)), Math.max(0, Math.min(g.gh - 1, y))];
  }
  function cellLL(g, x, y) {
    return unpx((x + 0.5) * g.f + g.ox, (y + 0.5) * g.f + g.oy, g.zd);
  }

  /* ---------- ฮีปสำหรับ A* ---------- */
  function Heap() { this.k = []; this.v = []; }
  Heap.prototype.push = function (key, val) {
    var k = this.k, v = this.v, i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      var tk = k[p]; k[p] = k[i]; k[i] = tk;
      var tv = v[p]; v[p] = v[i]; v[i] = tv;
      i = p;
    }
  };
  Heap.prototype.pop = function () {
    var k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop();
    if (k.length) {
      k[0] = lk; v[0] = lv;
      var i = 0, n = k.length;
      for (;;) {
        var l = 2 * i + 1, r = l + 1, m = i;
        if (l < n && k[l] < k[m]) m = l;
        if (r < n && k[r] < k[m]) m = r;
        if (m === i) break;
        var tk = k[m]; k[m] = k[i]; k[i] = tk;
        var tv = v[m]; v[m] = v[i]; v[i] = tv;
        i = m;
      }
    }
    return top;
  };

  var OFF_TRAIL = 1.6; // เดินนอกทางช้ากว่าบนทางเท่าไร
  var TRAIL_MULT = 0.8;
  var ROAD_MULT = 0.7;
  var MAX_SLOPE = 0.7; // ชันเกิน ~35° ถือว่าผ่านไม่ได้

  // เวลาเดินตามฟังก์ชันของ Tobler (วินาที) ต่อระยะราบ d เมตรและความต่างระดับ dz
  function toblerTime(d, dz) {
    var kmh = 6 * Math.exp(-3.5 * Math.abs(dz / d + 0.05));
    return d / (kmh / 3.6);
  }

  function astar(g, from, to) {
    var gw = g.gw, gh = g.gh, N = gw * gh;
    var gs = new Float32Array(N); gs.fill(Infinity);
    var par = new Int32Array(N); par.fill(-1);
    var closed = new Uint8Array(N);
    var si = from[1] * gw + from[0], ti = to[1] * gw + to[0];
    var tx = to[0], ty = to[1];
    var hmul = g.mpp / (6 / 3.6 / ROAD_MULT);
    var heap = new Heap();
    gs[si] = 0;
    heap.push(0, si);
    var steps = 0, DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
    while (heap.k.length && steps++ < 900000) {
      var cur = heap.pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (cur === ti) break;
      var cx = cur % gw, cy = (cur - cx) / gw;
      for (var d = 0; d < 8; d++) {
        var nx = cx + DX[d], ny = cy + DY[d];
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        var ni = ny * gw + nx;
        if (closed[ni]) continue;
        var dist = g.mpp * (d < 4 ? 1 : 1.41421356);
        var dz = g.ele[ni] - g.ele[cur];
        if (Math.abs(dz / dist) > MAX_SLOPE) continue;
        var mk = g.mask[ni] && g.mask[cur] ? Math.max(g.mask[ni], g.mask[cur]) : 0;
        var mult = mk === 1 ? TRAIL_MULT : mk === 2 ? ROAD_MULT : OFF_TRAIL;
        var ng = gs[cur] + toblerTime(dist, dz) * mult;
        if (ng < gs[ni]) {
          gs[ni] = ng;
          par[ni] = cur;
          var hx = Math.abs(nx - tx), hy = Math.abs(ny - ty);
          heap.push(ng + (Math.max(hx, hy) + 0.41421356 * Math.min(hx, hy)) * hmul, ni);
        }
      }
    }
    if (!closed[ti]) return null;
    var path = [], c = ti;
    while (c !== -1) { path.push(c); c = par[c]; }
    path.reverse();
    return { cells: path, cost: gs[ti] };
  }

  /* ---------- ยูทิลิตี้เส้นทาง ---------- */
  function mxy(p, o) { // เมตรเทียบจุด o
    var k = Math.cos(o.lat * D2R);
    return [(p.lng - o.lng) * k * 111320, (p.lat - o.lat) * 110540];
  }

  function dpSimplify(pts, tol) {
    if (pts.length < 3) return pts;
    var o = { lat: pts[0][1], lng: pts[0][0] };
    var m = pts.map(function (p) { return mxy({ lng: p[0], lat: p[1] }, o); });
    var keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    var stack = [[0, pts.length - 1]];
    while (stack.length) {
      var rng = stack.pop(), a = m[rng[0]], b = m[rng[1]], best = -1, bd = tol;
      var dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
      for (var i = rng[0] + 1; i < rng[1]; i++) {
        var t = L ? ((m[i][0] - a[0]) * dx + (m[i][1] - a[1]) * dy) / L : 0;
        t = Math.max(0, Math.min(1, t));
        var d = Math.hypot(m[i][0] - (a[0] + t * dx), m[i][1] - (a[1] + t * dy));
        if (d > bd) { bd = d; best = i; }
      }
      if (best > 0) { keep[best] = 1; stack.push([rng[0], best], [best, rng[1]]); }
    }
    return pts.filter(function (p, i) { return keep[i]; });
  }

  function polyLength(pts) {
    var L = 0;
    for (var i = 1; i < pts.length; i++) L += G.haversine({ lat: pts[i - 1][1], lng: pts[i - 1][0] }, { lat: pts[i][1], lng: pts[i][0] });
    return L;
  }

  // หาเส้นทางอัตโนมัติจาก a ไป b ({lat,lng}) คืน {pts, dist, time, trailPct, ascent, descent, saddles}
  async function autoRoute(a, b, vectorTpl, onStatus) {
    onStatus = onStatus || function () {};
    var bbox = [Math.min(a.lng, b.lng), Math.min(a.lat, b.lat), Math.max(a.lng, b.lng), Math.max(a.lat, b.lat)];
    var g = await buildGrid(bbox, vectorTpl, onStatus);
    onStatus('คำนวณเส้นทาง…');
    await new Promise(function (r) { setTimeout(r, 30); }); // ให้หน้าจอวาดสถานะก่อน
    var c0 = toCell(g, a.lng, a.lat), c1 = toCell(g, b.lng, b.lat);
    var res = astar(g, c0, c1);
    if (!res) throw new Error('nopath');

    var pts = res.cells.map(function (ci) { var x = ci % g.gw; return cellLL(g, x, (ci - x) / g.gw); });
    var trailLen = 0, total = 0, asc = 0, desc = 0, time = 0, eles = [];
    for (var i = 0; i < res.cells.length; i++) {
      var ci = res.cells[i];
      eles.push(g.ele[ci]);
      if (i) {
        var pc = res.cells[i - 1];
        var step = G.haversine({ lat: pts[i - 1][1], lng: pts[i - 1][0] }, { lat: pts[i][1], lng: pts[i][0] });
        var dz = g.ele[ci] - g.ele[pc];
        total += step;
        if (g.mask[ci] && g.mask[pc]) trailLen += step;
        if (dz > 0) asc += dz; else desc -= dz;
        var mk = g.mask[ci] && g.mask[pc] ? Math.max(g.mask[ci], g.mask[pc]) : 0;
        time += toblerTime(Math.max(step, 1), dz) * (mk === 1 ? TRAIL_MULT : mk === 2 ? ROAD_MULT : OFF_TRAIL);
      }
    }
    // คอเขา/สันเขา: จุดสูงสุดเฉพาะที่ซึ่งขึ้นแล้วลงอย่างน้อย 25 ม.
    var saddles = [], W = 6;
    for (var j = W; j < eles.length - W; j++) {
      var hi = eles[j], isMax = true;
      for (var q = -W; q <= W; q++) if (eles[j + q] > hi) { isMax = false; break; }
      if (!isMax) continue;
      var lo1 = Infinity, lo2 = Infinity;
      for (var u = 0; u <= j; u++) lo1 = Math.min(lo1, eles[u]);
      for (var v = j; v < eles.length; v++) lo2 = Math.min(lo2, eles[v]);
      if (hi - lo1 >= 25 && hi - lo2 >= 25 && (!saddles.length || j - saddles[saddles.length - 1].i > 3 * W)) {
        saddles.push({ i: j, lng: pts[j][0], lat: pts[j][1], ele: Math.round(hi) });
      }
    }

    var simple = dpSimplify(pts, g.mpp * 0.6);
    simple[0] = [a.lng, a.lat];
    simple[simple.length - 1] = [b.lng, b.lat];
    return {
      pts: simple,
      dist: total,
      time: time,
      trailPct: total ? Math.round((trailLen / total) * 100) : 0,
      ascent: Math.round(asc),
      descent: Math.round(desc),
      saddles: saddles,
      hasTrails: g.hasTrails
    };
  }

  /* ---------- เทียบตำแหน่งกับเส้นทาง ---------- */
  // pts = [[lng,lat]...] ; คืนระยะห่างจากเส้น ตำแหน่งตามแนวเส้น และข้างที่ออกนอก
  function project(pts, cum, p, fromAlong) {
    var best = null;
    for (var i = 1; i < pts.length; i++) {
      var A = { lng: pts[i - 1][0], lat: pts[i - 1][1] }, B = { lng: pts[i][0], lat: pts[i][1] };
      var a = mxy(A, p), b = mxy(B, p); // จุด p = ต้นทาง (0,0)
      var dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
      var t = L2 ? -(a[0] * dx + a[1] * dy) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      var qx = a[0] + t * dx, qy = a[1] + t * dy;
      var d = Math.hypot(qx, qy);
      var along = cum[i - 1] + t * (cum[i] - cum[i - 1]);
      // ถ่วงให้เลือกช่วงที่ต่อเนื่องกับความคืบหน้าเดิม (กันเส้นที่ตัดกันเอง)
      var score = d + (fromAlong !== undefined && along < fromAlong - 150 ? 60 : 0);
      if (!best || score < best.score) {
        var cross = dx * (0 - qy) - dy * (0 - qx); // >0: ผู้ใช้อยู่ซ้ายของทิศเดิน
        best = { score: score, dist: d, along: along, seg: i, t: t, side: cross > 0 ? 'left' : 'right' };
      }
    }
    return best;
  }
  function cumulative(pts) {
    var cum = [0];
    for (var i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1] + G.haversine({ lat: pts[i - 1][1], lng: pts[i - 1][0] }, { lat: pts[i][1], lng: pts[i][0] }));
    }
    return cum;
  }
  // จุดบนเส้นทางที่ระยะ along เมตร
  function pointAt(pts, cum, along) {
    along = Math.max(0, Math.min(cum[cum.length - 1], along));
    for (var i = 1; i < pts.length; i++) {
      if (cum[i] >= along) {
        var L = cum[i] - cum[i - 1], t = L ? (along - cum[i - 1]) / L : 0;
        return { lng: pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]), lat: pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1]) };
      }
    }
    var l = pts[pts.length - 1];
    return { lng: l[0], lat: l[1] };
  }

  root.TrailRoute = {
    autoRoute: autoRoute,
    dpSimplify: dpSimplify,
    polyLength: polyLength,
    project: project,
    cumulative: cumulative,
    pointAt: pointAt,
    decodeLines: decodeLines
  };
})(typeof self !== 'undefined' ? self : this);
