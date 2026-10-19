# HEX STORE — ร้านค้าออนไลน์ (สมัคร/ล็อกอินในเว็บเอง + หลังบ้านแยกลิงก์)

## มีอะไรบ้าง
**หน้าร้าน** (`https://โดเมนคุณ/`)
- สมัครสมาชิก / เข้าสู่ระบบด้วยชื่อผู้ใช้ + รหัสผ่าน (เก็บแบบเข้ารหัส bcrypt)
- หน้าหลัก, ร้านค้า (หมวดหมู่ + ค้นหา), หน้าสินค้า, เติมเงิน (แนบสลิป), บัญชีของฉัน (ประวัติซื้อ/เติมเงิน/เปลี่ยนรหัสผ่าน)
- สั่งซื้อด้วยยอดเงินในบัญชี ตัดเงินและส่งของอัตโนมัติ (ถ้าตั้งสต็อกไว้)

**หลังบ้าน** (`https://โดเมนคุณ/admin/` — เปลี่ยนชื่อลิงก์ได้ด้วย `ADMIN_PATH`)
- แดชบอร์ด, สินค้า (ราคา รูป คำบรรยาย หมวด สต็อก), หมวดหมู่/แบนเนอร์, ออเดอร์ (ส่งของ/คืนเงิน)
- ตรวจสลิปเติมเงิน (อนุมัติ/ไม่อนุมัติ แก้ยอดได้), สมาชิก (ปรับยอด รีเซ็ตรหัส ระงับ ตั้งแอดมิน)
- ตั้งค่าเว็บ: ชื่อร้าน โลโก้ สี แบนเนอร์ ข้อความทุกส่วน ช่องทางเติมเงิน/QR

## ทดลองในเครื่อง (ต้องมี Node.js 22.13 ขึ้นไป หรือ 24 — ไม่ต้องติดตั้ง Python)
```bash
npm install
cp .env.example .env      # แก้ ADMIN_USERNAME / ADMIN_PASSWORD (ลบบรรทัด NODE_ENV/TRUST_PROXY ถ้าทดลองในเครื่อง)
npm start                 # เปิด http://localhost:3000   หลังบ้าน http://localhost:3000/admin/
npm test                  # รันชุดทดสอบระบบ
```
สร้าง/รีเซ็ตแอดมินภายหลัง: `node scripts/create-admin.js ชื่อผู้ใช้ รหัสผ่าน`

## นำขึ้นออนไลน์เป็น .com (VPS Ubuntu เช่น DigitalOcean/Vultr/Contabo หรือโฮสต์ไทย)
1. **ซื้อโดเมน** (Namecheap/GoDaddy/Cloudflare) แล้วตั้ง DNS: เรคคอร์ด `A` ชี้ `@` และ `www` ไปที่ IP ของ VPS
2. **ติดตั้งบน VPS**
   ```bash
   sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx curl build-essential
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
   sudo npm i -g pm2
   # อัปโหลดโฟลเดอร์โปรเจกต์นี้ไปที่ /opt/hexstore (scp/sftp/git) แล้ว
   cd /opt/hexstore && npm ci --omit=dev
   cp .env.example .env && nano .env        # ตั้งรหัสแอดมิน + DATA_DIR=/var/lib/hexstore
   sudo mkdir -p /var/lib/hexstore && sudo chown $USER /var/lib/hexstore
   pm2 start ecosystem.config.js && pm2 save && pm2 startup
   ```
3. **nginx** — สร้าง `/etc/nginx/sites-available/hexstore`:
   ```nginx
   server {
     server_name โดเมนคุณ.com www.โดเมนคุณ.com;
     client_max_body_size 8m;
     location / {
       proxy_pass http://127.0.0.1:3000;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $remote_addr;
       proxy_set_header X-Forwarded-Proto $scheme;
     }
   }
   ```
   `sudo ln -s /etc/nginx/sites-available/hexstore /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx`
4. **เปิด https ฟรี:** `sudo certbot --nginx -d โดเมนคุณ.com -d www.โดเมนคุณ.com`
5. เข้า `https://โดเมนคุณ.com/admin/` ล็อกอินด้วย ADMIN_USERNAME/ADMIN_PASSWORD → ไปที่ **ตั้งค่าเว็บ** ใส่ชื่อร้าน โลโก้ ช่องทางเติมเงิน และรูป QR ของคุณเอง → เพิ่มสินค้า

## ข้อควรทำก่อนเปิดจริง
- **Backup โฟลเดอร์ data** (ฐานข้อมูล `hexstore.db` + รูป + สลิป) เป็นประจำ เช่น cron สำเนาไปที่อื่นทุกวัน
- ตั้ง `ADMIN_PATH` เป็นชื่อที่เดายาก และใช้รหัสแอดมินยาวๆ
- เปิดไฟร์วอลล์ให้เหลือแค่พอร์ต 22/80/443 (`sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable`)
- อัปเดตแพ็กเกจเป็นระยะ (`npm audit`, `npm update`)

## การทำงานของเงิน/สต็อก
- ยอดเงินในระบบเป็น "เครดิตภายในร้าน" ลูกค้าโอนเงินเข้าบัญชีคุณ แล้วแนบสลิป → แอดมินตรวจกับบัญชีจริง → อนุมัติ ระบบจึงเพิ่มเครดิต (กดอนุมัติซ้ำไม่ได้)
- ระบบ **ไม่ได้ตรวจสลิปอัตโนมัติ** และไม่ได้ต่อ payment gateway ถ้าต้องการเติมอัตโนมัติ ต้องสมัครบริการรับชำระเงินที่ถูกกฎหมายแล้วเชื่อม API เพิ่ม
- สินค้า "ส่งของอัตโนมัติ": เพิ่มสต็อกบรรทัดละ 1 ชิ้น ระบบส่งให้ทันทีที่ซื้อ / "แมนนวล": ออเดอร์ขึ้นสถานะรอ แอดมินกด "ส่งของ" แล้วใส่ข้อมูลให้ลูกค้า
- สินค้าจะอยู่ในหมวดไหน เลือกจากช่อง "หมวดหมู่" ในฟอร์มสินค้า

## ความรับผิดชอบของผู้ขาย
คุณเป็นผู้ดำเนินกิจการ ต้องขายเฉพาะสินค้า/บริการที่ถูกกฎหมายและไม่ละเมิดข้อกำหนดของแพลตฟอร์มเกมหรือผู้พัฒนา และดูแลข้อมูลส่วนบุคคลของสมาชิกตามกฎหมาย (PDPA) รวมถึงภาษีและการจดทะเบียนตามที่เกี่ยวข้อง

## โครงสร้างไฟล์
`server.js` (API + ความปลอดภัย) · `lib/db.js` (ฐานข้อมูล SQLite + ค่าเริ่มต้น) · `public/` (หน้าร้าน) · `admin/` (หลังบ้าน) · `scripts/` (สร้างแอดมิน/ทดสอบ) · `data/` (ข้อมูลจริง สร้างอัตโนมัติ — ห้ามลบ)
