'use strict';
// ลิงก์คงที่สำหรับพิมพ์ QR: ทุกครั้งที่เปิดเกม ลิงก์ Cloudflare (trycloudflare.com) เปลี่ยน
// จึงเขียนลิงก์ล่าสุดลงไฟล์ current.json บนแขนง "tunnel-url" ของ GitHub (ผ่าน gh api — ไม่แตะแขนง main)
// แล้วหน้า docs/go/ (GitHub Pages ที่คงที่) อ่านไฟล์นั้นแล้วพานักเรียนไปลิงก์ล่าสุด
// เปิดใช้เมื่อมี PUBLISH_LINK=1 (start-game.bat ตั้งให้) ต้องล็อกอิน gh (GitHub CLI) บนคอมครู
const { execFile, execFileSync } = require('child_process');

const CANDIDATES = ['gh', 'C:\\Program Files\\GitHub CLI\\gh.exe', 'C:\\Program Files (x86)\\GitHub CLI\\gh.exe'];

module.exports = function createPublisher(opts) {
  const repo = opts.repo, branch = opts.branch || 'tunnel-url', file = opts.file || 'current.json';
  const [owner, name] = repo.split('/');
  const base = 'https://' + owner + '.github.io/' + name + '/go/';
  let st = { state: 'off', error: '', url: '', at: 0 };

  // รัน gh (ลองหลายตำแหน่ง) -> Promise<stdout>; ถ้าล้มเหลวจะ reject ด้วย {stderr}
  const run = opts.run || (args => new Promise((ok, fail) => {
    (function tryExe(i) {
      if (i >= CANDIDATES.length) return fail({ stderr: 'ไม่พบโปรแกรม gh (GitHub CLI)', missing: true });
      execFile(CANDIDATES[i], args, { windowsHide: true, timeout: 30000 }, (err, out, errOut) => {
        if (err && err.code === 'ENOENT') return tryExe(i + 1);
        if (err) return fail({ stderr: String(errOut || err.message) });
        ok(String(out));
      });
    })(0);
  }));
  const runSync = args => {
    let last;
    for (const exe of CANDIDATES) {
      try { return String(execFileSync(exe, args, { windowsHide: true, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] })); }
      catch (e) { last = e; if (e.code !== 'ENOENT') throw e; }
    }
    throw last;
  };
  const notFound = e => /404|Not Found/i.test(String((e && e.stderr) || (e && e.message) || ''));

  async function ensureBranch() {
    try { await run(['api', 'repos/' + repo + '/git/ref/heads/' + branch, '--jq', '.object.sha']); return; }
    catch (e) { if (!notFound(e)) throw e; }
    const sha = (await run(['api', 'repos/' + repo + '/git/ref/heads/main', '--jq', '.object.sha'])).trim();
    await run(['api', '-X', 'POST', 'repos/' + repo + '/git/refs', '-f', 'ref=refs/heads/' + branch, '-f', 'sha=' + sha]);
  }
  const putArgs = (obj, sha, msg) => {
    const a = ['api', '-X', 'PUT', 'repos/' + repo + '/contents/' + file, '-f', 'message=' + msg, '-f', 'branch=' + branch, '-f', 'content=' + Buffer.from(JSON.stringify(obj)).toString('base64')];
    if (sha) a.push('-f', 'sha=' + sha);
    return a;
  };
  async function put(obj, msg) {
    await ensureBranch();
    let sha = '';
    try { sha = (await run(['api', 'repos/' + repo + '/contents/' + file + '?ref=' + branch, '--jq', '.sha'])).trim(); }
    catch (e) { if (!notFound(e)) throw e; }
    await run(putArgs(obj, sha, msg));
  }

  async function publish(url) {
    st = { state: 'working', error: '', url, at: Date.now() };
    try {
      await put({ url, updated: new Date().toISOString() }, 'update game link');
      st = { state: 'ok', error: '', url, at: Date.now() };
      console.log('  ลิงก์คงที่สำหรับ QR (พร้อมใช้): ' + base);
    } catch (e) {
      st = { state: 'error', error: String((e && e.stderr) || (e && e.message) || e).trim().slice(0, 200), url, at: Date.now() };
      console.log('  อัปเดตลิงก์คงที่ไม่สำเร็จ: ' + st.error + ' (ตรวจว่าล็อกอิน gh แล้ว: gh auth status)');
    }
    return st;
  }
  // ตอนปิดเกม: ล้างลิงก์เก่า (ทำได้เท่าที่ทัน) หน้าคงที่จะบอกว่า "ครูยังไม่เปิดเกม"
  function clearSync() {
    if (st.state !== 'ok') return;
    try {
      const sha = runSync(['api', 'repos/' + repo + '/contents/' + file + '?ref=' + branch, '--jq', '.sha']).trim();
      runSync(putArgs({ url: null, updated: new Date().toISOString() }, sha, 'game stopped'));
    } catch (e) { /* ไม่เป็นไร */ }
  }
  return { publish, clearSync, state: () => st, links: { solo: base + '?to=solo', teacher: base + '?to=teacher' } };
};
