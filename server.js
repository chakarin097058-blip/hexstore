const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// โหลดไฟล์ .env (ถ้ามี)
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach((l) => {
    const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch {}

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { db, DATA, getSite, setSite, DEFAULT_SITE } = require('./lib/db');

const PORT = +process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production';
const ADMIN_PATH = '/' + (process.env.ADMIN_PATH || 'admin').replace(/^\/+|\/+$/g, '');
const SESSION_DAYS = 30;

class E extends Error { constructor(m, s = 400) { super(m); this.status = s; } }
const wrap = (fn) => (req, res, next) => { try { fn(req, res, next); } catch (e) { next(e); } };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const int = (v, min, max) => { const n = Math.round(Number(v)); if (!Number.isFinite(n) || n < min || n > max) throw new E('ข้อมูลตัวเลขไม่ถูกต้อง'); return n; };

// ---------- ผู้ดูแลคนแรก ----------
function ensureAdmin(username, password) {
  if (!username || !password) return;
  const ex = db.prepare('SELECT id FROM users WHERE username=?').get(username);
  const hash = bcrypt.hashSync(password, 12);
  if (ex) db.prepare("UPDATE users SET role='admin', pass=?, banned=0 WHERE id=?").run(hash, ex.id);
  else db.prepare("INSERT INTO users(username,pass,role,created_at) VALUES(?,?, 'admin', ?)").run(username, hash, Date.now());
}
if (!db.prepare("SELECT 1 FROM users WHERE role='admin'").get()) ensureAdmin(process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD);

// ---------- Express ----------
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  },
  hsts: PROD
}));
app.use(express.json({ limit: '200kb' }));

// กัน CSRF: คำขอที่แก้ข้อมูลต้องมาจากโดเมนเดียวกัน
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const o = req.headers.origin;
  if (o) { try { if (new URL(o).host !== req.headers.host) throw 0; } catch { return res.status(403).json({ error: 'คำขอไม่ถูกต้อง' }); } }
  next();
});
app.use('/api', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));
const authLimit = rateLimit({ windowMs: 15 * 60_000, limit: 15, standardHeaders: true, legacyHeaders: false, message: { error: 'ลองหลายครั้งเกินไป กรุณารอสักครู่' } });

// ---------- Session ----------
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((a) => a[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
function startSession(req, res, uid) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(id,user_id,expires) VALUES(?,?,?)').run(sha(token), uid, Date.now() + SESSION_DAYS * 864e5);
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: SESSION_DAYS * 864e5, path: '/' });
}
app.use((req, res, next) => {
  const t = cookies(req).sid;
  req.user = null;
  if (t) {
    const u = db.prepare('SELECT u.id,u.username,u.email,u.balance,u.role,u.banned FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires>?').get(sha(t), Date.now());
    if (u && !u.banned) req.user = u;
  }
  next();
});
const needUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' }));
const needAdmin = (req, res, next) => (req.user?.role === 'admin' ? next() : res.status(req.user ? 403 : 401).json({ error: 'ไม่มีสิทธิ์เข้าถึง' }));
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now()), 3600_000).unref();

// ---------- อัปโหลดรูป ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
function sniff(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.readUInt32BE(0) === 0x89504e47) return 'png';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (b.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  return null;
}
function saveImage(file, dir) {
  if (!file) throw new E('กรุณาเลือกไฟล์รูป');
  const ext = sniff(file.buffer);
  if (!ext) throw new E('ไฟล์ต้องเป็นรูป JPG / PNG / WEBP / GIF');
  const name = crypto.randomBytes(16).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(DATA, dir, name), file.buffer);
  return name;
}
const uploadOne = (field) => (req, res, next) => upload.single(field)(req, res, (err) => next(err ? new E(err.code === 'LIMIT_FILE_SIZE' ? 'ไฟล์ใหญ่เกิน 5MB' : 'อัปโหลดไม่สำเร็จ') : undefined));
const imgUrl = (v) => { v = str(v, 300); return v === '' || /^\/uploads\/[a-f0-9]{32}\.(jpg|png|webp|gif)$/.test(v) ? v : ''; };

