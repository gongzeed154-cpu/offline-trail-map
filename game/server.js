'use strict';
// เซิร์ฟเวอร์เกมแผนที่แบบเรียลไทม์ — ไม่ใช้ไลบรารีภายนอก (Node 18+)
// รัน:  node server.js   แล้วเปิดหน้าจอครูที่ http://localhost:3000/host
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const crypto = require('crypto');

const PORT = +process.env.PORT || 3000;
const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8'));
const bank = require('./bank.js');
let QS = [], N = 0;
let gameCfg = JSON.parse(JSON.stringify(bank.DEFAULTS)); // หัวข้อ / จำนวนข้อ / มาตราส่วน ที่ครูเลือก
const T_COUNT = (CFG.countdownSeconds || 5) * 1000;
const qMs = q => (q.seconds || CFG.questionSeconds || 25) * 1000;
const T_REVEAL = (CFG.revealSeconds || 6) * 1000;
const GRACE = 1500; // ยอมรับคำตอบที่มาช้ากว่าเวลาเล็กน้อย (เน็ตหน่วง)

// ---------- ไฟล์หน้าเว็บ (บีบอัดไว้ในหน่วยความจำ) ----------
const PUB = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
const files = new Map();
(function load(dir, rel) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name), r = rel + '/' + f.name;
    if (f.isDirectory()) load(full, r);
    else {
      const buf = fs.readFileSync(full);
      files.set(r, { buf, gz: zlib.gzipSync(buf), type: TYPES[path.extname(f.name)] || 'application/octet-stream' });
    }
  }
})(PUB, '');

// ---------- สถานะเกม ----------
const players = new Map(); // id -> {id,n,name,scores:[],conns:0}
let seq = 0;
let phase = 'lobby'; // lobby | countdown | question | reveal | final
let qi = -1;
let deadline = 0;
let timer = null;
let earlyScheduled = false;
const streams = new Set(); // {res, id, host}
const kicked = new Set();

