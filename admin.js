'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const baht = (n) => '฿' + (n / 100).toLocaleString('th-TH', { minimumFractionDigits: n % 100 ? 2 : 0, maximumFractionDigits: 2 });
const when = (t) => new Date(t).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
const ST = { done: 'สำเร็จ', pending: 'รอดำเนินการ', refunded: 'คืนเงินแล้ว', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ' };
let ME = null, page = 'dash', badge = {}, CATS = [];

async function api(path, o = {}) {
  const opt = { method: o.method || 'GET', credentials: 'same-origin', headers: {} };
  if (o.json !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(o.json); }
  if (o.form) opt.body = o.form;
  const r = await fetch('/api' + path, opt);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'เกิดข้อผิดพลาด');
  return d;
}
const A = (p, o) => api('/admin' + p, o);
let tm; const toast = (t) => { const e = $('#toast'); e.textContent = t; e.style.opacity = 1; clearTimeout(tm); tm = setTimeout(() => (e.style.opacity = 0), 3000); };
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };

// ---------- modal ----------
function modal(title, html, onSave, saveText = 'บันทึก') {
  const d = $('#dlg');
  d.innerHTML = `<h3>${esc(title)}</h3><form method="dialog" id="mf">${html}<div class="err" id="merr"></div><div style="display:flex;gap:10px;justify-content:flex-end"><button type="button" class="btn" id="mc">ปิด</button>${onSave ? `<button class="btn red" type="submit">${saveText}</button>` : ''}</div></form>`;
  $('#mc').onclick = () => d.close();
  $('#mf').onsubmit = async (e) => {
    e.preventDefault(); if (!onSave) return;
    const b = e.submitter; b && (b.disabled = true);
    try { await onSave(new FormData(e.target), e.target); d.close(); } catch (x) { $('#merr').textContent = x.message; b && (b.disabled = false); }
  };
  d.showModal(); return d;
}
const field = (label, name, val = '', extra = '') => `<label class="field"><span>${label}</span><input name="${name}" value="${esc(val)}" ${extra}></label>`;
const area = (label, name, val = '', rows = 3) => `<label class="field"><span>${label}</span><textarea name="${name}" rows="${rows}">${esc(val)}</textarea></label>`;
const imgField = (label, name, val = '') => `<div class="imgf"><input type="hidden" name="${name}" value="${esc(val)}"><img src="${esc(val)}" alt="" ${val ? '' : 'hidden'}><div><div style="color:var(--mute);font-size:13px;margin-bottom:6px">${label}</div><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-up><button type="button" class="btn sm" data-clr>ลบรูป</button></div></div>`;
document.addEventListener('change', guard(async (e) => {
  if (!e.target.matches('[data-up]')) return;
  const f = e.target.files[0]; if (!f) return;
  const fd = new FormData(); fd.set('file', f);
  toast('กำลังอัปโหลด…'); const r = await A('/upload', { method: 'POST', form: fd });
  const box = e.target.closest('.imgf'); $('input[type=hidden]', box).value = r.url; const im = $('img', box); im.src = r.url; im.hidden = false; toast('อัปโหลดแล้ว');
}));
document.addEventListener('click', (e) => { if (e.target.matches('[data-clr]')) { const b = e.target.closest('.imgf'); $('input[type=hidden]', b).value = ''; $('img', b).hidden = true; } });

// ---------- เข้าสู่ระบบ ----------
function loginView(msg = '') {
  $('#root').innerHTML = `<div class="login panel"><div class="ph"><span class="ic">🔒</span>หลังบ้าน HEX STORE</div><form id="lf">${field('ชื่อผู้ใช้แอดมิน', 'username', '', 'required autocomplete="username"')}<label class="field"><span>รหัสผ่าน</span><input name="password" type="password" required autocomplete="current-password"></label><div class="err" id="err">${esc(msg)}</div><button class="buy pbtn" style="margin-top:0">เข้าสู่ระบบ</button></form></div>`;
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/login', { method: 'POST', json: Object.fromEntries(new FormData(e.target)) }); await boot(); }
    catch (x) { $('#err').textContent = x.message; }
  };
}