// ---------- สาธารณะ ----------
const mask = (n) => n.slice(0, 3) + '***';
app.get('/api/site', wrap((req, res) => {
  const site = getSite();
  const cats = db.prepare('SELECT id,name,img FROM categories ORDER BY sort,id').all();
  const products = db.prepare(`SELECT p.id,p.cat_id,c.name cat,p.name,p.descr,p.detail,p.price,p.status,p.sold,p.img,
      CASE WHEN p.auto=1 THEN (SELECT COUNT(*) FROM stock s WHERE s.product_id=p.id AND s.order_id IS NULL) END AS stock_left
    FROM products p LEFT JOIN categories c ON c.id=p.cat_id WHERE p.active=1 ORDER BY p.sort,p.id`).all();
  const stats = {
    users: db.prepare('SELECT COUNT(*) n FROM users').get().n,
    products: products.length,
    stock: db.prepare('SELECT COUNT(*) n FROM stock WHERE order_id IS NULL').get().n,
    sold: db.prepare('SELECT COALESCE(SUM(qty),0) n FROM orders WHERE status!=?').get('refunded').n
  };
  const recent = db.prepare('SELECT o.product_name name,u.username,o.created_at t FROM orders o JOIN users u ON u.id=o.user_id WHERE o.status!=? ORDER BY o.id DESC LIMIT 10').all('refunded').map((r) => ({ name: r.name, who: mask(r.username), t: r.t }));
  res.json({ site, cats, products, stats, recent });
}));

app.get('/api/me', (req, res) => res.json({ user: req.user && { id: req.user.id, username: req.user.username, balance: req.user.balance, role: req.user.role } }));

app.post('/api/register', authLimit, wrap((req, res) => {
  const username = str(req.body.username, 20), password = String(req.body.password ?? ''), email = str(req.body.email, 100) || null;
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) throw new E('ชื่อผู้ใช้ต้องเป็น a-z 0-9 _ ยาว 3-20 ตัว');
  if (password.length < 8 || password.length > 72) throw new E('รหัสผ่านต้องยาว 8-72 ตัวอักษร');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new E('อีเมลไม่ถูกต้อง');
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) throw new E('ชื่อผู้ใช้นี้ถูกใช้แล้ว');
  if (email && db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw new E('อีเมลนี้ถูกใช้แล้ว');
  const id = db.prepare('INSERT INTO users(username,email,pass,created_at) VALUES(?,?,?,?)').run(username, email, bcrypt.hashSync(password, 12), Date.now()).lastInsertRowid;
  startSession(req, res, id);
  res.json({ ok: true });
}));

