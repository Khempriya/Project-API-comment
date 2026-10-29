// ============================================================================
// ไฟล์: src/shared/db.js  — "ประตูเดียวสู่ฐานข้อมูล MySQL"
// ============================================================================
// หน้าที่: สร้าง Connection Pool ของ MySQL แล้วส่งออก (module.exports) ให้ไฟล์อื่นใช้
//
// ใครเรียกไฟล์นี้?  (require("../shared/db"))
//   - src/gym-service/app.js           -> ใช้ query ตาราง gyms
//   - src/member-service/app.js        -> ใช้ query ตาราง members
//   - src/subscription-service/app.js  -> ใช้ query ตาราง subscriptions (+ JOIN members, gyms)
//   * src/gateway/app.js "ไม่ใช้" ไฟล์นี้ (Gateway ไม่ยุ่งกับฐานข้อมูลเลย แค่ส่งต่อ request)
//
// สำคัญ: แต่ละ service เป็น "process แยกกัน" (ดู src/start-all.js) ดังนั้น
//   แต่ละ process จะ require ไฟล์นี้ของตัวเอง => ได้ pool เป็นของตัวเอง 3 ก้อน
//   (ก้อนละสูงสุด 10 connection) ที่ชี้ไปยังฐานข้อมูล fitness_db ตัวเดียวกัน
//
// ค่า DB_HOST / DB_USER / DB_PASSWORD / DB_NAME มาจากไฟล์ .env
//   ถูกโหลดเข้า process.env โดย require("dotenv").config() ที่ server.js ของแต่ละ service
//   (server.js เรียก dotenv ก่อน แล้วค่อย require("./app") -> app.js -> require db.js
//    จึงมั่นใจได้ว่า env พร้อมแล้วตอนที่บรรทัด createPool ด้านล่างทำงาน)
// ============================================================================

// mysql2/promise = ไดรเวอร์ MySQL แบบ Promise (ใช้ await ได้)
const mysql = require("mysql2/promise");

// createPool = สร้าง "กลุ่มของ connection" ไว้ใช้ซ้ำ ไม่ต้องเปิด-ปิดการเชื่อมต่อใหม่ทุก request
const pool = mysql.createPool({
  host: process.env.DB_HOST, // เครื่องที่รัน MySQL (.env: DB_HOST=localhost)
  user: process.env.DB_USER, // ชื่อผู้ใช้ MySQL (.env: DB_USER)
  password: process.env.DB_PASSWORD, // รหัสผ่าน MySQL (.env: DB_PASSWORD)
  database: process.env.DB_NAME, // ชื่อฐานข้อมูล = fitness_db (สร้างโดย src/database/schema.sql)
  waitForConnections: true, // ถ้า connection เต็ม ให้ request "รอคิว" แทนที่จะ error ทันที
  connectionLimit: 10, // เปิด connection พร้อมกันได้สูงสุด 10 เส้นต่อ 1 process
  queueLimit: 0, // 0 = คิวรอไม่จำกัดจำนวน
  charset: "utf8mb4", // รองรับภาษาไทยและ emoji ครบ (ต้องตรงกับ schema.sql ที่ใช้ utf8mb4)
});

// ส่งออก pool ทั้งก้อน — ที่อื่นเรียกใช้เป็น  const [rows] = await pool.query("SQL...", [พารามิเตอร์])
//   * SELECT  -> rows = อาร์เรย์ของแถวข้อมูล
//   * INSERT/UPDATE/DELETE -> ตัวแรกเป็นอ็อบเจ็กต์ผลลัพธ์ มี insertId / affectedRows
//   * เครื่องหมาย ? ใน SQL คือ placeholder (prepared-style) ป้องกัน SQL Injection
module.exports = pool;
