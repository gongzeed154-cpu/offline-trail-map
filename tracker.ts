import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';

// บันทึกการเดินทาง: เก็บจุด GPS ลงไฟล์ในเครื่องแบบต่อท้ายทีละจุด (JSON Lines)
// งานเบื้องหลังนี้ทำงานต่อได้แม้ล็อคหน้าจอหรือสลับไปแอพอื่น (Android ใช้ foreground service)

export const TRACK_TASK = 'trail-track-task';

// ตัดจุดที่ GPS คลาดเคลื่อนมากออก (เมตร)
const MAX_ACCURACY_M = 100;

export type TrackPoint = {
  lat: number;
  lng: number;
  alt: number | null;
  acc: number | null;
  ts: number;
};

export type TrackSummary = {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number | null;
  points: number;
  distanceM: number;
  ascentM: number;
  active: boolean;
};

function tracksDir(): Directory {
  const dir = new Directory(Paths.document, 'tracks');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

function trackFile(id: string): File {
  return new File(tracksDir(), `${id}.jsonl`);
}

function activeFile(): File {
  return new File(tracksDir(), 'active.txt');
}

function appendLine(file: File, obj: unknown) {
  file.write(JSON.stringify(obj) + '\n', { append: true });
}

export function getActiveTrackId(): string | null {
  const f = activeFile();
  if (!f.exists) return null;
  const id = f.textSync().trim();
  return id || null;
}

// ผู้ฟังตำแหน่งจากภายนอก (ฟีเจอร์ทีมใช้ส่งตำแหน่งให้เพื่อน) ทำงานในงานเบื้องหลังเดียวกัน
let locationListener: ((l: Location.LocationObject) => void) | null = null;

export function setLocationListener(fn: ((l: Location.LocationObject) => void) | null) {
  locationListener = fn;
}

async function startLocationTask() {
  if (await Location.hasStartedLocationUpdatesAsync(TRACK_TASK).catch(() => false)) return;
  await Location.startLocationUpdatesAsync(TRACK_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 5000,
    distanceInterval: 5,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'แผนที่เดินป่ากำลังใช้ตำแหน่ง',
      notificationBody: 'กำลังบันทึกการเดินทางหรือแชร์ตำแหน่งในทีม',
      killServiceOnDestroy: false,
    },
  });
}

// หยุดงานตำแหน่งเมื่อไม่มีทั้งการบันทึกการเดินทางและทีม
async function stopLocationTaskIfIdle() {
  if (getActiveTrackId() || locationListener) return;
  if (await Location.hasStartedLocationUpdatesAsync(TRACK_TASK).catch(() => false)) {
    await Location.stopLocationUpdatesAsync(TRACK_TASK);
  }
}

export async function acquireLocationForTeam() {
  await startLocationTask();
}

export async function releaseLocationForTeam() {
  locationListener = null;
  await stopLocationTaskIfIdle();
}

// ต้องประกาศที่ระดับบนสุดของโมดูล เพื่อให้ระบบปลุกงานนี้ได้ตอนแอพอยู่เบื้องหลัง
TaskManager.defineTask(TRACK_TASK, async ({ data, error }) => {
  if (error) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  const id = getActiveTrackId();
  const file = id ? trackFile(id) : null;
  let lines = '';
  for (const l of locations) {
    const acc = l.coords.accuracy;
    if (acc !== null && acc > MAX_ACCURACY_M) continue;
    locationListener?.(l);
    if (!file?.exists) continue;
    lines +=
      JSON.stringify({
        t: 'p',
        lat: l.coords.latitude,
        lng: l.coords.longitude,
        alt: l.coords.altitude,
        acc,
        ts: l.timestamp,
      }) + '\n';
  }
  if (lines && file) file.write(lines, { append: true });
});

