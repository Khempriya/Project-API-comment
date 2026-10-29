// ============================================================================
// ไฟล์: src/gym-service/server.js — "ปุ่มสตาร์ท" ของ gym-service (พอร์ต 4001)
// ============================================================================
// รันโดย: `npm run start:gym` หรือถูก spawn โดย src/start-all.js
// บริการนี้รับ request จาก Gateway (และจาก subscription-service) เท่านั้น ไม่ได้ถูกเบราว์เซอร์เรียกตรง

// โหลด .env ก่อน (ต้องมาก่อน require("./app") เพราะ app.js -> shared/db.js อ่าน DB_* ตอนสร้าง pool)
require("dotenv").config();

// โหลดแอป Express ของ gym-service (routes ใน gym-service/app.js)
const app = require("./app");

// พอร์ตมาจาก .env GYM_SERVICE_PORT (ค่าเริ่มต้น 4001) — ต้องตรงกับ GYM_SERVICE_URL ที่ Gateway ใช้ส่งต่อ
const PORT = Number(process.env.GYM_SERVICE_PORT || 4001);

// เปิดรับ request
app.listen(PORT, () => {
  console.log(`gym-service running on port ${PORT}`);
});