// ---------- หน้าต่างๆ ----------
const pages = {
  async dash() {
    const s = await A('/stats');
    return `<h1>แดชบอร์ด</h1><div class="cards">${[['สมาชิก', s.users], ['ออเดอร์ทั้งหมด', s.orders], ['ออเดอร์รอส่งของ', s.pendingOrders], ['สลิปรอตรวจ', s.pendingTopups], ['ยอดขายรวม', baht(s.revenue)], ['เติมเงินสำเร็จรวม', baht(s.topupTotal)]].map(([a, b]) => `<div class="kpi"><small>${a}</small><b>${b}</b></div>`).join('')}</div>
    ${s.lowStock.length ? `<div class="panel"><b>⚠ สต็อกใกล้หมด</b><ul>${s.lowStock.map((p) => `<li>${esc(p.name)} — เหลือ ${p.stock_left}</li>`).join('')}</ul></div>` : ''}
    <div class="panel"><b>ลิงก์หน้าร้าน:</b> <a href="/" target="_blank" style="color:var(--red2)">${location.origin}/</a></div>`;
  },

  async products() {
    const [list, cats] = await Promise.all([A('/products'), A('/categories')]); CATS = cats;
    window._P = Object.fromEntries(list.map((p) => [p.id, p]));
    return `<h1>สินค้า</h1><div class="bar"><button class="btn red" data-act="pnew">+ เพิ่มสินค้า</button></div><div class="panel tw"><table class="tbl"><tr><th></th><th>ชื่อ</th><th>หมวด</th><th>ราคา</th><th>ส่งของ</th><th>สต็อก</th><th>ขายแล้ว</th><th>แสดง</th><th></th></tr>
    ${list.map((p) => `<tr><td>${p.img ? `<img class="thumb" src="${esc(p.img)}" alt="">` : '<div class="thumb"></div>'}</td><td>${esc(p.name)}</td><td>${esc(p.cat || '-')}</td><td>${baht(p.price)}</td><td>${p.auto ? 'อัตโนมัติ' : 'แมนนวล'}</td><td>${p.auto ? p.stock_left : '∞'}</td><td>${p.sold}</td><td>${p.active ? '✔' : '—'}</td>
    <td><button class="btn sm" data-act="pedit" data-id="${p.id}">แก้ไข</button>${p.auto ? `<button class="btn sm" data-act="pstock" data-id="${p.id}">สต็อก</button>` : ''}<button class="btn sm danger" data-act="pdel" data-id="${p.id}">ลบ</button></td></tr>`).join('')}</table></div>`;
  },

  async cats() {
    const list = await A('/categories'); window._C = Object.fromEntries(list.map((c) => [c.id, c]));
    return `<h1>หมวดหมู่ (แบนเนอร์หน้าร้านค้า)</h1><div class="bar"><button class="btn red" data-act="cnew">+ เพิ่มหมวด</button><span style="color:var(--mute);font-size:13px">แนะนำรูปแบนเนอร์ยาว สัดส่วนประมาณ 4:1 — ถ้าใส่รูป ชื่อหมวดจะไม่แสดงทับรูป</span></div><div class="panel tw"><table class="tbl"><tr><th></th><th>ชื่อ</th><th>ลำดับ</th><th></th></tr>
    ${list.map((c) => `<tr><td>${c.img ? `<img class="thumb" style="width:120px" src="${esc(c.img)}" alt="">` : ''}</td><td>${esc(c.name)}</td><td>${c.sort}</td><td><button class="btn sm" data-act="cedit" data-id="${c.id}">แก้ไข</button><button class="btn sm danger" data-act="cdel" data-id="${c.id}">ลบ</button></td></tr>`).join('')}</table></div>`;
  },

  async orders() {
    const list = await A('/orders'); window._O = Object.fromEntries(list.map((o) => [o.id, o]));
    return `<h1>ออเดอร์</h1><div class="panel tw"><table class="tbl"><tr><th>#</th><th>สมาชิก</th><th>สินค้า</th><th>ยอด</th><th>สถานะ</th><th>เวลา</th><th></th></tr>
    ${list.map((o) => `<tr><td>${o.id}</td><td>${esc(o.username)}</td><td>${esc(o.product_name)} ×${o.qty}${o.delivery ? `<pre class="deliv">${esc(o.delivery)}</pre>` : ''}</td><td>${baht(o.total)}</td><td class="st-${o.status}">${ST[o.status]}</td><td>${when(o.created_at)}</td>
    <td>${o.status === 'pending' ? `<button class="btn red sm" data-act="ofill" data-id="${o.id}">ส่งของ</button>` : ''}${o.status !== 'refunded' ? `<button class="btn sm danger" data-act="orefund" data-id="${o.id}">คืนเงิน</button>` : ''}</td></tr>`).join('')}</table></div>`;
  },

  async topups() {
    const list = await A('/topups'); window._T = Object.fromEntries(list.map((t) => [t.id, t]));
    return `<h1>เติมเงิน / ตรวจสลิป</h1><div class="panel tw"><table class="tbl"><tr><th>#</th><th>สมาชิก</th><th>ยอดที่แจ้ง</th><th>ช่องทาง</th><th>สลิป</th><th>สถานะ</th><th>เวลา</th><th></th></tr>
    ${list.map((t) => `<tr><td>${t.id}</td><td>${esc(t.username)}</td><td>${baht(t.amount)}</td><td>${esc(t.method)}</td><td><button class="btn sm" data-act="tslip" data-id="${t.id}">ดูสลิป</button></td><td class="st-${t.status}">${ST[t.status]}${t.note ? ' · ' + esc(t.note) : ''}</td><td>${when(t.created_at)}</td>
    <td>${t.status === 'pending' ? `<button class="btn red sm" data-act="tok" data-id="${t.id}">อนุมัติ</button><button class="btn sm danger" data-act="tno" data-id="${t.id}">ไม่อนุมัติ</button>` : ''}</td></tr>`).join('')}</table></div>`;
  },

  async users() {
    const list = await A('/users?q=' + encodeURIComponent(window._uq || '')); window._U = Object.fromEntries(list.map((u) => [u.id, u]));
    return `<h1>สมาชิก</h1><div class="bar"><input id="uq" placeholder="ค้นหาชื่อผู้ใช้/อีเมล" value="${esc(window._uq || '')}" style="background:#0e0606;border:1px solid var(--line);border-radius:10px;padding:10px 14px;color:var(--text);font:inherit"><button class="btn" data-act="usearch">ค้นหา</button></div><div class="panel tw"><table class="tbl"><tr><th>#</th><th>ชื่อผู้ใช้</th><th>อีเมล</th><th>ยอดเงิน</th><th>สิทธิ์</th><th>สมัครเมื่อ</th><th></th></tr>
    ${list.map((u) => `<tr><td>${u.id}</td><td>${esc(u.username)}${u.banned ? ' <span class="st-refunded">(ระงับ)</span>' : ''}</td><td>${esc(u.email || '-')}</td><td>${baht(u.balance)}</td><td>${u.role === 'admin' ? 'แอดมิน' : 'สมาชิก'}</td><td>${when(u.created_at)}</td>
    <td><button class="btn sm" data-act="ubal" data-id="${u.id}">ปรับยอด</button><button class="btn sm" data-act="upw" data-id="${u.id}">รีเซ็ตรหัส</button>${u.id !== ME.id ? `<button class="btn sm" data-act="uban" data-id="${u.id}">${u.banned ? 'ปลดระงับ' : 'ระงับ'}</button><button class="btn sm" data-act="urole" data-id="${u.id}">${u.role === 'admin' ? 'ถอดแอดมิน' : 'ตั้งเป็นแอดมิน'}</button>` : ''}</td></tr>`).join('')}</table></div>`;
  },

  async settings() {
    const s = await A('/settings'); window._S = s;
    const meth = (m, i) => `<fieldset class="meth"><legend>ช่องทางที่ ${i + 1}</legend><div class="row2">${field('ชื่อแท็บ', 'm_name', m.name)}${field('คำอธิบายเล็ก', 'm_hint', m.hint)}</div>${field('เลขบัญชี / เบอร์ (ตัวใหญ่)', 'm_number', m.number)}${imgField('รูป QR / รูปช่องทางชำระเงิน', 'm_qr', m.qr)}${area('รายการบัญชี (บรรทัดละ 1 รายการ: ธนาคาร|ชื่อบัญชี|เลขบัญชี)', 'm_rows', m.rows.map((r) => [r.bank, r.acc, r.no].join('|')).join('\n'), 4)}<button type="button" class="btn sm danger" data-act="mdel">ลบช่องทางนี้</button></fieldset>`;
    return `<h1>ตั้งค่าเว็บไซต์</h1><form id="sf" class="panel">
    <div class="row2">${field('ชื่อร้าน (ตัวขาว)', 'name', s.name)}${field('ชื่อร้าน (ตัวสี)', 'name2', s.name2)}</div>
    <div class="row2"><label class="field"><span>สีหลักของเว็บ</span><input type="color" name="red" value="${esc(s.red)}" style="height:44px;padding:4px"></label>${field('ลิงก์ติดต่อ (เช่น LINE/Facebook/Discord ขึ้นต้น https://)', 'support', s.support)}</div>
    ${imgField('โลโก้', 'logo', s.logo)}
    <fieldset><legend>แบนเนอร์หน้าแรก</legend><div class="row2">${field('บรรทัดต้อนรับ', 'h_welcome', s.hero.welcome)}${field('ชื่อใหญ่', 'h_title', s.hero.title)}</div><div class="row2">${field('ข้อความป้าย', 'h_tag', s.hero.tag)}${field('ข้อความปุ่ม', 'h_cta', s.hero.cta)}</div>${imgField('รูปพื้นหลังแบนเนอร์ (ว่าง = ใช้ลายหกเหลี่ยม)', 'h_bg', s.hero.bg)}</fieldset>
    <div class="row2">${field('หัวข้อ: ซื้อล่าสุด', 'recentTitle', s.recentTitle)}${field('หัวข้อ: สินค้าแนะนำ', 'productsTitle', s.productsTitle)}</div>${field('หัวข้อ: ทำไมต้องเลือกเรา', 'whyTitle', s.whyTitle)}
    ${area('จุดเด่น (บรรทัดละ 1 ข้อ: ไอคอน|หัวข้อ|คำอธิบาย)', 'features', s.features.map((f) => [f.icon, f.title, f.text].join('|')).join('\n'), 5)}
    ${field('ข้อความท้ายเว็บ', 'footer', s.footer)}
    <fieldset><legend>หน้าเติมเงิน</legend><div class="row2">${field('หัวข้อ', 't_title', s.topup.title)}${field('ยอดเติมขั้นต่ำ (บาท)', 't_min', s.topup.minAmount, 'type="number" min="1"')}</div>${field('คำอธิบายใต้หัวข้อ', 't_sub', s.topup.sub)}${field('ข้อความสีเขียวบนฟอร์มสลิป', 't_tip', s.topup.slipTip)}${field('หมายเหตุท้ายฟอร์ม', 't_note', s.topup.note)}
    <div id="meths">${s.topup.methods.map(meth).join('')}</div><button type="button" class="btn" data-act="madd">+ เพิ่มช่องทางเติมเงิน</button></fieldset>
    <button class="btn red" type="submit">💾 บันทึกการตั้งค่า</button></form><template id="mtpl">${meth({ name: 'ช่องทางใหม่', hint: '', number: '', qr: '', rows: [] }, 0)}</template>`;
  }
};

