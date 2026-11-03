// สิทธิ์เข้าใช้แอพรายคน: ผู้ใช้ใส่รหัสของตัวเองครั้งเดียว แอพตรวจกับไฟล์ access.json (เก็บเฉพาะค่าแฮชของรหัส)
// เจ้าของเปิด/ปิดสิทธิ์รายคนได้โดยแก้ "enabled" ใน docs/access.json (ดูขั้นตอนใน README)
// หมายเหตุ: เป็นการกั้นที่หน้าจอ ไม่ใช่ระบบรักษาความปลอดภัยเต็มรูปแบบ เพราะโค้ดแอพเป็นสาธารณะ
// ปิดสิทธิ์มีผลเมื่อเครื่องนั้นต่อเน็ต (ออฟไลน์ใช้ต่อได้ไม่เกิน graceDays วันนับจากครั้งสุดท้ายที่ตรวจผ่าน)
(function (root) {
  var AKEY = 'trail_access_v1'; // { hash, name, checkedAt }
  var PKEY = 'trail_access_policy_v1'; // นโยบายล่าสุดที่ดึงได้ (ใช้ graceDays ตอนออฟไลน์)
  var POLL_MS = 30 * 60 * 1000;
  var DEFAULT_GRACE_DAYS = 30;
  var gate = null;
  var checking = false;

  function $(id) { return document.getElementById(id); }
  function norm(code) { return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function sha256Hex(s) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
    });
  }
  function load(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
  function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* ไม่เป็นไร */ } }

  function fetchPolicy() {
    var ctl = new AbortController();
    var to = setTimeout(function () { ctl.abort(); }, 6000);
    return fetch('./access.json', { cache: 'no-store', signal: ctl.signal }).then(function (r) {
      clearTimeout(to);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).catch(function (e) { clearTimeout(to); throw e; });
  }

  // คืน { ok, reason, message, name }
  function evaluate(policy, auth) {
    if (!policy || !policy.required) return { ok: true };
    var users = policy.users || [];
    var u = auth && users.filter(function (x) { return x.hash === auth.hash; })[0];
    if (u && u.owner && u.enabled !== false) return { ok: true, name: u.name }; // เจ้าของผ่านเสมอ แม้ปิดทั้งหมด
    if (policy.enabled === false) return { ok: false, reason: 'closed', message: policy.message };
    if (!auth) return { ok: false, reason: 'need-code' };
    if (!u) return { ok: false, reason: 'unknown', message: 'รหัสนี้ถูกถอนสิทธิ์แล้ว' };
    if (u.enabled === false) return { ok: false, reason: 'disabled', message: policy.message };
    return { ok: true, name: u.name };
  }

  /* ---------- หน้าจอล็อค ---------- */
  function showGate(msg, canEnter) {
    if (!gate) {
      gate = document.createElement('div');
      gate.id = 'gate';
      gate.style.cssText = 'position:fixed;inset:0;z-index:500;background:#f3f1e8;display:flex;align-items:center;justify-content:center;padding:24px;font-family:-apple-system,"Sarabun","Noto Sans Thai",sans-serif;color:#222';
      gate.innerHTML = '<div style="max-width:360px;width:100%;text-align:center">' +
        '<div style="font-size:42px">🗺️</div>' +
        '<h2 style="margin:8px 0 4px">แผนที่เดินป่าออฟไลน์</h2>' +
        '<p id="gateMsg" style="margin:8px 0 16px;line-height:1.6"></p>' +
        '<div id="gateForm"><input id="gateCode" type="text" autocapitalize="characters" autocorrect="off" autocomplete="off" spellcheck="false" placeholder="รหัสเข้าใช้งาน" ' +
        'style="width:100%;box-sizing:border-box;font-size:22px;letter-spacing:4px;text-align:center;padding:12px;border:1px solid #bbb;border-radius:10px">' +
        '<button id="gateGo" style="margin-top:12px;width:100%;padding:14px;border:0;border-radius:24px;background:#2e6b3f;color:#fff;font-size:16px;font-weight:600">ยืนยัน</button></div>' +
        '<button id="gateRetry" style="margin-top:12px;width:100%;padding:12px;border:1px solid #2e6b3f;border-radius:24px;background:#fff;color:#2e6b3f;font-size:15px" hidden>ตรวจสอบอีกครั้ง</button>' +
        '<p style="margin-top:18px;font-size:12px;color:#888">รหัสได้จากเจ้าของแอพ ต้องต่อเน็ตเพื่อยืนยันครั้งแรก</p></div>';
      document.body.appendChild(gate);
      $('gateGo').onclick = submit;
      $('gateCode').onkeydown = function (e) { if (e.key === 'Enter') submit(); };
      $('gateRetry').onclick = function () { check(true); };
    }
    gate.hidden = false;
    $('gateMsg').textContent = msg;
    $('gateForm').hidden = !canEnter;
    $('gateRetry').hidden = canEnter;
    $('gateGo').disabled = false;
  }
  function hideGate() { if (gate) gate.hidden = true; }

  function submit() {
    var code = norm($('gateCode').value);
    if (code.length < 8) { $('gateMsg').textContent = 'กรุณาใส่รหัสให้ครบ'; return; }
    $('gateGo').disabled = true;
    $('gateMsg').textContent = 'กำลังตรวจสอบ…';
    Promise.all([sha256Hex(code), fetchPolicy()]).then(function (r) {
      var res = evaluate(r[1], { hash: r[0] });
      if (res.ok) {
        save(AKEY, { hash: r[0], name: res.name || '', checkedAt: Date.now() });
        save(PKEY, { graceDays: r[1].graceDays });
        hideGate();
      } else if (res.reason === 'unknown' || res.reason === 'need-code') {
        $('gateMsg').textContent = 'รหัสไม่ถูกต้อง ตรวจสอบแล้วลองใหม่';
        $('gateGo').disabled = false;
      } else {
        showGate(res.message || 'ปิดใช้งานชั่วคราว', true);
      }
    }).catch(function () {
      $('gateMsg').textContent = 'ต่อเซิร์ฟเวอร์ไม่ได้ กรุณาต่ออินเทอร์เน็ตแล้วลองใหม่';
      $('gateGo').disabled = false;
    });
  }

  /* ---------- ตรวจสิทธิ์ ---------- */
  function withinGrace(auth) {
    var p = load(PKEY), days = p && p.graceDays > 0 ? p.graceDays : DEFAULT_GRACE_DAYS;
    return !!auth && Date.now() - auth.checkedAt <= days * 86400000;
  }

  function check(manual) {
    if (checking) return;
    checking = true;
    var auth = load(AKEY);
    fetchPolicy().then(function (policy) {
      checking = false;
      var p = load(PKEY) || {};
      p.graceDays = policy.graceDays;
      save(PKEY, p);
      var res = evaluate(policy, auth);
      if (res.ok) {
        if (auth && policy.required) { auth.checkedAt = Date.now(); auth.name = res.name || auth.name; save(AKEY, auth); }
        hideGate();
      } else if (res.reason === 'need-code' || res.reason === 'unknown') {
        showGate(res.message || 'กรุณาใส่รหัสเข้าใช้งาน', true);
      } else {
        showGate(res.message || 'ปิดใช้งานชั่วคราว', false); // ปิดสิทธิ์: รอตรวจใหม่ ไม่ต้องใส่รหัสซ้ำเมื่อเปิดสิทธิ์กลับ
      }
    }).catch(function () {
      checking = false;
      // ออฟไลน์: ใช้ต่อได้ถ้าเคยตรวจผ่านภายใน graceDays วัน
      if (withinGrace(auth)) hideGate();
      else showGate(auth ? 'ต้องต่ออินเทอร์เน็ตเพื่อตรวจสอบสิทธิ์ (ไม่ได้ตรวจนานเกินกำหนด)' : 'ต้องต่ออินเทอร์เน็ตเพื่อยืนยันรหัสครั้งแรก', !auth);
    });
  }

  function start() {
    var auth = load(AKEY);
    // ถ้าเคยตรวจผ่านและยังอยู่ในกำหนด ให้ใช้งานได้ทันที แล้วตรวจเบื้องหลัง ไม่เช่นนั้นกั้นไว้ก่อนจนกว่าจะรู้ผล
    if (!withinGrace(auth)) showGate('กำลังตรวจสอบสิทธิ์…', false);
    if (gate && !auth) { $('gateRetry').hidden = true; }
    check();
    setInterval(check, POLL_MS);
    window.addEventListener('online', function () { check(); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') check(); });
  }

  root.TrailAccess = { start: start, check: function () { check(true); }, evaluate: evaluate };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(typeof self !== 'undefined' ? self : this);
