// เซนเซอร์: ตำแหน่ง GPS ล่าสุด + เข็มทิศ/มุมเงยของเครื่อง (ใช้ร่วมกันทั้งแอพ)
(function (root) {
  var G = TrailGeo;
  var S = {
    fix: null, // { lat, lng, alt, altAcc, acc, speed, heading, t }
    head: null, // ทิศที่ด้านหลังเครื่องหัน (แม่เหล็ก, องศา)
    headAcc: null,
    pitch: null, // มุมเงยของแกนกล้อง (องศา, ขึ้นเป็นบวก)
    decl: function () { return 0; },
    offset: function () { return 0; }
  };
  var listeners = [];
  var started = false;

  function norm180(a) { a = G.norm360(a); return a > 180 ? a - 360 : a; }
  function smooth(old, val, k) { return old === null ? val : G.norm360(old + k * norm180(val - old)); }

  function setFix(f) {
    S.fix = f;
    listeners.forEach(function (cb) { try { cb(f); } catch (e) { /* ไม่ให้ตัวฟังตัวเดียวทำให้ล้ม */ } });
  }
  function onFix(cb) { listeners.push(cb); }

  function onOrient(e) {
    var h = null;
    if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) {
      h = e.webkitCompassHeading;
      S.headAcc = typeof e.webkitCompassAccuracy === 'number' ? e.webkitCompassAccuracy : null;
    } else if (e.absolute && e.alpha !== null && e.beta !== null && e.gamma !== null) {
      // ทิศของแกนกล้อง (-z) ตามสูตรในมาตรฐาน W3C
      var a = e.alpha * G.D2R, b = e.beta * G.D2R, g = e.gamma * G.D2R;
      var vx = -Math.cos(a) * Math.sin(g) - Math.sin(a) * Math.sin(b) * Math.cos(g);
      var vy = -Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.sin(b) * Math.cos(g);
      h = G.norm360(Math.atan2(vx, vy) * G.R2D);
    }
    if (h !== null) S.head = smooth(S.head, h, 0.3);
    if (e.beta !== null && e.gamma !== null && e.beta !== undefined) {
      var el = Math.asin(Math.max(-1, Math.min(1, -Math.cos(e.beta * G.D2R) * Math.cos(e.gamma * G.D2R)))) * G.R2D;
      S.pitch = S.pitch === null ? el : S.pitch + 0.3 * (el - S.pitch);
    }
  }

  // เริ่มอ่านเซนเซอร์ (บน iOS ต้องเรียกจากการแตะของผู้ใช้) คืน true ถ้าได้สิทธิ์
  function start() {
    if (started) return Promise.resolve(true);
    var ask = Promise.resolve('granted');
    try {
      if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') ask = DeviceOrientationEvent.requestPermission();
    } catch (e) { ask = Promise.resolve('denied'); }
    return ask.then(function (r) {
      if (r !== 'granted') return false;
      window.addEventListener('deviceorientation', onOrient, true);
      window.addEventListener('deviceorientationabsolute', onOrient, true);
      started = true;
      return true;
    }).catch(function () { return false; });
  }

  // ทิศเหนือจริงที่เครื่องหัน (รวมมุมเบี่ยงเบนแม่เหล็กและค่าปรับแก้)
  function headingTrue() {
    return S.head === null ? null : G.norm360(S.head + S.decl() + S.offset());
  }

  // ทิศการเคลื่อนที่: ใช้ทิศจาก GPS ถ้าเดินอยู่ ไม่เช่นนั้นใช้เข็มทิศ
  function moveHeading() {
    var f = S.fix;
    if (f && typeof f.speed === 'number' && f.speed > 1 && typeof f.heading === 'number' && !isNaN(f.heading)) return f.heading;
    return headingTrue();
  }

  root.TrailSensors = {
    state: S,
    setFix: setFix,
    onFix: onFix,
    start: start,
    headingTrue: headingTrue,
    moveHeading: moveHeading,
    isStarted: function () { return started; }
  };
})(typeof self !== 'undefined' ? self : this);
