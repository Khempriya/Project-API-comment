// subscription-service: ดูแลทรัพยากร subscriptions (Bounded Context "การสมัครแพ็กเกจ")
// รันเป็น process แยก (พอร์ต 4003)
// - ตอนบันทึกการสมัคร: เรียก member-service และ gym-service ผ่าน HTTP (มี timeout + retry
//   ตามหลักการของระยะที่ 2 / Week 11) เพื่อตรวจว่าสมาชิกและสาขามีอยู่จริง
// - ตอนทำรายงาน: JOIN ตาราง members และ gyms ในฐานข้อมูลเดียวกัน (shared database,
//   อ่านอย่างเดียว) ดูข้อแลกเปลี่ยนใน src/README.md

// ============================================================================
// 📘 คำอธิบายไฟล์ src/subscription-service/app.js — Back end ของแท็บ "การสมัครแพ็กเกจ"
// ============================================================================
// บริการนี้ "ซับซ้อนที่สุด" เพราะข้อมูลการสมัครอ้างอิงทั้งสมาชิกและสาขา ซึ่งเป็นของบริการอื่น
// จึงมีข้อมูลมาจาก 2 ทางต่างกัน:
//   (A) ตอนเขียน (สมัคร/แก้ไข): "ถามบริการอื่นผ่าน HTTP" ว่ามีสมาชิก/สาขานี้จริงไหม (ensureExists)
//   (B) ตอนอ่านรายงาน: "JOIN ตารางตรง ๆ ใน MySQL" (อ่านข้อมูลสมาชิก/สาขามาประกอบเป็นแถวเดียว)
//
//  ปุ่ม/การกระทำใน frontend                               | Route                       | SQL / การเรียกอื่น
//  ------------------------------------------------------|----------------------------|---------------------------------------
//  FLOW-11 เปิดหน้า / ปุ่ม "ค้นหา" / "ล้าง"                | GET    /subscriptions[?member_name=] | SELECT ... JOIN members JOIN gyms [WHERE m.name LIKE ?]
//  FLOW-12 ปุ่ม "บันทึกการสมัคร" (โหมดเพิ่ม)               | POST   /subscriptions         | HTTP->member-service, HTTP->gym-service, INSERT, SELECT
//  FLOW-13 ปุ่ม "บันทึกการแก้ไข" (โหมดแก้ไขการสมัคร)        | PUT    /subscriptions/:id     | SELECT เช็คมีอยู่, HTTP->gym-service, UPDATE, SELECT
//  FLOW-14 ปุ่ม "ลบ" (การสมัคร)                            | DELETE /subscriptions/:id     | DELETE FROM subscriptions
//  FLOW-01 แถบสถานะระบบ                                   | GET    /health                | (ไม่มี SQL)
//
// เส้นทางข้อมูลทุก route:  frontend/app.js > api() -> Gateway (createProxy("subscription"))
//                         -> ไฟล์นี้ -> (shared/db.js -> MySQL) และ/หรือ (shared/external-api.js -> service อื่น)
// ============================================================================
const express = require("express");
// pool = ตัวเชื่อมฐานข้อมูล MySQL (src/shared/db.js)
const pool = require("../shared/db");
const {
  HttpError,
  notFoundHandler,
  errorHandler,
} = require("../shared/errors");
// ตัวตรวจข้อมูล: parseId (:id), validateSubscriptionBody (POST), validateSubscriptionUpdateBody (PUT)
const {
  parseId,
  validateSubscriptionBody,
  validateSubscriptionUpdateBody,
} = require("../shared/validators");
// fetchJsonWithRetry = ตัวยิง HTTP ไปบริการอื่น พร้อม timeout/retry (src/shared/external-api.js)
const { fetchJsonWithRetry } = require("../shared/external-api");

const app = express();
// อ่าน JSON body -> req.body (จำกัด 10kb)
app.use(express.json({ limit: "10kb" }));

