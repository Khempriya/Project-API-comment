# แผนที่การทำงาน: กดปุ่มบนหน้าเว็บ → โค้ดบรรทัดไหน → ดึงข้อมูลจากไหน

เอกสารนี้สรุปคอมเม้นที่เขียนทับในโค้ด ใช้คู่กับแท็ก `FLOW-xx` (ค้นหาข้อความ `FLOW-03` ในทุกไฟล์เพื่อตามเส้นทางครบ)
เลขบรรทัดคือของไฟล์ที่ใส่คอมเม้นแล้ว ถ้าแก้ไฟล์เลขจะเลื่อน ให้ค้นหาด้วยแท็ก FLOW แทน

## ภาพรวมสถาปัตยกรรม

```
เบราว์เซอร์ (frontend/index.html + app.js)
        │  fetch /api/v1/...                       ← frontend/app.js บรรทัด 81 (ฟังก์ชัน api, บรรทัด 67)
        ▼
API Gateway :3000  (src/gateway/app.js)
        │  createProxy ตัด "/api/v1" แล้วส่งต่อ     ← gateway/app.js บรรทัด 89-131, ยิงจริงที่บรรทัด 114
        ├──► gym-service          :4001 ─┐
        ├──► member-service       :4002 ─┼──► MySQL fitness_db (src/shared/db.js → ตาราง gyms / members / subscriptions)
        └──► subscription-service :4003 ─┘
                     └─ ถาม member-service และ gym-service ผ่าน HTTP ก่อนบันทึก (ensureExists, subscription-service/app.js บรรทัด 73)
gym-service ─► Open-Meteo (อินเทอร์เน็ต) ผ่าน weather.js → shared/external-api.js   (เฉพาะปุ่ม "ดูสภาพอากาศ")
```

ตารางเส้นทางใน Gateway: `/api/v1/gyms` → บรรทัด 213 · `/api/v1/members` → 219 · `/api/v1/subscriptions` → 225 ·
`/health` → 179 · Swagger → 152 · เสิร์ฟหน้าเว็บ → 174

## แผนที่ปุ่ม → โค้ด (ทุกปุ่มบนหน้าเว็บ)

ย่อ: **FE** = frontend/app.js · **GW** = src/gateway/app.js · **GYM** = src/gym-service/app.js · **MEM** = src/member-service/app.js · **SUB** = src/subscription-service/app.js

| FLOW | ปุ่ม / เหตุการณ์ | FE (ฟังก์ชัน : บรรทัดที่ยิง API) | HTTP ที่ยิง | Service route (บรรทัด) | SQL / ปลายทางข้อมูล (บรรทัด) |
|---|---|---|---|---|---|
| 00 | เปิดหน้าเว็บ | บรรทัดท้ายไฟล์ 909-916 | `GET /`, `styles.css`, `app.js` | GW `express.static` 174 | ไฟล์ในโฟลเดอร์ `frontend/` |
| 01 | แถบสถานะระบบ (อัตโนมัติ ทุก 15 วิ) | `loadHealth` 249 : 252 | `GET /health` | GW `app.get("/health")` 179 → ถาม `/health` ของ 3 บริการ (GYM 53, MEM 35, SUB 93) | ไม่มี SQL |
| 02 | โหลดสาขา / ปุ่ม "โหลดใหม่" | `loadGyms` 282 : 288 (ปุ่ม 493) | `GET /api/v1/gyms` | GYM `app.get("/gyms")` 61 | `SELECT … FROM gyms` 65 |
| 03 | ปุ่ม "ดูสภาพอากาศ" | `showWeather` 340 : 347 | `GET /api/v1/gyms/:id/weather` | GYM 107 | `SELECT gym_id,name FROM gyms` 111 → `getWeatherForLocation()` 119 → `weather.js` 89 → `external-api.js fetchJsonWithRetry` 110 → Open-Meteo |
| 04 | "บันทึกสาขา" (โหมดเพิ่ม) | submit `gym-form` 466 : 476 | `POST /api/v1/gyms` | GYM 138 | `INSERT INTO gyms` 143 |
| 05 | "แก้ไข" สาขา → "บันทึกการแก้ไข" | `startEditGym` 432 (ไม่ยิง API) → submit 466 : 475 | `PUT /api/v1/gyms/:id` | GYM 164 | `SELECT` เช็ค 169 → `UPDATE gyms` 175 |
| 06 | "ลบ" สาขา | `deleteGym` 377 : 384 | `DELETE /api/v1/gyms/:id` | GYM 192 | `DELETE FROM gyms` 197 (+ CASCADE ลบ subscriptions) |
| 07 | โหลดสมาชิก / "โหลดใหม่" | `loadMembers` 504 : 510 (ปุ่ม 656) | `GET /api/v1/members` | MEM 43 | `SELECT … FROM members` 46 |
| 08 | "ลงทะเบียน" | submit `member-form` 621 : 634 | `POST /api/v1/members` | MEM 85 | `INSERT INTO members` 92 (อีเมลซ้ำ → 409) |
| 09 | "แก้ไข" สมาชิก → "บันทึกการแก้ไข" | `startEditMember` 568 (ไม่ยิง API) → submit 621 : 633 | `PUT /api/v1/members/:id` | MEM 125 | `SELECT` เช็ค 130 → `UPDATE members` 137 |
| 10 | "ลบ" สมาชิก | `deleteMember` 601 : 608 | `DELETE /api/v1/members/:id` | MEM 161 | `DELETE FROM members` 165 (+ CASCADE) |
| 11 | โหลดการสมัคร / "ค้นหา" / "ล้าง" | `loadSubscriptions` 852 : 862 (ค้นหา 899, ล้าง 904) | `GET /api/v1/subscriptions?member_name=…` | SUB 171 | `SELECT … JOIN members JOIN gyms [WHERE m.name LIKE ?]` 190-207 |
| 12 | "บันทึกการสมัคร" | submit `sub-form` 820 : 830 | `POST /api/v1/subscriptions` | SUB 104 | ถาม MEM `GET /members/:id` (115) → ถาม GYM `GET /gyms/:id` (123) → `INSERT INTO subscriptions` 134 → `SELECT` 140 |
| 13 | "แก้ไข" การสมัคร → "บันทึกการแก้ไข" | `startEditSubscription` 754 (ไม่ยิง API) → submit 820 : 829 | `PUT /api/v1/subscriptions/:id` | SUB 231 | `SELECT` เช็ค 239 → ถาม GYM (246) → `UPDATE` 254 → `SELECT` 270 |
| 14 | "ลบ" การสมัคร | `deleteSubscription` 795 : 802 | `DELETE /api/v1/subscriptions/:id` | SUB 287 | `DELETE FROM subscriptions` 291 |
| 15 | dropdown สมาชิก/สาขาในฟอร์มสมัคร | `fillSelect` 662, `fillMemberSelect` 681, `fillGymSelect` 690 | ไม่ยิงเอง ใช้ผลของ FLOW-07 และ FLOW-02 | – | – |
| 16 | สลับแท็บ | ตัวจัดการ `.tab` 228 | ไม่ยิง API | – | – |
| 17 | ลิงก์ Swagger UI (footer) | ลิงก์ `<a>` ใน index.html | `GET /api-docs/` | GW 152 | อ่าน `openapi.yaml` |