function haversineKm(a, b, c, d) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (c - a) * r, dLng = (d - b) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearingDeg(a, b, c, d) { // มุมภาค (azimuth) จากจุด (a,b) ไปจุด (c,d) เทียบทิศเหนือจริง
  const r = Math.PI / 180, dl = (d - b) * r;
  const y = Math.sin(dl) * Math.cos(c * r), x = Math.cos(a * r) * Math.sin(c * r) - Math.sin(a * r) * Math.cos(c * r) * Math.cos(dl);
  return (Math.atan2(y, x) / r + 360) % 360;
}
const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
// ใช้โค้ดพิกัดชุดเดียวกับแอปฝึกแผนที่ (UTM / MGRS / มุมกริด) — คัดลอกมาจาก docs/geo.js
const Geo = require('./public/geo.js').TrailGeo;
const pad3 = v => String(Math.floor(v)).padStart(3, '0');
function prepare(q) {
  q.type = q.type || 'pin';
  if (q.utm) { const ll = Geo.fromUTM(q.utm.zone || 47, true, q.utm.e, q.utm.n); q.lat = ll.lat; q.lng = ll.lng; } // เฉลยเป็นพิกัดกริด UTM
  q.gridMode = q.type === 'grid' || !!q.utm || (q.gridType === 'utm' && q.lat != null);
  if (q.gridMode) {
    q.u = q.utm ? { zone: 47, north: true, e: q.utm.e, n: q.utm.n } : Geo.toUTM(q.lat, q.lng, 47);
    const r3 = v => Math.round(v * 1000) / 1000; q.u.e = r3(q.u.e); q.u.n = r3(q.u.n); // กันเศษทศนิยมลอยตอนปัดลงเป็นช่อง 100 ม.
    q.digits = q.digits || 3; const un = Math.pow(10, 5 - q.digits), pd = v => String(Math.floor(v)).padStart(q.digits, '0');
    q.gridText = pd((q.u.e % 100000) / un) + ' ' + pd((q.u.n % 100000) / un);
    q.mgrsText = Geo.mgrsFromUTM(q.u, q.lat, q.digits);
    if (!q.frame) { // กรอบแผนที่รอบจุดเฉลย (ครึ่งหนึ่งของด้าน, กม.) ในระบบกริด UTM
      const h = (q.halfKm || 2.5) * 1000, ps = [[-h, -h], [h, -h], [h, h], [-h, h]].map(d => Geo.fromUTM(47, true, q.u.e + d[0], q.u.n + d[1]));
      q.frame = [Math.min(...ps.map(p => p.lng)), Math.min(...ps.map(p => p.lat)), Math.max(...ps.map(p => p.lng)), Math.max(...ps.map(p => p.lat))];
    }
    if (!q.grid) q.grid = 1000; // ระยะเส้นกริด (เมตร)
  }
  if (q.type === 'compass' && q.angle == null && q.from && q.to) // ค่าเริ่มต้น = มุมกริด (grid azimuth) เหมือนแอป; north:"true" = เหนือจริง
    q.angle = q.north === 'true' ? Math.round(bearingDeg(q.from.lat, q.from.lng, q.to.lat, q.to.lng) * 10) / 10
      : Math.round(Geo.gridAzimuth(q.from, q.to).az * 10) / 10;
}
// ---------- คลังข้อสอบ / ชุดที่บันทึกไว้ (โฟลเดอร์ saved/) ----------
const SAVED = path.join(__dirname, 'saved');
try { fs.mkdirSync(SAVED, { recursive: true }); } catch (e) { console.error('สร้างโฟลเดอร์ saved ไม่ได้:', e.message); }
let fixedSet = null, fixedName = ''; // ชุดที่ครูเลือกเอง (ถ้ามี) จะถูกใช้แทนการสุ่ม
const pool = new Map(); let poolSeq = 0; // ข้อที่ครูกำลังดู/เลือก: id -> ข้อสอบดิบ
const cloneQ = o => JSON.parse(JSON.stringify(o));
const safeName = n => String(n || '').trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').replace(/^\.+/, '').slice(0, 60);
const catalogMap = new Map();
function catalogList(t) { // คลังข้อสอบคงที่ หัวข้อละ 50 ข้อ (id คงที่ c<หัวข้อ>-<ลำดับ>)
  return (bank.catalog()[t] || []).map((q, i) => { const id = 'c' + t + '-' + (i + 1); catalogMap.set(id, q); return previewOf(q, id); });
}
const getQ = id => pool.get(id) || catalogMap.get(id);
function addToPool(q) { const id = 'q' + (++poolSeq); pool.set(id, q); if (pool.size > 1500) pool.delete(pool.keys().next().value); return id; }
function previewOf(q, id) {
  return { id, topic: q.topic || 0, type: q.type, prompt: q.prompt, hint: q.hint || '', name: q.name || '', seconds: q.seconds || CFG.questionSeconds || 25,
    scale: q.scale || 0, art: q.art || bank.artOf(q), options: q.options || null, correct: q.correct != null ? q.correct : null, value: q.value != null ? q.value : null, numUnit: q.numUnit || '' };
}
const folderDir = f => { const n = safeName(f); return n ? path.join(SAVED, n) : SAVED; }; // '' = โฟลเดอร์หลัก
const setFile = (folder, name) => path.join(folderDir(folder), safeName(name) + '.json');
function metaOf(file, folder) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return { name: j.name || path.basename(file, '.json'), folder: folder, count: (j.questions || []).length, saved: j.saved || '', topics: [...new Set((j.questions || []).map(q => q.topic).filter(Boolean))] }; }
  catch (e) { return null; }
}
function listSets() { // [{folder, sets:[...]}]: โฟลเดอร์หลัก ('') + โฟลเดอร์ย่อยทั้งหมด (รวมโฟลเดอร์ว่าง)
  const out = [];
  const read = (dir, folder) => {
    let sets = [];
    try { sets = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => metaOf(path.join(dir, f), folder)).filter(Boolean); } catch (e) {}
    sets.sort((x, y) => String(y.saved).localeCompare(String(x.saved)));
    return sets;
  };
  out.push({ folder: '', sets: read(SAVED, '') });
  try { fs.readdirSync(SAVED, { withFileTypes: true }).filter(d => d.isDirectory()).forEach(d => out.push({ folder: d.name, sets: read(path.join(SAVED, d.name), d.name) })); } catch (e) {}
  return out;
}
function readSet(folder, name) { try { const j = JSON.parse(fs.readFileSync(setFile(folder, name), 'utf8')); return Array.isArray(j.questions) ? j : null; } catch (e) { return null; } }
const setLabel = (folder, name) => (safeName(folder) ? safeName(folder) + ' / ' : '') + name;
function rebuild() { QS = fixedSet ? fixedSet.map(cloneQ) : bank.generate(gameCfg); QS.forEach(prepare); N = QS.length; }
rebuild();

