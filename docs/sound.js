// ฟังเสียงด้วยไมโครโฟน: วิเคราะห์ชนิดเสียงคร่าวๆ แนวโน้มเข้าใกล้/ออกห่าง ประมาณระยะ และจับเวลาแสง-เสียง
// ทั้งหมดคำนวณในเครื่อง ไม่อัดเสียงเก็บ ไม่ส่งออกอินเทอร์เน็ต
(function (root) {
  var G = TrailGeo;
  var S = TrailSensors;
  var KEY = 'trail_snd_v1';
  var ctx = null;
  var run = null;
  var cfg = { K: 100, temp: 30, log: [] }; // K = ค่าแปลง dBFS -> dB SPL โดยประมาณ (ปรับเทียบได้)
  var ui = { top: [], dist: '', trend: '', ev: null, last: null, lastDist: null, lastAz: null };

  // ระดับเสียงต้นกำเนิดโดยประมาณที่ระยะ 1 ม. (dB SPL) ใช้ประมาณระยะ ค่าจริงต่างกันมาก
  var SRC = {
    voice: { name: 'เสียงพูดคน', L: 62 },
    vehicle: { name: 'รถ/เครื่องยนต์', L: 82 },
    heli: { name: 'เฮลิคอปเตอร์/ใบพัด', L: 102 },
    aircraft: { name: 'เครื่องบิน/เจ็ต', L: 108 },
    bird: { name: 'นก/สัตว์ร้อง', L: 75 },
    insect: { name: 'แมลง/จักจั่น', L: null },
    noise: { name: 'ลม/ฝน/น้ำไหล', L: null }
  };

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function ramp(x, a, b) { return clamp((x - a) / (b - a), 0, 1); }
  function loadCfg() {
    try { var s = JSON.parse(localStorage.getItem(KEY) || '{}'); for (var k in cfg) if (s[k] !== undefined) cfg[k] = s[k]; } catch (e) { /* ค่าเริ่มต้น */ }
  }
  function saveCfg() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* ไม่เป็นไร */ } }
  function speedOfSound() { return 331.3 + 0.606 * (cfg.temp || 30); }
  function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(2) + ' กม.' : Math.round(m) + ' ม.'; }
  function timeStr(t) {
    var d = new Date(t);
    return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes() + ':' + (d.getSeconds() < 10 ? '0' : '') + d.getSeconds();
  }

  function init(c) {
    ctx = c;
    loadCfg();
  }

  /* ---------- เริ่ม/หยุดฟัง ---------- */
  async function start() {
    if (run) return true;
    var stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      ctx.toast('เปิดไมโครโฟนไม่ได้ ตรวจสิทธิ์ไมโครโฟนของ Safari/แอพนี้');
      return false;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    var ac = new AC();
    try { if (ac.state === 'suspended') await ac.resume(); } catch (e2) { /* ไม่เป็นไร */ }
    var src = ac.createMediaStreamSource(stream);
    var fast = ac.createAnalyser(); fast.fftSize = 1024; fast.smoothingTimeConstant = 0;
    var slow = ac.createAnalyser(); slow.fftSize = 16384; slow.smoothingTimeConstant = 0; slow.minDecibels = -130; slow.maxDecibels = 0;
    src.connect(fast); src.connect(slow);
    run = {
      ac: ac, stream: stream, fast: fast, slow: slow, sr: ac.sampleRate,
      tf: new Float32Array(1024), ts: new Float32Array(16384), spec: new Float32Array(slow.frequencyBinCount),
      lastTs: 0, lastFrame: 0, bg: -70, hist: [], floor: -80, floorAt: 0,
      ev: null, refractory: 0, burst: { n: 0, last: 0 }, flash: null, raf: 0, frame: null
    };
    run.raf = requestAnimationFrame(tick);
    setToolOn(true);
    return true;
  }

  function stop() {
    if (!run) return;
    cancelAnimationFrame(run.raf);
    try { run.stream.getTracks().forEach(function (t) { t.stop(); }); run.ac.close(); } catch (e) { /* ไม่เป็นไร */ }
    run = null;
    setToolOn(false);
  }
  function setToolOn(on) { var b = $('toolSnd'); if (b) b.classList.toggle('on', on); }

  /* ---------- วนเก็บตัวอย่าง ---------- */
  function tick(ts) {
    if (!run) return;
    run.raf = requestAnimationFrame(tick);
    run.fast.getFloatTimeDomainData(run.tf);
    var n = run.tf.length;
    var dt = run.lastTs ? ts - run.lastTs : 16;
    run.lastTs = ts;
    var m = clamp(Math.round(dt / 1000 * run.sr), 64, n);
    var w = Math.max(32, Math.round(run.sr * 0.005)); // ช่วง 5 มิลลิวินาที
    for (var s0 = n - m; s0 < n; s0 += w) {
      var end = Math.min(n, s0 + w), e = 0, pk = 0;
      for (var i = s0; i < end; i++) { var v = run.tf[i]; e += v * v; var a = v < 0 ? -v : v; if (a > pk) pk = a; }
      var db = 10 * Math.log10(e / (end - s0) + 1e-12);
      var tChunk = ts - ((n - end) / run.sr) * 1000;
      chunk(db, pk, tChunk);
    }
    if (ts - run.lastFrame >= 100) { run.lastFrame = ts; frame(ts); }
  }

  // ตรวจเสียงกระแทกฉับพลัน (ปืน/ระเบิด/ไม้หัก)
  function chunk(db, pk, t) {
    var r = run;
    if (r.ev) {
      var ev = r.ev;
      if (db > ev.peak) { ev.peak = db; ev.pk = Math.max(ev.pk, pk); }
      if (!ev.d20 && db < ev.peak - 20) ev.d20 = (t - ev.t) / 1000;
      if (t - ev.t > 1500 || (ev.d20 && t - ev.t > ev.d20 * 1000 + 150)) finishEvent();
      return;
    }
    if (db < r.bg + 10) r.bg += (db - r.bg) * 0.01;
    if (db > r.bg + 16 && db > -55 && t > r.refractory) {
      r.slow.getFloatFrequencyData(r.spec);
      var cen = centroidOf(r.spec, r.sr);
      r.ev = { t: t, peak: db, pk: pk, d20: 0, cent: cen, wall: Date.now() };
      r.refractory = t + 350;
    }
  }

  function finishEvent() {
    var r = run, ev = r.ev;
    r.ev = null;
    var dur = ev.d20 || 1.5;
    var label, kind;
    if (ev.cent > 1000 && dur < 0.5) { label = 'เสียงคม สั้น (ปืนเล็ก/ประทัด/ไม้หัก)'; kind = 'sharp'; }
    else if (ev.cent < 450 && dur > 0.8) { label = 'เสียงทุ้ม ก้อง (ระเบิดไกล/ฟ้าร้อง)'; kind = 'boom'; }
    else { label = 'เสียงกระแทกดัง (ระเบิด/ปืนใหญ่/ของหล่น)'; kind = 'bang'; }
    var pdb = 20 * Math.log10(ev.pk + 1e-9);
    var loud = pdb > -6 ? 'ดังมาก (ใกล้มาก)' : pdb > -20 ? 'ดัง (ใกล้)' : pdb > -35 ? 'ปานกลาง' : 'เบา (ไกล)';
    if (ev.wall - r.burst.last < 3000) r.burst.n++; else r.burst.n = 1;
    r.burst.last = ev.wall;
    var rec = { t: ev.wall, kind: 'impulse', label: label, loud: loud, peakDb: Math.round(pdb), cent: Math.round(ev.cent), dur: +dur.toFixed(2), n: r.burst.n };
    if (r.flash && ev.t - r.flash < 120000) {
      var sec = (ev.t - r.flash) / 1000;
      rec.dist = Math.round(sec * speedOfSound());
      rec.sec = +sec.toFixed(2);
      r.flash = null;
      ui.lastDist = rec.dist;
    }
    ui.ev = rec;
    pushLog(rec);
    if (document.body.contains($('sndEv'))) renderEv();
  }

  function pushLog(rec) {
    cfg.log.unshift(rec);
    if (cfg.log.length > 30) cfg.log.length = 30;
    saveCfg();
  }

  function centroidOf(spec, sr) {
    var bin = sr / (spec.length * 2), num = 0, den = 0;
    var k0 = Math.max(1, Math.round(100 / bin)), k1 = Math.min(spec.length - 1, Math.round(10000 / bin));
    for (var k = k0; k <= k1; k++) { var p = Math.pow(10, spec[k] / 10); num += p * k * bin; den += p; }
    return den > 0 ? num / den : 0;
  }

  /* ---------- วิเคราะห์ทุก 0.1 วินาที ---------- */
  function frame(ts) {
    var r = run;
    r.slow.getFloatFrequencyData(r.spec);
    r.slow.getFloatTimeDomainData(r.ts);
    var spec = r.spec, N = spec.length, bin = r.sr / (N * 2);
    var e = 0, L = 4096;
    for (var i = r.ts.length - L; i < r.ts.length; i++) e += r.ts[i] * r.ts[i];
    var db = 10 * Math.log10(e / L + 1e-12);

    function kk(f) { return clamp(Math.round(f / bin), 1, N - 1); }
    var edges = [20, 200, 1000, 3000, 8000, 12000], band = [0, 0, 0, 0, 0], tot = 0, num = 0, sumLog = 0, sumLin = 0, cnt = 0;
    var kmax = kk(Math.min(12000, r.sr / 2 - 100));
    for (var k = kk(20); k <= kmax; k++) {
      var p = Math.pow(10, spec[k] / 10), f = k * bin;
      tot += p;
      for (var b = 0; b < 5; b++) if (f >= edges[b] && f < edges[b + 1]) { band[b] += p; break; }
      if (f >= 100 && f <= 8000) { sumLog += spec[k]; sumLin += p; cnt++; }
      if (f <= 10000) num += p * f;
    }
    var frac = band.map(function (x) { return tot > 0 ? x / tot : 0; });
    var cent = tot > 0 ? num / tot : 0;
    var flat = cnt ? Math.pow(10, sumLog / cnt / 10) / (sumLin / cnt + 1e-30) : 0;

    // ความเป็นโทนในย่านสูง: ยอดสูงสุดเหนือค่ากลาง 1.5-8 kHz
    var arr = [];
    for (var k2 = kk(1500); k2 <= kk(8000); k2++) arr.push(spec[k2]);
    var mx = -999;
    arr.forEach(function (v) { if (v > mx) mx = v; });
    var med = arr.slice().sort(function (a, b) { return a - b; })[Math.floor(arr.length / 2)];
    var tonal = mx - med;

    // ความเป็นฮาร์มอนิก (ฐานเสียง f0) ในย่านต่ำ
    var k3max = kk(1500), pre = new Float64Array(k3max + 2);
    for (var q = 0; q <= k3max; q++) pre[q + 1] = pre[q] + spec[q];
    var d = new Float32Array(k3max + 1), W = 30;
    for (var q2 = kk(10); q2 <= k3max; q2++) {
      var lo = Math.max(0, q2 - W), hi = Math.min(k3max, q2 + W);
      var avg = (pre[hi + 1] - pre[lo]) / (hi - lo + 1);
      d[q2] = Math.max(0, spec[q2] - avg);
    }
    var bestF = 0, best = 0, sumH = 0, nH = 0;
    for (var f0 = 10; f0 <= 300; f0 += 1) {
      var s = 0;
      for (var h = 1; h <= 6; h++) { var kb = Math.round(h * f0 / bin); if (kb <= k3max) s += d[kb]; }
      sumH += s; nH++;
      if (s > best) { best = s; bestF = f0; }
    }
    var hs = nH && sumH > 0 ? best / (sumH / nH) : 0;

    var fr = { t: ts, db: db, frac: frac, cent: cent, flat: flat, tonal: tonal, f0: bestF, hs: hs };
    r.hist.push(fr);
    if (r.hist.length > 600) r.hist.shift();
    r.frame = fr;
    if (ts - r.floorAt > 1000) {
      r.floorAt = ts;
      var dbs = r.hist.slice(-300).map(function (x) { return x.db; }).sort(function (a, b) { return a - b; });
      r.floor = dbs[Math.floor(dbs.length * 0.2)];
    }
    classify();
    if ($('sndMeter')) draw();
  }

  function avg(arr, fn) { var s = 0; arr.forEach(function (x) { s += fn(x); }); return arr.length ? s / arr.length : 0; }
  function median(arr) { var a = arr.slice().sort(function (x, y) { return x - y; }); return a.length ? a[Math.floor(a.length / 2)] : 0; }

  function classify() {
    var r = run, h = r.hist.slice(-15);
    if (h.length < 8) return;
    var snr = avg(r.hist.slice(-10), function (x) { return x.db; }) - r.floor;
    var f = {
      low: avg(h, function (x) { return x.frac[0]; }), lm: avg(h, function (x) { return x.frac[1]; }), mid: avg(h, function (x) { return x.frac[2]; }),
      hi: avg(h, function (x) { return x.frac[3]; }), vhi: avg(h, function (x) { return x.frac[4]; }),
      cent: avg(h, function (x) { return x.cent; }), flat: avg(h, function (x) { return x.flat; }), tonal: avg(h, function (x) { return x.tonal; }),
      hs: avg(h, function (x) { return x.hs; }), f0: median(h.map(function (x) { return x.f0; }))
    };
    var last20 = r.hist.slice(-20).map(function (x) { return x.db; });
    var mean = avg(last20, function (x) { return x; });
    var am = Math.sqrt(avg(last20, function (x) { return (x - mean) * (x - mean); }));
    var harm = ramp(f.hs, 1.8, 3.5);
    var s = {};
    s.voice = (f.f0 >= 80 && f.f0 <= 300 ? 1 : 0.2) * (0.4 * harm + 0.3 * ramp(f.lm + f.mid, 0.45, 0.75) + 0.3 * ramp(am, 2, 6) * (1 - ramp(am, 12, 20)));
    s.vehicle = (f.f0 >= 33 && f.f0 <= 130 ? 1 : 0.3) * (0.4 * harm + 0.3 * ramp(f.low + f.lm, 0.6, 0.9) + 0.3 * (1 - ramp(am, 4, 10))) * (1 - ramp(f.cent, 700, 1500));
    s.heli = (f.f0 >= 10 && f.f0 <= 32 ? 1 : 0.2) * (0.45 * harm + 0.35 * ramp(f.low, 0.55, 0.85) + 0.2 * (1 - ramp(f.cent, 300, 700)));
    s.aircraft = (1 - 0.5 * harm) * (0.4 * ramp(f.flat, 0.08, 0.3) + 0.3 * ramp(f.lm + f.mid, 0.55, 0.8) + 0.3 * (1 - ramp(am, 3, 8))) * ramp(snr, 8, 20);
    s.noise = ramp(f.flat, 0.3, 0.5) * (0.5 * (1 - ramp(am, 3, 8)) + 0.5 * (1 - harm));
    s.bird = ramp(f.tonal, 18, 32) * ramp(f.hi + f.vhi, 0.25, 0.5) * (0.5 + 0.5 * ramp(am, 3, 8));
    s.insect = ramp(f.tonal, 18, 30) * ramp(f.hi + f.vhi, 0.4, 0.7) * (1 - ramp(am, 3, 6));
    var quiet = 1 - ramp(snr, 3, 10);
    var list = Object.keys(s).map(function (k) { return { k: k, v: s[k] * (1 - quiet) }; });
    list.push({ k: 'quiet', v: quiet * 1.2 });
    var sum = 0;
    list.forEach(function (x) { sum += x.v; });
    list.forEach(function (x) { x.p = sum > 0 ? x.v / sum : 0; });
    list.sort(function (a, b) { return b.p - a.p; });
    ui.top = list.slice(0, 3).map(function (x) { return { k: x.k, name: x.k === 'quiet' ? 'เงียบ/เสียงรอบข้างเบา' : SRC[x.k].name, p: x.p, raw: x.v }; });
    ui.snr = snr;
    ui.db = r.hist[r.hist.length - 1].db;

    // แนวโน้มเข้าใกล้/ออกห่าง จากความชันของระดับเสียงใน 6 วินาที
    ui.trend = '';
    var seg = r.hist.slice(-60);
    if (seg.length >= 40 && snr > 8 && ui.top[0].k !== 'quiet' && ui.top[0].k !== 'noise') {
      var n = seg.length, sx = 0, sy = 0, sxy = 0, sxx = 0;
      seg.forEach(function (x, i) { var t = i / 10; sx += t; sy += x.db; sxy += t * x.db; sxx += t * t; });
      var slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
      ui.trend = slope > 1 ? 'กำลังเข้าใกล้ (ดังขึ้น ' + slope.toFixed(1) + ' dB/วินาที)' : slope < -1 ? 'กำลังออกห่าง (เบาลง ' + (-slope).toFixed(1) + ' dB/วินาที)' : 'ระดับเสียงคงที่ (ไม่ขยับมาก)';
    }

    // ประมาณระยะ
    ui.dist = '';
    var top = ui.top[0];
    if (top.k !== 'quiet' && SRC[top.k] && SRC[top.k].L && snr > 6 && top.p > 0.35) {
      var lin = Math.pow(10, ui.db / 10) - Math.pow(10, r.floor / 10);
      if (lin > 0) {
        var lsig = 10 * Math.log10(lin) + cfg.K;
        var d0 = Math.pow(10, (SRC[top.k].L - lsig) / 20);
        d0 = Math.max(d0, 1);
        ui.dist = 'ประมาณ ' + fmtDist(d0 / 3.2) + ' – ' + fmtDist(d0 * 3.2) + ' (กลางๆ ~' + fmtDist(d0) + ')';
        ui.distMid = d0;
      }
    }
  }

  /* ---------- หน้าจอ ---------- */
  function renderSheet(body) {
    loadCfg();
    body.innerHTML =
      '<div class="btnrow"><button class="btn" id="sndGo"></button></div>' +
      '<div id="sndLive"><div class="note" id="sndMeter" style="font-size:13px;color:#222"></div>' +
      '<canvas id="sndCv" width="680" height="170" style="width:100%;border-radius:10px;background:#0b1530;margin-top:6px"></canvas>' +
      '<div id="sndTop" style="margin-top:8px"></div><div id="sndTrend" style="font-size:14px;margin-top:4px"></div><div id="sndDist" style="font-size:14px;margin-top:2px"></div></div>' +
      '<h4>เสียงกระแทก · จับเวลาแสง–เสียง</h4>' +
      '<div class="btnrow"><button class="btn" id="sndFlash">เห็นแสง/ควัน (เริ่มจับเวลา)</button><button class="btn alt" id="sndHear">ได้ยินแล้ว (หยุด)</button></div>' +
      '<div id="sndEv" class="note" style="font-size:13px;color:#222"></div>' +
      '<h4>ปักหมุดต้นเสียง</h4>' +
      '<div class="field"><label style="flex:0 0 84px">ทิศ (°จริง)</label><input type="number" id="sndAz" inputmode="decimal" placeholder="เล็งโทรศัพท์ไปทางเสียง"><button class="btn alt" id="sndAzC" style="flex:none;padding:8px 10px">ใช้ทิศเครื่อง</button></div>' +
      '<div class="field"><label style="flex:0 0 84px">ระยะ (ม.)</label><input type="number" id="sndDm" inputmode="decimal"><button class="btn alt" id="sndDmC" style="flex:none;padding:8px 10px">ใช้ค่าล่าสุด</button></div>' +
      '<div class="btnrow"><button class="btn" id="sndPin">ปักหมุดต้นเสียง</button></div>' +
      '<h4>ตั้งค่า</h4>' +
      '<div class="field"><label style="flex:0 0 120px">อุณหภูมิ (°C)</label><input type="number" id="sndTemp" step="1"></div>' +
      '<div class="btnrow"><button class="btn alt" id="sndCal">ปรับเทียบความดัง</button></div>' +
      '<div id="sndCalMsg" class="note"></div>' +
      '<h4>บันทึกเหตุการณ์ล่าสุด</h4><div id="sndLog"></div>' +
      '<p class="note">ผลวิเคราะห์เป็นการคาดเดาจากรูปแบบคลื่นเสียง ไม่ใช่การยืนยัน เสียงสะท้อนในป่า/หุบเขา ลม และไมค์ของเครื่องมีผลมาก ' +
      'ระยะจากความดังเป็นช่วงกว้างมาก (คลาดเคลื่อนได้หลายเท่า) แม่นที่สุดคือวิธีจับเวลาแสง–เสียง (เสียง ≈ ' + Math.round(speedOfSound()) + ' ม./วินาที เช่น 3 วินาที ≈ 1 กม.) ' +
      'ใช้ประกอบการตัดสินใจร่วมกับการสังเกตจริงเสมอ</p>';
    $('sndTemp').value = cfg.temp;
    $('sndTemp').onchange = function () { var v = parseFloat(this.value); cfg.temp = isNaN(v) ? 30 : v; saveCfg(); };
    $('sndGo').onclick = function () {
      if (run) { stop(); } else {
        start().then(function () { sync(); });
        return;
      }
      sync();
    };
    $('sndFlash').onclick = function () {
      if (!run) { ctx.toast('กด "เริ่มฟัง" ก่อน'); return; }
      run.flash = performance.now();
      ctx.toast('จับเวลาแล้ว รอเสียงกระแทกครั้งถัดไป หรือกด "ได้ยินแล้ว"');
    };
    $('sndHear').onclick = function () {
      if (!run || !run.flash) { ctx.toast('กด "เห็นแสง/ควัน" ก่อน'); return; }
      var sec = (performance.now() - run.flash) / 1000;
      run.flash = null;
      var dist = Math.round(sec * speedOfSound());
      var rec = { t: Date.now(), kind: 'manual', label: 'จับเวลาด้วยมือ', dist: dist, sec: +sec.toFixed(2), loud: '', n: 1 };
      ui.ev = rec; ui.lastDist = dist; pushLog(rec); renderEv();
    };
    $('sndAzC').onclick = function () {
      S.start().then(function () {
        var h = S.headingTrue();
        if (h === null) ctx.toast('ยังไม่ได้ข้อมูลเข็มทิศ'); else $('sndAz').value = Math.round(h);
      });
    };
    $('sndDmC').onclick = function () {
      var d = ui.lastDist || ui.distMid;
      if (!d) { ctx.toast('ยังไม่มีค่าระยะ'); return; }
      $('sndDm').value = Math.round(d);
    };
    $('sndPin').onclick = function () {
      var az = parseFloat($('sndAz').value), dm = parseFloat($('sndDm').value);
      if (isNaN(az) || isNaN(dm) || dm <= 0) { ctx.toast('ใส่ทิศและระยะก่อน'); return; }
      var f = S.state.fix, o;
      if (f && Date.now() - f.t < 600000) o = { lat: f.lat, lng: f.lng };
      else { var c = ctx.map().getCenter(); o = { lat: c.lat, lng: c.lng }; }
      var p = G.destination(o, G.norm360(az), dm);
      var nm = 'เสียง ~' + fmtDist(dm) + ' ทิศ ' + Math.round(az) + '°';
      TrailProj.addPin(nm, p.lat, p.lng);
      ctx.toast('ปักหมุดแล้ว: ' + nm + (f ? '' : ' (นับจากกลางจอ ไม่ใช่ GPS)'));
    };
    $('sndCal').onclick = function () {
      if (!run) { ctx.toast('กด "เริ่มฟัง" ก่อน'); return; }
      var msg = $('sndCalMsg');
      msg.textContent = 'ให้คนพูดเสียงปกติห่างเครื่อง 1 เมตร ต่อเนื่อง 4 วินาที…';
      var vals = [];
      var iv = setInterval(function () {
        if (!run) { clearInterval(iv); return; }
        vals.push(run.frame ? run.frame.db : -90);
        if (vals.length >= 40) {
          clearInterval(iv);
          vals.sort(function (a, b) { return a - b; });
          var m = vals[Math.floor(vals.length * 0.6)];
          cfg.K = Math.round(60 - m);
          saveCfg();
          if ($('sndCalMsg')) $('sndCalMsg').textContent = 'ปรับเทียบแล้ว: เสียงพูดปกติ 1 ม. ≈ 60 dB (ค่าแปลง ' + cfg.K + ')';
        }
      }, 100);
    };
    sync();
    renderEv();
    renderLog();
  }

  function sync() {
    var b = $('sndGo');
    if (b) {
      b.textContent = run ? '■ หยุดฟัง' : '▶ เริ่มฟัง';
      b.className = run ? 'btn alt' : 'btn';
    }
    if ($('sndMeter') && !run) $('sndMeter').textContent = 'ยังไม่ได้ฟัง กด "เริ่มฟัง" (ต้องอนุญาตไมโครโฟน) แอพไม่อัดเสียงเก็บและไม่ส่งออกอินเทอร์เน็ต';
    if (!run) { ['sndTop', 'sndTrend', 'sndDist'].forEach(function (i) { if ($(i)) $(i).textContent = ''; }); }
  }

  function renderEv() {
    var box = $('sndEv');
    if (!box) return;
    var e = ui.ev;
    if (!e) { box.textContent = 'ยังไม่มีเหตุการณ์'; return; }
    var t = timeStr(e.t) + ' · ' + e.label + (e.n > 1 ? ' · ติดกัน ' + e.n + ' ครั้ง' : '') + (e.loud ? ' · ' + e.loud : '');
    box.innerHTML = '<b></b>';
    box.querySelector('b').textContent = t;
    if (e.dist) {
      var d = document.createElement('div');
      d.textContent = 'ห่างประมาณ ' + fmtDist(e.dist) + ' (หน่วงเวลา ' + e.sec + ' วินาที × ' + Math.round(speedOfSound()) + ' ม./วินาที)';
      d.style.cssText = 'font-size:15px;font-weight:700;color:#c4501b;margin-top:2px';
      box.appendChild(d);
    }
    if (e.cent) {
      var x = document.createElement('div');
      x.textContent = 'ความถี่กลาง ' + e.cent + ' Hz · ลดลง 20 dB ใน ' + e.dur + ' วินาที · พีค ' + e.peakDb + ' dBFS';
      box.appendChild(x);
    }
    renderLog();
  }

  function renderLog() {
    var box = $('sndLog');
    if (!box) return;
    box.innerHTML = '';
    if (!cfg.log.length) { box.innerHTML = '<p class="note">ยังไม่มี</p>'; return; }
    cfg.log.slice(0, 10).forEach(function (e) {
      var row = document.createElement('div');
      row.className = 'prow';
      row.style.fontSize = '13px';
      row.textContent = timeStr(e.t) + ' · ' + e.label + (e.dist ? ' · ' + fmtDist(e.dist) : '') + (e.loud ? ' · ' + e.loud : '');
      box.appendChild(row);
    });
  }

  function draw() {
    var f = run && run.frame;
    if (!f) return;
    var snr = ui.snr || 0;
    var spl = f.db + cfg.K;
    $('sndMeter').innerHTML = 'ระดับ <b>' + f.db.toFixed(0) + ' dBFS</b> (≈ ' + Math.round(spl) + ' dB) · เหนือเสียงรอบข้าง <b>' + snr.toFixed(0) + ' dB</b>' +
      (run.flash ? ' · <b style="color:#c4501b">กำลังจับเวลา…</b>' : '');
    var top = $('sndTop');
    top.innerHTML = '';
    ui.top.forEach(function (x, i) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;margin:3px 0;font-size:' + (i === 0 ? 15 : 13) + 'px';
      var nm = document.createElement('div');
      nm.style.cssText = 'flex:0 0 150px;' + (i === 0 ? 'font-weight:700' : 'color:#555');
      nm.textContent = x.name;
      var bar = document.createElement('div');
      bar.style.cssText = 'flex:1;height:10px;background:#eee;border-radius:5px;overflow:hidden';
      var fill = document.createElement('div');
      fill.style.cssText = 'height:100%;background:' + (i === 0 ? '#2e6b3f' : '#9bb8a3') + ';width:' + Math.round(x.p * 100) + '%';
      bar.appendChild(fill);
      var pc = document.createElement('div');
      pc.style.cssText = 'flex:0 0 38px;text-align:right';
      pc.textContent = Math.round(x.p * 100) + '%';
      row.appendChild(nm); row.appendChild(bar); row.appendChild(pc);
      top.appendChild(row);
    });
    if (ui.top.length && ui.top[0].p < 0.45 && ui.top[0].k !== 'quiet') {
      var w = document.createElement('div');
      w.style.cssText = 'font-size:12px;color:#b36b00';
      w.textContent = 'ความมั่นใจต่ำ — แยกประเภทไม่ชัด';
      top.appendChild(w);
    }
    $('sndTrend').textContent = ui.trend ? '↔ ' + ui.trend : '';
    $('sndDist').textContent = ui.dist ? '📏 ระยะจากความดัง: ' + ui.dist + ' — หยาบมาก' : '';

    // สเปกตรัม (แกนความถี่แบบลอการิทึม 30 Hz – 10 kHz)
    var cv = $('sndCv'), c = cv.getContext('2d'), W = cv.width, H = cv.height;
    c.fillStyle = '#0b1530'; c.fillRect(0, 0, W, H);
    var bin = run.sr / (run.spec.length * 2);
    var lmin = Math.log(30), lmax = Math.log(10000);
    c.beginPath();
    for (var x = 0; x < W; x++) {
      var fq = Math.exp(lmin + (lmax - lmin) * x / W);
      var k = clamp(Math.round(fq / bin), 1, run.spec.length - 1);
      var v = clamp((run.spec[k] + 110) / 90, 0, 1);
      var y = H - v * (H - 14);
      if (x) c.lineTo(x, y); else c.moveTo(x, y);
    }
    c.strokeStyle = '#6ee7a8'; c.lineWidth = 2; c.stroke();
    c.fillStyle = 'rgba(255,255,255,.55)'; c.font = '16px sans-serif'; c.textAlign = 'center';
    [100, 1000, 5000].forEach(function (fq) {
      var xx = (Math.log(fq) - lmin) / (lmax - lmin) * W;
      c.fillText(fq >= 1000 ? (fq / 1000) + 'k' : String(fq), xx, 14);
      c.fillRect(xx, 18, 1, H - 18);
    });
  }

  root.TrailSound = { init: init, renderSheet: renderSheet, isRunning: function () { return !!run; } };
})(typeof self !== 'undefined' ? self : this);
