// สร้างแผนที่ฝึกสำหรับพิมพ์: กริด UTM ตามมาตราส่วนจริง + สเกล + ทิศเหนือ + สัญลักษณ์ทหาร ส่งออก PDF/PNG/JPEG
(function (root) {
  var G = TrailGeo;
  var C = TrailCommon;
  var KEY = 'trail_print_v1';
  var PAPERS = { A6: [105, 148], A5: [148, 210], A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189], B5: [176, 250], B4: [250, 353], Letter: [216, 279] };
  var SCALES = [1000, 2500, 5000, 10000, 11250, 12500, 25000, 50000, 100000, 250000];
  var FONT = '"Sarabun","Noto Sans Thai",-apple-system,sans-serif';
  var BARS = [[100, 25], [200, 50], [500, 100], [1000, 250], [2000, 500], [2500, 500], [4000, 1000], [5000, 1000], [8000, 2000], [10000, 2000], [20000, 5000], [25000, 5000], [40000, 10000], [50000, 10000]];

  var cfg = { title: 'แบบฝึกอ่านพิกัดกริด', paper: 'A4', land: false, scale: 50000, grid: 'auto', style: 'lines', center: '', cfmt: 'mgrs', base: 'none', fade: 55, sym: true, routes: true, dpi: 150, cw: 210, ch: 297, scaleCustom: 0, foot: {}, syn: null, color: 'color' };
  var ctx = null;
  var last = null;
  var busy = false;

  function $(id) { return document.getElementById(id); }
  function init(c) {
    ctx = c;
    try { var s = JSON.parse(localStorage.getItem(KEY) || '{}'); for (var k in cfg) if (s[k] !== undefined) cfg[k] = s[k]; } catch (e) { /* ค่าเริ่มต้น */ }
  }
  function saveCfg() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* ไม่เป็นไร */ } }
  function autoGrid(scale) { return scale <= 1000 ? 20 : scale <= 2500 ? 50 : scale <= 10000 ? 100 : scale <= 12500 ? 250 : scale <= 100000 ? 1000 : 10000; }
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

  /* ---------- พื้นหลังแผนที่เดินป่า: วาดแผนที่ของแอพเองบนแผนที่ชั่วคราว (เส้นชั้น เงาเขา ยอดเขา X คุ้งกระทะ) แล้วดัดเข้ากริด UTM ---------- */
  function waitIdle(m, ms) { return new Promise(function (res) { var done = false; function fin() { if (!done) { done = true; res(); } } m.once('idle', fin); setTimeout(fin, ms); }); }
  async function drawTrail(c, o, g, onStatus) {
    var tpl = ctx.vectorTpl && ctx.vectorTpl();
    if (!root.maplibregl || !tpl) throw new Error('แผนที่เดินป่ายังไม่พร้อม (เปิดแผนที่ให้โหลดเสร็จก่อน ต้องออนไลน์หรือดาวน์โหลดพื้นที่ไว้)');
    var S = 16, nx = Math.ceil(g.fw / S) + 1, ny = Math.ceil(g.fh / S) + 1, MX = new Float64Array(nx * ny), MY = new Float64Array(nx * ny);
    var mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9, w0 = 1e9, e0 = -1e9, s0 = 1e9, n0 = -1e9, i, j;
    for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
      var ll = G.fromUTM(g.zone, g.north, g.E0 + (i * S - g.fw / 2) * g.mpp, g.N0 - (j * S - g.fh / 2) * g.mpp), m = mercXY(ll), k = j * nx + i;
      MX[k] = m[0]; MY[k] = m[1];
      mnx = Math.min(mnx, m[0]); mxx = Math.max(mxx, m[0]); mny = Math.min(mny, m[1]); mxy = Math.max(mxy, m[1]);
      w0 = Math.min(w0, ll.lng); e0 = Math.max(e0, ll.lng); s0 = Math.min(s0, ll.lat); n0 = Math.max(n0, ll.lat);
    }
    // ขนาดตัวหนังสือบนแผนที่คงที่ราว 2 มม. ไม่ว่าจะพิมพ์กี่ dpi (pixelRatio = dpi/150)
    var lat0 = (s0 + n0) / 2, pr = Math.max(1, o.dpi / 150), zf = Math.log(78271.517 * Math.cos(lat0 * Math.PI / 180) / (g.mpp * pr)) / Math.LN2;
    zf = Math.max(8, Math.min(17, zf));
    var world = 512 * Math.pow(2, zf), regW = Math.ceil((mxx - mnx) * world) + 4, regH = Math.ceil((mxy - mny) * world) + 4;
    var mos = document.createElement('canvas'); mos.width = Math.ceil(regW * pr); mos.height = Math.ceil(regH * pr);
    var mc = mos.getContext('2d'); mc.fillStyle = '#f1efe6'; mc.fillRect(0, 0, mos.width, mos.height);
    var MG = 140, CH = Math.floor(3800 / pr) - 2 * MG; CH -= CH % 2; // ช่องใหญ่สุดที่ WebGL บนมือถือรับได้ (≤ 4096 px) ส่วนใหญ่จึงวาดครั้งเดียว ไม่มีรอยต่อ // ทีละช่อง (กันหน่วยความจำ WebGL) เผื่อขอบไว้ให้ป้ายชื่อวางได้ไม่ขาด
    var div = document.createElement('div');
    div.style.cssText = 'position:fixed;left:0;top:0;width:' + (Math.min(CH, regW + (regW % 2)) + 2 * MG) + 'px;height:' + (Math.min(CH, regH + (regH % 2)) + 2 * MG) + 'px;opacity:0;pointer-events:none;z-index:-1';
    document.body.appendChild(div);
    function unproj(mx, my) { return [mx * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180 / Math.PI]; }
    var pm = null;
    try {
      onStatus('เตรียมแผนที่เดินป่า…');
      pm = new root.maplibregl.Map({ container: div, style: C.buildStyle(tpl), interactive: false, attributionControl: false, preserveDrawingBuffer: true, pixelRatio: pr, fadeDuration: 0, center: unproj((mnx + mxx) / 2, (mny + mxy) / 2), zoom: zf, maxZoom: 22 });
      await new Promise(function (res, rej) { pm.once('load', res); pm.once('error', function () {}); setTimeout(function () { rej(new Error('โหลดแผนที่เดินป่าไม่สำเร็จ')); }, 40000); });
      // เงาเขาอ่อนลงสำหรับกระดาษ ให้เส้นชั้นความสูงเด่นกว่า
      if (pm.getLayer('hillshade')) { pm.setPaintProperty('hillshade', 'hillshade-exaggeration', 0.35); pm.setPaintProperty('hillshade', 'hillshade-shadow-color', '#6e6656'); pm.setPaintProperty('hillshade', 'hillshade-accent-color', '#8a8270'); }
      if (window.TrailContour && TrailContour.addTo) TrailContour.addTo(pm);
      if (window.TrailSpots && TrailSpots.computeFor) {
        onStatus('คำนวณยอดเขาและที่ต่ำ…');
        var sp = await TrailSpots.computeFor([w0, s0, e0, n0], zf).catch(function () { return null; });
        if (sp) TrailSpots.addTo(pm, sp, true);
      }
      var nCx = Math.ceil(regW / CH), nCy = Math.ceil(regH / CH), cnt = 0;
      for (var cy = 0; cy < nCy; cy++) for (var cx = 0; cx < nCx; cx++) {
        cnt++; onStatus('วาดแผนที่เดินป่า ' + cnt + '/' + (nCx * nCy) + '…');
        var cw = Math.min(CH, regW + (regW % 2)), chh = Math.min(CH, regH + (regH % 2)), x0 = cx * CH, y0 = cy * CH;
        // ศูนย์กลางของช่องนี้ (รวมขอบ)
        pm.jumpTo({ center: unproj(mnx + (x0 + cw / 2) / world, mny + (y0 + chh / 2) / world), zoom: zf });
        await waitIdle(pm, 45000);
        mc.drawImage(pm.getCanvas(), MG * pr, MG * pr, cw * pr, chh * pr, x0 * pr, y0 * pr, cw * pr, chh * pr);
      }
    } finally {
      if (pm) pm.remove();
      div.remove();
    }
    onStatus('ปรับภาพให้ตรงกริด…');
    await new Promise(function (r) { setTimeout(r, 20); });
    var md = mc.getImageData(0, 0, mos.width, mos.height).data, mw = mos.width, mh = mos.height;
    var out = c.createImageData(g.fw, g.fh), od = out.data, fade = o.fade / 100, sc = world * pr;
    for (var py = 0; py < g.fh; py++) {
      var jj = Math.floor(py / S), fyy = (py - jj * S) / S;
      for (var px = 0; px < g.fw; px++) {
        var ii = Math.floor(px / S), fxx = (px - ii * S) / S, a = jj * nx + ii, b = a + 1, d = a + nx, e = d + 1;
        var wx = (MX[a] * (1 - fxx) + MX[b] * fxx) * (1 - fyy) + (MX[d] * (1 - fxx) + MX[e] * fxx) * fyy;
        var wy = (MY[a] * (1 - fxx) + MY[b] * fxx) * (1 - fyy) + (MY[d] * (1 - fxx) + MY[e] * fxx) * fyy;
        var sx = Math.floor((wx - mnx) * sc), sy = Math.floor((wy - mny) * sc), o4 = (py * g.fw + px) * 4, r0 = 255, g0 = 255, b0 = 255;
        if (sx >= 0 && sy >= 0 && sx < mw && sy < mh) { var m4 = (sy * mw + sx) * 4; r0 = md[m4]; g0 = md[m4 + 1]; b0 = md[m4 + 2]; }
        od[o4] = 255 + (r0 - 255) * fade; od[o4 + 1] = 255 + (g0 - 255) * fade; od[o4 + 2] = 255 + (b0 - 255) * fade; od[o4 + 3] = 255;
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
    var km = v / 1000, dec = I < 100 ? 2 : I < 1000 ? (I % 100 === 0 ? 1 : 2) : 0;
    var s = Math.abs(km).toFixed(dec);
    if (first) return s;
    var parts = s.split('.'), ip = parseInt(parts[0], 10) % 100;
    return (ip < 10 ? '0' : '') + ip + (dec ? '.' + parts[1] : '');
  }

  /* ---------- ขนาดกระดาษและความละเอียด ---------- */
  function cl01(v, a, b) { return v < a ? a : v > b ? b : v; }
  // คืน [กว้าง, สูง] เป็นมม. ตามแนววาง (รองรับกระดาษกำหนดเอง)
  function paperMM(o) {
    var P = o.paper === 'custom' ? [cl01(+o.cw || 210, 60, 1500), cl01(+o.ch || 297, 60, 2000)] : (PAPERS[o.paper] || PAPERS.A4);
    return o.land ? [P[1], P[0]] : [P[0], P[1]];
  }
  var MAX_PIXELS = 16000000; // เบราว์เซอร์มือถือสร้างภาพใหญ่กว่านี้ไม่ได้ จึงลดความละเอียดอัตโนมัติเมื่อกระดาษใหญ่
  function effDpi(o, wmm, hmm) { return Math.min(o.dpi, Math.sqrt(MAX_PIXELS / (wmm * hmm)) * 25.4); }
  var COMBINING = /[ัิ-ฺ็-๎]/;

  async function render(o, onStatus) {
    var dimsMM = paperMM(o), wmm = dimsMM[0], hmm = dimsMM[1];
    var dpiEff = effDpi(o, wmm, hmm);
    o = Object.assign({}, o, { dpi: dpiEff });
    var pxmm = o.dpi / 25.4;
    var W = Math.round(wmm * pxmm), H = Math.round(hmm * pxmm);
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var c = cv.getContext('2d');
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H);
    function mm(v) { return v * pxmm; }
    var syn = o.base === 'syn', world = null;
    if (syn && !(root.TrailSynMap && root.TrailSynDraw)) throw new Error('โมดูลแผนที่สมมุติโหลดไม่สำเร็จ');
    var fo = Object.assign({ bar: true, north: true, grid: true, corners: true, credit: true, interval: true, legend: true, key: true, student: false, questions: '', answerLines: false }, o.foot || {});

    // ขอบ: M = ระยะขอบกระดาษ, L = ที่ว่างสำหรับตัวเลขกริดนอกกรอบ, HD = หัวกระดาษ
    var M = 6, L = 6, HD = 9, contentWmm = wmm - 2 * (M + L);
    function wrap(str, sizeMM, maxWmm, bold) { // ตัดบรรทัดตามความกว้าง (ภาษาไทยไม่มีช่องว่าง ตัดตามตัวอักษร ไม่ทิ้งสระ/วรรณยุกต์ไว้ต้นบรรทัด)
      c.font = (bold ? '700 ' : '400 ') + mm(sizeMM).toFixed(1) + 'px ' + FONT;
      var maxPx = mm(maxWmm), clusters = [];
      Array.from(String(str)).forEach(function (ch) { if (clusters.length && COMBINING.test(ch)) clusters[clusters.length - 1] += ch; else clusters.push(ch); });
      var out = [], cur = '';
      clusters.forEach(function (cl) { var t = cur + cl; if (cur && c.measureText(t).width > maxPx) { out.push(cur); cur = cl; } else cur = t; });
      if (cur) out.push(cur);
      return out;
    }
    // รายการส่วนท้ายที่เลือก: คำนวณความสูงก่อน เพื่อให้เหลือพื้นที่แผนที่ที่เหลือ
    var rows = [];
    var credit = !!fo.credit && (syn || o.base === 'topo' || o.base === 'sat' || o.base === 'paper' || o.base === 'trail');
    var nNotes = (fo.grid ? 1 : 0) + (fo.corners ? 1 : 0) + (syn && fo.interval ? 1 : 0) + (credit ? 1 : 0);
    if (fo.bar || fo.north) rows.push({ h: 15, draw: function (y) { drawBarNorth(y); } });
    if (nNotes) rows.push({ h: nNotes * 3.4 + 1.2, draw: function (y) { drawNotes(y); } });
    var legendCols = Math.max(1, Math.floor(contentWmm / 52)), legendCount = syn && fo.legend ? TrailSynDraw.legend(o, null).length : 0;
    if (legendCount) rows.push({ h: 7 + Math.ceil(legendCount / legendCols) * 5.4, draw: function (y) { drawLegend(y); } });
    var qs = String(fo.questions || '').split('\n').map(function (t) { return t.trim().replace(/^[0-9๐-๙]+\s*[.)\-:]\s*/, ''); }).filter(Boolean), qLines = [], qH = 0; // ตัดเลขข้อที่ผู้ใช้พิมพ์มาเอง แอพใส่เลขข้อให้
    qs.forEach(function (q, i) { var ls = wrap((i + 1) + '. ' + q, 3, contentWmm - 2); qLines.push(ls); qH += ls.length * 4.3 + (fo.answerLines ? 8.5 : 1.8); });
    if (qs.length) rows.push({ h: qH + 6, draw: function (y) { drawQuestions(y); } });
    if (fo.student) rows.push({ h: 11, draw: function (y) { drawStudent(y); } });
    var footH = rows.reduce(function (a, r) { return a + r.h; }, 0);

    var fx = Math.round(mm(M + L)), fy = Math.round(mm(M + HD + L));
    var fw = Math.round(W - 2 * mm(M + L)), fh = Math.round(H - mm(M + HD + L) - mm(L + 4 + footH + M));
    if (fw < 100 || fh < 100) throw new Error('กระดาษเล็กเกินไปสำหรับรายละเอียดด้านล่างที่เลือก ลดตัวเลือกด้านล่างหรือเลือกกระดาษใหญ่ขึ้น');
    var mpp = (o.scale / 1000) / pxmm; // เมตรต่อพิกเซล
    var cl = o.center ? G.parsePoint(o.center) : null;
    if (o.center && !cl) throw new Error('อ่านพิกัดศูนย์กลางไม่ได้ ตรวจรูปแบบ: ' + G.FORMAT_HINT[o.cfmt]);
    if (!cl && syn) { var sd0 = (o.syn && o.syn.seed) | 0; cl = { lat: 12 + (Math.abs(sd0) % 9) * 0.9, lng: 99 + (Math.abs(sd0 * 7) % 5) * 0.8 }; } // ตำแหน่งสมมุติตามเลขเมล็ดพันธุ์
    if (!cl) { var mc0 = ctx.map().getCenter(); cl = { lat: mc0.lat, lng: mc0.lng }; }
    var cf = G.FORMATS.indexOf(o.cfmt) >= 0 ? o.cfmt : 'mgrs'; // รูปแบบพิกัดที่พิมพ์บนแผ่น (ตามช่อง "รูปแบบพิกัด")
    if (cl.lat <= -80 || cl.lat >= 84) throw new Error('พิกัดอยู่นอกช่วง UTM');
    var u0 = G.toUTM(cl.lat, cl.lng);
    if (syn && !o.center) { u0 = { e: Math.round(u0.e / 1000) * 1000, n: Math.round(u0.n / 1000) * 1000, zone: u0.zone, north: u0.north }; var snap = G.fromUTM(u0.zone, u0.north, u0.e, u0.n); cl = { lat: snap.lat, lng: snap.lng }; }
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

    if (syn) {
      var sy = o.syn || {};
      world = TrailSynMap.generate({ seed: sy.seed, preset: sy.preset, reliefMul: sy.reliefMul, baseElev: sy.baseElev, interval: sy.interval, cliffs: !(sy.layers && sy.layers.cliff === false) }, { wmm: fw / pxmm, hmm: fh / pxmm, scale: o.scale }, onStatus);
      await new Promise(function (r) { setTimeout(r, 15); });
      TrailSynMap.populate(world, { seed: sy.seed, preset: sy.preset }, onStatus);
      await new Promise(function (r) { setTimeout(r, 15); });
      onStatus('วาดแผนที่สมมุติ…');
      TrailSynDraw.draw(c, o, g, world, onStatus);
    } else if (o.base === 'paper') await drawPaper(c, o, g, onStatus);
    else if (o.base === 'trail') await drawTrail(c, o, g, onStatus);
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
    c.strokeStyle = syn ? 'rgba(25,40,80,0.85)' : 'rgba(20,20,20,0.9)';
    c.lineWidth = Math.max(1, mm(syn ? 0.13 : (o.style === 'lines' ? 0.25 : 0.2)));
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
    // เลขกริดตัวใหญ่ในแผนที่ (แบบแผนที่ทหาร) เฉพาะแผนที่สมมุติที่กริดห่าง 1 กม. ขึ้นไป
    if (syn && !geo && I >= 1000 && o.style === 'lines') {
      c.save(); c.font = '700 ' + mm(4.2).toFixed(1) + 'px ' + (TrailSynDraw.FONT || 'sans-serif'); c.fillStyle = 'rgba(15,15,25,.82)'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineWidth = mm(0.8); c.strokeStyle = 'rgba(226,237,232,.8)'; c.lineJoin = 'round';
      function two(v) { var n = Math.round(v / 1000) % 100; return (n < 10 ? '0' : '') + n; }
      // วางเลขไว้กลางช่องระหว่างเส้นกริดอีกแนว (ไม่ให้เลขแนวตั้งกับแนวนอนชนกันที่จุดตัด)
      var rowsY = [], colsX = [], nRow = Math.max(1, Math.round(fh / mm(160))), nCol = Math.max(1, Math.round(fw / mm(160)));
      function midNear(target, vals) { var b = null, bd = 1e9; for (var t = 0; t + 1 < vals.length; t++) { var m = (vals[t] + vals[t + 1]) / 2, d = Math.abs(m - target); if (d < bd) { bd = d; b = m; } } return b; }
      var ys = [], xs = []; for (kk = kN0; kk <= kN1; kk++) ys.push(yOf(kk * I)); for (k = kE0; k <= kE1; k++) xs.push(xOf(k * I));
      ys.sort(function (a, b) { return a - b; }); xs.sort(function (a, b) { return a - b; });
      for (var r1 = 0; r1 < nRow; r1++) { var my = midNear(fy + fh * (r1 + 0.5) / nRow, ys); if (my !== null) rowsY.push(my); }
      for (var r2 = 0; r2 < nCol; r2++) { var mx = midNear(fx + fw * (r2 + 0.5) / nCol, xs); if (mx !== null) colsX.push(mx); }
      for (k = kE0; k <= kE1; k++) { var xl = xOf(k * I); if (xl > fx + mm(8) && xl < fx + fw - mm(8)) rowsY.forEach(function (yy) { c.fillText(two(k * I), xl, yy); }); }
      for (kk = kN0; kk <= kN1; kk++) { var yl = yOf(kk * I); if (yl > fy + mm(8) && yl < fy + fh - mm(8)) colsX.forEach(function (xx) { c.fillText(two(kk * I), xx, yl); }); }
      c.restore();
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
    if (!syn && o.routes && ctx.visibleRoutes) {
      c.strokeStyle = '#7b2cbf'; c.lineWidth = mm(0.7); c.lineJoin = 'round';
      ctx.visibleRoutes().forEach(function (r) {
        c.beginPath();
        r.pts.forEach(function (p, i) { var q = P2(p[1], p[0]); if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); });
        c.stroke();
      });
    }
    // สัญลักษณ์ทหาร
    var nsym = 0;
    if (!syn && o.sym && root.TrailSym) {
      TrailSym.list().forEach(function (s) {
        var q = P2(s.lat, s.lng);
        if (q[0] < fx - mm(6) || q[0] > fx + fw + mm(6) || q[1] < fy - mm(6) || q[1] > fy + fh + mm(6)) return;
        TrailSym.draw(c, s.type, s.side, q[0], q[1], mm(9), s.label);
        nsym++;
      });
    }
    // หมุดที่ตั้งชื่อไว้
    if (!syn && o.sym && root.TrailProj) {
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
    text((syn ? 'แผนที่สมมุติเพื่อการสอน · ' : '') + 'UTM ' + g.zone + G.bandOf(cl.lat) + ' · WGS84 · ศูนย์กลาง ' + G.formatPoint(cl.lat, cl.lng, cf) + ' · ' + (geo ? 'เส้นพิกัดทุก ' + stepName(gs.step) : 'กริดทุก ' + fmtLen(I)) +
      (syn && world ? ' · เส้นชั้นความสูงทุก ' + world.interval + ' ม.' : ''),
      mm(M), mm(M + 9), 2.7, false, 'left', '#333');

    var mmPerM = 1000 / o.scale;
    function drawBarNorth(y0) {
      var contentW = fw / pxmm, yb = y0 + mm(4), s2, sx0;
      if (fo.bar) {
        var maxMM = Math.min(90, contentW * (fo.north ? 0.5 : 0.8)), bar = BARS[0];
        BARS.forEach(function (b) { if (b[0] * 1000 / o.scale <= maxMM) bar = b; });
        var Lm = bar[0], dm = bar[1], ext = dm * mmPerM, xz = fx + mm(ext + 4), segs = Math.round(Lm / dm);
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
        var barLab = function (m) { return (m >= 1000 ? String(+(m / 1000).toFixed(2)) : String(m)); };
        for (s2 = 0; s2 <= segs; s2++) text(barLab(s2 * dm), xz + mm(s2 * dm * mmPerM), yb + mm(5), 2.4, false, 'center');
        text(barLab(dm), xz - mm(ext), yb + mm(5), 2.4, false, 'center');
        text(Lm >= 1000 ? 'กม.' : 'เมตร', xz + mm(Lm * mmPerM) + mm(3), yb + mm(5), 2.4, false, 'left');
        text('มาตราส่วน 1:' + o.scale.toLocaleString('en-US') + '  (แถบยาว ' + (Lm * mmPerM).toFixed(0) + ' มม. = ' + fmtLen(Lm) + ')', fx, yb - mm(1.2), 2.4, true, 'left');
      }
      if (fo.north) {
        var ox = fx + fw - mm(36), oy = y0 + mm(14), len = mm(11);
        var ray = function (angDeg, label, dash) {
          var a = angDeg * Math.PI / 180, ex = ox + len * Math.sin(a), ey = oy - len * Math.cos(a);
          c.save();
          c.strokeStyle = '#000'; c.lineWidth = Math.max(1, mm(0.3));
          if (dash) c.setLineDash([mm(1.2), mm(0.8)]);
          c.beginPath(); c.moveTo(ox, oy); c.lineTo(ex, ey); c.stroke();
          c.restore();
          text(label, ex + (Math.sin(a) >= 0 ? mm(0.8) : -mm(0.8)), ey - mm(0.6), 2.4, true, Math.sin(a) >= 0 ? 'left' : 'right');
        };
        ray(0, 'GN'); ray(-conv, 'TN', true); ray(decl - conv, 'MN');
        var gm = decl - conv;
        text(decl ? 'MN ' + (decl >= 0 ? 'ตะวันออก' : 'ตะวันตก') + ' ' + Math.abs(decl).toFixed(1) + '° จาก TN' : 'ยังไม่ตั้งมุมแม่เหล็ก', ox + mm(4), oy - mm(3.5), 2.2, false, 'left');
        text('GM = ' + gm.toFixed(2) + '° ≈ ' + Math.round(gm * 6400 / 360) + ' มิล', ox + mm(4), oy, 2.2, false, 'left');
      }
    }
    function drawNotes(y0) {
      var notes = [];
      if (fo.grid) notes.push((geo ? 'เส้นละติจูด/ลองจิจูดเอียงเล็กน้อยเทียบกับกรอบ (กรอบหันตามทิศเหนือกริด) · ' : 'ช่องกริด 1 ช่อง = ' + (I * mmPerM).toFixed(1) + ' มม. · ') + 'พิมพ์ที่ 100% (ห้ามเลือก "พอดีหน้า/Fit to page") แล้ววัดแถบสเกลตรวจ');
      if (fo.corners) notes.push('มุมล่างซ้าย ' + G.formatPoint(sw.lat, sw.lng, cf) + ' · มุมบนขวา ' + G.formatPoint(ne.lat, ne.lng, cf));
      if (syn && fo.interval && world) notes.push('ระยะต่างเส้นชั้นความสูง ' + world.interval + ' ม. (เส้นหลักทุก ' + world.index + ' ม.) · ความสูงอ้างอิงจากระดับน้ำทะเลปานกลางสมมุติ');
      if (credit) {
        if (syn) notes.push('แผนที่สมมุติสร้างเพื่อการสอน ชื่อและสถานที่ทั้งหมดเป็นข้อมูลสมมุติ ไม่ใช่สถานที่จริง · รหัสแผนที่ ' + ((o.syn && o.syn.seed) | 0) + ' (' + (TrailSynMap._internal.PRESETS[o.syn.preset] || {}).name + ')');
        else if (o.base === 'topo') notes.push('พื้นหลัง: © OpenTopoMap (CC-BY-SA) · ข้อมูล © ผู้ร่วมจัดทำ OpenStreetMap');
        else if (o.base === 'sat') notes.push('พื้นหลัง: Esri World Imagery');
        else if (o.base === 'trail') notes.push('พื้นหลัง: แผนที่เดินป่า ข้อมูล © OpenStreetMap (OpenFreeMap) · เส้นชั้น ยอดเขา (X) และที่ต่ำ คำนวณจากข้อมูลความสูง SRTM ละเอียดราว 30 ม. เป็นค่าประมาณ');
        else if (o.base === 'paper') notes.push('พื้นหลัง: แผนที่กระดาษที่นำเข้า (ความแม่นยำขึ้นกับการปรับพิกัด)');
      }
      notes.forEach(function (n, i) { text(n, fx, y0 + mm(2.6 + i * 3.4), 2.2, false, 'left', '#333'); });
    }
    function drawLegend(y0) {
      var entries = TrailSynDraw.legend(o, world), colW = contentWmm / legendCols;
      text('คำอธิบายสัญลักษณ์', fx, y0 + mm(3), 2.9, true, 'left');
      c.save();
      entries.forEach(function (en, k) {
        var col = k % legendCols, row = Math.floor(k / legendCols), x = fx + mm(col * colW), y = y0 + mm(7 + row * 5.4);
        en.draw(c, x + mm(3.2), y - mm(0.2), mm(3.4));
        c.font = '400 ' + mm(2.3).toFixed(1) + 'px ' + FONT; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = '#111';
        var lab = en.label, maxW = mm(colW - 8.5);
        while (lab.length > 2 && c.measureText(lab).width > maxW) lab = lab.slice(0, -1);
        c.fillText(lab === en.label ? lab : lab + '…', x + mm(7.2), y - mm(0.2));
      });
      c.restore();
    }
    function drawQuestions(y0) {
      text('โจทย์/คำถาม', fx, y0 + mm(3), 2.9, true, 'left');
      var y = y0 + mm(7.4);
      qLines.forEach(function (ls) {
        ls.forEach(function (ln, k) { text(ln, fx + (k ? mm(4) : 0), y, 3, false, 'left'); y += mm(4.3); });
        if (fo.answerLines) { c.strokeStyle = '#999'; c.lineWidth = Math.max(1, mm(0.15)); c.setLineDash([mm(0.6), mm(0.8)]); c.beginPath(); c.moveTo(fx + mm(4), y + mm(3.2)); c.lineTo(fx + fw, y + mm(3.2)); c.stroke(); c.setLineDash([]); y += mm(8.5); } else y += mm(1.8);
      });
    }
    function drawStudent(y0) {
      var parts = [['ชื่อ-สกุล', 0.42], ['ชั้น', 0.14], ['เลขที่', 0.12], ['วันที่', 0.14], ['คะแนน', 0.18]], x = fx, y = y0 + mm(7.5);
      c.strokeStyle = '#000'; c.lineWidth = Math.max(1, mm(0.25)); c.strokeRect(fx, y0 + mm(1.5), fw, mm(8));
      parts.forEach(function (pt) {
        var w = fw * pt[1];
        text(pt[0], x + mm(1.5), y, 2.7, true, 'left');
        c.font = '700 ' + mm(2.7).toFixed(1) + 'px ' + FONT;
        var tw = c.measureText(pt[0]).width;
        c.setLineDash([mm(0.5), mm(0.7)]); c.lineWidth = Math.max(1, mm(0.15)); c.beginPath(); c.moveTo(x + mm(2.5) + tw, y); c.lineTo(x + w - mm(1.5), y); c.stroke(); c.setLineDash([]);
        x += w;
      });
    }
    // วาดส่วนท้ายตามรายการที่เลือก
    var yCur = fy + fh + mm(L + 4);
    rows.forEach(function (r) { r.draw(yCur); yCur += mm(r.h); });

    // หน้าเฉลย (แผนที่สมมุติ)
    var keyRes = null;
    if (syn && fo.key && world) keyRes = renderKey(o, world, g, cf, mm, pxmm);

    toneCanvas(cv, o.color, syn);
    if (keyRes) keyRes.pages.forEach(function (pg) { toneCanvas(pg.cv, o.color, true); });
    return { cv: cv, wmm: wmm, hmm: hmm, w: W, h: H, nsym: nsym, dpi: Math.round(o.dpi), key: keyRes, world: world };
  }

  function renderPlate(o) {
    var dm0 = paperMM(o), wmm = dm0[0], hmm = dm0[1];
    o = Object.assign({}, o, { dpi: effDpi(o, wmm, hmm) });
    var pxmm = o.dpi / 25.4;
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
    toneCanvas(cv, o.color);
    return { cv: cv, wmm: wmm, hmm: hmm, w: W, h: H, plate: true };
  }


  /* ---------- หน้าเฉลย ---------- */
  // แปลงสีทั้งแผ่นสำหรับเครื่องพิมพ์ขาว-ดำ: 'gray' = เฉดเทา, 'bw' = ขาว/ดำล้วน (เฉดกลางเป็นจุดสกรีน ไม่ให้เงาเขาทึบดำ)
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  function toneCanvas(cv, mode, lineArt) {
    if (!mode || mode === 'color') return;
    var c = cv.getContext('2d'), W = cv.width, H = cv.height, strip = 256;
    for (var y0 = 0; y0 < H; y0 += strip) {
      var hh = Math.min(strip, H - y0), im = c.getImageData(0, y0, W, hh), d = im.data;
      for (var y = 0; y < hh; y++) for (var x = 0; x < W; x++) {
        var k = (y * W + x) * 4, lum = 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2], v;
        if (mode === 'gray') v = lum;
        else if (lineArt) v = lum < 222 ? 0 : 255; // แผนที่สมมุติวาดแบบเส้นล้วนแล้ว ตัดสองระดับได้เลย
        else if (lum >= 205) v = 255;
        else if (lum < 105) v = 0;
        else v = ((lum - 105) / 100 * 16 > BAYER[((y0 + y) & 3) * 4 + (x & 3)] + 0.5) ? 255 : 0;
        d[k] = d[k + 1] = d[k + 2] = v;
      }
      c.putImageData(im, 0, y0);
    }
  }

  function renderKey(o, world, g, cf, mmMain, pxmmMain) {
    var dpi = Math.min(o.dpi, 150), pxmm = dpi / 25.4, wmm = 210, hmm = 297, pages = [];
    function mm(v) { return v * pxmm; }
    var rows = TrailSynDraw.answerRows(world);
    rows.sort(function (a, b) { if (a.n && b.n) return a.n - b.n; if (a.n) return -1; if (b.n) return 1; return a.type < b.type ? -1 : a.type > b.type ? 1 : 0; });
    var kx = g.fw / world.nx, ky = g.fh / world.ny;
    function coord(gx, gy) {
      var E = g.E0 + (g.fx + gx * kx - g.cx) * g.mpp, N = g.N0 - (g.fy + gy * ky - g.cy) * g.mpp, ll = G.fromUTM(g.zone, g.north, E, N);
      return G.formatPoint(ll.lat, ll.lng, cf);
    }
    var perPage = 50, nPages = Math.min(4, Math.max(1, Math.ceil(rows.length / perPage)));
    for (var pg = 0; pg < nPages; pg++) {
      var W = Math.round(wmm * pxmm), H = Math.round(hmm * pxmm), cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      var c = cv.getContext('2d');
      c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
      function t(str, x, y, size, bold, align) { c.font = (bold ? '700 ' : '400 ') + mm(size).toFixed(1) + 'px ' + FONT; c.textAlign = align || 'left'; c.textBaseline = 'alphabetic'; c.fillStyle = '#000'; c.fillText(str, x, y); }
      t('เฉลย · ' + (o.title || 'แผนที่สมมุติ'), mm(12), mm(16), 6, true);
      t('แผนที่สมมุติ รหัส ' + ((o.syn.seed) | 0) + ' · ' + (TrailSynMap._internal.PRESETS[o.syn.preset] || {}).name + ' · มาตราส่วน 1:' + o.scale.toLocaleString('en-US') + ' · เส้นชั้นความสูงทุก ' + world.interval + ' ม. (หลักทุก ' + world.index + ' ม.)', mm(12), mm(22.5), 2.7);
      t('หน้า ' + (pg + 1) + '/' + nPages + ' · พิกัดตามรูปแบบที่เลือก: ' + G.FORMAT_NAMES[cf] + ' · ความสูงเป็นเมตรเหนือระดับน้ำทะเลสมมุติ', mm(12), mm(27.5), 2.5);
      var y = mm(36), cols = [[12, 'ที่'], [24, 'ประเภท'], [62, 'ชื่อ'], [110, 'พิกัด'], [182, 'ความสูง']];
      c.strokeStyle = '#000'; c.lineWidth = Math.max(1, mm(0.3)); c.beginPath(); c.moveTo(mm(10), y + mm(2)); c.lineTo(mm(200), y + mm(2)); c.stroke();
      cols.forEach(function (cc) { t(cc[1], mm(cc[0]), y, 2.8, true); });
      y += mm(6.2);
      rows.slice(pg * perPage, (pg + 1) * perPage).forEach(function (r, k) {
        if (k % 2) { c.fillStyle = '#f3f3f3'; c.fillRect(mm(10), y - mm(3.7), mm(190), mm(4.8)); }
        t(r.n ? String(r.n) : '–', mm(12), y, 2.7);
        t(r.type, mm(24), y, 2.7);
        c.font = '400 ' + mm(2.7).toFixed(1) + 'px ' + FONT;
        var nm = r.name, maxW = mm(46); while (nm.length > 2 && c.measureText(nm).width > maxW) nm = nm.slice(0, -1);
        t(nm === r.name ? nm : nm + '…', mm(62), y, 2.7);
        t(coord(r.gx, r.gy), mm(110), y, 2.5);
        t(r.elev === null || r.elev === undefined ? '–' : Math.round(r.elev) + ' ม.', mm(182), y, 2.7);
        y += mm(5);
      });
      if (pg === nPages - 1 && rows.length > nPages * perPage) t('… ยังมีอีก ' + (rows.length - nPages * perPage) + ' รายการที่ไม่ได้แสดง', mm(12), y + mm(3), 2.6);
      pages.push({ cv: cv, w: W, h: H, wmm: wmm, hmm: hmm });
    }
    return { pages: pages, count: rows.length };
  }

  /* ---------- ไฟล์ ---------- */
  function toBlob(cv, type, q) { return new Promise(function (res) { cv.toBlob(res, type, q); }); }

  // PDF หลายหน้า: pages = [{ jpeg, wpx, hpx, wmm, hmm }] (แต่ละหน้าเป็นภาพ JPEG เต็มหน้า ขนาดกระดาษต่างกันได้)
  function makePDFPages(pages) {
    var enc = new TextEncoder(), parts = [], offs = [], len = 0, n = pages.length;
    function push(b) { if (typeof b === 'string') b = enc.encode(b); parts.push(b); len += b.length; }
    function obj(k, body) { offs[k] = len; push(k + ' 0 obj\n' + body + '\nendobj\n'); }
    push('%PDF-1.4\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    var kids = pages.map(function (pg, i) { return (3 + 3 * i) + ' 0 R'; }).join(' ');
    obj(2, '<< /Type /Pages /Kids [' + kids + '] /Count ' + n + ' >>');
    pages.forEach(function (pg, i) {
      var wp = pg.wmm / 25.4 * 72, hp = pg.hmm / 25.4 * 72, po = 3 + 3 * i, co = 4 + 3 * i, io = 5 + 3 * i;
      obj(po, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + wp.toFixed(2) + ' ' + hp.toFixed(2) + '] /Resources << /XObject << /Im0 ' + io + ' 0 R >> >> /Contents ' + co + ' 0 R >>');
      var cs = 'q ' + wp.toFixed(2) + ' 0 0 ' + hp.toFixed(2) + ' 0 0 cm /Im0 Do Q';
      obj(co, '<< /Length ' + cs.length + ' >>\nstream\n' + cs + '\nendstream');
      offs[io] = len;
      push(io + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + pg.wpx + ' /Height ' + pg.hpx + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + pg.jpeg.length + ' >>\nstream\n');
      push(pg.jpeg);
      push('\nendstream\nendobj\n');
    });
    var total = 3 + 3 * n, xr = len, x = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
    for (var k = 1; k < total; k++) x += ('0000000000' + offs[k]).slice(-10) + ' 00000 n \n';
    push(x + 'trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xr + '\n%%EOF\n');
    var out = new Uint8Array(len), p = 0;
    parts.forEach(function (b) { out.set(b, p); p += b.length; });
    return out;
  }

  async function jpegOf(cv) { return new Uint8Array(await (await toBlob(cv, 'image/jpeg', 0.93)).arrayBuffer()); }
  // which: 'map' (แผนที่) | 'key' (เฉลย) | 'all' (แผนที่ + เฉลยรวม PDF)
  async function fileFor(kind, which) {
    which = which || 'map';
    var tag = last.plate ? 'แผ่นวัดมุม-1-' + (cfg.scale / 1000) + 'k' : cfg.title + '-1-' + (+cfg.scale / 1000) + 'k';
    var base = safeName(tag) + (which === 'key' ? '-เฉลย' : '');
    if (which === 'key') {
      var kp = last.key.pages;
      if (kind === 'pdf') {
        var pk = []; for (var i = 0; i < kp.length; i++) pk.push({ jpeg: await jpegOf(kp[i].cv), wpx: kp[i].w, hpx: kp[i].h, wmm: kp[i].wmm, hmm: kp[i].hmm });
        return { name: base + '.pdf', mime: 'application/pdf', blob: new Blob([makePDFPages(pk)], { type: 'application/pdf' }) };
      }
      var one = kp[0].cv;
      if (kind === 'png') return { name: base + '.png', mime: 'image/png', blob: await toBlob(one, 'image/png') };
      return { name: base + '.jpg', mime: 'image/jpeg', blob: await toBlob(one, 'image/jpeg', 0.93) };
    }
    if (which === 'all') {
      var all = [{ jpeg: await jpegOf(last.cv), wpx: last.w, hpx: last.h, wmm: last.wmm, hmm: last.hmm }];
      for (var q = 0; q < last.key.pages.length; q++) { var pp = last.key.pages[q]; all.push({ jpeg: await jpegOf(pp.cv), wpx: pp.w, hpx: pp.h, wmm: pp.wmm, hmm: pp.hmm }); }
      return { name: safeName(tag) + '-พร้อมเฉลย.pdf', mime: 'application/pdf', blob: new Blob([makePDFPages(all)], { type: 'application/pdf' }) };
    }
    if (kind === 'png') return { name: base + '.png', mime: 'image/png', blob: await toBlob(last.cv, 'image/png') };
    var jb = await toBlob(last.cv, 'image/jpeg', 0.93);
    if (kind === 'jpg') return { name: base + '.jpg', mime: 'image/jpeg', blob: jb };
    var jpeg = new Uint8Array(await jb.arrayBuffer());
    return { name: base + '.pdf', mime: 'application/pdf', blob: new Blob([makePDFPages([{ jpeg: jpeg, wpx: last.w, hpx: last.h, wmm: last.wmm, hmm: last.hmm }])], { type: 'application/pdf' }) };
  }

  /* ---------- แผงพิมพ์ ---------- */
  function opts(id, list, cur) {
    return '<select id="' + id + '" style="flex:1;min-width:0;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px;background:#fff">' +
      list.map(function (o) { return '<option value="' + o[0] + '"' + (String(o[0]) === String(cur) ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>';
  }
  function fld(label, inner) { return '<div class="field"><label style="flex:0 0 96px">' + label + '</label>' + inner + '</div>'; }
  var INP = 'flex:1;min-width:0;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px';
  function chk(id, label, sub, on, extra) { return '<label class="opt"><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + (extra || '') + '><span>' + label + (sub ? '<small>' + sub + '</small>' : '') + '</span></label>'; }

  function normSyn() {
    var d = { seed: 1234, preset: 'hills', reliefMul: 1, baseElev: 200, interval: 20, layers: TrailSynDraw.defaultLayers() };
    var sy = cfg.syn && typeof cfg.syn === 'object' ? cfg.syn : {};
    cfg.syn = Object.assign(d, sy);
    cfg.syn.layers = Object.assign(TrailSynDraw.defaultLayers(), sy.layers || {});
    return cfg.syn;
  }

  function renderSheet(box) {
    var hasSyn = !!(root.TrailSynMap && root.TrailSynDraw);
    if (hasSyn) normSyn();
    var sy = cfg.syn || {}, fo = cfg.foot || {};
    function f(k, d) { return fo[k] === undefined ? d : fo[k]; }
    var scaleSel = SCALES.indexOf(cfg.scale) >= 0 ? cfg.scale : 'custom';
    var paperList = Object.keys(PAPERS).map(function (k) { return [k, k + ' (' + PAPERS[k][0] + '×' + PAPERS[k][1] + ' มม.)']; }).concat([['custom', 'กำหนดเอง (กว้าง × ยาว มม.)']]);
    var baseList = [['none', 'กริดเปล่า (สำหรับฝึกลงพิกัด)'], ['trail', 'แผนที่เดินป่า (เส้นชั้น ยอดเขา X คุ้งกระทะ)'], ['topo', 'ภูมิประเทศ OpenTopoMap'], ['sat', 'ภาพถ่ายดาวเทียม'], ['paper', 'แผนที่กระดาษ (ที่นำเข้า)']];
    if (hasSyn) baseList.push(['syn', 'แผนที่สมมุติ (สร้างเองสำหรับสอน)']);

    var synBox = '';
    if (hasSyn) {
      synBox = '<div id="pSynBox" style="border:1px solid #cfe0d2;background:#f6fbf7;border-radius:12px;padding:10px;margin:8px 0">' +
        '<b>แผนที่สมมุติสำหรับสอน</b><div class="note" style="margin-top:2px">สร้างภูมิประเทศสมมุติ ไม่ต้องใช้แผนที่จริง เลือกได้ว่าจะให้มีรายละเอียดอะไรบ้าง รหัสแผนที่เดียวกัน + ตัวเลือกเดียวกัน = ได้แผนที่เดิมทุกครั้ง</div>' +
        fld('ภูมิประเทศ', opts('sPreset', Object.keys(TrailSynMap._internal.PRESETS).map(function (k) { return [k, TrailSynMap._internal.PRESETS[k].name]; }), sy.preset)) +
        '<div class="note" style="margin:-2px 0 6px">แบบที่ขึ้นต้นด้วย "แบบ…" จำลองลักษณะภูมิประเทศคล้ายอุทยานนั้น ไม่ใช่แผนที่จริงของอุทยาน</div>' +
        fld('รหัสแผนที่', '<input type="number" id="sSeed" min="0" max="999999" style="' + INP + '"><button type="button" class="btn alt" id="sRand" style="flex:none;padding:8px 10px">สุ่มใหม่</button>') +
        fld('ต่างระดับ', '<input type="range" id="sRelief" min="40" max="500" step="10" style="flex:1"><span id="sReliefV" style="flex:0 0 46px;text-align:right"></span>') +
        fld('ความสูงฐาน (ม.)', '<input type="number" id="sBase" min="0" max="4000" step="10" style="' + INP + '">') +
        fld('ระยะเส้นชั้น', opts('sIv', [[20, '20 ม. · หลักทุก 100 ม. (มาตรฐาน)'], [10, '10 ม. · หลักทุก 50 ม.'], [5, '5 ม. · หลักทุก 25 ม.'], [2, '2 ม. · หลักทุก 10 ม.'], [40, '40 ม. · หลักทุก 200 ม.'], [100, '100 ม. · หลักทุก 500 ม.']], sy.interval === 'auto' ? 20 : sy.interval)) +
        '<h4 style="margin:10px 0 4px">ชุดสำเร็จรูป</h4><div id="sSets" style="display:flex;flex-wrap:wrap;gap:6px">' +
        Object.keys(TrailSynDraw.PRESET_SETS).map(function (k) { return '<button type="button" class="btn alt" data-set="' + k + '" style="flex:none;padding:6px 10px;font-size:13px">' + TrailSynDraw.PRESET_SETS[k].name + '</button>'; }).join('') + '</div>' +
        '<h4 style="margin:10px 0 2px">เลือกรายละเอียดที่จะใส่ในแผนที่</h4>' +
        TrailSynDraw.GROUPS.map(function (gr, gi) {
          return '<details' + (gi < 2 ? ' open' : '') + ' style="margin:4px 0"><summary style="font-weight:600;padding:6px 0">' + gr.title + '</summary>' +
            gr.items.map(function (it) { return chk('L_' + it[0], it[1], '', sy.layers[it[0]], ' data-l="' + it[0] + '"'); }).join('') + '</details>';
        }).join('') + '</div>';
    }

    var footBox = '<details style="margin:8px 0"><summary style="font-weight:600;padding:6px 0">รายละเอียดด้านล่างแผนที่ (เลือกใส่หรือไม่ใส่)</summary>' +
      chk('fBar', 'แถบมาตราส่วน', '', f('bar', true)) + chk('fNorth', 'ลูกศรทิศ GN/TN/MN และค่าเบี่ยงเบน', '', f('north', true)) +
      chk('fGrid', 'หมายเหตุช่องกริด · พิมพ์ที่ 100%', '', f('grid', true)) + chk('fCorners', 'พิกัดมุมซ้ายล่าง/ขวาบน', '', f('corners', true)) +
      chk('fCredit', 'หมายเหตุแหล่งข้อมูล/ข้อความแผนที่สมมุติ', '', f('credit', true)) +
      (hasSyn ? '<div id="fSynOnly">' + chk('fInterval', 'ระยะต่างเส้นชั้นความสูง', '', f('interval', true)) + chk('fLegend', 'คำอธิบายสัญลักษณ์ (เฉพาะที่ใช้ในแผนที่)', '', f('legend', true)) +
        chk('fKey', 'สร้างหน้าเฉลย (รายการและพิกัดของสิ่งที่ปรากฏ)', 'ใช้คู่กับ "หมายเลขกำกับจุดสำคัญ" ได้', f('key', true)) + '</div>' : '') +
      chk('fStudent', 'ช่องชื่อ-สกุล ชั้น เลขที่ วันที่ คะแนน', '', f('student', false)) +
      '<div class="field" style="align-items:flex-start"><label style="flex:0 0 96px">โจทย์/คำถาม<br><small style="color:#777">1 บรรทัด = 1 ข้อ</small></label><textarea id="fQ" rows="4" style="' + INP + ';font-family:inherit"></textarea></div>' +
      chk('fAns', 'เว้นเส้นให้เขียนคำตอบใต้โจทย์แต่ละข้อ', '', f('answerLines', false)) + '</details>';

    var h = fld('ชื่อแผ่น', '<input type="text" id="pTitle" style="' + INP + '">') +
      fld('กระดาษ', opts('pPaper', paperList, cfg.paper)) +
      '<div class="field" id="pCustomPaper"><label style="flex:0 0 96px">ขนาดเอง (มม.)</label><input type="number" id="pCW" min="60" max="1500" style="' + INP + '"><span>×</span><input type="number" id="pCH" min="60" max="2000" style="' + INP + '"></div>' +
      fld('แนววาง', opts('pLand', [['0', 'แนวตั้ง'], ['1', 'แนวนอน']], cfg.land ? '1' : '0')) +
      fld('มาตราส่วน', opts('pScale', SCALES.map(function (s) { return [s, '1 : ' + s.toLocaleString('en-US')]; }).concat([['custom', 'กำหนดเอง 1 : …']]), scaleSel)) +
      '<div class="field" id="pCustomScale"><label style="flex:0 0 96px">1 : (ตัวเลข)</label><input type="number" id="pSC" min="500" max="5000000" step="1" style="' + INP + '"></div>' +
      fld('ช่วงกริด', opts('pGrid', [['auto', 'อัตโนมัติตามสเกล'], [10, '10 ม.'], [20, '20 ม.'], [50, '50 ม.'], [100, '100 ม.'], [250, '250 ม.'], [500, '500 ม.'], [1000, '1 กม.'], [2000, '2 กม.'], [5000, '5 กม.'], [10000, '10 กม.']], cfg.grid)) +
      fld('แบบเส้นกริด', opts('pStyle', [['lines', 'เส้นเต็ม'], ['cross', 'กากบาทที่จุดตัด']], cfg.style)) +
      fld('รูปแบบพิกัด', '<select id="pFmt" style="' + INP + ';background:#fff">' +
        G.FORMATS.map(function (fm) { return '<option value="' + fm + '"' + (fm === cfg.cfmt ? ' selected' : '') + '>' + G.FORMAT_NAMES[fm] + '</option>'; }).join('') + '</select>') +
      fld('ศูนย์กลางแผ่น', '<input type="text" id="pCenter" style="' + INP + '"><button type="button" class="btn alt" id="pCur" style="flex:none;padding:8px 10px">กลางจอ</button>') +
      fld('พื้นหลัง', opts('pBase', baseList, cfg.base)) +
      synBox +
      '<div id="pRealOpts">' + fld('ความเข้มภาพ', '<input type="range" id="pFade" min="20" max="100" step="5" style="flex:1"><span id="pFadeV" style="flex:0 0 40px;text-align:right"></span>') +
      '<label class="opt"><input type="checkbox" id="pSym"><span>วางสัญลักษณ์ทหารและหมุดที่ปักไว้<small>เฉพาะงานที่ติ๊กแสดงอยู่</small></span></label>' +
      '<label class="opt"><input type="checkbox" id="pRoutes"><span>วาดเส้นทางที่แสดงอยู่</span></label></div>' +
      footBox +
      fld('สีที่พิมพ์', opts('pColor', [['color', 'สี'], ['gray', 'ขาว-ดำ แบบมีเฉดเทา'], ['bw', 'ขาว-ดำล้วน (เส้นดำ พื้นขาว)']], cfg.color || 'color')) +
      fld('ความละเอียด', opts('pDpi', [[100, '100 dpi (เร็ว ไฟล์เล็ก)'], [150, '150 dpi (แนะนำ)'], [200, '200 dpi (คมที่สุด)'], [300, '300 dpi (กระดาษเล็ก)']], cfg.dpi)) +
      '<div class="btnrow"><button class="btn" id="pBuild">สร้างแผนที่ฝึก</button><button class="btn alt" id="pPlate">แผ่นวัดมุมขนาดจริง</button></div>' +
      '<div id="pStat" class="note"></div><div id="pOut"></div>' +
      '<p class="note">พื้นหลังภูมิประเทศ/ดาวเทียมต้องออนไลน์ หรือดาวน์โหลดพื้นที่นั้นไว้แล้ว ส่วนแผนที่กระดาษใช้ออฟไลน์ได้ (ต้องนำเข้าและปรับพิกัดไว้ที่ ★ พิเศษ ก่อน และศูนย์กลางแผ่นต้องอยู่ในพื้นที่ของแผนที่กระดาษ) ภาพถูกดัดให้ตรงกับกริด UTM จึงถูกต้องตามสเกล ' +
      'แผนที่สมมุติใช้ออฟไลน์ได้เต็มรูปแบบ ถ้าไม่ใส่ศูนย์กลางแผ่น แอพกำหนดพิกัดสมมุติให้ตามรหัสแผนที่ (ใส่เองได้ถ้าต้องการให้ตรงกับแบบฝึก) ' +
      'กระดาษใหญ่มาก (เช่น A1 A0) แอพลดความละเอียดอัตโนมัติให้พอดีกับหน่วยความจำของเครื่อง ถ้าต้องการคมกว่านี้ให้สร้างจากคอมพิวเตอร์ ' +
      'รูปแบบพิกัด: MGRS/UTM ใช้เส้นกริด UTM (ตัวเลขเป็น กม. ปรับช่วงกริดได้) ส่วนองศา ลิปดา ฟิลิปดา / องศา ลิปดาทศนิยม / องศาทศนิยม จะพิมพ์เป็นเส้นละติจูด-ลองจิจูด ช่วงเส้นเลือกให้อัตโนมัติตามสเกล ' +
      'ถ้าพื้นที่ในแผนที่ลับ/หวงห้าม อย่าส่งไฟล์ออกนอกหน่วยงาน · พิมพ์ที่ขนาด 100% เสมอ</p>';
    box.innerHTML = h;
    $('pTitle').value = cfg.title;
    $('pCenter').value = cfg.center;
    $('pCW').value = cfg.cw; $('pCH').value = cfg.ch; $('pSC').value = cfg.scale;
    $('fQ').value = f('questions', '');
    G.bindCoord($('pCenter'), $('pFmt'), $('pCur'), function () { return ctx.map().getCenter(); }, function (fm) { cfg.cfmt = fm; saveCfg(); });
    $('pFade').value = cfg.fade; $('pFadeV').textContent = cfg.fade + '%';
    $('pSym').checked = cfg.sym; $('pRoutes').checked = cfg.routes;
    $('pFade').oninput = function () { $('pFadeV').textContent = this.value + '%'; };
    if (hasSyn) {
      $('sSeed').value = sy.seed; $('sRelief').value = Math.round(sy.reliefMul * 100); $('sReliefV').textContent = Math.round(sy.reliefMul * 100) + '%'; $('sBase').value = sy.baseElev;
      $('sRelief').oninput = function () { $('sReliefV').textContent = this.value + '%'; };
      $('sRand').onclick = function () { $('sSeed').value = 100 + Math.floor(Math.random() * 899900); };
      Array.prototype.forEach.call(box.querySelectorAll('#sSets [data-set]'), function (b) {
        b.onclick = function () { var set = TrailSynDraw.PRESET_SETS[b.getAttribute('data-set')].f(), pre = {}; Array.prototype.forEach.call(box.querySelectorAll('[data-l]'), function (cb) { cb.checked = !!set[cb.getAttribute('data-l')]; }); };
      });
    }
    function syncVis() {
      var isSyn = $('pBase').value === 'syn';
      $('pCustomPaper').style.display = $('pPaper').value === 'custom' ? '' : 'none';
      $('pCustomScale').style.display = $('pScale').value === 'custom' ? '' : 'none';
      if ($('pSynBox')) $('pSynBox').style.display = isSyn ? '' : 'none';
      if ($('fSynOnly')) $('fSynOnly').style.display = isSyn ? '' : 'none';
      $('pRealOpts').style.display = isSyn ? 'none' : '';
    }
    ['pPaper', 'pScale', 'pBase'].forEach(function (id) { $(id).onchange = syncVis; });
    $('pBase').addEventListener('change', function () { if (this.value === 'trail' && +$('pFade').value < 90) { $('pFade').value = 100; $('pFadeV').textContent = '100%'; } });
    syncVis();
    function readCfg() {
      cfg.title = $('pTitle').value.trim() || 'แบบฝึกอ่านพิกัดกริด';
      cfg.paper = $('pPaper').value; cfg.land = $('pLand').value === '1';
      cfg.cw = parseFloat($('pCW').value) || 210; cfg.ch = parseFloat($('pCH').value) || 297;
      var sc = $('pScale').value === 'custom' ? parseInt($('pSC').value, 10) : parseInt($('pScale').value, 10);
      if (!(sc >= 500 && sc <= 5000000)) throw new Error('มาตราส่วนต้องอยู่ระหว่าง 1:500 ถึง 1:5,000,000');
      cfg.scale = sc;
      cfg.grid = $('pGrid').value; cfg.style = $('pStyle').value;
      cfg.center = $('pCenter').value.trim(); cfg.base = $('pBase').value; cfg.fade = parseInt($('pFade').value, 10);
      cfg.sym = $('pSym').checked; cfg.routes = $('pRoutes').checked; cfg.dpi = parseInt($('pDpi').value, 10); cfg.color = $('pColor').value;
      cfg.foot = { bar: $('fBar').checked, north: $('fNorth').checked, grid: $('fGrid').checked, corners: $('fCorners').checked, credit: $('fCredit').checked, student: $('fStudent').checked, questions: $('fQ').value, answerLines: $('fAns').checked };
      if (hasSyn) {
        cfg.foot.interval = $('fInterval').checked; cfg.foot.legend = $('fLegend').checked; cfg.foot.key = $('fKey').checked;
        var layers = {}; Array.prototype.forEach.call(box.querySelectorAll('[data-l]'), function (cb) { layers[cb.getAttribute('data-l')] = cb.checked; });
        cfg.syn = { seed: parseInt($('sSeed').value, 10) || 1, preset: $('sPreset').value, reliefMul: (parseInt($('sRelief').value, 10) || 100) / 100, baseElev: parseFloat($('sBase').value) || 0, interval: $('sIv').value, layers: layers };
      }
      saveCfg();
    }
    function fileButtons(row, which, labelPrefix) {
      [['pdf', 'PDF'], ['png', 'PNG'], ['jpg', 'JPEG']].forEach(function (fm) {
        var b = document.createElement('button');
        b.className = fm[0] === 'pdf' ? 'btn' : 'btn alt';
        b.textContent = labelPrefix + fm[1];
        b.onclick = function () {
          b.disabled = true;
          fileFor(fm[0], which).then(function (file) {
            b.disabled = false;
            TrailExport.share(file).then(function (ok) { if (!ok) { TrailExport.download(file); ctx.toast('ดาวน์โหลดแล้ว: ' + file.name + ' (ดูในแอพไฟล์)'); } });
          }).catch(function () { b.disabled = false; ctx.toast('สร้างไฟล์ไม่สำเร็จ'); });
        };
        row.appendChild(b);
      });
    }
    function run(kind) {
      if (busy) return;
      try { readCfg(); } catch (e) { $('pStat').textContent = 'ไม่สำเร็จ: ' + e.message; return; }
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
        var dpiNote = res.dpi && res.dpi < cfg.dpi ? ' (ลดจาก ' + cfg.dpi + ' dpi เพราะกระดาษใหญ่)' : '';
        $('pStat').textContent = (res.plate ? 'แผ่นวัดมุม ' : 'แผนที่ ') + (cfg.paper === 'custom' ? cfg.cw + '×' + cfg.ch + ' มม.' : cfg.paper) + ' · ' + res.w + '×' + res.h + ' px · ' + (res.dpi || cfg.dpi) + ' dpi' + dpiNote + (res.nsym ? ' · สัญลักษณ์ ' + res.nsym + ' รายการ' : '');
        var pv = document.createElement('canvas'); window.__lastPrintCanvas = res.cv;
        pv.width = 720; pv.height = Math.round(720 * res.h / res.w);
        pv.getContext('2d').drawImage(res.cv, 0, 0, pv.width, pv.height);
        var img = document.createElement('img');
        img.src = pv.toDataURL('image/jpeg', 0.85);
        img.style.cssText = 'width:100%;border:1px solid #ccc;margin-top:8px';
        $('pOut').appendChild(img);
        var row = document.createElement('div');
        row.className = 'btnrow';
        fileButtons(row, 'map', res.key ? 'แผนที่ ' : '');
        $('pOut').appendChild(row);
        if (res.world && window.TrailSyn3D) {
          var row3d = document.createElement('div'); row3d.className = 'btnrow';
          var b3d = document.createElement('button'); b3d.className = 'btn'; b3d.id = 'p3d'; b3d.textContent = '⛰ ดูภาพ 3 มิติ ของแผนที่นี้';
          b3d.onclick = function () { TrailSyn3D.open(res.world, { scale: cfg.scale, title: cfg.title }); };
          row3d.appendChild(b3d); $('pOut').appendChild(row3d);
        }
        if (res.key) {
          var row2 = document.createElement('div');
          row2.className = 'btnrow';
          fileButtons(row2, 'key', 'เฉลย ');
          $('pOut').appendChild(row2);
          var row3 = document.createElement('div');
          row3.className = 'btnrow';
          var ball = document.createElement('button');
          ball.className = 'btn alt'; ball.textContent = 'PDF รวม (แผนที่ + เฉลย ' + res.key.pages.length + ' หน้า)';
          ball.onclick = function () { ball.disabled = true; fileFor('pdf', 'all').then(function (file) { ball.disabled = false; TrailExport.share(file).then(function (ok) { if (!ok) { TrailExport.download(file); ctx.toast('ดาวน์โหลดแล้ว: ' + file.name); } }); }).catch(function () { ball.disabled = false; ctx.toast('สร้างไฟล์ไม่สำเร็จ'); }); };
          row3.appendChild(ball); $('pOut').appendChild(row3);
          var kimg = document.createElement('img');
          var kc = document.createElement('canvas'); kc.width = 360; kc.height = Math.round(360 * res.key.pages[0].h / res.key.pages[0].w);
          kc.getContext('2d').drawImage(res.key.pages[0].cv, 0, 0, kc.width, kc.height);
          kimg.src = kc.toDataURL('image/jpeg', 0.8); kimg.style.cssText = 'width:50%;border:1px solid #ccc;margin-top:8px';
          $('pOut').appendChild(kimg);
        }
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
