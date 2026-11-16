'use strict';
// ตัวสร้างโจทย์: สุ่มตามหัวข้อ / จำนวนข้อ / มาตราส่วนแผนที่ที่ครูเลือก (ข้อมูลสถานที่และยอดเขาอยู่ใน questions.json)
const fs = require('fs');
const path = require('path');
const Geo = require('./public/geo.js').TrailGeo;
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8'));

const TOPICS = [
  { id: 1, name: 'ภูมิประเทศ ยอดเขา เส้นชั้นความสูง', icon: '⛰️' },
  { id: 2, name: 'พิกัด องศา ลิปดา ฟิลิปดา', icon: '🌐' },
  { id: 3, name: 'พิกัด MGRS', icon: '🔢' },
  { id: 4, name: 'วัดมุมและวัดระยะทาง', icon: '📐' },
  { id: 5, name: 'เข็มทิศกลางวัน-กลางคืน (มิลเลียม)', icon: '🧭' },
  { id: 6, name: 'เข็มทิศประกอบแผนที่', icon: '🗺️' },
  { id: 7, name: 'มาตราส่วนแผนที่', icon: '📏' }
];
const SCALES = [5000, 10000, 12500, 25000, 50000];
const DEFAULTS = Object.assign({ topics: [1, 2, 3, 4, 5, 6, 7], count: 10, scales: SCALES.slice() }, DATA.defaults || {});

// โปรไฟล์ตามมาตราส่วน: ขนาดกรอบแผนที่ (กม. จากกึ่งกลาง) ระยะเส้นกริด UTM (ม.) จำนวนหลักพิกัด และเกณฑ์คะแนน
const PROF = {
  5000: { half: 0.2, grid: 100, digits: 4, maxKm: 0.04, dmsStep: 1 / 12, dmsHalf: 0.005, dmsRound: 1 },
  10000: { half: 0.35, grid: 100, digits: 4, maxKm: 0.06, dmsStep: 1 / 6, dmsHalf: 0.01, dmsRound: 2 },
  12500: { half: 0.7, grid: 500, digits: 3, maxKm: 0.3, dmsStep: 0.25, dmsHalf: 0.0125, dmsRound: 3 },
  25000: { half: 1.25, grid: 1000, digits: 3, maxKm: 0.5, dmsStep: 0.5, dmsHalf: 0.025, dmsRound: 6 },
  50000: { half: 2.5, grid: 1000, digits: 3, maxKm: 1.0, dmsStep: 1, dmsHalf: 0.05, dmsRound: 12 }
};

