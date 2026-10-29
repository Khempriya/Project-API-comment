// member-service: ดูแลทรัพยากร members (Bounded Context "สมาชิก")
// รันเป็น process แยก (พอร์ต 4002) และถูกเรียกผ่าน API Gateway หรือจาก subscription-service

// ============================================================================
// 📘 คำอธิบายไฟล์ src/member-service/app.js — Back end ของแท็บ "สมาชิก"
// ============================================================================
//  ปุ่ม/การกระทำใน frontend                          | Route (หลัง Gateway ตัด /api/v1) | SQL (ตาราง members)
//  -------------------------------------------------|---------------------------------|----------------------------
//  FLOW-07 เปิดหน้า / ปุ่ม "โหลดใหม่" (สมาชิก)         | GET    /members                 | SELECT ... ORDER BY member_id
//  FLOW-08 ปุ่ม "ลงทะเบียน" (โหมดเพิ่ม)                | POST   /members                 | INSERT INTO members
//  FLOW-09 ปุ่ม "บันทึกการแก้ไข" (โหมดแก้ไข)           | PUT    /members/:id             | SELECT เช็คมีอยู่ + UPDATE
//  FLOW-10 ปุ่ม "ลบ" (สมาชิก)                          | DELETE /members/:id             | DELETE FROM members (CASCADE)
//  (ไม่ใช่ปุ่ม) subscription-service ตรวจสมาชิก         | GET    /members/:id             | SELECT ... WHERE member_id=?
//  FLOW-01 แถบสถานะระบบ                               | GET    /health                  | (ไม่มี SQL)
//
// เส้นทางข้อมูลทุก route:  frontend/app.js > api() -> Gateway (createProxy("member"))
//                         -> ไฟล์นี้ -> shared/db.js (pool) -> MySQL ตาราง members
// ============================================================================
const express = require("express");
// pool = ตัวเชื่อมฐานข้อมูล MySQL (src/shared/db.js)
const pool = require("../shared/db");
const {
  HttpError,
  notFoundHandler,
  errorHandler,
} = require("../shared/errors");
// parseId = ตรวจ :id / validateMemberBody = ตรวจ body ชื่อ+อีเมล (shared/validators.js)
const { parseId, validateMemberBody } = require("../shared/validators");

const app = express();
// อ่าน JSON body -> req.body (จำกัด 10kb)
app.use(express.json({ limit: "10kb" }));

// FLOW-01 (ขั้นสุดท้าย): Gateway ถามสถานะของ member-service ผ่าน route นี้
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", service: "member-service" });
});

// รายชื่อสมาชิก (ใช้เลือกสมาชิกตอนบันทึกการสมัคร UC2)
// ▶ FLOW-07  ปลายทางของ frontend/app.js > loadMembers() (เรียกตอนเปิดหน้า และเมื่อกด "โหลดใหม่" id="members-refresh")
//   เส้นทาง: loadMembers -> api("/members") -> GET /api/v1/members -> Gateway -> GET /members (ที่นี่)
//   ข้อมูลที่ได้ใช้ 2 ที่: (1) วาดตาราง "รายชื่อสมาชิก" (2) เติม dropdown "สมาชิก" ในฟอร์มการสมัคร (FLOW-15)
app.get("/members", async (req, res, next) => {
  try {
    // 🗄 SELECT สมาชิกทั้งหมดจากตาราง members
    const [rows] = await pool.query(
      "SELECT member_id, name, email FROM members ORDER BY member_id",
    );
    res.status(200).json({
      message: rows.length
        ? "ดึงข้อมูลสมาชิกสำเร็จ"
        : "ยังไม่มีข้อมูลสมาชิก",
      data: rows, // -> frontend: const { data } = await api("/members") แล้ว data.forEach(...) สร้างแถวตาราง
    });
  } catch (err) {
    next(err);
  }
});