// ค่าตั้งต้นของการเรียกข้ามบริการ (อ่านตอนเรียกใช้ เพื่อให้ปรับผ่าน .env ได้)
// ที่อยู่ member-service (.env: MEMBER_SERVICE_URL) — ใช้ในการยิงตรวจสมาชิก
function memberServiceUrl() {
  return process.env.MEMBER_SERVICE_URL || "http://localhost:4002";
}
// ที่อยู่ gym-service (.env: GYM_SERVICE_URL) — ใช้ในการยิงตรวจสาขา
function gymServiceUrl() {
  return process.env.GYM_SERVICE_URL || "http://localhost:4001";
}
// ค่า timeout/retry ของการเรียกข้ามบริการ (.env: SERVICE_CALL_*)
//   timeout 2 วินาที / retry 2 ครั้ง / หน่วงเริ่มต้น 200ms  (เร็วกว่าค่าของ Open-Meteo เพราะเป็นบริการในเครื่องเดียวกัน)
function serviceCallOptions() {
  return {
    timeoutMs: Number(process.env.SERVICE_CALL_TIMEOUT_MS || 2000),
    maxRetries: Number(process.env.SERVICE_CALL_MAX_RETRIES ?? 2),
    baseDelayMs: Number(process.env.SERVICE_CALL_BASE_DELAY_MS || 200),
  };
}

// ตรวจว่าทรัพยากรปลายทางมีอยู่จริง:
//  - 200            -> ผ่าน
//  - 404            -> โยน notFound (สมาชิก/สาขาไม่มีจริง)
//  - อย่างอื่น      -> บริการปลายทางไม่พร้อม (หลัง retry ครบแล้ว) ตอบ 503 ที่มีความหมาย
// ★ ใช้ใน FLOW-12 (ตรวจสมาชิก + สาขา) และ FLOW-13 (ตรวจสาขา)
//   พารามิเตอร์: url = ที่อยู่ที่จะยิง GET / notFound = error ที่จะ throw ถ้าได้ 404 / serviceLabel = ชื่อบริการไว้ใส่ข้อความ 503
async function ensureExists(url, notFound, serviceLabel) {
  try {
    // 🌐 ยิง HTTP GET ไปบริการอื่นจริง ๆ (member-service หรือ gym-service) ผ่าน timeout+retry
    //    สำเร็จ (200) = มีอยู่จริง -> ผ่านไปเฉย ๆ (ไม่ได้ใช้ข้อมูลที่ตอบกลับ)
    await fetchJsonWithRetry(url, serviceCallOptions());
  } catch (err) {
    // err.status === 404 มาจาก ExternalApiError (shared/external-api.js) = "ไม่พบจริง ๆ"
    //   -> throw error 404 ที่ผู้เรียกเตรียมไว้ (MEMBER_NOT_FOUND / GYM_NOT_FOUND) 404 ไม่ถูก retry
    if (err && err.status === 404) throw notFound;
    // ทุกกรณีอื่น (บริการล่ม/ช้า/5xx หลัง retry หมด) -> 503 DEPENDENCY_UNAVAILABLE
    //   หน้าเว็บเห็น toast "ไม่สามารถตรวจสอบข้อมูลกับบริการสมาชิก/สาขาได้ในขณะนี้..."
    throw new HttpError(
      503,
      "DEPENDENCY_UNAVAILABLE",
      `ไม่สามารถตรวจสอบข้อมูลกับ${serviceLabel}ได้ในขณะนี้ กรุณาลองใหม่ภายหลัง`,
    );
  }
}

// FLOW-01 (ขั้นสุดท้าย): Gateway ถามสถานะของ subscription-service ผ่าน route นี้
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", service: "subscription-service" });
});