function newId(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function defaultTrackName(ts = Date.now()): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `การเดินทาง ${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ขออนุญาตตำแหน่งขณะใช้งาน แล้วต่อด้วยอนุญาตตลอดเวลา (จำเป็นสำหรับบันทึกตอนล็อคจอ)
export async function ensureTrackPermissions(): Promise<'ok' | 'foreground-only' | 'denied'> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'denied';
  const bg = await Location.requestBackgroundPermissionsAsync();
  return bg.status === 'granted' ? 'ok' : 'foreground-only';
}

export async function startTrack(name?: string): Promise<string> {
  if (getActiveTrackId()) throw new Error('กำลังบันทึกการเดินทางอยู่แล้ว');
  const id = newId();
  const startedAt = Date.now();
  const file = trackFile(id);
  file.create({ overwrite: true });
  appendLine(file, { t: 'meta', id, name: name?.trim() || defaultTrackName(startedAt), start: startedAt });
  activeFile().create({ overwrite: true });
  activeFile().write(id);
  try {
    await startLocationTask();
  } catch (e) {
    activeFile().delete();
    file.delete();
    throw e;
  }
  return id;
}

export async function stopTrack(): Promise<string | null> {
  const id = getActiveTrackId();
  if (!id) return null;
  const file = trackFile(id);
  if (file.exists) appendLine(file, { t: 'end', ts: Date.now() });
  activeFile().delete();
  await stopLocationTaskIfIdle();
  return id;
}

type Parsed = { name: string; startedAt: number; endedAt: number | null; points: TrackPoint[] };

function parseTrack(id: string): Parsed | null {
  const file = trackFile(id);
  if (!file.exists) return null;
  const out: Parsed = { name: id, startedAt: 0, endedAt: null, points: [] };
  for (const line of file.textSync().split('\n')) {
    if (!line) continue;
    try {
      const o = JSON.parse(line);
      if (o.t === 'meta') {
        out.name = o.name;
        out.startedAt = o.start;
      } else if (o.t === 'end') {
        out.endedAt = o.ts;
      } else if (o.t === 'p') {
        out.points.push(o as TrackPoint);
      }
    } catch {
      // บรรทัดสุดท้ายอาจเขียนไม่ครบถ้าแอพถูกปิดกลางคัน ข้ามไป
    }
  }
  return out;
}

export function readTrackPoints(id: string): TrackPoint[] {
  return parseTrack(id)?.points ?? [];
}

function haversineM(a: TrackPoint, b: TrackPoint): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function measure(points: TrackPoint[]): { distanceM: number; ascentM: number } {
  let distanceM = 0;
  let ascentM = 0;
  for (let i = 1; i < points.length; i++) {
    distanceM += haversineM(points[i - 1], points[i]);
    const a0 = points[i - 1].alt;
    const a1 = points[i].alt;
    // นับความสูงที่ขึ้นเฉพาะที่เปลี่ยนเกิน 3 ม. กัน GPS สั่น
    if (a0 !== null && a1 !== null && a1 - a0 > 3) ascentM += a1 - a0;
  }
  return { distanceM, ascentM };
}

export function listTracks(): TrackSummary[] {
  const activeId = getActiveTrackId();
  const items: TrackSummary[] = [];
  for (const entry of tracksDir().list()) {
    if (!(entry instanceof File) || !entry.name.endsWith('.jsonl')) continue;
    const id = entry.name.replace(/\.jsonl$/, '');
    const t = parseTrack(id);
    if (!t) continue;
    items.push({
      id,
      name: t.name,
      startedAt: t.startedAt,
      endedAt: t.endedAt,
      points: t.points.length,
      active: id === activeId,
      ...measure(t.points),
    });
  }
  return items.sort((a, b) => b.startedAt - a.startedAt);
}

export function deleteTrack(id: string) {
  const f = trackFile(id);
  if (f.exists) f.delete();
}

export function renameTrack(id: string, name: string) {
  const t = parseTrack(id);
  if (!t) return;
  const file = trackFile(id);
  let text = JSON.stringify({ t: 'meta', id, name: name.trim() || t.name, start: t.startedAt }) + '\n';
  for (const p of t.points) text += JSON.stringify({ t: 'p', ...p }) + '\n';
  if (t.endedAt !== null) text += JSON.stringify({ t: 'end', ts: t.endedAt }) + '\n';
  file.write(text);
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildGPX(name: string, points: TrackPoint[]): string {
  let s =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<gpx version="1.1" creator="แผนที่เดินป่าออฟไลน์" xmlns="http://www.topografix.com/GPX/1/1">\n' +
    `<trk><name>${esc(name)}</name><trkseg>\n`;
  for (const p of points) {
    s += `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}">`;
    if (p.alt !== null) s += `<ele>${p.alt.toFixed(1)}</ele>`;
    s += `<time>${new Date(p.ts).toISOString()}</time></trkpt>\n`;
  }
  return s + '</trkseg></trk>\n</gpx>\n';
}

// ส่งออกเป็นไฟล์ .gpx แล้วเปิดหน้าแชร์ของเครื่อง (บันทึกลงไฟล์ / ส่งผ่านแอพอื่น)
export async function exportTrackGPX(id: string): Promise<void> {
  const t = parseTrack(id);
  if (!t || t.points.length === 0) throw new Error('เส้นทางนี้ยังไม่มีจุดบันทึก');
  const out = new File(Paths.cache, `${id}.gpx`);
  out.create({ overwrite: true });
  out.write(buildGPX(t.name, t.points));
  if (!(await Sharing.isAvailableAsync())) throw new Error('เครื่องนี้ไม่รองรับการแชร์ไฟล์');
  await Sharing.shareAsync(out.uri, {
    mimeType: 'application/gpx+xml',
    UTI: 'com.topografix.gpx',
    dialogTitle: t.name,
  });
}