## จุดที่ทุกเส้นทางใช้ร่วมกัน

| สิ่งที่ทำ | ไฟล์ : บรรทัด |
|---|---|
| ตรวจ `:id` ใน URL | `shared/validators.js` `parseId` |
| ตรวจ body สาขา / สมาชิก / การสมัคร / แก้ไขการสมัคร | `shared/validators.js` `validateGymBody` / `validateMemberBody` / `validateSubscriptionBody` / `validateSubscriptionUpdateBody` |
| แปลง error เป็น JSON `{error:{code,message}}` | `shared/errors.js` `errorHandler` |
| เปิด connection MySQL (pool) | `shared/db.js` (ค่าจาก `.env` DB_*) |
| timeout + retry ตอนเรียกบริการอื่น / API ภายนอก | `shared/external-api.js` `fetchJsonWithRetry` |
| เปิดทุกบริการพร้อมกัน (`npm start`) | `src/start-all.js` |

## ข้อสังเกตที่พบระหว่างอ่านโค้ด (ไม่ได้แก้โค้ดให้)

1. **สภาพอากาศใช้พิกัดเดียวทั้งระบบ** (`WEATHER_LAT/LON` ใน `.env` ค่าเริ่มต้นคือบางแสน) ตาราง `gyms` ไม่มีพิกัดแยกสาขา กดดูอากาศสาขาไหนก็ได้ผลของพิกัดเดียวกัน (`gym-service/weather.js` `getWeatherConfig`)
2. **ปุ่ม "แก้ไข" ทุกตารางไม่ยิง API** ใช้ข้อมูลที่โหลดมาแล้วเติมฟอร์ม API ถูกยิงตอนกดบันทึกเท่านั้น
3. **การสมัครแพ็กเกจพึ่งอีก 2 บริการ** ถ้า member-service หรือ gym-service ล่ม ปุ่ม "บันทึกการสมัคร" จะได้ 503 `DEPENDENCY_UNAVAILABLE` ทั้งที่ฐานข้อมูลปกติ แต่ปุ่ม "ค้นหา/โหลดประวัติ" ยังใช้ได้เพราะอ่านด้วย SQL JOIN ตรง
4. **`.env` ไม่ได้ตั้ง `ALLOWED_ORIGIN`** แพ็กเกจ cors จึงอนุญาตทุก origin
5. **ไม่มีระบบล็อกอิน/สิทธิ์** ป้าย "(ผู้ดูแลระบบ)" และ "(พนักงาน)" บนหน้าเว็บเป็นแค่ข้อความ ใครเรียก API ก็ลบหรือแก้ได้ทั้งหมด
6. **รหัสผ่านฐานข้อมูลอยู่ในไฟล์ `.env`** ที่อยู่ใน zip ควรเอาออกก่อนส่งงานหรือแชร์
