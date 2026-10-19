'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const baht = (n) => '฿' + (n / 100).toLocaleString('th-TH', { minimumFractionDigits: n % 100 ? 2 : 0, maximumFractionDigits: 2 });
const when = (t) => new Date(t).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
const bgs = (u) => (u ? ` style="background-image:url('${esc(u)}')"` : '');
const STATUS = { done: 'สำเร็จ', pending: 'รอดำเนินการ', refunded: 'คืนเงินแล้ว', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ' };

let D = null, ME = null, qty = 1, q = '', tab = 0, promo = false;

async function api(path, o = {}) {
  const opt = { method: o.method || 'GET', credentials: 'same-origin', headers: {} };
  if (o.json) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(o.json); }
  if (o.form) opt.body = o.form;
  const r = await fetch('/api' + path, opt);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'เกิดข้อผิดพลาด');
  return d;
}
let tm;
function toast(t) { const e = $('#toast'); e.textContent = t; e.style.opacity = 1; clearTimeout(tm); tm = setTimeout(() => (e.style.opacity = 0), 3200); }
async function load() { const [s, m] = await Promise.all([api('/site'), api('/me')]); D = s; ME = m.user; }

// ---------- ส่วนประกอบ ----------
function nav(route) {
  const S = D.site, on = (r) => (route === r ? 'on' : '');
  return `<nav><a class="logo" href="#/"><span class="hex">${S.logo ? `<img src="${esc(S.logo)}" alt="">` : 'H'}</span><span>${esc(S.name)} ${esc(S.name2)}</span></a>
  <div class="links"><a class="${on('home')}" href="#/">หน้าหลัก</a><a class="${on('store')}" href="#/store">ร้านค้า</a><a class="${on('topup')}" href="#/topup">เติมเงิน</a><a href="#/store" data-a="search">หาสินค้า</a>${S.support ? `<a href="${esc(S.support)}" target="_blank" rel="noopener noreferrer">ติดต่อเรา</a>` : ''}</div>
  <div style="display:flex;gap:10px;align-items:center">${ME
    ? `<a class="me" href="#/account">👤 ${esc(ME.username)} <b>${baht(ME.balance)}</b></a>`
    : `<a class="btn" href="#/register">สมัครสมาชิก</a><a class="btn red" href="#/login">เข้าสู่ระบบ</a>`}</div></nav>`;
}
const card = (p) => `<div class="card prod ${p.left === 0 ? 'sold-out' : ''}" data-go="${p.id}"><div class="pimg"${bgs(p.img)}>${p.img ? '' : esc((p.name || '?')[0])}</div><div class="b"><h3>${esc(p.name)}</h3><p>${esc(p.descr)}</p><div class="price"><b>${baht(p.price)}</b><span class="btn red">${p.left === 0 ? 'สินค้าหมด' : 'ซื้อเลย'}</span></div></div></div>`;

function home() {
  const S = D.site, st = D.stats, h = S.hero;
  const stats = [['👥', 'ผู้ใช้งาน', st.users, 'คน'], ['📦', 'สินค้า', st.products, 'รายการ'], ['🗄', 'คลังสินค้า', st.stock, 'ชิ้น'], ['✔', 'ขายแล้ว', st.sold, 'ชิ้น']];
  return `<section class="top"><div class="hero"${bgs(h.bg)}>${h.bg ? '' : '<div class="art"><i style="inset:0;background:#ff445533"></i><i style="inset:50px;background:#00000033"></i><i style="inset:110px;background:#ff44554d"></i><i style="inset:170px;background:#00000040"></i></div>'}
    <h1>${esc(h.welcome)}</h1><div class="big">${esc(h.title)}</div><div class="tag">${esc(h.tag)}</div><a class="cta" href="#/store">${esc(h.cta)}</a></div>
    <div class="stats">${stats.map((s) => `<div class="stat"><small><span class="ic">${s[0]}</span>${s[1]}</small><strong>${s[2].toLocaleString('th-TH')} <span>${s[3]}</span></strong></div>`).join('')}</div></section>
  ${D.recent.length ? `<section class="recent"><div class="rhead"><span>🛒 ${esc(S.recentTitle)}</span><span class="live">LIVE</span></div><div class="rrow">${D.recent.map((r) => `<div class="item"><b>${esc(r.name)}</b><span>${esc(r.who)} • ${esc(ago(r.t))}</span></div>`).join('')}</div></section>` : ''}
  <h2>${esc(S.productsTitle)}</h2><div class="grid">${D.products.slice(0, 8).map(card).join('') || '<p class="sub">ยังไม่มีสินค้า</p>'}</div>
  <h2>${esc(S.whyTitle)}</h2><div class="grid">${S.features.map((f) => `<div class="card"><span class="ic">${esc(f.icon)}</span><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p></div>`).join('')}</div>`;
}
function ago(t) { const m = Math.max(0, Math.floor((Date.now() - t) / 60000)); return m < 1 ? 'เมื่อสักครู่' : m < 60 ? m + ' นาทีที่แล้ว' : m < 1440 ? Math.floor(m / 60) + ' ชั่วโมงที่แล้ว' : Math.floor(m / 1440) + ' วันที่แล้ว'; }