// UC2: บันทึกการสมัครแพ็กเกจ (status = active)
// ▶ FLOW-12  ปลายทางของฟอร์ม <form id="sub-form"> (โหมดเพิ่ม) เมื่อกดปุ่ม "บันทึกการสมัคร"
//   เส้นทาง: submit -> validateSubForm() -> api("/subscriptions",{method:"POST",body:{member_id,gym_id,[start_date]}})
//            -> Gateway -> POST /subscriptions (ที่นี่)
//   ค่า member_id / gym_id มาจาก dropdown ที่เติมไว้ด้วยข้อมูลของ FLOW-07 (สมาชิก) และ FLOW-02 (สาขา)
//   หลังสำเร็จ frontend: toast + reset ฟอร์ม + loadSubscriptions()
//   ลำดับในไฟล์นี้: ตรวจ body -> ถาม member-service -> ถาม gym-service -> INSERT -> SELECT กลับ
app.post("/subscriptions", async (req, res, next) => {
  try {
    // ขั้น 1: ตรวจรูปแบบ body (member_id/gym_id เป็นจำนวนเต็มบวก, start_date ถ้ามีต้องเป็นวันที่จริง)
    //         start_date ที่ไม่ส่งมาจะกลายเป็น null
    const { member_id, gym_id, start_date } = validateSubscriptionBody(
      req.body,
    );

    // ขั้น 2: 🌐 ถาม member-service  GET http://localhost:4002/members/:member_id
    //         (ไปลงที่ app.get("/members/:id") ใน member-service/app.js -> SELECT จากตาราง members)
    //         ไม่พบ -> 404 MEMBER_NOT_FOUND
    await ensureExists(
      `${memberServiceUrl()}/members/${member_id}`,
      new HttpError(404, "MEMBER_NOT_FOUND", "ไม่พบสมาชิกที่ระบุ"),
      "บริการสมาชิก",
    );
    // ขั้น 3: 🌐 ถาม gym-service  GET http://localhost:4001/gyms/:gym_id
    //         (ไปลงที่ app.get("/gyms/:id") ใน gym-service/app.js -> SELECT จากตาราง gyms)
    //         ไม่พบ -> 404 GYM_NOT_FOUND
    await ensureExists(
      `${gymServiceUrl()}/gyms/${gym_id}`,
      new HttpError(404, "GYM_NOT_FOUND", "ไม่พบสาขาฟิตเนสที่ระบุ"),
      "บริการสาขา",
    );

    try {
      // ขั้น 4: 🗄 INSERT การสมัครลงตาราง subscriptions
      //   COALESCE(?, CURDATE()) = ถ้า start_date เป็น null ให้ใช้ "วันนี้" ของ MySQL (CURDATE())
      //   (ตรงกับข้อความในหน้าเว็บ "วันที่เริ่ม (ไม่ระบุ = วันนี้)")
      //   status ใส่ค่าคงที่ 'active' เสมอตอนสร้างใหม่
      const [result] = await pool.query(
        "INSERT INTO subscriptions (member_id, gym_id, start_date, status) VALUES (?, ?, COALESCE(?, CURDATE()), 'active')",
        [member_id, gym_id, start_date],
      );
      // ขั้น 5: 🗄 SELECT แถวที่เพิ่งสร้างกลับมา (ใช้ insertId) เพื่อตอบค่าจริงที่ฐานข้อมูลเก็บ
      //   DATE_FORMAT(..., '%Y-%m-%d') = แปลงวันที่เป็นสตริง YYYY-MM-DD (กัน timezone ทำให้วันที่เลื่อน)
      const [rows] = await pool.query(
        "SELECT subscription_id, member_id, gym_id, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, status FROM subscriptions WHERE subscription_id = ?",
        [result.insertId],
      );
      res.status(201).json({
        message: "บันทึกการสมัครแพ็กเกจสำเร็จ",
        data: rows[0],
      });
    } catch (dbErr) {
      // schema.sql: UNIQUE KEY unique_enrollment (member_id, gym_id) = สมาชิกคนเดียวสมัครสาขาเดิมซ้ำไม่ได้
      // -> MySQL โยน ER_DUP_ENTRY -> เราตอบ 409 ALREADY_SUBSCRIBED -> หน้าเว็บ toast "สมาชิกคนนี้เคยสมัครสาขานี้ไปแล้ว"
      if (dbErr.code === "ER_DUP_ENTRY") {
        throw new HttpError(
          409,
          "ALREADY_SUBSCRIBED",
          "สมาชิกคนนี้เคยสมัครสาขานี้ไปแล้ว",
        );
      }
      throw dbErr;
    }
  } catch (err) {
    next(err);
  }
});

