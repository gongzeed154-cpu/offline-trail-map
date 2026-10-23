// เซิร์ฟเวอร์ทีมเดินป่า: ส่งต่อตำแหน่งและเส้นทางระหว่างเครื่องในทีมเดียวกัน (WebSocket)
// เก็บข้อมูลในหน่วยความจำเท่านั้น รีสตาร์ทเซิร์ฟเวอร์แล้วทีมจะหายไป
import { randomBytes, randomInt } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

export const MAX_MEMBERS = 10;
export const MAX_NAME = 16;
export const MAX_ROUTE_POINTS = 5000;
// สีเด่น 10 สี ต้องตรงกับ TEAM_COLORS ใน team.ts ของแอพ
export const COLORS = [
  '#e6194b', '#f58231', '#ffe119', '#3cb44b', '#00bcd4',
  '#4363d8', '#911eb4', '#f032e6', '#8b4513', '#000000',
];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ไม่มี I O 0 1 กันอ่านสับสน
const CODE_LEN = 6;
const MIN_POS_INTERVAL_MS = 1500;
const EMPTY_TEAM_TTL_MS = 24 * 3600 * 1000;
const MAX_MSG_BYTES = 256 * 1024;

function newCode(teams) {
  for (;;) {
    let c = '';
    for (let i = 0; i < CODE_LEN; i++) c += CODE_CHARS[randomInt(CODE_CHARS.length)];
    if (!teams.has(c)) return c;
  }
}

function cleanName(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/\s+/g, ' ');
  if (!s || [...s].length > MAX_NAME) return null;
  return s;
}

function cleanRoute(v) {
  if (!Array.isArray(v) || v.length < 2 || v.length > MAX_ROUTE_POINTS) return null;
  const out = [];
  for (const p of v) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const [lng, lat] = p;
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
    out.push([lng, lat]);
  }
  return out;
}

function cleanPos(m) {
  const { lat, lng } = m;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const num = (x) => (Number.isFinite(x) ? x : null);
  return { lat, lng, alt: num(m.alt), acc: num(m.acc), ts: Number.isFinite(m.ts) ? m.ts : Date.now() };
}

