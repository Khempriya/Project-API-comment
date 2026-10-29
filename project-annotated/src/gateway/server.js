// ============================================================================
// ไฟล์: src/gateway/server.js — "ปุ่มสตาร์ท" ของ API Gateway (พอร์ต 3000)
// ============================================================================
// แยกจาก app.js เพื่อให้ app.js ส่งออกแอปโดยไม่ listen (ทดสอบด้วย Supertest ได้)
// ไฟล์นี้ถูกรันโดย: `npm run start:gateway` หรือถูก spawn โดย src/start-all.js (`npm start`)
// เมื่อรันเสร็จ เปิดเบราว์เซอร์ที่ http://localhost:3000/ จะได้หน้าเว็บ (FLOW-00)

// โหลดไฟล์ .env เข้า process.env (DB_*, *_SERVICE_URL, GATEWAY_TIMEOUT_MS, PORT ...)
// ต้องเรียกก่อน require("./app") เพื่อให้ค่าพร้อมใช้
require("dotenv").config();

// โหลดแอป Express ของ Gateway (ตัวที่มี routing /api/v1/... ใน gateway/app.js)
const app = require("./app");

// พอร์ตของ Gateway: อ่านจาก .env PORT ถ้าไม่ตั้งใช้ 3000
// (frontend/app.js ฝั่งหน้าเว็บอ้างพอร์ต 3000 นี้ในกรณีเปิดไฟล์ตรง file://)
const PORT = process.env.PORT || 3000;

// เปิดรับ request — บรรทัดนี้คือจุดที่ Gateway "พร้อมให้เบราว์เซอร์เรียก"
app.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT} (${process.env.NODE_ENV})`);
  console.log(`หน้าเว็บ:   http://localhost:${PORT}/`);
  console.log(`Swagger UI: http://localhost:${PORT}/api-docs`);
});
