import type * as Location from 'expo-location';
import { File, Paths } from 'expo-file-system';
import { acquireLocationForTeam, releaseLocationForTeam, setLocationListener } from './tracker';

// ทีมเดินป่า: เชื่อมกับเซิร์ฟเวอร์ใน server/ ผ่าน WebSocket
// แชร์เส้นทางของหัวหน้าทีม และเห็นตำแหน่งของทุกคนในทีม (ต้องมีอินเทอร์เน็ตหรือสัญญาณมือถือ)

export const MAX_MEMBERS = 10;
export const MAX_NAME = 16;
// ต้องตรงกับ COLORS ใน server/index.js
export const TEAM_COLORS = [
  '#e6194b', '#f58231', '#ffe119', '#3cb44b', '#00bcd4',
  '#4363d8', '#911eb4', '#f032e6', '#8b4513', '#000000',
];

export type Member = {
  id: string;
  name: string;
  color: string;
  online: boolean;
  host: boolean;
  pos: { lat: number; lng: number; alt: number | null; acc: number | null; ts: number } | null;
};

export type TeamState = {
  status: 'off' | 'connecting' | 'online' | 'reconnecting';
  code: string | null;
  you: string | null;
  members: Member[];
  route: [number, number][] | null;
  error: string | null;
};

type Saved = {
  serverUrl: string;
  code: string;
  id: string;
  token: string;
};

const ERRORS: Record<string, string> = {
  route_required: 'ต้องเลือกเส้นทางก่อนสร้างทีม',
  bad_name: `ชื่อต้องไม่ว่างและไม่เกิน ${MAX_NAME} ตัวอักษร`,
  bad_color: 'สีที่เลือกไม่ถูกต้อง',
  no_such_team: 'ไม่พบรหัสทีมนี้ ตรวจสอบรหัสกับหัวหน้าทีมอีกครั้ง',
  team_full: `ทีมนี้เต็มแล้ว (สูงสุด ${MAX_MEMBERS} เครื่อง)`,
  color_taken: 'สีนี้มีคนในทีมใช้แล้ว กรุณาเลือกสีอื่น',
  host_only: 'เฉพาะหัวหน้าทีมเท่านั้น',
  bad_route: 'เส้นทางไม่ถูกต้องหรือยาวเกินไป',
  resume_failed: 'เข้าทีมเดิมไม่ได้ (ทีมอาจถูกยุบแล้ว)',
};

const EMPTY: TeamState = { status: 'off', code: null, you: null, members: [], route: null, error: null };

let state: TeamState = EMPTY;
let ws: WebSocket | null = null;
let saved: Saved | null = null;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let lastSent = 0;
let wantOpen = false; // ผู้ใช้ยังอยู่ในทีม (ถึงสัญญาณหลุดก็ต้องพยายามต่อใหม่)
let onFirst: ((m: any) => void) | null = null;
const listeners = new Set<(s: TeamState) => void>();

function set(patch: Partial<TeamState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}

export function getTeamState() {
  return state;
}

export function subscribeTeam(fn: (s: TeamState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function savedFile() {
  return new File(Paths.document, 'team.json');
}

function persist() {
  const f = savedFile();
  if (saved) {
    f.create({ overwrite: true });
    f.write(JSON.stringify(saved));
  } else if (f.exists) {
    f.delete();
  }
}

export function readServerUrlDefault(): string {
  const f = new File(Paths.document, 'team-server.txt');
  return f.exists ? f.textSync().trim() : '';
}

export function saveServerUrl(url: string) {
  const f = new File(Paths.document, 'team-server.txt');
  f.create({ overwrite: true });
  f.write(url.trim());
}

function normalizeUrl(u: string): string {
  const t = u.trim();
  if (!t) throw new Error('กรุณาใส่ที่อยู่เซิร์ฟเวอร์ เช่น wss://team.example.com');
  const url = /^wss?:\/\//i.test(t) ? t : `wss://${t}`;
  return url.replace(/\/+$/, '');
}

function send(obj: unknown) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function handle(m: any) {
  if (onFirst) {
    const cb = onFirst;
    onFirst = null;
    cb(m);
  }
  switch (m.t) {
    case 'joined':
      retry = 0;
      saved = { serverUrl: saved?.serverUrl ?? '', code: m.code, id: m.you, token: m.token };
      persist();
      set({ status: 'online', code: m.code, you: m.you, error: null });
      break;
    case 'state':
      set({ code: m.code, members: m.members, route: m.route });
      break;
    case 'pos':
      set({
        members: state.members.map((x) => (x.id === m.id ? { ...x, online: true, pos: m.pos } : x)),
      });
      break;
    case 'presence':
      set({ members: state.members.map((x) => (x.id === m.id ? { ...x, online: m.online } : x)) });
      break;
    case 'route':
      set({ route: m.route });
      break;
    case 'disbanded':
    case 'left':
      void exitTeam(false);
      break;
    case 'error':
      if (m.code === 'resume_failed') {
        void exitTeam(false);
        set({ error: ERRORS.resume_failed });
      } else {
        set({ error: ERRORS[m.code] ?? `ผิดพลาด: ${m.code}` });
      }
      break;
  }
}

function open(serverUrl: string, first: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const sock = new WebSocket(serverUrl);
    ws = sock;
    const fail = (msg: string) => {
      if (settled) return;
      settled = true;
      reject(new Error(msg));
    };
    onFirst = (m) => {
      if (settled) return;
      settled = true;
      if (m.t === 'error') reject(new Error(ERRORS[m.code] ?? `ผิดพลาด: ${m.code}`));
      else resolve();
    };
    sock.onopen = () => sock.send(JSON.stringify(first));
    sock.onmessage = (e) => {
      try {
        handle(JSON.parse(String(e.data)));
      } catch {
        // ข้อความเสีย ข้ามไป
      }
    };
    sock.onerror = () => fail('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบที่อยู่เซิร์ฟเวอร์และอินเทอร์เน็ต');
    sock.onclose = () => {
      fail('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบที่อยู่เซิร์ฟเวอร์และอินเทอร์เน็ต');
      if (ws === sock) {
        ws = null;
        if (wantOpen) scheduleReconnect();
      }
    };
  });
}

