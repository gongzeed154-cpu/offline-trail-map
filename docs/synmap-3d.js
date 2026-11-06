/* ภาพ 3 มิติของแผนที่สมมุติ: ก้อนภูมิประเทศแบบแผนผัง (block diagram) หมุนได้ ก้มเงยได้ บันทึกเป็น PNG ได้
   วาดด้วย canvas 2D (ไม่ต้องใช้ WebGL) แบบ painter's algorithm: เรียงช่องจากไกลไปใกล้แล้วระบายทีละช่อง */
(function (root) {
  'use strict';

  var D = root.TrailSynDraw;

  // ---------- เตรียมสีผิวพื้น (ทำครั้งเดียวต่อแผนที่) ----------
  // สีตามความสูง + แสงเงา + เส้นชั้นความสูง/ลำน้ำจากตัววาดแผนที่ (ซ้อนแบบ multiply)
  function buildTexture(w, scale, contours) {
    var nx = w.nx, ny = w.ny, h = w.h, TS = 2, tw = nx * TS, th = ny * TS;
    var hmin = 1e9, hmax = -1e9, q;
    for (q = 0; q < w.N; q++) { if (h[q] < hmin) hmin = h[q]; if (h[q] > hmax) hmax = h[q]; }
    var stops = [[0, [118, 160, 92]], [0.25, [150, 176, 102]], [0.5, [192, 182, 122]], [0.75, [168, 133, 92]], [1, [146, 116, 90]]];
    function col(t) {
      for (var k = 1; k < stops.length; k++) if (t <= stops[k][0]) { var a = stops[k - 1], b = stops[k], u = (t - a[0]) / (b[0] - a[0]); return [a[1][0] + (b[1][0] - a[1][0]) * u, a[1][1] + (b[1][1] - a[1][1]) * u, a[1][2] + (b[1][2] - a[1][2]) * u]; }
      return stops[stops.length - 1][1];
    }
    var t0 = document.createElement('canvas'); t0.width = nx; t0.height = ny;
    var c0 = t0.getContext('2d'), img = c0.createImageData(nx, ny), dd = img.data, i, j;
    for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
      var p = j * nx + i, l = h[p - (i > 0 ? 1 : 0)], r = h[p + (i < nx - 1 ? 1 : 0)], up = h[p - (j > 0 ? nx : 0)], dn = h[p + (j < ny - 1 ? nx : 0)];
      var dx = (r - l) / (2 * w.cellM), dy = (dn - up) / (2 * w.cellM), nl = Math.sqrt(1 + dx * dx + dy * dy);
      var lam = Math.max(0, (-dx * 0.6 - dy * 0.55 + 0.75) / nl / 1.15), cc = col((h[p] - hmin) / ((hmax - hmin) || 1)), s = 0.45 + 0.75 * lam;
      if (w.pondMask && w.pondMask[p]) { cc = [70, 130, 210]; s = 1; }
      dd[p * 4] = Math.min(255, cc[0] * s); dd[p * 4 + 1] = Math.min(255, cc[1] * s); dd[p * 4 + 2] = Math.min(255, cc[2] * s); dd[p * 4 + 3] = 255;
    }
    c0.putImageData(img, 0, 0);
    var tex = document.createElement('canvas'); tex.width = tw; tex.height = th;
    var tc = tex.getContext('2d'); tc.imageSmoothingEnabled = true; tc.drawImage(t0, 0, 0, tw, th);
    // เส้นชั้นความสูงและลำน้ำ (ตัววาดแผนที่จะเขียนทับรายการเฉลยในโลก จึงเก็บไว้ก่อนแล้วคืนค่า)
    var keep = { keyItems: w.keyItems, numbered: w.numbered };
    var lay = D.allLayers(false);
    if (contours) { lay.cIndex = lay.cInter = true; }
    lay.river = lay.stream = lay.pond = true;
    var ov = document.createElement('canvas'); ov.width = tw; ov.height = th;
    var wmm = w.extW * 1000 / scale;
    try { D.draw(ov.getContext('2d'), { syn: { layers: lay }, dpi: tw / wmm * 25.4, scale: scale }, { fx: 0, fy: 0, fw: tw, fh: th }, w); } catch (e) {}
    w.keyItems = keep.keyItems; w.numbered = keep.numbered;
    tc.globalCompositeOperation = 'multiply'; tc.globalAlpha = 0.85; tc.drawImage(ov, 0, 0);
    tc.globalCompositeOperation = 'source-over'; tc.globalAlpha = 1;
    return { data: tc.getImageData(0, 0, tw, th).data, tw: tw, th: th, TS: TS, hmin: hmin, hmax: hmax };
  }

  // สีเฉลี่ยของแต่ละช่องที่ความละเอียด st (ช่องละ st×st เซลล์)
  function cellColors(w, tex, st) {
    var cw = Math.floor((w.nx - 1) / st), ch = Math.floor((w.ny - 1) / st), out = new Array(cw * ch), d = tex.data, tw = tex.tw, TS = tex.TS;
    for (var b = 0; b < ch; b++) for (var a = 0; a < cw; a++) {
      var r = 0, g = 0, bl = 0, n = 0, x0 = a * st * TS, y0 = b * st * TS, x1 = Math.min(tex.tw, x0 + st * TS), y1 = Math.min(tex.th, y0 + st * TS), sx = Math.max(1, Math.floor((x1 - x0) / 4)), sy = Math.max(1, Math.floor((y1 - y0) / 4));
      for (var y = y0; y < y1; y += sy) for (var x = x0; x < x1; x += sx) { var o = (y * tw + x) * 4; r += d[o]; g += d[o + 1]; bl += d[o + 2]; n++; }
      out[b * cw + a] = 'rgb(' + Math.round(r / n) + ',' + Math.round(g / n) + ',' + Math.round(bl / n) + ')';
    }
    return { cw: cw, ch: ch, col: out };
  }

  // ---------- วาดภาพ ----------
  // v: { az องศา (0 = มองจากทิศใต้ไปทางเหนือ), tilt องศา (มุมก้ม), ve ขยายความสูง, labels, title }
  function render(cv, w, tex, cells, st, v) {
    var c = cv.getContext('2d'), W = cv.width, H = cv.height, nx = w.nx, ny = w.ny, h = w.h, cm = w.cellM;
    var az = v.az * Math.PI / 180, tl = v.tilt * Math.PI / 180, ca = Math.cos(az), sa = Math.sin(az), sT = Math.sin(tl), cT = Math.cos(tl);
    var base = tex.hmin - (tex.hmax - tex.hmin) * 0.08 - 20, ve = v.ve;
    var pcx = v.cx === undefined ? nx / 2 : v.cx, pcy = v.cy === undefined ? ny / 2 : v.cy, zoom = v.zoom || 1;
    function rot(i, j) { var X = (i - pcx) * cm, Y = (j - pcy) * cm; return [X * ca - Y * sa, X * sa + Y * ca]; }
    function proj(i, j, z) { var r = rot(i, j); return [r[0], r[1] * sT - (z - base) * ve * cT, r[1]]; }
    // ขอบเขตภาพเพื่อย่อให้พอดีจอ
    var mnx = 1e18, mxx = -1e18, mny = 1e18, mxy = -1e18;
    [[0, 0], [nx - 1, 0], [0, ny - 1], [nx - 1, ny - 1]].forEach(function (k) {
      [base, tex.hmax].forEach(function (z) { var p = proj(k[0], k[1], z); mnx = Math.min(mnx, p[0]); mxx = Math.max(mxx, p[0]); mny = Math.min(mny, p[1]); mxy = Math.max(mxy, p[1]); });
    });
    var topPad = v.title ? H * 0.11 : H * 0.05, pad = W * 0.04;
    var k = Math.min((W - 2 * pad) / (mxx - mnx), (H - topPad - pad) / (mxy - mny)) * zoom;
    var ox, oy;
    if (v.pinned) { // จุดที่เลือกอยู่กลางภาพ หมุน/ซูมรอบจุดนี้
      var pp0 = proj(pcx, pcy, hzRaw(pcx, pcy)); ox = W / 2 - pp0[0] * k; oy = topPad + (H - topPad - pad) / 2 - pp0[1] * k;
    } else { ox = W / 2 - (mnx + mxx) / 2 * k; oy = topPad + (H - topPad - pad) / 2 - (mny + mxy) / 2 * k; }
    function S(i, j, z) { var p = proj(i, j, z); return [ox + p[0] * k, oy + p[1] * k, p[2]]; }
    var grd = c.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#cfe3f3'); grd.addColorStop(1, '#ffffff'); c.fillStyle = grd; c.fillRect(0, 0, W, H);
    function hzRaw(i, j) { i = Math.max(0, Math.min(nx - 1, Math.round(i))); j = Math.max(0, Math.min(ny - 1, Math.round(j))); return h[j * nx + i]; }
    function hz(i, j) { i = Math.max(0, Math.min(nx - 1, i)); j = Math.max(0, Math.min(ny - 1, j)); return h[j * nx + i]; }
    // จุดยอดของตาราง
    var cw = cells.cw, ch = cells.ch, vx = new Float32Array((cw + 1) * (ch + 1)), vy = new Float32Array(vx.length), vd = new Float32Array(vx.length), a, b;
    for (b = 0; b <= ch; b++) for (a = 0; a <= cw; a++) { var s = S(a * st, b * st, hz(a * st, b * st)); vx[b * (cw + 1) + a] = s[0]; vy[b * (cw + 1) + a] = s[1]; vd[b * (cw + 1) + a] = s[2]; }
    // ด้านข้างก้อนดินที่หันเข้าหาผู้ดู (ด้านที่อยู่ไกลถูกพื้นผิวบังอยู่แล้ว)
    var sides = [
      { pts: function (t) { return [t * st, 0]; }, n: cw, nrm: [0, -1] },
      { pts: function (t) { return [t * st, ch * st]; }, n: cw, nrm: [0, 1] },
      { pts: function (t) { return [0, t * st]; }, n: ch, nrm: [-1, 0] },
      { pts: function (t) { return [cw * st, t * st]; }, n: ch, nrm: [1, 0] }
    ];
    // ลำดับไกลไปใกล้ (ค่า Y หลังหมุนน้อย = ไกล)
    var order = [], depth = new Float32Array(cw * ch), mg = 4;
    for (b = 0; b < ch; b++) for (a = 0; a < cw; a++) {
      var id = b * cw + a, q0 = b * (cw + 1) + a, q2 = q0 + cw + 2;
      // ข้ามช่องที่อยู่นอกจอ (สำคัญตอนซูม)
      var xa = Math.min(vx[q0], vx[q0 + 1], vx[q2], vx[q2 - 1]), xb = Math.max(vx[q0], vx[q0 + 1], vx[q2], vx[q2 - 1]), ya = Math.min(vy[q0], vy[q0 + 1], vy[q2], vy[q2 - 1]), yb = Math.max(vy[q0], vy[q0 + 1], vy[q2], vy[q2 - 1]);
      if (xb < -mg || xa > W + mg || yb < -mg || ya > H + mg) continue;
      order.push(id); depth[id] = vd[q0];
    }
    order.sort(function (p, q) { return depth[p] - depth[q]; });
    c.lineWidth = 0.9; c.lineJoin = 'round';
    for (var n = 0; n < order.length; n++) {
      var id2 = order[n], a2 = id2 % cw, b2 = (id2 - a2) / cw, v0 = b2 * (cw + 1) + a2, v1 = v0 + 1, v2 = v0 + cw + 2, v3 = v0 + cw + 1;
      c.fillStyle = c.strokeStyle = cells.col[id2];
      c.beginPath(); c.moveTo(vx[v0], vy[v0]); c.lineTo(vx[v1], vy[v1]); c.lineTo(vx[v2], vy[v2]); c.lineTo(vx[v3], vy[v3]); c.closePath(); c.fill(); c.stroke();
    }
    sides.forEach(function (sd, si) {
      var nr = [sd.nrm[0] * ca - sd.nrm[1] * sa, sd.nrm[0] * sa + sd.nrm[1] * ca];
      if (nr[1] <= 0.001) return; // หันออกจากผู้ดู
      c.fillStyle = si < 2 ? '#8a6a48' : '#755a3e'; c.beginPath();
      var p0 = sd.pts(0), pl = sd.pts(sd.n), sb = S(p0[0], p0[1], base); c.moveTo(sb[0], sb[1]);
      for (var t = 0; t <= sd.n; t++) { var pp = sd.pts(t), sp = S(pp[0], pp[1], hz(pp[0], pp[1])); c.lineTo(sp[0], sp[1]); }
      var se = S(pl[0], pl[1], base); c.lineTo(se[0], se[1]); c.closePath(); c.fill();
      // เส้นระดับทุก 100 ม. บนผนังดิน ช่วยกะความสูง
      c.strokeStyle = 'rgba(0,0,0,.22)'; c.lineWidth = 1;
      for (var lv = Math.ceil(base / 100) * 100; lv < tex.hmax; lv += 100) {
        c.beginPath(); var first = true;
        for (var t2 = 0; t2 <= sd.n; t2++) { var p3 = sd.pts(t2); if (hz(p3[0], p3[1]) < lv) { first = true; continue; } var s3 = S(p3[0], p3[1], lv); if (first) { c.moveTo(s3[0], s3[1]); first = false; } else c.lineTo(s3[0], s3[1]); }
        c.stroke();
      }
    });
    // ป้ายลักษณะภูมิประเทศพร้อมเส้นชี้
    var fs = Math.max(12, Math.round(W / 70));
    if (v.labels) {
      var placed = [];
      var tag = function (gx, gy, txt, color) {
        var p = S(gx, gy, hz(Math.round(gx), Math.round(gy)));
        if (p[0] < 0 || p[0] > W || p[1] < 0 || p[1] > H) return;
        c.font = '700 ' + fs + 'px ' + D.FONT; var tw2 = c.measureText(txt).width, lx = p[0], ly = p[1] - fs * 2.6;
        for (var t3 = 0; t3 < 10; t3++) {
          var bx = [lx - tw2 / 2 - 8, ly - fs, lx + tw2 / 2 + 8, ly + fs * 0.35];
          if (!placed.some(function (q) { return bx[0] < q[2] && bx[2] > q[0] && bx[1] < q[3] && bx[3] > q[1]; })) break;
          ly -= fs * 1.4; if (ly < topPad) ly = p[1] + fs * 2.4 + t3 * fs * 1.4;
        }
        placed.push([lx - tw2 / 2 - 8, ly - fs, lx + tw2 / 2 + 8, ly + fs * 0.35]);
        c.strokeStyle = '#222'; c.lineWidth = Math.max(1.5, fs / 12); c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(lx, ly + fs * 0.3); c.stroke();
        c.beginPath(); c.arc(p[0], p[1], fs * 0.22, 0, 7); c.fillStyle = color; c.fill(); c.stroke();
        c.fillStyle = 'rgba(255,255,255,.93)'; c.fillRect(lx - tw2 / 2 - 7, ly - fs * 0.95, tw2 + 14, fs * 1.3); c.strokeRect(lx - tw2 / 2 - 7, ly - fs * 0.95, tw2 + 14, fs * 1.3);
        c.fillStyle = color; c.textAlign = 'center'; c.fillText(txt, lx, ly); c.textAlign = 'left';
      };
      var pk = (w.peaks || []).slice().sort(function (p, q) { return q.elev - p.elev; });
      pk.slice(0, 3).forEach(function (q) { tag(q.gx, q.gy, 'ยอดเขา ' + Math.round(q.elev) + ' ม.', '#b71c1c'); });
      if (w.saddles && w.saddles[0]) tag(w.saddles[0].gx, w.saddles[0].gy, 'คอเขา', '#6a1b9a');
      if (w.ridges && w.ridges[0]) { var mr = w.ridges[0].pts[Math.floor(w.ridges[0].pts.length / 2)]; tag(mr[0], mr[1], 'สันเขา', '#8d4a12'); }
      if (w.valleys && w.valleys[0]) { var mv = w.valleys[0].pts[Math.floor(w.valleys[0].pts.length / 2)]; tag(mv[0], mv[1], 'หุบเขา', '#1565c0'); }
      var cl = (w.keyItems || []).filter(function (q) { return q.type === 'cliff'; })[0]; if (cl) tag(cl.gx, cl.gy, 'หน้าผา', '#4e342e');
      if (w.sinks && w.sinks[0]) tag(w.sinks[0].gx, w.sinks[0].gy, 'ที่ต่ำ (แอ่ง)', '#e65100');
      var rv = (w.streamSegs || []).filter(function (sg) { return sg.kind === 'river'; }).sort(function (p, q) { return q.accEnd - p.accEnd; })[0];
      if (rv) { var mrv = rv.pts[Math.floor(rv.pts.length * 0.6)]; tag(mrv[0], mrv[1], 'แม่น้ำ', '#0d47a1'); }
      (w.villages || []).slice(0, 1).forEach(function (vl) { tag(vl.gx, vl.gy, vl.name, '#7a1f2b'); });
    }
    if (v.pinned) { // เครื่องหมายจุดที่เลือก
      var pz = hzRaw(pcx, pcy), ps = S(pcx, pcy, pz), fsz = Math.max(12, Math.round(W / 70));
      c.fillStyle = '#d50000'; c.strokeStyle = '#fff'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(ps[0], ps[1]); c.arc(ps[0], ps[1] - fsz * 1.3, fsz * 0.55, Math.PI * 0.75, Math.PI * 0.25); c.closePath(); c.fill(); c.stroke();
      var tx = 'จุดที่เลือก สูง ' + Math.round(pz) + ' ม.'; c.font = '700 ' + fsz + 'px ' + D.FONT; var tw3 = c.measureText(tx).width;
      c.fillStyle = 'rgba(255,255,255,.93)'; c.fillRect(ps[0] + fsz * 0.8, ps[1] - fsz * 2.3, tw3 + 14, fsz * 1.35); c.fillStyle = '#d50000'; c.fillText(tx, ps[0] + fsz * 0.8 + 7, ps[1] - fsz * 1.3);
    }
    // ลูกศรทิศเหนือ (หมุนตามมุมมอง)
    var nxr = sa, nyr = -ca * sT, nl = Math.hypot(nxr, nyr) || 1, ax = W - fs * 3, ay = topPad + fs * 2.5, al = fs * 1.8;
    c.save(); c.translate(ax, ay); c.rotate(Math.atan2(nyr / nl, nxr / nl) + Math.PI / 2);
    c.fillStyle = '#c62828'; c.beginPath(); c.moveTo(0, -al); c.lineTo(al * 0.4, al * 0.5); c.lineTo(0, al * 0.2); c.lineTo(-al * 0.4, al * 0.5); c.closePath(); c.fill(); c.restore();
    c.font = '700 ' + fs + 'px ' + D.FONT; c.fillStyle = '#c62828'; c.textAlign = 'center'; c.fillText('N', ax, ay + al + fs * 0.6); c.textAlign = 'left';
    if (v.title) {
      c.font = '700 ' + Math.round(fs * 1.25) + 'px ' + D.FONT; c.fillStyle = '#1a1a1a'; c.fillText(v.title, pad, fs * 1.9);
      c.font = '400 ' + Math.round(fs * 0.85) + 'px ' + D.FONT; c.fillStyle = '#333';
      c.fillText('ภาพจำลอง 3 มิติของพื้นที่เดียวกับแผนที่ · ขยายความสูง ' + ve + ' เท่า · เส้นบนพื้นคือเส้นชั้นความสูง (หลักทุก ' + w.index + ' ม. รองทุก ' + w.interval + ' ม.)', pad, fs * 3.2);
    }
    return { vx: vx, vy: vy, vd: vd, cw: cw, ch: ch, st: st };
  }

  // ---------- หน้าต่างดูภาพ ----------
  function open(w, opt) {
    opt = opt || {};
    var scale = opt.scale || 50000, title = opt.title || 'ภาพ 3 มิติ แผนที่สมมุติ';
    var v = { az: 0, tilt: 38, ve: 1.5, labels: true, contours: true, zoom: 1, pinned: false };
    var ov = document.createElement('div');
    ov.id = 'syn3d';
    ov.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#f4f7f9;display:flex;flex-direction:column;font-family:inherit';
    ov.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;padding:calc(env(safe-area-inset-top) + 8px) 12px 8px;background:#fff;border-bottom:1px solid #ddd">' +
      '<b style="flex:1">ภาพ 3 มิติ แผนที่สมมุติ</b><button id="s3Save" class="btn" style="flex:none;padding:8px 12px">บันทึก PNG</button><button id="s3Close" class="btn alt" style="flex:none;padding:8px 12px">ปิด</button></div>' +
      '<div style="flex:1;min-height:0;position:relative"><canvas id="s3Cv" style="width:100%;height:100%;display:block;touch-action:none"></canvas><div id="s3Busy" style="position:absolute;left:12px;bottom:8px;font-size:13px;color:#555"></div></div>' +
      '<div style="padding:8px 12px calc(env(safe-area-inset-bottom) + 8px);background:#fff;border-top:1px solid #ddd;font-size:14px">' +
      '<div class="note" style="margin:0 0 6px">ลากนิ้วหมุน/ก้มเงย · ถ่างสองนิ้วซูม · <b>แตะจุดบนภาพ</b> เพื่อเลือกจุดแล้วหมุนรอบจุดนั้น</div>' +
      row('หมุน', '<input type="range" id="s3Az" min="0" max="359" step="1" style="flex:1"><span id="s3AzV" style="flex:0 0 72px;text-align:right"></span>') +
      row('มุมก้ม', '<input type="range" id="s3Tilt" min="15" max="85" step="1" style="flex:1"><span id="s3TiltV" style="flex:0 0 72px;text-align:right"></span>') +
      row('ซูม', '<button class="btn alt" id="s3ZOut" style="flex:none;padding:4px 14px;font-size:18px">−</button><input type="range" id="s3Zoom" min="1" max="10" step="0.1" style="flex:1"><button class="btn alt" id="s3ZIn" style="flex:none;padding:4px 14px;font-size:18px">+</button><span id="s3ZoomV" style="flex:0 0 46px;text-align:right"></span>') +
      row('ขยายความสูง', '<input type="range" id="s3Ve" min="1" max="4" step="0.5" style="flex:1"><span id="s3VeV" style="flex:0 0 72px;text-align:right"></span>') +
      '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:4px"><label><input type="checkbox" id="s3Lab"> ป้ายลักษณะภูมิประเทศ</label><label><input type="checkbox" id="s3Con"> เส้นชั้นความสูงบนพื้น</label></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"><button class="btn alt" id="s3Reset" style="flex:none;padding:6px 10px;font-size:13px">ดูทั้งแผ่น</button>' + [['มองจากใต้', 0], ['จากตะวันออก', 90], ['จากเหนือ', 180], ['จากตะวันตก', 270]].map(function (d) { return '<button class="btn alt" data-az="' + d[1] + '" style="flex:none;padding:6px 10px;font-size:13px">' + d[0] + '</button>'; }).join('') + '</div>' +
      '</div>';
    function row(label, inner) { return '<div style="display:flex;align-items:center;gap:8px;margin:2px 0"><span style="flex:0 0 86px">' + label + '</span>' + inner + '</div>'; }
    document.body.appendChild(ov);
    var $ = function (id) { return ov.querySelector('#' + id); };
    var cv = $('s3Cv'), tex = null, texCon = null, cellsCache = {};
    function getTex() {
      if (v.contours) { if (!tex) tex = buildTexture(w, scale, true); return tex; }
      if (!texCon) texCon = buildTexture(w, scale, false); return texCon;
    }
    function cellsFor(st) { var key = st + (v.contours ? 'c' : 'n'); if (!cellsCache[key]) cellsCache[key] = cellColors(w, getTex(), st); return cellsCache[key]; }
    function stFor(maxCells) { return Math.max(1, Math.ceil(Math.sqrt(w.nx * w.ny / maxCells))); }
    function sync() {
      $('s3Az').value = v.az; $('s3AzV').textContent = v.az + '°'; $('s3Tilt').value = v.tilt; $('s3TiltV').textContent = v.tilt + '°';
      $('s3Zoom').value = v.zoom; $('s3ZoomV').textContent = v.zoom.toFixed(1) + '×';
      $('s3Ve').value = v.ve; $('s3VeV').textContent = v.ve + ' เท่า'; $('s3Lab').checked = v.labels; $('s3Con').checked = v.contours;
    }
    var pending = 0, fullTimer = 0, frame = null;
    function viewFor(labels, title) { return { az: v.az, tilt: v.tilt, ve: v.ve, labels: labels, title: title, zoom: v.zoom, pinned: v.pinned, cx: v.cx, cy: v.cy }; }
    function draw(quality) {
      var r = cv.getBoundingClientRect(), dpr = Math.min(2, root.devicePixelRatio || 1);
      cv.width = Math.max(200, Math.round(r.width * dpr)); cv.height = Math.max(150, Math.round(r.height * dpr));
      var z2 = v.zoom * v.zoom, st = stFor((quality === 'fast' ? 9000 : 60000) * z2);
      frame = render(cv, w, getTex(), cellsFor(st), st, viewFor(v.labels && quality !== 'fast'));
      frame.dpr = dpr;
    }
    function schedule() {
      if (!pending) pending = requestAnimationFrame(function () { pending = 0; draw('fast'); });
      clearTimeout(fullTimer); fullTimer = setTimeout(function () { draw('full'); }, 260);
    }
    $('s3Az').oninput = function () { v.az = +this.value; sync(); schedule(); };
    $('s3Tilt').oninput = function () { v.tilt = +this.value; sync(); schedule(); };
    $('s3Ve').oninput = function () { v.ve = +this.value; sync(); schedule(); };
    $('s3Lab').onchange = function () { v.labels = this.checked; draw('full'); };
    $('s3Con').onchange = function () { v.contours = this.checked; $('s3Busy').textContent = 'กำลังเตรียม…'; setTimeout(function () { draw('full'); $('s3Busy').textContent = ''; }, 30); };
    Array.prototype.forEach.call(ov.querySelectorAll('[data-az]'), function (b) { b.onclick = function () { v.az = +b.getAttribute('data-az'); sync(); draw('full'); }; });
    // ซูม
    function setZoom(z) { v.zoom = Math.round(Math.max(1, Math.min(10, z)) * 10) / 10; sync(); schedule(); }
    $('s3Zoom').oninput = function () { setZoom(+this.value); };
    $('s3ZIn').onclick = function () { setZoom(v.zoom * 1.4); };
    $('s3ZOut').onclick = function () { setZoom(v.zoom / 1.4); };
    $('s3Reset').onclick = function () { v.zoom = 1; v.pinned = false; v.cx = v.cy = undefined; sync(); draw('full'); };
    cv.addEventListener('wheel', function (e) { e.preventDefault(); setZoom(v.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
    // แตะเลือกจุด: หาจุดบนพื้นผิวที่ใกล้ตำแหน่งแตะและอยู่หน้าสุด
    function pick(clientX, clientY) {
      if (!frame) return;
      var r = cv.getBoundingClientRect(), px = (clientX - r.left) * frame.dpr, py = (clientY - r.top) * frame.dpr, best = -1, bd = -1e18, rad = 18 * frame.dpr;
      for (var q = 0; q < frame.vx.length; q++) { var dx = frame.vx[q] - px, dy = frame.vy[q] - py; if (dx * dx + dy * dy < rad * rad && frame.vd[q] > bd) { bd = frame.vd[q]; best = q; } }
      if (best < 0) return;
      var a = best % (frame.cw + 1), b = (best - a) / (frame.cw + 1);
      v.cx = a * frame.st; v.cy = b * frame.st; v.pinned = true; if (v.zoom < 2.5) v.zoom = 2.5;
      sync(); draw('full');
    }
    // นิ้วเดียวลาก = หมุน/ก้มเงย, สองนิ้ว = ซูม, แตะ = เลือกจุด
    var pts = {}, drag = null, pinch = null;
    function npts() { return Object.keys(pts).length; }
    cv.addEventListener('pointerdown', function (e) {
      pts[e.pointerId] = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId);
      if (npts() === 1) drag = { x: e.clientX, y: e.clientY, az: v.az, tilt: v.tilt, moved: false, t: Date.now() };
      else if (npts() === 2) { var k2 = Object.keys(pts), a1 = pts[k2[0]], b1 = pts[k2[1]]; pinch = { d: Math.hypot(a1.x - b1.x, a1.y - b1.y) || 1, z: v.zoom }; drag = null; }
    });
    cv.addEventListener('pointermove', function (e) {
      if (!pts[e.pointerId]) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (pinch && npts() >= 2) { var k3 = Object.keys(pts), a2 = pts[k3[0]], b2 = pts[k3[1]]; setZoom(pinch.z * (Math.hypot(a2.x - b2.x, a2.y - b2.y) || 1) / pinch.d); return; }
      if (!drag) return;
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 6) drag.moved = true;
      if (!drag.moved) return;
      v.az = Math.round(((drag.az - (e.clientX - drag.x) * 0.4) % 360 + 360) % 360);
      v.tilt = Math.max(15, Math.min(85, Math.round(drag.tilt + (e.clientY - drag.y) * 0.25)));
      sync(); schedule();
    });
    function up(e) {
      var wasTap = drag && !drag.moved && !pinch && Date.now() - drag.t < 600;
      delete pts[e.pointerId];
      if (npts() < 2) pinch = null;
      if (wasTap && e.type === 'pointerup') pick(e.clientX, e.clientY);
      drag = null;
    }
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    function onResize() { draw('full'); }
    root.addEventListener('resize', onResize);
    $('s3Close').onclick = function () { root.removeEventListener('resize', onResize); ov.remove(); };
    $('s3Save').onclick = function () {
      var b = this; b.disabled = true; $('s3Busy').textContent = 'กำลังสร้างภาพ…';
      setTimeout(function () {
        var big = document.createElement('canvas'); big.width = 2600; big.height = 1650;
        var st2 = stFor(220000 * v.zoom * v.zoom);
        render(big, w, getTex(), cellsFor(st2), st2, viewFor(v.labels, title));
        big.toBlob(function (blob) {
          b.disabled = false; $('s3Busy').textContent = '';
          var file = { name: (title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'แผนที่สมมุติ') + '-3มิติ.png', mime: 'image/png', blob: blob };
          if (root.TrailExport) root.TrailExport.share(file).then(function (ok) { if (!ok) root.TrailExport.download(file); });
        }, 'image/png');
      }, 30);
    };
    sync();
    $('s3Busy').textContent = 'กำลังเตรียม…';
    setTimeout(function () { draw('full'); $('s3Busy').textContent = ''; }, 30);
    return { close: function () { $('s3Close').onclick(); }, view: v, redraw: draw };
  }

  root.TrailSyn3D = { open: open, render: render, buildTexture: buildTexture, cellColors: cellColors };
})(typeof window !== 'undefined' ? window : this);
