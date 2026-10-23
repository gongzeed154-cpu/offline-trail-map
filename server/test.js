import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { COLORS, createTeamServer } from './index.js';

const srv = await createTeamServer({ port: 0, log: () => {} });
const url = `ws://127.0.0.1:${srv.port}`;

function client() {
  const ws = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    const i = waiters.findIndex((w) => w.pred(m));
    if (i >= 0) waiters.splice(i, 1)[0].res(m); else inbox.push(m);
  });
  const opened = new Promise((r) => ws.on('open', r));
  return {
    ws, opened,
    send: (o) => ws.send(JSON.stringify(o)),
    next: (pred = () => true) => new Promise((res, rej) => {
      const i = inbox.findIndex(pred);
      if (i >= 0) return res(inbox.splice(i, 1)[0]);
      const t = setTimeout(() => rej(new Error('timeout')), 2000);
      waiters.push({ pred, res: (m) => { clearTimeout(t); res(m); } });
    }),
  };
}
const ROUTE = [[100.5, 13.7], [100.6, 13.8]];

const host = client(); await host.opened;
host.send({ t: 'create', name: 'หัวหน้า', color: COLORS[0] });
assert.equal((await host.next()).code, 'route_required');
host.send({ t: 'create', name: 'x'.repeat(17), color: COLORS[0], route: ROUTE });
assert.equal((await host.next()).code, 'bad_name');
host.send({ t: 'create', name: 'หัวหน้า', color: '#123456', route: ROUTE });
assert.equal((await host.next()).code, 'bad_color');
host.send({ t: 'create', name: 'หัวหน้า', color: COLORS[0], route: ROUTE });
const hj = await host.next((m) => m.t === 'joined');
assert.match(hj.code, /^[A-Z2-9]{6}$/);
const hs = await host.next((m) => m.t === 'state');
assert.deepEqual(hs.route, ROUTE);

const a = client(); await a.opened;
a.send({ t: 'join', code: 'ZZZZZZ', name: 'a', color: COLORS[1] });
assert.equal((await a.next()).code, 'no_such_team');
a.send({ t: 'join', code: hj.code, name: 'a', color: COLORS[0] });
assert.equal((await a.next()).code, 'color_taken');
a.send({ t: 'join', code: hj.code.toLowerCase(), name: 'เอ', color: COLORS[1] });
const aj = await a.next((m) => m.t === 'joined');
const as = await a.next((m) => m.t === 'state');
assert.equal(as.members.length, 2);
assert.deepEqual(as.route, ROUTE);
await host.next((m) => m.t === 'state' && m.members.length === 2);

a.send({ t: 'pos', lat: 13.75, lng: 100.55, alt: 120, acc: 5 });
const p = await host.next((m) => m.t === 'pos');
assert.equal(p.id, aj.you);
assert.equal(p.pos.lat, 13.75);

a.send({ t: 'route', route: ROUTE });
assert.equal((await a.next()).code, 'host_only');
host.send({ t: 'route', route: [[1, 2], [3, 4]] });
assert.deepEqual((await a.next((m) => m.t === 'route')).route, [[1, 2], [3, 4]]);

// เต็ม 10 เครื่อง
const extra = [];
for (let i = 2; i < 10; i++) {
  const c = client(); await c.opened;
  c.send({ t: 'join', code: hj.code, name: `m${i}`, color: COLORS[i] });
  await c.next((m) => m.t === 'joined');
  extra.push(c);
}
const eleventh = client(); await eleventh.opened;
eleventh.send({ t: 'join', code: hj.code, name: 'late', color: COLORS[0] });
assert.equal((await eleventh.next()).code, 'team_full');

// หลุดแล้วกลับเข้าด้วย token เดิม
a.ws.close();
await host.next((m) => m.t === 'presence' && m.id === aj.you && m.online === false);
const a2 = client(); await a2.opened;
a2.send({ t: 'resume', code: hj.code, id: aj.you, token: aj.token });
await a2.next((m) => m.t === 'joined');
const rs = await a2.next((m) => m.t === 'state');
assert.equal(rs.members.length, 10);
a2.send({ t: 'resume', code: hj.code, id: aj.you, token: 'wrong' });
assert.equal((await a2.next()).code, 'already_in_team');

// หัวหน้าออก โอนสิทธิ์
host.send({ t: 'leave' });
const st = await a2.next((m) => m.t === 'state' && m.members.length === 9);
assert.equal(st.members.filter((x) => x.host).length, 1);

for (const c of [a2, ...extra, eleventh]) c.ws.terminate();
await srv.close();
console.log('all server tests passed');