function publicQ(q) {
  return {
    type: q.type, prompt: q.prompt, hint: q.hint || '', say: q.say || '', labels: !!q.labels,
    seconds: qMs(q) / 1000, readout: q.readout || 'dec', frame: q.frame || null, grid: q.grid || 0, terrain: !!q.terrain,
    gridType: (q.gridMode || q.gridType === 'utm') ? 'utm' : 'll', unit: q.unit || 'deg', numUnit: q.numUnit || '', numDigits: q.numDigits || 4,
    digits: q.digits || 3, dialStyle: q.dialStyle || 'day', options: q.options || null, contours: !!q.contours, topic: q.topic || 0, scale: q.scale || 0,
    maxDeg: q.maxDeg || 45,
    decimal: !!q.decimal,
    markers: q.markers ? q.markers : (q.type === 'dms' || q.type === 'grid') ? [{ lat: q.lat, lng: q.lng, label: '' }]
      : (q.from && q.to) ? [{ lat: q.from.lat, lng: q.from.lng, label: 'A', name: q.from.name }, { lat: q.to.lat, lng: q.to.lng, label: 'B', name: q.to.name }]
      : q.mark ? [{ lat: q.mark.lat, lng: q.mark.lng, label: q.mark.label || 'P', name: '' }] : []
  };
}
const scoreOf = (km, maxKm) => Math.round(Math.max(0, 1 - km / maxKm) * 10000) / 100; // 0–100 (เส้นตรง ละเอียด 0.01 กันคะแนนเสมอ)

function livePct(p) {
  const upto = phase === 'final' ? N - 1 : (phase === 'question' || phase === 'reveal') ? qi : -1;
  if (upto < 0) return 0;
  let s = 0;
  for (let i = 0; i <= upto; i++) s += (p.scores[i] && p.scores[i].pct) || 0;
  return Math.round((s / (upto + 1)) * 100) / 100;
}
const connectedCount = () => { let c = 0; const t = Date.now(); for (const p of players.values()) if (p.conns > 0 || p.polling > 0 || t - p.lastSeen < 8000) c++; return c; };
const answeredCount = () => { let c = 0; for (const p of players.values()) if (p.scores[qi]) c++; return c; };

function clearTimer() { if (timer) clearTimeout(timer); timer = null; }

function startGame() {
  if (phase !== 'lobby') return;
  phase = 'countdown'; qi = -1; deadline = Date.now() + T_COUNT;
  clearTimer(); timer = setTimeout(() => startQuestion(0), T_COUNT);
  pushNow();
}
function startQuestion(i) {
  qi = i; phase = 'question'; earlyScheduled = false;
  const ms = qMs(QS[i]);
  deadline = Date.now() + ms;
  clearTimer(); timer = setTimeout(reveal, ms + GRACE);
  pushNow();
}
function reveal() {
  if (phase !== 'question') return;
  phase = 'reveal'; deadline = Date.now() + T_REVEAL;
  clearTimer(); timer = setTimeout(next, T_REVEAL);
  pushNow();
}
function next() {
  if (phase !== 'reveal') return;
  if (qi + 1 < N) startQuestion(qi + 1);
  else { phase = 'final'; deadline = 0; clearTimer(); pushNow(); }
}
function resetGame() {
  clearTimer(); phase = 'lobby'; qi = -1; deadline = 0; rebuild(); // ชุดโจทย์ใหม่ทุกเกม
  for (const p of players.values()) p.scores = [];
  pushNow();
}