// ใช้โดย subscription-service เพื่อตรวจว่าสมาชิกมีอยู่จริงก่อนบันทึกการสมัคร
// ⚠ หน้าเว็บไม่ได้เรียกโดยตรง: subscription-service > ensureExists() ยิง GET http://localhost:4002/members/:id
//   ตอน FLOW-12 (กด "บันทึกการสมัคร") — ถ้าที่นี่ตอบ 404 subscription-service จะตอบ 404 MEMBER_NOT_FOUND กลับไปที่หน้าเว็บ
app.get("/members/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    // 🗄 SELECT สมาชิก 1 คนตามรหัส
    const [rows] = await pool.query(
      "SELECT member_id, name, email FROM members WHERE member_id = ?",
      [id],
    );
    if (!rows.length) {
      throw new HttpError(404, "MEMBER_NOT_FOUND", "ไม่พบสมาชิกที่ระบุ");
    }
    res.status(200).json({ message: "ดึงข้อมูลสมาชิกสำเร็จ", data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// UC1: ลงทะเบียนสมาชิกใหม่
// ▶ FLOW-08  ปลายทางของฟอร์ม <form id="member-form"> (โหมดเพิ่ม) เมื่อกดปุ่ม "ลงทะเบียน"
//   เส้นทาง: submit -> validateMemberForm() -> api("/members",{method:"POST",body:{name,email}})
//            -> Gateway -> POST /members (ที่นี่)
//   หลังสำเร็จ frontend: toast(res.message) + reset ฟอร์ม + loadMembers()
app.post("/members", async (req, res, next) => {
  try {
    // ตรวจชื่อ/รูปแบบอีเมล (ไม่ผ่าน -> 400 VALIDATION_ERROR)
    const member = validateMemberBody(req.body);
    // try/catch ซ้อนใน: เพื่อดัก error "เฉพาะของฐานข้อมูล" (อีเมลซ้ำ) แยกจาก error ทั่วไป
    try {
      // 🗄 INSERT สมาชิกใหม่ลงตาราง members (member_id เป็น AUTO_INCREMENT)
      const [result] = await pool.query(
        "INSERT INTO members (name, email) VALUES (?, ?)",
        [member.name, member.email],
      );
      res.status(201).json({
        message: "ลงทะเบียนสมาชิกสำเร็จ",
        data: { member_id: result.insertId, ...member },
      });
    } catch (dbErr) {
      // UNIQUE(email) กันอีเมลซ้ำ แม้มีสอง request พร้อมกัน
      // schema.sql: email VARCHAR(150) NOT NULL UNIQUE -> MySQL โยน ER_DUP_ENTRY
      // -> เรา throw 409 DUPLICATE_EMAIL -> frontend จับ err.code === "DUPLICATE_EMAIL"
      //    แล้วแสดงข้อความแดงใต้ช่องอีเมล (setFieldError("member-email", ...)) + toast
      if (dbErr.code === "ER_DUP_ENTRY") {
        throw new HttpError(409, "DUPLICATE_EMAIL", "อีเมลนี้มีอยู่ในระบบแล้ว");
      }
      throw dbErr; // error ฐานข้อมูลอื่น -> โยนต่อให้ catch ด้านนอก -> 500
    }
  } catch (err) {
    next(err);
  }
});

// ตัวสร้าง error 404 "ไม่พบสมาชิก" ใช้ใน PUT และ DELETE ด้านล่าง
const memberNotFound = () =>
  new HttpError(404, "MEMBER_NOT_FOUND", "ไม่พบสมาชิกที่ระบุ");

// แก้ไขข้อมูลสมาชิก (แทนที่ทั้งรายการ ต้องส่งครบทุกฟิลด์)
// ▶ FLOW-09  ปลายทางของ member-form ใน "โหมดแก้ไข" (กดปุ่ม "แก้ไข" ที่แถวสมาชิก -> startEditMember() เติมฟอร์ม ไม่เรียก API)
//   แล้วกดปุ่ม "บันทึกการแก้ไข" -> api(`/members/${editingMemberId}`,{method:"PUT",body})
//   -> Gateway -> PUT /members/:id (ที่นี่)
//   หลังสำเร็จ frontend: toast + cancelEditMember() + loadMembers() + loadSubscriptions()
//   (โหลดการสมัครด้วย เพราะตารางการสมัครแสดงชื่อสมาชิก)
app.put("/members/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const member = validateMemberBody(req.body);
    // 🗄 ขั้น 1: SELECT เช็คว่ามีสมาชิกนี้อยู่จริง
    const [exists] = await pool.query(
      "SELECT member_id FROM members WHERE member_id = ?",
      [id],
    );
    if (!exists.length) throw memberNotFound();
    try {
      // 🗄 ขั้น 2: UPDATE ชื่อ+อีเมล
      await pool.query(
        "UPDATE members SET name = ?, email = ? WHERE member_id = ?",
        [member.name, member.email, id],
      );
    } catch (dbErr) {
      // เปลี่ยนอีเมลไปซ้ำกับสมาชิกคนอื่น -> UNIQUE ชน -> 409 (หน้าเว็บแสดงใต้ช่องอีเมลเช่นเดียวกับตอนเพิ่ม)
      if (dbErr.code === "ER_DUP_ENTRY") {
        throw new HttpError(409, "DUPLICATE_EMAIL", "อีเมลนี้มีอยู่ในระบบแล้ว");
      }
      throw dbErr;
    }
    res.status(200).json({
      message: "อัปเดตข้อมูลสมาชิกสำเร็จ",
      data: { member_id: id, ...member },
    });
  } catch (err) {
    next(err);
  }
});

// ลบสมาชิก -> ประวัติการสมัครของสมาชิกคนนั้นถูกลบด้วย (ON DELETE CASCADE ในฐานข้อมูล)
// ▶ FLOW-10  ปลายทางของปุ่ม "ลบ" ที่แถวสมาชิก -> frontend/app.js > deleteMember()
//   (ถาม window.confirm ก่อน) -> api(`/members/${member.member_id}`,{method:"DELETE"})
//   -> Gateway -> DELETE /members/:id (ที่นี่) -> หน้าเว็บ loadMembers() + loadSubscriptions() ใหม่
app.delete("/members/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    // 🗄 DELETE สมาชิก — แถวใน subscriptions ของสมาชิกนี้ถูกลบตามด้วย (FOREIGN KEY member_id ... ON DELETE CASCADE ใน schema.sql)
    const [result] = await pool.query(
      "DELETE FROM members WHERE member_id = ?",
      [id],
    );
    if (result.affectedRows === 0) throw memberNotFound(); // ไม่มีแถวถูกลบ = ไม่มีรหัสนี้ -> 404
    res.status(200).json({
      message: "ลบสมาชิกและประวัติการสมัครที่เกี่ยวข้องสำเร็จ",
    });
  } catch (err) {
    next(err);
  }
});

// route ที่ไม่มี -> 404 / error ทั้งหมดไหลมาจบที่ errorHandler (shared/errors.js)
app.use(notFoundHandler);
app.use(errorHandler);

// ส่งออก app (ไม่ listen) — member-service/server.js เป็นคนเปิดพอร์ต 4002
module.exports = app;
