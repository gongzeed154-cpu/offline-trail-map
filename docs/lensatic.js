// เข็มทิศเลนเซติก (แบบ Cammenga 3H) วางบนแผนที่ตามขนาดจริงที่มาตราส่วน 1:50,000
// วาดเป็นสองภาพ: (1) ตัวเข็มทิศ หมุนตามที่ผู้ใช้หัน (2) หน้าปัด (จานเข็มทิศ) ชี้ทิศเหนือของแผนที่เสมอ
// หน่วยภาพเป็นมิลลิเมตรบนกระดาษ: 1 มม. = 50 ม. บนพื้น · ขอบบนเป็นไม้บรรทัด 1:50,000 ขีดละ 100 ม. ตัวเลข 2000 4000 6000
// แกน: จุดกำเนิดที่ศูนย์กลางหน้าปัด, +x ชี้ไปทางฝาที่มีลวดเล็ง (ทิศที่อ่านมุม), +y ไปทางขวามือของทิศนั้น
(function (root) {
  var M_PER_MM = 50;
  var B = { xmin: -66, xmax: 113, ymin: -33.5, ymax: 28.5 }; // กรอบภาพตัวเข็มทิศ (มม.)
  var DIAL_R = 23.2; // รัศมีช่องกระจก (มม.)
  var CARD_R = 23.0; // รัศมีจานหน้าปัด
  var RULER0 = -24; // ตำแหน่ง 0 ของไม้บรรทัด (มม.) · 6000 ม. = +120 มม.
  var MOVE_AT = { x: -46, y: 0 }; // ที่จับเลื่อน (ขาเลนส์/ห่วงนิ้วโป้งด้านหลัง)
  var ROT_AT = { x: 108, y: -4 }; // ที่จับหมุน (ปลายฝา)
  var SANS = '-apple-system, "Helvetica Neue", Arial, sans-serif';

  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  // ---------- ตัวเข็มทิศ ----------
  function drawBody(s) {
    var W = Math.round((B.xmax - B.xmin) * s), H = Math.round((B.ymax - B.ymin) * s);
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var c = cv.getContext('2d');
    c.translate(-B.xmin * s, -B.ymin * s); c.scale(s, s); // จากนี้ใช้หน่วย มม.
    var OL = '#4a5131', OL_D = '#323722', OL_L = '#6a7249', OL_LL = '#8a9266';
    function metal(x0, y0, x1, y1, a, b) { var g = c.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, a); g.addColorStop(1, b); return g; }
    c.lineJoin = 'round';

    // เงาใต้ตัวเข็มทิศ
    c.save(); c.shadowColor = 'rgba(0,0,0,.45)'; c.shadowBlur = 3 * s; c.shadowOffsetX = 0.8 * s; c.shadowOffsetY = 1.2 * s;
    rr(c, -28, -31.5, 138, 56, 4); c.fillStyle = OL; c.fill();
    c.restore();

    // ขาเลนส์และห่วงสอดนิ้วโป้ง (ด้านหลัง สีดำ) ตามสัดส่วนของจริง
    c.fillStyle = '#15160e'; rr(c, -64, -16.5, 40, 31.5, 6); c.fill();
    c.fillStyle = '#23251a'; rr(c, -61.5, -13.5, 7, 25.5, 3.2); c.fill(); // ห่วงนิ้ว
    c.fillStyle = 'rgba(255,255,255,.07)'; rr(c, -60.5, -11, 2.2, 20, 1.1); c.fill();
    c.fillStyle = '#2b2e20'; rr(c, -31.5, -12.5, 6.5, 24, 1.6); c.fill(); // บานพับขาเลนส์
    c.fillStyle = '#9a9a92'; [[-28.2, -9.5], [-28.2, 8.5]].forEach(function (p) { c.beginPath(); c.arc(p[0], p[1], 0.75, 0, 7); c.fill(); });

    // ตัวฐาน (ส่วนหน้าปัด + ส่วนฝา)
    c.fillStyle = metal(0, -31.5, 0, 24.5, OL_L, OL_D); rr(c, -28, -31.5, 138, 56, 4); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = 0.35; c.stroke();
    // แนวแบ่งสองส่วน
    c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 0.4; c.beginPath(); c.moveTo(29, -31); c.lineTo(29, -23); c.stroke();

    // ---------- ไม้บรรทัด 1:50,000 ที่ขอบบน ----------
    c.fillStyle = metal(0, -31.5, 0, -22, OL_LL, OL); c.fillRect(-27, -31.5, 136, 9);
    c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 0.25; c.beginPath(); c.moveTo(-27, -22.5); c.lineTo(109, -22.5); c.stroke();
    // ขีดทุก 100 ม. (2 มม.) ยาวขึ้นทุก 500 / 1000 ม.
    for (var m = 0; m <= 6400; m += 100) { // ขีดเริ่มที่ขอบบนพอดี
      var x = RULER0 + m / M_PER_MM, L = m % 1000 === 0 ? 4.2 : m % 500 === 0 ? 3.0 : 1.9;
      c.strokeStyle = '#11130b'; c.lineWidth = m % 1000 === 0 ? 0.32 : 0.2;
      c.beginPath(); c.moveTo(x, -31.5); c.lineTo(x, -31.5 + L); c.stroke();
    }
    c.fillStyle = '#e9e4cf'; c.font = '700 3.6px ' + SANS; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    [2000, 4000, 6000].forEach(function (v) { var x = RULER0 + v / M_PER_MM; c.fillText(String(v), x, -23.6); });
    c.font = '700 2.6px ' + SANS; c.fillText('1:50000 METERS', 36, -23.6);
    c.fillStyle = '#11130b'; c.font = '700 2.2px ' + SANS; c.fillText('0', RULER0 + 1.2, -26.6);

    // ---------- บานพับฝา ----------
    c.fillStyle = metal(30, 0, 42, 0, OL_D, OL_L); rr(c, 30, -16, 11, 30, 2); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 0.3; c.stroke();
    c.fillStyle = OL_L; rr(c, 32.5, -13, 6, 7, 1.4); c.fill(); rr(c, 32.5, 6, 6, 7, 1.4); c.fill();
    c.fillStyle = '#b8b8ae'; c.fillRect(31, -8, 9, 12); c.fillStyle = OL; c.fillRect(32, -7, 7, 10);

    // ---------- ฝา (ด้านในมีช่องลวดเล็ง) ----------
    c.save(); c.shadowColor = 'rgba(0,0,0,.35)'; c.shadowBlur = 1.5 * s;
    c.fillStyle = metal(50, -28, 100, 24, OL_L, OL_D);
    c.beginPath(); c.arc(76, -0.5, 27.5, 0, Math.PI * 2); c.fill(); c.restore();
    c.fillStyle = metal(100, -14, 112, 6, OL_L, OL_D); rr(c, 98, -14.5, 14, 22, 3); c.fill(); // ลิ้นปลายฝา
    c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 0.35; c.beginPath(); c.arc(76, -0.5, 27.5, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.12)'; c.lineWidth = 0.6; c.beginPath(); c.arc(76, -0.5, 24.5, Math.PI * 1.05, Math.PI * 1.75); c.stroke();
    // ช่องเล็งและลวดเล็ง (อยู่แนวเดียวกับเส้นอ่านมุม y = 0)
    c.fillStyle = '#d8dad2'; rr(c, 62, -2.6, 30, 5.2, 2.6); c.fill();
    c.strokeStyle = '#3a3f2a'; c.lineWidth = 0.5; c.stroke();
    c.strokeStyle = '#1b1d14'; c.lineWidth = 0.35; c.beginPath(); c.moveTo(56, 0); c.lineTo(98, 0); c.stroke();
    c.fillStyle = '#e8e8e0'; [[58, 0], [96, 0]].forEach(function (p) { c.beginPath(); c.arc(p[0], p[1], 0.9, 0, 7); c.fill(); });
    c.fillStyle = '#1a1c12'; c.beginPath(); c.arc(104, 8, 1.8, 0, 7); c.fill(); // หมุดล็อคฝา

    // ---------- ขอบหน้าปัด (วงแหวนหยัก) ----------
    c.save(); c.shadowColor = 'rgba(0,0,0,.4)'; c.shadowBlur = 1.2 * s;
    c.fillStyle = '#16170f'; c.beginPath(); c.arc(0, 0, 27.2, 0, Math.PI * 2); c.fill(); c.restore();
    c.strokeStyle = '#3a3c30'; c.lineWidth = 0.25;
    for (var k = 0; k < 120; k++) { var a = k * Math.PI / 60; c.beginPath(); c.moveTo(Math.cos(a) * 25.4, Math.sin(a) * 25.4); c.lineTo(Math.cos(a) * 27.1, Math.sin(a) * 27.1); c.stroke(); }
    c.fillStyle = '#2b2d22'; c.beginPath(); c.arc(0, 0, 25.3, 0, Math.PI * 2); c.fill();
    // ช่องกระจก: เจาะโปร่งให้เห็นจานหน้าปัดด้านล่าง
    c.save(); c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.arc(0, 0, DIAL_R, 0, Math.PI * 2); c.fill(); c.restore();
    // แสงสะท้อนกระจก
    var gl = c.createLinearGradient(-20, -20, 20, 20); gl.addColorStop(0, 'rgba(255,255,255,.16)'); gl.addColorStop(0.45, 'rgba(255,255,255,0)'); gl.addColorStop(1, 'rgba(255,255,255,.05)');
    c.fillStyle = gl; c.beginPath(); c.arc(0, 0, DIAL_R, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 0.35; c.beginPath(); c.arc(0, 0, DIAL_R, 0, Math.PI * 2); c.stroke();
    // เส้นอ่านมุมสีดำบนกระจก (ชี้ไปทางลวดเล็ง)
    c.strokeStyle = '#000'; c.lineWidth = 0.42; c.beginPath(); c.moveTo(3.2, 0); c.lineTo(DIAL_R, 0); c.stroke();
    c.fillStyle = '#000'; c.beginPath(); c.moveTo(DIAL_R - 0.2, 0); c.lineTo(DIAL_R - 3, -1.1); c.lineTo(DIAL_R - 3, 1.1); c.closePath(); c.fill();
    // ขีดอ้างอิงบนกระจก (ตามรูปจริงมีเส้นสั้นที่ขอบ)
    c.strokeStyle = 'rgba(40,40,40,.7)'; c.lineWidth = 0.35; c.beginPath(); c.moveTo(0, -DIAL_R); c.lineTo(0, -DIAL_R + 3.5); c.stroke();
    // แกนกลางเข็ม (กระจกนูน)
    c.fillStyle = 'rgba(210,214,206,.55)'; c.beginPath(); c.arc(0, 0, 3, 0, 7); c.fill();
    c.strokeStyle = 'rgba(80,80,80,.6)'; c.lineWidth = 0.3; c.stroke();
    return { canvas: cv, bounds: B };
  }

  // ---------- จานหน้าปัด (ทิศเหนือขึ้นด้านบนของภาพ) ----------
  function drawCard(s) {
    var R = CARD_R, size = Math.round(2 * R * s);
    var cv = document.createElement('canvas'); cv.width = cv.height = size;
    var c = cv.getContext('2d');
    c.translate(size / 2, size / 2); c.scale(s, s);
    var g = c.createRadialGradient(0, 0, 2, 0, 0, R); g.addColorStop(0, '#f4f4f1'); g.addColorStop(1, '#dcdcd6');
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.fill();
    function polar(deg, r) { var a = (deg - 90) * Math.PI / 180; return [Math.cos(a) * r, Math.sin(a) * r]; }
    function tick(deg, r0, r1, w, col) { var p = polar(deg, r0), q = polar(deg, r1); c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); c.stroke(); }
    function label(deg, r, txt, font, col) { c.save(); c.rotate(deg * Math.PI / 180); c.translate(0, -r); c.font = font; c.fillStyle = col; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, 0, 0); c.restore(); }
    // สเกลมิล (สีดำ ด้านนอก): ขีดทุก 20 มิล ตัวเลขทุก 200 มิล (2 … 64)
    for (var ml = 0; ml < 6400; ml += 20) {
      var dg = ml * 360 / 6400, big = ml % 200 === 0, mid = ml % 100 === 0;
      tick(dg, R - (big ? 2.4 : mid ? 1.7 : 1.1), R - 0.15, big ? 0.22 : 0.12, '#111');
      if (big) label(dg, R - 3.9, String(ml === 0 ? 64 : ml / 100), '700 2.15px ' + SANS, '#111');
    }
    // สเกลองศา (สีแดง ด้านใน): ขีดทุก 5° ตัวเลขทุก 20°
    for (var d = 0; d < 360; d += 5) {
      var b2 = d % 20 === 0;
      tick(d, R - 6.2 - (b2 ? 1.8 : d % 10 === 0 ? 1.2 : 0.7), R - 6.0, b2 ? 0.24 : 0.14, '#c8102e');
      if (b2 && d % 90 !== 0) label(d, R - 9.6, String(d), '700 2.1px ' + SANS, '#c8102e');
    }
    // อักษรทิศ ลูกศรเหนือ และเข็ม
    label(90, 11.2, 'E', '900 4.2px ' + SANS, '#111');
    label(270, 11.2, 'W', '900 4.2px ' + SANS, '#111');
    label(180, 11.2, 'S', '900 3.6px ' + SANS, '#111');
    // กรอบสี่เหลี่ยมใสรอบตัวอักษร (เหมือนของจริง)
    c.strokeStyle = 'rgba(150,150,150,.6)'; c.lineWidth = 0.2;
    [90, 270].forEach(function (dg2) { c.save(); c.rotate(dg2 * Math.PI / 180); c.strokeRect(-3, -14.2, 6, 6); c.restore(); });
    // ลูกศรเหนือ (สามเหลี่ยมดำ ขอบเรืองแสง)
    c.fillStyle = '#0d0d0d'; c.beginPath(); c.moveTo(0, -16.2); c.lineTo(3.6, -8.6); c.lineTo(-3.6, -8.6); c.closePath(); c.fill();
    c.strokeStyle = '#cfe9c8'; c.lineWidth = 0.35; c.stroke();
    c.strokeStyle = '#e8f5e0'; c.lineWidth = 0.7; c.beginPath(); c.moveTo(0, -14.2); c.lineTo(0, -10); c.stroke();
    // เข็มแม่เหล็ก (แท่งสีเทาตามแนวเหนือ-ใต้)
    var ng = c.createLinearGradient(-1.4, 0, 1.4, 0); ng.addColorStop(0, '#6f726c'); ng.addColorStop(0.5, '#b9bcb5'); ng.addColorStop(1, '#5d605a');
    c.fillStyle = ng; rr(c, -1.3, -8, 2.6, 17, 0.8); c.fill();
    c.fillStyle = '#9aa29a'; c.beginPath(); c.arc(0, 0, 2.2, 0, 7); c.fill();
    c.fillStyle = '#e1e3dc'; c.beginPath(); c.arc(0, 0, 1, 0, 7); c.fill();
    // ขอบจาน
    c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 0.25; c.beginPath(); c.arc(0, 0, R - 0.1, 0, Math.PI * 2); c.stroke();
    // นอกวงกลมให้โปร่ง
    c.globalCompositeOperation = 'destination-in'; c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.fill();
    return { canvas: cv, radius: R };
  }

  root.TrailLens = { M_PER_MM: M_PER_MM, BODY: B, CARD_R: CARD_R, RULER0: RULER0, MOVE_AT: MOVE_AT, ROT_AT: ROT_AT, drawBody: drawBody, drawCard: drawCard };
})(typeof self !== 'undefined' ? self : this);