function results(cid) {
  const n = q.trim().toLowerCase(), has = (x) => String(x ?? '').toLowerCase().includes(n);
  let cats = D.cats, ps = D.products;
  if (cid != null) { ps = ps.filter((p) => p.cat_id === cid); cats = []; } else if (n) cats = cats.filter((c) => has(c.name)); else ps = [];
  if (n) ps = ps.filter((p) => has(p.name) || has(p.cat) || has(p.descr));
  const cs = cats.length ? `<div class="cats">${cats.map((c) => `<div class="cat${c.img ? ' hid' : ''}" data-cat="${c.id}"${bgs(c.img)}><span class="cn">${esc(c.name)}</span><span class="go">CLICK HERE!</span></div>`).join('')}</div>` : '';
  const pr = ps.length ? `<div class="grid" style="margin-top:${cs ? 24 : 0}px">${ps.map(card).join('')}</div>` : '';
  return cs + pr + (!cs && !pr ? `<p class="sub">${cid != null && !n ? 'ยังไม่มีสินค้าในหมวดนี้' : 'ไม่พบสินค้าที่ค้นหา'}</p>` : '');
}
function store(cid) {
  const c = cid != null ? D.cats.find((x) => x.id === cid) : null;
  return `<div style="margin-top:28px">${c ? `<div class="crumb" style="margin:0 0 8px"><a href="#/store">ร้านค้า</a> / <b>${esc(c.name)}</b></div><h1 class="ph1">${esc(c.name)}</h1>` : '<h1 class="ph1">สินค้าทั้งหมด</h1>'}<p class="sub">ค้นหาหรือเลือกดูจากหมวดหมู่ด้านล่าง</p></div>
  <div class="sbar"><span>🔍</span><input id="q" placeholder="ค้นหาชื่อหมวดหมู่ หรือชื่อสินค้า..." value="${esc(q)}"><span class="h">🏷 ค้นหาได้ทั้งหมวดหมู่และสินค้า</span></div><div id="res">${results(cid)}</div>`;
}

function product(id) {
  const p = D.products.find((x) => x.id === id);
  if (!p) return '<p class="sub" style="margin-top:40px">ไม่พบสินค้านี้ <a href="#/store" style="color:var(--red2)">กลับไปร้านค้า</a></p>';
  const out = p.left === 0, tot = baht(p.price * qty);
  return `<div class="crumb"><a href="#/store">ร้านค้า</a> / ${esc(p.cat || 'ทั่วไป')} / <b>${esc(p.name)}</b></div>
  <div class="pd"><div class="gal">${p.img ? `<img src="${esc(p.img)}" alt="${esc(p.name)}">` : `<span>${esc((p.name || '?')[0])}</span>`}</div>
  <div class="info"><h1>${esc(p.name)}</h1>
   <div class="badges"><span>🏷 ${esc(p.cat || 'ทั่วไป')}</span><span class="b2">● ${esc(out ? 'สินค้าหมด' : p.status)}</span><span class="b3">✔ ขายแล้ว ${p.sold}</span></div>
   <div class="pp"><b>${baht(p.price)}</b><span class="st">📦 สถานะ: <em>${esc(out ? 'สินค้าหมด' : p.status)}</em> ${p.left == null ? '∞' : 'เหลือ ' + p.left}</span></div>
   <div class="sec">รูปแบบสินค้า<small>เลือกรูปแบบที่ตรงกับการใช้งานของคุณ</small></div>
   <div class="opt"><span class="ic">📦</span><div><b>ราคา</b><small>ค่าสั่งซื้อ · เหลือ ${p.left == null ? '∞' : p.left}</small></div><b class="op">${baht(p.price)}</b></div>
   <div class="qty"><div class="qrow"><div><b>จำนวนที่ต้องการ</b><small>เลือกจำนวนที่ต้องการต่อคำสั่งซื้อ</small></div>
    <div class="step"><button data-a="qm" aria-label="ลด">−</button><span>${qty}</span><button data-a="qp" aria-label="เพิ่ม">+</button></div></div>
    <div class="sum"><span>ยอดสินค้า</span><span>${tot}</span></div><div class="sum t"><span>ยอดชำระทั้งหมด</span><b>${tot}</b></div></div>
   <button class="buy pbtn" data-a="order" data-id="${p.id}" ${out ? 'aria-disabled="true"' : ''}>🛒 ${out ? 'สินค้าหมด' : 'สั่งซื้อสินค้า'}</button>
   <div class="note">${ME ? `ยอดคงเหลือของคุณ ${baht(ME.balance)} · ` : 'ต้องเข้าสู่ระบบก่อนสั่งซื้อ · '}รายละเอียดการรับสินค้าจะแสดงในประวัติการซื้อหลังชำระเงินสำเร็จ</div></div></div>
  <section class="dt"><div class="dh"><span class="ic">ⓘ</span><div><b>รายละเอียดสินค้า</b><small>สิ่งที่คุณจะได้รับ</small></div></div><div class="dbody" style="white-space:pre-wrap">${esc(p.detail)}</div></section>`;
}

