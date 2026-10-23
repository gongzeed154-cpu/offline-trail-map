// ทีมเดินป่า: เชื่อมกับเซิร์ฟเวอร์ใน server/ (WebSocket) แชร์เส้นทางของหัวหน้าและเห็นตำแหน่งสมาชิก
// ต้องมีอินเทอร์เน็ต/สัญญาณมือถือ และบน iPhone ส่งตำแหน่งได้เฉพาะตอนเปิดแอพค้างไว้ (ล็อคจอแล้วหยุด)
(function (root) {
  var S = TrailSensors;
  var KEY = 'trail_team_v1'; // { url, code, id, token } สำหรับกลับเข้าทีมเดิม
  var UKEY = 'trail_team_url_v1';
  var MAX_MEMBERS = 10;
  var MAX_NAME = 16;
  // ต้องตรงกับ COLORS ใน server/index.js
  var COLORS = ['#e6194b', '#f58231', '#ffe119', '#3cb44b', '#00bcd4', '#4363d8', '#911eb4', '#f032e6', '#8b4513', '#000000'];
  var ERR = {
    route_required: 'ต้องเลือกเส้นทางก่อนสร้างทีม',
    bad_name: 'ชื่อต้องไม่ว่างและไม่เกิน ' + MAX_NAME + ' ตัวอักษร',
    bad_color: 'สีที่เลือกไม่ถูกต้อง',
    no_such_team: 'ไม่พบรหัสทีมนี้ ตรวจสอบรหัสกับหัวหน้าทีมอีกครั้ง',
    team_full: 'ทีมนี้เต็มแล้ว (สูงสุด ' + MAX_MEMBERS + ' เครื่อง)',
    color_taken: 'สีนี้มีคนในทีมใช้แล้ว กรุณาเลือกสีอื่น',
    host_only: 'เฉพาะหัวหน้าทีมเท่านั้น',
    bad_route: 'เส้นทางไม่ถูกต้องหรือยาวเกินไป',
    resume_failed: 'เข้าทีมเดิมไม่ได้ (ทีมอาจถูกยุบแล้ว)'
  };
  var EMPTY = { type: 'FeatureCollection', features: [] };

  var ctx = null;
  var ws = null;
  var saved = null;
  var want = false; // ผู้ใช้ยังอยู่ในทีม
  var st = { status: 'off', code: null, you: null, members: [], route: null, error: null };
  var retry = 0, retryTimer = 0, lastSent = 0, onFirst = null;
  var ui = { mode: 'create', color: COLORS[0], routeId: null, busy: false, changeRoute: false };
  var sheetBody = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function chars(s) { return typeof Array.from === 'function' ? Array.from(s).length : s.length; }
  function me() { return st.members.filter(function (m) { return m.id === st.you; })[0] || null; }

  function init(c) {
    ctx = c;
    var map = ctx.map();
    map.addSource('team-route', { type: 'geojson', data: EMPTY });
    map.addSource('team-members', { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'team-route-line', type: 'line', source: 'team-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1a5fd0', 'line-width': 5, 'line-opacity': 0.8, 'line-dasharray': [2, 1.5] } }, 'grid-lines');
    map.addLayer({
      id: 'team-members-dot', type: 'circle', source: 'team-members',
      paint: { 'circle-radius': 9, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 3, 'circle-opacity': ['case', ['==', ['get', 'online'], 1], 1, 0.45] }
    }, 'grid-lines');
    map.addLayer({
      id: 'team-members-label', type: 'symbol', source: 'team-members',
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-offset': [0, 1.4], 'text-allow-overlap': true },
      paint: { 'text-color': '#000', 'text-halo-color': '#fff', 'text-halo-width': 2 }
    }, 'grid-lines');

    var chip = document.createElement('button');
    chip.className = 'chip';
    chip.id = 'teamChip';
    chip.hidden = true;
    chip.style.cssText = 'font-size:13px;padding:7px 12px;background:#dde9ff';
    chip.onclick = function () { ctx.showSheet('team'); };
    var top = $('top');
    if (top) top.appendChild(chip);

    S.onFix(onFix);
    // iOS ตัดการเชื่อมต่อตอนแอพถูกพักไว้ กลับมาเปิดแล้วต่อใหม่ทันที
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') reconnectNow(); });
    window.addEventListener('online', reconnectNow);

    var s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
    if (s && s.url && s.code && s.id && s.token) {
      saved = s;
      want = true;
      st.status = 'reconnecting';
      st.code = s.code;
      TrailRec.holdWake('team', true);
      connectResume();
    }
    refresh();
  }

  function setState(p) { for (var k in p) st[k] = p[k]; refresh(); }

  function refresh() {
    drawMap();
    var c = $('teamChip');
    if (c) {
      c.hidden = st.status === 'off';
      var on = st.members.filter(function (m) { return m.online; }).length;
      c.textContent = 'ทีม ' + (st.code || '') + ' · ' + on + '/' + st.members.length + ' ออนไลน์' + (st.status === 'online' ? '' : ' (กำลังเชื่อมต่อ)');
    }
    if (sheetBody && document.body.contains(sheetBody) && !ui.busy) renderSheet(sheetBody, true);
  }

  function drawMap() {
    var m = ctx.map();
    if (!m.getSource('team-route')) return;
    m.getSource('team-route').setData(st.route && st.route.length > 1
      ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: st.route } } : EMPTY);
    var feats = [];
    st.members.forEach(function (mm) {
      if (mm.pos && mm.id !== st.you) {
        feats.push({ type: 'Feature', properties: { name: mm.name, color: mm.color, online: mm.online ? 1 : 0 }, geometry: { type: 'Point', coordinates: [mm.pos.lng, mm.pos.lat] } });
      }
    });
    m.getSource('team-members').setData({ type: 'FeatureCollection', features: feats });
  }

  /* ---------- เครือข่าย ---------- */
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

  function handle(m) {
    if (onFirst) { var cb = onFirst; onFirst = null; cb(m); }
    if (m.t === 'joined') {
      retry = 0;
      saved = { url: saved ? saved.url : '', code: m.code, id: m.you, token: m.token };
      try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* ไม่เป็นไร */ }
      setState({ status: 'online', code: m.code, you: m.you, error: null });
    } else if (m.t === 'state') setState({ code: m.code, members: m.members, route: m.route });
    else if (m.t === 'pos') {
      st.members.forEach(function (x) { if (x.id === m.id) { x.online = true; x.pos = m.pos; } });
      drawMap();
    } else if (m.t === 'presence') {
      st.members.forEach(function (x) { if (x.id === m.id) x.online = m.online; });
      refresh();
    } else if (m.t === 'route') setState({ route: m.route });
    else if (m.t === 'disbanded' || m.t === 'left') exitTeam(false);
    else if (m.t === 'error') {
      if (m.code === 'resume_failed') { exitTeam(false); setState({ error: ERR.resume_failed }); } else setState({ error: ERR[m.code] || 'ผิดพลาด: ' + m.code });
    }
  }

  function openSocket(url, first) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var sock;
      function fail(msg) { if (!done) { done = true; reject(new Error(msg)); } }
      try { sock = new WebSocket(url); } catch (e) { fail('ที่อยู่เซิร์ฟเวอร์ไม่ถูกต้อง'); return; }
      ws = sock;
      onFirst = function (m) {
        if (done) return;
        done = true;
        if (m.t === 'error') reject(new Error(ERR[m.code] || 'ผิดพลาด: ' + m.code)); else resolve();
      };
      sock.onopen = function () { sock.send(JSON.stringify(first)); };
      sock.onmessage = function (e) { try { handle(JSON.parse(e.data)); } catch (x) { /* ข้อความเสีย */ } };
      sock.onerror = function () { fail('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบที่อยู่เซิร์ฟเวอร์และอินเทอร์เน็ต'); };
      sock.onclose = function () {
        fail('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบที่อยู่เซิร์ฟเวอร์และอินเทอร์เน็ต');
        if (ws === sock) { ws = null; if (want) scheduleReconnect(); }
      };
    });
  }

  function connectResume() {
    if (!saved || ws) return;
    openSocket(saved.url, { t: 'resume', code: saved.code, id: saved.id, token: saved.token }).catch(function () { /* onclose นัดต่อใหม่เอง */ });
  }

  function scheduleReconnect() {
    if (retryTimer || !saved || !want) return;
    setState({ status: 'reconnecting' });
    var delay = Math.min(15000, 1000 * Math.pow(2, retry++));
    retryTimer = setTimeout(function () { retryTimer = 0; if (want) connectResume(); }, delay);
  }

  function reconnectNow() {
    if (!want || !saved) return;
    if (ws && ws.readyState === 1) return;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = 0; }
    retry = 0;
    if (ws && ws.readyState === 0) return;
    ws = null;
    connectResume();
  }

  function onFix(f) {
    if (!want || !f || typeof f.lat !== 'number') return;
    var now = Date.now();
    if (now - lastSent < 2000) return;
    lastSent = now;
    send({ t: 'pos', lat: f.lat, lng: f.lng, alt: typeof f.alt === 'number' ? f.alt : null, acc: typeof f.acc === 'number' ? f.acc : null, ts: f.t || now });
  }

  function normalizeUrl(u) {
    var t = (u || '').trim();
    if (!t) throw new Error('กรุณาใส่ที่อยู่เซิร์ฟเวอร์ เช่น wss://team.example.com');
    if (/^ws:\/\//i.test(t) && location.protocol === 'https:') throw new Error('หน้าเว็บนี้เปิดผ่าน HTTPS ต้องใช้ที่อยู่ที่ขึ้นต้นด้วย wss:// เท่านั้น');
    if (!/^wss?:\/\//i.test(t)) t = 'wss://' + t;
    return t.replace(/\/+$/, '');
  }

  function enter(url, first) {
    want = true;
    saved = { url: url, code: '', id: '', token: '' };
    st = { status: 'connecting', code: null, you: null, members: [], route: null, error: null };
    return openSocket(url, first).then(function () {
      try { localStorage.setItem(UKEY, url); } catch (e) { /* ไม่เป็นไร */ }
      TrailRec.holdWake('team', true);
      try { if (!S.state.fix || Date.now() - S.state.fix.t > 30000) ctx.geolocate.trigger(); } catch (e) { /* ไม่เป็นไร */ }
    }).catch(function (e) {
      want = false;
      saved = null;
      if (ws) { try { ws.close(); } catch (x) { /* ไม่เป็นไร */ } ws = null; }
      st = { status: 'off', code: null, you: null, members: [], route: null, error: null };
      refresh();
      throw e;
    });
  }

  function exitTeam(notify, disband) {
    want = false;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = 0; }
    if (notify) send({ t: disband ? 'disband' : 'leave' });
    var sock = ws;
    ws = null;
    if (sock) setTimeout(function () { try { sock.close(); } catch (e) { /* ไม่เป็นไร */ } }, notify ? 300 : 0);
    saved = null;
    try { localStorage.removeItem(KEY); } catch (e) { /* ไม่เป็นไร */ }
    st = { status: 'off', code: null, you: null, members: [], route: null, error: null };
    TrailRec.holdWake('team', false);
    refresh();
  }

  /* ---------- เส้นทางที่แชร์ ---------- */
  function routeCoords(r) {
    var pts = TrailNav.points(r); // [[lng,lat],...]
    var step = Math.max(1, Math.ceil(pts.length / 2000));
    var out = [];
    for (var i = 0; i < pts.length; i += step) out.push([pts[i][0], pts[i][1]]);
    var last = pts[pts.length - 1];
    if (last && (out[out.length - 1][0] !== last[0] || out[out.length - 1][1] !== last[1])) out.push([last[0], last[1]]);
    return out;
  }

  function routePicker(selected, onPick) {
    var items = TrailNav.items();
    if (!items.length) return '<div class="note">ยังไม่มีเส้นทาง สร้างเส้นทางที่เครื่องมือ "เส้นทาง" (⚑) ก่อน แล้วกลับมาสร้างทีม</div>';
    return items.map(function (r) {
      return '<label class="opt"><input type="radio" name="teamRoute" value="' + esc(r.id) + '"' + (selected === r.id ? ' checked' : '') + '><span>' + esc(r.name) + '<small>' +
        (r.dist >= 1000 ? (r.dist / 1000).toFixed(2) + ' กม.' : Math.round(r.dist) + ' ม.') + ' · ' + r.wps.length + ' จุด</small></span></label>';
    }).join('');
  }

  /* ---------- แผ่นล่าง ---------- */
  function swatches(selected, taken) {
    return '<div style="display:flex;flex-wrap:wrap;gap:10px;margin:6px 0">' + COLORS.map(function (c) {
      var used = taken.indexOf(c) >= 0;
      return '<button type="button" data-color="' + c + '" aria-label="สี ' + c + '"' + (used ? ' disabled' : '') + ' style="width:42px;height:42px;border-radius:50%;background:' + c + ';border:' +
        (selected === c ? '4px solid #000;box-shadow:0 0 0 2px #fff inset' : '2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)') + ';opacity:' + (used ? '.15' : '1') + ';padding:0"></button>';
    }).join('') + '</div>';
  }

  function renderSheet(body, keepInputs) {
    sheetBody = body;
    var keep = {};
    if (keepInputs) ['tmUrl', 'tmName', 'tmCode'].forEach(function (id) { if ($(id)) keep[id] = $(id).value; });
    var inTeam = st.status !== 'off';
    var h = '<div style="background:#fff0f0;border:2px solid #d6261c;border-radius:10px;padding:8px 10px;font-size:12.5px;line-height:1.5;color:#7a0d08;margin-bottom:6px">' +
      '<b>เว็บบน iPhone ส่งตำแหน่งตอนล็อคจอไม่ได้</b> ต้องเปิดจอและเปิดแอพค้างไว้ ถ้าล็อคจอ เพื่อนจะเห็นคุณเป็นออฟไลน์ ต้องมีอินเทอร์เน็ตหรือสัญญาณมือถือจึงเห็นกันได้</div>';
    if (inTeam) {
      var mm = me();
      var host = !!(mm && mm.host);
      h += '<h4>รหัสทีม (ให้เพื่อนใส่เพื่อเข้าทีม)</h4><div style="font-size:34px;font-weight:800;letter-spacing:8px;color:#2e6b3f;text-align:center;user-select:all">' + esc(st.code || '') + '</div>' +
        '<div class="note" style="text-align:center">' + (st.status === 'online' ? 'เชื่อมต่อแล้ว' : 'สัญญาณหลุด กำลังเชื่อมต่อใหม่...') + ' · ' + st.members.length + '/' + MAX_MEMBERS + ' เครื่อง</div>' +
        (st.error ? '<div class="note" style="color:#b3261e">' + esc(st.error) + '</div>' : '') +
        '<h4>สมาชิก</h4>' + st.members.map(function (m) {
          return '<div class="opt" style="gap:10px"><span style="flex:none;width:20px;height:20px;border-radius:50%;background:' + m.color + ';border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></span><span>' +
            esc(m.name) + (m.host ? ' (หัวหน้า)' : '') + (m.id === st.you ? ' (คุณ)' : '') + '</span><small style="flex:none;color:' + (m.online ? '#2e6b3f' : '#999') + '">' + (m.online ? 'ออนไลน์' : 'ออฟไลน์') + '</small></div>';
        }).join('');
      if (host) {
        h += '<h4>เส้นทางของทีม</h4><div class="btnrow"><button class="btn alt" id="tmChg">' + (ui.changeRoute ? 'ยกเลิกการเปลี่ยน' : 'เปลี่ยนเส้นทางที่แชร์') + '</button></div>';
        if (ui.changeRoute) h += routePicker(null) + '<div class="btnrow"><button class="btn" id="tmShare">แชร์เส้นทางที่เลือก</button></div>';
      }
      h += '<div class="btnrow"><button class="btn alt" id="tmLeave" style="color:#b3261e">ออกจากทีม</button>' + (host ? '<button class="btn alt" id="tmDisband" style="color:#b3261e">ยุบทีม</button>' : '') + '</div>';
    } else {
      var url = '';
      try { url = localStorage.getItem(UKEY) || ''; } catch (e) { url = ''; }
      h += '<div class="seg"><button id="tmCreate" aria-pressed="' + (ui.mode === 'create') + '">สร้างทีม</button><button id="tmJoin" aria-pressed="' + (ui.mode === 'join') + '">เข้าร่วมทีม</button></div>' +
        '<div class="field"><label>เซิร์ฟเวอร์</label><input type="text" id="tmUrl" placeholder="wss://team.example.com" autocapitalize="none" autocorrect="off" spellcheck="false" style="flex:1;min-width:0;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px"></div>' +
        (ui.mode === 'join' ? '<div class="field"><label>รหัสทีม</label><input type="text" id="tmCode" maxlength="6" autocapitalize="characters" autocorrect="off" style="flex:1;min-width:0;font-size:22px;letter-spacing:6px;text-align:center;padding:8px;border:1px solid #ccc;border-radius:8px"></div>' : '') +
        '<div class="field"><label>ชื่อ (≤' + MAX_NAME + ')</label><input type="text" id="tmName" maxlength="' + MAX_NAME + '" placeholder="เช่น น้องฟ้า" style="flex:1;min-width:0;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px"></div>' +
        '<div class="note" id="tmCount"></div><h4>สีของคุณบนแผนที่ (แต่ละคนในทีมไม่ซ้ำกัน)</h4>' + swatches(ui.color, []) +
        (ui.mode === 'create' ? '<h4>เลือกเส้นทางที่จะแชร์ให้ทีม</h4>' + routePicker(ui.routeId) : '') +
        '<div class="btnrow"><button class="btn" id="tmGo">' + (ui.mode === 'create' ? 'สร้างทีม' : 'เข้าร่วมทีม') + '</button></div>' +
        '<div class="note">ต้องมีอินเทอร์เน็ตหรือสัญญาณมือถือเพื่อเห็นตำแหน่งเพื่อน ถ้าไม่มีสัญญาณ แผนที่และ GPS ของเครื่องคุณยังใช้ได้ปกติ</div>';
      body.innerHTML = h;
      $('tmUrl').value = keep.tmUrl !== undefined ? keep.tmUrl : url;
      $('tmName').value = keep.tmName || '';
      if ($('tmCode') && keep.tmCode) $('tmCode').value = keep.tmCode;
      bindOut(body);
      return;
    }
    body.innerHTML = h;
    bindIn(body);
  }

  function bindOut(body) {
    function count() { $('tmCount').textContent = chars($('tmName').value) + '/' + MAX_NAME; }
    $('tmName').oninput = count;
    count();
    if ($('tmCode')) $('tmCode').oninput = function () { this.value = this.value.toUpperCase(); };
    $('tmCreate').onclick = function () { ui.mode = 'create'; renderSheet(body, true); };
    $('tmJoin').onclick = function () { ui.mode = 'join'; renderSheet(body, true); };
    Array.prototype.forEach.call(body.querySelectorAll('[data-color]'), function (b) {
      b.onclick = function () { ui.color = b.getAttribute('data-color'); renderSheet(body, true); };
    });
    Array.prototype.forEach.call(body.querySelectorAll('input[name=teamRoute]'), function (r) {
      r.onchange = function () { ui.routeId = r.value; };
    });
    $('tmGo').onclick = function () {
      var name = $('tmName').value.trim().replace(/\s+/g, ' ');
      if (!name) { ctx.toast('กรุณาใส่ชื่อ'); return; }
      if (chars(name) > MAX_NAME) { ctx.toast('ชื่อต้องไม่เกิน ' + MAX_NAME + ' ตัวอักษร'); return; }
      var url;
      try { url = normalizeUrl($('tmUrl').value); } catch (e) { ctx.toast(e.message); return; }
      var first;
      if (ui.mode === 'create') {
        var r = TrailNav.items().filter(function (x) { return x.id === ui.routeId; })[0];
        if (!r) { ctx.toast('เลือกเส้นทางที่จะแชร์ให้ทีมก่อน'); return; }
        first = { t: 'create', name: name, color: ui.color, route: routeCoords(r) };
      } else {
        var code = ($('tmCode').value || '').trim().toUpperCase();
        if (code.length < 4) { ctx.toast('กรุณาใส่รหัสทีมที่ได้จากหัวหน้า'); return; }
        first = { t: 'join', code: code, name: name, color: ui.color };
      }
      ui.busy = true;
      $('tmGo').disabled = true;
      $('tmGo').textContent = 'กำลังเชื่อมต่อ...';
      enter(url, first).then(function () { ui.busy = false; renderSheet(body); }).catch(function (e) {
        ui.busy = false;
        ctx.toast(e.message);
        if ($('tmGo')) { $('tmGo').disabled = false; $('tmGo').textContent = ui.mode === 'create' ? 'สร้างทีม' : 'เข้าร่วมทีม'; }
      });
    };
  }

  function bindIn(body) {
    if ($('tmChg')) $('tmChg').onclick = function () { ui.changeRoute = !ui.changeRoute; renderSheet(body); };
    if ($('tmShare')) $('tmShare').onclick = function () {
      var sel = body.querySelector('input[name=teamRoute]:checked');
      var r = sel && TrailNav.items().filter(function (x) { return x.id === sel.value; })[0];
      if (!r) { ctx.toast('เลือกเส้นทางก่อน'); return; }
      send({ t: 'route', route: routeCoords(r) });
      ui.changeRoute = false;
      ctx.toast('แชร์เส้นทางใหม่ให้ทีมแล้ว');
      renderSheet(body);
    };
    $('tmLeave').onclick = function () {
      if (!confirm(me() && me().host ? 'ออกจากทีม? สิทธิ์หัวหน้าจะโอนให้คนถัดไป' : 'ออกจากทีมนี้?')) return;
      exitTeam(true, false);
    };
    if ($('tmDisband')) $('tmDisband').onclick = function () { if (confirm('ยุบทีมทั้งหมด? ทุกคนจะถูกนำออก')) exitTeam(true, true); };
  }

  root.TrailTeam = { init: init, renderSheet: renderSheet };
})(typeof self !== 'undefined' ? self : this);
