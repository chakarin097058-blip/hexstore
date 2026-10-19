// ทดสอบระบบหลังบ้านแบบครบวงจร (ใช้ฐานข้อมูลชั่วคราว)  —  npm test
const os = require('os'), fs = require('fs'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hex-'));
process.env.ADMIN_USERNAME = 'boss'; process.env.ADMIN_PASSWORD = 'bosspass123';
const { app } = require('../server');
const assert = require('assert');
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 1)]);

const srv = app.listen(0, async () => {
  const base = 'http://127.0.0.1:' + srv.address().port;
  const mk = () => { let c = ''; return async (p, o = {}) => {
    const h = { ...(o.headers || {}) }; if (c) h.cookie = c; if (o.json) { h['content-type'] = 'application/json'; o.body = JSON.stringify(o.json); }
    const r = await fetch(base + p, { ...o, headers: h }); const sc = r.headers.get('set-cookie'); if (sc) c = sc.split(';')[0];
    const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { s: r.status, d }; }; };
  const u = mk(), a = mk(); let n = 0; const ok = (m) => console.log('✓', m, ++n && '');
  try {
    assert.equal((await u('/api/me')).d.user, null);
    assert.equal((await u('/api/register', { method: 'POST', json: { username: 'a!', password: 'x' } })).s, 400); ok('ตรวจข้อมูลสมัครสมาชิก');
    assert.equal((await u('/api/register', { method: 'POST', json: { username: 'tester', password: 'password123' } })).s, 200);
    assert.equal((await u('/api/me')).d.user.username, 'tester'); ok('สมัครสมาชิก + เข้าสู่ระบบอัตโนมัติ');
    assert.equal((await u('/api/register', { method: 'POST', json: { username: 'TESTER', password: 'password123' } })).s, 400); ok('กันชื่อซ้ำ');
    assert.equal((await u('/api/admin/stats')).s, 403); ok('สมาชิกทั่วไปเข้าหลังบ้านไม่ได้');
    assert.equal((await u('/api/site', {})).d.products.length, 4);
    assert.equal((await u('/api/login', { method: 'POST', json: { username: 'tester', password: 'wrongpass' }, headers: {} })).s, 401); ok('รหัสผิดถูกปฏิเสธ');
    assert.equal((await a('/api/login', { method: 'POST', json: { username: 'boss', password: 'bosspass123' } })).s, 200);
    assert.equal((await a('/api/admin/stats')).s, 200); ok('แอดมินเข้าหลังบ้านได้');
    assert.equal((await u('/api/logout', { method: 'POST', headers: { origin: 'http://evil.com' } })).s, 403); ok('กัน CSRF ข้ามโดเมน');

    // เติมเงิน
    const fd = () => { const f = new FormData(); f.set('amount', '500'); f.set('method', 'bank'); f.set('slip', new Blob([png], { type: 'image/png' }), 's.png'); return f; };
    assert.equal((await u('/api/topup', { method: 'POST', body: fd() })).s, 200);
    const bad = new FormData(); bad.set('amount', '500'); bad.set('slip', new Blob(['<script>x</script>'.repeat(5)], { type: 'image/png' }), 'x.png');
    assert.equal((await u('/api/topup', { method: 'POST', body: bad })).s, 400); ok('ยื่นสลิป + กันไฟล์ปลอม');
    const tops = (await a('/api/admin/topups')).d; assert.equal(tops.length, 1);
    assert.equal((await a('/api/slip/' + tops[0].id)).s, 200); assert.equal((await mk()('/api/slip/' + tops[0].id)).s, 401);
    assert.equal((await a('/api/admin/topups/' + tops[0].id + '/approve', { method: 'POST', json: {} })).s, 200);
    assert.equal((await a('/api/admin/topups/' + tops[0].id + '/approve', { method: 'POST', json: {} })).s, 400);
    assert.equal((await u('/api/me')).d.user.balance, 50000); ok('แอดมินอนุมัติสลิป → เพิ่มยอด 500 บาท (กดซ้ำไม่ได้)');

    // สินค้าอัตโนมัติ
    const pid = (await a('/api/admin/products', { method: 'POST', json: { name: 'ไอดีเกม', price: 100, cat_id: 4, auto: true, descr: 'x', detail: 'y' } })).d.id;
    await a(`/api/admin/products/${pid}/stock`, { method: 'POST', json: { lines: 'user1:pass1\nuser2:pass2' } });
    let r = await u('/api/order', { method: 'POST', json: { product_id: pid, qty: 2 } });
    assert.equal(r.s, 200); assert.equal(r.d.order.delivery, 'user1:pass1\nuser2:pass2'); assert.equal(r.d.balance, 30000);
    assert.equal((await u('/api/order', { method: 'POST', json: { product_id: pid, qty: 1 } })).s, 400); ok('ซื้อสินค้าอัตโนมัติ: ตัดเงิน + ส่งของ + สต็อกหมดซื้อไม่ได้');

    // สินค้าแมนนวล + คืนเงิน
    const p1 = (await u('/api/site')).d.products[0];
    r = await u('/api/order', { method: 'POST', json: { product_id: p1.id, qty: 1 } }); assert.equal(r.d.order.status, 'pending');
    assert.equal((await a(`/api/admin/orders/${r.d.order.id}/fulfill`, { method: 'POST', json: { delivery: 'ส่งแล้ว' } })).s, 200);
    assert.equal((await a(`/api/admin/orders/${r.d.order.id}/refund`, { method: 'POST', json: {} })).s, 200);
    assert.equal((await a(`/api/admin/orders/${r.d.order.id}/refund`, { method: 'POST', json: {} })).s, 400);
    assert.equal((await u('/api/me')).d.user.balance, 30000); ok('ออเดอร์แมนนวล: ส่งของ + คืนเงิน (คืนซ้ำไม่ได้)');
    assert.equal((await u('/api/order', { method: 'POST', json: { product_id: p1.id, qty: 20 } })).s, 400); ok('ยอดไม่พอซื้อไม่ได้');

    // อัปโหลดรูป + ตั้งค่า
    const up = new FormData(); up.set('file', new Blob([png], { type: 'image/png' }), 'a.png');
    const img = (await a('/api/admin/upload', { method: 'POST', body: up })).d.url; assert.match(img, /^\/uploads\/[a-f0-9]{32}\.png$/);
    assert.equal((await fetch(base + img)).status, 200);
    const set = (await a('/api/admin/settings')).d; set.name = 'MYSHOP'; set.hero.bg = img; set.red = '#00aa55';
    assert.equal((await a('/api/admin/settings', { method: 'PUT', json: set })).s, 200);
    const site = (await u('/api/site')).d.site; assert.equal(site.name, 'MYSHOP'); assert.equal(site.hero.bg, img); ok('อัปโหลดรูป + แก้ตั้งค่าเว็บ');
    assert.equal((await fetch(base + '/robots.txt')).status, 200);
    console.log('\nผ่านทั้งหมด'); process.exit(0);
  } catch (e) { console.error('✗ ล้มเหลว:', e.message, e.stack.split('\n')[1]); process.exit(1); }
});
