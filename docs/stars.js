// ดวงดาวนำทาง: คำนวณตำแหน่งดาว/ดวงอาทิตย์/ดวงจันทร์จากพิกัดและเวลาในเครื่อง (ไม่ใช้อินเทอร์เน็ต)
// มีแผนที่ฟ้า วิธีหาทิศจากดาว และโหมดส่องฟ้าผ่านกล้อง (AR)
(function (root) {
  var G = TrailGeo;
  var S = TrailSensors;
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;
  var FOV_LONG = 69; // มุมมองด้านยาวของกล้องหลัง (องศา โดยประมาณ)
  var ctx = null;
  var sky = { off: 0, sel: null, timer: 0 };
  var ar = null;

  // ดาวสว่าง (พิกัด J2000: RA เป็นชั่วโมง, Dec เป็นองศา)
  var STARS = [
    { id: 'sirius', th: 'ซิริอุส', en: 'Sirius', ra: 6.7525, dec: -16.716, mag: -1.46, hint: 'ดาวที่สว่างที่สุดบนฟ้ายามค่ำ' },
    { id: 'canopus', th: 'คาโนปุส', en: 'Canopus', ra: 6.3992, dec: -52.696, mag: -0.74, hint: 'สว่างอันดับสอง อยู่ฟ้าทางใต้' },
    { id: 'arcturus', th: 'อาร์คทูรัส', en: 'Arcturus', ra: 14.261, dec: 19.182, mag: -0.05, hint: 'ดาวสีส้มสว่าง ต่อโค้งจากหางจระเข้ของกระบวยใหญ่' },
    { id: 'rigilkent', th: 'ริจิลเคนต์', en: 'Rigil Kent', ra: 14.66, dec: -60.835, mag: -0.01, hint: 'คู่กับฮาดาร์ ชี้ไปหาไม้กางเขนใต้' },
    { id: 'vega', th: 'เวกา', en: 'Vega', ra: 18.6156, dec: 38.784, mag: 0.03, hint: 'ขาวฟ้าสว่าง มุมหนึ่งของสามเหลี่ยมฤดูร้อน' },
    { id: 'capella', th: 'คาเพลลา', en: 'Capella', ra: 5.2782, dec: 45.998, mag: 0.08, hint: 'สีเหลืองสว่าง ฟ้าทิศเหนือค่อนตะวันออก' },
    { id: 'rigel', th: 'ไรเจล', en: 'Rigel', ra: 5.2423, dec: -8.202, mag: 0.13, hint: 'ขาวฟ้า มุมล่างขวาของนายพราน' },
    { id: 'procyon', th: 'โพรไซออน', en: 'Procyon', ra: 7.655, dec: 5.225, mag: 0.34, hint: 'ขาวสว่าง ตามหลังนายพรานขึ้นมา' },
    { id: 'achernar', th: 'อะเคอร์นาร์', en: 'Achernar', ra: 1.6286, dec: -57.237, mag: 0.46, hint: 'สว่าง อยู่ฟ้าทิศใต้' },
    { id: 'betelgeuse', th: 'เบเทลจุส', en: 'Betelgeuse', ra: 5.9195, dec: 7.407, mag: 0.5, hint: 'ดาวสีแดงส้ม มุมบนซ้ายของนายพราน' },
    { id: 'hadar', th: 'ฮาดาร์', en: 'Hadar', ra: 14.0637, dec: -60.373, mag: 0.61, hint: 'ดาวชี้คู่กับริจิลเคนต์ ไปทางไม้กางเขนใต้' },
    { id: 'altair', th: 'อัลแตร์', en: 'Altair', ra: 19.8464, dec: 8.868, mag: 0.76, hint: 'ดาวสว่างกลางสามเหลี่ยมฤดูร้อน' },
    { id: 'acrux', th: 'อะครักซ์', en: 'Acrux', ra: 12.4433, dec: -63.099, mag: 0.76, hint: 'ปลายล่างของไม้กางเขนใต้ (ชี้ทิศใต้)' },
    { id: 'aldebaran', th: 'อัลเดบารัน', en: 'Aldebaran', ra: 4.5987, dec: 16.509, mag: 0.85, hint: 'ดาวสีส้ม ต่อจากเข็มขัดนายพรานขึ้นไปทางขวา' },
    { id: 'antares', th: 'แอนทาเรส', en: 'Antares', ra: 16.4901, dec: -26.432, mag: 1.06, hint: 'ดาวสีแดงใจกลางแมงป่อง ฟ้าทิศใต้ช่วงฤดูร้อน' },
    { id: 'spica', th: 'สไปกา', en: 'Spica', ra: 13.4199, dec: -11.161, mag: 0.97, hint: 'ขาวฟ้า ต่อโค้งจากอาร์คทูรัสลงมา' },
    { id: 'pollux', th: 'พอลลักซ์', en: 'Pollux', ra: 7.7553, dec: 28.026, mag: 1.14, hint: 'คู่กับคาสเตอร์ (ฝาแฝด)' },
    { id: 'fomalhaut', th: 'โฟมัลโอต์', en: 'Fomalhaut', ra: 22.9608, dec: -29.622, mag: 1.16, hint: 'ดาวโดดเดี่ยวสว่างทางใต้' },
    { id: 'deneb', th: 'เดเนบ', en: 'Deneb', ra: 20.6905, dec: 45.28, mag: 1.25, hint: 'หางหงส์ มุมหนึ่งของสามเหลี่ยมฤดูร้อน' },
    { id: 'mimosa', th: 'มิโมซา', en: 'Mimosa', ra: 12.7953, dec: -59.689, mag: 1.25, hint: 'แขนซ้ายของไม้กางเขนใต้' },
    { id: 'regulus', th: 'เรกูลัส', en: 'Regulus', ra: 10.1395, dec: 11.967, mag: 1.35, hint: 'หัวใจสิงโต ใกล้เส้นสุริยวิถี' },
    { id: 'castor', th: 'คาสเตอร์', en: 'Castor', ra: 7.5767, dec: 31.888, mag: 1.58, hint: 'ฝาแฝด คู่กับพอลลักซ์' },
    { id: 'gacrux', th: 'กาครักซ์', en: 'Gacrux', ra: 12.5194, dec: -57.113, mag: 1.64, hint: 'ปลายบนของไม้กางเขนใต้' },
    { id: 'bellatrix', th: 'เบลลาทริกซ์', en: 'Bellatrix', ra: 5.4189, dec: 6.35, mag: 1.64, hint: 'ไหล่ขวาของนายพราน' },
    { id: 'shaula', th: 'ชอลา', en: 'Shaula', ra: 17.5601, dec: -37.104, mag: 1.62, hint: 'เหล็กในหางแมงป่อง' },
    { id: 'alnilam', th: 'อัลนิแลม', en: 'Alnilam', ra: 5.6036, dec: -1.202, mag: 1.69, hint: 'ดาวกลางเข็มขัดนายพราน' },
    { id: 'alnitak', th: 'อัลนิตัก', en: 'Alnitak', ra: 5.6793, dec: -1.943, mag: 1.74, hint: 'ปลายเข็มขัดนายพราน' },
    { id: 'mintaka', th: 'มินตากา', en: 'Mintaka', ra: 5.5334, dec: -0.299, mag: 2.23, hint: 'ปลายเข็มขัดนายพราน อยู่บนเส้นศูนย์สูตรฟ้า ขึ้นตรงทิศตะวันออก ตกตรงทิศตะวันตก' },
    { id: 'saiph', th: 'ไซฟ์', en: 'Saiph', ra: 5.7959, dec: -9.67, mag: 2.06, hint: 'เข่าซ้ายของนายพราน' },
    { id: 'dubhe', th: 'ดูเบ', en: 'Dubhe', ra: 11.0621, dec: 61.751, mag: 1.8, hint: 'ปลายกระบวยใหญ่ (ดาวชี้) ' },
    { id: 'merak', th: 'เมรัก', en: 'Merak', ra: 11.0307, dec: 56.382, mag: 2.37, hint: 'ดาวชี้ของกระบวยใหญ่ ลากผ่านดูเบไปหาโพลาริส' },
    { id: 'phecda', th: 'เฟคดา', en: 'Phecda', ra: 11.8972, dec: 53.695, mag: 2.44, hint: 'ก้นกระบวยใหญ่' },
    { id: 'megrez', th: 'เมเกรซ', en: 'Megrez', ra: 12.2571, dec: 57.033, mag: 3.3, hint: 'จุดต่อระหว่างกระบวยกับด้าม' },
    { id: 'alioth', th: 'อลิโอธ', en: 'Alioth', ra: 12.9005, dec: 55.96, mag: 1.77, hint: 'ด้ามกระบวยใหญ่' },
    { id: 'mizar', th: 'ไมซาร์', en: 'Mizar', ra: 13.3988, dec: 54.925, mag: 2.27, hint: 'ด้ามกระบวยใหญ่' },
    { id: 'alkaid', th: 'อัลไคด์', en: 'Alkaid', ra: 13.7923, dec: 49.313, mag: 1.86, hint: 'ปลายด้ามกระบวยใหญ่' },
    { id: 'polaris', th: 'โพลาริส (ดาวเหนือ)', en: 'Polaris', ra: 2.5303, dec: 89.264, mag: 2.0, hint: 'ชี้ทิศเหนือจริง ความสูงเหนือขอบฟ้า ≈ ละติจูดของผู้สังเกต' },
    { id: 'schedar', th: 'เชดาร์', en: 'Schedar', ra: 0.6751, dec: 56.537, mag: 2.24, hint: 'แคสซิโอเปีย ใช้หาโพลาริสได้' },
    { id: 'caph', th: 'คาฟ', en: 'Caph', ra: 0.153, dec: 59.15, mag: 2.27, hint: 'แคสซิโอเปีย ใช้หาโพลาริสได้' },
    { id: 'alphard', th: 'อัลฟาร์ด', en: 'Alphard', ra: 9.4598, dec: -8.659, mag: 2.0, hint: 'ดาวสีส้มโดดเดี่ยว (หัวใจงูไฮดรา)' },
    { id: 'deltacru', th: 'เดลตาครูซิส', en: 'Delta Cru', ra: 12.2524, dec: -58.749, mag: 2.8, hint: 'แขนขวาของไม้กางเขนใต้' }
  ];
  var BYID = {};
  STARS.forEach(function (s) { BYID[s.id] = s; });

  // เส้นเชื่อมกลุ่มดาว
  var LINES = [
    ['dubhe', 'merak'], ['merak', 'phecda'], ['phecda', 'megrez'], ['megrez', 'dubhe'], ['megrez', 'alioth'], ['alioth', 'mizar'], ['mizar', 'alkaid'],
    ['acrux', 'gacrux'], ['mimosa', 'deltacru'], ['hadar', 'rigilkent'],
    ['betelgeuse', 'bellatrix'], ['betelgeuse', 'alnitak'], ['bellatrix', 'mintaka'], ['alnitak', 'alnilam'], ['alnilam', 'mintaka'], ['alnitak', 'saiph'], ['mintaka', 'rigel'],
    ['caph', 'schedar'], ['vega', 'altair'], ['altair', 'deneb'], ['deneb', 'vega'], ['sirius', 'procyon'], ['procyon', 'betelgeuse'], ['betelgeuse', 'sirius'],
    ['antares', 'shaula']
  ];
  // เส้นต่อไปหาขั้วฟ้า: ลากจาก a ผ่าน b ต่อไปอีก (kmax เท่าของระยะ a-b)
  var POINTERS = [
    { from: 'gacrux', to: 'acrux', kmax: 5.5, name: 'ทิศใต้ (ไม้กางเขนใต้)', color: '#ff9f43' },
    { from: 'merak', to: 'dubhe', kmax: 6.0, name: 'โพลาริส = ทิศเหนือ (กระบวยใหญ่)', color: '#4fd1ff' }
  ];
  var LABELED = { polaris: 1, acrux: 1, gacrux: 1, mimosa: 1, alnilam: 1, mintaka: 1, alnitak: 1, dubhe: 1, merak: 1, antares: 1 };
  var DIRS = ['เหนือ', 'ตะวันออกเฉียงเหนือ', 'ตะวันออก', 'ตะวันออกเฉียงใต้', 'ใต้', 'ตะวันตกเฉียงใต้', 'ตะวันตก', 'ตะวันตกเฉียงเหนือ'];

  function $(id) { return document.getElementById(id); }
  function norm180(a) { a = G.norm360(a); return a > 180 ? a - 360 : a; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function dirName(az) { return DIRS[Math.round(G.norm360(az) / 45) % 8]; }
  function mil(az) { return Math.round((az * 6400) / 360); }
  function nowJD(offMin) { return Date.now() / 86400000 + 2440587.5 + (offMin || 0) / 1440; }
  function hhmm(jd) {
    var d = new Date((jd - 2440587.5) * 86400000);
    return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }

  /* ---------- ดาราศาสตร์ ---------- */
  function gmst(jd) {
    var T = (jd - 2451545) / 36525;
    return G.norm360(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T);
  }
  function eqNow(st, jd) { // แก้การส่ายของแกนโลก (precession) จาก J2000
    var y = (jd - 2451545) / 365.25;
    var a = st.ra * 15 * D2R, d = st.dec * D2R;
    var dra = (3.07496 + 1.33621 * Math.sin(a) * Math.tan(d)) * y / 3600;
    var ddec = 20.0431 * Math.cos(a) * y / 3600;
    return { ra: st.ra + dra, dec: st.dec + ddec };
  }
  function altAz(ra, dec, lat, lng, jd) {
    var H = (gmst(jd) + lng) * D2R - ra * 15 * D2R;
    var d = dec * D2R, p = lat * D2R;
    var alt = Math.asin(clamp(Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(H), -1, 1)) * R2D;
    var az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(p) - Math.tan(d) * Math.cos(p)) * R2D + 180;
    return { alt: alt, az: G.norm360(az) };
  }
  function refraction(alt) { // การหักเหของบรรยากาศ (องศา)
    if (alt < -1) return 0;
    return 1.02 / Math.tan((alt + 10.3 / (alt + 5.11)) * D2R) / 60;
  }
  function eclToEq(lonDeg, latDeg) {
    var e = 23.439 * D2R, l = lonDeg * D2R, b = latDeg * D2R;
    var x = Math.cos(b) * Math.cos(l);
    var y = Math.cos(b) * Math.sin(l) * Math.cos(e) - Math.sin(b) * Math.sin(e);
    var z = Math.cos(b) * Math.sin(l) * Math.sin(e) + Math.sin(b) * Math.cos(e);
    return { ra: G.norm360(Math.atan2(y, x) * R2D) / 15, dec: Math.asin(clamp(z, -1, 1)) * R2D };
  }
  function sunLon(jd) {
    var n = jd - 2451545;
    var L = 280.46 + 0.9856474 * n;
    var g = (357.528 + 0.9856003 * n) * D2R;
    return G.norm360(L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));
  }
  function moonLon(jd) {
    var T = (jd - 2451545) / 36525;
    function s(a, b) { return Math.sin((a + b * T) * D2R); }
    return G.norm360(218.32 + 481267.881 * T + 6.29 * s(135.0, 477198.87) - 1.27 * s(259.3, -413335.36) + 0.66 * s(235.7, 890534.22) +
      0.21 * s(269.9, 954397.74) - 0.19 * s(357.5, 35999.05) - 0.11 * s(186.5, 966404.03));
  }
  function moonEq(jd) {
    var T = (jd - 2451545) / 36525;
    function s(a, b) { return Math.sin((a + b * T) * D2R); }
    var lat = 5.13 * s(93.3, 483202.02) + 0.28 * s(228.2, 960400.89) - 0.28 * s(318.3, 6003.15) - 0.17 * s(217.6, -407332.21);
    var ml = moonLon(jd);
    var q = eclToEq(ml, lat);
    var el = G.norm360(ml - sunLon(jd));
    q.illum = (1 - Math.cos(el * D2R)) / 2;
    q.waxing = el < 180;
    q.elong = el;
    return q;
  }

  function place(b, ra, dec, o, jd, par) {
    var h = altAz(ra, dec, o.lat, o.lng, jd);
    var alt = h.alt;
    if (par) alt -= par * Math.cos(alt * D2R);
    b.ra = ra; b.dec = dec; b.az = h.az; b.alt = alt + refraction(alt);
    return b;
  }
  function bodyAt(id, jd, o) {
    if (id === 'sun') {
      var su = eclToEq(sunLon(jd), 0);
      return place({ id: 'sun', th: 'ดวงอาทิตย์', en: 'Sun', mag: -26, kind: 'sun' }, su.ra, su.dec, o, jd);
    }
    if (id === 'moon') {
      var mo = moonEq(jd);
      var m = place({ id: 'moon', th: 'ดวงจันทร์', en: 'Moon', mag: -12, kind: 'moon', illum: mo.illum, waxing: mo.waxing, elong: mo.elong }, mo.ra, mo.dec, o, jd, 0.95);
      return m;
    }
    var st = BYID[id];
    var e = eqNow(st, jd);
    return place({ id: st.id, th: st.th, en: st.en, mag: st.mag, kind: 'star', hint: st.hint }, e.ra, e.dec, o, jd);
  }
  function allBodies(jd, o) {
    var list = STARS.map(function (st) { return bodyAt(st.id, jd, o); });
    list.push(bodyAt('sun', jd, o));
    list.push(bodyAt('moon', jd, o));
    return list;
  }
  function riseSet(id, o, jd0) {
    var prev = null, rise = null, set = null;
    for (var m = 0; m <= 1440 && (rise === null || set === null); m += 5) {
      var a = bodyAt(id, jd0 + m / 1440, o).alt;
      if (prev !== null) {
        if (prev < 0 && a >= 0 && rise === null) rise = m;
        if (prev >= 0 && a < 0 && set === null) set = m;
      }
      prev = a;
    }
    return { rise: rise === null ? null : jd0 + rise / 1440, set: set === null ? null : jd0 + set / 1440 };
  }

  // จุดบนเส้นต่อ (ลาก a ผ่าน b) ด้วยเวกเตอร์ในทรงกลมฟ้า
  function vec(e) {
    var a = e.ra * 15 * D2R, d = e.dec * D2R;
    return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  }
  function pointerPath(pt, o, jd) {
    var a = vec(eqNow(BYID[pt.from], jd)), b = vec(eqNow(BYID[pt.to], jd));
    var out = [];
    for (var k = 1; k <= pt.kmax + 1e-6; k += 0.25) {
      var v = [a[0] + k * (b[0] - a[0]), a[1] + k * (b[1] - a[1]), a[2] + k * (b[2] - a[2])];
      var n = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
      var ra = G.norm360(Math.atan2(v[1], v[0]) * R2D) / 15, dec = Math.asin(clamp(v[2] / n, -1, 1)) * R2D;
      var h = altAz(ra, dec, o.lat, o.lng, jd);
      out.push({ az: h.az, alt: h.alt });
    }
    return out;
  }

  /* ---------- ผู้สังเกต ---------- */
  function observer() {
    var f = S.state.fix;
    if (f && Date.now() - f.t < 600000) return { lat: f.lat, lng: f.lng, gps: true };
    var c = ctx.map().getCenter();
    return { lat: c.lat, lng: c.lng, gps: false };
  }

  function init(c) {
    ctx = c;
    var map = ctx.map();
    map.addSource('sky-line', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'sky-line', type: 'line', source: 'sky-line', paint: { 'line-color': '#ffcc00', 'line-width': 3.5, 'line-dasharray': [4, 2] } }, 'grid-lines');
  }

  // ปักเส้นทิศของดาวบนแผนที่
  function drawLine(b) {
    var o = observer();
    var end = G.destination(o, b.az, 20000);
    var map = ctx.map();
    map.getSource('sky-line').setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[o.lng, o.lat], [end.lng, end.lat]] } }]
    });
    map.fitBounds([[Math.min(o.lng, end.lng), Math.min(o.lat, end.lat)], [Math.max(o.lng, end.lng), Math.max(o.lat, end.lat)]], { padding: 70, maxZoom: 15, duration: 600 });
    var conv = G.convergence(o.lat, o.lng);
    ctx.toast('แนวทิศ' + b.th + ' ตอนนี้: เหนือจริง ' + b.az.toFixed(1) + '° · มุมกริด ' + G.norm360(b.az - conv).toFixed(1) + '°');
  }
  function clearLine() {
    ctx.map().getSource('sky-line').setData({ type: 'FeatureCollection', features: [] });
  }

  /* ---------- แผงดวงดาว ---------- */
  function renderSheet(body) {
    sky.off = 0;
    body.innerHTML =
      '<div class="note" id="skyTop" style="margin:0 0 6px"></div>' +
      '<canvas id="skyCv" style="width:100%;max-width:340px;height:auto;display:block;margin:0 auto;border-radius:12px;touch-action:manipulation"></canvas>' +
      '<div class="field"><label style="flex:0 0 52px">เวลา</label><input type="range" id="skyT" min="-720" max="720" step="10" value="0" style="flex:1"><span id="skyTl" style="flex:0 0 74px;text-align:right"></span></div>' +
      '<div class="btnrow"><button class="btn" id="skyAR">◉ ส่องฟ้าด้วยกล้อง</button><button class="btn alt" id="skyNow">เวลาปัจจุบัน</button></div>' +
      '<div id="skySel"></div>' +
      '<h4>วิธีหาทิศจากดาว (ตามเวลา/ที่อยู่ตอนนี้)</h4><div id="skyGuides"></div>' +
      '<h4>เดินตามดาว</h4>' +
      '<div class="field"><label style="flex:0 0 120px">ทิศที่จะไป (°จริง)</label><input type="number" id="skyBrg" inputmode="decimal" placeholder="เช่น 90"><button class="btn alt" id="skyBrgC" style="flex:none;padding:8px 10px">ใช้ทิศเครื่อง</button></div>' +
      '<div class="btnrow"><button class="btn" id="skyFind">หาดาวนำทาง</button><button class="btn alt" id="skyClear">ล้างเส้นบนแผนที่</button></div>' +
      '<div id="skyFollow" class="note"></div>' +
      '<p class="note">คำนวณจากพิกัดและเวลาของเครื่อง ใช้ออฟไลน์ได้ ความคลาดเคลื่อน < 1° ต้องตั้งเวลาเครื่องให้ถูก · ดาวเคราะห์ (ศุกร์/พฤหัสฯ) ยังไม่รวม อาจสว่างกว่าดาวฤกษ์ ถ้าดวงที่เห็นสว่างผิดปกติและไม่อยู่ในแผนที่ ให้ระวังว่าเป็นดาวเคราะห์</p>';
    $('skyT').oninput = function () { sky.off = parseInt(this.value, 10) || 0; refresh(); };
    $('skyNow').onclick = function () { sky.off = 0; $('skyT').value = 0; refresh(); };
    $('skyAR').onclick = function () { openAR(); };
    $('skyClear').onclick = clearLine;
    $('skyBrgC').onclick = function () {
      S.start().then(function () {
        var h = S.headingTrue();
        if (h === null) ctx.toast('ยังไม่ได้ข้อมูลเข็มทิศ');
        else $('skyBrg').value = Math.round(h);
      });
    };
    $('skyFind').onclick = function () {
      var v = parseFloat($('skyBrg').value);
      if (isNaN(v)) { $('skyFollow').textContent = 'ใส่ทิศที่จะเดินไป (0–360° จากทิศเหนือจริง) ก่อน'; return; }
      renderFollow(G.norm360(v));
    };
    var cv = $('skyCv');
    cv.addEventListener('click', function (e) {
      var r = cv.getBoundingClientRect();
      pick((e.clientX - r.left) * (sky.size / r.width), (e.clientY - r.top) * (sky.size / r.height));
    });
    clearInterval(sky.timer);
    sky.timer = setInterval(function () {
      if (!document.body.contains($('skyCv'))) { clearInterval(sky.timer); return; }
      if (sky.off === 0) refresh();
    }, 15000);
    refresh();
  }

  function refresh() {
    var cv = $('skyCv');
    if (!cv) return;
    var o = observer();
    var jd = nowJD(sky.off);
    sky.o = o; sky.jd = jd;
    sky.bodies = allBodies(jd, o);
    $('skyTop').textContent = (o.gps ? 'ตำแหน่ง GPS ' : 'ตำแหน่งกลางจอแผนที่ ') + ctx.fmtPoint(o.lat, o.lng);
    $('skyTl').textContent = sky.off === 0 ? 'ตอนนี้ ' + hhmm(jd) : (sky.off > 0 ? '+' : '') + (sky.off / 60).toFixed(1).replace('.0', '') + ' ชม. ' + hhmm(jd);
    drawDome(cv);
    renderSel();
    renderGuides();
  }

  var DOME_PX = 340;
  function drawDome(cv) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = DOME_PX;
    sky.size = W;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = W * dpr; }
    var c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    var cx = W / 2, cy = W / 2, R = W / 2 - 24;
    sky.cx = cx; sky.cy = cy; sky.R = R;
    var g = c.createRadialGradient(cx, cy, 0, cx, cy, W / 2);
    g.addColorStop(0, '#16275a'); g.addColorStop(1, '#070b1c');
    c.fillStyle = g; c.fillRect(0, 0, W, W);
    function P(az, alt) {
      var r = (90 - alt) / 90 * R;
      return { x: cx - r * Math.sin(az * D2R), y: cy - r * Math.cos(az * D2R) };
    }
    c.strokeStyle = 'rgba(255,255,255,.22)'; c.lineWidth = 1;
    [0, 30, 60].forEach(function (a) { c.beginPath(); c.arc(cx, cy, (90 - a) / 90 * R, 0, 7); c.stroke(); });
    c.beginPath(); c.moveTo(cx, cy - R); c.lineTo(cx, cy + R); c.moveTo(cx - R, cy); c.lineTo(cx + R, cy); c.stroke();
    c.font = 'bold 14px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    [['N', 0, '#ff6b5e'], ['E', 90, '#fff'], ['S', 180, '#fff'], ['W', 270, '#fff']].forEach(function (d) {
      var p = P(d[1], -6); c.fillStyle = d[2]; c.fillText(d[0], p.x, p.y);
    });
    var byId = {};
    sky.bodies.forEach(function (b) { byId[b.id] = b; });
    // เส้นกลุ่มดาว
    c.strokeStyle = 'rgba(140,170,255,.45)'; c.lineWidth = 1;
    LINES.forEach(function (l) {
      var a = byId[l[0]], b = byId[l[1]];
      if (a.alt < 0 || b.alt < 0) return;
      var p1 = P(a.az, a.alt), p2 = P(b.az, b.alt);
      c.beginPath(); c.moveTo(p1.x, p1.y); c.lineTo(p2.x, p2.y); c.stroke();
    });
    // เส้นชี้หาทิศ
    POINTERS.forEach(function (pt) {
      var path = pointerPath(pt, sky.o, sky.jd);
      c.strokeStyle = pt.color; c.lineWidth = 1.6; c.setLineDash([5, 4]);
      c.beginPath();
      var started = false;
      path.forEach(function (q) {
        if (q.alt < 0) { started = false; return; }
        var p = P(q.az, q.alt);
        if (!started) { c.moveTo(p.x, p.y); started = true; } else c.lineTo(p.x, p.y);
      });
      c.stroke(); c.setLineDash([]);
      var end = path[path.length - 1];
      var pe = P(end.az, Math.max(end.alt, 0));
      c.fillStyle = pt.color; c.beginPath(); c.arc(pe.x, pe.y, 3.5, 0, 7); c.fill();
    });
    // ดาว
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    sky.bodies.forEach(function (b) {
      if (b.alt < 0) return;
      var p = P(b.az, b.alt);
      b._x = p.x; b._y = p.y;
      if (b.kind === 'sun') {
        c.fillStyle = '#ffd24a'; c.beginPath(); c.arc(p.x, p.y, 8, 0, 7); c.fill();
        c.fillStyle = '#ffd24a'; c.font = '11px sans-serif'; c.fillText('ดวงอาทิตย์', p.x + 11, p.y + 4);
      } else if (b.kind === 'moon') {
        c.fillStyle = '#e8e6c8'; c.beginPath(); c.arc(p.x, p.y, 7, 0, 7); c.fill();
        c.font = '11px sans-serif'; c.fillText('ดวงจันทร์ ' + Math.round(b.illum * 100) + '%', p.x + 10, p.y + 4);
      } else {
        var r = Math.max(1.6, 3.6 - b.mag * 0.7);
        c.fillStyle = b.id === 'polaris' ? '#4fd1ff' : '#fff';
        c.beginPath(); c.arc(p.x, p.y, r, 0, 7); c.fill();
        if (b.mag <= 2.0 || LABELED[b.id]) {
          c.fillStyle = 'rgba(255,255,255,.85)'; c.font = '10px sans-serif';
          c.fillText(b.th.replace(' (ดาวเหนือ)', ''), p.x + r + 3, p.y + 3);
        }
      }
      if (sky.sel === b.id) {
        c.strokeStyle = '#ffd24a'; c.lineWidth = 2; c.beginPath(); c.arc(p.x, p.y, 11, 0, 7); c.stroke();
      }
    });
    // ทิศที่เครื่องหันอยู่
    var h = S.headingTrue();
    if (h !== null) {
      var ph = P(h, -2);
      c.fillStyle = '#2ee66b'; c.beginPath(); c.arc(ph.x, ph.y, 5, 0, 7); c.fill();
    }
  }

  function pick(x, y) {
    var best = null, bd = 22;
    (sky.bodies || []).forEach(function (b) {
      if (b.alt < 0 || b._x === undefined) return;
      var d = Math.hypot(b._x - x, b._y - y);
      if (d < bd) { bd = d; best = b; }
    });
    sky.sel = best ? best.id : null;
    drawDome($('skyCv'));
    renderSel();
  }

  function info(b, o) {
    var conv = G.convergence(o.lat, o.lng);
    var grid = G.norm360(b.az - conv);
    var s = 'ทิศเหนือจริง <b>' + b.az.toFixed(1) + '°</b> (' + dirName(b.az) + ') · มุมกริด ' + grid.toFixed(1) + '° (' + mil(grid) + ' มิล)';
    var decl = ctx.prefs.decl || 0;
    if (decl) s += ' · แม่เหล็ก ' + G.norm360(b.az - decl).toFixed(1) + '°';
    s += '<br>สูงจากขอบฟ้า <b>' + b.alt.toFixed(1) + '°</b>';
    return s;
  }

  function renderSel() {
    var box = $('skySel');
    if (!box) return;
    var b = null;
    (sky.bodies || []).forEach(function (x) { if (x.id === sky.sel) b = x; });
    if (!b) { box.innerHTML = '<p class="note">แตะดาวบนแผนที่ฟ้าเพื่อดูทิศ ความสูง เวลาขึ้น/ตก (จุดเขียวขอบวง = ทิศที่เครื่องหัน)</p>'; return; }
    var rs = riseSet(b.id, sky.o, sky.jd);
    var h = '<div class="prow"><b>' + b.th + (b.kind === 'star' ? ' · ' + b.en + ' · ความสว่าง ' + b.mag.toFixed(1) : '') + '</b><br>' + info(b, sky.o) +
      '<br><span class="lbl" style="color:#666;font-size:12px">ขึ้น ' + (rs.rise ? hhmm(rs.rise) : '–') + ' · ตก ' + (rs.set ? hhmm(rs.set) : '–') + ' (ภายใน 24 ชม.)' +
      (b.hint ? '<br>' + b.hint : '') + '</span>' +
      '<div class="btnrow"><button class="btn" id="skyDraw">ปักแนวทิศนี้บนแผนที่</button></div></div>';
    box.innerHTML = h;
    $('skyDraw').onclick = function () { drawLine(b); };
  }

  function renderGuides() {
    var box = $('skyGuides');
    if (!box) return;
    var m = {};
    sky.bodies.forEach(function (b) { m[b.id] = b; });
    var o = sky.o, h = '';
    function item(title, text) { h += '<div class="prow"><b>' + title + '</b><br><span style="font-size:13px">' + text + '</span></div>'; }
    var pol = m.polaris;
    if (pol.alt > 2) {
      item('โพลาริส → ทิศเหนือ', 'ตอนนี้อยู่ทิศ ' + pol.az.toFixed(1) + '° สูง ' + pol.alt.toFixed(1) + '° ทิ้งดิ่งลงขอบฟ้า = ทิศเหนือ (ผิดไม่เกิน ~1°) · มุมเงยของโพลาริสเท่ากับละติจูดของคุณ (' + o.lat.toFixed(1) + '°)');
    } else {
      item('โพลาริส', 'ยังต่ำเกินไป/อยู่ใต้ขอบฟ้า' + (o.lat < 5 ? ' (ใกล้เส้นศูนย์สูตรมาก มักมองไม่เห็น)' : ''));
    }
    if (m.dubhe.alt > 3 || m.merak.alt > 3) item('กระบวยใหญ่ (หมีใหญ่) → เหนือ', 'ลากเส้นผ่านเมรัก→ดูเบ ต่อไปอีก ~5 เท่าของระยะระหว่างสองดาว เจอโพลาริส ในไทยกระบวยใหญ่จะต่ำและเห็นช่วงต้นปีตอนค่ำ-ดึก');
    if (m.acrux.alt > 2 || m.gacrux.alt > 2) {
      var path = pointerPath(POINTERS[0], o, sky.jd);
      item('ไม้กางเขนใต้ → ทิศใต้', 'ลากแกนยาวกาครักซ์→อะครักซ์ ต่อไป 4.5 เท่าของความยาวไม้กางเขน แล้วทิ้งดิ่งลงขอบฟ้า = ทิศใต้ (ตอนนี้จุดนั้นอยู่ทิศ ' + path[path.length - 1].az.toFixed(0) + '° ควรใกล้ 180°) · ใช้ดาวชี้ฮาดาร์/ริจิลเคนต์ยืนยันได้');
    }
    if (m.mintaka.alt > 3 || m.alnitak.alt > 3) item('เข็มขัดนายพราน → ตะวันออก/ตะวันตก', 'มินตากา (ปลายขวาของเข็มขัด) อยู่บนเส้นศูนย์สูตรฟ้า ขึ้นตรงทิศตะวันออก ตกตรงทิศตะวันตก ตอนนี้อยู่ทิศ ' + m.mintaka.az.toFixed(0) + '° (' + dirName(m.mintaka.az) + ') สูง ' + m.mintaka.alt.toFixed(0) + '°');
    var moon = m.moon;
    if (moon.alt > 0) {
      var ph = moon.illum < 0.05 ? 'จันทร์ดับ' : moon.illum > 0.95 ? 'จันทร์เต็มดวง' : moon.waxing ? 'ข้างขึ้น' : 'ข้างแรม';
      item('ดวงจันทร์ (' + ph + ' ' + Math.round(moon.illum * 100) + '%)', 'ทิศ ' + moon.az.toFixed(0) + '° (' + dirName(moon.az) + ') สูง ' + moon.alt.toFixed(0) + '° · ถ้าเป็นเสี้ยว ลากเส้นผ่านปลายเขาทั้งสองลงขอบฟ้า ≈ ทิศใต้ (ซีกโลกเหนือ) ใช้ได้คร่าวๆ');
    }
    if (m.sun.alt > 0) item('ดวงอาทิตย์', 'ทิศ ' + m.sun.az.toFixed(0) + '° (' + dirName(m.sun.az) + ') สูง ' + m.sun.alt.toFixed(0) + '° · ใช้เทียบเข็มทิศช่วงกลางวัน (ห้ามมองตรง)');
    // ดาวเด่นที่เห็น
    var vis = sky.bodies.filter(function (b) { return b.kind === 'star' && b.alt > 8 && b.mag < 1.7; }).sort(function (a, b) { return a.mag - b.mag; }).slice(0, 6);
    if (vis.length) {
      h += '<div class="prow"><b>ดาวสว่างที่เห็นตอนนี้</b><br>';
      vis.forEach(function (b) {
        h += '<a href="#" data-star="' + b.id + '" style="color:#1a6ad6;display:block;padding:3px 0;font-size:14px">' + b.th + ' — ทิศ ' + b.az.toFixed(0) + '° (' + dirName(b.az) + ') สูง ' + b.alt.toFixed(0) + '°</a>';
      });
      h += '</div>';
    }
    h += '<p class="note">กฎทั่วไป: ดาวทุกดวงขึ้นทางตะวันออก ตกทางตะวันตก เคลื่อนที่ ~15° ต่อชั่วโมง ดาวใกล้ขอบฟ้าทิศเหนือ/ใต้ขยับน้อยกว่า</p>';
    box.innerHTML = h;
    Array.prototype.forEach.call(box.querySelectorAll('a[data-star]'), function (a) {
      a.onclick = function (e) { e.preventDefault(); sky.sel = a.getAttribute('data-star'); drawDome($('skyCv')); renderSel(); };
    });
  }

  function renderFollow(brg) {
    var box = $('skyFollow');
    var o = sky.o || observer(), jd = sky.jd || nowJD(0);
    var res = [];
    STARS.forEach(function (st) {
      if (st.mag > 2.6) return;
      var b0 = bodyAt(st.id, jd, o);
      if (b0.alt < 10 || b0.alt > 75 || Math.abs(norm180(b0.az - brg)) > 6) return;
      var mins = 0;
      for (var m = 5; m <= 180; m += 5) {
        var b = bodyAt(st.id, jd + m / 1440, o);
        if (b.alt < 8 || Math.abs(norm180(b.az - brg)) > 10) break;
        mins = m;
      }
      res.push({ b: b0, mins: mins });
    });
    res.sort(function (a, b) { return (b.mins - a.mins) || (a.b.mag - b.b.mag); });
    if (!res.length) { box.textContent = 'ไม่มีดาวสว่างอยู่ในแนวทิศ ' + Math.round(brg) + '° (±6°) ในเวลานี้ ลองเลื่อนเวลาหรือเดินตามดวงจันทร์/ภูมิประเทศแทน'; return; }
    var h = 'ดาวที่อยู่ในแนวทิศ ' + Math.round(brg) + '° — เล็งแล้วเดินเข้าหา แต่ดาวขยับ ~15°/ชม. ต้องเปลี่ยนดาวตามเวลาที่ระบุ:<br>';
    res.slice(0, 4).forEach(function (r) {
      h += '• <b>' + r.b.th + '</b> ทิศ ' + r.b.az.toFixed(0) + '° สูง ' + r.b.alt.toFixed(0) + '° · ใช้ได้ ' + (r.mins < 5 ? 'ไม่ถึง 5' : '~' + r.mins) + ' นาที<br>';
    });
    box.innerHTML = h;
  }

  /* ---------- ส่องฟ้าผ่านกล้อง (AR) ---------- */
  async function openAR() {
    if (ar) return;
    var ok = await S.start();
    var el = document.createElement('div');
    el.id = 'skycam';
    el.innerHTML =
      '<video playsinline muted autoplay></video><canvas id="skyov"></canvas>' +
      '<div class="camtop"><span id="skyhead">รอเซนเซอร์…</span><button id="skyclose">✕</button></div>' +
      '<div class="cambot"><div id="skyinfo"></div>' +
      '<div style="font-size:11.5px;opacity:.85;margin-top:4px">ลากนิ้วบนภาพเพื่อเลื่อนให้ดาวบนจอตรงกับดาวจริง (แก้เข็มทิศเพี้ยน) · เมื่อเงยกล้องสูงเกือบตั้งฉาก เข็มทิศมือถืออาจคลาด</div>' +
      '<div class="camrow"><button class="cambtn" id="skyreset">รีเซ็ตการปรับ</button><button class="cambtn" id="skylab">ป้ายชื่อ: หลัก</button><button class="cambtn" id="skyline">ปักแนวบนแผนที่</button></div></div>';
    document.body.appendChild(el);
    ar = { el: el, video: el.querySelector('video'), cv: el.querySelector('#skyov'), stream: null, bodies: [], bodiesAt: 0, near: null, dEl: 0, allLabels: false, raf: 0, drag: null, o: observer() };
    if (!ok) ctx.toast('ไม่ได้สิทธิ์เข็มทิศ ทิศจะไม่ทำงาน (ตั้งค่า > Safari > การเคลื่อนไหวและการวางแนว)');
    $('skyclose').onclick = closeAR;
    $('skyreset').onclick = function () { ctx.prefs.camOffset = 0; ar.dEl = 0; ctx.savePrefs(); ctx.toast('รีเซ็ตค่าปรับแก้แล้ว'); };
    $('skylab').onclick = function () { ar.allLabels = !ar.allLabels; this.textContent = 'ป้ายชื่อ: ' + (ar.allLabels ? 'ทั้งหมด' : 'หลัก'); };
    $('skyline').onclick = function () {
      if (!ar.near) { ctx.toast('เล็งเป้าให้ใกล้ดาวที่ต้องการก่อน'); return; }
      closeAR();
      drawLine(ar.near);
    };
    var cv = ar.cv;
    cv.style.pointerEvents = 'auto';
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', function (e) { ar.drag = { x: e.clientX, y: e.clientY }; });
    cv.addEventListener('pointermove', function (e) {
      if (!ar || !ar.drag) return;
      var f = ar.f || 1;
      var dx = e.clientX - ar.drag.x, dy = e.clientY - ar.drag.y;
      ar.drag.x = e.clientX; ar.drag.y = e.clientY;
      ctx.prefs.camOffset = (ctx.prefs.camOffset || 0) - (dx / f) * R2D;
      ar.dEl += (dy / f) * R2D;
    });
    function endDrag() { if (ar && ar.drag) { ar.drag = null; ctx.savePrefs(); } }
    cv.addEventListener('pointerup', endDrag);
    cv.addEventListener('pointercancel', endDrag);
    try {
      ar.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false });
      ar.video.srcObject = ar.stream;
      await ar.video.play();
    } catch (e) {
      ctx.toast('เปิดกล้องไม่ได้ ตรวจสิทธิ์กล้องของ Safari/แอพนี้');
      closeAR();
      return;
    }
    ar.raf = requestAnimationFrame(arFrame);
  }

  function closeAR() {
    if (!ar) return;
    cancelAnimationFrame(ar.raf);
    if (ar.stream) ar.stream.getTracks().forEach(function (t) { t.stop(); });
    ar.el.remove();
    ar = null;
  }

  function makeProj(az0, el0, f, cx, cy) {
    var A = az0 * D2R, E = el0 * D2R;
    var F = [Math.sin(A) * Math.cos(E), Math.cos(A) * Math.cos(E), Math.sin(E)];
    var Rv = [Math.cos(A), -Math.sin(A), 0];
    var Uv = [-Math.sin(A) * Math.sin(E), -Math.cos(A) * Math.sin(E), Math.cos(E)];
    return function (az, alt) {
      var a = az * D2R, e = alt * D2R;
      var v = [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
      var z = v[0] * F[0] + v[1] * F[1] + v[2] * F[2];
      if (z <= 0.05) return null;
      return {
        x: cx + f * (v[0] * Rv[0] + v[1] * Rv[1]) / z,
        y: cy - f * (v[0] * Uv[0] + v[1] * Uv[1] + v[2] * Uv[2]) / z
      };
    };
  }

  function arFrame(ts) {
    if (!ar) return;
    ar.raf = requestAnimationFrame(arFrame);
    var W = window.innerWidth, H = window.innerHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cv = ar.cv;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    if (!ar.bodiesAt || ts - ar.bodiesAt > 1000) {
      ar.bodiesAt = ts;
      ar.o = observer();
      ar.jd = nowJD(0);
      ar.bodies = allBodies(ar.jd, ar.o);
      ar.paths = POINTERS.map(function (pt) { return pointerPath(pt, ar.o, ar.jd); });
    }
    var c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    var cx = W / 2, cy = H / 2;
    var f = Math.max(W, H) / 2 / Math.tan((FOV_LONG / 2) * D2R);
    ar.f = f;
    var az = S.headingTrue(), tilt = S.state.pitch;
    var head = $('skyhead'), inf = $('skyinfo');
    c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 1.5;
    c.beginPath(); c.arc(cx, cy, 18, 0, 7); c.stroke();
    if (az === null || tilt === null || tilt === undefined) {
      if (head) head.textContent = 'ไม่มีข้อมูลเข็มทิศ/มุมเงย (อนุญาตเซนเซอร์การเคลื่อนไหวและวางแนว)';
      return;
    }
    tilt = clamp(tilt + ar.dEl, -90, 90);
    if (head) head.textContent = 'หันไป ' + az.toFixed(0) + '° (' + dirName(az) + ') · เงย ' + (tilt >= 0 ? '+' : '') + tilt.toFixed(0) + '°';
    var P = makeProj(az, tilt, f, cx, cy);
    c.shadowColor = 'rgba(0,0,0,.9)'; c.shadowBlur = 3;
    // ขอบฟ้าและตัวเลขทิศ
    c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 1.5;
    c.beginPath();
    var pen = false;
    for (var a = 0; a <= 360; a += 3) {
      var p = P(a, 0);
      if (!p) { pen = false; continue; }
      if (!pen) { c.moveTo(p.x, p.y); pen = true; } else c.lineTo(p.x, p.y);
    }
    c.stroke();
    c.textAlign = 'center'; c.font = 'bold 15px sans-serif';
    for (var d = 0; d < 360; d += 15) {
      var q = P(d, 0);
      if (!q || q.x < -20 || q.x > W + 20) continue;
      var card = d % 90 === 0;
      c.beginPath(); c.moveTo(q.x, q.y); c.lineTo(q.x, q.y + (card ? 14 : 8)); c.stroke();
      c.fillStyle = d === 0 ? '#ff6b5e' : '#fff';
      c.fillText(card ? { 0: 'N เหนือ', 90: 'E ตะวันออก', 180: 'S ใต้', 270: 'W ตะวันตก' }[d] : String(d), q.x, q.y + (card ? 32 : 24));
    }
    var byId = {};
    ar.bodies.forEach(function (b) { byId[b.id] = b; });
    // เส้นกลุ่มดาว
    c.strokeStyle = 'rgba(140,190,255,.6)'; c.lineWidth = 1.2;
    LINES.forEach(function (l) {
      var A = byId[l[0]], B = byId[l[1]];
      var p1 = P(A.az, A.alt), p2 = P(B.az, B.alt);
      if (!p1 || !p2) return;
      c.beginPath(); c.moveTo(p1.x, p1.y); c.lineTo(p2.x, p2.y); c.stroke();
    });
    // เส้นชี้หาเหนือ/ใต้
    POINTERS.forEach(function (pt, i) {
      var path = ar.paths[i];
      c.strokeStyle = pt.color; c.lineWidth = 2; c.setLineDash([8, 6]);
      c.beginPath();
      var pn = false;
      path.forEach(function (qq) {
        var pp = P(qq.az, qq.alt);
        if (!pp) { pn = false; return; }
        if (!pn) { c.moveTo(pp.x, pp.y); pn = true; } else c.lineTo(pp.x, pp.y);
      });
      c.stroke(); c.setLineDash([]);
      var end = path[path.length - 1];
      var pe = P(end.az, 0);
      if (pe) {
        c.fillStyle = pt.color; c.font = 'bold 13px sans-serif';
        c.beginPath(); c.moveTo(pe.x, pe.y); c.lineTo(pe.x - 8, pe.y - 14); c.lineTo(pe.x + 8, pe.y - 14); c.closePath(); c.fill();
        c.fillText(pt.name, pe.x, pe.y - 20);
      }
    });
    // ดาว
    var near = null, nd = 80;
    c.textAlign = 'left';
    ar.bodies.forEach(function (b) {
      if (b.alt < -1) return;
      var pp = P(b.az, b.alt);
      if (!pp || pp.x < -30 || pp.x > W + 30 || pp.y < -30 || pp.y > H + 30) return;
      var dd = Math.hypot(pp.x - cx, pp.y - cy);
      if (dd < nd) { nd = dd; near = b; }
      if (b.kind === 'sun') {
        c.fillStyle = '#ffd24a'; c.beginPath(); c.arc(pp.x, pp.y, 14, 0, 7); c.fill();
        c.fillStyle = '#fff'; c.font = '13px sans-serif'; c.fillText('ดวงอาทิตย์', pp.x + 18, pp.y + 4);
      } else if (b.kind === 'moon') {
        c.fillStyle = '#e8e6c8'; c.beginPath(); c.arc(pp.x, pp.y, 12, 0, 7); c.fill();
        c.fillStyle = '#fff'; c.font = '13px sans-serif'; c.fillText('ดวงจันทร์ ' + Math.round(b.illum * 100) + '%', pp.x + 16, pp.y + 4);
      } else {
        var r = Math.max(2.5, 5.5 - b.mag * 0.9);
        c.fillStyle = b.id === 'polaris' ? '#4fd1ff' : '#fff';
        c.beginPath(); c.arc(pp.x, pp.y, r, 0, 7); c.fill();
        c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 1; c.beginPath(); c.arc(pp.x, pp.y, r + 5, 0, 7); c.stroke();
        if (ar.allLabels || b.mag <= 2.0 || LABELED[b.id]) {
          c.fillStyle = '#fff'; c.font = '13px sans-serif';
          c.fillText(b.th.replace(' (ดาวเหนือ)', ''), pp.x + r + 8, pp.y + 4);
        }
      }
    });
    ar.near = near;
    if (inf) {
      if (near) inf.innerHTML = '<b>' + near.th + '</b>' + (near.kind === 'star' ? ' (' + near.en + ')' : '') + '<br>' + info(near, ar.o) + (near.hint ? '<br>' + near.hint : '');
      else inf.textContent = 'เล็งเป้ากลางจอให้ใกล้ดาว/ดวงจันทร์เพื่อดูทิศและความสูง';
    }
  }

  root.TrailSky = { init: init, renderSheet: renderSheet, openAR: openAR };
})(typeof self !== 'undefined' ? self : this);
