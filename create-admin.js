// ใช้: node scripts/create-admin.js <ชื่อผู้ใช้> <รหัสผ่าน>   (สร้างหรืออัปเกรดเป็นแอดมิน)
const [u, p] = process.argv.slice(2);
if (!u || !p || p.length < 8) { console.log('วิธีใช้: node scripts/create-admin.js <ชื่อผู้ใช้> <รหัสผ่านอย่างน้อย 8 ตัว>'); process.exit(1); }
const { ensureAdmin } = require('../server');
ensureAdmin(u, p);
console.log('ตั้งค่าแอดมินเรียบร้อย:', u);
process.exit(0);
