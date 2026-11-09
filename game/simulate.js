'use strict';
// จำลองนักเรียน (ใช้ซ้อมก่อนสอนจริง):  node simulate.js [จำนวนคน=90] [http://localhost:3000 หรือลิงก์สาธารณะ]
// บอทใช้ long-polling เหมือนมือถือที่เข้าผ่านอุโมงค์ ตอบได้ทั้งโจทย์ปักหมุด / กรอกพิกัด / เข็มทิศ
const N = +process.argv[2] || 90;
const BASE = (process.argv[3] || 'http://localhost:3000').replace(/\/$/, '');
const QS = require('./questions.json').questions;
const rnd = (a, b) => a + Math.random() * (b - a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const AVS = ['🦁', '🐯', '🐘', '🦅', '🐺', '🪖', '🎖️', '🛡️', '🤖', '👻', '🥷', '⚽', '🏀', '🥊', '🏹'];
const COLS = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#00acc1', '#1e88e5', '#8e24aa', '#ec407a'];

function bearing(a, b, c, d) {
  const r = Math.PI / 180, dl = (d - b) * r;
  const y = Math.sin(dl) * Math.cos(c * r), x = Math.cos(a * r) * Math.sin(c * r) - Math.sin(a * r) * Math.cos(c * r) * Math.cos(dl);
  return (Math.atan2(y, x) / r + 360) % 360;
}
function toDms(v) { const d = Math.floor(v), m = Math.floor((v - d) * 60), s = Math.round(((v - d) * 60 - m) * 60); return [d, m, Math.min(s, 59)]; }

function answerFor(q, skill) {
  if (q.type === 'compass') {
    const ang = q.angle != null ? q.angle : bearing(q.from.lat, q.from.lng, q.to.lat, q.to.lng);
    return { ang: ((ang + rnd(-1, 1) * (skill * skill * 60) + 360) % 360) };
  }
  const km = skill * skill * q.maxKm * 1.2, err = km / 111;
  const lat = q.lat + rnd(-err, err), lng = q.lng + rnd(-err, err);
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
      const q = QS[s.qi], secs = (q.seconds || 25);
      setTimeout(() => {
        fetch(BASE + '/api/answer', { method: 'POST', body: JSON.stringify(Object.assign({ id: j.id }, answerFor(q, skill))) }).catch(() => {});
      }, rnd(2000, (secs - 3) * 1000));
    }
  }
}
for (let i = 0; i < N; i++) bot(i).catch(e => console.error('bot', i, e.message));
console.log('จำลองผู้เล่น ' + N + ' คนไปที่ ' + BASE);
