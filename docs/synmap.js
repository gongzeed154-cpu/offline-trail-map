// แผนที่สมมุติสำหรับสอน: สร้างภูมิประเทศสมมุติ (สุ่มตามเลขเมล็ดพันธุ์ ซ้ำได้) แล้ววาดเป็นแผนที่ภูมิประเทศพร้อมกริด
// ผู้สอนเลือกได้ว่าจะให้มีรายละเอียดอะไรบ้าง: เส้นชั้นความสูง (หลัก รอง แทรก โดยประมาณ คุ้งกระทะ) ลักษณะเขา น้ำ พืช ชุมชน สถานที่ เส้นทาง ชื่อ ฯลฯ
// ทุกอย่างสมมุติ ไม่ใช่สถานที่จริง ใช้สอนอ่านแผนที่โดยไม่ต้องใช้แผนที่จริง
(function (root) {
  var G = TrailGeo;
  var FONT = '"Sarabun","Noto Sans Thai",-apple-system,sans-serif';

  /* ---------- เครื่องมือพื้นฐาน ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

  function makeNoise(seed) {
    var r = mulberry32(seed), p = new Uint8Array(512), i, j, t;
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) { j = Math.floor(r() * (i + 1)); t = p[i]; p[i] = p[j]; p[j] = t; }
    for (i = 0; i < 256; i++) p[i + 256] = p[i];
    function fade(x) { return x * x * x * (x * (x * 6 - 15) + 10); }
    var GC = [], GS = []; for (var gi = 0; gi < 16; gi++) { GC.push(Math.cos(gi * Math.PI / 8)); GS.push(Math.sin(gi * Math.PI / 8)); }
    function grad(h, x, y) { return GC[h & 15] * x + GS[h & 15] * y; }
    return function (x, y) {
      var X = Math.floor(x), Y = Math.floor(y), xf = x - X, yf = y - Y;
      X &= 255; Y &= 255;
      var u = fade(xf), v = fade(yf);
      var aa = p[p[X] + Y], ab = p[p[X] + Y + 1], ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
      var x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u), x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
      return lerp(x1, x2, v) * 1.45;
    };
  }
  function fbm(n, x, y, oct, gain) {
    var s = 0, a = 1, f = 1, norm = 0;
    for (var i = 0; i < oct; i++) { s += n(x * f, y * f) * a; norm += a; a *= gain; f *= 2.03; }
    return s / norm;
  }

  /* ---------- ชนิดภูมิประเทศ ---------- */
  var PRESETS = {
    mountain: { name: 'ภูเขาสูงชัน', freq: 1.9, ridge: 0.65, relief: 0.07, tilt: 0.1, esc: 2, sink: 2, towns: 4 },
    hills: { name: 'เนินเขาสลับที่ราบ', freq: 1.9, ridge: 0.25, relief: 0.03, tilt: 0.18, esc: 1, sink: 1, towns: 5 },
    plain: { name: 'ที่ราบลูกคลื่น', freq: 1.6, ridge: 0.05, relief: 0.011, tilt: 0.3, esc: 0, sink: 1, towns: 6 },
    plateau: { name: 'ที่ราบสูงมีหน้าผา', freq: 1.7, ridge: 0.25, relief: 0.045, tilt: 0.08, esc: 3, sink: 2, towns: 4 }
  };

  var NICE = [1, 2, 2.5, 5, 10, 20, 25, 40, 50, 100, 200, 250, 500];
  function niceInterval(v) { var best = NICE[0]; NICE.forEach(function (n) { if (Math.abs(n - v) < Math.abs(best - v)) best = n; }); return best; }

  /* ---------- Priority-Flood บนกริดขนาดใดก็ได้ ---------- */
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
  function flood(dem, w, h, eps) {
    eps = eps || 0;
    var N = w * h, filled = new Float32Array(N), parent = new Int32Array(N).fill(-1), closed = new Uint8Array(N), order = new Int32Array(N);
    var heap = new Heap(N), x, y, c;
    function seed(cell) { closed[cell] = 1; filled[cell] = dem[cell]; heap.push(dem[cell], cell); }
    for (x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (y = 1; y < h - 1; y++) { seed(y * w); seed(y * w + w - 1); }
    var oi = 0, k, nx, ny, nb;
    while (heap.n > 0) {
      c = heap.pop(); order[oi++] = c;
      x = c % w; y = (c - x) / w;
      for (k = 0; k < 8; k++) {
        nx = x + DX[k]; ny = y + DY[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        nb = ny * w + nx;
        if (closed[nb]) continue;
        closed[nb] = 1; parent[nb] = c;
        filled[nb] = dem[nb] > filled[c] + eps ? dem[nb] : filled[c] + eps;
        heap.push(filled[nb], nb);
      }
    }
    var acc = new Float32Array(N).fill(1), i, p;
    for (i = oi - 1; i >= 0; i--) { c = order[i]; p = parent[c]; if (p >= 0) acc[p] += acc[c]; }
    return { filled: filled, parent: parent, acc: acc };
  }

  function blur(a, w, h, passes) {
    var tmp = new Float32Array(a.length), x, y, p;
    for (var it = 0; it < passes; it++) {
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) { p = y * w + x; tmp[p] = (a[y * w + Math.max(0, x - 1)] + 2 * a[p] + a[y * w + Math.min(w - 1, x + 1)]) / 4; }
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) { p = y * w + x; a[p] = (tmp[Math.max(0, y - 1) * w + x] + 2 * tmp[p] + tmp[Math.min(h - 1, y + 1) * w + x]) / 4; }
    }
  }

  /* ---------- สร้างความสูง ---------- */
  function buildHeights(o, nx, ny, relief, rnd) {
    var seed = o.seed | 0, P = PRESETS[o.preset] || PRESETS.hills;
    var n1 = makeNoise(seed * 7 + 1), n2 = makeNoise(seed * 13 + 5), nw = makeNoise(seed * 5 + 3), nm = makeNoise(seed * 3 + 9);
    var h = new Float32Array(nx * ny), i, j, x, y;
    var f = P.freq;
    // ลำน้ำหลักคดเคี้ยวผ่านแผนที่ (ขุดร่องให้น้ำไหลตามนี้) และทิศลาดเอียงโดยรวม
    var rv0 = 0.25 + rnd() * 0.5, rvA = 0.08 + rnd() * 0.1, rvF = 1.2 + rnd() * 1.4, rvP = rnd() * 6;
    var vertical = ny >= nx;
    var tiltDir = rnd() < 0.5 ? 1 : -1;
    var river = [];
    var steps = 60;
    for (var s = 0; s <= steps; s++) {
      var t = s / steps, off = rv0 + rvA * Math.sin(t * rvF * Math.PI * 2 + rvP) + 0.5 * rvA * Math.sin(t * rvF * 5.3 + rvP * 2);
      river.push(vertical ? [off * nx, t * ny] : [t * nx, off * ny]);
    }
    // ความลาดเอียงเข้าหาลำน้ำหลัก: ที่ไกลลำน้ำสูงกว่า ทำให้น้ำไหลออกได้ ไม่เกิดแอ่งปิดกว้างๆ
    var rmask = new Uint8Array(nx * ny);
    for (var q1 = 0; q1 < river.length - 1; q1++) {
      var rax = river[q1][0], ray = river[q1][1], rbx = river[q1 + 1][0], rby = river[q1 + 1][1], rn = Math.max(1, Math.ceil(Math.hypot(rbx - rax, rby - ray)));
      for (var rs = 0; rs <= rn; rs++) { var rx = Math.round(rax + (rbx - rax) * rs / rn), ry = Math.round(ray + (rby - ray) * rs / rn); if (rx >= 0 && ry >= 0 && rx < nx && ry < ny) rmask[ry * nx + rx] = 1; }
    }
    var rdist = distanceTo(rmask, nx, ny), rampScale = nx * 0.3;
    for (j = 0; j < ny; j++) {
      for (i = 0; i < nx; i++) {
        x = (i + 0.5) / nx * f; y = (j + 0.5) / nx * f;
        var wx = x + 0.22 * nw(x * 0.8 + 11.3, y * 0.8 + 4.1), wy = y + 0.22 * nw(x * 0.8 + 71.7, y * 0.8 + 33.9);
        var base = fbm(n1, wx, wy, 4, 0.42);
        var rid = 1 - Math.abs(fbm(n2, wx * 1.0, wy * 1.0, 3, 0.4)) * 1.7;
        rid = clamp(rid, 0, 1); rid = rid * rid;
        var massif = 0.5 + 0.5 * fbm(nm, x * 0.45, y * 0.45, 2, 0.5);
        var shape = P.ridge * rid * (0.35 + 0.65 * massif) + (1 - P.ridge) * (0.5 + 0.5 * base) * (0.45 + 0.55 * massif);
        if (o.preset === 'plateau') shape = smooth(0.3, 0.42, shape) * 0.85 + shape * 0.15;
        var u = (i + 0.5) / nx, v = (j + 0.5) / ny;
        var tilt = (vertical ? v : u) * tiltDir * P.tilt;
        h[j * nx + i] = shape * 0.62 + tilt + 0.55 * (1 - Math.exp(-rdist[j * nx + i] / rampScale));
      }
    }
    // ปรับช่วงเป็น 0..1 แล้วคูณระดับสูงต่ำ
    var mn = 1e9, mx = -1e9, p;
    blur(h, nx, ny, 2);
    for (p = 0; p < h.length; p++) { if (h[p] < mn) mn = h[p]; if (h[p] > mx) mx = h[p]; }
    for (p = 0; p < h.length; p++) h[p] = (h[p] - mn) / (mx - mn) * relief;

    var carve = relief * 0.16, wid = nx * 0.028, band = Math.ceil(wid * 3.4);
    var dmin2 = new Float32Array(nx * ny).fill(1e9);
    for (var q = 0; q < river.length - 1; q++) {
      var ax = river[q][0], ay = river[q][1], bx = river[q + 1][0], by = river[q + 1][1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      var i0 = Math.max(0, Math.floor(Math.min(ax, bx) - band)), i1 = Math.min(nx - 1, Math.ceil(Math.max(ax, bx) + band));
      var j0 = Math.max(0, Math.floor(Math.min(ay, by) - band)), j1 = Math.min(ny - 1, Math.ceil(Math.max(ay, by) + band));
      for (j = j0; j <= j1; j++) for (i = i0; i <= i1; i++) {
        var tt = clamp(((i - ax) * dx + (j - ay) * dy) / l2, 0, 1), cx = ax + tt * dx - i, cy = ay + tt * dy - j, d2 = cx * cx + cy * cy, pp = j * nx + i;
        if (d2 < dmin2[pp]) dmin2[pp] = d2;
      }
    }
    for (j = 0; j < ny; j++) {
      for (i = 0; i < nx; i++) {
        var d2m = dmin2[j * nx + i];
        if (d2m > band * band) continue;
        h[j * nx + i] -= carve * Math.exp(-d2m / (2 * wid * wid)) * (0.55 + 0.45 * smooth(0, 1, (vertical ? j / ny : i / nx)));
      }
    }
    return { h: h, river: river, vertical: vertical };
  }


  /* ---------- ชื่อสมมุติ ---------- */
  var N_PREFIX = ['โนน', 'หนอง', 'ห้วย', 'ดอน', 'ท่า', 'นา', 'ป่า', 'ดง', 'คลอง', 'สัน', 'ผา', 'วัง', 'บึง', 'โคก', 'เนิน', 'ทุ่ง'];
  var N_AUX = ['สว่าง', 'ใหม่', 'เจริญ', 'สามัคคี', 'ศรีสุข', 'ทอง', 'เย็น', 'งาม', 'ชัย', 'แก้ว', 'ดี', 'สวรรค์', 'ไทร', 'ตาล', 'มะขาม', 'ยาง', 'กลาง', 'น้อย', 'ใหญ่', 'พัฒนา', 'ร่มเย็น', 'ศรีราช', 'ดอกไม้', 'สุขสันต์'];
  var N_HILL = ['ผาลาด', 'หินกอง', 'แก้ว', 'ช้างเผือก', 'สามยอด', 'ใหญ่', 'ลูกช้าง', 'หัวโล้น', 'หลวง', 'เมฆ', 'ผาตั้ง', 'หินซ้อน', 'ผาแดง', 'ผางาม', 'เหนือ', 'ใต้', 'พญาไฟ', 'ศิลา'];
  var N_WATER = ['น้ำใส', 'น้ำลึก', 'ปลาดุก', 'แมลง', 'ขาว', 'เย็น', 'ไผ่', 'หินดาด', 'ทราย', 'ตะโก', 'กระทิง', 'ผักหนาม', 'หลวง', 'เล็ก', 'น้ำริน'];
  function pick(a, rnd) { return a[Math.floor(rnd() * a.length)]; }
  function makeNamer(rnd) {
    var used = {};
    function uniq(f) { for (var t = 0; t < 40; t++) { var n = f(); if (!used[n]) { used[n] = 1; return n; } } return f(); }
    return {
      village: function () { return uniq(function () { return 'บ้าน' + pick(N_PREFIX, rnd) + pick(N_AUX, rnd); }); },
      hill: function (kind) { return uniq(function () { return (kind || pick(['ดอย', 'เขา', 'ภู'], rnd)) + pick(N_HILL, rnd); }); },
      water: function (kind) { return uniq(function () { return (kind || 'ห้วย') + pick(N_WATER, rnd); }); },
      pond: function () { return uniq(function () { return pick(['หนอง', 'บึง', 'อ่างเก็บน้ำ'], rnd) + pick(N_WATER.concat(N_AUX), rnd); }); },
      temple: function (v) { return uniq(function () { return 'วัด' + pick(['ศรี', 'ป่า', 'ใหม่', 'ดอน', 'สว่าง', 'เจริญ', 'กลาง', 'โพธิ์'], rnd) + pick(['สว่าง', 'ธรรม', 'ชัย', 'เจริญ', 'ศรีสุข', 'ไทร', 'ทอง', 'งาม'], rnd); }); },
      fall: function () { return uniq(function () { return 'น้ำตก' + pick(N_WATER.concat(N_HILL), rnd); }); },
      cave: function () { return uniq(function () { return 'ถ้ำ' + pick(['ผาลาด', 'หินงอก', 'ค้างคาว', 'พระ', 'ใหญ่', 'ลม', 'มืด'], rnd); }); }
    };
  }

  function chaikin(pts, iter) {
    for (var it = 0; it < iter; it++) {
      if (pts.length < 3) return pts;
      var out = [pts[0]];
      for (var i = 0; i < pts.length - 1; i++) {
        var a = pts[i], b = pts[i + 1];
        out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
      }
      out.push(pts[pts.length - 1]);
      pts = out;
    }
    return pts;
  }

  /* ---------- สร้างโลกสมมุติ ---------- */
  // dims = { wmm, hmm (กรอบแผนที่บนกระดาษ), scale } ใช้กำหนดขนาดพื้นที่จริงและระยะเส้นชั้นความสูง
  function generate(o, dims, onStatus) {
    onStatus = onStatus || function () {};
    var rnd = mulberry32((o.seed | 0) * 2654435761 >>> 0 || 7);
    var P = PRESETS[o.preset] || PRESETS.hills;
    var extW = dims.wmm * dims.scale / 1000, extH = dims.hmm * dims.scale / 1000; // เมตร
    var nx = clamp(Math.round(dims.wmm * 2.2), 260, 900), ny = Math.round(nx * extH / extW);
    var cellM = extW / nx, N = nx * ny;
    var diag = Math.sqrt(extW * extW + extH * extH);
    var relief = clamp(diag * P.relief * (o.reliefMul || 1), 15, 3000);
    var interval = o.interval && o.interval !== 'auto' ? +o.interval : niceInterval(relief / 42);
    var world = { nx: nx, ny: ny, N: N, cellM: cellM, extW: extW, extH: extH, relief: relief, interval: interval, index: interval * 5, base: o.baseElev || 200, seed: o.seed | 0, preset: o.preset, rnd: rnd };
    var namer = makeNamer(rnd);
    world.namer = namer;

    onStatus('สร้างภูมิประเทศสมมุติ…');
    var hh = buildHeights(o, nx, ny, relief, rnd);
    var h = hh.h, i, j, p, k;
    world.vertical = hh.vertical; world.riverPath = hh.river;

    // หน้าผา (ชั้นหินชัน): ยกพื้นต่างระดับตามเส้นโค้ง
    world.cliffs = [];
    var nEsc = o.preset in PRESETS ? PRESETS[o.preset].esc : 1;
    for (var e = 0; e < nEsc; e++) {
      var sx = nx * (0.2 + rnd() * 0.6), sy = ny * (0.2 + rnd() * 0.6), ang = rnd() * Math.PI * 2, len = nx * (0.22 + rnd() * 0.25), path = [], curv = (rnd() - 0.5) * 0.9;
      for (var st = 0; st <= 24; st++) { path.push([sx, sy]); sx += Math.cos(ang) * len / 24; sy += Math.sin(ang) * len / 24; ang += curv / 24 + (rnd() - 0.5) * 0.12; }
      var stepH = Math.max(interval * 3.2, relief * (0.07 + rnd() * 0.06)), wEdge = 1.4;
      for (j = 0; j < ny; j++) {
        for (i = 0; i < nx; i++) {
          var best = 1e18, sign = 1;
          for (var q = 0; q < path.length - 1; q++) {
            var ax = path[q][0], ay = path[q][1], bx = path[q + 1][0], by = path[q + 1][1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
            var t = l2 ? clamp(((i - ax) * dx + (j - ay) * dy) / l2, 0, 1) : 0, cx = ax + t * dx - i, cy = ay + t * dy - j, d2 = cx * cx + cy * cy;
            if (d2 < best) { best = d2; sign = (dx * (j - ay) - dy * (i - ax)) >= 0 ? 1 : -1; }
          }
          var sd = Math.sqrt(best) * sign;
          if (best < 900) h[j * nx + i] += stepH * smooth(-wEdge, wEdge, sd) - stepH * 0.5;
        }
      }
      world.cliffs.push({ path: path, side: 1, step: stepH });
    }

    // ถมแอ่งปิดตามธรรมชาติให้น้ำไหลออกได้ (เหลือเฉพาะหลุมยุบที่เราใส่เอง)
    var fl0 = flood(h, nx, ny, Math.max(0.03, interval * 0.012));
    // ที่ถมแล้วใส่ความไม่เรียบเล็กน้อย ให้ลำน้ำคดเคี้ยวตามธรรมชาติแทนที่จะเป็นเส้นตรง
    var nflat = makeNoise((o.seed | 0) * 17 + 2);
    for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
      p = j * nx + i;
      var fd = fl0.filled[p] - h[p];
      h[p] = fl0.filled[p] + (fd > 0 ? Math.min(1, fd / (interval * 0.3)) * interval * 0.12 * (fbm(nflat, i * 0.16, j * 0.16, 2, 0.5)) : 0);
    }

    // ที่ต่ำปิด (หลุมยุบ)
    world.sinks = [];
    for (var sk = 0; sk < P.sink; sk++) {
      for (var tries = 0; tries < 30; tries++) {
        var cx0 = nx * (0.12 + rnd() * 0.76), cy0 = ny * (0.12 + rnd() * 0.76);
        var ci = Math.floor(cx0), cj = Math.floor(cy0), hv = h[cj * nx + ci];
        var gxs = (h[cj * nx + Math.min(nx - 1, ci + 3)] - h[cj * nx + Math.max(0, ci - 3)]) / 6, gys = (h[Math.min(ny - 1, cj + 3) * nx + ci] - h[Math.max(0, cj - 3) * nx + ci]) / 6;
        if (Math.sqrt(gxs * gxs + gys * gys) / cellM > 0.12) continue; // ไม่ชันเกินไป
        if (hv < relief * 0.25) continue; // อยู่บนที่สูงพอควร
        var sg = nx * (0.011 + rnd() * 0.006), dep = Math.max(interval * 2.8, relief * 0.035);
        var rr = Math.ceil(sg * 3.5);
        for (j = Math.max(0, cj - rr); j < Math.min(ny, cj + rr); j++) for (i = Math.max(0, ci - rr); i < Math.min(nx, ci + rr); i++) { var dd = (i - cx0) * (i - cx0) + (j - cy0) * (j - cy0); h[j * nx + i] -= dep * Math.exp(-dd / (2 * sg * sg)); }
        world.sinks.push({ gx: cx0, gy: cy0, r: sg, depth: dep });
        break;
      }
    }
    // ความไม่เรียบเล็กน้อยทั่วแผนที่ ให้ลำน้ำไม่เป็นเส้นตรง 45 องศาตามข้อจำกัดของการคำนวณทิศน้ำไหล
    var nmic = makeNoise((o.seed | 0) * 29 + 4);
    for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) h[j * nx + i] += interval * 0.09 * fbm(nmic, i * 0.2, j * 0.2, 2, 0.5);
    // ยกทั้งแผนที่ให้ฐานตรงตามระดับที่ตั้ง
    var minH = 1e9; for (p = 0; p < N; p++) if (h[p] < minH) minH = h[p];
    for (p = 0; p < N; p++) h[p] = h[p] - minH + world.base;
    world.h = h;

    // ความลาดชัน (องศา)
    var slope = new Float32Array(N);
    for (j = 1; j < ny - 1; j++) for (i = 1; i < nx - 1; i++) {
      p = j * nx + i;
      var gxx = (h[p + 1] - h[p - 1]) / (2 * cellM), gyy = (h[p + nx] - h[p - nx]) / (2 * cellM);
      slope[p] = Math.atan(Math.sqrt(gxx * gxx + gyy * gyy)) * 180 / Math.PI;
    }
    world.slope = slope;

    onStatus('วิเคราะห์ทางน้ำ…');
    var fl = flood(h, nx, ny, Math.max(0.03, interval * 0.012));
    world.acc = fl.acc; world.parent = fl.parent; world.filled = fl.filled;
    var T_STREAM = Math.max(28, N * 0.0032), T_RIVER = N * 0.018;
    world.T_STREAM = T_STREAM; world.T_RIVER = T_RIVER;

    // แบ่งช่วงลำน้ำ
    function segments(acc, parent, lo, minLen) {
      var mask = new Uint8Array(N), child = new Uint8Array(N), res = [], q2, c;
      for (c = 0; c < N; c++) if (acc[c] >= lo) mask[c] = 1;
      for (c = 0; c < N; c++) if (mask[c]) { q2 = parent[c]; if (q2 >= 0 && mask[q2] && child[q2] < 255) child[q2]++; }
      for (c = 0; c < N; c++) {
        if (!mask[c] || child[c] === 1) continue;
        var cells = [c], cur = c;
        for (;;) { q2 = parent[cur]; if (q2 < 0 || !mask[q2]) break; cells.push(q2); cur = q2; if (child[cur] !== 1) break; }
        if (cells.length < minLen) continue;
        var pts = cells.map(function (cl) { var x = cl % nx; return [x + 0.5, (cl - x) / nx + 0.5]; });
        res.push({ cells: cells, pts: chaikin(pts, 2), accEnd: acc[cells[Math.max(0, cells.length - 2)]], accStart: acc[cells[0]] }); // ค่ารับน้ำก่อนถึงจุดบรรจบ (ไม่นับกิ่งอื่นที่มาบรรจบ)
      }
      return res;
    }
    world.streamSegs = segments(fl.acc, fl.parent, T_STREAM, 6);
    world.streamMask = new Uint8Array(N);
    world.streamSegs.forEach(function (sg) { sg.cells.forEach(function (cl) { world.streamMask[cl] = 1; }); });
    world.riverMask = new Uint8Array(N);
    for (p = 0; p < N; p++) if (fl.acc[p] >= T_RIVER) world.riverMask[p] = 1;

    // ชื่อลำน้ำ: ช่วงที่ยาวและรับน้ำมาก
    var named = world.streamSegs.slice().sort(function (a, b) { return b.accEnd - a.accEnd; });
    var mainName = null;
    named.forEach(function (sg, idx) {
      var longEnough = sg.cells.length >= nx * 0.05;
      if (idx === 0) { mainName = namer.water('แม่น้ำ'); sg.name = mainName; }
      else if (longEnough && idx < 14) sg.name = namer.water(pick(['ห้วย', 'ห้วย', 'คลอง', 'ลำ'], rnd));
      sg.kind = sg.accEnd >= T_RIVER ? 'river' : 'stream';
    });

    onStatus('หายอดเขา คอเขา สันเขา…');
    // ยอดเขา
    var peaks = [], r1 = Math.max(3, Math.round(nx * 0.018)), r2 = Math.max(6, Math.round(nx * 0.04));
    function ringMin(x, y, r) { var m = 1e9; for (var a = 0; a < 16; a++) { var xx = clamp(Math.round(x + r * Math.cos(a * Math.PI / 8)), 0, nx - 1), yy = clamp(Math.round(y + r * Math.sin(a * Math.PI / 8)), 0, ny - 1), v = h[yy * nx + xx]; if (v < m) m = v; } return m; }
    function ringMax(x, y, r) { var m = -1e9; for (var a = 0; a < 16; a++) { var xx = clamp(Math.round(x + r * Math.cos(a * Math.PI / 8)), 0, nx - 1), yy = clamp(Math.round(y + r * Math.sin(a * Math.PI / 8)), 0, ny - 1), v = h[yy * nx + xx]; if (v > m) m = v; } return m; }
    for (j = r2 + 1; j < ny - r2 - 1; j++) for (i = r2 + 1; i < nx - r2 - 1; i++) {
      p = j * nx + i;
      var z = h[p], ok = true;
      for (k = 0; k < 8 && ok; k++) if (h[p + DY[k] * nx + DX[k]] > z) ok = false;
      if (!ok) continue;
      if (ringMax(i, j, r1) > z || ringMax(i, j, r2) > z + 0.5) continue;
      var prom = z - ringMin(i, j, r2);
      if (prom >= relief * 0.07) peaks.push({ gx: i + 0.5, gy: j + 0.5, elev: z, prom: prom });
    }
    peaks.sort(function (a, b) { return b.elev - a.elev; });
    var kept = [], minD = nx * 0.07;
    peaks.forEach(function (pk) { if (kept.length < 9 && !kept.some(function (q) { return Math.hypot(q.gx - pk.gx, q.gy - pk.gy) < minD; })) kept.push(pk); });
    kept.forEach(function (pk, idx) { pk.name = namer.hill(idx === 0 ? 'ดอย' : null); });
    world.peaks = kept;

    // คอเขา: วงแหวนรอบจุด (8 ทิศ) มีสูง-ต่ำสลับกันสองคู่
    var sad = [], rs = Math.max(3, Math.round(nx * 0.014)), ro = [[rs, 0], [Math.round(rs * 0.71), Math.round(rs * 0.71)], [0, rs], [-Math.round(rs * 0.71), Math.round(rs * 0.71)], [-rs, 0], [-Math.round(rs * 0.71), -Math.round(rs * 0.71)], [0, -rs], [Math.round(rs * 0.71), -Math.round(rs * 0.71)]];
    var thr0 = interval * 0.25;
    for (j = rs + 2; j < ny - rs - 2; j++) for (i = rs + 2; i < nx - rs - 2; i++) {
      p = j * nx + i;
      var z0 = h[p], pos = 0, neg2 = 0, hiM = 1e9, loM = -1e9, seq = [], vals = [];
      for (k = 0; k < 8; k++) {
        var vv = h[p + ro[k][1] * nx + ro[k][0]];
        vals.push(vv);
        if (vv > z0 + thr0) { seq.push(1); pos++; if (vv < hiM) hiM = vv; }
        else if (vv < z0 - thr0) { seq.push(-1); neg2++; if (vv > loM) loM = vv; }
        else seq.push(0);
      }
      if (pos < 2 || neg2 < 2) continue;
      var nz = seq.filter(function (q) { return q !== 0; });
      var ch = 0; for (k = 0; k < nz.length; k++) if (nz[k] !== nz[(k + 1) % nz.length]) ch++;
      if (ch !== 4) continue;
      var sc = Math.min(hiM - z0, z0 - loM);
      if (sc >= relief * 0.01 && z0 > world.base + relief * 0.15) sad.push({ gx: i + 0.5, gy: j + 0.5, elev: z0, score: sc });
    }
    sad.sort(function (a, b) { return b.score - a.score; });
    var sk2 = []; sad.forEach(function (sd2) { if (sk2.length < 6 && !sk2.some(function (q) { return Math.hypot(q.gx - sd2.gx, q.gy - sd2.gy) < nx * 0.06; })) sk2.push(sd2); });
    world.saddles = sk2;

    // สันเขา (วิเคราะห์จากความสูงกลับด้าน)
    var neg = new Float32Array(N); for (p = 0; p < N; p++) neg[p] = -h[p];
    var inv = flood(neg, nx, ny);
    var rsegs = segments(inv.acc, inv.parent, Math.max(40, N * 0.0042), Math.round(nx * 0.06)).sort(function (a, b) { return b.accEnd - a.accEnd; });
    world.ridges = rsegs.slice(0, 7);
    world.ridges.forEach(function (rg, idx) { if (idx < 4) rg.name = 'สัน' + pick(N_HILL, rnd); });

    // หุบเขา: ช่วงลำน้ำสายใหญ่ (แกนหุบเขา)
    world.valleys = world.streamSegs.filter(function (sg) { return sg.accEnd >= N * 0.009 && sg.cells.length >= nx * 0.08; }).slice(0, 4);
    world.valleys.forEach(function (v) { v.vname = 'หุบเขา' + pick(N_WATER, rnd); });

    return world;
  }


  /* ---------- ระยะทางถึงเซลล์ในหน้ากาก (chamfer) ---------- */
  function distanceTo(mask, w, h) {
    var N = w * h, d = new Float32Array(N), x, y, p, INF = 1e6, D1 = 1, D2 = 1.4142;
    for (p = 0; p < N; p++) d[p] = mask[p] ? 0 : INF;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      p = y * w + x;
      if (x > 0) d[p] = Math.min(d[p], d[p - 1] + D1);
      if (y > 0) { d[p] = Math.min(d[p], d[p - w] + D1); if (x > 0) d[p] = Math.min(d[p], d[p - w - 1] + D2); if (x < w - 1) d[p] = Math.min(d[p], d[p - w + 1] + D2); }
    }
    for (y = h - 1; y >= 0; y--) for (x = w - 1; x >= 0; x--) {
      p = y * w + x;
      if (x < w - 1) d[p] = Math.min(d[p], d[p + 1] + D1);
      if (y < h - 1) { d[p] = Math.min(d[p], d[p + w] + D1); if (x < w - 1) d[p] = Math.min(d[p], d[p + w + 1] + D2); if (x > 0) d[p] = Math.min(d[p], d[p + w - 1] + D2); }
    }
    return d;
  }

  /* ---------- หาเส้นทางบนกริดหยาบ (A*) ---------- */
  function astar(cost, cw, ch, sx, sy, tx, ty) {
    var N = cw * ch, g = new Float32Array(N).fill(1e9), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N), heap = new Heap(N * 2 + 16);
    var s0 = sy * cw + sx, t0 = ty * cw + tx;
    g[s0] = 0; heap.push(Math.hypot(tx - sx, ty - sy), s0);
    var k, x, y, nx2, ny2, np, c, ng;
    while (heap.n > 0) {
      c = heap.pop();
      if (closed[c]) continue;
      closed[c] = 1;
      if (c === t0) break;
      x = c % cw; y = (c - x) / cw;
      for (k = 0; k < 8; k++) {
        nx2 = x + DX[k]; ny2 = y + DY[k];
        if (nx2 < 0 || ny2 < 0 || nx2 >= cw || ny2 >= ch) continue;
        np = ny2 * cw + nx2;
        if (closed[np] || cost[np] >= 1e5) continue;
        ng = g[c] + (DX[k] && DY[k] ? 1.4142 : 1) * 0.5 * (cost[c] + cost[np]);
        if (ng < g[np]) { g[np] = ng; from[np] = c; heap.push(ng + Math.hypot(tx - nx2, ty - ny2), np); }
      }
    }
    if (!closed[t0]) return null;
    var path = [], cur = t0;
    while (cur >= 0) { var cx = cur % cw; path.push([cx, (cur - cx) / cw]); cur = from[cur]; }
    return path.reverse();
  }

  // วางสถานที่ ชุมชน ถนน พืชคลุมดิน บนโลกที่สร้างไว้
  function populate(world, o, onStatus) {
    onStatus = onStatus || function () {};
    var nx = world.nx, ny = world.ny, N = world.N, h = world.h, slope = world.slope, rnd = world.rnd, namer = world.namer, relief = world.relief, base = world.base;
    var P = PRESETS[o.preset] || PRESETS.hills, i, j, p, k;
    var nz = makeNoise((o.seed | 0) * 11 + 6);
    function rel(p0) { return (h[p0] - base) / relief; }

    onStatus('วางหมู่บ้านและสถานที่…');
    var dRiver = distanceTo(world.riverMask, nx, ny), dStream = distanceTo(world.streamMask, nx, ny);
    world.dRiver = dRiver; world.dStream = dStream;

    // หนอง/อ่างเก็บน้ำ
    var ponds = [], pondMask = new Uint8Array(N), nPond = (o.preset === 'plain' ? 2 : 1) + (rnd() < 0.5 ? 1 : 0);
    var cands = [];
    for (j = 8; j < ny - 8; j += 2) for (i = 8; i < nx - 8; i += 2) { p = j * nx + i; if (slope[p] < 2.2 && dStream[p] > 4 && dStream[p] < 16 && dRiver[p] > 6 && rel(p) < 0.55) cands.push(p); }
    for (var pn = 0; pn < nPond && cands.length; pn++) {
      var cp = cands[Math.floor(rnd() * cands.length)], pgx = cp % nx, pgy = (cp - pgx) / nx, rb = nx * (0.012 + rnd() * 0.012), pts = [];
      if (ponds.some(function (q) { return Math.hypot(q.gx - pgx, q.gy - pgy) < nx * 0.2; })) continue;
      for (var a = 0; a < 20; a++) { var ang = a / 20 * Math.PI * 2, rr = rb * (0.75 + 0.5 * (nz(Math.cos(ang) * 1.4 + pgx * 0.1, Math.sin(ang) * 1.4 + pgy * 0.1) * 0.5 + 0.5)); pts.push([pgx + Math.cos(ang) * rr, pgy + Math.sin(ang) * rr * 0.8]); }
      var poly = chaikin(pts.concat([pts[0]]), 2);
      ponds.push({ gx: pgx, gy: pgy, poly: poly, r: rb, name: namer.pond() });
      for (j = Math.floor(pgy - rb * 1.4); j <= pgy + rb * 1.4; j++) for (i = Math.floor(pgx - rb * 1.4); i <= pgx + rb * 1.4; i++) if (i >= 0 && j >= 0 && i < nx && j < ny && Math.hypot(i - pgx, (j - pgy) / 0.8) < rb * 0.85) pondMask[j * nx + i] = 1;
    }
    world.ponds = ponds; world.pondMask = pondMask;
    var dPond = distanceTo(pondMask, nx, ny);

    // หมู่บ้าน
    var vc = [];
    for (j = Math.round(ny * 0.08); j < ny * 0.92; j += 2) for (i = Math.round(nx * 0.08); i < nx * 0.92; i += 2) {
      p = j * nx + i;
      if (slope[p] < 5 && rel(p) < 0.62 && dRiver[p] > 5 && dStream[p] > 3 && dPond[p] > 5) vc.push({ p: p, sc: rnd() + 0.6 * smooth(30, 6, dStream[p]) + 0.4 * smooth(6, 1, slope[p]) });
    }
    vc.sort(function (a, b) { return b.sc - a.sc; });
    var villages = [], minSep = nx * (P.towns >= 6 ? 0.14 : 0.18), wantV = P.towns;
    vc.forEach(function (c) {
      if (villages.length >= wantV) return;
      var gx = c.p % nx, gy = (c.p - gx) / nx;
      if (villages.some(function (v) { return Math.hypot(v.gx - gx, v.gy - gy) < minSep; })) return;
      villages.push({ gx: gx + 0.5, gy: gy + 0.5, p: c.p });
    });
    // ขนาดหมู่บ้าน: ใหญ่สุดเป็นศูนย์กลางตำบล
    villages.forEach(function (v, idx) { v.size = idx === 0 ? 'large' : idx < 3 ? 'mid' : 'small'; v.name = namer.village(); v.houses = []; });
    function valid(gx, gy, maxSlope) { var xi = Math.floor(gx), yi = Math.floor(gy); if (xi < 2 || yi < 2 || xi >= nx - 2 || yi >= ny - 2) return false; var q = yi * nx + xi; return slope[q] < (maxSlope || 9) && !pondMask[q] && !world.riverMask[q] && !world.streamMask[q]; }
    villages.forEach(function (v) {
      var nh = v.size === 'large' ? 30 : v.size === 'mid' ? 18 : 10, rv = nx * (v.size === 'large' ? 0.028 : v.size === 'mid' ? 0.02 : 0.014), tries = 0;
      while (v.houses.length < nh && tries++ < nh * 12) {
        var ang = rnd() * Math.PI * 2, rr = rv * Math.sqrt(rnd()), hx = v.gx + Math.cos(ang) * rr, hy = v.gy + Math.sin(ang) * rr * 0.9;
        if (!valid(hx, hy, 10)) continue;
        if (v.houses.some(function (q) { return Math.hypot(q[0] - hx, q[1] - hy) < nx * 0.0042; })) continue;
        v.houses.push([hx, hy, rnd() < 0.5 ? 0 : 1]);
      }
    });
    world.villages = villages;
    var villageMask = new Uint8Array(N);
    villages.forEach(function (v) { v.houses.forEach(function (q) { villageMask[Math.floor(q[1]) * nx + Math.floor(q[0])] = 1; }); });
    var dVil = distanceTo(villageMask, nx, ny);
    world.dVil = dVil;

    // สถานที่สำคัญ
    var pois = [];
    function nearFree(cx, cy, rmin, rmax, maxSlope) {
      for (var t = 0; t < 60; t++) { var ang = rnd() * Math.PI * 2, rr = rmin + rnd() * (rmax - rmin), gx = cx + Math.cos(ang) * rr, gy = cy + Math.sin(ang) * rr * 0.9; if (valid(gx, gy, maxSlope)) { var tooClose = pois.some(function (q) { return Math.hypot(q.gx - gx, q.gy - gy) < nx * 0.011; }); if (!tooClose) return [gx, gy]; } }
      return null;
    }
    function short(name) { return name.replace(/^บ้าน/, ''); }
    villages.forEach(function (v, idx) {
      var big = idx === 0;
      if (v.size !== 'small' || rnd() < 0.4) { var sp = nearFree(v.gx, v.gy, nx * 0.008, nx * 0.026, 6); if (sp) pois.push({ type: 'school', gx: sp[0], gy: sp[1], name: 'โรงเรียน' + v.name }); }
      if (rnd() < 0.75 || big) { var tp = nearFree(v.gx, v.gy, nx * 0.01, nx * 0.03, 8); if (tp) { pois.push({ type: 'temple', gx: tp[0], gy: tp[1], name: namer.temple() }); if (rnd() < 0.5) { var gp = nearFree(tp[0], tp[1], nx * 0.012, nx * 0.026, 8); if (gp) pois.push({ type: 'graveyard', gx: gp[0], gy: gp[1], name: 'ป่าช้า' + short(v.name) }); } } }
      if (big) {
        var hp = nearFree(v.gx, v.gy, nx * 0.008, nx * 0.024, 5); if (hp) pois.push({ type: 'hospital', gx: hp[0], gy: hp[1], name: 'รพ.สต.' + short(v.name) });
        var op = nearFree(v.gx, v.gy, nx * 0.006, nx * 0.022, 5); if (op) pois.push({ type: 'office', gx: op[0], gy: op[1], name: 'อบต.' + short(v.name) });
        var mp = nearFree(v.gx, v.gy, nx * 0.006, nx * 0.022, 5); if (mp) pois.push({ type: 'market', gx: mp[0], gy: mp[1], name: 'ตลาด' + short(v.name) });
      }
    });
    // ลานกางเต็นท์ (ที่ราบใกล้ลำห้วย ห่างหมู่บ้าน)
    for (var t2 = 0; t2 < 400; t2++) {
      var cgx = nx * (0.1 + rnd() * 0.8), cgy = ny * (0.1 + rnd() * 0.8), cq = Math.floor(cgy) * nx + Math.floor(cgx);
      if (dVil[cq] > nx * 0.16 && dStream[cq] < 8 && dStream[cq] > 2 && slope[cq] < 5 && valid(cgx, cgy, 6)) { pois.push({ type: 'camp', gx: cgx, gy: cgy, name: 'ลานกางเต็นท์' + pick(N_WATER, rnd) }); break; }
    }
    // จุดชมวิว ใกล้ยอดเขาที่สูงที่สุด
    if (world.peaks.length) { var pk0 = world.peaks[0], vp = nearFree(pk0.gx, pk0.gy, 2, nx * 0.02, 25); if (vp) pois.push({ type: 'viewpoint', gx: vp[0], gy: vp[1], name: 'จุดชมวิว' + pk0.name.replace(/^(ดอย|เขา|ภู)/, '') }); }
    // น้ำตก: ช่วงลำห้วยที่ตกชัน
    var falls = [];
    world.streamSegs.forEach(function (sg) {
      if (sg.cells.length < 10) return;
      for (var q = 0; q + 5 < sg.cells.length; q += 3) {
        var drop = h[sg.cells[q]] - h[sg.cells[q + 5]];
        if (drop > Math.max(world.interval * 1.4, relief * 0.02)) { falls.push({ drop: drop, cell: sg.cells[q + 2] }); break; }
      }
    });
    falls.sort(function (a, b) { return b.drop - a.drop; });
    falls.slice(0, 2).forEach(function (f) { var fx = f.cell % nx; pois.push({ type: 'waterfall', gx: fx + 0.5, gy: (f.cell - fx) / nx + 0.5, name: namer.fall() }); });
    // ถ้ำ ใกล้หน้าผา
    if (world.cliffs.length && rnd() < 0.85) {
      var cl = world.cliffs[0], mid = cl.path[Math.floor(cl.path.length / 2)], cvp = nearFree(mid[0], mid[1], 1, 5, 40);
      if (cvp) pois.push({ type: 'cave', gx: cvp[0], gy: cvp[1], name: namer.cave() });
    }
    world.pois = pois;

    onStatus('สร้างถนนและทางเดิน…');
    // ต้นทุนบนกริดหยาบ
    var cstep = Math.max(1, Math.round(nx / 260)), cw = Math.ceil(nx / cstep), ch = Math.ceil(ny / cstep), cost = new Float32Array(cw * ch), cj, ci;
    function fillCost(footMode) {
      for (cj = 0; cj < ch; cj++) for (ci = 0; ci < cw; ci++) {
        var q = Math.min(ny - 1, cj * cstep + (cstep >> 1)) * nx + Math.min(nx - 1, ci * cstep + (cstep >> 1)), sl = slope[q], c0 = 1 + (footMode ? sl * sl / 45 : sl * sl / 8);
        if (world.riverMask[q]) c0 += footMode ? 25 : 60;
        else if (world.streamMask[q]) c0 += footMode ? 3 : 7;
        if (pondMask[q]) c0 = 1e6;
        if (sl > (footMode ? 40 : 24)) c0 = 1e6;
        cost[cj * cw + ci] = c0;
      }
    }
    function route(ax, ay, bx, by, foot) {
      fillCost(!!foot);
      var path = astar(cost, cw, ch, clamp(Math.floor(ax / cstep), 0, cw - 1), clamp(Math.floor(ay / cstep), 0, ch - 1), clamp(Math.floor(bx / cstep), 0, cw - 1), clamp(Math.floor(by / cstep), 0, ch - 1));
      if (!path) return null;
      var pts = path.map(function (q) { return [q[0] * cstep + cstep / 2, q[1] * cstep + cstep / 2]; });
      pts[0] = [ax, ay]; pts[pts.length - 1] = [bx, by];
      return chaikin(pts, 3);
    }
    var roads = [];
    function addRoad(cls, pts, from, to) { if (pts && pts.length > 2) roads.push({ cls: cls, pts: pts, from: from, to: to }); }
    if (villages.length) {
      var vertical = world.vertical, sorted = villages.slice().sort(function (a, b) { return vertical ? a.gy - b.gy : a.gx - b.gx; });
      var entryA = vertical ? [nx * (0.25 + rnd() * 0.5), 1.5] : [1.5, ny * (0.25 + rnd() * 0.5)], entryB = vertical ? [nx * (0.25 + rnd() * 0.5), ny - 2.5] : [nx - 2.5, ny * (0.25 + rnd() * 0.5)];
      var nodes = [entryA].concat(sorted.map(function (v) { return [v.gx, v.gy]; })).concat([entryB]);
      for (var q = 0; q + 1 < nodes.length; q++) addRoad('main', route(nodes[q][0], nodes[q][1], nodes[q + 1][0], nodes[q + 1][1], false), q, q + 1);
      world.mainTrunk = sorted;
      // ถนนลูกรังเชื่อมหมู่บ้านเล็กกับหมู่บ้านใกล้เคียง
      sorted.forEach(function (v, idx) {
        if (idx === 0 || rnd() < 0.6) { var o2 = sorted[Math.max(0, idx - 1)]; if (o2 !== v && rnd() < 0.5) addRoad('sec', route(v.gx, v.gy, o2.gx + 3, o2.gy + 3, false), idx, idx); }
        // ทางเกวียนออกไปสู่ไร่และป่า
        for (var cc = 0; cc < 1 + (rnd() < 0.6 ? 1 : 0); cc++) {
          var tgt = nearFreeFar(v, nx * 0.07, nx * 0.16);
          if (tgt) addRoad('cart', route(v.gx, v.gy, tgt[0], tgt[1], true), idx, -1);
        }
      });
      function nearFreeFar(v, rmin, rmax) { for (var t = 0; t < 60; t++) { var ang = rnd() * Math.PI * 2, rr = rmin + rnd() * (rmax - rmin), gx = v.gx + Math.cos(ang) * rr, gy = v.gy + Math.sin(ang) * rr; if (valid(gx, gy, 14)) return [gx, gy]; } return null; }
      // ทางเดินเท้าไปยอดเขา น้ำตก ลานกางเต็นท์
      function nearestVillage(gx, gy) { var b = null, bd = 1e9; villages.forEach(function (v) { var d = Math.hypot(v.gx - gx, v.gy - gy); if (d < bd) { bd = d; b = v; } }); return b; }
      pois.forEach(function (pp) {
        if (pp.type === 'viewpoint' || pp.type === 'waterfall' || pp.type === 'camp' || pp.type === 'cave') {
          var nv = nearestVillage(pp.gx, pp.gy);
          if (nv) addRoad('foot', route(nv.gx, nv.gy, pp.gx, pp.gy, true), -1, -1);
        }
      });
    }
    world.roads = roads;
    // สะพาน: จุดที่ถนนข้ามลำน้ำ (ตรวจตามเส้นทุกครึ่งเซลล์ เมื่อออกจากน้ำจึงวางสะพานกลางช่วงเปียก)
    var bridges = [];
    function wetAt(gx, gy) { var xi = Math.floor(gx), yi = Math.floor(gy); return xi >= 0 && yi >= 0 && xi < nx && yi < ny && (world.streamMask[yi * nx + xi] || world.riverMask[yi * nx + xi]); }
    roads.forEach(function (rd) {
      if (rd.cls !== 'main' && rd.cls !== 'sec') return;
      var inWet = false, startPt = null, lastPt = null, lastAng = 0;
      for (var q = 0; q + 1 < rd.pts.length; q++) {
        var a2 = rd.pts[q], b2 = rd.pts[q + 1], len2 = Math.hypot(b2[0] - a2[0], b2[1] - a2[1]), steps = Math.max(1, Math.ceil(len2 / 0.5));
        for (var st = 0; st <= steps; st++) {
          var tt = st / steps, px = a2[0] + (b2[0] - a2[0]) * tt, py = a2[1] + (b2[1] - a2[1]) * tt, wet = wetAt(px, py);
          if (wet && !inWet) { inWet = true; startPt = [px, py]; }
          if (wet) { lastPt = [px, py]; lastAng = Math.atan2(b2[1] - a2[1], b2[0] - a2[0]); }
          if (!wet && inWet) {
            inWet = false;
            var mx = (startPt[0] + lastPt[0]) / 2, my = (startPt[1] + lastPt[1]) / 2;
            if (!bridges.some(function (b) { return Math.hypot(b.gx - mx, b.gy - my) < 6; })) bridges.push({ gx: mx, gy: my, ang: lastAng });
          }
        }
      }
    });
    world.bridges = bridges;
    // ปั๊มน้ำมันริมถนนหลักใกล้หมู่บ้านใหญ่
    var mainRd = roads.filter(function (r) { return r.cls === 'main'; });
    if (mainRd.length && villages.length) {
      var bestPt = null, bd2 = 1e9;
      mainRd.forEach(function (r) { r.pts.forEach(function (q) { var d = Math.hypot(q[0] - villages[0].gx, q[1] - villages[0].gy); if (d > nx * 0.03 && d < bd2) { bd2 = d; bestPt = q; } }); });
      if (bestPt && rnd() < 0.8) pois.push({ type: 'gas', gx: bestPt[0] + 1.4, gy: bestPt[1] + 1.4, name: 'ปั๊มน้ำมัน' });
    }
    // สายไฟฟ้าแรงสูงตัดผ่านแผนที่
    var power = null;
    if (villages.length >= 2) { var pa = villages[0], pbv = villages[villages.length - 1]; power = { a: [pa.gx - nx * 0.02, pa.gy + ny * 0.04], b: [pbv.gx + nx * 0.02, pbv.gy - ny * 0.04] }; }
    world.power = power;

    onStatus('กำหนดพืชคลุมดิน…');
    var nF = makeNoise((o.seed | 0) * 19 + 8), nO = makeNoise((o.seed | 0) * 23 + 3), nA = makeNoise((o.seed | 0) * 31 + 1);
    var fS = new Float32Array(N), aS = new Float32Array(N), oS = new Float32Array(N), pS = new Float32Array(N);
    for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
      p = j * nx + i;
      var r0 = rel(p), sl = slope[p], dv = dVil[p], nrs = fbm(nF, i * 0.035, j * 0.035, 3, 0.5), nrf = fbm(nA, i * 0.05 + 30, j * 0.05, 2, 0.5);
      var forest = 0.5 * smooth(0.2, 0.6, r0) + 0.5 * smooth(4, 14, sl) + 0.5 * nrs - 0.7 * smooth(nx * 0.12, nx * 0.02, dv);
      var field = (1 - smooth(5, 11, sl)) * (1 - smooth(0.45, 0.75, r0)) * (0.35 + 0.65 * smooth(nx * 0.4, nx * 0.04, dv)) + 0.45 * nrf;
      var paddy = field * (1 - smooth(1.2, 3.2, sl)) * (1 - smooth(0.2, 0.4, r0)) * smooth(nx * 0.07, nx * 0.015, dStream[p]);
      var orch = smooth(nx * 0.3, nx * 0.04, dv) * (1 - smooth(8, 14, sl)) * (0.5 + 0.9 * fbm(nO, i * 0.05, j * 0.05, 2, 0.5));
      fS[p] = forest; aS[p] = field; pS[p] = paddy; oS[p] = orch;
    }
    world.cover = { forest: fS, field: aS, paddy: pS, orchard: oS };

    return world;
  }

  root.TrailSynMap = { generate: generate, populate: populate, _internal: { mulberry32: mulberry32, makeNoise: makeNoise, fbm: fbm, flood: flood, PRESETS: PRESETS, niceInterval: niceInterval, clamp: clamp, lerp: lerp, smooth: smooth, FONT: FONT, chaikin: chaikin, pick: pick } };
})(typeof self !== 'undefined' ? self : this);
