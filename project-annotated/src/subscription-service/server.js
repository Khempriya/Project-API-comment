// ============================================================================
// ไฟล์: src/subscription-service/server.js — "ปุ่มสตาร์ท" ของ subscription-service (พอร์ต 4003)
// ============================================================================
// รันโดย: `npm run start:subscription` หรือถูก spawn โดย src/start-all.js
// รับ request จาก Gateway (แท็บการสมัครแพ็กเกจ) — และเป็นฝ่าย "ยิงไปหา" gym/member-service เอง

// โหลด .env ก่อน (ต้องมาก่อน require("./app") เพราะ shared/db.js อ่าน DB_* ตอนสร้าง pool)
require("dotenv").config();

// โหลดแอป Express ของ subscription-service (routes ใน subscription-service/app.js)
const app = require("./app");

// พอร์ตมาจาก .env SUBSCRIPTION_SERVICE_PORT (ค่าเริ่มต้น 4003) — ต้องตรงกับ SUBSCRIPTION_SERVICE_URL ที่ Gateway ใช้
const PORT = Number(process.env.SUBSCRIPTION_SERVICE_PORT || 4003);

// เปิดรับ request
app.listen(PORT, () => {
  console.log(`subscription-service running on port ${PORT}`);
});