function scheduleReconnect() {
  if (retryTimer || !saved) return;
  set({ status: 'reconnecting' });
  const delay = Math.min(15000, 1000 * 2 ** retry++);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (!wantOpen || !saved) return;
    open(saved.serverUrl, { t: 'resume', code: saved.code, id: saved.id, token: saved.token }).catch(() => {
      // onclose จะนัดต่อใหม่เอง
    });
  }, delay);
}

function onLocation(l: Location.LocationObject) {
  const now = Date.now();
  if (now - lastSent < 2000) return;
  lastSent = now;
  send({
    t: 'pos',
    lat: l.coords.latitude,
    lng: l.coords.longitude,
    alt: l.coords.altitude,
    acc: l.coords.accuracy,
    ts: l.timestamp,
  });
}

async function enter(serverUrl: string, first: unknown) {
  wantOpen = true;
  saved = { serverUrl, code: '', id: '', token: '' };
  set({ ...EMPTY, status: 'connecting' });
  try {
    await open(serverUrl, first);
    setLocationListener(onLocation);
    await acquireLocationForTeam();
  } catch (e) {
    wantOpen = false;
    saved = null;
    ws?.close();
    ws = null;
    set({ ...EMPTY });
    throw e;
  }
}

export async function createTeam(opts: {
  serverUrl: string;
  name: string;
  color: string;
  route: [number, number][];
}) {
  const url = normalizeUrl(opts.serverUrl);
  saveServerUrl(url);
  await enter(url, { t: 'create', name: opts.name, color: opts.color, route: opts.route });
}

export async function joinTeam(opts: { serverUrl: string; code: string; name: string; color: string }) {
  const url = normalizeUrl(opts.serverUrl);
  saveServerUrl(url);
  await enter(url, { t: 'join', code: opts.code.trim().toUpperCase(), name: opts.name, color: opts.color });
}

// เปิดแอพใหม่แล้วกลับเข้าทีมเดิมอัตโนมัติ
export async function resumeTeam() {
  const f = savedFile();
  if (!f.exists || state.status !== 'off') return;
  try {
    saved = JSON.parse(f.textSync()) as Saved;
  } catch {
    return;
  }
  wantOpen = true;
  setLocationListener(onLocation);
  await acquireLocationForTeam().catch(() => {});
  set({ ...EMPTY, status: 'reconnecting', code: saved.code });
  scheduleReconnect();
}

export function shareRoute(route: [number, number][]) {
  send({ t: 'route', route });
}

async function exitTeam(notifyServer: boolean, disband = false) {
  wantOpen = false;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (notifyServer) send({ t: disband ? 'disband' : 'leave' });
  const sock = ws;
  ws = null;
  setTimeout(() => sock?.close(), notifyServer ? 300 : 0);
  saved = null;
  persist();
  set({ ...EMPTY });
  await releaseLocationForTeam().catch(() => {});
}

export const leaveTeam = () => exitTeam(true);
export const disbandTeam = () => exitTeam(true, true);

export function validateName(name: string): string | null {
  const s = name.trim();
  if (!s) return 'กรุณาใส่ชื่อ';
  if ([...s].length > MAX_NAME) return `ชื่อต้องไม่เกิน ${MAX_NAME} ตัวอักษร`;
  return null;
}