const DUMMY = bcrypt.hashSync('dummy-password', 12);
app.post('/api/login', authLimit, wrap((req, res) => {
  const id = str(req.body.username, 100), password = String(req.body.password ?? '').slice(0, 200);
  const u = db.prepare('SELECT * FROM users WHERE username=? OR email=?').get(id, id);
  const ok = bcrypt.compareSync(password, u ? u.pass : DUMMY);
  if (!u || !ok) throw new E('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 401);
  if (u.banned) throw new E('บัญชีนี้ถูกระงับ', 403);
  startSession(req, res, u.id);
  res.json({ ok: true });
}));

app.post('/api/logout', (req, res) => {
  const t = cookies(req).sid;
  if (t) db.prepare('DELETE FROM sessions WHERE id=?').run(sha(t));
  res.clearCookie('sid', { path: '/' });
  res.json({ ok: true });
});

app.post('/api/password', needUser, authLimit, wrap((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(String(req.body.old ?? ''), u.pass)) throw new E('รหัสผ่านเดิมไม่ถูกต้อง');
  const np = String(req.body.new ?? '');
  if (np.length < 8 || np.length > 72) throw new E('รหัสผ่านใหม่ต้องยาว 8-72 ตัวอักษร');
  db.prepare('UPDATE users SET pass=? WHERE id=?').run(bcrypt.hashSync(np, 12), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id=? AND id!=?').run(u.id, sha(cookies(req).sid || ''));
  res.json({ ok: true });
}));

// ---------- สั่งซื้อ ----------
const log = (uid, delta, reason) => {
  const b = db.prepare('SELECT balance FROM users WHERE id=?').get(uid).balance;
  db.prepare('INSERT INTO txlog(user_id,delta,reason,balance_after,created_at) VALUES(?,?,?,?,?)').run(uid, delta, reason, b, Date.now());
};
const buy = db.transaction((uid, pid, qty) => {
  const p = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(pid);
  if (!p) throw new E('ไม่พบสินค้า', 404);
  const total = p.price * qty;
  let items = [];
  if (p.auto) {
    items = db.prepare('SELECT id,content FROM stock WHERE product_id=? AND order_id IS NULL ORDER BY id LIMIT ?').all(pid, qty);
    if (items.length < qty) throw new E('สินค้าในสต็อกไม่พอ');
  }
  const r = db.prepare('UPDATE users SET balance=balance-? WHERE id=? AND balance>=?').run(total, uid, total);
  if (!r.changes) throw new E('ยอดเงินไม่พอ กรุณาเติมเงิน');
  const oid = db.prepare('INSERT INTO orders(user_id,product_id,product_name,qty,total,status,delivery,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(uid, p.id, p.name, qty, total, p.auto ? 'done' : 'pending', items.map((i) => i.content).join('\n'), Date.now()).lastInsertRowid;
  for (const i of items) db.prepare('UPDATE stock SET order_id=? WHERE id=?').run(oid, i.id);
  db.prepare('UPDATE products SET sold=sold+? WHERE id=?').run(qty, p.id);
  log(uid, -total, `ซื้อ ${p.name} x${qty} (#${oid})`);
  return db.prepare('SELECT * FROM orders WHERE id=?').get(oid);
});
app.post('/api/order', needUser, wrap((req, res) => {
  const order = buy(req.user.id, int(req.body.product_id, 1, 1e9), int(req.body.qty ?? 1, 1, 20));
  res.json({ order, balance: db.prepare('SELECT balance FROM users WHERE id=?').get(req.user.id).balance });
}));
app.get('/api/orders', needUser, wrap((req, res) => {
  res.json({ orders: db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.user.id), topups: db.prepare('SELECT id,amount,method,status,note,created_at FROM topups WHERE user_id=? ORDER BY id DESC LIMIT 50').all(req.user.id) });
}));

// ---------- เติมเงิน (แนบสลิป) ----------
app.post('/api/topup', needUser, uploadOne('slip'), wrap((req, res) => {
  const site = getSite();
  const amount = Math.round(Number(req.body.amount) * 100);
  const min = (site.topup.minAmount || 1) * 100;
  if (!Number.isFinite(amount) || amount < min || amount > 5_000_000) throw new E(`ยอดเติมขั้นต่ำ ${site.topup.minAmount} บาท`);
  if (db.prepare("SELECT COUNT(*) n FROM topups WHERE user_id=? AND status='pending'").get(req.user.id).n >= 5) throw new E('มีรายการรอตรวจสอบหลายรายการแล้ว กรุณารอแอดมิน');
  const slip = saveImage(req.file, 'slips');
  db.prepare('INSERT INTO topups(user_id,amount,method,slip,created_at) VALUES(?,?,?,?,?)').run(req.user.id, amount, str(req.body.method, 60), slip, Date.now());
  res.json({ ok: true });
}));
app.get('/api/slip/:id', needUser, wrap((req, res) => {
  const t = db.prepare('SELECT user_id,slip FROM topups WHERE id=?').get(+req.params.id);
  if (!t || (t.user_id !== req.user.id && req.user.role !== 'admin')) throw new E('ไม่พบไฟล์', 404);
  res.set('Cache-Control', 'private, max-age=3600');
  res.sendFile(path.join(DATA, 'slips', t.slip));
}));

// ---------- หลังบ้าน (API) ----------
const A = express.Router();
A.use(needAdmin);
app.use('/api/admin', A);

A.get('/stats', wrap((req, res) => {
  const n = (sql, ...a) => db.prepare(sql).get(...a).n;
  res.json({
    users: n('SELECT COUNT(*) n FROM users'),
    orders: n("SELECT COUNT(*) n FROM orders WHERE status!='refunded'"),
    pendingOrders: n("SELECT COUNT(*) n FROM orders WHERE status='pending'"),
    pendingTopups: n("SELECT COUNT(*) n FROM topups WHERE status='pending'"),
    revenue: n("SELECT COALESCE(SUM(total),0) n FROM orders WHERE status!='refunded'"),
    topupTotal: n("SELECT COALESCE(SUM(amount),0) n FROM topups WHERE status='approved'"),
    lowStock: db.prepare("SELECT p.id,p.name,(SELECT COUNT(*) FROM stock s WHERE s.product_id=p.id AND s.order_id IS NULL) stock_left FROM products p WHERE p.auto=1 AND p.active=1 AND stock_left<5").all()
  });
}));

A.post('/upload', uploadOne('file'), wrap((req, res) => res.json({ url: '/uploads/' + saveImage(req.file, 'uploads') })));

A.get('/products', wrap((req, res) => res.json(db.prepare(`SELECT p.*,c.name cat,(SELECT COUNT(*) FROM stock s WHERE s.product_id=p.id AND s.order_id IS NULL) stock_left FROM products p LEFT JOIN categories c ON c.id=p.cat_id ORDER BY p.sort,p.id`).all())));
const prodFields = (b) => {
  const cat = b.cat_id ? int(b.cat_id, 1, 1e9) : null;
  if (cat && !db.prepare('SELECT 1 FROM categories WHERE id=?').get(cat)) throw new E('ไม่พบหมวดหมู่');
  if (!str(b.name)) throw new E('กรุณาใส่ชื่อสินค้า');
  return [cat, str(b.name, 120), str(b.descr, 300), str(b.detail, 5000), Math.round(Number(b.price) * 100), str(b.status, 40) || 'พร้อมให้บริการ', imgUrl(b.img), b.auto ? 1 : 0, b.active === false || b.active === 0 ? 0 : 1, int(b.sort ?? 0, -9999, 9999)];
};
A.post('/products', wrap((req, res) => {
  const f = prodFields(req.body);
  if (!(f[4] >= 0 && f[4] <= 100_000_000)) throw new E('ราคาไม่ถูกต้อง');
  const id = db.prepare('INSERT INTO products(cat_id,name,descr,detail,price,status,img,auto,active,sort,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(...f, Date.now()).lastInsertRowid;
  res.json({ id });
}));
A.put('/products/:id', wrap((req, res) => {
  const f = prodFields(req.body);
  if (!(f[4] >= 0 && f[4] <= 100_000_000)) throw new E('ราคาไม่ถูกต้อง');
  db.prepare('UPDATE products SET cat_id=?,name=?,descr=?,detail=?,price=?,status=?,img=?,auto=?,active=?,sort=? WHERE id=?').run(...f, +req.params.id);
  res.json({ ok: true });
}));
A.delete('/products/:id', wrap((req, res) => {
  // เก็บประวัติออเดอร์ไว้ (product_name ถูกบันทึกในออเดอร์แล้ว)
  db.prepare('UPDATE orders SET product_id=NULL WHERE product_id=?').run(+req.params.id);
  db.prepare('DELETE FROM products WHERE id=?').run(+req.params.id);
  res.json({ ok: true });
}));

A.get('/products/:id/stock', wrap((req, res) => res.json(db.prepare('SELECT id,content,order_id FROM stock WHERE product_id=? ORDER BY id DESC LIMIT 500').all(+req.params.id))));
A.post('/products/:id/stock', wrap((req, res) => {
  const lines = String(req.body.lines ?? '').split(/\r?\n/).map((l) => l.trim().slice(0, 2000)).filter(Boolean).slice(0, 2000);
  if (!lines.length) throw new E('ไม่มีข้อมูลสต็อก');
  const ins = db.prepare('INSERT INTO stock(product_id,content) VALUES(?,?)');
  db.transaction(() => lines.forEach((l) => ins.run(+req.params.id, l)))();
  res.json({ added: lines.length });
}));
A.delete('/stock/:id', wrap((req, res) => { db.prepare('DELETE FROM stock WHERE id=? AND order_id IS NULL').run(+req.params.id); res.json({ ok: true }); }));

A.get('/categories', wrap((req, res) => res.json(db.prepare('SELECT * FROM categories ORDER BY sort,id').all())));
A.post('/categories', wrap((req, res) => {
  if (!str(req.body.name)) throw new E('กรุณาใส่ชื่อหมวด');
  res.json({ id: db.prepare('INSERT INTO categories(name,img,sort) VALUES(?,?,?)').run(str(req.body.name, 80), imgUrl(req.body.img), int(req.body.sort ?? 0, -9999, 9999)).lastInsertRowid });
}));
A.put('/categories/:id', wrap((req, res) => {
  if (!str(req.body.name)) throw new E('กรุณาใส่ชื่อหมวด');
  db.prepare('UPDATE categories SET name=?,img=?,sort=? WHERE id=?').run(str(req.body.name, 80), imgUrl(req.body.img), int(req.body.sort ?? 0, -9999, 9999), +req.params.id);
  res.json({ ok: true });
}));
A.delete('/categories/:id', wrap((req, res) => { db.prepare('DELETE FROM categories WHERE id=?').run(+req.params.id); res.json({ ok: true }); }));

A.get('/orders', wrap((req, res) => res.json(db.prepare('SELECT o.*,u.username FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 300').all())));
A.post('/orders/:id/fulfill', wrap((req, res) => {
  const r = db.prepare("UPDATE orders SET status='done',delivery=? WHERE id=? AND status='pending'").run(str(req.body.delivery, 5000), +req.params.id);
  if (!r.changes) throw new E('ออเดอร์นี้ดำเนินการแล้ว');
  res.json({ ok: true });
}));
A.post('/orders/:id/refund', wrap((req, res) => {
  db.transaction(() => {
    const o = db.prepare('SELECT * FROM orders WHERE id=?').get(+req.params.id);
    if (!o || o.status === 'refunded') throw new E('คืนเงินไม่ได้');
    db.prepare("UPDATE orders SET status='refunded' WHERE id=?").run(o.id);
    db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(o.total, o.user_id);
    if (o.product_id) db.prepare('UPDATE products SET sold=MAX(0,sold-?) WHERE id=?').run(o.qty, o.product_id);
    log(o.user_id, o.total, `คืนเงินออเดอร์ #${o.id}`);
  })();
  res.json({ ok: true });
}));

A.get('/topups', wrap((req, res) => res.json(db.prepare('SELECT t.*,u.username FROM topups t JOIN users u ON u.id=t.user_id ORDER BY (t.status=\'pending\') DESC, t.id DESC LIMIT 300').all())));
A.post('/topups/:id/approve', wrap((req, res) => {
  db.transaction(() => {
    const t = db.prepare('SELECT * FROM topups WHERE id=?').get(+req.params.id);
    if (!t || t.status !== 'pending') throw new E('รายการนี้ตรวจสอบแล้ว');
    const amount = req.body.amount != null ? Math.round(Number(req.body.amount) * 100) : t.amount;
    if (!Number.isFinite(amount) || amount <= 0 || amount > 5_000_000) throw new E('ยอดเงินไม่ถูกต้อง');
    db.prepare("UPDATE topups SET status='approved',amount=?,reviewed_at=? WHERE id=?").run(amount, Date.now(), t.id);
    db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(amount, t.user_id);
    log(t.user_id, amount, `เติมเงิน (#${t.id})`);
  })();
  res.json({ ok: true });
}));
A.post('/topups/:id/reject', wrap((req, res) => {
  const r = db.prepare("UPDATE topups SET status='rejected',note=?,reviewed_at=? WHERE id=? AND status='pending'").run(str(req.body.note, 200), Date.now(), +req.params.id);
  if (!r.changes) throw new E('รายการนี้ตรวจสอบแล้ว');
  res.json({ ok: true });
}));

A.get('/users', wrap((req, res) => {
  const q = '%' + str(req.query.q, 40).replace(/[%_]/g, '') + '%';
  res.json(db.prepare('SELECT id,username,email,balance,role,banned,created_at FROM users WHERE username LIKE ? OR email LIKE ? ORDER BY id DESC LIMIT 200').all(q, q));
}));
A.put('/users/:id', wrap((req, res) => {
  const id = +req.params.id;
  if (id === req.user.id) throw new E('แก้ไขบัญชีตัวเองตรงนี้ไม่ได้');
  db.prepare('UPDATE users SET banned=?,role=? WHERE id=?').run(req.body.banned ? 1 : 0, req.body.role === 'admin' ? 'admin' : 'user', id);
  if (req.body.banned) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  res.json({ ok: true });
}));
A.post('/users/:id/balance', wrap((req, res) => {
  const delta = Math.round(Number(req.body.delta) * 100);
  if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 50_000_000) throw new E('จำนวนเงินไม่ถูกต้อง');
  db.transaction(() => {
    const r = db.prepare('UPDATE users SET balance=balance+? WHERE id=? AND balance+?>=0').run(delta, +req.params.id, delta);
    if (!r.changes) throw new E('ปรับยอดไม่ได้ (ยอดจะติดลบหรือไม่พบสมาชิก)');
    log(+req.params.id, delta, 'แอดมินปรับยอด: ' + str(req.body.reason, 100));
  })();
  res.json({ ok: true });
}));
A.post('/users/:id/password', wrap((req, res) => {
  const np = String(req.body.password ?? '');
  if (np.length < 8 || np.length > 72) throw new E('รหัสผ่านต้องยาว 8-72 ตัวอักษร');
  db.prepare('UPDATE users SET pass=? WHERE id=?').run(bcrypt.hashSync(np, 12), +req.params.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(+req.params.id);
  res.json({ ok: true });
}));

const cleanSite = (b) => {
  const d = DEFAULT_SITE, s = (v, m, f = '') => str(v, m) || f;
  const col = /^#[0-9a-fA-F]{6}$/.test(b.red) ? b.red : d.red;
  const t = b.topup || {};
  return {
    name: s(b.name, 30, d.name), name2: s(b.name2, 30), logo: imgUrl(b.logo), red: col,
    hero: { welcome: s(b.hero?.welcome, 60), title: s(b.hero?.title, 40), tag: s(b.hero?.tag, 80), cta: s(b.hero?.cta, 30), bg: imgUrl(b.hero?.bg) },
    recentTitle: s(b.recentTitle, 60), productsTitle: s(b.productsTitle, 60), whyTitle: s(b.whyTitle, 80), footer: s(b.footer, 200), support: s(b.support, 300),
    features: (Array.isArray(b.features) ? b.features : []).slice(0, 8).map((f) => ({ icon: s(f.icon, 4), title: s(f.title, 60), text: s(f.text, 200) })),
    topup: {
      title: s(t.title, 40, d.topup.title), sub: s(t.sub, 150), minAmount: Math.max(1, Math.min(10000, Math.round(Number(t.minAmount) || 20))), slipTip: s(t.slipTip, 200), note: s(t.note, 200),
      methods: (Array.isArray(t.methods) ? t.methods : []).slice(0, 6).map((m) => ({
        name: s(m.name, 40), hint: s(m.hint, 60), number: s(m.number, 40), qr: imgUrl(m.qr),
        rows: (Array.isArray(m.rows) ? m.rows : []).slice(0, 10).map((r) => ({ bank: s(r.bank, 60), acc: s(r.acc, 60), no: s(r.no, 40) }))
      }))
    }
  };
};
A.get('/settings', wrap((req, res) => res.json(getSite())));
A.put('/settings', wrap((req, res) => { setSite(cleanSite(req.body || {})); res.json({ ok: true }); }));

// ---------- ไฟล์หน้าเว็บ ----------
app.use('/uploads', express.static(path.join(DATA, 'uploads'), { maxAge: '7d', index: false, dotfiles: 'deny' }));
app.use(ADMIN_PATH, (req, res, next) => { res.set('X-Robots-Tag', 'noindex'); next(); }, express.static(path.join(__dirname, 'admin')));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/robots.txt', (req, res) => res.type('text').send(`User-agent: *\nDisallow: ${ADMIN_PATH}/\n`));
app.use('/api', (req, res) => res.status(404).json({ error: 'ไม่พบ' }));

app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  console.error(err);
  res.status(500).json({ error: 'เกิดข้อผิดพลาดในระบบ' });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`HEX STORE: http://localhost:${PORT}   หลังบ้าน: http://localhost:${PORT}${ADMIN_PATH}/`));
}
module.exports = { app, ensureAdmin };
