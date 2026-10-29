// ล็อคการขยับ: เมื่อล็อค หมุดและสัญลักษณ์ที่ปักไว้จะลากไม่ได้ (กันมือไปโดนแล้วจุดเลื่อน) ค่าเริ่มต้นคือล็อค จำค่าไว้ในเครื่อง
(function (root) {
  var KEY = 'trail_lock_v1';
  var locked = true;
  var markers = [];
  var cbs = [];
  try { if (localStorage.getItem(KEY) === '0') locked = false; } catch (e) { /* ใช้ค่าเริ่มต้น */ }

  function sync() {
    markers = markers.filter(function (m) { var el = m.getElement && m.getElement(); return el && el.isConnected; });
    markers.forEach(function (m) { m.setDraggable(!locked); });
  }

  root.TrailLock = {
    locked: function () { return locked; },
    // ลงทะเบียนมาร์กเกอร์ที่ลากได้ ให้ปรับตามสถานะล็อคอัตโนมัติ
    register: function (m) { markers.push(m); m.setDraggable(!locked); return m; },
    set: function (v) {
      locked = !!v;
      try { localStorage.setItem(KEY, locked ? '1' : '0'); } catch (e) { /* ไม่เป็นไร */ }
      sync();
      cbs.forEach(function (cb) { try { cb(locked); } catch (e) { /* ไม่ให้ตัวฟังตัวเดียวทำให้ล้ม */ } });
    },
    onChange: function (cb) { cbs.push(cb); }
  };
})(typeof self !== 'undefined' ? self : this);
