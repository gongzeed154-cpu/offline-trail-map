// แผ่นวัดมุมสี่เหลี่ยม 1:50,000 (Military Triangle Scale Protractor)
// พอร์ตมาจาก drawPlate ใน landnav (src/core.js) ใช้หน่วยเมตรบนพื้นดินเหมือนเดิม
// วาดลง canvas แล้วนำไปวางบนแผนที่เป็นรูปภาพ 5,000 × 5,000 ม. (= 100 มม. ที่มาตราส่วน 1:50,000)
(function (root) {
  var H = 2500; // ครึ่งด้านของแผ่น (เมตร)
  var ROMER = { x: -440, y: 1500 }; // มุมสเกล 1000 ม. (อ่านพิกัดกริด)
  var SIXTY = { x: 1870, y: -250, len: 1843 }; // มุมสเกล 60 ฟิลิปดา (อ่านพิกัดภูมิศาสตร์)

  // จุดอ้างอิงที่ใช้ปักกับหมุด A: ระยะจากศูนย์กลางแผ่น (เมตร)
  var ANCHORS = {
    center: { x: 0, y: 0 },
    romer: ROMER,
    sixty: { x: SIXTY.x, y: SIXTY.y }
  };

  function draw(size) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = size;
    var c = cv.getContext('2d');
    var s = size / (2 * H); // พิกเซลต่อเมตร
    var k = s / 0.16; // ตัวคูณความหนาเส้น
    var MONO = 'ui-monospace, Menlo, monospace';
    var SANS = '-apple-system, "Sarabun", "Noto Sans Thai", sans-serif';

    function X(x) { return size / 2 + x * s; }
    function Y(y) { return size / 2 - y * s; }
    function line(x1, y1, x2, y2, w) {
      c.lineWidth = (w || 1) * k;
      c.beginPath();
      c.moveTo(X(x1), Y(y1));
      c.lineTo(X(x2), Y(y2));
      c.stroke();
    }
    function txt(t, dx, dy, sz, o) {
      o = o || {};
      c.save();
      c.translate(X(dx), Y(dy));
      if (o.rot) c.rotate(o.rot);
      c.font = (o.w || '600') + ' ' + (sz * s).toFixed(1) + 'px ' + (o.f || SANS);
      c.textAlign = o.al || 'center';
      c.textBaseline = 'middle';
      c.fillStyle = '#0d0d0d';
      c.fillText(t, 0, 0);
      c.restore();
    }
    function dot(x, y, color) {
      c.fillStyle = color;
      c.beginPath();
      c.arc(X(x), Y(y), 2.5 * k, 0, 7);
      c.fill();
    }

    c.fillStyle = 'rgba(255,255,255,0.40)';
    c.fillRect(0, 0, size, size);
    c.strokeStyle = 'rgba(0,0,0,0.85)';
    c.lineWidth = 1.3 * k;
    c.strokeRect(0, 0, size, size);
    c.strokeStyle = '#0d0d0d';

    // สเกลองศารอบขอบ (ทุก 1°, ตัวเลขทุก 5°)
    for (var d = 0; d < 360; d++) {
      var a = (d * Math.PI) / 180, sn = Math.sin(a), cs = Math.cos(a);
      var m = Math.max(Math.abs(sn), Math.abs(cs));
      var t = H / m;
      var L = d % 5 === 0 ? 120 : 65;
      var ti = t - L / m;
      line(sn * t, cs * t, sn * ti, cs * ti, d % 5 === 0 ? 1.2 : 0.7);
      if (d % 5 === 0) {
        var tl = t - 205 / m;
        var rot = 0;
        if (Math.abs(sn) > Math.abs(cs)) rot = sn > 0 ? Math.PI / 2 : -Math.PI / 2;
        else if (cs < 0) rot = Math.PI;
        if (Math.abs(Math.abs(sn) - Math.abs(cs)) < 0.02) rot = Math.atan2(sn, cs);
        txt(String(d), sn * tl, cs * tl, 82, { rot: rot, f: MONO, w: d % 10 === 0 ? '600' : '500' });
      }
    }

    // แกน N-S, E-W
    line(0, 1900, 0, -1250, 2.4);
    line(-1290, 0, 1290, 0, 2.4);
    c.fillStyle = '#0d0d0d';
    c.beginPath();
    c.moveTo(X(0), Y(1900) - 70 * s);
    c.lineTo(X(0) - 70 * s * 0.55, Y(1900) + 70 * s * 0.4);
    c.lineTo(X(0) + 70 * s * 0.55, Y(1900) + 70 * s * 0.4);
    c.closePath();
    c.fill();
    c.beginPath();
    c.moveTo(X(0), Y(-1250) - 55 * s);
    c.lineTo(X(0) + 55 * s * 0.7, Y(-1250));
    c.lineTo(X(0), Y(-1250) + 55 * s);
    c.lineTo(X(0) - 55 * s * 0.7, Y(-1250));
    c.closePath();
    c.fill();
    txt('N', 0, 2070, 230, { w: '700' });
    txt('S', 0, -1450, 230, { w: '700' });
    txt('W', -1480, 0, 230, { w: '700' });
    txt('E', 1470, 120, 230, { w: '700' });

    // ไม้บรรทัด 0-4000 ม. ด้านซ้าย (ทุก 100 ม., ตัวเลขทุก 500 ม.)
    var bx = -1985, by0 = -2050, mm;
    line(bx, by0, bx, by0 + 4000, 3.5);
    for (mm = 0; mm <= 4000; mm += 100) {
      var big = mm % 500 === 0;
      line(bx, by0 + mm, bx + (big ? 210 : 110), by0 + mm, big ? 1.3 : 0.8);
      if (big) txt(String(mm), bx + 330, by0 + mm, 95, { rot: -Math.PI / 2, f: MONO });
    }
    txt('1', -1050, 600, 110, { w: '700', f: 'serif' });
    line(-1270, 480, -830, 480, 1.2);
    txt('50,000', -1050, 360, 110, { w: '700', f: 'serif' });
    txt('METERS', -1050, 180, 100, { w: '700', f: 'serif' });

    // สเกล 1000 ม. (ทุก 10 ม.) รูปตัว L ที่มุม ROMER
    line(ROMER.x - 1000, ROMER.y, ROMER.x, ROMER.y, 1.4);
    line(ROMER.x, ROMER.y, ROMER.x, ROMER.y - 1000, 1.4);
    for (mm = 0; mm <= 1000; mm += 10) {
      var bg = mm % 100 === 0, md = mm % 50 === 0;
      var len = bg ? 70 : md ? 45 : 25;
      line(ROMER.x - mm, ROMER.y, ROMER.x - mm, ROMER.y - len, bg ? 1.1 : 0.6);
      line(ROMER.x, ROMER.y - mm, ROMER.x + len, ROMER.y - mm, bg ? 1.1 : 0.6);
      if (bg) {
        var lab = mm === 1000 ? '1000' : String(mm / 100);
        txt(lab, ROMER.x - mm, ROMER.y + 70, 60, { f: MONO });
        txt(lab, ROMER.x + (mm === 1000 ? 150 : 110), ROMER.y - mm, 60, { f: MONO });
      }
    }
    dot(ROMER.x, ROMER.y, '#d6261c');

    // สเกล 60 ฟิลิปดา (1 ลิปดา = 1843 ม. ที่ 1:50,000)
    var st = SIXTY.len / 60, i;
    line(SIXTY.x - SIXTY.len, SIXTY.y, SIXTY.x, SIXTY.y, 1.4);
    line(SIXTY.x, SIXTY.y, SIXTY.x, SIXTY.y - SIXTY.len, 1.4);
    for (i = 0; i <= 60; i++) {
      var b10 = i % 10 === 0, b5 = i % 5 === 0;
      var l2 = b10 ? 150 : b5 ? 110 : 60;
      line(SIXTY.x - i * st, SIXTY.y, SIXTY.x - i * st, SIXTY.y + l2, b10 ? 1.2 : 0.7);
      line(SIXTY.x, SIXTY.y - i * st, SIXTY.x + l2, SIXTY.y - i * st, b10 ? 1.2 : 0.7);
      if (b10) {
        txt(String(i), SIXTY.x - i * st, SIXTY.y + 250, 95, { f: MONO });
        txt(String(i), SIXTY.x + 250, SIXTY.y - i * st, 95, { f: MONO, rot: Math.PI / 2 });
      }
    }
    dot(SIXTY.x, SIXTY.y, '#1f6fd6');

    txt('ช่องวัดค่า', 870, -1100, 85, { w: '500' });
    txt('1 ลิปดา เป็น 60 ฟิลิปดา', 870, -1260, 85, { w: '500' });
    txt('1:50,000', 870, -1420, 85, { w: '500' });
    txt('MILITARY TRIANGLE', 1150, 1180, 105, { w: '700' });
    txt('SCALE PROTRACTOR', 1150, 1010, 105, { w: '700' });
    txt('แผ่นวัดมุม 1:50,000', 1150, 820, 90, { w: '500' });

    dot(0, 0, '#0d0d0d');
    return cv;
  }

  root.TrailPlate = { SIDE: 2 * H, ANCHORS: ANCHORS, draw: draw };
})(typeof self !== 'undefined' ? self : this);
