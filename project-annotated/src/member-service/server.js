// ============================================================================
// ไฟล์: src/member-service/server.js — "ปุ่มสตาร์ท" ของ member-service (พอร์ต 4002)
// ============================================================================
// รันโดย: `npm run start:member` หรือถูก spawn โดย src/start-all.js
// รับ request จาก Gateway (แท็บสมาชิก) และจาก subscription-service (ตรวจว่าสมาชิกมีจริง)

// โหลด .env ก่อน (ต้องมาก่อน require("./app") เพราะ shared/db.js อ่าน DB_* ตอนสร้าง pool)
require("dotenv").config();

// โหลดแอป Express ของ member-service (routes ใน member-service/app.js)
const app = require("./app");

// พอร์ตมาจาก .env MEMBER_SERVICE_PORT (ค่าเริ่มต้น 4002) — ต้องตรงกับ MEMBER_SERVICE_URL ที่ Gateway ใช้
const PORT = Number(process.env.MEMBER_SERVICE_PORT || 4002);

// เปิดรับ request
app.listen(PORT, () => {
  console.log(`member-service running on port ${PORT}`);
});
