// ============================================================================
// 📘 ไฟล์ทดสอบ: src/tests/db.test.js
// ============================================================================
// ทดสอบโค้ดของ : src/shared/db.js
// ทดสอบอะไร    : ไม่ผูกกับปุ่มใดโดยตรง — ตรวจว่า pool เชื่อม MySQL ด้วยค่า DB_* จาก env และใช้ charset utf8mb4 (ทุกปุ่มที่ต้องใช้ฐานข้อมูลพึ่งไฟล์นี้)
// รันด้วย      : `npm test` (jest)  — ไฟล์เทสต์ "ไม่ได้ถูกใช้ตอนหน้าเว็บทำงานจริง" เป็นเพียงตัวตรวจสอบคุณภาพ
// ============================================================================
// ทดสอบว่า shared/db.js สร้าง connection pool จากค่าใน .env (mock mysql2 ไม่ต้องต่อ MySQL จริง)
jest.mock("mysql2/promise", () => ({
  createPool: jest.fn(() => ({ query: jest.fn() })),
}));

process.env.DB_HOST = "db-host";
process.env.DB_USER = "db-user";
process.env.DB_PASSWORD = "db-pass";
process.env.DB_NAME = "fitness_db";

const mysql = require("mysql2/promise");
const pool = require("../shared/db");

describe("shared/db", () => {
  it("สร้าง pool ด้วยค่าจาก env และใช้ charset utf8mb4", () => {
    expect(mysql.createPool).toHaveBeenCalledTimes(1);
    expect(mysql.createPool).toHaveBeenCalledWith({
      host: "db-host",
      user: "db-user",
      password: "db-pass",
      database: "fitness_db",
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      charset: "utf8mb4",
    });
  });

  it("ส่งออก pool ที่เรียก query ได้", () => {
    expect(typeof pool.query).toBe("function");
  });
});
