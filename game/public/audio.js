// เสียงทั้งหมดสังเคราะห์ด้วย Web Audio (ไม่ต้องมีไฟล์เสียง): เอฟเฟกต์ + เพลงพื้นหลัง + เสียงพูด (Web Speech)
(function (root) {
  var ctx = null, master, sfxG, musG, noiseBuf;
  var st = { sfx: true, music: true, voice: true, musicVol: 0.34, sfxVol: 0.8 };

  function init() {
    if (ctx) return true;
    var AC = root.AudioContext || root.webkitAudioContext; if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    sfxG = ctx.createGain(); sfxG.gain.value = st.sfxVol; sfxG.connect(master);
    musG = ctx.createGain(); musG.gain.value = st.music ? st.musicVol : 0; musG.connect(master);
    var len = ctx.sampleRate, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noiseBuf = b;
    return true;
  }
  function unlock() { if (!init()) return; if (ctx.state === 'suspended') ctx.resume(); }
  var mtof = function (m) { return 440 * Math.pow(2, (m - 69) / 12); };

  function tone(freq, t, dur, type, vol, dest, slideTo, lp) {
    var o = ctx.createOscillator(), g = ctx.createGain(); o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t); if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    var n = o;
    if (lp) { var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; o.connect(f); n = f; }
    n.connect(g); g.connect(dest || sfxG); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(t, dur, vol, hp, dest) {
    var s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    s.buffer = noiseBuf; f.type = 'highpass'; f.frequency.value = hp || 4000;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || sfxG); s.start(t); s.stop(t + dur + 0.05);
  }
  function now() { return ctx.currentTime + 0.01; }
  function arp(notes, gap, type, vol, dur) { var t = now(); notes.forEach(function (n, i) { tone(mtof(n), t + i * gap, dur || 0.3, type || 'triangle', vol || 0.3); }); }

  var sfx = {
    pop: function () { var t = now(); tone(520, t, 0.12, 'sine', 0.35, null, 900); },
    ding: function () { arp([76, 83], 0.09, 'triangle', 0.3, 0.35); },
    tick: function () { var t = now(); tone(1200, t, 0.06, 'square', 0.12); },
    tickLow: function () { var t = now(); tone(700, t, 0.05, 'square', 0.1); },
    go: function () { var t = now(); tone(880, t, 0.5, 'square', 0.2, null, 1760); noise(t, 0.4, 0.25, 2000); },
    whoosh: function () { var t = now(); noise(t, 0.5, 0.3, 800); tone(200, t, 0.5, 'sawtooth', 0.08, null, 900, 1500); },
    join: function () { var t = now(); tone(660, t, 0.1, 'sine', 0.25, null, 990); tone(990, t + 0.07, 0.12, 'sine', 0.2); },
    good: function () { arp([72, 76, 79, 84], 0.08, 'triangle', 0.3, 0.3); },
    ok: function () { arp([67, 72], 0.1, 'triangle', 0.25, 0.3); },
    bad: function () { var t = now(); tone(300, t, 0.35, 'sawtooth', 0.15, null, 150, 800); },
    reveal: function () { arp([60, 64, 67, 72], 0.09, 'square', 0.14, 0.25); },
    fanfare: function () { var t = now(); [[60, 0], [60, .12], [60, .24], [64, .36], [60, .52], [64, .64], [67, .8]].forEach(function (x) { tone(mtof(x[0] + 12), t + x[1], 0.3, 'square', 0.16, null, null, 3000); tone(mtof(x[0]), t + x[1], 0.3, 'triangle', 0.2); }); noise(t + 0.8, 0.9, 0.12, 3000); },
    applause: function () { var t = now(); for (var i = 0; i < 18; i++) noise(t + Math.random() * 1.6, 0.08, 0.14, 1500 + Math.random() * 2500); }
  };

  // ---------- เพลงพื้นหลัง (ซีเควนเซอร์ 16 ช่อง/ห้อง) ----------
  var TRACKS = {
    lobby: { bpm: 112, bass: [45, 41, 48, 43], ch: [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]], style: 'lobby' },
    game: { bpm: 128, bass: [38, 34, 43, 45], ch: [[50, 53, 57], [58, 62, 65], [55, 58, 62], [57, 61, 64]], style: 'game' },
    final: { bpm: 120, bass: [48, 43, 45, 41], ch: [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]], style: 'final' }
  };
  var seq = { name: null, step: 0, next: 0, timer: null, rate: 1 };
  function kick(t, v) { var o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); o.connect(g); g.connect(musG); o.start(t); o.stop(t + 0.25); }
  function playStep(tr, s, t) {
    var bar = Math.floor(s / 16) % 4, i = s % 16, ch = tr.ch[bar], root = tr.bass[bar], st16 = 60 / tr.bpm / 4 / seq.rate;
    if (tr.style === 'lobby') {
      if (i === 0 || i === 8) kick(t, 0.5);
      if (i % 4 === 2) noise(t, 0.04, 0.05, 7000, musG);
      if (i === 0 || i === 6 || i === 8 || i === 14) tone(mtof(root), t, st16 * 3, 'sawtooth', 0.16, musG, null, 500);
      if (i % 2 === 0) tone(mtof(ch[(i / 2) % 3] + 12), t, st16 * 2, 'triangle', 0.13, musG);
      if (i === 0) ch.forEach(function (n) { tone(mtof(n), t, st16 * 15, 'sine', 0.05, musG); });
    } else if (tr.style === 'game') {
      if (i % 4 === 0) kick(t, 0.65);
      if (i === 4 || i === 12) noise(t, 0.12, 0.16, 1800, musG);
      if (i % 2 === 1) noise(t, 0.03, 0.05, 8000, musG);
      if (i % 2 === 0) tone(mtof(root), t, st16 * 1.6, 'sawtooth', 0.15, musG, null, 420);
      var pat = [0, 1, 2, 1, 2, 1, 0, 2][i % 8]; tone(mtof(ch[pat] + (i % 4 === 3 ? 24 : 12)), t, st16 * 1.2, 'square', 0.055, musG, null, 2500);
    } else {
      if (i % 4 === 0) kick(t, 0.6);
      if (i === 4 || i === 12) noise(t, 0.1, 0.12, 2000, musG);
      if (i % 2 === 0) tone(mtof(root), t, st16 * 1.8, 'sawtooth', 0.14, musG, null, 600);
      tone(mtof(ch[[0, 1, 2, 1][i % 4]] + 24), t, st16 * 1.3, 'triangle', 0.1, musG);
      if (i === 0) ch.forEach(function (n) { tone(mtof(n + 12), t, st16 * 8, 'square', 0.04, musG, null, 1800); });
    }
  }
  function tickSeq() {
    var tr = TRACKS[seq.name]; if (!tr) return;
    while (seq.next < ctx.currentTime + 0.15) {
      playStep(tr, seq.step, seq.next);
      seq.next += 60 / tr.bpm / 4 / seq.rate; seq.step++;
    }
  }
  var music = {
    play: function (name) {
      if (!init()) return;
      if (seq.name === name) return;
      music.stop(); seq.name = name; seq.step = 0; seq.next = ctx.currentTime + 0.05; seq.rate = 1;
      seq.timer = setInterval(tickSeq, 25);
    },
    stop: function () { if (seq.timer) clearInterval(seq.timer); seq.timer = null; seq.name = null; },
    setRate: function (r) { seq.rate = r; }
  };

  // ---------- เสียงพูด AI (Web Speech API; Edge มีเสียงไทย Natural) ----------
  var voice = null, voices = [];
  function pickVoice() {
    if (!root.speechSynthesis) return;
    voices = speechSynthesis.getVoices().filter(function (v) { return /^th/i.test(v.lang); });
    voice = voices.filter(function (v) { return /natural|online|neural|premwadee|niwat/i.test(v.name); })[0] || voices[0] || null;
  }
  if (root.speechSynthesis) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function clean(t) {
    return String(t)
      .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ' ')
      .replace(/(\d)\s*°/g, '$1 องศา ').replace(/(\d)\s*′/g, '$1 ลิปดา ').replace(/(\d)\s*″/g, '$1 ฟิลิปดา ')
      .replace(/(ฟิลิปดา|ลิปดา)\s*N\b/g, '$1 เหนือ').replace(/(ฟิลิปดา|ลิปดา)\s*E\b/g, '$1 ตะวันออก')
      .replace(/\bBack azimuth\b/gi, 'แบ็ก แอซิมัท').replace(/\bAzimuth\b/gi, 'แอซิมัท')
      .replace(/\bSW\b/g, 'เอส ดับเบิลยู').replace(/%/g, ' เปอร์เซ็นต์').replace(/[→]/g, ' ไป ').replace(/[−]/g, ' ลบ ').replace(/[+]/g, ' บวก ')
      .replace(/\s+/g, ' ').trim();
  }
  function say(text, o) {
    o = o || {};
    if (!st.voice || !root.speechSynthesis || !voice) { if (o.onend) o.onend(); return false; }
    try {
      if (o.interrupt !== false) speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(clean(text)); u.voice = voice; u.lang = voice.lang; u.rate = o.rate || 1.05; u.pitch = o.pitch || 1; u.volume = 1;
      u.onstart = function () { duck(true); };
      u.onend = u.onerror = function () { duck(false); if (o.onend) o.onend(); };
      speechSynthesis.speak(u);
      return true;
    } catch (e) { return false; }
  }
  function duck(on) { if (!ctx) return; musG.gain.cancelScheduledValues(ctx.currentTime); musG.gain.linearRampToValueAtTime(st.music ? (on ? st.musicVol * 0.3 : st.musicVol) : 0, ctx.currentTime + 0.25); }
  function applyVol() { if (!ctx) return; musG.gain.value = st.music ? st.musicVol : 0; sfxG.gain.value = st.sfx ? st.sfxVol : 0; }

  root.GameAudio = {
    unlock: unlock, sfx: function (n) { if (st.sfx && init() && sfx[n]) { try { sfx[n](); } catch (e) {} } }, music: music, say: say,
    state: st, apply: applyVol, hasVoice: function () { return !!voice; }, voiceName: function () { return voice ? voice.name : ''; },
    toggle: function (k) { st[k] = !st[k]; applyVol(); if (k === 'voice' && !st.voice && root.speechSynthesis) speechSynthesis.cancel(); return st[k]; }
  };
})(window);