export function createTeamServer({ port = 8080, host = '0.0.0.0', log = console.log } = {}) {
  /** @type {Map<string, {code:string, route:number[][]|null, hostId:string, members:Map<string, any>, emptySince:number|null}>} */
  const teams = new Map();

  const http = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  const wss = new WebSocketServer({ server: http, maxPayload: MAX_MSG_BYTES });

  const send = (ws, obj) => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  };

  const publicMembers = (team) =>
    [...team.members.values()].map((m) => ({
      id: m.id, name: m.name, color: m.color, online: !!m.ws, host: m.id === team.hostId, pos: m.pos,
    }));

  const broadcast = (team, obj, exceptId) => {
    for (const m of team.members.values()) if (m.id !== exceptId) send(m.ws, obj);
  };

  const sendState = (team, ws) =>
    send(ws, { t: 'state', code: team.code, members: publicMembers(team), route: team.route });

  const pushState = (team) => {
    for (const m of team.members.values()) sendState(team, m.ws);
  };

  function attach(ws, team, member) {
    if (member.ws && member.ws !== ws) member.ws.close(4001, 'replaced');
    member.ws = ws;
    ws.team = team;
    ws.member = member;
    team.emptySince = null;
  }

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return send(ws, { t: 'error', code: 'bad_json' }); }
      if (!m || typeof m.t !== 'string') return send(ws, { t: 'error', code: 'bad_message' });

      if (m.t === 'create' || m.t === 'join' || m.t === 'resume') {
        if (ws.team) return send(ws, { t: 'error', code: 'already_in_team' });
      }

      if (m.t === 'create') {
        const name = cleanName(m.name);
        if (!name) return send(ws, { t: 'error', code: 'bad_name' });
        if (!COLORS.includes(m.color)) return send(ws, { t: 'error', code: 'bad_color' });
        const route = cleanRoute(m.route);
        if (!route) return send(ws, { t: 'error', code: 'route_required' });
        const code = newCode(teams);
        const id = randomBytes(6).toString('hex');
        const token = randomBytes(16).toString('hex');
        const member = { id, token, name, color: m.color, ws: null, pos: null, lastPosAt: 0 };
        const team = { code, route, hostId: id, members: new Map([[id, member]]), emptySince: null };
        teams.set(code, team);
        attach(ws, team, member);
        log(`team ${code} created`);
        send(ws, { t: 'joined', you: id, token, code });
        return sendState(team, ws);
      }

      if (m.t === 'join') {
        const team = teams.get(String(m.code ?? '').toUpperCase());
        if (!team) return send(ws, { t: 'error', code: 'no_such_team' });
        const name = cleanName(m.name);
        if (!name) return send(ws, { t: 'error', code: 'bad_name' });
        if (!COLORS.includes(m.color)) return send(ws, { t: 'error', code: 'bad_color' });
        if (team.members.size >= MAX_MEMBERS) return send(ws, { t: 'error', code: 'team_full' });
        if ([...team.members.values()].some((x) => x.color === m.color)) {
          return send(ws, { t: 'error', code: 'color_taken', taken: [...team.members.values()].map((x) => x.color) });
        }
        const id = randomBytes(6).toString('hex');
        const token = randomBytes(16).toString('hex');
        const member = { id, token, name, color: m.color, ws: null, pos: null, lastPosAt: 0 };
        team.members.set(id, member);
        attach(ws, team, member);
        send(ws, { t: 'joined', you: id, token, code: team.code });
        return pushState(team);
      }

      // เชื่อมต่อใหม่หลังสัญญาณหลุด ใช้ token เดิม ไม่เสียที่นั่ง
      if (m.t === 'resume') {
        const team = teams.get(String(m.code ?? '').toUpperCase());
        const member = team && team.members.get(m.id);
        if (!member || member.token !== m.token) return send(ws, { t: 'error', code: 'resume_failed' });
        attach(ws, team, member);
        send(ws, { t: 'joined', you: member.id, token: member.token, code: team.code });
        return pushState(team);
      }

      const team = ws.team;
      const me = ws.member;
      if (!team) return send(ws, { t: 'error', code: 'not_in_team' });

      if (m.t === 'pos') {
        const now = Date.now();
        if (now - me.lastPosAt < MIN_POS_INTERVAL_MS) return;
        const pos = cleanPos(m);
        if (!pos) return;
        me.lastPosAt = now;
        me.pos = pos;
        return broadcast(team, { t: 'pos', id: me.id, pos }, me.id);
      }

      if (m.t === 'route') {
        if (me.id !== team.hostId) return send(ws, { t: 'error', code: 'host_only' });
        const route = cleanRoute(m.route);
        if (!route) return send(ws, { t: 'error', code: 'bad_route' });
        team.route = route;
        return broadcast(team, { t: 'route', route });
      }

      if (m.t === 'leave') return leave(team, me, true);

      if (m.t === 'disband') {
        if (me.id !== team.hostId) return send(ws, { t: 'error', code: 'host_only' });
        broadcast(team, { t: 'disbanded' });
        for (const x of team.members.values()) { x.ws?.close(1000, 'disbanded'); }
        teams.delete(team.code);
        log(`team ${team.code} disbanded`);
        return;
      }
    });

    ws.on('close', () => {
      const { team, member } = ws;
      if (!team || !member || member.ws !== ws) return;
      member.ws = null; // ยังเก็บที่นั่งไว้ให้เชื่อมต่อกลับได้
      broadcast(team, { t: 'presence', id: member.id, online: false });
      if (![...team.members.values()].some((x) => x.ws)) team.emptySince = Date.now();
    });

    ws.on('error', () => {});
  });

  function leave(team, member, notifySelf) {
    team.members.delete(member.id);
    const ws = member.ws;
    member.ws = null;
    if (notifySelf) { send(ws, { t: 'left' }); ws?.close(1000, 'left'); }
    if (team.members.size === 0) { teams.delete(team.code); return; }
    if (team.hostId === member.id) team.hostId = team.members.keys().next().value; // โอนหัวหน้าให้คนถัดไป
    pushState(team);
  }

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
    const now = Date.now();
    for (const [code, team] of teams) {
      if (team.emptySince && now - team.emptySince > EMPTY_TEAM_TTL_MS) { teams.delete(code); log(`team ${code} expired`); }
    }
  }, 20000);
  heartbeat.unref();

  return new Promise((resolve) => {
    http.listen(port, host, () => {
      const addr = http.address();
      log(`trail team server listening on ${addr.port}`);
      resolve({
        port: addr.port,
        teams,
        close: () => new Promise((r) => { clearInterval(heartbeat); for (const c of wss.clients) c.terminate(); wss.close(() => http.close(() => r())); }),
      });
    });
  });
}

// เทียบเป็นพาธของระบบ (บน Windows import.meta.url เป็น file:///C:/... ไม่ตรงกับ argv[1])
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createTeamServer({ port: Number(process.env.PORT) || 8080 });
}