function authPage(mode) {
  const reg = mode === 'register';
  return `<div class="authbox panel"><div class="ph"><span class="ic">👤</span>${reg ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ'}</div>
  <form id="authf" data-mode="${mode}"><label class="field"><span>${reg ? 'ชื่อผู้ใช้ (a-z 0-9 _ ยาว 3-20 ตัว)' : 'ชื่อผู้ใช้ หรืออีเมล'}</span><input name="username" required autocomplete="username" maxlength="100"></label>
  ${reg ? '<label class="field"><span>อีเมล (ไม่บังคับ)</span><input name="email" type="email" autocomplete="email"></label>' : ''}
  <label class="field"><span>รหัสผ่าน${reg ? ' (อย่างน้อย 8 ตัว)' : ''}</span><input name="password" type="password" required minlength="${reg ? 8 : 1}" autocomplete="${reg ? 'new-password' : 'current-password'}"></label>
  ${reg ? '<label class="field"><span>ยืนยันรหัสผ่าน</span><input name="password2" type="password" required autocomplete="new-password"></label>' : ''}
  <div class="err" id="err"></div><button class="buy pbtn" type="submit" style="margin-top:0">${reg ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ'}</button></form>
  <p class="note" style="text-align:center">${reg ? 'มีบัญชีแล้ว? <a href="#/login" style="color:var(--red2)">เข้าสู่ระบบ</a>' : 'ยังไม่มีบัญชี? <a href="#/register" style="color:var(--red2)">สมัครสมาชิก</a>'}</p></div>`;
}

function topup() {
  const T = D.site.topup, k = T.methods[tab] ? tab : 0, m = T.methods[k];
  if (!m) return '<p class="sub">ยังไม่ได้ตั้งค่าช่องทางเติมเงิน</p>';
  return `<div class="th"><span class="ic big">💲</span><h1 class="ph1">${esc(T.title)}</h1></div><p class="sub">${esc(T.sub)}</p>
  <div class="tabs">${T.methods.map((x, i) => `<span class="tab${i === k ? ' on' : ''}" data-a="tab" data-i="${i}">${esc(x.name)}</span>`).join('')}</div>
  <div class="tg"><div class="panel"><div class="ph"><span class="ic">🏛</span>ช่องทางโอนเงิน</div>
   <div class="acc"><div><small>${esc(m.hint)}</small><b>${esc(m.number)}</b></div><span class="btn red" data-a="copy" data-v="${esc(m.number)}">⧉ คัดลอก</span></div>
   ${m.qr ? `<div class="qrbox"><img src="${esc(m.qr)}" alt="QR"></div>` : ''}
   ${m.rows.map((r) => `<div class="brow"><div><small>${esc(r.bank)}</small><b>${esc(r.acc)}</b></div><b>${esc(r.no)}</b></div>`).join('')}</div>
  <div class="panel"><div class="ph"><span class="ic">💲</span>แจ้งสลิปโอนเงิน</div><div class="ok">✔ ${esc(T.slipTip)}</div>
   ${ME ? `<form id="topf" data-method="${esc(m.name)}" style="margin-top:14px"><label class="field"><span>ยอดที่โอน (บาท, ขั้นต่ำ ${T.minAmount})</span><input name="amount" type="number" min="${T.minAmount}" step="0.01" required></label>
   <label class="drop" for="slip" style="display:grid"><div id="dz">⬆<br>คลิกเพื่อแนบสลิปโอนเงิน<br><small>รองรับ JPG / PNG (ไม่เกิน 5MB)</small></div></label><input id="slip" name="slip" type="file" accept="image/png,image/jpeg,image/webp" required hidden>
   <div class="err" id="err"></div><button class="buy pbtn" type="submit" style="margin-top:0">✔ ส่งสลิปแจ้งเติมเงิน</button></form>`
   : '<p class="sub" style="margin-top:16px">กรุณา <a href="#/login" style="color:var(--red2)">เข้าสู่ระบบ</a> หรือ <a href="#/register" style="color:var(--red2)">สมัครสมาชิก</a> ก่อนแจ้งเติมเงิน</p>'}
   <div class="note">${esc(T.note)}</div></div></div>`;
}