const rnd = (a, b) => a + Math.random() * (b - a);
const ri = (a, b) => Math.floor(rnd(a, b + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sc = s => '1:' + s.toLocaleString('en-US');
const n2 = n => (n < 10 ? '0' : '') + n;
const fmtDMS = (v, hemi) => { v = Math.abs(v); let d = Math.floor(v), mm = (v - d) * 60, m = Math.floor(mm), s = Math.round((mm - m) * 60); if (s === 60) { s = 0; m++; } if (m === 60) { m = 0; d++; } return d + '°' + n2(m) + '′' + n2(s) + '″' + hemi; };
const mgrsStr = (u, lat, digits) => Geo.mgrsFromUTM(u, lat, digits).replace(/^(\d\d[A-Z])([A-Z]{2})/, '$1 $2');
const bboxOf = pts => [Math.min(...pts.map(p => p.lng)), Math.min(...pts.map(p => p.lat)), Math.max(...pts.map(p => p.lng)), Math.max(...pts.map(p => p.lat))];
const utmFrame = (u, halfM) => bboxOf([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(d => Geo.fromUTM(47, true, u.e + d[0] * halfM, u.n + d[1] * halfM)));
const zone47 = p => p.lng > 96.5 && p.lng < 101.9;

function makeCtx(cfg) {
  const used = new Set();
  const scales = (cfg.scales && cfg.scales.length ? cfg.scales : SCALES).filter(s => PROF[s]);
  return {
    scale: () => pick(scales.length ? scales : SCALES),
    place(filter) { // สถานที่ที่ยังไม่ซ้ำในเกมนี้
      const pool = DATA.places.filter(p => (!filter || filter(p)) && !used.has(p.name));
      const p = pick(pool.length ? pool : DATA.places.filter(filter || (() => true)));
      used.add(p.name); return p;
    },
    peak() { const pool = DATA.peaks.filter(p => !used.has('pk' + p.name)); const p = pick(pool.length ? pool : DATA.peaks); used.add('pk' + p.name); return p; }
  };
}

// ---------- หัวข้อ 1: ภูมิประเทศ ----------
const CONTOUR_CHOICES = [
  ['เส้นชั้นความสูงที่อยู่ชิดกันมาก แสดงว่าภูมิประเทศเป็นอย่างไร?', ['ลาดชัน', 'ลาดเอียงน้อย', 'เป็นที่ราบ', 'เป็นแหล่งน้ำ']],
  ['เส้นชั้นความสูงห่างกันมาก แสดงว่าภูมิประเทศเป็นอย่างไร?', ['ลาดเอียงน้อย / เกือบราบ', 'ลาดชันมาก', 'เป็นหน้าผา', 'เป็นยอดเขา']],
  ['เส้นชั้นความสูงวงปิดซ้อนกัน วงในสุดมีค่ามากที่สุด คือลักษณะใด?', ['ยอดเขา / เนิน', 'แอ่งยุบ', 'ร่องน้ำ', 'ช่องเขา']],
  ['เส้นชั้นความสูงรูปตัว V ที่ปลายชี้ขึ้นไปทางที่สูง คือลักษณะใด?', ['ร่องน้ำ / หุบเขา', 'สันเขา', 'ยอดเขา', 'เนินเตี้ย']],
  ['เส้นชั้นความสูงรูปตัว V ที่ปลายชี้ลงไปทางที่ต่ำ คือลักษณะใด?', ['สันเขา', 'ร่องน้ำ', 'แอ่งน้ำ', 'ที่ราบ']],
  ['เส้นชั้นความสูงแต่ละเส้นเชื่อมจุดที่มีสิ่งใดเท่ากัน?', ['ความสูงจากระดับน้ำทะเล', 'ระยะทาง', 'ความลาดชัน', 'อุณหภูมิ']],
  ['ค่าความต่างของความสูงระหว่างเส้นชั้นความสูงสองเส้นที่ติดกัน เรียกว่า?', ['ช่วงห่างเส้นชั้นความสูง', 'มาตราส่วน', 'มุมกริด', 'ระยะกริด']],
  ['ช่องเขา (saddle) มีลักษณะอย่างไรบนแผนที่?', ['อยู่ระหว่างยอดเขา 2 ยอด', 'เป็นวงปิดวงเดียว', 'เป็นเส้นตรงยาว', 'อยู่ริมทะเล']]
];
function t1(ctx, v) {
  if (v === 'ctype') return contourType();
  const FRAME = 0.1;
  if (v === 'peak' || v === 'spot') {
    const pk = ctx.peak(), frame = [pk.lng - FRAME, pk.lat - FRAME, pk.lng + FRAME, pk.lat + FRAME];
    if (v === 'peak') return { type: 'pin', topic: 1, seconds: 30, terrain: true, labels: false, readout: 'none', frame,
      prompt: 'ภูมิประเทศ: ปักหมุดที่ "ยอดเขาที่สูงที่สุด" ในกรอบแผนที่',
      hint: 'วงเส้นชั้นความสูงซ้อนกัน วงในสุด = ยอด · สีเขียว → น้ำตาล/ขาว = ต่ำ → สูง',
      name: pk.name + ' (≈' + pk.ele.toLocaleString('en-US') + ' ม.)', lat: pk.lat, lng: pk.lng, maxKm: 4 };
    const sp = pick(pk.spots);
    return { type: 'num', topic: 1, seconds: 40, terrain: true, labels: false, frame, mark: { lat: sp.lat, lng: sp.lng, label: 'P' },
      prompt: 'หมุด P อยู่สูงประมาณกี่ เมตร จากระดับน้ำทะเล?',
      hint: 'อ่านตัวเลขบนเส้นชั้นความสูง (เส้นหนา) แล้วประมาณตำแหน่งระหว่างเส้น',
      name: 'หมุด P สูง ≈ ' + sp.ele + ' ม. (' + pk.name + ')', value: sp.ele, maxErr: 150, numUnit: 'เมตร', numDigits: 4 };
  }
  if (v === 'choice') {
    const c = pick(CONTOUR_CHOICES), order = shuffle([0, 1, 2, 3]);
    return { type: 'choice', topic: 1, seconds: 20, prompt: c[0], hint: 'เลือกคำตอบที่ถูกต้องที่สุด', options: order.map(i => c[1][i]), correct: order.indexOf(0), name: c[1][0] };
  }
  if (Math.random() < 0.5) { // คำนวณความสูงจากเส้นชั้นความสูง
    const I = pick([10, 20, 40, 50]), F = pick([100, 200, 300, 400, 500]), K = ri(4, 9);
    return { type: 'num', topic: 1, seconds: 35, numUnit: 'เมตร', numDigits: 4, maxErr: Math.max(2 * I, 40), value: F + (K - 1) * I,
      prompt: 'เส้นชั้นความสูงช่วงห่าง ' + I + ' ม. เส้นแรกสูง ' + F + ' ม. เส้นที่ ' + K + ' สูงกี่ เมตร?',
      hint: 'ความสูง = เส้นแรก + (จำนวนเส้น − 1) × ช่วงห่าง', name: F + ' + ' + (K - 1) + ' × ' + I + ' = ' + (F + (K - 1) * I) + ' ม.' };
  }
  const I = pick([10, 20, 40, 50]), H1 = pick([100, 200, 300]), k = ri(3, 9);
  return { type: 'num', topic: 1, seconds: 35, numUnit: 'เส้น', numDigits: 2, maxErr: 3, value: k,
    prompt: 'จุด A สูง ' + H1 + ' ม. จุด B สูง ' + (H1 + k * I) + ' ม. ช่วงห่างเส้นชั้นความสูง ' + I + ' ม. A กับ B ห่างกันกี่ เส้น?',
    hint: 'จำนวนเส้น = ความสูงที่ต่างกัน ÷ ช่วงห่างเส้น', name: k + ' เส้น  (' + (k * I) + ' ÷ ' + I + ')' };
}

// ---------- หัวข้อ 2: พิกัด ° ′ ″ ----------
function t2(ctx, v) {
  if (v === 'fact') return geoFact();
  const S = ctx.scale(), P = PROF[S], pl = ctx.place();
  const R = P.dmsRound / 3600, rd = x => Math.round(x / R) * R;
  const lat = rd(pl.lat + rnd(-0.4, 0.4) * P.dmsHalf), lng = rd(pl.lng + rnd(-0.4, 0.4) * P.dmsHalf);
  const frame = [pl.lng - P.dmsHalf, pl.lat - P.dmsHalf, pl.lng + P.dmsHalf, pl.lat + P.dmsHalf];
  const maxKm = Math.round(1.2 * P.dmsStep * 1.852 * 1000) / 1000;
  const txt = fmtDMS(lat, 'N') + '  ' + fmtDMS(lng, 'E');
  const base = { topic: 2, labels: false, grid: P.dmsStep, frame, lat, lng, maxKm, scale: S, name: 'ใกล้' + pl.name };
  if (v === 'pin') return Object.assign(base, { type: 'pin', seconds: 40, readout: 'dms', prompt: 'ปักหมุดที่พิกัด ' + txt,
    hint: 'มาตราส่วน ' + sc(S) + ' · อ่านเส้นกริด (ป้าย ° ′ ″) แล้วลากหมุดให้ตรง' });
  return Object.assign(base, { type: 'dms', seconds: 45, prompt: 'หมุด 📍 อยู่ที่พิกัดเท่าไร? กรอก องศา ลิปดา ฟิลิปดา',
    hint: 'มาตราส่วน ' + sc(S) + ' · ละติจูด (N) และ ลองจิจูด (E) อ่านจากเส้นกริด', dmsText: txt });
}

// ---------- หัวข้อ 3: MGRS ----------
function t3(ctx, v) {
  const S = ctx.scale(), P = PROF[S], pl = ctx.place(zone47);
  const c = Geo.toUTM(pl.lat, pl.lng, 47), unit = Math.pow(10, 5 - P.digits), halfM = P.half * 1000;
  const e = Math.floor((c.e + rnd(-0.4, 0.4) * halfM) / unit) * unit, n = Math.floor((c.n + rnd(-0.4, 0.4) * halfM) / unit) * unit;
  const frame = utmFrame(c, halfM), ll = Geo.fromUTM(47, true, e, n), u = { zone: 47, north: true, e, n };
  const ref = mgrsStr(u, ll.lat, P.digits), gridTxt = P.digits + ' หลัก';
  const hint = 'มาตราส่วน ' + sc(S) + ' · เส้นกริดทุก ' + (P.grid >= 1000 ? (P.grid / 1000) + ' กม.' : P.grid + ' ม.') + ' · อ่านพิกัด ' + gridTxt + ' (หลักสุดท้ายคือ ' + unit + ' ม.)';
  if (v === 'pin') return { type: 'pin', topic: 3, seconds: 45, labels: false, readout: 'mgrs', digits: P.digits, gridType: 'utm', grid: P.grid, frame, maxKm: P.maxKm, scale: S,
    utm: { zone: 47, e, n }, prompt: 'ปักหมุดที่พิกัด MGRS  ' + ref, hint, name: 'ใกล้' + pl.name };
  return { type: 'grid', topic: 3, seconds: 50, labels: false, digits: P.digits, grid: P.grid, frame, maxKm: P.maxKm, scale: S, lat: ll.lat, lng: ll.lng,
    prompt: 'อ่านพิกัดกริด ' + (P.digits * 2) + ' หลัก ของหมุด 📍 (E ' + P.digits + ' หลัก + N ' + P.digits + ' หลัก)', hint, name: 'ใกล้' + pl.name };
}

// จุด A และ B บนแผนที่ตามมาตราส่วน: ระยะบนแผนที่ 4–9 ซม.
function pairAB(ctx, S) {
  const pl = ctx.place(zone47), P = PROF[S], A = { lat: pl.lat, lng: pl.lng }, cm = ri(4, 9), az = ri(0, 35) * 10 + ri(0, 1) * 5, d = cm * S / 100;
  const B = Geo.pointFromGrid(A, az, d), ga = Geo.gridAzimuth(A, B);
  const pad = 0.35, f = bboxOf([A, B]), dx = (f[2] - f[0]) * pad + 0.0005, dy = (f[3] - f[1]) * pad + 0.0005;
  return { pl, A, B, P, cm, az: ga.az, dist: ga.dist, frame: [f[0] - dx, f[1] - dy, f[2] + dx, f[3] + dy] };
}
const AB = (A, B) => ({ from: { lat: A.lat, lng: A.lng, name: 'A' }, to: { lat: B.lat, lng: B.lng, name: 'B' } });
const gridWord = g => g >= 1000 ? (g / 1000) + ' กม.' : g + ' ม.';

// ---------- หัวข้อ 4: วัดมุมและระยะทาง ----------
function t4(ctx, v) {
  if (v === 'pace') return pace(false);
  if (v === 'pace2') return pace(true);
  const S = ctx.scale();
  if (v === 'calc') { // คำนวณระยะจากพิกัด MGRS สองจุด
    const pl = ctx.place(zone47), c = Geo.toUTM(pl.lat, pl.lng, 47), e = Math.floor(c.e / 100) * 100, n = Math.floor(c.n / 100) * 100;
    const dE = ri(-30, 30) * 100, dN = ri(-30, 30) * 100, d = Math.round(Math.hypot(dE, dN) / 10) * 10;
    const a = Geo.fromUTM(47, true, e, n), b = Geo.fromUTM(47, true, e + dE, n + dN);
    return { type: 'num', topic: 4, seconds: 50, numUnit: 'เมตร', numDigits: 5, value: d, maxErr: Math.max(100, d * 0.15),
      prompt: 'จุด A = ' + mgrsStr({ zone: 47, e, n }, a.lat, 3) + '  จุด B = ' + mgrsStr({ zone: 47, e: e + dE, n: n + dN }, b.lat, 3) + ' ระยะตรง A–B กี่ เมตร?',
      hint: 'ผลต่างตะวันออก (E) และเหนือ (N) ช่องละ 100 ม. · ระยะ = √(ΔE² + ΔN²)', name: '√(' + Math.abs(dE) + '² + ' + Math.abs(dN) + '²) ≈ ' + d + ' ม.' };
  }
  const x = pairAB(ctx, S), base = Object.assign({ topic: 4, labels: false, gridType: 'utm', grid: x.P.grid, frame: x.frame, scale: S }, AB(x.A, x.B));
  if (v === 'dist') {
    const d = Math.round(x.dist / 10) * 10;
    return Object.assign(base, { type: 'num', seconds: 45, numUnit: 'เมตร', numDigits: 5, value: d, maxErr: Math.max(40, d * 0.15),
      prompt: 'วัดระยะตรงจาก A ไป B กี่ เมตร?', hint: 'มาตราส่วน ' + sc(S) + ' · ใช้เส้นกริด (ช่องละ ' + gridWord(x.P.grid) + ') เป็นไม้บรรทัด', name: 'A → B ≈ ' + d + ' ม. (ระยะบนแผนที่ ≈ ' + x.cm + ' ซม.)' });
  }
  return Object.assign(base, { type: 'compass', seconds: 35, maxDeg: 30, angle: Math.round(x.az * 10) / 10,
    prompt: 'วัดมุมกริด (Grid azimuth) จาก A ไป B ด้วยแผ่นวัดมุม/เข็มทิศ', hint: 'ทิศเหนือกริดอยู่ด้านบน (0°) · วัดตามเข็มนาฬิกา · มาตราส่วน ' + sc(S), name: 'A → B = ' + Math.round(x.az) + '°' });
}

// ---------- หัวข้อ 5: เข็มทิศกลางวัน-กลางคืน (มิลเลียม) ----------
function t5(ctx, v) {
  if (v === 'part') return compassPart();
  if (v === 'obst') return obstacle();
  const deg = (a) => Math.round(a) % 360, mil = (m) => ((m % 6400) + 6400) % 6400;
  if (v === 'dayset') { const a = ri(0, 71) * 5; return { type: 'compass', topic: 5, seconds: 25, maxDeg: 30, angle: a, prompt: '☀️ กลางวัน: เล็งเข็มทิศเลนเซติกไปที่ ' + a + '°', hint: 'อ่านวงใน (สีแดง) = องศา · 1° ≈ 17.8 มิลเลียม', name: a + '° = ' + Math.round(a * 6400 / 360) + ' มิลเลียม' }; }
  if (v === 'nightset') { const m = ri(0, 127) * 50; return { type: 'compass', topic: 5, seconds: 30, maxDeg: 20, unit: 'mil', dialStyle: 'night', angle: m * 360 / 6400, prompt: '🌙 กลางคืน: ตั้งเข็มทิศที่ ' + m.toLocaleString('en-US') + ' มิลเลียม', hint: 'อ่านวงนอก (สีดำ) = มิลเลียม ตัวเลขหน่วยร้อย เช่น 16 = 1,600 · แผ่น N E S W เรืองแสงช่วยมองในที่มืด', name: m.toLocaleString('en-US') + ' มิลเลียม = ' + Math.round(m * 360 / 6400) + '°' }; }
  if (v === 'backday') { const a = ri(1, 17) * 10; return { type: 'compass', topic: 5, seconds: 30, maxDeg: 30, angle: deg(a + 180), prompt: '☀️ กลางวัน: เดินที่ Azimuth ' + a + '° กลับทางเดิมต้องตั้ง Back azimuth เท่าไร?', hint: 'Back azimuth = Azimuth ± 180°', name: a + '° → ' + deg(a + 180) + '°' }; }
  if (v === 'backnight') { const m = ri(1, 31) * 100; return { type: 'compass', topic: 5, seconds: 35, maxDeg: 30, unit: 'mil', dialStyle: 'night', angle: mil(m + 3200) * 360 / 6400, prompt: '🌙 กลางคืน: เดินที่ ' + m.toLocaleString('en-US') + ' มิลเลียม กลับทางเดิมต้องตั้งกี่ มิลเลียม?', hint: 'ครึ่งวงกลม = 3,200 มิลเลียม · Back azimuth = ± 3,200 มิลเลียม', name: m + ' ± 3,200 = ' + mil(m + 3200).toLocaleString('en-US') + ' มิลเลียม' }; }
  if (v === 'd2m') { const k = ri(1, 39), d = 9 * k; return { type: 'num', topic: 5, seconds: 35, numUnit: 'มิลเลียม', numDigits: 4, value: 160 * k, maxErr: 300, prompt: d + '° เท่ากับกี่ มิลเลียม?', hint: 'วงกลม 360° = 6,400 มิลเลียม (9° = 160 มิลเลียม)', name: d + ' × 6,400 ÷ 360 = ' + (160 * k) + ' มิลเลียม' }; }
  if (v === 'm2d') { const k = ri(1, 39), m = 160 * k; return { type: 'num', topic: 5, seconds: 35, numUnit: '°', numDigits: 3, value: 9 * k, maxErr: 15, prompt: m.toLocaleString('en-US') + ' มิลเลียม เท่ากับกี่ องศา?', hint: 'วงกลม 6,400 มิลเลียม = 360° (160 มิลเลียม = 9°)', name: m + ' × 360 ÷ 6,400 = ' + (9 * k) + '°' }; }
  if (v === 'clicks') { const a = ri(2, 60) * 3; return { type: 'num', topic: 5, seconds: 30, numUnit: 'คลิก', numDigits: 3, value: a / 3, maxErr: 10, prompt: '🌙 กลางคืน: หมุนขอบเข็มทิศเลนเซติก (1 คลิก = 3°) ไปที่ ' + a + '° ต้องหมุนกี่ คลิก?', hint: 'จำนวนคลิก = องศา ÷ 3 (1 รอบ = 120 คลิก)', name: a + ' ÷ 3 = ' + (a / 3) + ' คลิก' }; }
  if (v === 'turn') { const a = ri(0, 35) * 10, t = ri(1, 17) * 5, right = Math.random() < 0.5, r = deg(a + (right ? t : -t) + 360);
    return { type: 'num', topic: 5, seconds: 40, numUnit: '°', numDigits: 3, value: r, maxErr: 15, prompt: 'หันหน้าที่ Azimuth ' + a + '° แล้วเลี้ยว' + (right ? 'ขวา ' : 'ซ้าย ') + t + '° ตอนนี้หันหน้าไป Azimuth เท่าไร?', hint: 'ขวา = บวก (ตามเข็มนาฬิกา) · ซ้าย = ลบ', name: a + (right ? ' + ' : ' − ') + t + ' = ' + r + '°' }; }
  if (v === 'dec') { const g = ri(0, 35) * 10, d = ri(1, 6); return { type: 'num', topic: 5, seconds: 40, numUnit: '°', numDigits: 3, value: g + d, maxErr: 10, prompt: 'มุมกริด ' + g + '° — เหนือแม่เหล็กอยู่ทางตะวันตกของเหนือกริด ' + d + '° (G–M ' + d + '° W) มุมแม่เหล็กที่ตั้งบนเข็มทิศ = ?', hint: 'เหนือแม่เหล็กอยู่ตะวันตก → มุมแม่เหล็ก = มุมกริด + G–M', name: g + ' + ' + d + ' = ' + (g + d) + '°' }; }
  if (v === 'cbezel') return { type: 'choice', topic: 5, seconds: 20, options: ['1°', '3°', '5°', '10°'], correct: 1, prompt: 'ขอบหมุด (bezel) ของเข็มทิศเลนเซติก หมุน 1 คลิก เท่ากับกี่องศา?', hint: 'ตามเข็มทิศเลนเซติกแบบมาตรฐาน (120 คลิกต่อรอบ)', name: '3° ต่อ 1 คลิก' };
  return { type: 'choice', topic: 5, seconds: 20, options: ['3,200 มิลเลียม', '1,600 มิลเลียม', '6,400 มิลเลียม', '360 มิลเลียม'], correct: 0, prompt: 'ครึ่งวงกลม (180°) เท่ากับกี่ มิลเลียม?', hint: 'วงกลมเต็ม = 6,400 มิลเลียม', name: '180° = 3,200 มิลเลียม' };
}

// ---------- หัวข้อ 6: เข็มทิศประกอบแผนที่ ----------
function t6(ctx, v) {
  if (v === 'resect') return resection(ctx);
  if (v === 'orient') return orientMap();
  const S = ctx.scale(), x = pairAB(ctx, S);
  const base = Object.assign({ topic: 6, labels: false, gridType: 'utm', grid: x.P.grid, frame: x.frame, scale: S, type: 'compass', seconds: 35, maxDeg: 30 }, AB(x.A, x.B));
  const az = x.az, bk = (az + 180) % 360;
  if (v === 'az') return Object.assign(base, { angle: Math.round(az * 10) / 10, prompt: 'เข็มทิศประกอบแผนที่: เดินจาก A ไป B ต้องตั้งมุมกริด (Grid azimuth) เท่าไร?', hint: 'มาตราส่วน ' + sc(S) + ' · ทิศเหนือกริดอยู่ด้านบน (0°)', name: 'A → B = ' + Math.round(az) + '°' });
  if (v === 'back') return Object.assign(base, { angle: Math.round(bk * 10) / 10, prompt: 'ถึง B แล้วจะกลับไป A ต้องตั้ง Back azimuth เท่าไร?', hint: 'Back azimuth = มุมไป ± 180°', name: 'B → A = ' + Math.round(bk) + '°' });
  if (v === 'mil') return Object.assign(base, { unit: 'mil', maxDeg: 20, angle: Math.round(az * 10) / 10, prompt: 'เดินจาก A ไป B ตั้งมุมกริดกี่ มิลเลียม? (อ่านวงนอกสีดำ)', hint: 'วงกลม 6,400 มิลเลียม · 1° ≈ 17.8 มิลเลียม', name: 'A → B = ' + Math.round(az) + '° = ' + Math.round(az * 6400 / 360) + ' มิลเลียม' });
  const gm = ri(2, 5), mag = (az + gm) % 360; // มุมแม่เหล็ก = มุมกริด + G–M (ตะวันตก)
  return Object.assign(base, { angle: Math.round(mag * 10) / 10, prompt: 'เดินจาก A ไป B ตั้ง มุมแม่เหล็ก เท่าไร? (G–M ' + gm + '° W)', hint: 'เหนือแม่เหล็กอยู่ทางตะวันตกของเหนือกริด → มุมแม่เหล็ก = มุมกริด + ' + gm + '°', name: 'มุมกริด ' + Math.round(az) + '° + ' + gm + '° = ' + Math.round(mag) + '°' });
}

// ---------- หัวข้อ 7: มาตราส่วน ----------
function t7(ctx, v) {
  if (v === 'form') return scaleForm();
  const S = ctx.scale();
  if (v === 'cm2m') { const cm = ri(2, 12), m = cm * S / 100; return { type: 'num', topic: 7, seconds: 35, numUnit: 'เมตร', numDigits: 5, value: m, maxErr: Math.max(m * 0.1, 20), prompt: 'แผนที่มาตราส่วน ' + sc(S) + ' ระยะบนแผนที่ ' + cm + ' ซม. คือระยะจริงกี่ เมตร?', hint: '1 ซม. บนแผนที่ = ' + (S / 100).toLocaleString('en-US') + ' ม. จริง', name: cm + ' × ' + (S / 100) + ' = ' + m.toLocaleString('en-US') + ' ม.' }; }
  if (v === 'm2cm') { const half = S % 200 === 0 && Math.random() < 0.5, cm = ri(2, 11) + (half ? 0.5 : 0), m = cm * S / 100; return { type: 'num', topic: 7, seconds: 40, numUnit: 'ซม.', numDigits: 4, decimal: half, value: cm, maxErr: half ? 1 : 3, prompt: 'ระยะจริง ' + m.toLocaleString('en-US') + ' เมตร บนแผนที่ ' + sc(S) + ' วัดได้กี่ ซม.?', hint: 'ระยะบนแผนที่ = ระยะจริง ÷ (S ÷ 100)', name: m.toLocaleString('en-US') + ' ÷ ' + (S / 100) + ' = ' + cm + ' ซม.' }; }
  if (v === 'grid') { const g = pick([100, 500, 1000]), cm = g * 100 / S; if (!Number.isInteger(cm)) return t7(ctx, 'cm2m'); return { type: 'num', topic: 7, seconds: 35, numUnit: 'ซม.', numDigits: 3, value: cm, maxErr: 3, prompt: 'ช่องกริดกว้าง ' + gridWord(g) + ' บนแผนที่ ' + sc(S) + ' กว้างกี่ ซม.?', hint: 'ซม. บนแผนที่ = ระยะจริง (ม.) × 100 ÷ S', name: g + ' × 100 ÷ ' + S + ' = ' + cm + ' ซม.' }; }
  if (v === 'large') return { type: 'choice', topic: 7, seconds: 20, options: shuffleOpts(['1:5,000', '1:25,000', '1:50,000', '1:250,000'], 0), prompt: 'มาตราส่วนใด แสดงรายละเอียดภูมิประเทศ "มากที่สุด"?', hint: 'มาตราส่วนใหญ่ = ตัวส่วนน้อย', name: '1:5,000 (มาตราส่วนใหญ่ที่สุด)' };
  return { type: 'choice', topic: 7, seconds: 20, options: shuffleOpts(['1 ซม. = ' + (S / 100).toLocaleString('en-US') + ' ม.', '1 ซม. = ' + (S / 10).toLocaleString('en-US') + ' ม.', '1 ซม. = ' + (S).toLocaleString('en-US') + ' ม.', '1 ซม. = ' + (S / 1000).toLocaleString('en-US') + ' ม.'], 0), prompt: 'แผนที่มาตราส่วน ' + sc(S) + ' 1 เซนติเมตร บนแผนที่ เท่ากับระยะจริงเท่าไร?', hint: '1 ซม. = S ซม. จริง ÷ 100 = เมตร', name: '1 ซม. = ' + (S / 100).toLocaleString('en-US') + ' ม.' };
}
function shuffleOpts(opts, correctIdx) { return { __opts: opts, __c: correctIdx }; }

// ---------- เนื้อหาจากสไลด์สอน (แผนที่-เข็มทิศ) ----------
const opts4 = (right, others) => shuffleOpts([right].concat(shuffle(others).slice(0, 3)), 0);
const CONTOUR_TYPES = ['เส้นชั้นความสูงหลัก (Index Contour)', 'เส้นชั้นความสูงรอง (Intermediate Contour)', 'เส้นชั้นความสูงแทรก (Supplement Contour)', 'เส้นชั้นความสูงคุ้งกระทะ (Depression Contour)', 'เส้นชั้นความสูงโดยประมาณ (Approximate Contour)'];
const CONTOUR_DEF = [
  'เส้นชั้นความสูงที่หนากว่า และมีตัวเลขความสูงกำกับ เรียกว่า?',
  'เส้นชั้นความสูงที่บางกว่า อยู่ระหว่างเส้นหลัก เรียกว่า?',
  'เส้นชั้นความสูงที่เพิ่มเข้ามาในที่ค่อนข้างราบเพื่อแสดงรายละเอียด (เส้นประ) เรียกว่า?',
  'เส้นชั้นความสูงที่มีขีดสั้นๆ ชี้ไปทางที่ต่ำ แสดงแอ่งบุ๋มลงไป เรียกว่า?',
  'เส้นชั้นความสูงที่ใช้เมื่อไม่ทราบความสูงที่แน่นอน เรียกว่า?'];
function contourType() {
  const i = ri(0, 4);
  return { type: 'choice', topic: 1, seconds: 25, prompt: CONTOUR_DEF[i], hint: 'ชนิดเส้นชั้นความสูง: หลัก · รอง · แทรก · คุ้งกระทะ · โดยประมาณ',
    options: opts4(CONTOUR_TYPES[i], CONTOUR_TYPES.filter((_, j) => j !== i)), name: CONTOUR_TYPES[i] };
}
const GEO_FACTS = [
  ['ละติจูด คือระยะเชิงมุมที่วัดจากเส้นใด?', 'เส้นศูนย์สูตร', ['เมอริเดียนเริ่มแรก (Prime meridian)', 'เส้นทรอปิก', 'เส้นแบ่งเขตวัน']],
  ['ลองจิจูด คือระยะเชิงมุมที่วัดจากเส้นใด?', 'เมอริเดียนเริ่มแรก (Prime meridian)', ['เส้นศูนย์สูตร', 'เส้นทรอปิก', 'ขั้วโลกเหนือ']],
  ['60 ฟิลิปดา เท่ากับเท่าไร?', '1 ลิปดา', ['1 องศา', '10 ลิปดา', '100 ฟิลิปดา']],
  ['60 ลิปดา เท่ากับเท่าไร?', '1 องศา', ['1 ฟิลิปดา', '10 องศา', '100 ลิปดา']],
  ['ละติจูด 14°15′35″ เหนือ หมายความว่าอย่างไร?', 'อยู่เหนือเส้นศูนย์สูตร 14 องศา 15 ลิปดา 35 ฟิลิปดา', ['อยู่ใต้เส้นศูนย์สูตร 14 องศา 15 ลิปดา 35 ฟิลิปดา', 'อยู่ตะวันออกของเมอริเดียนเริ่มแรก 14 องศา', 'อยู่ห่างจากขั้วโลกเหนือ 14 องศา']]
];
function geoFact() {
  const r = Math.random();
  if (r < 0.2) return { type: 'num', topic: 2, seconds: 35, numUnit: 'เมตร', numDigits: 4, value: 1800, maxErr: 400, prompt: '1 ลิปดา มีความยาวประมาณกี่ เมตร?', hint: '1 ลิปดา ≈ 1 ไมล์ทะเล (ประมาณ 1,800 ม.)', name: '1 ลิปดา ≈ 1,800 ม.' };
  if (r < 0.4) return { type: 'num', topic: 2, seconds: 35, numUnit: 'เมตร', numDigits: 3, value: 30, maxErr: 15, prompt: '1 ฟิลิปดา มีความยาวประมาณกี่ เมตร?', hint: '1 ลิปดา ≈ 1,800 ม. ÷ 60 ฟิลิปดา', name: '1 ฟิลิปดา ≈ 30 ม.' };
  const f = pick(GEO_FACTS);
  return { type: 'choice', topic: 2, seconds: 25, prompt: f[0], hint: 'หน่วยมุม: 60 ฟิลิปดา = 1 ลิปดา · 60 ลิปดา = 1 องศา', options: opts4(f[1], f[2]), name: f[1] };
}
function pace(rev) { // นับก้าว: ระยะทาง = (ก้าวที่นับได้ ÷ ก้าวมาตรฐาน) × 100 เมตร
  const std = pick([120, 130, 140, 150, 160]), dist = pick([100, 200, 300, 400, 500, 600]), steps = std * dist / 100;
  if (!rev) return { type: 'num', topic: 4, seconds: 45, numUnit: 'เมตร', numDigits: 4, value: dist, maxErr: Math.max(50, dist * 0.2),
    prompt: 'นับก้าวได้ ' + steps + ' ก้าว (ก้าวมาตรฐาน 100 เมตร = ' + std + ' ก้าว) ระยะทางกี่ เมตร?', hint: 'ระยะทาง = (ก้าวที่นับได้ ÷ ก้าวมาตรฐาน) × 100 เมตร', name: steps + ' ÷ ' + std + ' × 100 = ' + dist + ' เมตร' };
  return { type: 'num', topic: 4, seconds: 45, numUnit: 'ก้าว', numDigits: 4, value: steps, maxErr: Math.max(40, steps * 0.2),
    prompt: 'ก้าวมาตรฐาน 100 เมตร = ' + std + ' ก้าว เดินทาง ' + dist + ' เมตร ต้องนับได้กี่ ก้าว?', hint: 'ก้าว = ระยะทาง ÷ 100 × ก้าวมาตรฐาน', name: dist + ' ÷ 100 × ' + std + ' = ' + steps + ' ก้าว' };
}
const COMPASS_Q = [
  ['เข็มทิศเลนเซติกมีส่วนประกอบสำคัญกี่ส่วน?', '3 ส่วน: ฝาตลับ ตัวเรือน ก้านเล็ง', ['2 ส่วน: ตัวเรือน กับ ฝาตลับ', '4 ส่วน: ฝาตลับ ตัวเรือน ก้านเล็ง ห่วงจับถือ', '5 ส่วน']],
  ['เข็มทิศเลนเซติกอ่านมุมได้ถูกต้องใกล้เคียงกี่องศา?', '2 องศา', ['0.1 องศา', '10 องศา', '15 องศา']],
  ['การอ่านค่ามุมทิศ ให้อ่านค่าที่ตำแหน่งใด?', 'ใต้เส้นขีดดำ (ดัชนีชี้มุมภาค) มองผ่านช่องแว่นขยาย', ['ที่ปลายก้านเล็ง', 'ที่ห่วงจับถือ', 'ที่กระเดื่องบังคับ']],
  ['ห่วงจับถือ ของเข็มทิศเลนเซติกใช้ทำอะไร?', 'สอดนิ้วหัวแม่มือ จับถือให้มั่นคง', ['หมุนตั้งมุมภาค', 'เล็งไปยังที่หมาย', 'ล็อกเข็มทิศ']],
  ['ส่วนใดของเข็มทิศใช้เล็งไปยังที่หมาย ร่วมกับเส้นเล็งที่ฝาตลับ?', 'ก้านเล็ง (ช่องเล็งหลัง)', ['วงแหวนคลิก', 'ห่วงจับถือ', 'กระเดื่องบังคับ']],
  ['หน้าปัดเข็มทิศเลนเซติกมีมุมกี่แบบ?', '2 แบบ: มิลเลียม (วงนอก สีดำ) และ องศา (วงใน สีแดง)', ['แบบองศาอย่างเดียว', '2 แบบ: องศา (วงนอก) และ มิลเลียม (วงใน สีแดง)', '3 แบบ: องศา มิลเลียม ไมล์']],
  ['ลูกศรเรืองแสง (พรายน้ำ) บนหน้าปัดชี้ไปทางใด?', 'ทิศเหนือ (แม่เหล็ก)', ['ที่หมาย', 'ทิศใต้', 'ทิศตะวันออก']],
  ['ไม้บรรทัดมาตราส่วนที่ขอบข้างเข็มทิศเลนเซติก ใช้วัดระยะบนแผนที่มาตราส่วนใด?', '1:25,000 หรือ 1:50,000', ['1:5,000', '1:250,000', '1:100']],
  ['วงแหวนคลิก ของเข็มทิศเลนเซติกใช้ทำอะไร?', 'หมุนตั้งมุมที่ต้องการ (ช่วยตอนกลางคืน)', ['จับถือเข็มทิศ', 'เล็งไปยังที่หมาย', 'อ่านมาตราส่วนแผนที่']]
];
function compassPart() {
  const c = pick(COMPASS_Q);
  return { type: 'choice', topic: 5, seconds: 25, prompt: c[0], hint: 'ส่วนประกอบเข็มทิศเลนเซติก: ฝาตลับ · ตัวเรือน · ก้านเล็ง', options: opts4(c[1], c[2]), name: c[1] };
}
function obstacle() { // เดินอ้อมสิ่งกีดขวาง: หักออกเป็นมุมฉาก ขวา + 90° ซ้าย − 90°
  const a = ri(0, 35) * 10, right = Math.random() < 0.5, r = (((a + (right ? 90 : -90)) % 360) + 360) % 360;
  return { type: 'num', topic: 5, seconds: 35, numUnit: '°', numDigits: 3, value: r, maxErr: 15,
    prompt: 'เดินที่ Azimuth ' + a + '° พบสิ่งกีดขวาง หักออกทาง' + (right ? 'ขวา' : 'ซ้าย') + 'เป็นมุมฉาก ต้องเดินที่ Azimuth เท่าไร?',
    hint: 'หักออกจากแนวเดิมเป็นมุมฉาก: ขวา = บวก 90° · ซ้าย = ลบ 90°', name: a + (right ? ' + ' : ' − ') + '90 = ' + r + '°' };
}
const ORIENT_Q = [
  ['วางแผนที่ให้ถูกทิศด้วยเข็มทิศ ต้องทาบขอบตรงของเข็มทิศกับเส้นกริดใด และหมุนอะไร?', 'ทาบกับเส้นกริดตั้ง แล้วหมุน "แผนที่" จนลูกศรอยู่ใต้เส้นดัชนีสีดำ', ['ทาบกับเส้นกริดนอน แล้วหมุน "เข็มทิศ" จนลูกศรอยู่ใต้เส้นดัชนี', 'ทาบกับเส้นกริดตั้ง แล้วหมุน "เข็มทิศ" ตามแผนที่', 'ไม่ต้องทาบ วางเข็มทิศตรงไหนก็ได้']],
  ['ก่อนเริ่มเดินทางทุกครั้งต้องทำสิ่งใดก่อน?', 'วางแผนที่ให้ถูกทิศ (Orienting the Map)', ['วัดระยะทางด้วยก้าว', 'คำนวณมาตราส่วนใหม่', 'เปลี่ยนเส้นชั้นความสูง']],
  ['ถ้าแผนที่มีมุม G-M ตอนวางแผนที่ด้วยเข็มทิศต้องทำอย่างไร?', 'หมุนแผนที่เพิ่มตามค่ามุม G-M', ['ไม่ต้องสนใจมุม G-M', 'ลบมุม G-M ออกจากมาตราส่วน', 'เปลี่ยนไปใช้ GPS']],
  ['ควรกางแผนที่เพื่อใช้เข็มทิศที่ใด?', 'บนพื้นราบ ห่างจากโลหะ', ['บนตัวรถยนต์ ใกล้เสาไฟฟ้า', 'บนแผ่นเหล็กราบๆ', 'บนอาวุธ']]
];
function orientMap() {
  const c = pick(ORIENT_Q);
  return { type: 'choice', topic: 6, seconds: 30, prompt: c[0], hint: 'วางแผนที่ให้ถูกทิศ (Orienting the Map)', options: opts4(c[1], c[2]), name: c[1] };
}
function resection(ctx) { // สกัดกลับแบบสองที่หมาย: Back azimuth มากกว่า 180 ลบ 180 · น้อยกว่า 180 บวก 180
  const S = ctx.scale(), P = PROF[S], pl = ctx.place(zone47), Pt = { lat: pl.lat, lng: pl.lng };
  const a1 = ri(0, 35) * 10, a2 = (a1 + ri(7, 12) * 10) % 360, d1 = ri(4, 9) * S / 100, d2 = ri(4, 9) * S / 100;
  const A = Geo.pointFromGrid(Pt, a1, d1), B = Geo.pointFromGrid(Pt, a2, d2);
  const g1 = Math.round(Geo.gridAzimuth(Pt, A).az), g2 = Math.round(Geo.gridAzimuth(Pt, B).az);
  const f = bboxOf([Pt, A, B]), dx = (f[2] - f[0]) * 0.3 + 0.0005, dy = (f[3] - f[1]) * 0.3 + 0.0005;
  return { type: 'pin', topic: 6, seconds: 70, labels: false, readout: 'none', gridType: 'utm', grid: P.grid, frame: [f[0] - dx, f[1] - dy, f[2] + dx, f[3] + dy], scale: S,
    lat: Pt.lat, lng: Pt.lng, maxKm: Math.max(0.1, 0.3 * (d1 + d2) / 2 / 1000),
    markers: [{ lat: A.lat, lng: A.lng, label: 'A', name: 'ยอด A' }, { lat: B.lat, lng: B.lng, label: 'B', name: 'ยอด B' }],
    prompt: 'สกัดกลับ: เล็งไปยอด A ได้ ' + g1 + '° ยอด B ได้ ' + g2 + '° ปักหมุดตำแหน่งที่คุณยืนอยู่',
    hint: 'Back azimuth: มากกว่า 180° ลบ 180° · น้อยกว่า 180° บวก 180° · ตำแหน่งอยู่ที่จุดตัดของสองแนว · มาตราส่วน ' + sc(S),
    name: 'A: ' + g1 + '° → กลับ ' + ((g1 + 180) % 360) + '° · B: ' + g2 + '° → กลับ ' + ((g2 + 180) % 360) + '°' };
}
function scaleForm() { // มาตราส่วน 3 แบบ: อัตราส่วน / คำพูด / แถบ
  const S = pick([10000, 25000, 50000]);
  const items = [['อัตราส่วน (Representative Fraction)', '1 : ' + S.toLocaleString('en-US')], ['มาตราส่วนคำพูด (Verbal Scale)', '“1 เซนติเมตร เท่ากับ ' + (S / 100).toLocaleString('en-US') + ' เมตร”'], ['แถบมาตราส่วน (Bar Scale)', 'เส้นแบ่งช่องบนขอบแผนที่ ใช้วัดระยะได้ทันที']];
  const k = ri(0, 2);
  return { type: 'choice', topic: 7, seconds: 25, prompt: items[k][1] + ' เป็นมาตราส่วนแบบใด?', hint: 'มาตราส่วนมี 3 แบบ: อัตราส่วน · คำพูด · แถบ',
    options: opts4(items[k][0], items.filter((_, i) => i !== k).map(x => x[0]).concat(['มาตราส่วนกราฟ'])), name: items[k][0] };
}

const GEN = {
  1: { fn: t1, v: ['peak', 'spot', 'choice', 'ctype', 'calc', 'ctype', 'peak', 'spot'] },
  2: { fn: t2, v: ['pin', 'typed', 'fact', 'pin', 'typed'] },
  3: { fn: t3, v: ['pin', 'typed'] },
  4: { fn: t4, v: ['dist', 'az', 'calc', 'pace', 'pace2'] },
  5: { fn: t5, v: ['dayset', 'nightset', 'backday', 'backnight', 'd2m', 'm2d', 'clicks', 'turn', 'dec', 'cbezel', 'half', 'part', 'part', 'obst'] },
  6: { fn: t6, v: ['az', 'back', 'mil', 'mag', 'resect', 'orient'] },
  7: { fn: t7, v: ['cm2m', 'm2cm', 'grid', 'large', 'unit', 'form', 'form'] }
};

function finalize(q) { // ตัวเลือกแบบสุ่มสลับของข้อ choice ที่ใช้ shuffleOpts
  if (q.options && q.options.__opts) { const o = q.options.__opts, c = q.options.__c, order = shuffle(o.map((_, i) => i)); q.options = order.map(i => o[i]); q.correct = order.indexOf(c); }
  return q;
}

function generate(cfg) {
  cfg = Object.assign({}, DEFAULTS, cfg || {});
  let topics = (cfg.topics || []).filter(t => GEN[t]);
  if (!topics.length) topics = DEFAULTS.topics.slice();
  const count = Math.max(1, Math.min(40, +cfg.count || DEFAULTS.count));
  const ctx = makeCtx(cfg), buckets = {};
  // แบ่งจำนวนข้อให้ทุกหัวข้อใกล้เคียงกัน (เศษสุ่มให้หัวข้อใดหัวข้อหนึ่ง)
  const per = {}; topics.forEach(t => per[t] = Math.floor(count / topics.length));
  shuffle(topics).slice(0, count % topics.length).forEach(t => per[t]++);
  topics.forEach(t => {
    const vs = shuffle(GEN[t].v), list = [];
    for (let i = 0; i < per[t]; i++) {
      let v = vs[i % vs.length]; if (i >= vs.length) v = pick(GEN[t].v);
      list.push(finalize(GEN[t].fn(ctx, v)));
    }
    buckets[t] = list;
  });
  // สลับหัวข้อไม่ให้ซ้ำติดกัน
  const out = []; let last = -1, left = topics.filter(t => buckets[t].length);
  while (left.length) {
    const choices = left.filter(t => t !== last), t = pick(choices.length ? choices : left);
    out.push(buckets[t].shift()); last = t; left = left.filter(x => buckets[x].length);
  }
  return out;
}

module.exports = { generate, TOPICS, SCALES, DEFAULTS, PROF };