// ---------- ส่งสถานะแบบเรียลไทม์ (SSE) ----------
let pending = null;
function push() { if (!pending) pending = setTimeout(() => { pending = null; pushNow(); }, 300); }
function pushNow() {
  if (pending) { clearTimeout(pending); pending = null; }
  const arr = [...players.values()].map(p => ({ p, pct: livePct(p) }))
    .sort((a, b) => b.pct - a.pct || a.p.n - b.p.n);
  const rankOf = new Map(arr.map((x, i) => [x.p.id, i + 1]));
  const top = arr.slice(0, 10).map(x => ({ k: x.p.n, name: x.p.name, av: x.p.av, color: x.p.color, pct: x.pct }));
  const avg = arr.length ? Math.round(arr.reduce((s, x) => s + x.pct, 0) / arr.length * 10) / 10 : 0;
  const inQ = phase === 'question' || phase === 'reveal';
  const q = inQ ? QS[qi] : null;

  const base = {
    phase, qi, total: N, title: CFG.title, now: Date.now(), deadline,
    players: players.size, connected: connectedCount(),
    answered: inQ ? answeredCount() : 0,
    top, avg, cfg: gameCfg, set: fixedSet ? { name: fixedName, count: N } : null,
    q: q ? publicQ(q) : null
  };
  if (phase === 'question') { const A = Object.assign({}, q.art || bank.artOf(q)); delete A.hl; delete A.dist; delete A.cm; if (A.k === 'map' || A.k === 'mapdial' || A.k === 'dial') base.art = null; else base.art = A; } // รูปโจทย์ (ตัดค่าที่เป็นเฉลยออก)
  if (phase === 'reveal') {
    base.art = q.art || bank.artOf(q); // รูปประกอบ/เฉลยภาพ
    base.reveal = q.type === 'compass'
      ? { type: 'compass', angle: q.angle, name: q.name, maxDeg: q.maxDeg || 45, unit: q.unit || 'deg' }
      : q.type === 'choice'
        ? { type: 'choice', options: q.options, correct: q.correct, name: q.name }
      : q.type === 'num'
        ? { type: 'num', value: q.value, numUnit: q.numUnit || '', name: q.name, maxErr: q.maxErr || 10 }
        : { type: q.type, lat: q.lat, lng: q.lng, name: q.name, maxKm: q.maxKm,
            dmsText: q.type === 'grid' ? q.gridText + '   (' + q.mgrsText + ')' : (q.dmsText || '') };
    let s = 0; for (const p of players.values()) s += (p.scores[qi] && p.scores[qi].pct) || 0;
    base.qAvg = players.size ? Math.round(s / players.size * 10) / 10 : 0;
  }

  base.v = ++version;
  snap = { base, rankOf, inQ };

  for (const c of streams) {
    const msg = buildMsg(c);
    if (!msg) continue;
    try { c.res.write('data: ' + JSON.stringify(msg) + '\n\n'); } catch (e) { /* ปิดไปแล้ว */ }
  }
  for (const w of [...pollers]) releasePoller(w);
}
let snap = null, version = 0;
function buildMsg(c) {
  const { base, rankOf, inQ } = snap;
  let msg;
  if (c.host) {
    msg = Object.assign({}, base);
    if (phase === 'lobby' || phase === 'countdown') msg.names = [...players.values()].map(p => ({ k: p.n, name: p.name, av: p.av, color: p.color }));
    if (phase === 'reveal') {
      msg.pins = [];
      for (const p of players.values()) {
        const a = p.scores[qi];
        if (a) msg.pins.push(a.ang != null ? { ang: a.ang, pct: a.pct } : a.c != null ? { c: a.c, pct: a.pct } : a.v != null ? { v: a.v, pct: a.pct } : { lat: a.lat, lng: a.lng, pct: a.pct });
      }
    }
  } else {
    const p = players.get(c.id);
    if (!p) return null;
    const a = inQ ? p.scores[qi] : null;
    msg = Object.assign({}, base, {
      me: {
        name: p.name, av: p.av, color: p.color, pct: livePct(p), rank: rankOf.get(p.id) || players.size, of: players.size,
        answered: !!a, cur: a ? a : null,
        last: (phase === 'reveal' && a) ? a : null
      }
    });
  }
  msg.now = Date.now();
  return msg;
}
// Long-polling: ใช้เมื่อ SSE ถูกอุโมงค์/พร็อกซีถ่วง (ทุกคำตอบเป็น HTTP response ที่จบสมบูรณ์ จึงไม่ถูกบัฟเฟอร์)
const pollers = new Set();
function releasePoller(w) {
  if (!pollers.delete(w)) return;
  clearTimeout(w.timer);
  const p = players.get(w.id);
  if (p) { p.polling = Math.max(0, p.polling - 1); p.lastSeen = Date.now(); }
  const msg = p && buildMsg({ id: w.id });
  try { if (msg) json(w.res, 200, msg); else { w.res.writeHead(404); w.res.end(); } } catch (e) {}
}
setInterval(() => { for (const c of streams) try { c.res.write(': hb\n\n'); } catch (e) {} }, 15000);

// ---------- HTTP ----------
// ---------- อุโมงค์สาธารณะ (Cloudflare Tunnel) — นักเรียนใช้เน็ตมือถือเองได้ ไม่ต้องต่อ Wi-Fi เดียวกัน ----------
let tunnelUrl = process.env.PUBLIC_URL || null;
let tunnelState = tunnelUrl ? 'ready' : 'off'; // off | starting | ready | failed
if (!tunnelUrl && process.env.TUNNEL !== 'off') {
  const { spawn } = require('child_process');
  const candidates = ['cloudflared', 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe', 'C:\\Program Files\\cloudflared\\cloudflared.exe'];
  (function tryStart(i) {
    if (i >= candidates.length) { tunnelState = 'failed'; console.log('  (ไม่พบ cloudflared — ใช้ลิงก์ Wi-Fi ในวงเดียวกันแทน)'); return; }
    let cp;
    try { cp = spawn(candidates[i], ['tunnel', '--url', 'http://localhost:' + PORT, '--no-autoupdate'], { windowsHide: true }); }
    catch (e) { return tryStart(i + 1); }
    let started = false;
    cp.on('error', () => { if (!started) tryStart(i + 1); });
    cp.on('spawn', () => { started = true; tunnelState = 'starting'; });
    const onData = d => {
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(d));
      if (m && !tunnelUrl) { tunnelUrl = m[0] + '/'; tunnelState = 'ready'; console.log('  ลิงก์สาธารณะ (ให้นักเรียนสแกน): ' + tunnelUrl); }
    };
    cp.stdout.on('data', onData); cp.stderr.on('data', onData);
    cp.on('exit', () => { if (tunnelState !== 'ready') tunnelState = 'failed'; });
    process.on('exit', () => { try { cp.kill(); } catch (e) {} });
    process.on('SIGINT', () => process.exit());
  })(0);
}