// UC5: รายงานประวัติการสมัคร (ค้นหาด้วยชื่อสมาชิกได้)
// ▶ FLOW-11  ปลายทางของ frontend/app.js > loadSubscriptions()
//   ถูกเรียกจาก: (1) ตอนเปิดหน้า (2) ปุ่ม "ค้นหา" (submit ของ <form id="sub-search">)
//                (3) ปุ่ม "ล้าง" (id="sub-search-clear") (4) หลังจากเพิ่ม/แก้ไข/ลบ สาขา สมาชิก การสมัคร
//   เส้นทาง: loadSubscriptions -> api(`/subscriptions?member_name=${encodeURIComponent(ชื่อ)}`)
//            -> Gateway (ส่ง query string ต่อด้วย) -> GET /subscriptions?member_name=... (ที่นี่)
app.get("/subscriptions", async (req, res, next) => {
  try {
    // ค่าที่พิมพ์ในช่อง "ค้นหาด้วยชื่อสมาชิก" (id="sub-search-name") มาเป็น req.query.member_name
    const { member_name } = req.query;
    // กันกรณีส่ง ?member_name=a&member_name=b (กลายเป็นอาร์เรย์) -> 400
    if (member_name !== undefined && typeof member_name !== "string") {
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        "member_name ต้องเป็นข้อความเพียงค่าเดียว",
      );
    }

    // 🗄 SQL รายงาน: JOIN 3 ตารางในฐานข้อมูลเดียวกัน (subscriptions + members + gyms)
    //   s.* = ข้อมูลการสมัคร / m.name,m.email = ข้อมูลสมาชิก / g.name,g.monthly_fee = ข้อมูลสาขา
    //   คอลัมน์ที่ตั้งชื่อใหม่ (AS member_name, gym_name) คือชื่อฟิลด์ที่ frontend อ่าน:
    //      s.subscription_id, s.member_name, s.gym_name, s.monthly_fee, s.start_date, s.status
    //   -> ตรงกับ 6 คอลัมน์ในตาราง "ประวัติการสมัครแพ็กเกจ" ใน index.html
    let sql = `
      SELECT s.subscription_id, s.member_id, m.name AS member_name, m.email AS member_email,
             s.gym_id, g.name AS gym_name, g.monthly_fee,
             DATE_FORMAT(s.start_date, '%Y-%m-%d') AS start_date, s.status
      FROM subscriptions s
      JOIN members m ON m.member_id = s.member_id
      JOIN gyms g ON g.gym_id = s.gym_id`;
    const params = []; // ค่าที่จะแทน ? ใน SQL
    // มีคำค้น (ไม่ว่าง) -> ต่อเงื่อนไข WHERE ชื่อสมาชิกมีคำนั้นอยู่ส่วนใดก็ได้
    if (member_name && member_name.trim()) {
      // escape อักขระพิเศษของ LIKE เพื่อให้ค้นหาตามตัวอักษรจริง
      // (ถ้าผู้ใช้พิมพ์ % หรือ _ จะไม่ถูกตีความเป็น wildcard ของ LIKE)
      const escaped = member_name.trim().replace(/[\\%_]/g, "\\$&");
      sql += " WHERE m.name LIKE ?";
      params.push(`%${escaped}%`); // %คำค้น% = มีคำนี้อยู่ตรงไหนของชื่อก็เจอ
    }
    sql += " ORDER BY s.subscription_id"; // ช่องค้นหาว่าง (ปุ่ม "ล้าง") = ไม่มี WHERE -> ได้ทุกแถว

    const [rows] = await pool.query(sql, params);
    res.status(200).json({
      // frontend อ่าน message นี้ไปแสดงในกล่องสถานะ "empty" เมื่อ data ว่าง
      // (setState(state,"empty",message) ใน loadSubscriptions)
      message: rows.length
        ? "ดึงข้อมูลประวัติการสมัครสำเร็จ"
        : "ไม่พบประวัติการสมัครในขณะนี้",
      data: rows,
    });
  } catch (err) {
    next(err);
  }
});

// ตัวสร้าง error 404 "ไม่พบการสมัคร" ใช้ใน PUT และ DELETE ด้านล่าง
const subscriptionNotFound = () =>
  new HttpError(404, "SUBSCRIPTION_NOT_FOUND", "ไม่พบการสมัครแพ็กเกจที่ระบุ");

