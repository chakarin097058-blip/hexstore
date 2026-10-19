const { DatabaseSync } = require('node:sqlite'); // มากับ Node.js 22.13+ ไม่ต้องคอมไพล์/ติดตั้ง Python
const fs = require('fs');
const path = require('path');

const DATA = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
for (const d of ['', 'uploads', 'slips']) fs.mkdirSync(path.join(DATA, d), { recursive: true });

const db = new DatabaseSync(path.join(DATA, 'hexstore.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
// ธุรกรรม: สำเร็จทั้งก้อน หรือย้อนกลับทั้งก้อน (กันเงิน/สต็อกเพี้ยน)
db.transaction = (fn) => (...args) => {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(...args); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
};

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT UNIQUE COLLATE NOCASE,
  pass TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'user',
  banned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS categories(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, img TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY,
  cat_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL, descr TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0,           -- สตางค์
  status TEXT NOT NULL DEFAULT 'พร้อมให้บริการ',
  sold INTEGER NOT NULL DEFAULT 0,
  img TEXT NOT NULL DEFAULT '',
  auto INTEGER NOT NULL DEFAULT 0,            -- 1 = ส่งของอัตโนมัติจากสต็อก
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS stock(
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  order_id INTEGER
);
CREATE INDEX IF NOT EXISTS stock_free ON stock(product_id, order_id);
CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  product_id INTEGER, product_name TEXT NOT NULL,
  qty INTEGER NOT NULL, total INTEGER NOT NULL,
  status TEXT NOT NULL,                       -- done | pending | refunded
  delivery TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS topups(
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL, method TEXT NOT NULL DEFAULT '', slip TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',     -- pending | approved | rejected
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, reviewed_at INTEGER
);
CREATE TABLE IF NOT EXISTS txlog(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, delta INTEGER NOT NULL,
  reason TEXT NOT NULL, balance_after INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

const DEFAULT_SITE = {
  name: 'HEX', name2: 'STORE', logo: '', red: '#e11d2e',
  hero: { welcome: 'ยินดีต้อนรับ', title: 'HEX STORE', tag: '✔ ซื้อง่าย รวดเร็ว ปลอดภัย 100%', cta: 'CLICK HERE!', bg: '' },
  recentTitle: 'สินค้าที่ซื้อล่าสุด',
  productsTitle: 'สินค้าแนะนำ',
  whyTitle: 'ทำไมต้องเลือก HEX STORE',
  features: [
    { icon: '🛒', title: 'ซื้อง่าย ไม่ยุ่งยาก', text: 'ระบบใช้งานง่าย มีทีมงานคอยแนะนำทุกขั้นตอน' },
    { icon: '⚡', title: 'รวดเร็ว พร้อมใช้งานทันที', text: 'ชำระเงินเสร็จ รับสินค้าได้ทันที ไม่ต้องรอนาน' },
    { icon: '🛡', title: 'ปลอดภัย 100%', text: 'สินค้าผ่านการตรวจสอบก่อนส่งมอบทุกชิ้น' },
    { icon: '🎧', title: 'ซัพพอร์ตหลังการขาย', text: 'ตอบแชทไว ให้คำแนะนำ และช่วยแก้ปัญหาหลังการขาย' }
  ],
  footer: '© 2026 HEX STORE — สงวนลิขสิทธิ์',
  support: '',
  topup: {
    title: 'เติมเงิน', sub: 'เติมเครดิตเข้าบัญชี ใช้ซื้อสินค้าได้ทันที', minAmount: 20,
    slipTip: 'โอนตามช่องทางด้านซ้าย แล้วแนบสลิป — แอดมินเติมเครดิตให้ตามยอดในสลิป',
    note: '* หากเงินไม่เข้า โปรดติดต่อแอดมิน',
    methods: [
      { name: 'ธนาคาร / พร้อมเพย์', hint: 'พร้อมเพย์ / ธนาคาร', number: '000-000-0000', qr: '', rows: [{ bank: 'ธนาคาร (แก้ในหลังบ้าน)', acc: 'ชื่อบัญชี', no: '0000000000' }] },
      { name: 'ทรูมันนี่ วอลเล็ท', hint: 'ทรูมันนี่ วอลเล็ท', number: '000-000-0000', qr: '', rows: [] }
    ]
  }
};

const getSite = () => {
  const r = db.prepare("SELECT value FROM settings WHERE key='site'").get();
  return r ? { ...DEFAULT_SITE, ...JSON.parse(r.value) } : structuredClone(DEFAULT_SITE);
};
const setSite = (v) => db.prepare("INSERT INTO settings(key,value) VALUES('site',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(v));

// ข้อมูลตัวอย่างครั้งแรก
if (!db.prepare('SELECT 1 FROM categories LIMIT 1').get()) {
  const now = Date.now();
  const ic = db.prepare('INSERT INTO categories(name,sort) VALUES(?,?)');
  ['รวมบริการต่างๆ FIVEM', 'เครื่องมือ BOOST FPS', 'ยศ VIP สุดคุ้มภายในร้าน', 'กล่องสุ่ม ID GAME', 'แอพ PREMIUM ราคาถูก', 'กิจกรรม แจกของ FREE'].forEach((n, i) => ic.run(n, i));
  const ip = db.prepare('INSERT INTO products(cat_id,name,descr,detail,price,sold,created_at,sort) VALUES(?,?,?,?,?,?,?,?)');
  [['สินค้าตัวอย่าง A', 9900], ['สินค้าตัวอย่าง B', 14900], ['สินค้าตัวอย่าง C', 19900], ['สินค้าตัวอย่าง D', 29900]].forEach(([n, p], i) =>
    ip.run(2, n, 'รายละเอียดสั้นๆ ของสินค้า (แก้ในหลังบ้าน)', 'พิมพ์รายละเอียดสินค้า\nและสิ่งที่ลูกค้าจะได้รับที่นี่', p, 0, now, i));
}
if (!db.prepare("SELECT 1 FROM settings WHERE key='site'").get()) setSite(DEFAULT_SITE);

module.exports = { db, DATA, getSite, setSite, DEFAULT_SITE };
