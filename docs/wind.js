// ลม: ทิศและความเร็วลมล่าสุดจากแบบจำลองอากาศ (Open-Meteo) + พยากรณ์ 12 ชม. + ตารางสังเกตด้วยตาตามบิวฟอร์ต
(function (root) {
  var G = TrailGeo;
  var S = TrailSensors;
  var KEY = 'trail_wind_v1';
  var ctx = null;
  var data = null; // { lat, lng, t, cur:{kmh,dir,gust,temp}, hours:[{time,kmh,dir,gust}] }
  var busy = false;
  var timer = 0;

  var BEAU = [
    ['ลมสงบ', 'ควันลอยตรงขึ้น'],
    ['ลมเบาบาง', 'ควันเอนเล็กน้อยบอกทิศ แต่ธงยังไม่ไหว'],
    ['ลมอ่อน', 'รู้สึกลมที่ใบหน้า ใบไม้ไหวเบาๆ'],
    ['ลมโชยอ่อน', 'ใบไม้และกิ่งเล็กไหวตลอด ธงสะบัด'],
    ['ลมปานกลาง', 'ฝุ่นและกระดาษปลิว กิ่งไม้เล็กไหว'],
    ['ลมค่อนข้างแรง', 'ต้นไม้เล็กโยกไปมา'],
    ['ลมแรง', 'กิ่งใหญ่ไหว ได้ยินเสียงลมหวีดผ่านสาย ร่มกางยาก'],
    ['ลมแรงจัด', 'ต้นไม้ทั้งต้นไหว เดินสวนลมลำบาก'],
    ['ลมพายุ', 'กิ่งไม้หัก เดินสวนลมแทบไม่ได้'],
    ['พายุแรง', 'ความเสียหายเล็กน้อยต่อสิ่งปลูกสร้าง'],
    ['พายุรุนแรง', 'ต้นไม้ถอนราก — อันตราย'],
    ['พายุรุนแรงมาก', 'เสียหายกว้าง — อันตราย'],
    ['พายุเฮอริเคน/ไต้ฝุ่น', 'อันตรายถึงชีวิต']
  ];
  var BTH = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
  var DIRS = ['เหนือ', 'ตะวันออกเฉียงเหนือ', 'ตะวันออก', 'ตะวันออกเฉียงใต้', 'ใต้', 'ตะวันตกเฉียงใต้', 'ตะวันตก', 'ตะวันตกเฉียงเหนือ'];
  var DIR_SHORT = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

  function $(id) { return document.getElementById(id); }
  function norm180(a) { a = G.norm360(a); return a > 180 ? a - 360 : a; }
  function beaufort(ms) { var n = 0; while (n < BTH.length && ms >= BTH[n]) n++; return n; }
  function dirIdx(d) { return Math.round(G.norm360(d) / 45) % 8; }
  function hhmm(t) { var d = new Date(t); return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); }

  function init(c) {
    ctx = c;
    try { data = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { data = null; }
    var chip = document.createElement('button');
    chip.className = 'chip';
    chip.id = 'windChip';
    chip.hidden = true;
    chip.style.cssText = 'font-size:13px;padding:7px 12px';
    chip.onclick = function () { ctx.showSheet('wind'); };
    var top = $('top');
    if (top) top.appendChild(chip);
    renderChip();
    fetchWind(false);
    timer = setInterval(function () { fetchWind(false); }, 5 * 60 * 1000);
    window.addEventListener('online', function () { fetchWind(true); });
  }

  function where() {
    var f = S.state.fix;
    if (f && Date.now() - f.t < 600000) return { lat: f.lat, lng: f.lng, gps: true };
    var c = ctx.map().getCenter();
    return { lat: c.lat, lng: c.lng, gps: false };
  }

  function fetchWind(force) {
    if (busy || !navigator.onLine) return Promise.resolve(false);
    var w = where();
    if (!force && data && Date.now() - data.t < 10 * 60 * 1000 && G.haversine(w, data) < 5000) return Promise.resolve(false);
    busy = true;
    var lat = w.lat.toFixed(2), lng = w.lng.toFixed(2); // ปัดเศษ ~1 กม. ไม่ส่งตำแหน่งละเอียด
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lng +
      '&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m' +
      '&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&forecast_hours=12&timezone=auto&wind_speed_unit=kmh';
    var ctl = new AbortController();
    var to = setTimeout(function () { ctl.abort(); }, 10000);
    return fetch(url, { signal: ctl.signal }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      clearTimeout(to);
      var cu = j.current || {}, hr = j.hourly || {}, hours = [];
      (hr.time || []).forEach(function (t, i) {
        hours.push({ time: t, kmh: hr.wind_speed_10m[i], dir: hr.wind_direction_10m[i], gust: hr.wind_gusts_10m[i] });
      });
      data = {
        lat: w.lat, lng: w.lng, gps: w.gps, t: Date.now(),
        cur: { kmh: cu.wind_speed_10m, dir: cu.wind_direction_10m, gust: cu.wind_gusts_10m, temp: cu.temperature_2m },
        hours: hours
      };
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* ไม่เป็นไร */ }
      busy = false;
      renderChip();
      if ($('windCv')) draw();
      return true;
    }).catch(function () {
      clearTimeout(to);
      busy = false;
      if ($('windInfo') && !data) $('windInfo').textContent = 'ดึงข้อมูลลมไม่ได้ (ตรวจอินเทอร์เน็ต)';
      return false;
    });
  }

  function renderChip() {
    var chip = $('windChip');
    if (!chip) return;
    if (!data || !data.cur || typeof data.cur.kmh !== 'number') { chip.hidden = true; return; }
    var age = (Date.now() - data.t) / 60000;
    chip.hidden = false;
    chip.textContent = '💨 ' + DIR_SHORT[dirIdx(data.cur.dir)] + ' ' + Math.round(data.cur.kmh) + ' กม./ชม.' + (age > 60 ? ' (เก่า)' : '');
  }

  /* ---------- หน้าจอ ---------- */
  function renderSheet(body) {
    body.innerHTML =
      '<canvas id="windCv" width="640" height="640" style="width:100%;max-width:300px;display:block;margin:0 auto"></canvas>' +
      '<div id="windInfo" style="font-size:14px;line-height:1.6;margin-top:6px"></div>' +
      '<div class="btnrow"><button class="btn" id="windRef">รีเฟรชตอนนี้</button></div>' +
      '<h4>พยากรณ์ 12 ชั่วโมงข้างหน้า</h4><div id="windFc" style="font-size:13px"></div>' +
      '<h4>สังเกตเองด้วยตา (ตามมาตราบิวฟอร์ต)</h4><div id="windBf" style="font-size:12.5px;line-height:1.5"></div>' +
      '<p class="note">ข้อมูลจากแบบจำลองอากาศ Open-Meteo ที่ความสูง 10 เมตร ความละเอียดราว 10 กม. ไม่ใช่เครื่องวัดจริงตรงจุดที่ยืน ลมในหุบเขา สันเขา หรือใต้ป่าจะต่างได้มาก ' +
      'ต้องมีอินเทอร์เน็ต (ถ้าออฟไลน์จะแสดงค่าล่าสุดที่เคยโหลดไว้) แอพส่งพิกัดแบบปัดเศษราว 1 กม. ไปยังบริการนี้เท่านั้น ' +
      'เมื่อต้องการความแม่นยำ เช่น ยิงปืน ปล่อยโดรน หรือจุดไฟ ให้ตรวจด้วยตาควบคู่เสมอ (ลองปล่อยผงฝุ่น/ใบหญ้า หรือใช้นิ้วเปียกสัมผัสลม)</p>';
    $('windRef').onclick = function () {
      $('windInfo').textContent = 'กำลังดึงข้อมูล…';
      fetchWind(true).then(function (ok) { if (!ok && !navigator.onLine) ctx.toast('ออฟไลน์ แสดงค่าล่าสุด'); draw(); });
    };
    var bf = '<table style="width:100%;border-collapse:collapse">';
    BEAU.forEach(function (b, i) {
      var lo = i === 0 ? 0 : BTH[i - 1], hi = i < BTH.length ? BTH[i] : null;
      bf += '<tr style="border-top:1px solid #eee"><td style="padding:3px 4px;white-space:nowrap">' + i + '</td><td style="padding:3px 4px;white-space:nowrap">' +
        (hi === null ? '> ' + Math.round(lo * 3.6) : Math.round(lo * 3.6) + '–' + Math.round(hi * 3.6)) + ' กม./ชม.</td><td style="padding:3px 4px"><b>' + b[0] + '</b> · ' + b[1] + '</td></tr>';
    });
    $('windBf').innerHTML = bf + '</table>';
    draw();
    fetchWind(false).then(function () { if ($('windCv')) draw(); });
  }

  function draw() {
    var cv = $('windCv');
    if (!cv) return;
    var info = $('windInfo');
    var c = cv.getContext('2d'), W = cv.width, cx = W / 2, cy = W / 2, R = W / 2 - 46;
    c.clearRect(0, 0, W, W);
    c.fillStyle = '#0b1530';
    c.beginPath(); c.arc(cx, cy, R + 34, 0, 7); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 2;
    c.beginPath(); c.arc(cx, cy, R, 0, 7); c.stroke();
    c.font = 'bold 30px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(function (d) {
      var a = d[1] * Math.PI / 180;
      c.fillStyle = d[0] === 'N' ? '#ff6b5e' : '#fff';
      c.fillText(d[0], cx + (R + 20) * Math.sin(a), cy - (R + 20) * Math.cos(a));
    });
    for (var t = 0; t < 360; t += 30) {
      var a2 = t * Math.PI / 180;
      c.beginPath(); c.moveTo(cx + (R - 10) * Math.sin(a2), cy - (R - 10) * Math.cos(a2)); c.lineTo(cx + R * Math.sin(a2), cy - R * Math.cos(a2)); c.stroke();
    }
    if (!data || !data.cur || typeof data.cur.kmh !== 'number') {
      info.textContent = navigator.onLine ? 'กำลังดึงข้อมูลลม…' : 'ออฟไลน์ และยังไม่เคยดึงข้อมูลลมไว้';
      return;
    }
    var cu = data.cur, from = cu.dir, to = G.norm360(from + 180);
    var ms = cu.kmh / 3.6, bf = beaufort(ms);
    // ทิศที่เครื่องหัน
    var h = S.headingTrue();
    if (h !== null) {
      var ah = h * Math.PI / 180;
      c.fillStyle = '#2ee66b';
      c.beginPath(); c.arc(cx + R * Math.sin(ah), cy - R * Math.cos(ah), 12, 0, 7); c.fill();
    }
    // ลูกศรลม: หางอยู่ด้านที่ลมมา หัวชี้ไปทิศที่ลมพัดไป
    var len = R * (0.35 + 0.6 * Math.min(1, cu.kmh / 40));
    var ar = from * Math.PI / 180, dx = -Math.sin(ar), dy = Math.cos(ar); // เวกเตอร์ชี้ไปทิศพัดไป (บนจอ)
    var tx = cx - dx * len / 2, ty = cy - dy * len / 2, hx = cx + dx * len / 2, hy = cy + dy * len / 2;
    c.strokeStyle = '#4fd1ff'; c.fillStyle = '#4fd1ff'; c.lineWidth = 12; c.lineCap = 'round';
    c.beginPath(); c.moveTo(tx, ty); c.lineTo(hx, hy); c.stroke();
    var ang = Math.atan2(hy - ty, hx - tx);
    c.beginPath();
    c.moveTo(hx + 22 * Math.cos(ang), hy + 22 * Math.sin(ang));
    c.lineTo(hx + 26 * Math.cos(ang + 2.5), hy + 26 * Math.sin(ang + 2.5));
    c.lineTo(hx + 26 * Math.cos(ang - 2.5), hy + 26 * Math.sin(ang - 2.5));
    c.closePath(); c.fill();
    c.fillStyle = '#fff'; c.font = 'bold 44px sans-serif';
    c.fillText(Math.round(cu.kmh), cx, cy - 8);
    c.font = '22px sans-serif';
    c.fillText('กม./ชม.', cx, cy + 22);

    var conv = G.convergence(data.lat, data.lng);
    var age = Math.round((Date.now() - data.t) / 60000);
    var html = '<b>ลมมาจากทิศ ' + Math.round(from) + '° (' + DIRS[dirIdx(from)] + ')</b> พัดไปทาง ' + Math.round(to) + '° (' + DIRS[dirIdx(to)] + ')<br>' +
      'ความเร็ว <b>' + cu.kmh.toFixed(1) + ' กม./ชม.</b> = ' + ms.toFixed(1) + ' ม./วินาที = ' + (cu.kmh / 1.852).toFixed(1) + ' นอต · บิวฟอร์ต ' + bf + ' (' + BEAU[bf][0] + ')<br>' +
      (typeof cu.gust === 'number' ? 'กระโชกสูงสุด ' + cu.gust.toFixed(0) + ' กม./ชม.' : '') + (typeof cu.temp === 'number' ? ' · อุณหภูมิ ' + cu.temp.toFixed(1) + '°C' : '') + '<br>' +
      'ทิศมุมกริด ' + G.norm360(from - conv).toFixed(0) + '° (' + Math.round(G.norm360(from - conv) * 6400 / 360) + ' มิล)';
    if (h !== null) {
      var rel = norm180(from - h), ar2 = Math.abs(rel);
      var rtxt = ar2 < 30 ? 'ลมปะทะหน้า' : ar2 > 150 ? 'ลมตามหลัง' : (rel > 0 ? 'ลมจากด้านขวา' : 'ลมจากด้านซ้าย') + (ar2 < 75 ? ' ค่อนมาทางหน้า' : ar2 > 105 ? ' ค่อนมาทางหลัง' : '');
      html += '<br>เทียบกับทิศที่เครื่องหัน (จุดเขียว): <b>' + rtxt + '</b>';
    }
    html += '<br><span style="font-size:12px;color:#666">ข้อมูลเมื่อ ' + hhmm(data.t) + (age > 0 ? ' (' + age + ' นาทีก่อน)' : '') + (age > 60 ? ' — เก่าแล้ว' : '') + ' · ตำแหน่ง ' + (data.gps ? 'GPS' : 'กลางจอแผนที่') + '</span>';
    info.innerHTML = html;

    var fc = $('windFc');
    if (fc) {
      var s = '';
      var hrs = data.hours || [];
      for (var i = 0; i < hrs.length; i += 2) {
        var x = hrs[i], tt = x.time.slice(11, 16);
        s += '<div style="display:flex;gap:8px;padding:3px 0;border-top:1px solid #f0f0f0"><span style="flex:0 0 48px">' + tt + '</span><span style="flex:0 0 120px">จาก ' + DIR_SHORT[dirIdx(x.dir)] + ' ' + Math.round(x.dir) + '°</span><span>' + Math.round(x.kmh) + ' กม./ชม. (กระโชก ' + Math.round(x.gust) + ')</span></div>';
      }
      fc.innerHTML = s || '<span style="color:#777">ไม่มีข้อมูลพยากรณ์</span>';
    }
  }

  root.TrailWind = { init: init, renderSheet: renderSheet, refresh: function () { return fetchWind(true); } };
})(typeof self !== 'undefined' ? self : this);