// แก้ไขการสมัคร: เปลี่ยนสาขา / วันที่เริ่ม / สถานะ (แทนที่ทั้งรายการ ต้องส่งครบทุกฟิลด์)
// ▶ FLOW-13  ปลายทางของ sub-form ใน "โหมดแก้ไข" (กดปุ่ม "แก้ไข" ที่แถวการสมัคร -> startEditSubscription()
//   เติมฟอร์ม + ล็อกช่องสมาชิก ไม่เรียก API) แล้วกดปุ่ม "บันทึกการแก้ไข"
//   เส้นทาง: submit -> validateSubEditForm() -> api(`/subscriptions/${editingSubId}`,{method:"PUT",body:{gym_id,start_date,status}})
//            -> Gateway -> PUT /subscriptions/:id (ที่นี่)
//   ⚠ ไม่ส่ง member_id (เปลี่ยนสมาชิกไม่ได้) จึงตรวจเฉพาะสาขาใหม่กับ gym-service
app.put("/subscriptions/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    // ตรวจ body: gym_id (จำนวนเต็มบวก), start_date (วันที่จริง บังคับ), status (active/expired/cancelled)
    const { gym_id, start_date, status } = validateSubscriptionUpdateBody(
      req.body,
    );
    // 🗄 ขั้น 1: SELECT เช็คว่าการสมัครรหัสนี้มีอยู่จริง
    const [exists] = await pool.query(
      "SELECT subscription_id FROM subscriptions WHERE subscription_id = ?",
      [id],
    );
    if (!exists.length) throw subscriptionNotFound();

    // ขั้น 2: 🌐 ถาม gym-service ว่าสาขาที่เลือก (อาจเปลี่ยนใหม่) มีอยู่จริง  GET http://localhost:4001/gyms/:gym_id
    await ensureExists(
      `${gymServiceUrl()}/gyms/${gym_id}`,
      new HttpError(404, "GYM_NOT_FOUND", "ไม่พบสาขาฟิตเนสที่ระบุ"),
      "บริการสาขา",
    );

    try {
      // ขั้น 3: 🗄 UPDATE สาขา/วันที่เริ่ม/สถานะ (member_id ไม่ถูกแตะ)
      await pool.query(
        "UPDATE subscriptions SET gym_id = ?, start_date = ?, status = ? WHERE subscription_id = ?",
        [gym_id, start_date, status, id],
      );
    } catch (dbErr) {
      // เปลี่ยนไปสาขาที่สมาชิกคนนี้สมัครไว้แล้ว -> ชน UNIQUE (member_id, gym_id) -> 409
      if (dbErr.code === "ER_DUP_ENTRY") {
        throw new HttpError(
          409,
          "ALREADY_SUBSCRIBED",
          "สมาชิกคนนี้เคยสมัครสาขานี้ไปแล้ว",
        );
      }
      throw dbErr;
    }
    // ขั้น 4: 🗄 SELECT แถวหลังอัปเดตกลับมาตอบ
    const [rows] = await pool.query(
      "SELECT subscription_id, member_id, gym_id, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, status FROM subscriptions WHERE subscription_id = ?",
      [id],
    );
    res.status(200).json({
      message: "อัปเดตการสมัครแพ็กเกจสำเร็จ",
      data: rows[0],
    });
  } catch (err) {
    next(err);
  }
});

// ลบ (ยกเลิก) การสมัครแพ็กเกจ
// ▶ FLOW-14  ปลายทางของปุ่ม "ลบ" ที่แถวการสมัคร -> frontend/app.js > deleteSubscription()
//   (ถาม window.confirm ก่อน) -> api(`/subscriptions/${s.subscription_id}`,{method:"DELETE"})
//   -> Gateway -> DELETE /subscriptions/:id (ที่นี่) -> หน้าเว็บ loadSubscriptions() ใหม่
app.delete("/subscriptions/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    // 🗄 DELETE แถวการสมัคร (ลบเฉพาะการสมัคร ไม่กระทบสมาชิก/สาขา)
    const [result] = await pool.query(
      "DELETE FROM subscriptions WHERE subscription_id = ?",
      [id],
    );
    if (result.affectedRows === 0) throw subscriptionNotFound();
    res.status(200).json({ message: "ลบการสมัครแพ็กเกจสำเร็จ" });
  } catch (err) {
    next(err);
  }
});

// route ที่ไม่มี -> 404 / error ทั้งหมดไหลมาจบที่ errorHandler (shared/errors.js)
app.use(notFoundHandler);
app.use(errorHandler);

// ส่งออก app (ไม่ listen) — subscription-service/server.js เป็นคนเปิดพอร์ต 4003
module.exports = app;
