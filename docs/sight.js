// เข็มทิศเล็ง (แบบเลนเซติก) ผ่านกล้อง: ถือเครื่องตั้งขึ้น เล็งผ่านช่องเล็งและลวดเล็งไปที่เป้า อ่านหน้าปัดผ่านเลนส์
// ทิศมาจากเข็มทิศของเครื่อง (TrailSensors.state.head = ทิศแม่เหล็กของแกนกล้องหลัง) · ใช้ได้ออฟไลน์
(function (root) {
  var ctx = null, ui = null, raf = 0, stream = null, emb = null; // emb = ฝังในมุมมอง 3D { getTrue, getPos, onClose }
  var st = { km: 5, lock: null, target: null, practice: null, night: false, ref: 'mag', log: [] };
  var DIRS = ['เหนือ', 'เหนือค่อนตะวันออก', 'ตะวันออกเฉียงเหนือ', 'ตะวันออกค่อนเหนือ', 'ตะวันออก', 'ตะวันออกค่อนใต้', 'ตะวันออกเฉียงใต้', 'ใต้ค่อนตะวันออก', 'ใต้', 'ใต้ค่อนตะวันตก', 'ตะวันตกเฉียงใต้', 'ตะวันตกค่อนใต้', 'ตะวันตก', 'ตะวันตกค่อนเหนือ', 'ตะวันตกเฉียงเหนือ', 'เหนือค่อนตะวันตก'];

  function $(id) { return document.getElementById(id); }
  function n360(a) { a %= 360; return a < 0 ? a + 360 : a; }
  function d180(a) { a = n360(a); return a > 180 ? a - 360 : a; }
  function decl() { return ctx && ctx.getDecl ? +ctx.getDecl() || 0 : 0; }
  // มุมที่แสดง: แม่เหล็ก (ตรงกับเข็มทิศจริง) หรือเหนือจริง
  function reading() {
    if (emb) { var t = emb.getTrue(); if (t === null || isNaN(t)) return null; return st.ref === 'true' ? n360(t) : n360(t - decl()); }
    var S = root.TrailSensors && TrailSensors.state;
    if (!S || S.head === null) return null;
    var off = S.offset ? +S.offset() || 0 : 0, mag = n360(S.head + off);
    return st.ref === 'true' ? n360(mag + decl()) : mag;
  }
  function init(c) { ctx = c; }

  // ---------- ตัวเข็มทิศ (SVG ตั้งตรง ฝาอยู่ด้านบน) ----------
  function bodySvg() {
    var tick = '', i;
    for (i = 0; i <= 30; i++) { var y = 30 + i * 13.3, L = i % 5 === 0 ? 16 : 9; tick += '<line x1="2" y1="' + y + '" x2="' + (2 + L) + '" y2="' + y + '" stroke="#111" stroke-width="' + (i % 5 === 0 ? 2 : 1.2) + '"/>'; }
    return '<svg viewBox="0 0 300 560" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="display:block">' +
      '<defs><linearGradient id="sgOl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6c7a3f"/><stop offset="1" stop-color="#3e4a22"/></linearGradient>' +
      '<radialGradient id="sgBlk" cx=".4" cy=".3" r=".8"><stop offset="0" stop-color="#2a2a2a"/><stop offset="1" stop-color="#050505"/></radialGradient></defs>' +
      // ไม้บรรทัดด้านซ้าย
      '<g transform="translate(6,60)"><rect x="0" y="0" width="30" height="430" rx="4" fill="url(#sgOl)" stroke="#20260f" stroke-width="2"/>' + tick +
      '<text x="24" y="250" font-size="11" font-weight="700" fill="#e8e3c8" transform="rotate(-90 24 250)">4000</text><text x="24" y="70" font-size="11" font-weight="700" fill="#e8e3c8" transform="rotate(-90 24 70)">6000</text></g>' +
      // ฝาและลวดเล็ง
      // แถบปลายฝา (ศูนย์หน้า) มีร่องบาก ตัวนูน U.S. และห่วงยึดลวดเล็ง
      '<path d="M112 12 q0-8 8-8 h18 l6 14 h12 l6-14 h18 q8 0 8 8 v72 h-76 z" fill="url(#sgOl)" stroke="#20260f" stroke-width="2"/>' +
      '<text x="150" y="40" text-anchor="middle" font-size="15" font-weight="800" fill="#4a5729" stroke="#2f3a17" stroke-width=".6" letter-spacing="3">U.S.</text>' +
      // ฝาวงกลม เจาะช่องเล็งโปร่ง (มองทะลุไปเห็นภูมิประเทศจริง)
      '<path fill-rule="evenodd" d="M40 210 a110 110 0 0 1 220 0 v40 h-220 z M137 118 h26 v176 h-26 z" fill="url(#sgOl)" stroke="#20260f" stroke-width="2"/>' +
      '<rect x="137" y="118" width="26" height="176" rx="13" fill="none" stroke="#c9cdbd" stroke-width="3"/>' +
      '<path d="M105 182 q8-10 14 2 q-2 10-12 6 z" fill="#1d2b3a"/><path d="M195 182 q-8-10-14 2 q2 10 12 6 z" fill="#1d2b3a"/>' +
      '<circle cx="150" cy="210" r="96" fill="none" stroke="#2f3a17" stroke-width="3" opacity=".6"/>' +
      '<circle cx="150" cy="70" r="5" fill="none" stroke="#111" stroke-width="1.6"/>' +
      '<line x1="150" y1="75" x2="150" y2="292" stroke="#111" stroke-width="1.3"/>' +
      // ตัวฐานสีเขียวด้านล่าง
      '<rect x="30" y="300" width="240" height="250" rx="22" fill="url(#sgOl)" stroke="#20260f" stroke-width="2.5"/>' +
      '<circle cx="50" cy="528" r="7" fill="none" stroke="#20260f" stroke-width="2"/><circle cx="250" cy="528" r="7" fill="none" stroke="#20260f" stroke-width="2"/>' +
      // ขาเลนส์สีดำ (ครอบเลนส์อ่านหน้าปัด) มีร่องกลางให้มองลวดเล็ง
      '<path d="M18 330 q0-58 70-58 h48 v32 q0 14 14 14 q14 0 14-14 v-32 h48 q70 0 70 58 v100 q0 70-70 70 h-124 q-70 0-70-70 z" fill="url(#sgBlk)" stroke="#000" stroke-width="2"/>' +
      '<path d="M50 300 q20-14 60-14" stroke="rgba(255,255,255,.25)" stroke-width="6" fill="none" stroke-linecap="round"/>' +
      '<circle cx="150" cy="415" r="84" fill="#111" stroke="#2b2b2b" stroke-width="6"/>' +
      '</svg>';
  }

  // ---------- หน้าปัดที่เห็นผ่านเลนส์ ----------
  function drawLens(v) {
    var cv = $('sgLens'); if (!cv) return;
    var c = cv.getContext('2d'), W = cv.width, H = cv.height, cx = W / 2, cy = H / 2, R = W / 2 - 4, ppd = W / 15;
    c.clearRect(0, 0, W, H);
    c.save(); c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.clip();
    var g = c.createRadialGradient(cx - R * 0.3, cy - R * 0.3, 10, cx, cy, R);
    g.addColorStop(0, st.night ? '#26331f' : '#ffffff'); g.addColorStop(1, st.night ? '#0d140b' : '#d6d6cf');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    var RED = st.night ? '#ff8a80' : '#c8102e', BLK = st.night ? '#c8f56a' : '#111';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    if (v !== null) {
      var y0 = cy - H * 0.02;
      for (var d = Math.floor(v - 9); d <= Math.ceil(v + 9); d++) { // องศา (แดง) ขีดทุก 1° ตัวเลขทุก 5°
        var x = cx + (d - v) * ppd, dd = n360(d), big = dd % 5 === 0;
        c.strokeStyle = RED; c.lineWidth = big ? W * 0.008 : W * 0.005;
        c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y0 - (big ? H * 0.12 : dd % 5 === 0 ? H * 0.08 : H * 0.05)); c.stroke();
        if (big) { c.fillStyle = RED; c.font = '700 ' + Math.round(W * 0.075) + 'px -apple-system, Arial, sans-serif'; c.fillText(String(dd), x, y0 - H * 0.2); }
      }
      c.strokeStyle = RED; c.lineWidth = W * 0.005; c.beginPath(); c.moveTo(0, y0); c.lineTo(W, y0); c.stroke();
      var mil = v * 6400 / 360, ppm = ppd * 360 / 6400, y1 = y0 + H * 0.03; // มิล (ดำ) ขีดทุก 20 ตัวเลขทุก 100 (หลักร้อย)
      for (var m = Math.floor((mil - 300) / 20) * 20; m <= mil + 300; m += 20) {
        var x2 = cx + (m - mil) * ppm, mm = ((m % 6400) + 6400) % 6400, b2 = mm % 100 === 0;
        c.strokeStyle = BLK; c.lineWidth = b2 ? W * 0.008 : W * 0.004;
        c.beginPath(); c.moveTo(x2, y1); c.lineTo(x2, y1 + (b2 ? H * 0.1 : H * 0.05)); c.stroke();
        if (b2) { c.fillStyle = BLK; c.font = '700 ' + Math.round(W * 0.07) + 'px -apple-system, Arial, sans-serif'; c.fillText(String(mm / 100 === 0 ? 64 : mm / 100), x2, y1 + H * 0.2); }
      }
      c.fillStyle = RED; c.font = '600 ' + Math.round(W * 0.045) + 'px sans-serif'; c.fillText('องศา', cx - R * 0.45, y0 - H * 0.33);
      c.fillStyle = BLK; c.fillText('มิล', cx - R * 0.45, y1 + H * 0.33);
      if (st.target !== null) { // เครื่องหมายเป้า (สามเหลี่ยมเหลือง)
        var tx = cx + d180(st.target - v) * ppd;
        if (Math.abs(tx - cx) < W) { c.fillStyle = '#ffb300'; c.beginPath(); c.moveTo(tx, y0 + 2); c.lineTo(tx - W * 0.035, y0 + H * 0.09); c.lineTo(tx + W * 0.035, y0 + H * 0.09); c.closePath(); c.fill(); }
      }
    } else { c.fillStyle = '#555'; c.font = '600 ' + Math.round(W * 0.06) + 'px sans-serif'; c.fillText('รอเซนเซอร์…', cx, cy); }
    c.strokeStyle = '#e53935'; c.lineWidth = W * 0.012; c.beginPath(); c.moveTo(cx, 0); c.lineTo(cx, H); c.stroke(); // เส้นอ่านค่า
    var gl = c.createLinearGradient(0, 0, W, H); gl.addColorStop(0, 'rgba(255,255,255,.35)'); gl.addColorStop(0.4, 'rgba(255,255,255,0)'); c.fillStyle = gl; c.fillRect(0, 0, W, H);
    c.restore();
  }

  function dirName(a) { return DIRS[Math.round(n360(a) / 22.5) % 16]; }
  function loop() {
    raf = requestAnimationFrame(loop);
    var live = reading(), v = st.lock !== null ? st.lock : live;
    drawLens(v);
    var S = root.TrailSensors && TrailSensors.state;
    if ($('sgStat')) $('sgStat').innerHTML = '<span style="color:' + (live === null ? '#ffb300' : '#7CFC00') + '">●</span> ' + (live === null ? 'แตะ "เริ่มเซนเซอร์"' : 'เซนเซอร์พร้อม' + (S && S.headAcc ? ' ±' + Math.round(S.headAcc) + '°' : ''));
    var hide = st.practice && !st.practice.shown;
    $('sgDeg').textContent = v === null ? '—' : hide ? '???' : Math.round(v) + '°';
    $('sgMil').textContent = v === null || hide ? '' : Math.round(v * 6400 / 360) + ' มิล';
    $('sgDir').textContent = v === null || hide ? '' : dirName(v) + (st.lock !== null ? ' · ล็อคอยู่' : '');
    var info = '';
    if (st.target !== null && v !== null) {
      var dv = d180(st.target - v);
      info = Math.abs(dv) < 1 ? '🎯 ตรงเป้า ' + st.target + '°' : (dv > 0 ? 'หันขวา ' : 'หันซ้าย ') + Math.abs(dv).toFixed(0) + '° → เป้า ' + st.target + '°';
    }
    if (st.practice) info = st.practice.msg || ('ฝึก: เล็งไปที่มุม ' + st.practice.goal + '° แล้วกด "ตรวจ"');
    $('sgInfo').textContent = info;
  }

  // ---------- ปุ่ม ----------
  function lock() {
    if (st.lock !== null) { st.lock = null; $('sgLock').textContent = 'ล็อคทิศ'; return; }
    var r = reading(); if (r === null) { ctx.toast('ยังไม่มีค่าเข็มทิศ'); return; }
    st.lock = r; $('sgLock').textContent = 'ปลดล็อค';
  }
  function target() {
    if (st.target !== null) { st.target = null; $('sgTgt').textContent = 'เป้าหมาย'; return; }
    var r = reading(), v = prompt('มุมเป้าหมาย (องศา 0–359) · เว้นว่าง = ใช้มุมที่เล็งอยู่', r === null ? '' : Math.round(r));
    if (v === null) return;
    var n = v.trim() === '' ? r : parseFloat(v);
    if (n === null || isNaN(n)) return;
    st.target = Math.round(n360(n)); $('sgTgt').textContent = 'ยกเลิกเป้า';
  }
  function practice() {
    if (!st.practice) {
      st.practice = { goal: Math.floor(Math.random() * 72) * 5, shown: false }; st.target = null;
      $('sgPrac').textContent = 'ตรวจ'; return;
    }
    if (!st.practice.shown) {
      var r = reading(); if (r === null) { ctx.toast('ยังไม่มีค่าเข็มทิศ'); return; }
      var e = d180(r - st.practice.goal);
      st.practice.shown = true;
      st.practice.msg = 'เป้า ' + st.practice.goal + '° · เล็งได้ ' + Math.round(r) + '° · คลาด ' + Math.abs(e).toFixed(0) + '° ' + (Math.abs(e) <= 3 ? '✅ ดีมาก' : Math.abs(e) <= 8 ? '👍 ใช้ได้' : '❌ ลองอีกครั้ง');
      $('sgPrac').textContent = 'ข้อใหม่'; return;
    }
    st.practice = null; $('sgPrac').textContent = 'ฝึก'; practice();
  }
  function record() {
    var r = st.lock !== null ? st.lock : reading(); if (r === null) { ctx.toast('ยังไม่มีค่าเข็มทิศ'); return; }
    var f = emb ? emb.getPos() : root.TrailSensors && TrailSensors.state.fix, t = new Date();
    st.log.unshift({ az: r, t: t, lat: f && f.lat, lng: f && f.lng });
    ctx.toast('บันทึก ' + Math.round(r) + '° (' + Math.round(r * 6400 / 360) + ' มิล) เวลา ' + t.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    if (f && f.lat && window.TrailProtAddSight) { var trueAz = st.ref === 'true' ? r : n360(r + decl()); window.TrailProtAddSight(f.lat, f.lng, trueAz, st.km || 5, Math.round(r) + '°'); }
    renderLog();
  }
  function renderLog() {
    var b = $('sgLog'); if (!b || !$('sgSet')) return;
    b.innerHTML = st.log.slice(0, 6).map(function (x) { return '<div>' + x.t.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' · <b>' + Math.round(x.az) + '°</b> ' + Math.round(x.az * 6400 / 360) + ' มิล</div>'; }).join('');
    b.style.display = st.log.length && $('sgSet').dataset.open ? '' : 'none';
  }
  function settings() {
    var p = $('sgSet'), open = !p.dataset.open;
    p.dataset.open = open ? '1' : ''; p.style.display = open ? '' : 'none';
    if (open) p.querySelector('#sgRef').value = st.ref;
    renderLog();
  }

  // ---------- เปิด/ปิด ----------
  function open(opts) {
    if (ui) return;
    emb = opts && opts.embedded ? opts : null;
    if (emb) return openEmbedded();
    ui = document.createElement('div'); ui.id = 'sightUi';
    ui.style.cssText = 'position:fixed;inset:0;z-index:60;background:#111;color:#fff;overflow:hidden;font-family:inherit';
    var B = 'border:1.5px solid rgba(255,255,255,.35);background:rgba(0,0,0,.45);color:#fff;border-radius:16px;padding:12px 6px;font-size:16px;font-weight:700;flex:1';
    ui.innerHTML =
      '<video id="sgVid" playsinline muted autoplay style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>' +
      '<div style="position:absolute;left:0;right:0;top:calc(env(safe-area-inset-top) + 10px);display:flex;gap:8px;padding:0 12px;align-items:center">' +
      '<div id="sgStat" style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:rgba(0,0,0,.6);border-radius:22px;padding:10px 12px;font-size:14px"></div>' +
      '<button id="sgRefB" style="background:rgba(0,0,0,.6);color:#fff;border:0;border-radius:22px;padding:10px 12px;font-size:14px;font-weight:700"></button>' +
      '<button id="sgNight" style="background:rgba(0,0,0,.6);color:#fff;border:0;border-radius:50%;width:44px;height:44px;font-size:20px">☾</button>' +
      '<button id="sgGear" style="background:rgba(0,0,0,.6);color:#fff;border:0;border-radius:50%;width:44px;height:44px;font-size:20px">⚙</button>' +
      '<button id="sgClose" style="background:rgba(0,0,0,.6);color:#fff;border:0;border-radius:50%;width:44px;height:44px;font-size:20px">✕</button></div>' +
      '<div id="sgSet" style="display:none;position:absolute;right:12px;top:calc(env(safe-area-inset-top) + 64px);background:rgba(0,0,0,.85);border-radius:14px;padding:10px 12px;font-size:14px;max-width:270px;z-index:2">' +
      '<div>อ่านค่าเป็น <select id="sgRef" style="font-size:14px;border-radius:6px"><option value="mag">มุมแม่เหล็ก (เหมือนเข็มทิศจริง)</option><option value="true">มุมเหนือจริง</option></select></div>' +
      '<div style="margin-top:6px;color:#bbb">มุมเบี่ยงเบนแม่เหล็กตั้งที่เมนูวัดมุม (ตอนนี้ ' + decl() + '°) · ถ้าค่าไม่นิ่ง ให้หมุนเครื่องเป็นเลข 8 ห่างโลหะ · กด "บันทึก" จะวาดเส้นเล็ง 5 กม. จากตำแหน่ง GPS บนแผนที่</div>' +
      '<div id="sgLog" style="margin-top:8px;border-top:1px solid #444;padding-top:6px"></div></div>' +
      '<div id="sgBody" style="position:absolute;left:50%;top:calc(env(safe-area-inset-top) + 74px);bottom:calc(env(safe-area-inset-bottom) + 205px);aspect-ratio:300/560;transform:translateX(-50%);max-width:92vw">' + bodySvg() +
      '<canvas id="sgLens" width="480" height="480" style="position:absolute;left:50%;top:' + (415 / 560 * 100) + '%;width:' + (156 / 300 * 100) + '%;transform:translate(-50%,-50%);border-radius:50%"></canvas></div>' +
      '<div style="position:absolute;left:0;right:0;bottom:0;background:linear-gradient(transparent,rgba(0,0,0,.85) 25%);padding:16px 16px calc(env(safe-area-inset-bottom) + 14px)">' +
      '<div id="sgInfo" style="color:#ffd54f;font-size:14px;min-height:18px"></div>' +
      '<div style="display:flex;align-items:flex-end;justify-content:space-between"><div><div style="color:#bbb;font-size:15px">ทิศที่เล็ง</div><div id="sgDeg" style="font-size:64px;font-weight:800;color:#b9f26b;line-height:1"></div></div>' +
      '<div style="text-align:right"><div id="sgMil" style="font-size:30px;font-weight:700"></div><div id="sgDir" style="color:#bbb;font-size:16px"></div></div></div>' +
      '<div style="display:flex;gap:8px;margin-top:12px"><button id="sgLock" style="' + B + ';background:#b9f26b;color:#111;border-color:#b9f26b">ล็อคทิศ</button><button id="sgTgt" style="' + B + '">เป้าหมาย</button><button id="sgPrac" style="' + B + '">ฝึก</button><button id="sgRec" style="' + B + '">บันทึก</button></div>' +
      '<button id="sgStart" style="display:none;margin-top:8px;width:100%;' + B + ';background:#2e6b3f">เริ่มเซนเซอร์และกล้อง</button></div>';
    document.body.appendChild(ui);
    $('sgClose').onclick = close;
    $('sgLock').onclick = lock; $('sgTgt').onclick = target; $('sgPrac').onclick = practice; $('sgRec').onclick = record; $('sgGear').onclick = settings;
    $('sgNight').onclick = function () { st.night = !st.night; ui.style.filter = st.night ? 'sepia(1) hue-rotate(50deg) saturate(2.5) brightness(.75)' : ''; };
    function refB() { $('sgRefB').textContent = (st.ref === 'mag' ? 'แม่เหล็ก' : 'เหนือจริง') + ' · เล็ง'; }
    $('sgRefB').onclick = function () { st.ref = st.ref === 'mag' ? 'true' : 'mag'; refB(); }; refB();
    $('sgRef').onchange = function () { st.ref = this.value; refB(); };
    function startAll() {
      var p = root.TrailSensors ? TrailSensors.start() : Promise.resolve(false);
      p.then(function (ok) { if (!ok) ctx.toast('ไม่ได้รับสิทธิ์เข็มทิศ: ตั้งค่า → Safari → การเคลื่อนไหวและการวางแนว'); });
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).then(function (s) { stream = s; var v = $('sgVid'); if (v) { v.srcObject = s; v.play().catch(function () {}); } }).catch(function () { /* ไม่มีกล้องก็ใช้ได้ */ });
      }
      $('sgStart').style.display = 'none';
    }
    // iPhone ต้องขอสิทธิ์จากการแตะ: ถ้าเซนเซอร์ยังไม่เริ่ม แสดงปุ่มเริ่ม
    if (root.TrailSensors && TrailSensors.isStarted()) startAll(); else { $('sgStart').style.display = ''; $('sgStart').onclick = startAll; }
    loop();
  }
  // ฝังในมุมมอง 3D: โปร่ง ลากจอหมุนได้ เข็มทิศอยู่ครึ่งล่าง ลวดเล็งตรงกลางจอ
  function openEmbedded() {
    ui = document.createElement('div'); ui.id = 'sightUi';
    ui.style.cssText = 'position:fixed;inset:0;z-index:8;color:#fff;pointer-events:none;font-family:inherit';
    var B = 'pointer-events:auto;border:1.5px solid rgba(255,255,255,.4);background:rgba(0,0,0,.5);color:#fff;border-radius:14px;padding:8px 4px;font-size:14px;font-weight:700;flex:1';
    ui.innerHTML =
      '<div style="position:absolute;left:50%;top:0;bottom:0;width:0;border-left:1px solid rgba(0,0,0,.55)"></div>' +
      '<div id="sgBody" style="position:absolute;left:50%;height:56vh;bottom:calc(env(safe-area-inset-bottom) + 150px);aspect-ratio:300/560;transform:translateX(-50%);opacity:.97">' + bodySvg() +
      '<canvas id="sgLens" width="480" height="480" style="position:absolute;left:50%;top:' + (415 / 560 * 100) + '%;width:' + (156 / 300 * 100) + '%;transform:translate(-50%,-50%);border-radius:50%"></canvas></div>' +
      '<div style="position:absolute;left:0;right:0;bottom:0;background:rgba(12,12,12,.94);padding:10px 12px calc(env(safe-area-inset-bottom) + 8px);pointer-events:auto">' +
      '<div style="max-width:560px;margin:0 auto"><div id="sgInfo" style="color:#ffd54f;font-size:13px;min-height:16px"></div>' +
      '<div style="display:flex;align-items:flex-end;justify-content:space-between;gap:8px"><div><span style="color:#bbb;font-size:13px">ทิศที่เล็ง</span> <span id="sgDeg" style="font-size:38px;font-weight:800;color:#b9f26b;line-height:1"></span></div>' +
      '<div style="text-align:right"><span id="sgMil" style="font-size:20px;font-weight:700"></span> <span id="sgDir" style="color:#bbb;font-size:13px"></span></div></div>' +
      '<div style="display:flex;gap:6px;margin-top:8px"><button id="sgLock" style="' + B + ';background:#b9f26b;color:#111;border-color:#b9f26b">ล็อคทิศ</button><button id="sgTgt" style="' + B + '">เป้าหมาย</button><button id="sgPrac" style="' + B + '">ฝึก</button><button id="sgRec" style="' + B + '">📌 บันทึก</button></div>' +
      '<div style="display:flex;gap:6px;margin-top:6px"><button id="sgRefB" style="' + B + '"></button><select id="sgKm" style="pointer-events:auto;flex:1;border-radius:14px;font-size:13px;padding:6px"><option value="5">เส้นเล็ง 5 กม.</option><option value="10">10 กม.</option><option value="15">15 กม.</option><option value="20">20 กม.</option></select><button id="sgClr" style="' + B + '">ลบเส้นเล็ง</button></div></div></div>' +
      '<div id="sgStat" style="display:none"></div>';
    document.body.appendChild(ui);
    $('sgLock').onclick = lock; $('sgTgt').onclick = target; $('sgPrac').onclick = practice; $('sgRec').onclick = record;
    function refB() { $('sgRefB').textContent = st.ref === 'mag' ? 'อ่าน: แม่เหล็ก' : 'อ่าน: เหนือจริง'; }
    $('sgRefB').onclick = function () { st.ref = st.ref === 'mag' ? 'true' : 'mag'; refB(); }; refB();
    $('sgKm').value = String(st.km); $('sgKm').onchange = function () { st.km = +this.value; };
    $('sgClr').onclick = function () { if (window.TrailProtClearSights) window.TrailProtClearSights(); ctx.toast('ลบเส้นเล็งแล้ว'); };
    loop();
  }
  function close() {
    var e = emb; emb = null;
    cancelAnimationFrame(raf);
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    if (ui) { ui.remove(); ui = null; }
    st.practice = null;
    if (e && e.onClose) e.onClose();
  }

  root.TrailSight = { init: init, open: open, close: close, _st: st, _draw: drawLens };
})(typeof self !== 'undefined' ? self : this);
