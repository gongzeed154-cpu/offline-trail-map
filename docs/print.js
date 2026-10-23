// สร้างแผนที่ฝึกสำหรับพิมพ์: กริด UTM ตามมาตราส่วนจริง + สเกล + ทิศเหนือ + สัญลักษณ์ทหาร ส่งออก PDF/PNG/JPEG
(function (root) {
  var G = TrailGeo;
  var C = TrailCommon;
  var KEY = 'trail_print_v1';
  var PAPERS = { A5: [148, 210], A4: [210, 297], A3: [297, 420], Letter: [216, 279] };
  var SCALES = [10000, 25000, 50000, 100000, 250000];
  var FONT = '"Sarabun","Noto Sans Thai",-apple-system,sans-serif';
  var BARS = [[100, 25], [200, 50], [500, 100], [1000, 250], [2000, 500], [2500, 500], [4000, 1000], [5000, 1000], [8000, 2000], [10000, 2000], [20000, 5000], [25000, 5000], [40000, 10000], [50000, 10000]];

  var cfg = { title: 'แบบฝึกอ่านพิกัดกริด', paper: 'A4', land: false, scale: 50000, grid: 'auto', style: 'lines', center: '', cfmt: 'mgrs', base: 'none', fade: 55, sym: true, routes: true, dpi: 150 };
  var ctx = null;
  var last = null;
  var busy = false;

  function $(id) { return document.getElementById(id); }
  function init(c) {
    ctx = c;
    try { var s = JSON.parse(localStorage.getItem(KEY) || '{}'); for (var k in cfg) if (s[k] !== undefined) cfg[k] = s[k]; } catch (e) { /* ค่าเริ่มต้น */ }
  }
  function saveCfg() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* ไม่เป็นไร */ } }
  function autoGrid(scale) { return scale <= 10000 ? 100 : scale <= 100000 ? 1000 : 10000; }
  function safeName(s) { return String(s).replace(/[\\/:*?"<>|]/g, '_').trim() || 'map'; }
  function fmtLen(m) { return m >= 1000 ? (m / 1000) + ' กม.' : m + ' ม.'; }

  /* ---------- พื้นหลังภาพไทล์ (ดึงเข้าเส้นกริด UTM) ---------- */
  async function drawBase(c, o, g, onStatus) {
    var tpl = o.base === 'sat' ? C.SAT_TEMPLATE : C.TOPO_TEMPLATE;
    var maxZ = o.base === 'sat' ? 16 : 15;
    var lat0 = G.fromUTM(g.zone, g.north, g.E0, g.N0).lat;
    var z = Math.ceil(Math.log(156543.03392 * Math.cos(lat0 * Math.PI / 180) / g.mpp) / Math.LN2);
    z = Math.max(3, Math.min(maxZ, z));
    var S = 16, nx = Math.ceil(g.fw / S) + 1, ny = Math.ceil(g.fh / S) + 1;
    var LL = new Array(nx * ny);
    for (var j = 0; j < ny; j++) {
      for (var i = 0; i < nx; i++) {
        LL[j * nx + i] = G.fromUTM(g.zone, g.north, g.E0 + (i * S - g.fw / 2) * g.mpp, g.N0 - (j * S - g.fh / 2) * g.mpp);
      }
    }
    var WX, WY, tx0, tx1, ty0, ty1, total;
    for (;;) {
      var sc = 256 * Math.pow(2, z);
      WX = new Float64Array(nx * ny); WY = new Float64Array(nx * ny);
      var mnx = 1e18, mxx = -1e18, mny = 1e18, mxy = -1e18;
      for (var k = 0; k < LL.length; k++) {
        var s = Math.sin(LL[k].lat * Math.PI / 180);
        WX[k] = (LL[k].lng + 180) / 360 * sc;
        WY[k] = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * sc;
        mnx = Math.min(mnx, WX[k]); mxx = Math.max(mxx, WX[k]); mny = Math.min(mny, WY[k]); mxy = Math.max(mxy, WY[k]);
      }
      var lim = Math.pow(2, z) - 1;
      tx0 = Math.floor(mnx / 256); tx1 = Math.floor(mxx / 256);
      ty0 = Math.max(0, Math.floor(mny / 256)); ty1 = Math.min(lim, Math.floor(mxy / 256));
      total = (tx1 - tx0 + 1) * (ty1 - ty0 + 1);
      if (total <= 150 || z <= 3) break;
      z--;
    }
    var mw = (tx1 - tx0 + 1) * 256, mh = (ty1 - ty0 + 1) * 256;
    var mosaic = document.createElement('canvas');
    mosaic.width = mw; mosaic.height = mh;
    var mc = mosaic.getContext('2d');
    var jobs = [];
    for (var ty = ty0; ty <= ty1; ty++) for (var tx = tx0; tx <= tx1; tx++) jobs.push({ tx: tx, ty: ty });
    var done = 0, got = 0;
    async function worker() {
      while (jobs.length) {
        var job = jobs.pop();
        try {
          var wrapX = ((job.tx % (lim + 1)) + lim + 1) % (lim + 1);
          var url = tpl.replace('{z}', z).replace('{x}', wrapX).replace('{y}', job.ty);
          var r = await fetch(url);
          if (r.ok) {
            var bm = await createImageBitmap(await r.blob());
            mc.drawImage(bm, (job.tx - tx0) * 256, (job.ty - ty0) * 256);
            if (bm.close) bm.close();
            got++;
          }
        } catch (e) { /* ข้ามไทล์ที่โหลดไม่ได้ */ }
        done++;
        onStatus('โหลดภาพพื้นหลัง ' + done + '/' + total + ' (ซูม ' + z + ')');
      }
    }
    await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
    if (!got) throw new Error('โหลดภาพพื้นหลังไม่ได้ (ต้องออนไลน์ หรือดาวน์โหลดพื้นที่นั้นไว้ก่อน)');
    onStatus('ปรับภาพให้ตรงกริด…');
    await new Promise(function (r) { setTimeout(r, 20); });
    var md = mc.getImageData(0, 0, mw, mh).data;
    var out = c.createImageData(g.fw, g.fh), od = out.data;
    var fade = o.fade / 100;
    var ox = tx0 * 256, oy = ty0 * 256;
    for (var py = 0; py < g.fh; py++) {
      var jj = Math.floor(py / S), fyy = (py - jj * S) / S;
      for (var px = 0; px < g.fw; px++) {
        var ii = Math.floor(px / S), fxx = (px - ii * S) / S;
        var a = jj * nx + ii, b = a + 1, d = a + nx, e = d + 1;
        var wx = (WX[a] * (1 - fxx) + WX[b] * fxx) * (1 - fyy) + (WX[d] * (1 - fxx) + WX[e] * fxx) * fyy;
        var wy = (WY[a] * (1 - fxx) + WY[b] * fxx) * (1 - fyy) + (WY[d] * (1 - fxx) + WY[e] * fxx) * fyy;
        var sx = Math.floor(wx - ox), sy = Math.floor(wy - oy);
        var o4 = (py * g.fw + px) * 4;
        var r0 = 255, g0 = 255, b0 = 255;
        if (sx >= 0 && sy >= 0 && sx < mw && sy < mh) {
          var m4 = (sy * mw + sx) * 4;
          if (md[m4 + 3] > 0) { r0 = md[m4]; g0 = md[m4 + 1]; b0 = md[m4 + 2]; }
        }
        od[o4] = 255 + (r0 - 255) * fade;
        od[o4 + 1] = 255 + (g0 - 255) * fade;
        od[o4 + 2] = 255 + (b0 - 255) * fade;
        od[o4 + 3] = 255;
      }
    }
    c.putImageData(out, g.fx, g.fy);
  }

  /* ---------- พื้นหลังแผนที่กระดาษที่นำเข้า (ดัดเข้ากริด UTM) ---------- */
  function mercXY(ll) {
    var s = Math.sin(ll.lat * Math.PI / 180);
    return [(ll.lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
  }

  // เมทริกซ์ผกผัน (3x3 แบบ adjugate) ของการแปลงจากสี่เหลี่ยมจัตุรัสหนึ่งหน่วย -> สี่มุมใด ๆ (โปรเจกทีฟ)
  // q = มุม (0,0) (1,0) (1,1) (0,1) ตามลำดับ
  function quadInverse(q) {
    var x0 = q[0][0], y0 = q[0][1], x1 = q[1][0], y1 = q[1][1], x2 = q[2][0], y2 = q[2][1], x3 = q[3][0], y3 = q[3][1];
    var dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    var gg = 0, hh = 0;
    if (Math.abs(dx3) > 1e-12 || Math.abs(dy3) > 1e-12) {
      var den = dx1 * dy2 - dx2 * dy1;
      if (Math.abs(den) < 1e-18) return null;
      gg = (dx3 * dy2 - dx2 * dy3) / den;
      hh = (dx1 * dy3 - dx3 * dy1) / den;
    }
    var a = x1 - x0 + gg * x1, b = x3 - x0 + hh * x3, c = x0, d = y1 - y0 + gg * y1, e = y3 - y0 + hh * y3, f = y0;
    return [e - f * hh, c * hh - b, b * f - c * e, f * gg - d, a - c * gg, c * d - a * f, d * hh - e * gg, b * gg - a * hh, a * e - b * d];
  }

  async function drawPaper(c, o, g, onStatus) {
    var recs = await TrailPaper.all();
    if (!recs.length) throw new Error('ยังไม่มีแผนที่กระดาษที่นำเข้า (นำเข้าได้ที่ปุ่ม ★ พิเศษ)');
    var S = 16, nx = Math.ceil(g.fw / S) + 1, ny = Math.ceil(g.fh / S) + 1;
    var MX = new Float64Array(nx * ny), MY = new Float64Array(nx * ny);
    for (var j = 0; j < ny; j++) {
      for (var i = 0; i < nx; i++) {
        var m = mercXY(G.fromUTM(g.zone, g.north, g.E0 + (i * S - g.fw / 2) * g.mpp, g.N0 - (j * S - g.fh / 2) * g.mpp));
        MX[j * nx + i] = m[0]; MY[j * nx + i] = m[1];
      }
    }
    var out = c.createImageData(g.fw, g.fh), od = out.data;
    for (var q = 0; q < od.length; q += 4) { od[q] = 255; od[q + 1] = 255; od[q + 2] = 255; od[q + 3] = 255; }
    var fade = o.fade / 100;
    var hits = 0;
    for (var r = 0; r < recs.length; r++) {
      var rec = recs[r];
      if (!rec.coords || rec.coords.length !== 4) continue;
      onStatus('วาดแผนที่กระดาษ ' + (r + 1) + '/' + recs.length + ': ' + rec.name);
      await new Promise(function (res) { setTimeout(res, 20); });
      var bm = await createImageBitmap(rec.blob);
      var tmp = document.createElement('canvas');
      tmp.width = bm.width; tmp.height = bm.height;
      var tc = tmp.getContext('2d');
      tc.drawImage(bm, 0, 0);
      if (bm.close) bm.close();
      var img = tc.getImageData(0, 0, tmp.width, tmp.height), id = img.data, W = tmp.width, H = tmp.height;
      // พิกัดเมอร์เคเตอร์สี่มุมของรูป (ย้ายไปที่มุมแรกและขยายให้เป็นเลขขนาดพอดี เพื่อความแม่นยำ)
      var cm = rec.coords.map(function (p) { return mercXY({ lng: p[0], lat: p[1] }); });
      var ox = cm[0][0], oy = cm[0][1], ext = 0;
      cm.forEach(function (p) { ext = Math.max(ext, Math.abs(p[0] - ox), Math.abs(p[1] - oy)); });
      if (!ext) continue;
      var inv = quadInverse(cm.map(function (p) { return [(p[0] - ox) / ext, (p[1] - oy) / ext]; }));
      if (!inv) continue;
      for (var py = 0; py < g.fh; py++) {
        var jj = Math.floor(py / S), fyy = (py - jj * S) / S;
        for (var px = 0; px < g.fw; px++) {
          var ii = Math.floor(px / S), fxx = (px - ii * S) / S;
          var a0 = jj * nx + ii, b0 = a0 + 1, d0 = a0 + nx, e0 = d0 + 1;
          var wx = ((MX[a0] * (1 - fxx) + MX[b0] * fxx) * (1 - fyy) + (MX[d0] * (1 - fxx) + MX[e0] * fxx) * fyy - ox) / ext;
          var wy = ((MY[a0] * (1 - fxx) + MY[b0] * fxx) * (1 - fyy) + (MY[d0] * (1 - fxx) + MY[e0] * fxx) * fyy - oy) / ext;
          var w = inv[6] * wx + inv[7] * wy + inv[8];
          if (!w) continue;
          var u = (inv[0] * wx + inv[1] * wy + inv[2]) / w, v = (inv[3] * wx + inv[4] * wy + inv[5]) / w;
          if (u < 0 || v < 0 || u >= 1 || v >= 1) continue;
          var s4 = (Math.floor(v * H) * W + Math.floor(u * W)) * 4;
          if (id[s4 + 3] === 0) continue;
          var o4 = (py * g.fw + px) * 4;
          od[o4] = 255 + (id[s4] - 255) * fade;
          od[o4 + 1] = 255 + (id[s4 + 1] - 255) * fade;
          od[o4 + 2] = 255 + (id[s4 + 2] - 255) * fade;
          hits++;
        }
      }
    }
    if (!hits) throw new Error('แผนที่กระดาษที่นำเข้าไม่ครอบคลุมพื้นที่นี้ ให้เลื่อน "ศูนย์กลางแผ่น" ไปที่พื้นที่ของแผนที่กระดาษ (ปุ่ม ★ พิเศษ → ไปที่แผนที่ แล้วกด "กลางจอ")');
    c.putImageData(out, g.fx, g.fy);
  }

  /* ---------- วาดหน้ากระดาษ ---------- */
  function gridLabel(v, I, first) {
    var km = v / 1000, dec = I < 100 ? 2 : I < 1000 ? 1 : 0;
    var s = Math.abs(km).toFixed(dec);
    if (first) return s;
    var parts = s.split('.'), ip = parseInt(parts[0], 10) % 100;
    return (ip < 10 ? '0' : '') + ip + (dec ? '.' + parts[1] : '');
  }

  async function render(o, onStatus) {
    var pxmm = o.dpi / 25.4, P = PAPERS[o.paper];
    var wmm = o.land ? P[1] : P[0], hmm = o.land ? P[0] : P[1];
    var W = Math.round(wmm * pxmm), H = Math.round(hmm * pxmm);
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var c = cv.getContext('2d');
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H);
    function mm(v) { return v * pxmm; }

    // ขอบแคบ: M = ระยะขอบกระดาษ, L = ที่ว่างสำหรับตัวเลขกริดนอกกรอบ, HD = หัวกระดาษ, FT = ท้ายกระดาษ
    var M = 6, L = 6, HD = 9, FT = Math.min(28, Math.max(24, hmm * 0.095));
    var fx = Math.round(mm(M + L)), fy = Math.round(mm(M + HD + L));
    var fw = Math.round(W - 2 * mm(M + L)), fh = Math.round(H - mm(M + HD + L) - mm(L + FT + M));
    if (fw < 100 || fh < 100) throw new Error('กระดาษเล็กเกินไปสำหรับค่านี้');
    var mpp = (o.scale / 1000) / pxmm; // เมตรต่อพิกเซล
    var cl = o.center ? G.parsePoint(o.center) : null;
    if (o.center && !cl) throw new Error('อ่านพิกัดศูนย์กลางไม่ได้ ตรวจรูปแบบ: ' + G.FORMAT_HINT[o.cfmt]);
    if (!cl) { var mc0 = ctx.map().getCenter(); cl = { lat: mc0.lat, lng: mc0.lng }; }
    var cf = G.FORMATS.indexOf(o.cfmt) >= 0 ? o.cfmt : 'mgrs'; // รูปแบบพิกัดที่พิมพ์บนแผ่น (ตามช่อง "รูปแบบพิกัด")
    if (cl.lat <= -80 || cl.lat >= 84) throw new Error('พิกัดอยู่นอกช่วง UTM');
    var u0 = G.toUTM(cl.lat, cl.lng);
    var g = { fx: fx, fy: fy, fw: fw, fh: fh, cx: fx + fw / 2, cy: fy + fh / 2, mpp: mpp, E0: u0.e, N0: u0.n, zone: u0.zone, north: u0.north };
    function P2(lat, lng) {
      var u = G.toUTM(lat, lng, g.zone);
      return [g.cx + (u.e - g.E0) / mpp, g.cy - (u.n - g.N0) / mpp];
    }
    function text(str, x, y, sizeMM, bold, align, color) {
      c.font = (bold ? '700 ' : '400 ') + mm(sizeMM).toFixed(1) + 'px ' + FONT;
      c.textAlign = align || 'left'; c.textBaseline = 'alphabetic';
      c.fillStyle = color || '#000';
      c.fillText(str, x, y);
    }

    if (o.base === 'paper') await drawPaper(c, o, g, onStatus);
    else if (o.base !== 'none') await drawBase(c, o, g, onStatus);

    // กริด
    var I = o.grid === 'auto' ? autoGrid(o.scale) : parseInt(o.grid, 10);
    var Emin = g.E0 - (fw / 2) * mpp, Emax = g.E0 + (fw / 2) * mpp, Nmin = g.N0 - (fh / 2) * mpp, Nmax = g.N0 + (fh / 2) * mpp;
    var kE0 = Math.ceil(Emin / I), kE1 = Math.floor(Emax / I), kN0 = Math.ceil(Nmin / I), kN1 = Math.floor(Nmax / I);
    function xOf(e) { return g.cx + (e - g.E0) / mpp; }
    function yOf(n) { return g.cy - (n - g.N0) / mpp; }

    // เมื่อเลือกรูปแบบพิกัดเป็นองศา ใช้เส้นละติจูด/ลองจิจูดแทนกริด UTM (ช่วงเส้นเลือกอัตโนมัติตามสเกล ให้เส้นห่างกันอย่างน้อย ~20 มม.)
    var geo = cf === 'dms' || cf === 'dm' || cf === 'dd';
    var gs = null;
    function angLabel(v, isLat, step) {
      var hemi = isLat ? (v >= 0 ? 'N' : 'S') : (v >= 0 ? 'E' : 'W'), a = Math.abs(v);
      function p2(n) { return (n < 10 ? '0' : '') + n; }
      if (cf === 'dd') return a.toFixed(Math.max(0, Math.ceil(-Math.log10(step / 3600) - 1e-9))) + '°' + hemi;
      if (cf === 'dm') {
        var dec = step % 60 === 0 ? 0 : Math.max(1, Math.ceil(-Math.log10(step / 60) - 1e-9));
        var tm = Math.round(a * 60 * Math.pow(10, dec)) / Math.pow(10, dec), dd0 = Math.floor(tm / 60 + 1e-9), mm0 = tm - dd0 * 60;
        return dd0 + '°' + (mm0 < 10 ? '0' : '') + mm0.toFixed(dec) + '′' + hemi;
      }
      var tot = Math.round(a * 3600), d1 = Math.floor(tot / 3600), m1 = Math.floor((tot % 3600) / 60), s1 = tot % 60;
      if (step % 3600 === 0) return d1 + '°' + hemi;
      if (step % 60 === 0) return d1 + '°' + p2(m1) + '′' + hemi;
      return d1 + '°' + p2(m1) + '′' + p2(s1) + '″' + hemi;
    }
    function stepName(st) {
      if (cf === 'dd') return +(st / 3600).toFixed(4) + '°';
      if (cf === 'dm') return +(st / 60).toFixed(3) + '′';
      return st >= 3600 ? st / 3600 + '°' : st >= 60 ? st / 60 + '′' : st + '″';
    }
    function crossAt(pts, axis, val) { // จุดที่เส้นตัดแกน (axis 0 = x, 1 = y) ที่ค่า val คืนค่าอีกแกนหนึ่ง
      for (var i = 1; i < pts.length; i++) {
        var a0 = pts[i - 1][axis] - val, a1 = pts[i][axis] - val;
        if (a0 * a1 < 0) return pts[i - 1][1 - axis] + (a0 / (a0 - a1)) * (pts[i][1 - axis] - pts[i - 1][1 - axis]);
      }
      return null;
    }
    if (geo) {
      var cLL = [G.fromUTM(g.zone, g.north, Emin, Nmin), G.fromUTM(g.zone, g.north, Emax, Nmin), G.fromUTM(g.zone, g.north, Emin, Nmax), G.fromUTM(g.zone, g.north, Emax, Nmax)];
      var latMin = Math.min.apply(null, cLL.map(function (q) { return q.lat; })), latMax = Math.max.apply(null, cLL.map(function (q) { return q.lat; }));
      var lngMin = Math.min.apply(null, cLL.map(function (q) { return q.lng; })), lngMax = Math.max.apply(null, cLL.map(function (q) { return q.lng; }));
      var ladder = cf === 'dms' ? [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
        : cf === 'dm' ? [6, 12, 30, 60, 120, 300, 600, 900, 1800, 3600] : [3.6, 7.2, 18, 36, 72, 180, 360, 720, 1800, 3600];
      var stepSec = ladder[ladder.length - 1];
      for (var li = 0; li < ladder.length; li++) {
        if (ladder[li] * 30.87 * (1000 / o.scale) * Math.cos(cl.lat * Math.PI / 180) >= 20) { stepSec = ladder[li]; break; }
      }
      var sd = stepSec / 3600, spLat = latMax - latMin, spLng = lngMax - lngMin;
      gs = { step: stepSec, lats: [], lngs: [], labels: [] };
      var ia, t0;
      for (ia = Math.ceil(latMin / sd - 1e-9); ia <= Math.floor(latMax / sd + 1e-9); ia++) {
        var lp = [];
        for (t0 = 0; t0 <= 16; t0++) lp.push(P2(ia * sd, lngMin - spLng * 0.05 + spLng * 1.1 * t0 / 16));
        gs.lats.push({ v: ia * sd, pts: lp });
      }
      for (ia = Math.ceil(lngMin / sd - 1e-9); ia <= Math.floor(lngMax / sd + 1e-9); ia++) {
        var gp = [];
        for (t0 = 0; t0 <= 16; t0++) gp.push(P2(latMin - spLat * 0.05 + spLat * 1.1 * t0 / 16, ia * sd));
        gs.lngs.push({ v: ia * sd, pts: gp });
      }
      gs.lats.forEach(function (la) {
        var yl = crossAt(la.pts, 0, fx), yr = crossAt(la.pts, 0, fx + fw), lab = angLabel(la.v, true, stepSec);
        if (yl !== null && yl > fy + mm(3) && yl < fy + fh - mm(3)) gs.labels.push({ side: 'L', pos: yl, str: lab });
        if (yr !== null && yr > fy + mm(3) && yr < fy + fh - mm(3)) gs.labels.push({ side: 'R', pos: yr, str: lab });
      });
      gs.lngs.forEach(function (lo) {
        var xt = crossAt(lo.pts, 1, fy), xb = crossAt(lo.pts, 1, fy + fh), lab = angLabel(lo.v, false, stepSec);
        if (xt !== null && xt > fx + mm(7) && xt < fx + fw - mm(7)) gs.labels.push({ side: 'T', pos: xt, str: lab });
        if (xb !== null && xb > fx + mm(7) && xb < fx + fw - mm(7)) gs.labels.push({ side: 'B', pos: xb, str: lab });
      });
    }
    function drawGeoGrid() {
      c.beginPath();
      if (o.style === 'lines') {
        gs.lats.concat(gs.lngs).forEach(function (ln) {
          ln.pts.forEach(function (q, i) { if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); });
        });
      } else {
        var cr2 = mm(2.5);
        gs.lats.forEach(function (la) {
          gs.lngs.forEach(function (lo) {
            var q = P2(la.v, lo.v);
            c.moveTo(q[0] - cr2, q[1]); c.lineTo(q[0] + cr2, q[1]); c.moveTo(q[0], q[1] - cr2); c.lineTo(q[0], q[1] + cr2);
          });
        });
      }
      c.stroke();
      c.lineWidth = Math.max(1, mm(0.25));
      c.beginPath();
      var tk2 = mm(2.2);
      gs.labels.forEach(function (lb) {
        if (lb.side === 'L') { c.moveTo(fx, lb.pos); c.lineTo(fx + tk2, lb.pos); }
        else if (lb.side === 'R') { c.moveTo(fx + fw, lb.pos); c.lineTo(fx + fw - tk2, lb.pos); }
        else if (lb.side === 'T') { c.moveTo(lb.pos, fy); c.lineTo(lb.pos, fy + tk2); }
        else { c.moveTo(lb.pos, fy + fh); c.lineTo(lb.pos, fy + fh - tk2); }
      });
      c.stroke();
    }
    function drawGeoLabels() {
      gs.labels.forEach(function (lb) {
        if (lb.side === 'T') text(lb.str, lb.pos, fy - mm(1.6), 2.6, false, 'center');
        else if (lb.side === 'B') text(lb.str, lb.pos, fy + fh + mm(4.2), 2.6, false, 'center');
        else {
          c.save();
          c.translate(lb.side === 'L' ? fx - mm(1.2) : fx + fw + mm(1.2), lb.pos);
          c.rotate(lb.side === 'L' ? -Math.PI / 2 : Math.PI / 2);
          text(lb.str, 0, 0, 2.6, false, 'center');
          c.restore();
        }
      });
    }

    c.save();
    c.beginPath(); c.rect(fx, fy, fw, fh); c.clip();
    c.strokeStyle = 'rgba(20,20,20,0.9)';
    c.lineWidth = Math.max(1, mm(o.style === 'lines' ? 0.25 : 0.2));
    var k, kk;
    if (geo) {
      drawGeoGrid();
    } else if (o.style === 'lines') {
      c.beginPath();
      for (k = kE0; k <= kE1; k++) { var x = xOf(k * I); c.moveTo(x, fy); c.lineTo(x, fy + fh); }
      for (kk = kN0; kk <= kN1; kk++) { var y = yOf(kk * I); c.moveTo(fx, y); c.lineTo(fx + fw, y); }
      c.stroke();
    } else {
      c.beginPath();
      var cr = mm(2.5);
      for (k = kE0; k <= kE1; k++) {
        for (kk = kN0; kk <= kN1; kk++) {
          var cx0 = xOf(k * I), cy0 = yOf(kk * I);
          c.moveTo(cx0 - cr, cy0); c.lineTo(cx0 + cr, cy0); c.moveTo(cx0, cy0 - cr); c.lineTo(cx0, cy0 + cr);
        }
      }
      c.stroke();
    }
    // ขีดสั้นที่ขอบกรอบ (กริด UTM)
    if (!geo) {
    c.lineWidth = Math.max(1, mm(0.25));
    c.beginPath();
    var tk = mm(2.2);
    for (k = kE0; k <= kE1; k++) { var xt = xOf(k * I); c.moveTo(xt, fy); c.lineTo(xt, fy + tk); c.moveTo(xt, fy + fh); c.lineTo(xt, fy + fh - tk); }
    for (kk = kN0; kk <= kN1; kk++) { var yt = yOf(kk * I); c.moveTo(fx, yt); c.lineTo(fx + tk, yt); c.moveTo(fx + fw, yt); c.lineTo(fx + fw - tk, yt); }
    c.stroke();
    }

    // เส้นทาง
    if (o.routes && ctx.visibleRoutes) {
      c.strokeStyle = '#7b2cbf'; c.lineWidth = mm(0.7); c.lineJoin = 'round';
      ctx.visibleRoutes().forEach(function (r) {
        c.beginPath();
        r.pts.forEach(function (p, i) { var q = P2(p[1], p[0]); if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); });
        c.stroke();
      });
    }
    // สัญลักษณ์ทหาร
    var nsym = 0;
    if (o.sym && root.TrailSym) {
      TrailSym.list().forEach(function (s) {
        var q = P2(s.lat, s.lng);
        if (q[0] < fx - mm(6) || q[0] > fx + fw + mm(6) || q[1] < fy - mm(6) || q[1] > fy + fh + mm(6)) return;
        TrailSym.draw(c, s.type, s.side, q[0], q[1], mm(9), s.label);
        nsym++;
      });
    }
    // หมุดที่ตั้งชื่อไว้
    if (o.sym && root.TrailProj) {
      TrailProj.visiblePins().forEach(function (p) {
        var q = P2(p.lat, p.lng);
        if (q[0] < fx || q[0] > fx + fw || q[1] < fy || q[1] > fy + fh) return;
        c.beginPath(); c.arc(q[0], q[1], mm(1.6), 0, 7);
        c.fillStyle = '#ff8a00'; c.fill(); c.lineWidth = mm(0.4); c.strokeStyle = '#000'; c.stroke();
        c.font = '700 ' + mm(2.8).toFixed(1) + 'px ' + FONT; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
        c.lineWidth = mm(0.8); c.strokeStyle = '#fff'; c.strokeText(p.name, q[0] + mm(2.4), q[1] + mm(1));
        c.fillStyle = '#000'; c.fillText(p.name, q[0] + mm(2.4), q[1] + mm(1));
      });
    }
    c.restore();

    // กรอบและตัวเลขกริด
    c.strokeStyle = '#000'; c.lineWidth = mm(0.5);
    c.strokeRect(fx, fy, fw, fh);
    if (geo) drawGeoLabels();
    else for (k = kE0; k <= kE1; k++) {
      var first = k === kE0;
      var lt = gridLabel(k * I, I, first), xx = xOf(k * I);
      text(lt, xx, fy - mm(1.6), first ? 3 : 2.6, first, 'center');
      text(lt, xx, fy + fh + mm(4.2), first ? 3 : 2.6, first, 'center');
    }
    if (!geo) for (kk = kN0; kk <= kN1; kk++) {
      var firstN = kk === kN0;
      var ln = gridLabel(kk * I, I, firstN), yy = yOf(kk * I);
      text(ln, fx - mm(1), yy + mm(0.9), firstN ? 3 : 2.6, firstN, 'right');
      text(ln, fx + fw + mm(1), yy + mm(0.9), firstN ? 3 : 2.6, firstN, 'left');
    }

    // หัวกระดาษ
    var sw = G.fromUTM(g.zone, g.north, Emin, Nmin), ne = G.fromUTM(g.zone, g.north, Emax, Nmax);
    var conv = G.convergence(cl.lat, cl.lng), decl = (ctx.prefs && ctx.prefs.decl) || 0;
    text(o.title || 'แผนที่ฝึก', mm(M), mm(M + 5), 6, true, 'left');
    text('1 : ' + o.scale.toLocaleString('en-US'), W - mm(M), mm(M + 5), 6, true, 'right');
    text('UTM ' + g.zone + G.bandOf(cl.lat) + ' · WGS84 · ศูนย์กลาง ' + G.formatPoint(cl.lat, cl.lng, cf) + ' · ' + (geo ? 'เส้นพิกัดทุก ' + stepName(gs.step) : 'กริดทุก ' + fmtLen(I)),
      mm(M), mm(M + 9), 2.7, false, 'left', '#333');

    // ส่วนท้าย: แถบสเกล
    var y0 = fy + fh + mm(L + 4);
    var contentW = fw / pxmm;
    var maxMM = Math.min(90, contentW * 0.5);
    var bar = BARS[0];
    BARS.forEach(function (b) { if (b[0] * 1000 / o.scale <= maxMM) bar = b; });
    var Lm = bar[0], dm = bar[1];
    var mmPerM = 1000 / o.scale;
    var ext = dm * mmPerM;
    var xz = fx + mm(ext + 4);
    var yb = y0 + mm(4);
    var segs = Math.round(Lm / dm), s2, sx0;
    c.lineWidth = Math.max(1, mm(0.25)); c.strokeStyle = '#000';
    for (s2 = 0; s2 < segs; s2++) {
      sx0 = xz + mm(s2 * dm * mmPerM);
      c.fillStyle = s2 % 2 ? '#fff' : '#000';
      c.fillRect(sx0, yb, mm(dm * mmPerM), mm(1.8)); c.strokeRect(sx0, yb, mm(dm * mmPerM), mm(1.8));
    }
    for (s2 = 0; s2 < 5; s2++) {
      sx0 = xz - mm(ext) + mm(s2 * ext / 5);
      c.fillStyle = s2 % 2 ? '#fff' : '#000';
      c.fillRect(sx0, yb, mm(ext / 5), mm(1.8)); c.strokeRect(sx0, yb, mm(ext / 5), mm(1.8));
    }
    function barLab(m) { return (m >= 1000 ? String(+(m / 1000).toFixed(2)) : String(m)); }
    for (s2 = 0; s2 <= segs; s2++) text(barLab(s2 * dm), xz + mm(s2 * dm * mmPerM), yb + mm(5), 2.4, false, 'center');
    text(barLab(dm), xz - mm(ext), yb + mm(5), 2.4, false, 'center');
    text(Lm >= 1000 ? 'กม.' : 'เมตร', xz + mm(Lm * mmPerM) + mm(3), yb + mm(5), 2.4, false, 'left');
    text('มาตราส่วน 1:' + o.scale.toLocaleString('en-US') + '  (แถบยาว ' + (Lm * mmPerM).toFixed(0) + ' มม. = ' + fmtLen(Lm) + ')', fx, yb - mm(1.2), 2.4, true, 'left');

    // แผนภาพทิศ GN/TN/MN
    var ox = fx + fw - mm(36), oy = y0 + mm(14), len = mm(11);
    function ray(angDeg, label, dash) {
      var a = angDeg * Math.PI / 180, ex = ox + len * Math.sin(a), ey = oy - len * Math.cos(a);
      c.save();
      c.strokeStyle = '#000'; c.lineWidth = Math.max(1, mm(0.3));
      if (dash) c.setLineDash([mm(1.2), mm(0.8)]);
      c.beginPath(); c.moveTo(ox, oy); c.lineTo(ex, ey); c.stroke();
      c.restore();
      text(label, ex + (Math.sin(a) >= 0 ? mm(0.8) : -mm(0.8)), ey - mm(0.6), 2.4, true, Math.sin(a) >= 0 ? 'left' : 'right');
    }
    ray(0, 'GN');
    ray(-conv, 'TN', true);
    ray(decl - conv, 'MN');
    var gm = decl - conv;
    text(decl ? 'MN ' + (decl >= 0 ? 'ตะวันออก' : 'ตะวันตก') + ' ' + Math.abs(decl).toFixed(1) + '° จาก TN' : 'ยังไม่ตั้งมุมแม่เหล็ก', ox + mm(4), oy - mm(3.5), 2.2, false, 'left');
    text('GM = ' + gm.toFixed(2) + '° ≈ ' + Math.round(gm * 6400 / 360) + ' มิล', ox + mm(4), oy, 2.2, false, 'left');

    // หมายเหตุ (ย่อให้เหลือเท่าที่จำเป็น)
    var notes = [
      (geo ? 'เส้นละติจูด/ลองจิจูดเอียงเล็กน้อยเทียบกับกรอบ (กรอบหันตามทิศเหนือกริด) · ' : 'ช่องกริด 1 ช่อง = ' + (I * mmPerM).toFixed(1) + ' มม. · ') + 'พิมพ์ที่ 100% (ห้ามเลือก "พอดีหน้า/Fit to page") แล้ววัดแถบสเกลตรวจ',
      'มุมล่างซ้าย ' + G.formatPoint(sw.lat, sw.lng, cf) + ' · มุมบนขวา ' + G.formatPoint(ne.lat, ne.lng, cf)
    ];
    if (o.base === 'topo') notes.push('พื้นหลัง: © OpenTopoMap (CC-BY-SA) · ข้อมูล © ผู้ร่วมจัดทำ OpenStreetMap');
    else if (o.base === 'sat') notes.push('พื้นหลัง: Esri World Imagery');
    else if (o.base === 'paper') notes.push('พื้นหลัง: แผนที่กระดาษที่นำเข้า (ความแม่นยำขึ้นกับการปรับพิกัด)');
    notes.forEach(function (n, i) { text(n, fx, yb + mm(10.5 + i * 3.4), 2.2, false, 'left', '#333'); });

    return { cv: cv, wmm: wmm, hmm: hmm, w: W, h: H, nsym: nsym };
  }

  function renderPlate(o) {
    var pxmm = o.dpi / 25.4, P = PAPERS[o.paper];
    var wmm = o.land ? P[1] : P[0], hmm = o.land ? P[0] : P[1];
    var side = TrailPlate.SIDE * 1000 / o.scale; // มม. บนกระดาษ
    if (side + 24 > Math.min(wmm, hmm)) throw new Error('แผ่นสเกล 1:' + o.scale.toLocaleString('en-US') + ' ใหญ่ ' + Math.round(side) + ' มม. ใหญ่เกินกระดาษนี้ เลือกกระดาษใหญ่ขึ้น');
    var W = Math.round(wmm * pxmm), H = Math.round(hmm * pxmm);
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var c = cv.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
    var sp = Math.round(side * pxmm);
    var plate = TrailPlate.draw(sp);
    var x = Math.round((W - sp) / 2), y = Math.round((H - sp) / 2);
    c.drawImage(plate, x, y);
    c.strokeStyle = '#000'; c.lineWidth = 1;
    c.strokeRect(x, y, sp, sp);
    c.fillStyle = '#000';
    c.font = '700 ' + (pxmm * 4.5).toFixed(1) + 'px ' + FONT; c.textAlign = 'center';
    c.fillText('แผ่นวัดมุมสี่เหลี่ยม 1 : ' + o.scale.toLocaleString('en-US'), W / 2, y - pxmm * 8);
    c.font = '400 ' + (pxmm * 2.8).toFixed(1) + 'px ' + FONT;
    c.fillText('ด้านละ ' + side.toFixed(0) + ' มม. (= ' + (TrailPlate.SIDE / 1000) + ' กม.) · พิมพ์ที่ 100% ลงแผ่นใสหรือกระดาษแล้วตัดตามกรอบ', W / 2, y - pxmm * 3.5);
    return { cv: cv, wmm: wmm, hmm: hmm, w: W, h: H, plate: true };
  }

  /* ---------- ไฟล์ ---------- */
  function toBlob(cv, type, q) { return new Promise(function (res) { cv.toBlob(res, type, q); }); }

  function makePDF(jpeg, wpx, hpx, wmm, hmm) {
    var wp = wmm / 25.4 * 72, hp = hmm / 25.4 * 72;
    var enc = new TextEncoder(), parts = [], offs = [], len = 0;
    function push(b) { if (typeof b === 'string') b = enc.encode(b); parts.push(b); len += b.length; }
    function obj(n, body) { offs[n] = len; push(n + ' 0 obj\n' + body + '\nendobj\n'); }
    push('%PDF-1.4\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + wp.toFixed(2) + ' ' + hp.toFixed(2) + '] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>');
    var cs = 'q ' + wp.toFixed(2) + ' 0 0 ' + hp.toFixed(2) + ' 0 0 cm /Im0 Do Q';
    obj(4, '<< /Length ' + cs.length + ' >>\nstream\n' + cs + '\nendstream');
    offs[5] = len;
    push('5 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + wpx + ' /Height ' + hpx + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>\nstream\n');
    push(jpeg);
    push('\nendstream\nendobj\n');
    var xr = len, x = 'xref\n0 6\n0000000000 65535 f \n';
    for (var n = 1; n <= 5; n++) x += ('0000000000' + offs[n]).slice(-10) + ' 00000 n \n';
    push(x + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xr + '\n%%EOF\n');
    var out = new Uint8Array(len), p = 0;
    parts.forEach(function (b) { out.set(b, p); p += b.length; });
    return out;
  }

  async function fileFor(kind) {
    var base = safeName(last.plate ? 'แผ่นวัดมุม-1-' + (cfg.scale / 1000) + 'k' : cfg.title + '-1-' + (cfg.scale / 1000) + 'k');
    if (kind === 'png') return { name: base + '.png', mime: 'image/png', blob: await toBlob(last.cv, 'image/png') };
    var jb = await toBlob(last.cv, 'image/jpeg', 0.93);
    if (kind === 'jpg') return { name: base + '.jpg', mime: 'image/jpeg', blob: jb };
    var jpeg = new Uint8Array(await jb.arrayBuffer());
    var pdf = makePDF(jpeg, last.w, last.h, last.wmm, last.hmm);
    return { name: base + '.pdf', mime: 'application/pdf', blob: new Blob([pdf], { type: 'application/pdf' }) };
  }

  /* ---------- แผงพิมพ์ ---------- */
  function opts(id, list, cur) {
    return '<select id="' + id + '" style="flex:1;min-width:0;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px;background:#fff">' +
      list.map(function (o) { return '<option value="' + o[0] + '"' + (String(o[0]) === String(cur) ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>';
  }
  function fld(label, inner) { return '<div class="field"><label style="flex:0 0 96px">' + label + '</label>' + inner + '</div>'; }

  function renderSheet(box) {
    var h = fld('ชื่อแผ่น', '<input type="text" id="pTitle" style="flex:1;min-width:0;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px">') +
      fld('กระดาษ', opts('pPaper', Object.keys(PAPERS).map(function (k) { return [k, k + ' (' + PAPERS[k][0] + '×' + PAPERS[k][1] + ' มม.)']; }), cfg.paper)) +
      fld('แนววาง', opts('pLand', [['0', 'แนวตั้ง'], ['1', 'แนวนอน']], cfg.land ? '1' : '0')) +
      fld('มาตราส่วน', opts('pScale', SCALES.map(function (s) { return [s, '1 : ' + s.toLocaleString('en-US')]; }), cfg.scale)) +
      fld('ช่วงกริด', opts('pGrid', [['auto', 'อัตโนมัติตามสเกล'], [100, '100 ม.'], [500, '500 ม.'], [1000, '1 กม.'], [2000, '2 กม.'], [5000, '5 กม.'], [10000, '10 กม.']], cfg.grid)) +
      fld('แบบเส้นกริด', opts('pStyle', [['lines', 'เส้นเต็ม'], ['cross', 'กากบาทที่จุดตัด']], cfg.style)) +
      fld('รูปแบบพิกัด', '<select id="pFmt" style="flex:1;min-width:0;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px;background:#fff">' +
        G.FORMATS.map(function (f) { return '<option value="' + f + '"' + (f === cfg.cfmt ? ' selected' : '') + '>' + G.FORMAT_NAMES[f] + '</option>'; }).join('') + '</select>') +
      fld('ศูนย์กลางแผ่น', '<input type="text" id="pCenter" style="flex:1;min-width:0;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px"><button type="button" class="btn alt" id="pCur" style="flex:none;padding:8px 10px">กลางจอ</button>') +
      fld('พื้นหลัง', opts('pBase', [['none', 'กริดเปล่า (สำหรับฝึกลงพิกัด)'], ['topo', 'ภูมิประเทศ (เส้นชั้นความสูง)'], ['sat', 'ภาพถ่ายดาวเทียม'], ['paper', 'แผนที่กระดาษ (ที่นำเข้า)']], cfg.base)) +
      fld('ความเข้มภาพ', '<input type="range" id="pFade" min="20" max="100" step="5" style="flex:1"><span id="pFadeV" style="flex:0 0 40px;text-align:right"></span>') +
      '<label class="opt"><input type="checkbox" id="pSym"><span>วางสัญลักษณ์ทหารและหมุดที่ปักไว้<small>เฉพาะงานที่ติ๊กแสดงอยู่</small></span></label>' +
      '<label class="opt"><input type="checkbox" id="pRoutes"><span>วาดเส้นทางที่แสดงอยู่</span></label>' +
      fld('ความละเอียด', opts('pDpi', [[100, '100 dpi (เร็ว ไฟล์เล็ก)'], [150, '150 dpi (แนะนำ)'], [200, '200 dpi (คมที่สุด)']], cfg.dpi)) +
      '<div class="btnrow"><button class="btn" id="pBuild">สร้างแผนที่ฝึก</button><button class="btn alt" id="pPlate">แผ่นวัดมุมขนาดจริง</button></div>' +
      '<div id="pStat" class="note"></div><div id="pOut"></div>' +
      '<p class="note">พื้นหลังภูมิประเทศ/ดาวเทียมต้องออนไลน์ หรือดาวน์โหลดพื้นที่นั้นไว้แล้ว ส่วนแผนที่กระดาษใช้ออฟไลน์ได้ (ต้องนำเข้าและปรับพิกัดไว้ที่ ★ พิเศษ ก่อน และศูนย์กลางแผ่นต้องอยู่ในพื้นที่ของแผนที่กระดาษ) ภาพถูกดัดให้ตรงกับกริด UTM จึงถูกต้องตามสเกล ' +
      'รูปแบบพิกัด: MGRS/UTM ใช้เส้นกริด UTM (ตัวเลขเป็น กม. ปรับช่วงกริดได้) ส่วนองศา ลิปดา ฟิลิปดา / องศา ลิปดาทศนิยม / องศาทศนิยม จะพิมพ์เป็นเส้นละติจูด-ลองจิจูด ช่วงเส้นเลือกให้อัตโนมัติตามสเกล ' +
      'ถ้าพื้นที่ในแผนที่ลับ/หวงห้าม อย่าส่งไฟล์ออกนอกหน่วยงาน · พิมพ์ที่ขนาด 100% เสมอ</p>';
    box.innerHTML = h;
    $('pTitle').value = cfg.title;
    $('pCenter').value = cfg.center;
    G.bindCoord($('pCenter'), $('pFmt'), $('pCur'), function () { return ctx.map().getCenter(); }, function (f) { cfg.cfmt = f; saveCfg(); });
    $('pFade').value = cfg.fade; $('pFadeV').textContent = cfg.fade + '%';
    $('pSym').checked = cfg.sym; $('pRoutes').checked = cfg.routes;
    $('pFade').oninput = function () { $('pFadeV').textContent = this.value + '%'; };
    function readCfg() {
      cfg.title = $('pTitle').value.trim() || 'แบบฝึกอ่านพิกัดกริด';
      cfg.paper = $('pPaper').value; cfg.land = $('pLand').value === '1';
      cfg.scale = parseInt($('pScale').value, 10); cfg.grid = $('pGrid').value; cfg.style = $('pStyle').value;
      cfg.center = $('pCenter').value.trim(); cfg.base = $('pBase').value; cfg.fade = parseInt($('pFade').value, 10);
      cfg.sym = $('pSym').checked; cfg.routes = $('pRoutes').checked; cfg.dpi = parseInt($('pDpi').value, 10);
      saveCfg();
    }
    function run(kind) {
      if (busy) return;
      readCfg();
      busy = true;
      $('pBuild').disabled = true; $('pPlate').disabled = true;
      $('pOut').innerHTML = '';
      var stat = $('pStat');
      stat.textContent = 'กำลังสร้าง…';
      var onStatus = function (t) { if ($('pStat')) $('pStat').textContent = t; };
      var job = kind === 'plate' ? Promise.resolve().then(function () { return renderPlate(cfg); }) : render(cfg, onStatus);
      job.then(function (res) {
        last = res;
        busy = false;
        if (!$('pOut')) return;
        $('pBuild').disabled = false; $('pPlate').disabled = false;
        $('pStat').textContent = (res.plate ? 'แผ่นวัดมุม ' : 'แผนที่ ') + cfg.paper + ' · ' + res.w + '×' + res.h + ' px · ' + cfg.dpi + ' dpi' + (res.nsym ? ' · สัญลักษณ์ ' + res.nsym + ' รายการ' : '');
        var pv = document.createElement('canvas');
        pv.width = 720; pv.height = Math.round(720 * res.h / res.w);
        pv.getContext('2d').drawImage(res.cv, 0, 0, pv.width, pv.height);
        var img = document.createElement('img');
        img.src = pv.toDataURL('image/jpeg', 0.85);
        img.style.cssText = 'width:100%;border:1px solid #ccc;margin-top:8px';
        $('pOut').appendChild(img);
        var row = document.createElement('div');
        row.className = 'btnrow';
        [['pdf', 'PDF'], ['png', 'PNG'], ['jpg', 'JPEG']].forEach(function (f) {
          var b = document.createElement('button');
          b.className = f[0] === 'pdf' ? 'btn' : 'btn alt';
          b.textContent = f[1];
          b.onclick = function () {
            b.disabled = true;
            fileFor(f[0]).then(function (file) {
              b.disabled = false;
              TrailExport.share(file).then(function (ok) { if (!ok) { TrailExport.download(file); ctx.toast('ดาวน์โหลดแล้ว: ' + file.name + ' (ดูในแอพไฟล์)'); } });
            }).catch(function () { b.disabled = false; ctx.toast('สร้างไฟล์ไม่สำเร็จ'); });
          };
          row.appendChild(b);
        });
        $('pOut').appendChild(row);
        var hint = document.createElement('p');
        hint.className = 'note';
        hint.textContent = 'กดชนิดไฟล์เพื่อแชร์/บันทึก (เลือก "พิมพ์" ในแผ่นแชร์ของ iPhone ได้ทันที) · ตั้งค่าพิมพ์เป็นขนาดจริง 100% ไม่ย่อให้พอดีหน้า';
        $('pOut').appendChild(hint);
      }).catch(function (e) {
        busy = false;
        if ($('pStat')) { $('pBuild').disabled = false; $('pPlate').disabled = false; $('pStat').textContent = 'ไม่สำเร็จ: ' + (e && e.message ? e.message : e); }
      });
    }
    $('pBuild').onclick = function () { run('map'); };
    $('pPlate').onclick = function () { run('plate'); };
  }

  root.TrailPrint = { init: init, renderSheet: renderSheet };
})(typeof self !== 'undefined' ? self : this);
