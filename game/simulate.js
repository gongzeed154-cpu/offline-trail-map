'use strict';
// จำลองนักเรียน (ใช้ซ้อมก่อนสอนจริง):  node simulate.js [จำนวนคน=90] [ลิงก์เกม=http://localhost:3000]
// บอทใช้ long-polling เหมือนมือถือที่เข้าผ่านอุโมงค์ และถามเฉลยจากเซิร์ฟเวอร์ครู (localhost) เพื่อสุ่มตอบใกล้/ไกล
const N = +process.argv[2] || 90;
const BASE = (process.argv[3] || 'http://localhost:3000').replace(/\/$/, '');
const TRUTH = (process.env.TRUTH || 'http://localhost:3000').replace(/\/$/, '');
const Geo = require('./public/geo.js').TrailGeo;
const rnd = (a, b) => a + Math.random() * (b - a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const AVS = ['🦁', '🐯', '🐘', '🦅', '🐺', '🪖', '🎖️', '🛡️', '🤖', '👻', '🥷', '⚽', '🏀', '🥊', '🏹'];
const COLS = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#00acc1', '#1e88e5', '#8e24aa', '#ec407a'];
function toDms(v) { const d = Math.floor(v), m = Math.floor((v - d) * 60), s = Math.round(((v - d) * 60 - m) * 60); return [d, m, Math.min(s, 59)]; }

function answerFor(q, skill) {
  const k = skill * skill;
  if (q.type === 'choice') return { c: Math.random() < 1 - skill * 0.8 ? q.correct : (q.correct + 1 + Math.floor(Math.random() * 3)) % 4 };
  if (q.type === 'num') return { v: Math.max(0, Math.round(q.value + rnd(-1, 1) * k * q.maxErr * 1.3)) };
  if (q.type === 'compass') return { ang: ((q.angle + rnd(-1, 1) * k * (q.maxDeg || 45) * 1.3 + 360) % 360) };
  if (q.type === 'grid') {
    const dg = q.digits || 3, unit = Math.pow(10, 5 - dg), err = k * q.maxKm * 1.3 * 1000;
    const E = q.u.e + rnd(-err, err), N = q.u.n + rnd(-err, err);
    return { g: [Math.max(0, Math.floor((E % 100000) / unit)), Math.max(0, Math.floor((N % 100000) / unit))] };
  }
  const err = (k * q.maxKm * 1.2) / 111, lat = q.lat + rnd(-err, err), lng = q.lng + rnd(-err, err);
  if (q.type === 'dms') return { d: [...toDms(lat), ...toDms(lng)] };
  return { lat, lng };
}

async function bot(i) {
  const skill = Math.random(); // 0 = เก่งมาก, 1 = มั่ว
  const j = await (await fetch(BASE + '/api/join', { method: 'POST', body: JSON.stringify({
    name: 'บอท' + (i + 1), av: AVS[i % AVS.length], color: COLS[i % COLS.length] }) })).json();
  let v = 0, lastQ = -1;
  for (;;) {
    let s;
    try {
      const r = await fetch(BASE + '/api/poll?id=' + j.id + '&v=' + v);
      if (!r.ok) { await sleep(1500); continue; }
      s = await r.json();
    } catch (e) { await sleep(1500); continue; }
    v = s.v;
    if (s.phase === 'question' && s.qi !== lastQ && !s.me.answered) {
      lastQ = s.qi;
      let q; try { q = await (await fetch(TRUTH + '/api/sim-truth?qi=' + s.qi)).json(); } catch (e) { continue; }
      const secs = s.q.seconds || 25;
      setTimeout(() => {
        fetch(BASE + '/api/answer', { method: 'POST', body: JSON.stringify(Object.assign({ id: j.id }, answerFor(q, skill))) }).catch(() => {});
      }, rnd(2000, Math.max(3000, (secs - 3) * 1000)));
    }
  }
}
for (let i = 0; i < N; i++) bot(i).catch(e => console.error('bot', i, e.message));
console.log('จำลองผู้เล่น ' + N + ' คนไปที่ ' + BASE);