let ACC = null;
function account() {
  if (!ME) return authPage('login');
  if (!ACC) { api('/orders').then((d) => { ACC = d; render(); }); return '<p class="sub" style="margin-top:40px">กำลังโหลด…</p>'; }
  return `<div class="th"><span class="ic big">👤</span><h1 class="ph1">บัญชีของฉัน</h1></div>
  <p class="sub">ผู้ใช้: <b>${esc(ME.username)}</b> · ยอดคงเหลือ <b style="color:var(--red2)">${baht(ME.balance)}</b> <a class="btn red" href="#/topup" style="margin-left:8px;padding:6px 16px">เติมเงิน</a> <span class="btn" data-a="logout" style="padding:6px 16px">ออกจากระบบ</span></p>
  <h2 style="margin-top:20px">ประวัติการซื้อ</h2><div class="panel tw">${ACC.orders.length ? `<table class="tbl"><tr><th>#</th><th>สินค้า</th><th>ราคา</th><th>สถานะ</th><th>เวลา</th></tr>${ACC.orders.map((o) => `<tr><td>${o.id}</td><td>${esc(o.product_name)} ×${o.qty}${o.delivery ? `<pre class="deliv">${esc(o.delivery)}</pre><span class="btn" data-a="copy" data-v="${esc(o.delivery)}" style="padding:4px 12px;margin-top:6px;font-size:12px">คัดลอก</span>` : o.status === 'pending' ? '<br><small style="color:var(--mute)">แอดมินกำลังจัดส่งให้ จะแสดงที่นี่เมื่อพร้อม</small>' : ''}</td><td>${baht(o.total)}</td><td class="st-${o.status}">${STATUS[o.status]}</td><td>${when(o.created_at)}</td></tr>`).join('')}</table>` : '<p class="sub" style="margin:0">ยังไม่มีรายการ</p>'}</div>
  <h2>ประวัติเติมเงิน</h2><div class="panel tw">${ACC.topups.length ? `<table class="tbl"><tr><th>#</th><th>ยอด</th><th>ช่องทาง</th><th>สถานะ</th><th>เวลา</th></tr>${ACC.topups.map((t) => `<tr><td>${t.id}</td><td>${baht(t.amount)}</td><td>${esc(t.method)}</td><td class="st-${t.status}">${STATUS[t.status]}${t.note ? ' · ' + esc(t.note) : ''}</td><td>${when(t.created_at)}</td></tr>`).join('')}</table>` : '<p class="sub" style="margin:0">ยังไม่มีรายการ</p>'}</div>
  <h2>เปลี่ยนรหัสผ่าน</h2><div class="panel" style="max-width:440px"><form id="pwf"><label class="field"><span>รหัสผ่านเดิม</span><input name="old" type="password" required autocomplete="current-password"></label><label class="field"><span>รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)</span><input name="new" type="password" minlength="8" required autocomplete="new-password"></label><div class="err" id="err"></div><button class="buy pbtn" style="margin-top:0">บันทึกรหัสผ่านใหม่</button></form></div>`;
}

// ---------- เราท์ ----------
function route() {
  const h = location.hash || '#/';
  let m;
  if ((m = h.match(/^#\/p\/(\d+)$/))) return ['product', product(+m[1])];
  if ((m = h.match(/^#\/c\/(\d+)$/))) return ['store', store(+m[1])];
  if (h === '#/store') return ['store', store(null)];
  if (h === '#/topup') return ['topup', topup()];
  if (h === '#/account') return ['account', account()];
  if (h === '#/login' || h === '#/register') return ['auth', ME ? (location.hash = '#/account', '') : authPage(h.slice(2))];
  return ['home', home()];
}
function render() {
  if (!D) return;
  document.documentElement.style.setProperty('--red', D.site.red);
  document.title = `${D.site.name} ${D.site.name2}`;
  const [r, body] = route();
  $('#app').innerHTML = `<div class="wrap">${nav(r)}${body}<footer>${esc(D.site.footer)}</footer></div>`;
}
window.addEventListener('hashchange', () => { qty = 1; q = ''; tab = 0; promo = false; if (location.hash === '#/account') ACC = null; render(); scrollTo(0, 0); });

// ---------- เหตุการณ์ ----------
document.addEventListener('input', (e) => {
  if (e.target.id === 'q') { q = e.target.value; const m = location.hash.match(/^#\/c\/(\d+)$/); $('#res').innerHTML = results(m ? +m[1] : null); }
  if (e.target.id === 'slip') { const f = e.target.files[0]; $('#dz').innerHTML = f ? '✔ ' + esc(f.name) : '⬆<br>คลิกเพื่อแนบสลิปโอนเงิน'; }
});
document.addEventListener('click', async (e) => {
  const go = e.target.closest('[data-go]'); if (go) { location.hash = '#/p/' + go.dataset.go; return; }
  const ct = e.target.closest('[data-cat]'); if (ct) { location.hash = '#/c/' + ct.dataset.cat; return; }
  const a = e.target.closest('[data-a]'); if (!a) return;
  const k = a.dataset.a;
  if (k === 'qm') { qty = Math.max(1, qty - 1); render(); }
  if (k === 'qp') { qty = Math.min(20, qty + 1); render(); }
  if (k === 'tab') { tab = +a.dataset.i; render(); }
  if (k === 'copy') navigator.clipboard?.writeText(a.dataset.v).then(() => toast('คัดลอกแล้ว'), () => toast('คัดลอกไม่ได้'));
  if (k === 'search') setTimeout(() => $('#q')?.focus(), 50);
  if (k === 'logout') { await api('/logout', { method: 'POST' }); ME = null; ACC = null; location.hash = '#/'; render(); }
  if (k === 'order') {
    if (!ME) { toast('กรุณาเข้าสู่ระบบก่อนสั่งซื้อ'); location.hash = '#/login'; return; }
    const p = D.products.find((x) => x.id === +a.dataset.id);
    if (!confirm(`ยืนยันสั่งซื้อ ${p.name} ×${qty} ราคา ${baht(p.price * qty)} ?`)) return;
    a.setAttribute('aria-disabled', 'true');
    try { const r = await api('/order', { method: 'POST', json: { product_id: p.id, qty } }); ME.balance = r.balance; ACC = null; await load(); toast('สั่งซื้อสำเร็จ'); location.hash = '#/account'; }
    catch (err) { toast(err.message); a.removeAttribute('aria-disabled'); }
  }
});
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, err = $('#err'), btn = f.querySelector('button[type=submit],button:not([type])'), fd = new FormData(f);
  const fail = (m) => { if (err) err.textContent = m; btn && (btn.disabled = false); };
  if (err) err.textContent = ''; btn && (btn.disabled = true);
  try {
    if (f.id === 'authf') {
      const reg = f.dataset.mode === 'register';
      if (reg && fd.get('password') !== fd.get('password2')) return fail('รหัสผ่านไม่ตรงกัน');
      await api('/' + (reg ? 'register' : 'login'), { method: 'POST', json: Object.fromEntries(fd) });
      await load(); location.hash = '#/'; toast(reg ? 'สมัครสมาชิกสำเร็จ ยินดีต้อนรับ!' : 'เข้าสู่ระบบสำเร็จ'); render();
    } else if (f.id === 'topf') {
      fd.set('method', f.dataset.method);
      await api('/topup', { method: 'POST', form: fd });
      toast('ส่งสลิปแล้ว รอแอดมินตรวจสอบ'); ACC = null; location.hash = '#/account';
    } else if (f.id === 'pwf') {
      await api('/password', { method: 'POST', json: Object.fromEntries(fd) }); f.reset(); toast('เปลี่ยนรหัสผ่านแล้ว'); btn.disabled = false;
    }
  } catch (x) { fail(x.message); }
});
load().then(render).catch(() => { $('#app').innerHTML = '<p style="padding:40px;text-align:center">โหลดข้อมูลไม่สำเร็จ กรุณารีเฟรชหน้า</p>'; });
