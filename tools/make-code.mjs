// สร้างรหัสเข้าใช้แอพ 1 รหัส + บรรทัดที่ต้องวางใน docs/access.json
// ใช้: node tools/make-code.mjs "ชื่อผู้ใช้"
// รหัสจริงแจกให้เจ้าตัวเท่านั้น ในไฟล์เก็บเฉพาะค่าแฮช (SHA-256) ของรหัส
import { createHash, randomInt } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ไม่มี I O 0 1 กันอ่านสับสน
const name = process.argv[2] || 'ผู้ใช้ใหม่';
let raw = '';
for (let i = 0; i < 10; i++) raw += ALPHABET[randomInt(ALPHABET.length)];
const hash = createHash('sha256').update(raw).digest('hex');

console.log('รหัส (ส่งให้เจ้าตัว):', raw.slice(0, 5) + '-' + raw.slice(5));
console.log('วางบรรทัดนี้ในรายการ "users" ของ docs/access.json:');
console.log(JSON.stringify({ name, hash, enabled: true }));