function lanUrl() {
  if (tunnelUrl) return tunnelUrl;
  const ips = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  const pref = ips.find(a => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a)) || ips[0] || 'localhost';
  return 'http://' + pref + ':' + PORT + '/';
}
// เครื่องครูเท่านั้น: มาจาก loopback และ "ไม่ผ่านอุโมงค์" (คำขอผ่านอุโมงค์จะมีเฮดเดอร์ของ Cloudflare/proxy เสมอ)
const isLocal = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
  && !req.headers['cf-connecting-ip'] && !req.headers['x-forwarded-for'] && !req.headers['cf-ray'] && !req.headers['forwarded'];
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function body(req) {
  return new Promise(ok => {
    let s = '';
    req.on('data', d => { s += d; if (s.length > 4096) req.destroy(); });
    req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch (e) { ok({}); } });
    req.on('error', () => ok({}));
  });
}
function serveStatic(req, res, key) {
  let f = files.get(key);
  if (process.env.DEV && f) { // โหมดพัฒนา: อ่านไฟล์สดทุกครั้ง ไม่ต้องรีสตาร์ท
    const b = fs.readFileSync(path.join(PUB, key)); f.buf = b; f.gz = zlib.gzipSync(b); f.etag = '"' + crypto.createHash('md5').update(b).digest('hex') + '"';
  }
  if (!f) { res.writeHead(404); return res.end('not found'); }
  if (!f.etag) f.etag = '"' + crypto.createHash('md5').update(f.buf).digest('hex') + '"';
  // ตรวจ ETag ทุกครั้ง (ไฟล์ไม่เปลี่ยน = 304 ไม่ต้องโหลดซ้ำ; ครูแก้ไฟล์แล้วเห็นผลทันที)
  if (req.headers['if-none-match'] === f.etag) { res.writeHead(304, { ETag: f.etag, 'Cache-Control': 'no-cache' }); return res.end(); }
  const gz = /gzip/.test(req.headers['accept-encoding'] || '');
  const h = { 'Content-Type': f.type, 'Cache-Control': 'no-cache', ETag: f.etag, Vary: 'Accept-Encoding' };
  if (gz) h['Content-Encoding'] = 'gzip';
  res.writeHead(200, h); res.end(gz ? f.gz : f.buf);
}
function openStream(req, res, client) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 1500\n\n');
  streams.add(client);
  const p = client.id && players.get(client.id);
  if (p) p.conns++;
  req.on('close', () => { streams.delete(client); if (p) { p.conns = Math.max(0, p.conns - 1); push(); } });
  pushNow();
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  try {
    if (req.method === 'GET') {
      if (p === '/') return serveStatic(req, res, '/index.html');
      if (p === '/check') return serveStatic(req, res, '/check.html'); // หน้าตรวจระบบ (ใช้ได้ทั้งครูและนักเรียน)
      if (p === '/host') return isLocal(req) ? serveStatic(req, res, '/host.html') : (res.writeHead(403), res.end('เปิดหน้านี้ได้เฉพาะบนเครื่องครู'));
      if (p === '/api/sim-truth') { // เฉพาะเครื่องครู: ให้บอทซ้อมถามเฉลยของข้อที่สุ่มได้ (ไม่ใช้กับนักเรียนจริง)
        if (!isLocal(req)) return json(res, 403, {});
        const q = QS[+u.searchParams.get('qi')]; if (!q) return json(res, 404, {});
        return json(res, 200, { type: q.type, lat: q.lat, lng: q.lng, u: q.u, digits: q.digits, angle: q.angle, maxDeg: q.maxDeg, value: q.value, maxErr: q.maxErr, maxKm: q.maxKm, correct: q.correct, seconds: q.seconds });
      }
      if (p === '/api/bank') { // สุ่มข้อสอบมาให้ครูดู/เลือก (ต่อหัวข้อ)
        if (!isLocal(req)) return json(res, 403, {});
        const tp = (u.searchParams.get('topics') || '').split(',').map(Number).filter(t => t >= 1 && t <= 7);
        if (u.searchParams.get('catalog')) { // คลังข้อสอบคงที่ (ไม่สุ่มใหม่)
          const o = {}; (tp.length ? tp : [1, 2, 3, 4, 5, 6, 7]).forEach(t => { o[t] = catalogList(t); });
          return json(res, 200, { catalog: o });
        }
        const per = Math.min(20, Math.max(1, +u.searchParams.get('per') || 8));
        const out = [];
        (tp.length ? tp : [1, 2, 3, 4, 5, 6, 7]).forEach(t => bank.generate({ topics: [t], count: per, scales: gameCfg.scales }).forEach(q => out.push(previewOf(q, addToPool(q)))));
        return json(res, 200, { questions: out });
      }
      if (p === '/api/sets') return isLocal(req) ? json(res, 200, { folders: listSets(), root: SAVED, active: fixedSet ? { name: fixedName, count: N } : null }) : json(res, 403, {});
      if (p === '/api/set') { // เปิดชุดที่บันทึกไว้ เพื่อดู/แก้ไข
        if (!isLocal(req)) return json(res, 403, {});
        const j = readSet(u.searchParams.get('folder'), u.searchParams.get('name'));
        if (!j) return json(res, 404, {});
        return json(res, 200, { name: j.name, questions: j.questions.map(q => previewOf(q, addToPool(q))) });
      }
      if (p === '/api/config') return isLocal(req) ? json(res, 200, { topics: bank.TOPICS, scales: bank.SCALES, cfg: gameCfg, total: N }) : json(res, 403, {});
      if (p === '/api/info') return json(res, 200, { url: lanUrl(), public: tunnelState === 'ready', tunnel: tunnelState, title: CFG.title, total: N });
      if (p === '/api/poll') {
        const id = u.searchParams.get('id'), v = +u.searchParams.get('v');
        const pl = players.get(id);
        if (!pl) { res.writeHead(kicked.has(id) ? 410 : 404); return res.end(); }
        pl.lastSeen = Date.now();
        if (!snap) pushNow();
        if (v !== snap.base.v) return json(res, 200, buildMsg({ id }));
        const w = { res, id, timer: null };
        w.timer = setTimeout(() => releasePoller(w), 20000);
        pl.polling++; pollers.add(w);
        req.on('close', () => { if (pollers.delete(w)) { clearTimeout(w.timer); pl.polling = Math.max(0, pl.polling - 1); pl.lastSeen = Date.now(); } });
        return;
      }
      if (p === '/api/stream') {
        const id = u.searchParams.get('id');
        if (!players.has(id)) { res.writeHead(kicked.has(id) ? 410 : 404); return res.end(); }
        return openStream(req, res, { res, id, host: false });
      }
      if (p === '/api/host/stream') {
        if (!isLocal(req)) { res.writeHead(403); return res.end(); }
        return openStream(req, res, { res, id: null, host: true });
      }
      return serveStatic(req, res, p);
    }
    if (req.method === 'POST') {
      const b = await body(req);
      if (p === '/api/join') {
        if (b.id && kicked.has(b.id)) return json(res, 410, { kicked: true });
        let pl = b.id && players.get(b.id);
        let name = String(b.name || '').trim().slice(0, 20);
        if (!pl) {
          if (!name) return json(res, 400, { error: 'name' });
          // ชื่อซ้ำ -> ต่อท้ายเลขให้อัตโนมัติ
          const taken = new Set([...players.values()].map(x => x.name.toLowerCase()));
          let nm = name, k = 1; while (taken.has(nm.toLowerCase())) nm = name.slice(0, 17) + ' ' + (++k);
          const av = String(b.av || '🧭').slice(0, 8);
          const color = /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#2e6b3f';
          pl = { id: crypto.randomBytes(8).toString('hex'), n: ++seq, name: nm, av, color, scores: [], conns: 0, polling: 0, lastSeen: Date.now() };
          players.set(pl.id, pl);
          push();
        }
        return json(res, 200, { id: pl.id, name: pl.name });
      }
      if (p === '/api/answer') {
        const pl = players.get(b.id);
        if (!pl || phase !== 'question' || Date.now() > deadline + GRACE) return json(res, 200, { ok: false });
        const q = QS[qi];
        let rec;
        if (q.type === 'compass') {
          const ang = +b.ang;
          if (!(ang >= 0 && ang <= 360)) return json(res, 400, { ok: false });
          const diff = angDiff(ang, q.angle);
          rec = { ang: Math.round(ang) % 360, diff, pct: Math.round(Math.max(0, 1 - diff / (q.maxDeg || 45)) * 10000) / 100 };
        } else if (q.type === 'num') { // ตอบเป็นตัวเลข (เช่น มิล, มุมแม่เหล็ก)
          const v = +b.v;
          if (!isFinite(v) || v < 0 || v > 99999) return json(res, 400, { ok: false });
          const diff = Math.abs(v - q.value);
          rec = { v, diff, pct: Math.round(Math.max(0, 1 - diff / (q.maxErr || 10)) * 10000) / 100 };
        } else if (q.type === 'choice') { // เลือกตอบ: ถูก 100 / ผิด 0
          const c = Number(b.c);
          if (!Number.isInteger(c) || c < 0 || c >= (q.options || []).length) return json(res, 400, { ok: false });
          rec = { c, pct: c === q.correct ? 100 : 0 };
        } else if (q.type === 'grid') { // อ่านพิกัดกริด 6 หรือ 8 หลัก: E/N ตามจำนวนหลักของข้อ (ตำแหน่งมุมล่างซ้ายของช่อง)
          const dg = q.digits || 3, unit = Math.pow(10, 5 - dg), lim = Math.pow(10, dg) - 1;
          const g = Array.isArray(b.g) ? b.g.map(Number) : [];
          if (g.length !== 2 || g.some(x => !Number.isInteger(x) || x < 0 || x > lim)) return json(res, 400, { ok: false });
          const near = (t, x) => { let best = null; for (let k = -1; k <= 1; k++) { const v = (Math.floor(t / 100000) + k) * 100000 + x * unit; if (best === null || Math.abs(v - t) < Math.abs(best - t)) best = v; } return best; };
          const tE = Math.floor(q.u.e / unit) * unit, tN = Math.floor(q.u.n / unit) * unit; // เทียบกับช่องที่จุดเฉลยอยู่
          const E = near(q.u.e, g[0]), Nn = near(q.u.n, g[1]);
          const km = Math.hypot(E - tE, Nn - tN) / 1000, ll = Geo.fromUTM(47, true, E + unit / 2, Nn + unit / 2);
          rec = { lat: ll.lat, lng: ll.lng, km, pct: scoreOf(km, q.maxKm), g };
        } else {
          let lat, lng, d = null;
          if (q.type === 'dms') { // กรอก องศา ลิปดา ฟิลิปดา (ซีกโลกเหนือ/ตะวันออก)
            d = Array.isArray(b.d) ? b.d.map(Number) : [];
            if (d.length !== 6 || d.some(x => !isFinite(x) || x < 0 || x > 360)) return json(res, 400, { ok: false });
            d[1] = Math.min(d[1], 59); d[2] = Math.min(d[2], 59.99); d[4] = Math.min(d[4], 59); d[5] = Math.min(d[5], 59.99);
            lat = d[0] + d[1] / 60 + d[2] / 3600; lng = d[3] + d[4] / 60 + d[5] / 3600;
          } else { lat = +b.lat; lng = +b.lng; }
          if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return json(res, 400, { ok: false });
          const km = haversineKm(lat, lng, q.lat, q.lng);
          rec = { lat, lng, km, pct: scoreOf(km, q.maxKm) };
          if (d) rec.d = d;
        }
        if (!pl.scores[qi]) {
          pl.scores[qi] = rec;
          // ทุกคนที่ออนไลน์ตอบครบแล้ว -> ข้ามไปเฉลยเลย ประหยัดเวลา
          if (!earlyScheduled && answeredCount() >= connectedCount()) {
            earlyScheduled = true; clearTimer(); timer = setTimeout(reveal, 1200);
          }
          push();
        }
        return json(res, 200, { ok: true });
      }
      if (p === '/api/host') {
        if (!isLocal(req)) return json(res, 403, {});
        if (b.cmd === 'start') startGame();
        else if (b.cmd === 'skip') { if (phase === 'question') reveal(); else if (phase === 'reveal') next(); else if (phase === 'countdown') { clearTimer(); startQuestion(0); } }
        else if (b.cmd === 'config') { // ตั้งค่าเกม (เฉพาะตอนอยู่ห้องรอ)
          if (phase !== 'lobby') return json(res, 200, { ok: false });
          const c = b.cfg || {};
          const topics = [...new Set((c.topics || []).map(Number).filter(t => t >= 1 && t <= 7))];
          const scales = [...new Set((c.scales || []).map(Number).filter(x => bank.SCALES.includes(x)))];
          gameCfg = { topics: topics.length ? topics : gameCfg.topics, count: Math.max(1, Math.min(40, Math.round(+c.count) || gameCfg.count)), scales: scales.length ? scales : gameCfg.scales };
          fixedSet = null; fixedName = ''; // ตั้งค่าหัวข้อ/จำนวนข้อ = กลับไปใช้การสุ่ม
          rebuild(); pushNow();
        }
        else if (b.cmd === 'useSet' || b.cmd === 'loadSet') { // เล่นชุดที่ครูเลือก (เฉพาะห้องรอ)
          if (phase !== 'lobby') return json(res, 200, { ok: false });
          let list, nm;
          if (b.cmd === 'useSet') { list = (b.ids || []).map(getQ).filter(Boolean); nm = safeName(b.name) || 'ชุดที่เลือก'; }
          else { const j = readSet(b.folder, b.name); list = j ? j.questions : []; nm = j ? setLabel(b.folder, j.name) : ''; }
          if (!list.length) return json(res, 200, { ok: false, error: 'empty' });
          fixedSet = list.map(cloneQ); fixedName = nm; rebuild(); pushNow();
          return json(res, 200, { ok: true, count: N });
        }
        else if (b.cmd === 'saveSet') { // บันทึกชุดลงโฟลเดอร์ saved/<โฟลเดอร์>/
          const name = safeName(b.name), list = (b.ids || []).map(getQ).filter(Boolean);
          if (!name) return json(res, 200, { ok: false, error: 'name' });
          if (!list.length) return json(res, 200, { ok: false, error: 'empty' });
          try { fs.mkdirSync(folderDir(b.folder), { recursive: true }); fs.writeFileSync(setFile(b.folder, name), JSON.stringify({ name, saved: new Date().toISOString(), questions: list }, null, 1), 'utf8'); }
          catch (e) { return json(res, 200, { ok: false, error: 'write: ' + e.message }); }
          return json(res, 200, { ok: true, name, folder: safeName(b.folder), count: list.length, path: setFile(b.folder, name) });
        }
        else if (b.cmd === 'createFolder') {
          const f = safeName(b.folder); if (!f) return json(res, 200, { ok: false, error: 'name' });
          try { fs.mkdirSync(path.join(SAVED, f), { recursive: true }); } catch (e) { return json(res, 200, { ok: false, error: e.message }); }
          return json(res, 200, { ok: true, folder: f });
        }
        else if (b.cmd === 'deleteFolder') { // ลบได้เฉพาะโฟลเดอร์ว่าง ยกเว้นส่ง force
          const f = safeName(b.folder); if (!f) return json(res, 200, { ok: false });
          try { if (b.force) fs.rmSync(path.join(SAVED, f), { recursive: true, force: true }); else fs.rmdirSync(path.join(SAVED, f)); }
          catch (e) { return json(res, 200, { ok: false, error: 'notEmpty' }); }
          if (fixedSet && fixedName.indexOf(f + ' / ') === 0) { fixedSet = null; fixedName = ''; rebuild(); pushNow(); }
          return json(res, 200, { ok: true });
        }
        else if (b.cmd === 'deleteSet') {
          try { fs.unlinkSync(setFile(b.folder, b.name)); } catch (e) { return json(res, 200, { ok: false }); }
          if (fixedSet && fixedName === setLabel(b.folder, safeName(b.name))) { fixedSet = null; fixedName = ''; rebuild(); pushNow(); }
          return json(res, 200, { ok: true });
        }
        else if (b.cmd === 'clearSet') { if (phase === 'lobby') { fixedSet = null; fixedName = ''; rebuild(); pushNow(); } }
        else if (b.cmd === 'reset') resetGame();
        else if (b.cmd === 'clear') { for (const id of players.keys()) kicked.add(id); players.clear(); resetGame(); } // ผู้เล่นเดิมต้องกด "เข้าใหม่" เอง (ไม่เด้งกลับเข้ามาด้วยชื่อเดิมอัตโนมัติ)
        else if (b.cmd === 'kick') { // เตะผู้เล่น (ใช้ตอนตั้งชื่อไม่เหมาะสม)
          for (const [id, pl] of players) if (pl.n === +b.k) { players.delete(id); kicked.add(id); }
          push();
        }
        return json(res, 200, { ok: true });
      }
    }
    res.writeHead(404); res.end();
  } catch (e) { console.error(e); try { res.writeHead(500); res.end(); } catch (_) {} }
}).listen(PORT, '0.0.0.0', () => {
  console.log('\n  เกม: ' + CFG.title + ' (' + N + ' ข้อ)');
  console.log('  หน้าจอครู (เปิดบนเครื่องนี้):  http://localhost:' + PORT + '/host');
  console.log('  ลิงก์ Wi-Fi วงเดียวกัน (สำรอง):  ' + lanUrl());
  if (tunnelState === 'starting' || tunnelState === 'off' && !process.env.PUBLIC_URL) console.log('  กำลังสร้างลิงก์สาธารณะ รอสักครู่...');
  console.log('');
});
