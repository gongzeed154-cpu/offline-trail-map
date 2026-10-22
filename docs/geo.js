// คำนวณพิกัด: UTM, MGRS, องศา/ลิปดา/ฟิลิปดา และการวัดมุม (ไม่พึ่งไลบรารีภายนอก)
(function (root) {
  var A_WGS = 6378137;
  var F_WGS = 1 / 298.257223563;
  var K0 = 0.9996;
  var D2R = Math.PI / 180;
  var R2D = 180 / Math.PI;

  var N = F_WGS / (2 - F_WGS);
  var n2 = N * N, n3 = n2 * N, n4 = n3 * N, n5 = n4 * N, n6 = n5 * N;
  var E_ECC = Math.sqrt(F_WGS * (2 - F_WGS));
  var AA = (A_WGS / (1 + N)) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
  var ALPHA = [0,
    N / 2 - (2 / 3) * n2 + (5 / 16) * n3 + (41 / 180) * n4 - (127 / 288) * n5 + (7891 / 37800) * n6,
    (13 / 48) * n2 - (3 / 5) * n3 + (557 / 1440) * n4 + (281 / 630) * n5 - (1983433 / 1935360) * n6,
    (61 / 240) * n3 - (103 / 140) * n4 + (15061 / 26880) * n5 + (167603 / 181440) * n6,
    (49561 / 161280) * n4 - (179 / 168) * n5 + (6601661 / 7257600) * n6,
    (34729 / 80640) * n5 - (3418889 / 1995840) * n6,
    (212378941 / 319334400) * n6];
  var BETA = [0,
    N / 2 - (2 / 3) * n2 + (37 / 96) * n3 - (1 / 360) * n4 - (81 / 512) * n5 + (96199 / 604800) * n6,
    (1 / 48) * n2 + (1 / 15) * n3 - (437 / 1440) * n4 + (46 / 105) * n5 - (1118711 / 3870720) * n6,
    (17 / 480) * n3 - (37 / 840) * n4 - (209 / 4480) * n5 + (5569 / 90720) * n6,
    (4397 / 161280) * n4 - (11 / 504) * n5 - (830251 / 7257600) * n6,
    (4583 / 161280) * n5 - (108847 / 3991680) * n6,
    (20648693 / 638668800) * n6];

  function sinh(x) { return (Math.exp(x) - Math.exp(-x)) / 2; }
  function cosh(x) { return (Math.exp(x) + Math.exp(-x)) / 2; }
  function asinh(x) { return Math.log(x + Math.sqrt(x * x + 1)); }
  function atanh(x) { return 0.5 * Math.log((1 + x) / (1 - x)); }

  function zoneOf(lng) {
    var z = Math.floor((lng + 180) / 6) + 1;
    return Math.max(1, Math.min(60, z));
  }
  function zoneMeridian(zone) { return (zone - 1) * 6 - 180 + 3; }

  var BANDS = 'CDEFGHJKLMNPQRSTUVWX';
  function bandOf(lat) {
    if (lat < -80) return 'C';
    if (lat >= 84) return 'X';
    return BANDS.charAt(Math.floor((lat + 80) / 8));
  }

  // lat/lng (องศา) -> {zone, north(bool), e, n}; ถ้าระบุ zone จะบังคับใช้โซนนั้น
  function toUTM(lat, lng, zone) {
    zone = zone || zoneOf(lng);
    var lam = (lng - zoneMeridian(zone)) * D2R;
    var phi = lat * D2R;
    var tau = Math.tan(phi);
    var sigma = sinh(E_ECC * atanh((E_ECC * tau) / Math.sqrt(1 + tau * tau)));
    var tauP = tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);
    var xiP = Math.atan2(tauP, Math.cos(lam));
    var etaP = asinh(Math.sin(lam) / Math.sqrt(tauP * tauP + Math.cos(lam) * Math.cos(lam)));
    var xi = xiP, eta = etaP;
    for (var j = 1; j <= 6; j++) {
      xi += ALPHA[j] * Math.sin(2 * j * xiP) * cosh(2 * j * etaP);
      eta += ALPHA[j] * Math.cos(2 * j * xiP) * sinh(2 * j * etaP);
    }
    var x = K0 * AA * eta;
    var y = K0 * AA * xi;
    var north = lat >= 0;
    return { zone: zone, north: north, e: 500000 + x, n: north ? y : y + 10000000 };
  }

  // {zone, north, e, n} -> {lat, lng}
  function fromUTM(zone, north, e, n) {
    var x = e - 500000;
    var y = north ? n : n - 10000000;
    var xi = y / (K0 * AA);
    var eta = x / (K0 * AA);
    var xiP = xi, etaP = eta;
    for (var j = 1; j <= 6; j++) {
      xiP -= BETA[j] * Math.sin(2 * j * xi) * cosh(2 * j * eta);
      etaP -= BETA[j] * Math.cos(2 * j * xi) * sinh(2 * j * eta);
    }
    var chi = Math.asin(Math.sin(xiP) / cosh(etaP));
    var tauP = Math.tan(chi);
    var tau = tauP;
    for (var it = 0; it < 6; it++) {
      var sigma = sinh(E_ECC * atanh((E_ECC * tau) / Math.sqrt(1 + tau * tau)));
      var tauPi = tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);
      var d = ((tauP - tauPi) / Math.sqrt(1 + tauPi * tauPi)) *
        ((1 + (1 - E_ECC * E_ECC) * tau * tau) / ((1 - E_ECC * E_ECC) * Math.sqrt(1 + tau * tau)));
      tau += d;
      if (Math.abs(d) < 1e-12) break;
    }
    var phi = Math.atan(tau);
    var lam = Math.atan2(sinh(etaP), Math.cos(xiP));
    return { lat: phi * R2D, lng: zoneMeridian(zone) + lam * R2D };
  }

  /* ---------- MGRS ---------- */
  var COL_LETTERS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
  var ROW_LETTERS = 'ABCDEFGHJKLMNPQRSTUV';

  function pad(v, len) {
    var s = String(v);
    while (s.length < len) s = '0' + s;
    return s;
  }

  // ตัวอักษรสี่เหลี่ยม 100 กม. เช่น "QA"
  function squareId(zone, e, n) {
    var col = COL_LETTERS[(zone - 1) % 3].charAt(Math.floor(e / 100000) - 1);
    var row = ROW_LETTERS.charAt((Math.floor(n / 100000) + (zone % 2 === 0 ? 5 : 0)) % 20);
    return col + row;
  }

  // digits = จำนวนหลักของเลขตะวันออก/เหนือ (5 = ละเอียด 1 ม.)
  function mgrsFromUTM(u, lat, digits) {
    if (digits === undefined) digits = 5;
    var e = Math.round(u.e * 1000) / 1000;
    var n = Math.round(u.n * 1000) / 1000;
    var div = Math.pow(10, 5 - digits);
    var ee = Math.floor((e % 100000) / div);
    var nn = Math.floor((n % 100000) / div);
    return pad(u.zone, 2) + bandOf(lat) + squareId(u.zone, e, n) + (digits ? ' ' + pad(ee, digits) + ' ' + pad(nn, digits) : '');
  }

  /* ---------- รูปแบบแสดงผลพิกัด ---------- */
  function hemi(v, pos, neg) { return v >= 0 ? pos : neg; }

  function fmtDMS(v, pos, neg, secDecimals) {
    var a = Math.abs(v);
    var factor = Math.pow(10, secDecimals);
    var total = Math.round(a * 3600 * factor) / factor; // ฟิลิปดารวม
    var d = Math.floor(total / 3600);
    var m = Math.floor((total - d * 3600) / 60);
    var s = total - d * 3600 - m * 60;
    return d + '°' + pad(m, 2) + '′' + (s < 10 ? '0' : '') + s.toFixed(secDecimals) + '″' + hemi(v, pos, neg);
  }

  function fmtDM(v, pos, neg, minDecimals) {
    var a = Math.abs(v);
    var factor = Math.pow(10, minDecimals);
    var total = Math.round(a * 60 * factor) / factor; // ลิปดารวม
    var d = Math.floor(total / 60);
    var m = total - d * 60;
    return d + '°' + (m < 10 ? '0' : '') + m.toFixed(minDecimals) + '′' + hemi(v, pos, neg);
  }

  function fmtDD(v, pos, neg, decimals) {
    return Math.abs(v).toFixed(decimals) + '°' + hemi(v, pos, neg);
  }

  var FORMATS = ['mgrs', 'utm', 'dms', 'dm', 'dd'];
  var FORMAT_NAMES = {
    mgrs: 'MGRS',
    utm: 'UTM',
    dms: 'องศา ลิปดา ฟิลิปดา',
    dm: 'องศา ลิปดา (ทศนิยม)',
    dd: 'องศาทศนิยม'
  };

  // คืนข้อความพิกัดเต็มของจุดหนึ่ง
  function formatPoint(lat, lng, fmt) {
    if (fmt === 'mgrs' || fmt === 'utm') {
      if (lat < -80 || lat >= 84) return 'นอกช่วง UTM';
      var u = toUTM(lat, lng);
      if (fmt === 'mgrs') return mgrsFromUTM(u, lat, 5);
      return u.zone + bandOf(lat) + '  E ' + Math.round(u.e) + '  N ' + Math.round(u.n);
    }
    if (fmt === 'dm') return fmtDM(lat, 'N', 'S', 3) + '  ' + fmtDM(lng, 'E', 'W', 3);
    if (fmt === 'dd') return fmtDD(lat, 'N', 'S', 5) + '  ' + fmtDD(lng, 'E', 'W', 5);
    return fmtDMS(lat, 'N', 'S', 1) + '  ' + fmtDMS(lng, 'E', 'W', 1);
  }

  /* ---------- ขั้นของเส้นตาราง ---------- */
  // ขั้นเป็นฟิลิปดา (1/3600 องศา) สำหรับตารางละติจูด/ลองจิจูด
  var LL_STEPS = {
    dms: [36000, 18000, 7200, 3600, 1800, 600, 300, 120, 60, 30, 10, 5, 2, 1],
    dm: [36000, 18000, 7200, 3600, 1800, 600, 300, 120, 60, 30, 6, 3, 0.6, 0.3, 0.06],
    dd: [36000, 18000, 7200, 3600, 1800, 720, 360, 180, 72, 36, 18, 7.2, 3.6, 1.8, 0.72, 0.36]
  };
  // ขั้นเป็นเมตรสำหรับ UTM และ MGRS (MGRS ใช้เลขสิบยกกำลัง)
  var UTM_STEPS = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10];
  var MGRS_STEPS = [100000, 10000, 1000, 100, 10];

  // เลือกขั้นที่เล็กที่สุดที่ทำให้จำนวนเส้นตามด้านยาวไม่เกิน maxLines
  function pickStep(steps, span, maxLines) {
    var pick = steps[0];
    for (var i = 0; i < steps.length; i++) {
      if (span / steps[i] <= maxLines) pick = steps[i];
      else break;
    }
    return pick;
  }

  // ป้ายเส้นตาราง lat/lng ที่ความละเอียดเท่ากับขั้น
  function labelLL(v, isLat, fmt, stepArc) {
    var pos = isLat ? 'N' : 'E';
    var neg = isLat ? 'S' : 'W';
    var a = Math.abs(v);
    if (fmt === 'dd') {
      var dec = stepArc >= 3600 ? 0 : stepArc >= 360 ? 1 : stepArc >= 36 ? 2 : stepArc >= 3.6 ? 3 : 4;
      return a.toFixed(dec) + '°' + hemi(v, pos, neg);
    }
    var totalArc = Math.round(a * 3600 * 100) / 100;
    var d = Math.floor(totalArc / 3600 + 1e-9);
    var m = Math.floor((totalArc - d * 3600) / 60 + 1e-9);
    var s = totalArc - d * 3600 - m * 60;
    if (s < 0) s = 0;
    if (fmt === 'dm') {
      var mm = totalArc / 60 - d * 60;
      if (stepArc >= 3600) return d + '°' + hemi(v, pos, neg);
      var md = stepArc >= 60 ? 0 : stepArc >= 6 ? 1 : stepArc >= 0.6 ? 2 : 3;
      return d + '°' + (mm < 10 ? '0' : '') + mm.toFixed(md) + '′' + hemi(v, pos, neg);
    }
    if (stepArc >= 3600) return d + '°' + hemi(v, pos, neg);
    if (stepArc >= 60) return d + '°' + pad(m, 2) + '′' + hemi(v, pos, neg);
    var sd = stepArc >= 1 ? 0 : 1;
    return d + '°' + pad(m, 2) + '′' + (s < 10 ? '0' : '') + s.toFixed(sd) + '″' + hemi(v, pos, neg);
  }

  /* ---------- มุมและระยะ ---------- */
  function norm360(a) {
    a = a % 360;
    return a < 0 ? a + 360 : a;
  }

  // มุมภาคเหนือของกริด (grid azimuth) จาก a ไป b โดยใช้โซน UTM ของ a
  function gridAzimuth(a, b) {
    var zone = zoneOf(a.lng);
    var ua = toUTM(a.lat, a.lng, zone);
    var ub = toUTM(b.lat, b.lng, zone);
    var dE = ub.e - ua.e, dN = ub.n - ua.n;
    return {
      az: norm360(Math.atan2(dE, dN) * R2D),
      dist: Math.sqrt(dE * dE + dN * dN)
    };
  }

  // มุมเหนือจริง (true azimuth) แบบวงกลมใหญ่
  function trueAzimuth(a, b) {
    var p1 = a.lat * D2R, p2 = b.lat * D2R, dl = (b.lng - a.lng) * D2R;
    var y = Math.sin(dl) * Math.cos(p2);
    var x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return norm360(Math.atan2(y, x) * R2D);
  }

  function haversine(a, b) {
    var p1 = a.lat * D2R, p2 = b.lat * D2R;
    var dp = p2 - p1, dl = (b.lng - a.lng) * D2R;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // หาจุดปลายจากจุดเริ่ม + มุมกริด (องศา) + ระยะกริด (เมตร)
  function pointFromGrid(a, azDeg, distM) {
    var zone = zoneOf(a.lng);
    var ua = toUTM(a.lat, a.lng, zone);
    var r = azDeg * D2R;
    return fromUTM(zone, ua.north, ua.e + distM * Math.sin(r), ua.n + distM * Math.cos(r));
  }

  /* ---------- อ่านพิกัดที่พิมพ์เข้ามา ---------- */
  function parseAngleStr(s) {
    s = String(s).trim().toUpperCase();
    var neg = /[SW]/.test(s) || /^-/.test(s);
    var nums = s.replace(/,/g, '.').match(/\d+(?:\.\d+)?/g);
    if (!nums) return NaN;
    var v = 0, div = 1;
    for (var i = 0; i < 3 && i < nums.length; i++) { v += parseFloat(nums[i]) / div; div *= 60; }
    return neg ? -v : v;
  }

  // รับ MGRS, UTM, หรือ lat/lng (องศาทศนิยม / องศา-ลิปดา / องศา-ลิปดา-ฟิลิปดา) คืน {lat,lng} หรือ null
  function parsePoint(text) {
    var t = String(text || '').trim().toUpperCase();
    if (!t) return null;
    var m, p, i;

    m = /^(\d{1,2})\s*([C-HJ-NP-X])\s*([A-HJ-NP-Z])\s*([A-HJ-NP-V])\s*([\d\s]*)$/.exec(t);
    if (m) {
      var zone = parseInt(m[1], 10);
      if (zone < 1 || zone > 60) return null;
      var col = COL_LETTERS[(zone - 1) % 3].indexOf(m[3]);
      var row = ROW_LETTERS.indexOf(m[4]);
      if (col < 0 || row < 0) return null;
      var parts = m[5].trim().split(/\s+/).filter(function (x) { return x; });
      var es, ns;
      if (parts.length === 2) { es = parts[0]; ns = parts[1]; }
      else if (parts.length === 1 && parts[0].length % 2 === 0) { es = parts[0].slice(0, parts[0].length / 2); ns = parts[0].slice(parts[0].length / 2); }
      else if (parts.length === 0) { es = ''; ns = ''; }
      else return null;
      if (es.length !== ns.length || es.length > 5) return null;
      var sc = Math.pow(10, 5 - es.length);
      var eM = (es ? parseInt(es, 10) : 0) * sc, nM = (ns ? parseInt(ns, 10) : 0) * sc;
      var n100 = ((row - (zone % 2 === 0 ? 5 : 0) + 20) % 20) * 100000;
      var bi = BANDS.indexOf(m[2]);
      var ref = toUTM(-80 + 8 * bi + 0.001, zoneMeridian(zone), zone).n;
      var N0 = n100 + nM;
      while (N0 < ref - 3000) N0 += 2000000;
      return fromUTM(zone, bi >= 10, (col + 1) * 100000 + eM, N0);
    }

    m = /^(\d{1,2})\s*([C-X])\s*E?\s*(\d{5,7})\s*[,\s]\s*N?\s*(\d{6,8})$/.exec(t);
    if (m) {
      var z = parseInt(m[1], 10);
      var bi2 = BANDS.indexOf(m[2]);
      if (z < 1 || z > 60 || bi2 < 0) return null;
      return fromUTM(z, bi2 >= 10, parseInt(m[3], 10), parseInt(m[4], 10));
    }

    var lat = NaN, lng = NaN;
    if (/[NSEW]/.test(t)) {
      var chunks = t.match(/[^NSEW]+[NSEW]/g);
      if (!chunks || chunks.length !== 2) return null;
      for (i = 0; i < 2; i++) {
        var hz = chunks[i].charAt(chunks[i].length - 1);
        var val = parseAngleStr(chunks[i]);
        if (hz === 'N' || hz === 'S') lat = Math.abs(val) * (hz === 'S' ? -1 : 1);
        else lng = Math.abs(val) * (hz === 'W' ? -1 : 1);
      }
    } else {
      var halves = t.split(/[;,]/);
      if (halves.length === 2 && /\d/.test(halves[0]) && /\d/.test(halves[1])) {
        lat = parseAngleStr(halves[0]); lng = parseAngleStr(halves[1]);
      } else {
        var nums = t.match(/-?\d+(?:\.\d+)?/g) || [];
        if (nums.length === 2) { lat = parseFloat(nums[0]); lng = parseFloat(nums[1]); }
        else if (nums.length === 4 || nums.length === 6) {
          var k = nums.length / 2;
          lat = parseAngleStr(nums.slice(0, k).join(' '));
          lng = parseAngleStr(nums.slice(k).join(' '));
        } else return null;
      }
    }
    if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat: lat, lng: lng };
  }

  // มุมเบี่ยงเบนระหว่างเหนือจริงกับเหนือกริด (องศา, บวก = เหนือกริดอยู่ทางตะวันออกของเหนือจริง)
  function convergence(lat, lng) {
    var dl = (lng - zoneMeridian(zoneOf(lng))) * D2R;
    return Math.atan(Math.tan(dl) * Math.sin(lat * D2R)) * R2D;
  }

  // จุดปลายจากจุดเริ่ม + มุมเหนือจริง + ระยะ (เมตร) บนทรงกลม
  function destination(a, trueAz, distM) {
    var d = distM / 6371008.8, br = trueAz * D2R, p1 = a.lat * D2R, l1 = a.lng * D2R;
    var p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(br));
    var l2 = l1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return { lat: p2 * R2D, lng: ((l2 * R2D + 540) % 360) - 180 };
  }

  root.TrailGeo = {
    convergence: convergence,
    destination: destination,
    D2R: D2R,
    R2D: R2D,
    zoneOf: zoneOf,
    zoneMeridian: zoneMeridian,
    bandOf: bandOf,
    toUTM: toUTM,
    fromUTM: fromUTM,
    squareId: squareId,
    mgrsFromUTM: mgrsFromUTM,
    FORMATS: FORMATS,
    FORMAT_NAMES: FORMAT_NAMES,
    formatPoint: formatPoint,
    fmtDMS: fmtDMS,
    fmtDM: fmtDM,
    fmtDD: fmtDD,
    LL_STEPS: LL_STEPS,
    UTM_STEPS: UTM_STEPS,
    MGRS_STEPS: MGRS_STEPS,
    pickStep: pickStep,
    labelLL: labelLL,
    norm360: norm360,
    gridAzimuth: gridAzimuth,
    trueAzimuth: trueAzimuth,
    haversine: haversine,
    parsePoint: parsePoint,
    pointFromGrid: pointFromGrid
  };
})(typeof self !== 'undefined' ? self : this);