const act = {
  pnew: () => pform(null),
  pedit: (id) => pform(window._P[id]),
  pdel: guard(async (id) => { if (!confirm('ลบสินค้านี้? (ประวัติออเดอร์ยังอยู่)')) return; await A('/products/' + id, { method: 'DELETE' }); show(); }),
  pstock: guard(async (id) => {
    const render = async () => {
      const rows = await A(`/products/${id}/stock`);
      return `<p style="color:var(--mute);margin-top:0">สินค้าคงเหลือ <b>${rows.filter((r) => !r.order_id).length}</b> ชิ้น — ใส่ข้อมูลที่จะส่งให้ลูกค้า บรรทัดละ 1 ชิ้น (เช่น user:pass หรือ โค้ด)</p>${area('เพิ่มสต็อก', 'lines', '', 5)}<div class="stk">${rows.map((r) => `<div class="${r.order_id ? 'used' : ''}"><span>${esc(r.content)}</span>${r.order_id ? '<small>ขายแล้ว</small>' : `<a data-sdel="${r.id}" style="color:#ff7b86;cursor:pointer">ลบ</a>`}</div>`).join('') || 'ยังไม่มีสต็อก'}</div>`;
    };
    const d = modal('จัดการสต็อก — ' + window._P[id].name, await render(), async (fd) => { await A(`/products/${id}/stock`, { method: 'POST', json: { lines: fd.get('lines') } }); toast('เพิ่มสต็อกแล้ว'); show(); }, 'เพิ่มสต็อก');
    d.onclick = guard(async (e) => { const s = e.target.dataset.sdel; if (s) { await A('/stock/' + s, { method: 'DELETE' }); e.target.closest('div').remove(); } });
  }),
  cnew: () => cform(null), cedit: (id) => cform(window._C[id]),
  cdel: guard(async (id) => { if (!confirm('ลบหมวดนี้? (สินค้าในหมวดจะกลายเป็นไม่มีหมวด)')) return; await A('/categories/' + id, { method: 'DELETE' }); show(); }),
  ofill: (id) => modal('ส่งของให้ออเดอร์ #' + id, area('ข้อมูลที่ลูกค้าจะเห็นในประวัติการซื้อ (เช่น ไอดี/รหัส/ลิงก์ดาวน์โหลด)', 'delivery', '', 5), async (fd) => { await A(`/orders/${id}/fulfill`, { method: 'POST', json: { delivery: fd.get('delivery') } }); toast('ส่งของแล้ว'); show(); }, 'ยืนยันส่งของ'),
  orefund: guard(async (id) => { if (!confirm(`คืนเงิน ${baht(window._O[id].total)} ให้ลูกค้า?`)) return; await A(`/orders/${id}/refund`, { method: 'POST', json: {} }); toast('คืนเงินแล้ว'); show(); }),
  tslip: (id) => modal(`สลิป #${id} — ${baht(window._T[id].amount)}`, `<img src="/api/slip/${id}" alt="สลิป" style="max-width:100%;border-radius:12px;margin-bottom:14px">`, null),
  tok: (id) => modal(`อนุมัติสลิป #${id}`, `<p style="margin-top:0;color:var(--mute)">ตรวจยอดในสลิปให้ตรง แล้วแก้ยอดด้านล่างถ้าไม่ตรงกับที่ลูกค้าแจ้ง</p>` + field('ยอดที่จะเติมเข้าบัญชี (บาท)', 'amount', window._T[id].amount / 100, 'type="number" step="0.01" min="1" required'), async (fd) => { await A(`/topups/${id}/approve`, { method: 'POST', json: { amount: fd.get('amount') } }); toast('เติมเงินให้สมาชิกแล้ว'); show(); }, 'อนุมัติและเติมเงิน'),
  tno: (id) => modal(`ไม่อนุมัติสลิป #${id}`, field('เหตุผล (ลูกค้าจะเห็น)', 'note', 'สลิปไม่ถูกต้อง'), async (fd) => { await A(`/topups/${id}/reject`, { method: 'POST', json: { note: fd.get('note') } }); show(); }, 'ยืนยัน'),
  usearch: () => { window._uq = $('#uq').value; show(); },
  ubal: (id) => modal('ปรับยอด ' + window._U[id].username, field('จำนวนเงิน (บาท) ใส่ติดลบเพื่อหักออก', 'delta', '', 'type="number" step="0.01" required') + field('เหตุผล', 'reason', '', 'required'), async (fd) => { await A(`/users/${id}/balance`, { method: 'POST', json: Object.fromEntries(fd) }); toast('ปรับยอดแล้ว'); show(); }),
  upw: (id) => modal('รีเซ็ตรหัสผ่าน ' + window._U[id].username, field('รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)', 'password', '', 'required minlength="8"'), async (fd) => { await A(`/users/${id}/password`, { method: 'POST', json: { password: fd.get('password') } }); toast('เปลี่ยนรหัสผ่านแล้ว'); }),
  uban: guard(async (id) => { const u = window._U[id]; await A('/users/' + id, { method: 'PUT', json: { banned: !u.banned, role: u.role } }); show(); }),
  urole: guard(async (id) => { const u = window._U[id]; if (!confirm(u.role === 'admin' ? 'ถอดสิทธิ์แอดมิน?' : 'ตั้งเป็นแอดมิน? (เข้าหลังบ้านได้ทุกอย่าง)')) return; await A('/users/' + id, { method: 'PUT', json: { banned: u.banned, role: u.role === 'admin' ? 'user' : 'admin' } }); show(); }),
  madd: () => { $('#meths').appendChild($('#mtpl').content.cloneNode(true)); },
  mdel: (_, el) => el.closest('fieldset').remove()
};

