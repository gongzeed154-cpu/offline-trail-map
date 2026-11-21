'use strict';
// โหมดทำเอง (self-paced): นักเรียนสแกนแล้วทำข้อสอบคนละเวลาได้ ไม่ต้องออนไลน์พร้อมกัน
// เซิร์ฟเวอร์คุมเวลา/ตรวจคะแนนทุกข้อ เก็บผลลง results/<id>.json (ครูเห็นทั้งหมด) และออก "รหัสยืนยัน" ให้นักเรียนแคปหน้าจอส่งครู
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let RESULTS = path.join(__dirname, 'results');
const GRACE = 3000; // ยอมรับคำตอบช้ากว่าเวลาเล็กน้อย (เน็ตหน่วง)

module.exports = function createSolo(ctx) {
  if (ctx.resultsDir) RESULTS = ctx.resultsDir;
  try { fs.mkdirSync(RESULTS, { recursive: true }); } catch (e) { console.error('สร้างโฟลเดอร์ results ไม่ได้:', e.message); }
  let solo = null;   // { id, title, setName, created, open, reveal, secret, questions:[raw], players:{id:p} }
  let QS = [];       // ข้อสอบที่ prepare แล้ว
  let saveTimer = null;

  const file = id => path.join(RESULTS, id + '.json');
  function saveNow() {
    clearTimeout(saveTimer); saveTimer = null;
    if (!solo) return;
    try { fs.writeFileSync(file(solo.id), JSON.stringify(solo)); } catch (e) { console.error('บันทึกผลไม่สำเร็จ:', e.message); }
  }
  function save() { if (solo && !saveTimer) saveTimer = setTimeout(saveNow, 400); }
  function setSession(s) { solo = s; QS = s ? s.questions.map(ctx.cloneQ) : []; QS.forEach(ctx.prepare); }
  (function loadLatest() { // เริ่มเซิร์ฟเวอร์ใหม่ -> เปิดรอบล่าสุดต่อ ผลไม่หาย
    let best = null;
    try {
      for (const f of fs.readdirSync(RESULTS).filter(x => x.endsWith('.json'))) {
        try { const j = JSON.parse(fs.readFileSync(path.join(RESULTS, f), 'utf8')); if (j && j.id && Array.isArray(j.questions) && (!best || j.created > best.created)) best = j; } catch (e) {}
      }
    } catch (e) {}
    if (best) setSession(best);
  })();

  // ที่อยู่เครือข่ายของนักเรียน (ผ่านอุโมงค์ Cloudflare จะอยู่ในเฮดเดอร์) ใช้ติดธงเตือนเท่านั้น
  const ipOf = req => String(req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || (req.socket && req.socket.remoteAddress) || '').trim().slice(0, 64);
  // ชั้น 2: ธงเตือนให้ครู — หลายชื่อมาจาก IP เดียวกัน (อาจเป็นคนเดียวทำซ้ำ หรือแค่ใช้ Wi-Fi/เน็ตมือถือเจ้าเดียวกัน ครูตัดสินเอง)
  function flagsOf(list) {
    const byIp = {}; list.forEach(p => { if (p.ip) (byIp[p.ip] = byIp[p.ip] || []).push(p); });
    return p => { const same = p.ip && byIp[p.ip] && byIp[p.ip].length > 1 ? byIp[p.ip].filter(x => x !== p) : []; return same.length ? 'IP เดียวกับ: ' + same.map(x => x.name).join(', ') : ''; };
  }
  const N = () => QS.length;
  const totalPct = p => { let s = 0; for (let i = 0; i < N(); i++) s += (p.ans[i] && p.ans[i].pct) || 0; return Math.round(s / Math.max(1, N()) * 100) / 100; };
  function codeOf(p) {
    const h = crypto.createHmac('sha256', solo.secret).update([p.id, p.no, p.name, p.total.toFixed(2), p.finished].join('|')).digest('hex').toUpperCase();
    return h.slice(0, 4) + '-' + h.slice(4, 8) + '-' + h.slice(8, 12);
  }
  function finish(p) {
    if (p.done) return;
    p.done = true; p.finished = Date.now(); p.total = totalPct(p); p.code = codeOf(p); save();
  }
  function next(p) {
    p.si++;
    if (p.si >= N()) finish(p); else p.deadline = Date.now() + ctx.qMs(QS[p.si]);
    save();
  }
  function step(p) { if (!p.done && p.si >= 0 && Date.now() > p.deadline + GRACE) next(p); } // หมดเวลาแล้วไม่ได้กดต่อ -> ข้ามไปข้อถัดไปเอง

  function answerText(q) {
    if (q.type === 'choice') return (q.options || [])[q.correct] || '';
    if (q.type === 'num') return q.value + ' ' + (q.numUnit || '');
    if (q.type === 'compass') return Math.round(q.angle) + '° (' + Math.round(q.angle * 6400 / 360) + ' มิลเลียม)';
    if (q.type === 'grid') return q.gridText + ' (' + q.mgrsText + ')';
    return (q.dmsText ? q.dmsText + ' — ' : '') + (q.name || '');
  }
  function resultOf(p) {
    return {
      pct: p.total, code: p.code, no: p.no, name: p.name, setName: solo.setName, finishedAt: p.finished, startedAt: p.started,
      partial: !!p.partial, reveal: !!solo.reveal,
      review: QS.map((q, i) => ({ n: i + 1, pct: p.ans[i] ? p.ans[i].pct : 0, answered: !!p.ans[i], correct: solo.reveal ? answerText(q) : undefined, prompt: solo.reveal ? q.prompt : undefined }))
    };
  }
  function stateOf(p) {
    step(p);
    const base = { solo: true, now: Date.now(), total: N(), title: solo.title, paused: false, remain: 0, me: { name: p.name, no: p.no, av: p.av, color: p.color, pct: 0, rank: 0, of: 0, answered: false, cur: null } };
    if (p.done) return Object.assign(base, { phase: 'final', result: resultOf(p) });
    if (p.si < 0) return Object.assign(base, { phase: 'intro', seconds: Math.round(QS.reduce((s, q) => s + ctx.qMs(q), 0) / 1000), minutes: Math.round(QS.reduce((s, q) => s + ctx.qMs(q), 0) / 60000) });
    const q = QS[p.si], a = p.ans[p.si] || null;
    base.me.answered = !!a; base.me.cur = a;
    return Object.assign(base, { phase: 'question', qi: p.si, deadline: p.deadline, q: ctx.publicQ(q), art: null });
  }

  // อันดับ: คะแนน % มาก -> ใช้เวลารวมน้อยกว่า -> ส่งเสร็จก่อน (เฉพาะคนที่ทำครบ; ไม่นับคนที่ถูกปิดรับก่อนทำเสร็จ) ถ้าเท่ากันทั้งหมด = เสมอ (ได้อันดับเดียวกัน)
  const durOf = p => (p.finished && p.started) ? p.finished - p.started : 0;
  function ranks() {
    const done = Object.values(solo.players).filter(p => p.done && !p.partial);
    done.sort((a, b) => b.total - a.total || durOf(a) - durOf(b) || a.finished - b.finished);
    const m = new Map();
    const same = (a, b) => a.total === b.total && durOf(a) === durOf(b) && a.finished === b.finished;
    done.forEach((p, i) => {
      const prev = done[i - 1];
      if (prev && same(prev, p)) { const pr = m.get(prev); pr.tie = true; m.set(p, { rank: pr.rank, tie: true }); }
      else m.set(p, { rank: i + 1, tie: false });
    });
    return m;
  }
  function summary() {
    if (!solo) return null;
    const list = Object.values(solo.players), flag = flagsOf(list), rk = ranks();
    return {
      session: { id: solo.id, title: solo.title, setName: solo.setName, created: solo.created, open: solo.open, reveal: !!solo.reveal, total: N(), link: ctx.lanUrl().replace(/\/?$/, '/') + 'solo' },
      counts: { joined: list.length, done: list.filter(p => p.done).length },
      players: list.map(p => ({ rank: rk.has(p) ? rk.get(p).rank : 0, tie: rk.has(p) ? rk.get(p).tie : false, dur: Math.round(durOf(p) / 1000), flag: flag(p), no: p.no, name: p.name, av: p.av, si: p.si, done: p.done, partial: !!p.partial, pct: p.done ? p.total : totalPct(p), started: p.started, finished: p.finished || 0, code: p.code || '', scores: QS.map((q, i) => p.ans[i] ? p.ans[i].pct : 0) }))
    };
  }
  const fmt = t => t ? new Date(t).toLocaleString('th-TH', { hour12: false }) : '';
  function csv() {
    const esc = v => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const flag = flagsOf(Object.values(solo.players)), rk = ranks();
    const rows = [['อันดับ', 'ลำดับที่เข้า', 'ชื่อเล่น', 'คะแนน(%)', 'สถานะ', 'เริ่ม', 'เสร็จ', 'ใช้เวลา(วินาที)', 'รหัสยืนยัน', 'สังเกต'].concat(QS.map((q, i) => 'ข้อ ' + (i + 1) + ' (%)'))];
    Object.values(solo.players).sort((a, b) => ((rk.has(a) ? rk.get(a).rank : 9999) - (rk.has(b) ? rk.get(b).rank : 9999)) || (b.done ? b.total : totalPct(b)) - (a.done ? a.total : totalPct(a))).forEach(p => {
      rows.push([rk.has(p) ? rk.get(p).rank + (rk.get(p).tie ? ' (เสมอ)' : '') : '', p.no, p.name, p.done ? p.total : totalPct(p), p.done ? (p.partial ? 'ทำไม่ครบ (ปิดรับ)' : 'ทำครบ') : (p.si < 0 ? 'ยังไม่เริ่ม' : 'กำลังทำ (ข้อ ' + (p.si + 1) + ')'), fmt(p.started), fmt(p.finished), p.finished ? Math.round((p.finished - p.started) / 1000) : '', p.code || '', flag(p)].concat(QS.map((q, i) => p.ans[i] ? p.ans[i].pct : 0)));
    });
    return '﻿' + rows.map(r => r.map(esc).join(',')).join('\r\n');
  }

  // เส้นทาง HTTP — คืน true ถ้าจัดการแล้ว
  function route(req, res, u, p, b) {
    const { json, isLocal } = ctx;
    const admin = () => { if (!isLocal(req)) { json(res, 403, {}); return false; } return true; };
    if (req.method === 'GET') {
      if (p === '/api/solo/info') return json(res, 200, solo ? { open: solo.open, title: solo.title, total: N() } : { open: false, none: true }), true;
      if (p === '/api/solo/state') {
        const pl = solo && solo.players[u.searchParams.get('id')];
        if (!pl) { res.writeHead(404); res.end(); return true; }
        return json(res, 200, stateOf(pl)), true;
      }
      if (p === '/api/solo/admin') { if (!admin()) return true; return json(res, 200, summary() || { session: null }), true; }
      if (p === '/api/solo/csv') {
        if (!admin()) return true;
        if (!solo) { res.writeHead(404); res.end(); return true; }
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="results-' + solo.id + '.csv"' });
        res.end(csv()); return true;
      }
      return false;
    }
    if (req.method !== 'POST') return false;

    if (p === '/api/solo/join') {
      if (!solo) return json(res, 200, { error: 'none' }), true;
      // ชั้น 1: เครื่อง/เบราว์เซอร์ที่เคยเข้าแล้ว (มีรหัสผู้เล่นเดิม) -> กลับเข้าผลเดิมเสมอ ไม่เริ่มรอบใหม่แม้พิมพ์ชื่อใหม่
      const old = b.id && solo.players[b.id];
      if (old) return json(res, 200, { id: old.id }), true;
      const name = String(b.name || '').trim().slice(0, 20);
      if (!name) return json(res, 200, { error: 'need' }), true;
      if (!solo.open) return json(res, 200, { error: 'closed' }), true;
      // ชื่อเล่นซ้ำ -> ต่อท้ายเลขให้อัตโนมัติ
      const taken = new Set(Object.values(solo.players).map(x => x.name.toLowerCase()));
      let nm = name, k = 1; while (taken.has(nm.toLowerCase())) nm = name.slice(0, 17) + ' ' + (++k);
      const av = String(b.av || '🧭').slice(0, 8), color = /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#2e6b3f';
      solo.seq = (solo.seq || 0) + 1;
      const pl = { id: crypto.randomBytes(8).toString('hex'), no: String(solo.seq), name: nm, av, color, ip: ipOf(req), si: -1, deadline: 0, ans: [], done: false, started: 0, finished: 0, total: 0, code: '' };
      solo.players[pl.id] = pl; save();
      return json(res, 200, { id: pl.id }), true;
    }
    if (p === '/api/solo/start') {
      const pl = solo && solo.players[b.id];
      if (!pl || pl.done || !solo.open && pl.si < 0) return json(res, 200, { ok: false }), true;
      if (pl.si < 0) { pl.si = 0; pl.started = Date.now(); pl.deadline = pl.started + ctx.qMs(QS[0]); save(); }
      return json(res, 200, { ok: true }), true;
    }
    if (p === '/api/solo/answer') {
      const pl = solo && solo.players[b.id];
      if (!pl || pl.done || pl.si < 0) return json(res, 200, { ok: false }), true;
      step(pl);
      if (pl.done || Number(b.qi) !== pl.si || Date.now() > pl.deadline + GRACE) return json(res, 200, { ok: false }), true;
      const rec = ctx.grade(QS[pl.si], b);
      if (!rec) return json(res, 400, { ok: false }), true;
      pl.ans[pl.si] = rec; save();
      return json(res, 200, { ok: true }), true;
    }
    if (p === '/api/solo/next') {
      const pl = solo && solo.players[b.id];
      if (!pl || pl.done || pl.si < 0) return json(res, 200, { ok: false }), true;
      if (Number(b.qi) === pl.si && (pl.ans[pl.si] || Date.now() >= pl.deadline - 500)) next(pl);
      return json(res, 200, { ok: true }), true;
    }

    // ----- ครู -----
    if (p === '/api/solo/cmd') {
      if (!admin()) return true;
      if (b.cmd === 'open') {
        let raw, setName;
        if (b.source === 'saved') { const j = ctx.readSet(b.folder, b.name); if (!j) return json(res, 200, { ok: false, error: 'ไม่พบชุดข้อสอบ' }), true; raw = j.questions; setName = (b.folder ? b.folder + ' / ' : '') + (j.name || b.name); }
        else { raw = ctx.currentQuestions(); setName = ctx.currentName(); }
        if (!raw || !raw.length) return json(res, 200, { ok: false, error: 'ไม่มีข้อสอบ' }), true;
        saveNow();
        const id = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + crypto.randomBytes(2).toString('hex');
        setSession({ id, title: ctx.title, setName, created: Date.now(), open: true, reveal: false, secret: crypto.randomBytes(16).toString('hex'), questions: raw.map(ctx.cloneQ), players: {} });
        saveNow();
        return json(res, 200, { ok: true }), true;
      }
      if (!solo) return json(res, 200, { ok: false, error: 'ยังไม่ได้เปิดรอบ' }), true;
      if (b.cmd === 'close') { solo.open = false; Object.values(solo.players).forEach(p => { if (!p.done && p.si >= 0) { p.partial = true; finish(p); } }); saveNow(); return json(res, 200, { ok: true }), true; }
      if (b.cmd === 'reopen') { solo.open = true; saveNow(); return json(res, 200, { ok: true }), true; }
      if (b.cmd === 'reveal') { solo.reveal = !!b.on; saveNow(); return json(res, 200, { ok: true }), true; }
      if (b.cmd === 'remove') { // ลบผู้เล่นคนหนึ่ง (เช่น ให้ทำใหม่)
        const pl = Object.values(solo.players).find(x => x.no === String(b.no));
        if (pl) { delete solo.players[pl.id]; saveNow(); }
        return json(res, 200, { ok: !!pl }), true;
      }
      if (b.cmd === 'verify') {
        const code = String(b.code || '').trim().toUpperCase().replace(/\s+/g, '');
        const pl = Object.values(solo.players).find(x => x.code && x.code.replace(/-/g, '') === code.replace(/-/g, ''));
        return json(res, 200, pl ? { ok: true, no: pl.no, name: pl.name, pct: pl.total, finished: fmt(pl.finished), partial: !!pl.partial } : { ok: false }), true;
      }
      return json(res, 200, { ok: false }), true;
    }
    return false;
  }
  return { route, flush: saveNow };
};