function pform(p) {
  p = p || { name: '', cat_id: null, price: 0, status: 'พร้อมให้บริการ', descr: '', detail: '', img: '', auto: 0, active: 1, sort: 0 };
  modal(p.id ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า', `${field('ชื่อสินค้า', 'name', p.name, 'required')}<div class="row2"><label class="field"><span>หมวดหมู่</span><select name="cat_id"><option value="">— ไม่มีหมวด —</option>${CATS.map((c) => `<option value="${c.id}" ${c.id === p.cat_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>${field('ราคา (บาท)', 'price', p.price / 100, 'type="number" step="0.01" min="0" required')}</div>
  <div class="row2">${field('สถานะ (ข้อความป้ายเขียว)', 'status', p.status)}${field('ลำดับแสดง (น้อยขึ้นก่อน)', 'sort', p.sort, 'type="number"')}</div>${field('คำบรรยายสั้น (แสดงบนการ์ด)', 'descr', p.descr)}${area('รายละเอียดสินค้า / สิ่งที่ลูกค้าจะได้รับ', 'detail', p.detail, 6)}${imgField('รูปสินค้า', 'img', p.img)}
  <label class="chk"><input type="checkbox" name="auto" ${p.auto ? 'checked' : ''}> ส่งของอัตโนมัติจากสต็อก (ไม่ติ๊ก = แอดมินส่งของเอง)</label><label class="chk"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> แสดงสินค้าบนหน้าร้าน</label>`,
  async (fd) => { const b = Object.fromEntries(fd); b.auto = !!fd.get('auto'); b.active = !!fd.get('active'); await A(p.id ? '/products/' + p.id : '/products', { method: p.id ? 'PUT' : 'POST', json: b }); toast('บันทึกแล้ว'); show(); });
}
function cform(c) {
  c = c || { name: '', img: '', sort: 0 };
  modal(c.id ? 'แก้ไขหมวด' : 'เพิ่มหมวด', field('ชื่อหมวด', 'name', c.name, 'required') + field('ลำดับแสดง', 'sort', c.sort, 'type="number"') + imgField('รูปแบนเนอร์ (ไม่บังคับ)', 'img', c.img),
    async (fd) => { await A(c.id ? '/categories/' + c.id : '/categories', { method: c.id ? 'PUT' : 'POST', json: Object.fromEntries(fd) }); toast('บันทึกแล้ว'); show(); });
}

async function saveSettings(form) {
  const v = (n) => form.elements[n]?.value ?? '';
  const lines = (n) => v(n).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.split('|').map((x) => x.trim()));
  const body = {
    name: v('name'), name2: v('name2'), red: v('red'), support: v('support'), logo: v('logo'), recentTitle: v('recentTitle'), productsTitle: v('productsTitle'), whyTitle: v('whyTitle'), footer: v('footer'),
    hero: { welcome: v('h_welcome'), title: v('h_title'), tag: v('h_tag'), cta: v('h_cta'), bg: v('h_bg') },
    features: lines('features').map(([icon, title, text]) => ({ icon, title, text })),
    topup: { title: v('t_title'), minAmount: v('t_min'), sub: v('t_sub'), slipTip: v('t_tip'), note: v('t_note'),
      methods: [...form.querySelectorAll('.meth')].map((f) => { const g = (n) => f.querySelector(`[name=${n}]`).value; return { name: g('m_name'), hint: g('m_hint'), number: g('m_number'), qr: g('m_qr'), rows: g('m_rows').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [bank, acc, no] = l.split('|').map((x) => x.trim()); return { bank, acc, no }; }) }; }) }
  };
  await A('/settings', { method: 'PUT', json: body }); toast('บันทึกการตั้งค่าแล้ว');
}

// ---------- โครงหน้า ----------
const MENU = [['dash', '📊', 'แดชบอร์ด'], ['products', '📦', 'สินค้า'], ['cats', '🗂', 'หมวดหมู่'], ['orders', '🧾', 'ออเดอร์'], ['topups', '💲', 'เติมเงิน/สลิป'], ['users', '👥', 'สมาชิก'], ['settings', '⚙️', 'ตั้งค่าเว็บ']];
async function show() {
  const [stats] = await Promise.all([A('/stats').catch(() => ({}))]); badge = { orders: stats.pendingOrders, topups: stats.pendingTopups };
  const body = await pages[page]();
  $('#root').innerHTML = `<div class="shell"><aside class="side"><a class="logo" href="/" target="_blank"><span class="hex">H</span><span>HEX<b style="color:var(--red2)">ADMIN</b></span></a>
  ${MENU.map(([k, i, t]) => `<a data-page="${k}" class="${k === page ? 'on' : ''}">${i} ${t}${badge[k] ? `<i>${badge[k]}</i>` : ''}</a>`).join('')}<div class="sp"></div><a href="/" target="_blank">🏪 ดูหน้าร้าน</a><a data-act="logout">⎋ ออกจากระบบ (${esc(ME.username)})</a></aside><main class="main">${body}</main></div>`;
  const sf = $('#sf'); if (sf) sf.onsubmit = guard(async (e) => { e.preventDefault(); await saveSettings(sf); });
}
document.addEventListener('click', guard(async (e) => {
  const p = e.target.closest('[data-page]'); if (p) { page = p.dataset.page; return show(); }
  const a = e.target.closest('[data-act]'); if (!a) return;
  if (a.dataset.act === 'logout') { await api('/logout', { method: 'POST' }); ME = null; return loginView(); }
  await act[a.dataset.act]?.(a.dataset.id, a);
}));
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'uq') act.usearch(); });

async function boot() {
  const { user } = await api('/me');
  if (!user) return loginView();
  if (user.role !== 'admin') { await api('/logout', { method: 'POST' }); return loginView('บัญชีนี้ไม่มีสิทธิ์เข้าหลังบ้าน'); }
  ME = user; await show();
}
boot().catch((e) => loginView(e.message));
